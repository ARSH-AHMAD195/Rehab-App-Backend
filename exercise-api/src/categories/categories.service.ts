import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { AUDIT_ACTIONS, DEFAULT_CATEGORIES, DETAIL_CODES, ROLES } from '../common/constants';
import { NotFoundException, ValidationFailedException } from '../common/api.exception';
import { TransactionRunner } from '../common/mongo/transaction.runner';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../users/users.service';
import { ExerciseCategory, ExerciseCategoryDocument } from './category.schema';
import { CategoryResponse, CreateCategoryDto, UpdateCategoryDto } from './category.dto';

const isDuplicateKey = (error: unknown) => (error as { code?: number })?.code === 11000;

@Injectable()
export class CategoriesService implements OnModuleInit {
  private readonly logger = new Logger(CategoriesService.name);

  constructor(
    @InjectModel(ExerciseCategory.name) private readonly model: Model<ExerciseCategory>,
    private readonly audit: AuditService,
    private readonly tx: TransactionRunner,
  ) {}

  async onModuleInit(): Promise<void> {
    // The unique index on `code` must exist before anything relies on it.
    await this.model.init();
    await this.seedMissing();
  }

  /** Inserts any of the four SRS categories that are not in the database yet. */
  async seedMissing(): Promise<void> {
    try {
      await this.model.bulkWrite(
        DEFAULT_CATEGORIES.map((seed) => ({
          updateOne: {
            filter: { code: seed.code },
            update: { $setOnInsert: { ...seed, active: true, lockVersion: 0 } },
            upsert: true,
          },
        })),
        { ordered: false },
      );
    } catch (error) {
      // Another instance seeding at the same moment: its insert won, which is fine.
      if (!isDuplicateKey(error)) throw error;
      this.logger.debug('Categories seeded by another instance');
    }
  }

  async list(caller: AuthUser, includeInactive = false): Promise<CategoryResponse[]> {
    const all = includeInactive && caller.role === ROLES.ADMIN;
    const rows = await this.model
      .find(all ? {} : { active: true })
      .sort({ order: 1, code: 1 })
      .exec();
    return rows.map(toCategoryResponse);
  }

  async create(dto: CreateCategoryDto, actor: AuthUser): Promise<CategoryResponse> {
    if (await this.model.exists({ code: dto.code })) throw alreadyExists(dto.code);
    const order = dto.order ?? (await this.nextOrder());

    try {
      // No retry on a duplicate key: here it means the code was taken meanwhile.
      const created = await this.tx.run(async (session) => {
        const [doc] = await this.model.create([{ code: dto.code, name: dto.name, order }], { session });
        await this.recordChange(actor, doc, null, toCategoryResponse(doc), session);
        return doc;
      }, 0);
      return toCategoryResponse(created);
    } catch (error) {
      if (isDuplicateKey(error)) throw alreadyExists(dto.code);
      throw error;
    }
  }

  async update(id: string, dto: UpdateCategoryDto, actor: AuthUser): Promise<CategoryResponse> {
    const set: Partial<ExerciseCategory> = {};
    if (dto.name !== undefined) set.name = dto.name;
    if (dto.order !== undefined) set.order = dto.order;
    if (dto.active !== undefined) set.active = dto.active;

    const updated = await this.tx.run(async (session) => {
      const before = await this.findOrThrow(id, session);
      const changed = Object.entries(set).some(
        ([key, value]) => before[key as keyof ExerciseCategory] !== value,
      );
      if (!changed) return before;

      const after = await this.model
        .findOneAndUpdate({ _id: before._id }, { $set: set, $inc: { lockVersion: 1 } }, { new: true, session })
        .exec();

      // Checked after this transaction's own write to the category, so an
      // exercise being added to it at the same moment conflicts with this one
      // and one of the two is retried (see ExerciseCategory.lockVersion).
      if (before.active && set.active === false) await this.assertNotInUse(before._id, session);

      await this.recordChange(actor, after!, toCategoryResponse(before), toCategoryResponse(after!), session);
      return after!;
    });
    return toCategoryResponse(updated);
  }

  /** DELETE deactivates: exercises and old plans that use the category keep working. */
  async deactivate(id: string, actor: AuthUser): Promise<CategoryResponse> {
    return this.update(id, { active: false }, actor);
  }

  /**
   * For adding an exercise to a category, inside the caller's transaction:
   * the category must exist and be active, and it is written so that a
   * deactivation running at the same moment conflicts with this transaction.
   */
  async lockActive(id: string | Types.ObjectId, field: string, session: ClientSession): Promise<ExerciseCategoryDocument> {
    const locked = Types.ObjectId.isValid(String(id))
      ? await this.model
          .findOneAndUpdate({ _id: id, active: true }, { $inc: { lockVersion: 1 } }, { new: true, session })
          .exec()
      : null;
    if (locked) return locked;

    const exists = Types.ObjectId.isValid(String(id)) && (await this.model.exists({ _id: id }).session(session));
    throw new ValidationFailedException([
      exists
        ? { field, code: DETAIL_CODES.NOT_ALLOWED, issue: 'is a deactivated category' }
        : { field, code: DETAIL_CODES.UNKNOWN_ID, issue: 'is not a known category' },
    ]);
  }

  async byIds(ids: Types.ObjectId[]): Promise<Map<string, ExerciseCategoryDocument>> {
    if (!ids.length) return new Map();
    const rows = await this.model.find({ _id: { $in: ids } }).exec();
    return new Map(rows.map((row) => [String(row._id), row]));
  }

  async findByCode(code: string): Promise<ExerciseCategoryDocument | null> {
    return this.model.findOne({ code }).exec();
  }

  private async findOrThrow(id: string, session: ClientSession): Promise<ExerciseCategoryDocument> {
    const doc = Types.ObjectId.isValid(id) ? await this.model.findById(id).session(session).exec() : null;
    if (!doc) throw new NotFoundException('Category not found');
    return doc;
  }

  private async assertNotInUse(categoryId: Types.ObjectId, session: ClientSession): Promise<void> {
    const inUse = await this.model.db
      .collection('exercises')
      .countDocuments({ categoryId, active: true }, { session });
    if (inUse) {
      throw new ValidationFailedException([
        {
          field: 'active',
          code: DETAIL_CODES.NOT_ALLOWED,
          issue: `${inUse} active exercise(s) still use this category; move or deactivate them first`,
        },
      ]);
    }
  }

  private async nextOrder(): Promise<number> {
    const last = await this.model.findOne().sort({ order: -1 }).select({ order: 1 }).lean();
    return (last?.order ?? 0) + 1;
  }

  private recordChange(
    actor: AuthUser,
    doc: ExerciseCategoryDocument,
    before: CategoryResponse | null,
    after: CategoryResponse,
    session: ClientSession,
  ): Promise<void> {
    return this.audit.record(
      {
        actor,
        action: AUDIT_ACTIONS.EXERCISE_LIBRARY_CHANGED,
        resourceId: String(doc._id),
        before: before ? { category: before } : null,
        after: { category: after },
      },
      session,
    );
  }
}

export function toCategoryResponse(doc: ExerciseCategory & { _id: unknown }): CategoryResponse {
  return {
    id: String(doc._id),
    code: doc.code,
    name: doc.name,
    order: doc.order,
    active: doc.active,
  };
}

function alreadyExists(code: string): ValidationFailedException {
  return new ValidationFailedException([
    { field: 'code', code: DETAIL_CODES.ALREADY_EXISTS, issue: `category ${code} already exists` },
  ]);
}
