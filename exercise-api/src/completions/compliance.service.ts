import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AUDIT_ACTIONS, COMPLETION_STATUS, DEFAULT_COMPLIANCE_DAYS, DETAIL_CODES, MAX_COMPLIANCE_DAYS } from '../common/constants';
import { NotFoundException, ValidationFailedException } from '../common/api.exception';
import { AuditService } from '../audit/audit.service';
import { DayService } from '../time/day.service';
import { AuthUser, UsersService } from '../users/users.service';
import { ExercisesService } from '../exercises/exercises.service';
import { PlansService } from '../plans/plans.service';
import { ExercisePlanDocument } from '../plans/plan.schema';
import { ExerciseCompletion } from './completion.schema';
import {
  CaseloadQueryDto,
  CaseloadResponse,
  ComplianceDayResponse,
  ComplianceExerciseResponse,
  ComplianceQueryDto,
  ComplianceResponse,
} from './compliance.dto';

type ItemTotals = { exerciseId: string; planned: number; done: number; skipped: number };

/**
 * GET /patients/:patientId/exercise-compliance: planned against done (and
 * skipped), per day and per exercise, as counts. GET /doctor/exercise-compliance
 * gives the same totals for each of a doctor's patients.
 *
 * Each day is counted against the plan in place when that day ended - the
 * same rule as the checklist - so the numbers here always match what the
 * checklist showed for those days. A tick counts at most timesPerDay times
 * per item per day. A skip counts the planned times that day left undone.
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

    const { byDay, byItem } = await this.count(patientId, patient.timeZone, from, to);

    const names = await this.exercises.responsesByIds([...byItem.values()].map((totals) => new Types.ObjectId(totals.exerciseId)));
    const byExercise: ComplianceExerciseResponse[] = [...byItem.entries()].map(([itemId, totals]) => ({
      itemId,
      exerciseId: totals.exerciseId,
      name: names.get(totals.exerciseId)?.name ?? '',
      planned: totals.planned,
      done: totals.done,
      skipped: totals.skipped,
    }));

    await this.audit.record({ actor: doctor, action: AUDIT_ACTIONS.EXERCISE_PLAN_VIEWED, patientId });

    return { from, to, ...sum(byDay), percentage: null, byDay, byExercise };
  }

  /**
   * GET /doctor/exercise-compliance: every linked patient's last `days` days,
   * each ending on that patient's own today, plus today so far and when they
   * last ticked or skipped. Each patient viewed is audited, as on the
   * one-patient route.
   */
  async caseload(doctor: AuthUser, query: CaseloadQueryDto): Promise<CaseloadResponse> {
    const days = query.days ?? DEFAULT_COMPLIANCE_DAYS;
    const patients = await this.users.patientsOf(doctor.id);

    const data = await Promise.all(
      patients.map(async (patient) => {
        const to = this.day.today(patient.timeZone);
        const from = this.day.shift(to, -(days - 1));
        const [{ byDay }, last] = await Promise.all([
          this.count(patient.id, patient.timeZone, from, to),
          this.completions
            .findOne({ patientId: new Types.ObjectId(patient.id), active: true }, { completedAt: 1 })
            .sort({ completedAt: -1 })
            .lean(),
        ]);
        const { date: _date, ...today } = byDay[byDay.length - 1];
        return {
          patient: { id: patient.id, name: patient.name },
          from,
          to,
          ...sum(byDay),
          percentage: null,
          today,
          lastActivityAt: this.day.toLocalIso(last?.completedAt, patient.timeZone),
        };
      }),
    );

    for (const patient of patients) {
      await this.audit.record({ actor: doctor, action: AUDIT_ACTIONS.EXERCISE_PLAN_VIEWED, patientId: patient.id });
    }
    return { days, data };
  }

  /** Planned, done and skipped for each day from `from` to `to`, and per plan item. */
  private async count(
    patientId: string,
    timeZone: string,
    from: string,
    to: string,
  ): Promise<{ byDay: ComplianceDayResponse[]; byItem: Map<string, ItemTotals> }> {
    const dates = this.datesBetween(from, to);
    const versions = await this.plans.versionsBetween(
      patientId,
      this.day.startOfDay(from, timeZone),
      this.day.startOfDay(this.day.shift(to, 1), timeZone),
    );
    const { ticks, skips } = await this.byDayAndItem(patientId, from, to);

    const byDay: ComplianceDayResponse[] = [];
    const byItem = new Map<string, ItemTotals>();

    let index = -1;
    for (const date of dates) {
      // Move on to the newest version saved before this day ended.
      const dayEnds = this.day.startOfDay(this.day.shift(date, 1), timeZone);
      while (index + 1 < versions.length && versions[index + 1].createdAt < dayEnds) index++;
      const plan: ExercisePlanDocument | undefined = versions[index];

      let planned = 0;
      let done = 0;
      let skipped = 0;
      const weekday = this.day.dayOfWeek(date);
      for (const item of plan?.items ?? []) {
        if (!item.schedule.daysOfWeek.includes(weekday)) continue;
        const key = `${date}|${item.itemId}`;
        const times = item.schedule.timesPerDay;
        const count = Math.min(ticks.get(key) ?? 0, times);
        const left = skips.has(key) ? times - count : 0;
        planned += times;
        done += count;
        skipped += left;

        const totals = byItem.get(item.itemId) ?? { exerciseId: String(item.exerciseId), planned: 0, done: 0, skipped: 0 };
        totals.planned += times;
        totals.done += count;
        totals.skipped += left;
        byItem.set(item.itemId, totals);
      }
      byDay.push({ date, planned, done, skipped });
    }
    return { byDay, byItem };
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

  /** Active ticks in the range counted per "date|itemId", and the "date|itemId"s that were skipped. */
  private async byDayAndItem(
    patientId: string,
    from: string,
    to: string,
  ): Promise<{ ticks: Map<string, number>; skips: Set<string> }> {
    const rows = await this.completions.aggregate<{ _id: { date: string; itemId: string; skipped: boolean }; count: number }>([
      { $match: { patientId: new Types.ObjectId(patientId), active: true, date: { $gte: from, $lte: to } } },
      {
        $group: {
          _id: { date: '$date', itemId: '$itemId', skipped: { $eq: ['$status', COMPLETION_STATUS.SKIPPED] } },
          count: { $sum: 1 },
        },
      },
    ]);
    const ticks = new Map<string, number>();
    const skips = new Set<string>();
    for (const row of rows) {
      const key = `${row._id.date}|${row._id.itemId}`;
      if (row._id.skipped) skips.add(key);
      else ticks.set(key, row.count);
    }
    return { ticks, skips };
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

function sum(days: ComplianceDayResponse[]): { planned: number; done: number; skipped: number } {
  return days.reduce(
    (total, day) => ({ planned: total.planned + day.planned, done: total.done + day.done, skipped: total.skipped + day.skipped }),
    { planned: 0, done: 0, skipped: 0 },
  );
}
