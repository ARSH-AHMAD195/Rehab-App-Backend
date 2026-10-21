import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AUDIT_ACTIONS, DEFAULT_COMPLIANCE_DAYS, DETAIL_CODES, MAX_COMPLIANCE_DAYS } from '../common/constants';
import { NotFoundException, ValidationFailedException } from '../common/api.exception';
import { AuditService } from '../audit/audit.service';
import { DayService } from '../time/day.service';
import { AuthUser, UsersService } from '../users/users.service';
import { ExercisesService } from '../exercises/exercises.service';
import { PlansService } from '../plans/plans.service';
import { ExercisePlanDocument } from '../plans/plan.schema';
import { ExerciseCompletion } from './completion.schema';
import { ComplianceExerciseResponse, ComplianceQueryDto, ComplianceResponse } from './compliance.dto';

/**
 * GET /patients/:patientId/exercise-compliance: planned against done, per
 * day and per exercise, as counts.
 *
 * Each day is counted against the plan in place when that day ended - the
 * same rule as the checklist - so the numbers here always match what the
 * checklist showed for those days. A tick counts at most timesPerDay times
 * per item per day.
 *
 * ⏳ The percentage stays null until the client agrees how it's worked out
 * (e.g. whether today, still in progress, counts; whether some exercises
 * weigh more).
 */
@Injectable()
export class ComplianceService {
  constructor(
    @InjectModel(ExerciseCompletion.name) private readonly completions: Model<ExerciseCompletion>,
    private readonly plans: PlansService,
    private readonly exercises: ExercisesService,
    private readonly users: UsersService,
    private readonly day: DayService,
    private readonly audit: AuditService,
  ) {}

  async forDoctor(patientId: string, query: ComplianceQueryDto, doctor: AuthUser): Promise<ComplianceResponse> {
    const patient = await this.users.getPatient(patientId);
    if (!patient) throw new NotFoundException('Patient not found');
    const { from, to } = this.checkedRange(patient.timeZone, query);

    const dates = this.datesBetween(from, to);
    const versions = await this.plans.versionsBetween(
      patientId,
      this.day.startOfDay(from, patient.timeZone),
      this.day.startOfDay(this.day.shift(to, 1), patient.timeZone),
    );
    const ticks = await this.ticksByDayAndItem(patientId, from, to);

    const byDay: ComplianceResponse['byDay'] = [];
    const byItem = new Map<string, { exerciseId: string; planned: number; done: number }>();

    let index = -1;
    for (const date of dates) {
      // Move on to the newest version saved before this day ended.
      const dayEnds = this.day.startOfDay(this.day.shift(date, 1), patient.timeZone);
      while (index + 1 < versions.length && versions[index + 1].createdAt < dayEnds) index++;
      const plan: ExercisePlanDocument | undefined = versions[index];

      let planned = 0;
      let done = 0;
      const weekday = this.day.dayOfWeek(date);
      for (const item of plan?.items ?? []) {
        if (!item.schedule.daysOfWeek.includes(weekday)) continue;
        const times = item.schedule.timesPerDay;
        const count = Math.min(ticks.get(`${date}|${item.itemId}`) ?? 0, times);
        planned += times;
        done += count;

        const totals = byItem.get(item.itemId) ?? { exerciseId: String(item.exerciseId), planned: 0, done: 0 };
        totals.planned += times;
        totals.done += count;
        byItem.set(item.itemId, totals);
      }
      byDay.push({ date, planned, done });
    }

    const names = await this.exercises.responsesByIds([...byItem.values()].map((totals) => new Types.ObjectId(totals.exerciseId)));
    const byExercise: ComplianceExerciseResponse[] = [...byItem.entries()].map(([itemId, totals]) => ({
      itemId,
      exerciseId: totals.exerciseId,
      name: names.get(totals.exerciseId)?.name ?? '',
      planned: totals.planned,
      done: totals.done,
    }));

    await this.audit.record({ actor: doctor, action: AUDIT_ACTIONS.EXERCISE_PLAN_VIEWED, patientId });

    return {
      from,
      to,
      planned: byDay.reduce((sum, day) => sum + day.planned, 0),
      done: byDay.reduce((sum, day) => sum + day.done, 0),
      percentage: null,
      byDay,
      byExercise,
    };
  }

  /** Last 7 days by default; never past the patient's today; at most 90 days. */
  private checkedRange(timeZone: string, query: ComplianceQueryDto): { from: string; to: string } {
    const today = this.day.today(timeZone);
    if (query.to && query.to > today) {
      throw new ValidationFailedException([
        { field: 'to', code: DETAIL_CODES.OUT_OF_RANGE, issue: `must not be after the patient's today (${today})` },
      ]);
    }
    const range = this.day.range(timeZone, DEFAULT_COMPLIANCE_DAYS, query.from, query.to);
    if (this.datesBetween(range.from, range.to).length > MAX_COMPLIANCE_DAYS) {
      throw new ValidationFailedException([
        { field: 'from', code: DETAIL_CODES.OUT_OF_RANGE, issue: `the range can be at most ${MAX_COMPLIANCE_DAYS} days` },
      ]);
    }
    return range;
  }

  /** Active ticks in the range, counted per "date|itemId". */
  private async ticksByDayAndItem(patientId: string, from: string, to: string): Promise<Map<string, number>> {
    const rows = await this.completions.aggregate<{ _id: { date: string; itemId: string }; count: number }>([
      { $match: { patientId: new Types.ObjectId(patientId), active: true, date: { $gte: from, $lte: to } } },
      { $group: { _id: { date: '$date', itemId: '$itemId' }, count: { $sum: 1 } } },
    ]);
    return new Map(rows.map((row) => [`${row._id.date}|${row._id.itemId}`, row.count]));
  }

  private datesBetween(from: string, to: string): string[] {
    const dates: string[] = [];
    // Bounded so a far-apart from/to can't build a huge list before the size check.
    for (let date = from; date <= to && dates.length <= MAX_COMPLIANCE_DAYS; date = this.day.shift(date, 1)) {
      dates.push(date);
    }
    return dates;
  }
}
