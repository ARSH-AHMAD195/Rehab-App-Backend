import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, FilterQuery, Model, Types } from 'mongoose';
import { AUDIT_ACTIONS, DEFAULT_PAGE_LIMIT, DETAIL_CODES, VIDEO_PROVIDERS } from '../common/constants';
import { NotFoundException, ValidationFailedException } from '../common/api.exception';
import { TransactionRunner } from '../common/mongo/transaction.runner';
import { decodeCursor, encodeCursor } from '../common/pagination/cursor';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../users/users.service';
import { CategoriesService } from '../categories/categories.service';
import { Exercise, ExerciseDocument, ExerciseVideo } from './exercise.schema';
import {
  CreateExerciseDto,
  ExerciseListResponse,
  ExerciseResponse,
  ListExercisesQueryDto,
  UpdateExerciseDto,
} from './exercise.dto';
import { parseYouTubeVideoId, youTubeWatchUrl } from './youtube';

/** The fields an admin edit can change, as stored. */
type ExerciseChanges = Partial<Pick<Exercise, 'name' | 'sortKey' | 'categoryId' | 'description' | 'instructions' | 'video' | 'active'>>;

@Injectable()
export class ExercisesService implements OnModuleInit {
  constructor(
    @InjectModel(Exercise.name) private readonly model: Model<Exercise>,
    private readonly categories: CategoriesService,
    private readonly audit: AuditService,
    private readonly tx: TransactionRunner,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.model.init();
  }

  async create(dto: CreateExerciseDto, actor: AuthUser): Promise<ExerciseResponse> {
    const video = dto.videoUrl ? toVideo(dto.videoUrl) : null;

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
            video,
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

  /** PATCH. Also how a deactivated exercise is brought back (active: true). */
  async update(id: string, dto: UpdateExerciseDto, actor: AuthUser): Promise<ExerciseResponse> {
    const changes = this.toChanges(dto);

    return this.tx.run(async (session) => {
      const before = await this.findOrThrow(id, session);
      const beforeResponse = await this.respond(before);

      const changed = (Object.keys(changes) as (keyof ExerciseChanges)[]).filter(
        (key) => !sameValue(before[key], changes[key]),
      );
      if (!changed.length) return beforeResponse;
      const set = Object.fromEntries(changed.map((key) => [key, changes[key]]));

      // Moving to a category, or coming back to life in one, needs that
      // category to be active - and to stay so until this commits.
      const categoryId = changes.categoryId ?? before.categoryId;
      const active = changes.active ?? before.active;
      const needsActiveCategory = active && (changed.includes('categoryId') || changed.includes('active'));
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

  async get(id: string): Promise<ExerciseResponse> {
    const doc = Types.ObjectId.isValid(id) ? await this.model.findById(id).exec() : null;
    if (!doc) throw new NotFoundException('Exercise not found');
    return this.respond(doc);
  }

  /** The library for admins and doctors: by name, A to Z, a page at a time. */
  async list(query: ListExercisesQueryDto): Promise<ExerciseListResponse> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const and: FilterQuery<Exercise>[] = [{ active: query.active ?? true }];

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
      .find({ $and: and })
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

  private toChanges(dto: UpdateExerciseDto): ExerciseChanges {
    const changes: ExerciseChanges = {};
    if (dto.name !== undefined) {
      changes.name = dto.name;
      changes.sortKey = dto.name.toLowerCase();
    }
    if (dto.categoryId !== undefined) changes.categoryId = new Types.ObjectId(dto.categoryId);
    if (dto.description !== undefined) changes.description = dto.description || null;
    if (dto.instructions !== undefined) changes.instructions = dto.instructions;
    if (dto.videoUrl !== undefined) changes.video = dto.videoUrl ? toVideo(dto.videoUrl) : null;
    if (dto.active !== undefined) changes.active = dto.active;
    return changes;
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
      video: doc.video
        ? { provider: doc.video.provider, videoId: doc.video.videoId, url: youTubeWatchUrl(doc.video.videoId) }
        : null,
      active: doc.active,
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
