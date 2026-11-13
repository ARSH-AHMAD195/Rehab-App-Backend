import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, FilterQuery, Model, Types } from 'mongoose';
import { AUDIT_ACTIONS, DEFAULT_PAGE_LIMIT, DETAIL_CODES, ROLES, SPIROMETRY, VIDEO_PROVIDERS } from '../common/constants';
import { ForbiddenRoleException, NotFoundException, ValidationFailedException } from '../common/api.exception';
import { TransactionRunner } from '../common/mongo/transaction.runner';
import { decodeCursor, encodeCursor } from '../common/pagination/cursor';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../users/users.service';
import { CategoriesService } from '../categories/categories.service';
import { Exercise, ExerciseDocument, ExerciseHindi, ExerciseVideo } from './exercise.schema';
import {
  CreateExerciseDto,
  ExerciseHindiDto,
  ExerciseListResponse,
  ExerciseResponse,
  ListExercisesQueryDto,
  UpdateExerciseDto,
} from './exercise.dto';
import { parseYouTubeVideoId, youTubeWatchUrl } from './youtube';
import { VIDEO_CHECKER, VIDEO_PROBLEM_ISSUES, VideoChecker } from './video-checker';
import { ExercisePlan } from '../plans/plan.schema';

/** The fields an edit can change, as stored. */
type ExerciseChanges = Partial<
  Pick<Exercise, 'name' | 'sortKey' | 'categoryId' | 'description' | 'instructions' | 'hi' | 'recordsVolume' | 'video' | 'active'>
>;

const isDuplicateKey = (error: unknown) => (error as { code?: number })?.code === 11000;

@Injectable()
export class ExercisesService implements OnModuleInit {
  constructor(
    @InjectModel(Exercise.name) private readonly model: Model<Exercise>,
    @InjectModel(ExercisePlan.name) private readonly plans: Model<ExercisePlan>,
    private readonly categories: CategoriesService,
    private readonly audit: AuditService,
    private readonly tx: TransactionRunner,
    @Inject(VIDEO_CHECKER) private readonly videos: VideoChecker,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.model.init();
    await this.seedMissing();
  }

  /**
   * Puts incentive spirometry in the library, under Breathing, if it isn't
   * there yet. Name only: the steps, video and Hindi text come from the
   * clinic, added like any other edit. Once there it is never touched again,
   * so an admin's edits (or deactivating it) stick.
   */
  async seedMissing(): Promise<void> {
    const breathing = await this.categories.findByCode(SPIROMETRY.CATEGORY);
    if (!breathing) return;
    try {
      await this.model.updateOne(
        { code: SPIROMETRY.CODE },
        {
          $setOnInsert: {
            code: SPIROMETRY.CODE,
            name: SPIROMETRY.NAME,
            sortKey: SPIROMETRY.NAME.toLowerCase(),
            categoryId: breathing._id,
            description: null,
            instructions: [],
            hi: null,
            recordsVolume: true,
            video: null,
            active: true,
            createdBy: null,
          },
        },
        { upsert: true },
      );
    } catch (error) {
      // Another instance added it at the same moment, which is fine.
      if (!isDuplicateKey(error)) throw error;
    }
  }

  async create(dto: CreateExerciseDto, actor: AuthUser): Promise<ExerciseResponse> {
    const video = dto.videoUrl ? toVideo(dto.videoUrl) : null;
    if (video) await this.assertPlayable(video);

    const created = await this.tx.run(async (session) => {
      const category = await this.categories.lockActive(dto.categoryId, 'categoryId', session);
      const [doc] = await this.model.create(
        [
          {
            name: dto.name,
            sortKey: dto.name.toLowerCase(),
            categoryId: category._id,
            description: dto.description || null,
            instructions: dto.instructions ?? [],
            hi: toHindi(dto.hi),
            recordsVolume: dto.recordsVolume ?? false,
            video,
            createdBy: { id: new Types.ObjectId(actor.id), role: actor.role },
          },
        ],
        { session },
      );
      const after = this.toResponse(doc, category.code);
      await this.recordChange(actor, doc, null, after, session);
      return after;
    });
    return created;
  }

