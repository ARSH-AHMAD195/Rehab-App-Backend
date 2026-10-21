import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { DateTime } from 'luxon';
import { FilterQuery, Model, Types } from 'mongoose';
import {
  AUDIT_ACTIONS,
  CHECKLIST_STATUS,
  DEFAULT_HISTORY_DAYS,
  DEFAULT_PAGE_LIMIT,
  DETAIL_CODES,
  EVENT_TYPES,
} from '../common/constants';
import {
  DayChangedException,
  ExerciseAlreadyDoneException,
  ExerciseNotInPlanException,
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
import { PlansService } from '../plans/plans.service';
import { ExerciseCompletion, ExerciseCompletionDocument } from './completion.schema';
import {
  ChecklistResponse,
  CompletionListResponse,
  CompletionResponse,
  HistoryQueryDto,
  RecordCompletionDto,
} from './completion.dto';

@Injectable()
export class CompletionsService implements OnModuleInit {
  constructor(
    @InjectModel(ExerciseCompletion.name) private readonly model: Model<ExerciseCompletion>,
    private readonly plans: PlansService,
    private readonly exercises: ExercisesService,
    private readonly users: UsersService,
    private readonly day: DayService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly tx: TransactionRunner,
  ) {}

  /** The one-tick-per-slot index is what stops a planned time counting twice; wait for it. */
  async onModuleInit(): Promise<void> {
    await this.model.init();
  }

  /**
   * POST /exercise-completions: "I did this one". Checks, in order:
   *  1. the item is in the patient's current plan          -> 409 EXERCISE_NOT_IN_PLAN
   *  2. `date` is the patient's today                      -> 409 DAY_CHANGED
   *  3. the item is planned for today's day of the week    -> 409 EXERCISE_NOT_IN_PLAN
   *  4. it hasn't been done timesPerDay times today yet    -> 409 EXERCISE_ALREADY_DONE
   */
  async record(patient: AuthUser, dto: RecordCompletionDto): Promise<CompletionResponse> {
    const today = this.day.today(patient.timeZone);

    const saved = await this.tx.run(async (session) => {
      // Read inside the transaction, so a plan change made at this moment
      // can't slip between the check and the save.
      const plan = await this.plans.current(patient.id, session);
      const item = plan?.items.find((planned) => planned.itemId === dto.itemId);
      if (!plan || !item) throw new ExerciseNotInPlanException();

      if (dto.date !== today) {
        throw new DayChangedException(
          `The date sent (${dto.date}) is no longer your today (${today}). Reload today's checklist.`,
        );
      }
      if (!item.schedule.daysOfWeek.includes(this.day.dayOfWeek(today))) {
        throw new ExerciseNotInPlanException("This exercise isn't planned for today.");
      }

      const taken = await this.model
        .find({ patientId: new Types.ObjectId(patient.id), date: today, itemId: item.itemId, active: true }, { slot: 1 })
        .session(session)
        .lean();
      const used = new Set(taken.map((done) => done.slot));
      const slot = Array.from({ length: item.schedule.timesPerDay }, (_, i) => i).find((i) => !used.has(i));
      // ⏳ Extra completions: refused beyond the planned number until the client says otherwise.
      if (slot === undefined) throw new ExerciseAlreadyDoneException(item.schedule.timesPerDay);

      const details = dto.details ? { durationMin: dto.details.durationMin ?? null, note: dto.details.note || null } : null;
      const [completion] = await this.model.create(
        [
          {
            patientId: new Types.ObjectId(patient.id),
            itemId: item.itemId,
            exerciseId: item.exerciseId,
            planVersion: plan.version,
            date: today,
            slot,
            completedAt: new Date(),
            details: details && (details.durationMin !== null || details.note !== null) ? details : null,
          },
        ],
        { session },
      );

      await this.audit.record(
        {
          actor: patient,
          action: AUDIT_ACTIONS.EXERCISE_COMPLETION_RECORDED,
          patientId: patient.id,
          resourceId: String(completion._id),
          after: { itemId: completion.itemId, exerciseId: String(completion.exerciseId), date: today, details: completion.details },
        },
        session,
      );
      await this.outbox.enqueue(
        [
          {
            type: EVENT_TYPES.COMPLETED,
            patientId: patient.id,
            occurredAt: completion.completedAt,
            data: {
              completionId: String(completion._id),
              itemId: completion.itemId,
              exerciseId: String(completion.exerciseId),
              planVersion: completion.planVersion,
              date: today,
            },
          },
        ],
        session,
      );
      return completion;
    });

    return (await this.respond([saved], patient.timeZone))[0];
  }

  /** DELETE /exercise-completions/:id. ⏳ Edit and undo: same day only, until the client decides. */
  async undo(patient: AuthUser, completionId: string): Promise<void> {
    const filter = Types.ObjectId.isValid(completionId)
      ? { _id: new Types.ObjectId(completionId), patientId: new Types.ObjectId(patient.id), active: true }
      : null;
    // Someone else's tick looks the same as one that doesn't exist.
    const completion = filter ? await this.model.findOne(filter).lean() : null;
    if (!filter || !completion) throw new NotFoundException('Completion not found');

    const today = this.day.today(patient.timeZone);
    if (completion.date !== today) {
      throw new DayChangedException(`Only today's ticks can be undone; this one is from ${completion.date}.`);
    }

    await this.tx.run(async (session) => {
      const undone = await this.model
        .updateOne(filter, { $set: { active: false, undoneAt: new Date() } }, { session })
        .exec();
      // Undone by another request in the meantime.
      if (undone.modifiedCount !== 1) throw new NotFoundException('Completion not found');

      await this.audit.record(
        {
          actor: patient,
          action: AUDIT_ACTIONS.EXERCISE_COMPLETION_UNDONE,
          patientId: patient.id,
          resourceId: completionId,
          before: { itemId: completion.itemId, exerciseId: String(completion.exerciseId), date: completion.date },
        },
        session,
      );
      await this.outbox.enqueue(
        [
          {
            type: EVENT_TYPES.COMPLETION_UNDONE,
            patientId: patient.id,
            data: { completionId, itemId: completion.itemId, date: completion.date },
          },
        ],
        session,
      );
    });
  }

  /** The patient's own checklist for today. */
  myChecklist(patient: AuthUser): Promise<ChecklistResponse> {
    return this.checklist(patient.id, this.day.today(patient.timeZone), patient.timeZone);
  }

  /** A doctor's view of one day, today by default. Audited. */
  async checklistForDoctor(patientId: string, date: string | undefined, doctor: AuthUser): Promise<ChecklistResponse> {
    const timeZone = await this.zoneOf(patientId);
    const today = this.day.today(timeZone);
    if (date && date > today) {
      throw new ValidationFailedException([
        { field: 'date', code: DETAIL_CODES.OUT_OF_RANGE, issue: `must not be after the patient's today (${today})` },
      ]);
    }
    const checklist = await this.checklist(patientId, date ?? today, timeZone);
    await this.recordView(doctor, patientId);
    return checklist;
  }

  myHistory(patient: AuthUser, query: HistoryQueryDto): Promise<CompletionListResponse> {
    return this.history(patient.id, patient.timeZone, query);
  }

  async historyForDoctor(patientId: string, query: HistoryQueryDto, doctor: AuthUser): Promise<CompletionListResponse> {
    const history = await this.history(patientId, await this.zoneOf(patientId), query);
    await this.recordView(doctor, patientId);
    return history;
  }

  /**
   * What was planned on a day and how much of it was done. Uses the plan that
   * applied that day, so an old day still shows what was planned then.
   */
  private async checklist(patientId: string, date: string, timeZone: string): Promise<ChecklistResponse> {
    const plan = await this.plans.planOn(patientId, date, timeZone);
    if (!plan) return { date, planVersion: 0, items: [], doneCount: 0, plannedCount: 0 };

    const weekday = this.day.dayOfWeek(date);
    const planned = (await this.plans.itemsWithExercises(plan)).filter((item) =>
      item.schedule.daysOfWeek.includes(weekday),
    );

    const done = await this.model
      .find({ patientId: new Types.ObjectId(patientId), date, active: true })
      .sort({ completedAt: 1 })
      .lean();
    const byItem = new Map<string, typeof done>();
    for (const completion of done) {
      byItem.set(completion.itemId, [...(byItem.get(completion.itemId) ?? []), completion]);
    }

    const items = planned.map((item) => {
      const ticks = byItem.get(item.itemId) ?? [];
      const times = item.schedule.timesPerDay;
      // A tick made before the doctor lowered timesPerDay still shows, but
      // can't push the count past what is now planned.
      const doneCount = Math.min(ticks.length, times);
      return {
        itemId: item.itemId,
        exercise: item.exercise,
        timesPerDay: times,
        doneCount,
        status:
          doneCount === 0 ? CHECKLIST_STATUS.NOT_YET : doneCount < times ? CHECKLIST_STATUS.PARTLY_DONE : CHECKLIST_STATUS.DONE,
        completions: ticks.map((tick) => ({ id: String(tick._id), completedAt: this.day.toLocalIso(tick.completedAt, timeZone)! })),
        target: item.target,
        notes: item.notes,
      };
    });

    return {
      date,
      planVersion: plan.version,
      items,
      doneCount: items.reduce((sum, item) => sum + item.doneCount, 0),
      plannedCount: items.reduce((sum, item) => sum + item.timesPerDay, 0),
    };
  }

  /** Ticks between two local dates, newest first, a page at a time. Undone ticks are left out. */
  private async history(patientId: string, timeZone: string, query: HistoryQueryDto): Promise<CompletionListResponse> {
    const { from, to } = this.day.range(timeZone, DEFAULT_HISTORY_DAYS, query.from, query.to);
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;

    const and: FilterQuery<ExerciseCompletion>[] = [
      { patientId: new Types.ObjectId(patientId), active: true, date: { $gte: from, $lte: to } },
    ];
    if (query.cursor) {
      const { k, id } = decodeCursor(query.cursor);
      const at = DateTime.fromISO(k);
      if (!at.isValid) {
        throw new ValidationFailedException([
          { field: 'cursor', code: DETAIL_CODES.WRONG_SHAPE, issue: 'is not a cursor returned by this API' },
        ]);
      }
      const after = new Types.ObjectId(id);
      and.push({
        $or: [{ completedAt: { $lt: at.toJSDate() } }, { completedAt: at.toJSDate(), _id: { $lt: after } }],
      });
    }

    const rows = await this.model
      .find({ $and: and })
      .sort({ completedAt: -1, _id: -1 })
      .limit(limit + 1)
      .exec();
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      data: await this.respond(page, timeZone),
      nextCursor:
        rows.length > limit && last ? encodeCursor({ k: last.completedAt.toISOString(), id: String(last._id) }) : null,
    };
  }

  private async respond(rows: ExerciseCompletionDocument[], timeZone: string): Promise<CompletionResponse[]> {
    const exercises = await this.exercises.responsesByIds(rows.map((row) => row.exerciseId));
    return rows.map((row) => {
      const exercise = exercises.get(String(row.exerciseId));
      return {
        id: String(row._id),
        itemId: row.itemId,
        exercise: { id: String(row.exerciseId), name: exercise?.name ?? '', category: exercise?.category ?? '' },
        planVersion: row.planVersion,
        date: row.date,
        completedAt: this.day.toLocalIso(row.completedAt, timeZone)!,
        details: row.details ? { durationMin: row.details.durationMin, note: row.details.note } : null,
      };
    });
  }

  private async zoneOf(patientId: string): Promise<string> {
    const patient = await this.users.getPatient(patientId);
    if (!patient) throw new NotFoundException('Patient not found');
    return patient.timeZone;
  }

  /** Reference section 6: a doctor viewing a patient's checklist or history is recorded. */
  private recordView(doctor: AuthUser, patientId: string): Promise<void> {
    return this.audit.record({ actor: doctor, action: AUDIT_ACTIONS.EXERCISE_PLAN_VIEWED, patientId });
  }
}
