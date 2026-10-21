import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AUDIT_ACTIONS, DEFAULT_PAGE_LIMIT, DETAIL_CODES, EVENT_TYPES } from '../common/constants';
import {
  ConcurrentUpdateException,
  ErrorDetail,
  NotFoundException,
  ValidationFailedException,
} from '../common/api.exception';
import { TransactionRunner } from '../common/mongo/transaction.runner';
import { decodeCursor, encodeCursor } from '../common/pagination/cursor';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../outbox/outbox.service';
import { DayService } from '../time/day.service';
import { AuthUser, UsersService } from '../users/users.service';
import { ExercisesService } from '../exercises/exercises.service';
import { ExercisePlan, ExercisePlanDocument, PlanItem } from './plan.schema';
import {
  PlanItemDto,
  PlanResponse,
  PlanVersionListResponse,
  PlanVersionsQueryDto,
  SavePlanDto,
} from './plan.dto';

/** A plan item as stored, in plain values: what "unchanged" and the audit record compare. */
interface StoredItem {
  itemId: string;
  exerciseId: string;
  schedule: { daysOfWeek: number[]; timesPerDay: number };
  target: { sets: number | null; reps: number | null; durationMin: number | null } | null;
  notes: string | null;
}

@Injectable()
export class PlansService {
  constructor(
    @InjectModel(ExercisePlan.name) private readonly model: Model<ExercisePlan>,
    private readonly exercises: ExercisesService,
    private readonly users: UsersService,
    private readonly day: DayService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly tx: TransactionRunner,
  ) {}

  /**
   * PUT /patients/:patientId/exercise-plan. Saves the items as a new version.
   *
   * `version` is the version the doctor last saw. If the plan changed since,
   * nothing is saved and the doctor gets 409 CONCURRENT_UPDATE, so two doctors
   * can't overwrite each other. Saving the same items again changes nothing.
   */
  async save(patientId: string, dto: SavePlanDto, doctor: AuthUser): Promise<PlanResponse> {
    this.assertNoRepeats(dto.items);
    const patient = new Types.ObjectId(patientId);
    const exerciseIds = dto.items.map((item) => new Types.ObjectId(item.exerciseId));

    const saved = await this.tx.run(async (session) => {
      const current = await this.model.findOne({ patientId: patient, isCurrent: true }).session(session).exec();
      const currentVersion = current?.version ?? 0;
      if (dto.version !== currentVersion) {
        throw new ConcurrentUpdateException(
          `The plan is now at version ${currentVersion}, not ${dto.version}: someone else changed it. Reload it and try again.`,
        );
      }

      this.assertPlannable(dto.items, await this.exercises.findForPlan(exerciseIds, session));

      const before = current ? current.items.map(toStoredItem) : [];
      const items = this.toItems(dto.items, before);
      // Nothing to do: the same items again, or clearing a plan that was never set.
      if (sameItems(before, items)) return current;

      if (current) {
        const retired = await this.model
          .updateOne({ _id: current._id, isCurrent: true }, { $set: { isCurrent: false } }, { session })
          .exec();
        if (retired.modifiedCount !== 1) throw new ConcurrentUpdateException();
      }

      const [next] = await this.model.create(
        [
          {
            patientId: patient,
            version: currentVersion + 1,
            isCurrent: true,
            items: items.map((item) => ({ ...item, exerciseId: new Types.ObjectId(item.exerciseId) })),
            assignedById: new Types.ObjectId(doctor.id),
            assignedByName: doctor.name,
          },
        ],
        { session },
      );

      await this.audit.record(
        {
          actor: doctor,
          action: AUDIT_ACTIONS.EXERCISE_PLAN_CHANGED,
          patientId,
          resourceId: String(next._id),
          before: current ? { version: current.version, items: before } : null,
          after: { version: next.version, items },
        },
        session,
      );
      await this.outbox.enqueue(
        [
          {
            type: EVENT_TYPES.PLAN_ASSIGNED,
            patientId,
            data: {
              planVersion: next.version,
              itemCount: items.length,
              assignedBy: doctor.id,
            },
          },
        ],
        session,
      );
      return next;
    });

    return this.respond(patientId, saved);
  }

  /** The patient's own current plan. Not audited: patients reading their own data. */
  async forPatient(patient: AuthUser): Promise<PlanResponse> {
    return this.respond(patient.id, await this.current(patient.id), patient.timeZone);
  }

  /** A doctor viewing a linked patient's plan. Audited; a view that can't be audited fails. */
  async forDoctor(patientId: string, doctor: AuthUser): Promise<PlanResponse> {
    const plan = await this.current(patientId);
    await this.recordView(doctor, patientId, plan ? String(plan._id) : null);
    return this.respond(patientId, plan);
  }

  /** Earlier versions, newest first, including the current one. */
  async versions(patientId: string, query: PlanVersionsQueryDto, doctor: AuthUser): Promise<PlanVersionListResponse> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const filter: Record<string, unknown> = { patientId: new Types.ObjectId(patientId) };
    if (query.cursor) {
      const { k } = decodeCursor(query.cursor);
      const before = Number(k);
      if (!Number.isInteger(before) || before < 1) {
        throw new ValidationFailedException([
          { field: 'cursor', code: DETAIL_CODES.WRONG_SHAPE, issue: 'is not a cursor returned by this API' },
        ]);
      }
      filter.version = { $lt: before };
    }