  /**
   * PATCH. Also how a deactivated exercise is brought back (active: true).
   * A doctor may edit only the exercises they added, and may not switch one
   * on or off: that stays with the admin.
   */
  async update(id: string, dto: UpdateExerciseDto, actor: AuthUser): Promise<ExerciseResponse> {
    const isDoctor = actor.role === ROLES.DOCTOR;
    if (isDoctor && dto.active !== undefined) {
      throw new ForbiddenRoleException('Only an admin can switch an exercise on or off');
    }
    // Checked before the video, so a doctor isn't told about someone else's link.
    if (isDoctor) {
      const existing = Types.ObjectId.isValid(id) ? await this.model.findById(id, { createdBy: 1 }).lean() : null;
      if (!existing) throw new NotFoundException('Exercise not found');
      this.assertOwnedBy(existing.createdBy, actor);
    }
    const changes = this.toChanges(dto);
    // Asked even when the link is unchanged: a video that has since gone
    // Private should be noticed, not saved over again.
    if (changes.video) await this.assertPlayable(changes.video);

    return this.tx.run(async (session) => {
      const before = await this.findOrThrow(id, session);
      if (isDoctor) this.assertOwnedBy(before.createdBy, actor);
      const beforeResponse = await this.respond(before);

      const changed = (Object.keys(changes) as (keyof ExerciseChanges)[]).filter(
        (key) => !sameValue(before[key], changes[key]),
      );
      if (!changed.length) return beforeResponse;
      const set = Object.fromEntries(changed.map((key) => [key, changes[key]]));

      // Moving to a category needs that category to be active, whether or not
      // the exercise is - otherwise an inactive exercise could point at no
      // category at all, and could never be brought back. Coming back to life
      // needs its category active too. Either way it must stay so until this
      // commits.
      const categoryId = changes.categoryId ?? before.categoryId;
      const active = changes.active ?? before.active;
      const needsActiveCategory = changed.includes('categoryId') || (active && changed.includes('active'));
      if (needsActiveCategory) await this.categories.lockActive(categoryId, 'categoryId', session);

      const after = await this.model
        .findOneAndUpdate({ _id: before._id }, { $set: set }, { new: true, session })
        .exec();
      const afterResponse = await this.respond(after!);
      await this.recordChange(actor, after!, beforeResponse, afterResponse, session);
      return afterResponse;
    });
  }

  /** DELETE deactivates: plans and completions that point at it keep working. */
  async deactivate(id: string, actor: AuthUser): Promise<ExerciseResponse> {
    return this.update(id, { active: false }, actor);
  }

  /**
   * One exercise. With `onlyIds` (a patient's plan) anything outside it is a
   * 404, so a patient can't find out what else is in the library.
   */
  async get(id: string, onlyIds?: Types.ObjectId[]): Promise<ExerciseResponse> {
    // ObjectIds print in lower case; the path may not, and must match all the same.
    const allowed = !onlyIds || onlyIds.some((planned) => String(planned) === id.toLowerCase());
    const doc = allowed && Types.ObjectId.isValid(id) ? await this.model.findById(id).exec() : null;
    if (!doc) throw new NotFoundException('Exercise not found');
    return this.respond(doc);
  }

  /**
   * The library, by name, A to Z, a page at a time. Admins and doctors see the
   * active ones unless they ask for `active=false` or `all`; a patient passes
   * `onlyIds` (their plan) and sees just those, active or not, since a planned
   * exercise stays in the plan if it's switched off.
   */
  async list(query: ListExercisesQueryDto, onlyIds?: Types.ObjectId[]): Promise<ExerciseListResponse> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const active = query.active ?? (onlyIds ? 'all' : 'true');
    const and: FilterQuery<Exercise>[] = [
      ...(onlyIds ? [{ _id: { $in: onlyIds } }] : []),
      ...(active === 'all' ? [] : [{ active: active === 'true' }]),
    ];

    if (query.category) {
      const category = await this.categories.findByCode(query.category);
      // An unknown code matches nothing, the same as any other filter.
      if (!category) return { data: [], nextCursor: null };
      and.push({ categoryId: category._id });
    }
    if (query.q) and.push({ sortKey: { $regex: escapeRegex(query.q.toLowerCase()) } });
    if (query.cursor) {
      const { k, id } = decodeCursor(query.cursor);
      const after = new Types.ObjectId(id);
      and.push({ $or: [{ sortKey: { $gt: k } }, { sortKey: k, _id: { $gt: after } }] });
    }

    const rows = await this.model
      // An empty $and is refused by MongoDB: active=all with no other filter.
      .find(and.length ? { $and: and } : {})
      .sort({ sortKey: 1, _id: 1 })
      .limit(limit + 1)
      .exec();
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];

    return {
      data: await this.respondMany(page),
      nextCursor: rows.length > limit && last ? encodeCursor({ k: last.sortKey, id: String(last._id) }) : null,
    };
  }

  /** The exercise ids in a patient's current plan: all a patient may see of the library. */
  async currentPlanExerciseIds(patientId: string): Promise<Types.ObjectId[]> {
    const plan = await this.plans
      .findOne({ patientId: new Types.ObjectId(patientId), isCurrent: true }, { 'items.exerciseId': 1 })
      .lean();
    return (plan?.items ?? []).map((item) => item.exerciseId);
  }

  /** Read inside a plan save's transaction, to check each planned exercise. */
  async findForPlan(ids: Types.ObjectId[], session: ClientSession): Promise<Map<string, ExerciseDocument>> {
    if (!ids.length) return new Map();
    const rows = await this.model.find({ _id: { $in: ids } }).session(session).exec();
    return new Map(rows.map((row) => [String(row._id), row]));
  }

  /** Library details for the exercises in a plan, live, so a new video reaches patients at once. */
  async responsesByIds(ids: Types.ObjectId[]): Promise<Map<string, ExerciseResponse>> {
    if (!ids.length) return new Map();
    const rows = await this.model.find({ _id: { $in: ids } }).exec();
    const responses = await this.respondMany(rows);
    return new Map(responses.map((response) => [response.id, response]));
  }

  private toChanges(dto: UpdateExerciseDto): ExerciseChanges {
    const changes: ExerciseChanges = {};
    if (dto.name !== undefined) {
      changes.name = dto.name;
      changes.sortKey = dto.name.toLowerCase();
    }
    if (dto.categoryId !== undefined) changes.categoryId = new Types.ObjectId(dto.categoryId);
    if (dto.description !== undefined) changes.description = dto.description || null;
    if (dto.instructions !== undefined) changes.instructions = dto.instructions;
    if (dto.hi !== undefined) changes.hi = toHindi(dto.hi);
    if (dto.recordsVolume !== undefined) changes.recordsVolume = dto.recordsVolume;
    if (dto.videoUrl !== undefined) changes.video = dto.videoUrl ? toVideo(dto.videoUrl) : null;
    if (dto.active !== undefined) changes.active = dto.active;
    return changes;
  }

  /** Outside the transaction: it waits on YouTube, and holds no lock while it does. */
  private async assertPlayable(video: ExerciseVideo): Promise<void> {
    const problem = await this.videos.check(video.videoId);
    if (!problem) return;
    throw new ValidationFailedException([
      { field: 'videoUrl', code: DETAIL_CODES.VIDEO_NOT_PLAYABLE, issue: VIDEO_PROBLEM_ISSUES[problem] },
    ]);
  }

  private assertOwnedBy(createdBy: Exercise['createdBy'], doctor: AuthUser): void {
    if (String(createdBy?.id) !== doctor.id) {
      throw new ForbiddenRoleException('Doctors can change only the exercises they added');
    }
  }

  private async findOrThrow(id: string, session: ClientSession): Promise<ExerciseDocument> {
    const doc = Types.ObjectId.isValid(id) ? await this.model.findById(id).session(session).exec() : null;
    if (!doc) throw new NotFoundException('Exercise not found');
    return doc;
  }

  private async respond(doc: ExerciseDocument): Promise<ExerciseResponse> {
    return (await this.respondMany([doc]))[0];
  }

  private async respondMany(docs: ExerciseDocument[]): Promise<ExerciseResponse[]> {
    const categories = await this.categories.byIds(docs.map((doc) => doc.categoryId));
    return docs.map((doc) => this.toResponse(doc, categories.get(String(doc.categoryId))?.code ?? null));
  }

  private toResponse(doc: ExerciseDocument, categoryCode: string | null): ExerciseResponse {
    return {
      id: String(doc._id),
      name: doc.name,
      categoryId: String(doc.categoryId),
      category: categoryCode ?? '',
      description: doc.description,
      instructions: [...doc.instructions],
      hi: {
        name: doc.hi?.name ?? null,
        description: doc.hi?.description ?? null,
        instructions: [...(doc.hi?.instructions ?? [])],
      },
      code: doc.code ?? null,
      recordsVolume: doc.recordsVolume ?? false,
      video: doc.video
        ? { provider: doc.video.provider, videoId: doc.video.videoId, url: youTubeWatchUrl(doc.video.videoId) }
        : null,
      active: doc.active,
      createdBy: doc.createdBy ? { id: String(doc.createdBy.id), role: doc.createdBy.role } : null,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    };
  }

  private recordChange(
    actor: AuthUser,
    doc: ExerciseDocument,
    before: ExerciseResponse | null,
    after: ExerciseResponse,
    session: ClientSession,
  ): Promise<void> {
    return this.audit.record(
      {
        actor,
        action: AUDIT_ACTIONS.EXERCISE_LIBRARY_CHANGED,
        resourceId: String(doc._id),
        before: before ? { exercise: before } : null,
        after: { exercise: after },
      },
      session,
    );
  }
}

/** As stored: null when nothing is in Hindi yet, so "no Hindi" has one shape. */
function toHindi(hi: ExerciseHindiDto | null | undefined): ExerciseHindi | null {
  if (!hi) return null;
  const stored = { name: hi.name || null, description: hi.description || null, instructions: hi.instructions ?? [] };
  return stored.name || stored.description || stored.instructions.length ? stored : null;
}

function toVideo(link: string): ExerciseVideo {
  const videoId = parseYouTubeVideoId(link);
  if (!videoId) {
    throw new ValidationFailedException([
      {
        field: 'videoUrl',
        code: DETAIL_CODES.WRONG_SHAPE,
        issue: 'must be a YouTube video link (watch, share, embed or shorts) or a video id',
      },
    ]);
  }
  return { provider: VIDEO_PROVIDERS.YOUTUBE, videoId };
}

/** Deep enough for the stored values: strings, ids, arrays of strings, the video object. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof Types.ObjectId || b instanceof Types.ObjectId) return String(a) === String(b);
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b;
  return JSON.stringify(plain(a)) === JSON.stringify(plain(b));
}

function plain(value: object): unknown {
  const raw = (value as { toObject?: () => unknown }).toObject?.() ?? value;
  return Array.isArray(raw) ? [...raw] : raw;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