    const rows = await this.model.find(filter).sort({ version: -1 }).limit(limit + 1).exec();
    const page = rows.slice(0, limit);
    await this.recordView(doctor, patientId, null);

    const timeZone = await this.zoneOf(patientId);
    const last = page[page.length - 1];
    return {
      data: await Promise.all(page.map((plan) => this.respond(patientId, plan, timeZone))),
      nextCursor: rows.length > limit && last ? encodeCursor({ k: String(last.version), id: String(last._id) }) : null,
    };
  }

  private current(patientId: string): Promise<ExercisePlanDocument | null> {
    return this.model.findOne({ patientId: new Types.ObjectId(patientId), isCurrent: true }).exec();
  }

  /** One exercise once per plan: how often is `timesPerDay`, and completions need one item per exercise. */
  private assertNoRepeats(items: PlanItemDto[]): void {
    const seen = new Set<string>();
    const details: ErrorDetail[] = [];
    items.forEach((item, index) => {
      const id = item.exerciseId.toLowerCase();
      if (seen.has(id)) {
        details.push({
          field: `items.${index}.exerciseId`,
          code: DETAIL_CODES.ALREADY_EXISTS,
          issue: 'is already in the plan; use timesPerDay to do it more often',
        });
      }
      seen.add(id);
    });
    if (details.length) throw new ValidationFailedException(details);
  }

  /** Every exercise must exist and be active (reference section 4, Plans). */
  private assertPlannable(items: PlanItemDto[], found: Map<string, { active: boolean }>): void {
    const details: ErrorDetail[] = [];
    items.forEach((item, index) => {
      const exercise = found.get(item.exerciseId.toLowerCase());
      const field = `items.${index}.exerciseId`;
      if (!exercise) details.push({ field, code: DETAIL_CODES.UNKNOWN_ID, issue: 'is not an exercise in the library' });
      else if (!exercise.active) details.push({ field, code: DETAIL_CODES.NOT_ALLOWED, issue: 'is a deactivated exercise' });
    });
    if (details.length) throw new ValidationFailedException(details);
  }

  /** Request items as stored. An exercise already in the plan keeps its itemId. */
  private toItems(items: PlanItemDto[], before: StoredItem[]): StoredItem[] {
    const existing = new Map(before.map((item) => [item.exerciseId, item.itemId]));
    return items.map((item) => {
      const exerciseId = item.exerciseId.toLowerCase();
      const target = item.target
        ? { sets: item.target.sets ?? null, reps: item.target.reps ?? null, durationMin: item.target.durationMin ?? null }
        : null;
      return {
        itemId: existing.get(exerciseId) ?? new Types.ObjectId().toHexString(),
        exerciseId,
        schedule: {
          daysOfWeek: [...item.schedule.daysOfWeek].sort((a, b) => a - b),
          timesPerDay: item.schedule.timesPerDay,
        },
        target: target && Object.values(target).some((value) => value !== null) ? target : null,
        notes: item.notes || null,
      };
    });
  }

  private async respond(patientId: string, plan: ExercisePlanDocument | null, timeZone?: string): Promise<PlanResponse> {
    if (!plan) return { patientId, version: 0, items: [], assignedBy: null, updatedAt: null };

    const exercises = await this.exercises.responsesByIds(plan.items.map((item) => item.exerciseId));
    const zone = timeZone ?? (await this.zoneOf(patientId));
    return {
      patientId,
      version: plan.version,
      items: plan.items.map((item) => {
        const stored = toStoredItem(item);
        const exercise = exercises.get(stored.exerciseId);
        if (!exercise) throw new NotFoundException(`Exercise ${stored.exerciseId} in the plan no longer exists`);
        return {
          itemId: stored.itemId,
          exercise: {
            id: exercise.id,
            name: exercise.name,
            category: exercise.category,
            description: exercise.description,
            instructions: exercise.instructions,
            video: exercise.video,
            active: exercise.active,
          },
          schedule: stored.schedule,
          target: stored.target,
          notes: stored.notes,
        };
      }),
      assignedBy: { id: String(plan.assignedById), name: plan.assignedByName },
      updatedAt: this.day.toLocalIso(plan.createdAt, zone),
    };
  }

  private async zoneOf(patientId: string): Promise<string> {
    const patient = await this.users.getPatient(patientId);
    if (!patient) throw new NotFoundException('Patient not found');
    return patient.timeZone;
  }

  private recordView(doctor: AuthUser, patientId: string, resourceId: string | null): Promise<void> {
    return this.audit.record({
      actor: doctor,
      action: AUDIT_ACTIONS.EXERCISE_PLAN_VIEWED,
      patientId,
      resourceId,
    });
  }
}

function toStoredItem(item: PlanItem): StoredItem {
  return {
    itemId: item.itemId,
    exerciseId: String(item.exerciseId),
    schedule: { daysOfWeek: [...item.schedule.daysOfWeek], timesPerDay: item.schedule.timesPerDay },
    target: item.target
      ? { sets: item.target.sets ?? null, reps: item.target.reps ?? null, durationMin: item.target.durationMin ?? null }
      : null,
    notes: item.notes ?? null,
  };
}

function sameItems(a: StoredItem[], b: StoredItem[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
