import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { DateTime } from 'luxon';
import { Model, Types } from 'mongoose';
import { AUDIT_ACTIONS, DETAIL_CODES } from '../common/constants';
import { ConcurrentUpdateException, DayChangedException, ValidationFailedException } from '../common/api.exception';
import { TransactionRunner } from '../common/mongo/transaction.runner';
import { AuditService } from '../audit/audit.service';
import { DayService } from '../time/day.service';
import { AuthUser } from '../users/users.service';
import { DEFAULT_DIET_LABEL, DEFAULT_DIET_SLOTS, DEFAULT_DIET_TYPE, DEFAULT_TARGETS, DietTargets, FoodOption, MealSlot, Text } from './diet-chart';
import { MealsQueryDto, SaveMealDto, UpdateDietPlanDto } from './nutrition.dto';
import { checkPlan, dayTotals, percentOf, slotIntake } from './nutrition-rules';
import { MealLog, MealLogDocument, PatientDietPlan, StoredMealSlot } from './nutrition.schema';

export interface DietPlanResponse {
  patientId: string;
  dietType: string;
  dietLabel: Text;
  targets: DietTargets;
  slots: MealSlot[];
  /** 0 = the hospital chart, not yet changed for this patient. */
  version: number;
  updatedAt: string | null;
  updatedBy: { id: string; role: string } | null;
}

export interface MealDayResponse {
  date: string;
  timeZone: string;
  dietType: string;
  dietLabel: Text;
  targets: DietTargets;
  totals: { kcal: number; proteinG: number; slotsEaten: number };
  /** Whole percent of each target, for the progress bar. */
  percent: { kcal: number | null; protein: number | null };
  planVersion: number;
  slots: (MealSlot & { eaten: boolean; options: (FoodOption & { ticked: boolean })[]; loggedAt: string | null })[];
}

export interface MealHistoryDay {
  date: string;
  logged: boolean;
  totals: { kcal: number; proteinG: number; slotsEaten: number } | null;
  targets: DietTargets | null;
  percent: { kcal: number | null; protein: number | null } | null;
}

const MAX_HISTORY_DAYS = 90;
const DEFAULT_HISTORY_DAYS = 7;

type Plan = Omit<DietPlanResponse, 'updatedAt' | 'updatedBy' | 'patientId'> & { updatedAt: Date | null; updatedBy: { id: Types.ObjectId; role: string } | null };

/**
 * Nutrition module (client change request, Nov 2026, section 5): the hospital
 * diet chart, the patient ticking what they ate in each meal slot, and the
 * day's calories and protein against the target. Lives next to the vitals
 * daily log and follows the same day rules: "today" is the patient's own
 * date, only today can be changed, past days stay as they were.
 */
@Injectable()
export class NutritionService {
  constructor(
    @InjectModel(PatientDietPlan.name) private readonly plans: Model<PatientDietPlan>,
    @InjectModel(MealLog.name) private readonly logs: Model<MealLog>,
    private readonly day: DayService,
    private readonly audit: AuditService,
    private readonly tx: TransactionRunner,
  ) {}

  // ---------------------------------------------------------------- the plan

  async plan(patient: AuthUser): Promise<DietPlanResponse> {
    return this.planResponse(patient, await this.currentPlan(patient.id));
  }

  /** A doctor's read of the plan: audited, and a failed audit fails the call. */
  async planAsDoctor(doctor: AuthUser, patient: AuthUser): Promise<DietPlanResponse> {
    await this.viewed(doctor, patient);
    return this.plan(patient);
  }

  /**
   * PATCH /doctor/patients/:patientId/diet-plan. The first save copies the
   * hospital chart and applies the change; later saves change the copy.
   */
  async updatePlan(doctor: AuthUser, patient: AuthUser, dto: UpdateDietPlanDto): Promise<DietPlanResponse> {
    const details = checkPlan(dto.slots as MealSlot[] | undefined, dto.targets);
    if (details.length) throw new ValidationFailedException(details);

    const current = await this.currentPlan(patient.id);
    if (current.version !== dto.version) {
      throw new ConcurrentUpdateException('The diet plan was changed by someone else. Reload and retry.');
    }

    const next = {
      dietType: dto.dietType ?? current.dietType,
      dietLabel: dto.dietLabel ? { en: dto.dietLabel.en, hi: dto.dietLabel.hi ?? null } : current.dietLabel,
      targets: dto.targets ? { kcal: dto.targets.kcal, proteinG: dto.targets.proteinG } : current.targets,
      slots: dto.slots ? (JSON.parse(JSON.stringify(dto.slots)) as MealSlot[]).map(normaliseSlot) : current.slots,
    };
    const before = { dietType: current.dietType, targets: current.targets, slots: current.slots };
    if (JSON.stringify(before) === JSON.stringify({ dietType: next.dietType, targets: next.targets, slots: next.slots }) &&
        JSON.stringify(current.dietLabel) === JSON.stringify(next.dietLabel)) {
      return this.planResponse(patient, current);
    }

    const updatedBy = { id: new Types.ObjectId(doctor.id), role: doctor.role };
    await this.tx.run(async (session) => {
      if (dto.version === 0) {
        await this.plans.create([{ patientId: new Types.ObjectId(patient.id), ...next, version: 1, updatedBy }], { session });
      } else {
        const saved = await this.plans
          .findOneAndUpdate(
            { patientId: new Types.ObjectId(patient.id), version: dto.version },
            { $set: { ...next, updatedBy }, $inc: { version: 1 } },
            { new: true, session },
          )
          .exec();
        if (!saved) throw new ConcurrentUpdateException('The diet plan was changed by someone else. Reload and retry.');
      }
      await this.audit.record(
        { actor: doctor, action: AUDIT_ACTIONS.DIET_PLAN_CHANGED, patientId: patient.id, resourceId: patient.id, before, after: next },
        session,
      );
    }, 0);
    return this.plan(patient);
  }

  // ---------------------------------------------------------------- meals

  async today(patient: AuthUser): Promise<MealDayResponse> {
    const today = this.day.today(patient.timeZone);
    const [plan, log] = await Promise.all([
      this.currentPlan(patient.id),
      this.logs.findOne({ patientId: new Types.ObjectId(patient.id), date: today }).exec(),
    ]);
    return this.dayResponse(patient, today, plan, log);
  }

  async todayAsDoctor(doctor: AuthUser, patient: AuthUser): Promise<MealDayResponse> {
    await this.viewed(doctor, patient);
    return this.today(patient);
  }

  /**
   * PUT /me/meals/today/:slot. Sets what was eaten in one slot; [] clears it.
   * Re-sending the same choice changes nothing, so app retries are safe.
   */
  async saveMeal(patient: AuthUser, slotCode: string, dto: SaveMealDto): Promise<MealDayResponse> {
    const today = this.day.today(patient.timeZone);
    if (dto.date !== today) throw new DayChangedException(dto.date, today);

    const plan = await this.currentPlan(patient.id);
    const slot = plan.slots.find((s) => s.code === slotCode);
    if (!slot) {
      throw new ValidationFailedException([{ field: 'slot', code: DETAIL_CODES.UNKNOWN_TYPE, issue: `"${slotCode}" is not a meal slot in this diet plan` }]);
    }
    const unknown = dto.optionCodes.filter((code) => !slot.options.some((o) => o.code === code));
    if (unknown.length) {
      throw new ValidationFailedException(
        unknown.map((code) => ({ field: 'optionCodes', code: DETAIL_CODES.UNKNOWN_TYPE, issue: `"${code}" is not an option in ${slotCode}` })),
      );
    }
    // Keep the plan's order, whatever order the app sent them in.
    const optionCodes = slot.options.map((o) => o.code).filter((code) => dto.optionCodes.includes(code));

    const saved = await this.tx.run(async (session) => {
      const patientId = new Types.ObjectId(patient.id);
      const existing = await this.logs.findOne({ patientId, date: today }).session(session).exec();
      const slots: Record<string, StoredMealSlot> = { ...(existing?.slots ?? {}) };
      const before = slots[slotCode]?.optionCodes ?? [];
      if (JSON.stringify(before) === JSON.stringify(optionCodes)) return existing;

      const intake = slotIntake(slot, optionCodes);
      slots[slotCode] = { optionCodes, ...intake, loggedAt: optionCodes.length ? new Date() : null };
      const totals = dayTotals(Object.values(slots));

      const doc = await this.logs
        .findOneAndUpdate(
          { patientId, date: today },
          { $set: { slots, totals, targets: plan.targets, planVersion: plan.version, timeZone: patient.timeZone } },
          { upsert: true, new: true, session },
        )
        .exec();
      await this.audit.record(
        {
          actor: patient,
          action: AUDIT_ACTIONS.MEAL_LOG_CHANGED,
          patientId: patient.id,
          resourceId: String(doc._id),
          before: { slot: slotCode, optionCodes: before },
          after: { slot: slotCode, optionCodes },
        },
        session,
      );
      return doc;
    });
    return this.dayResponse(patient, today, plan, saved);
  }

  /** GET /me/meals: one row per day, newest first, with the totals against that day's targets. */
  async history(patient: AuthUser, query: MealsQueryDto): Promise<{ data: MealHistoryDay[] }> {
    const to = query.to ?? this.day.today(patient.timeZone);
    const from = query.from ?? this.day.shift(to, -(DEFAULT_HISTORY_DAYS - 1));
    this.day.assertRangeOrder(from, to);
    if (DateTime.fromISO(to).diff(DateTime.fromISO(from), 'days').days >= MAX_HISTORY_DAYS) {
      throw new ValidationFailedException([{ field: 'from', code: DETAIL_CODES.OUT_OF_RANGE, issue: `at most ${MAX_HISTORY_DAYS} days at a time` }]);
    }

    const logs = await this.logs.find({ patientId: new Types.ObjectId(patient.id), date: { $gte: from, $lte: to } }).lean();
    const byDate = new Map(logs.map((l) => [l.date, l]));
    const data: MealHistoryDay[] = [];
    for (let date = to; date >= from; date = this.day.shift(date, -1)) {
      const log = byDate.get(date);
      data.push(
        log
          ? {
              date,
              logged: log.totals.slotsEaten > 0,
              totals: log.totals,
              targets: log.targets,
              percent: { kcal: percentOf(log.totals.kcal, log.targets.kcal), protein: percentOf(log.totals.proteinG, log.targets.proteinG) },
            }
          : { date, logged: false, totals: null, targets: null, percent: null },
      );
    }
    return { data };
  }

  async historyAsDoctor(doctor: AuthUser, patient: AuthUser, query: MealsQueryDto): Promise<{ data: MealHistoryDay[] }> {
    await this.viewed(doctor, patient);
    return this.history(patient, query);
  }

  // ---------------------------------------------------------------- helpers

  private async currentPlan(patientId: string): Promise<Plan> {
    const stored = await this.plans.findOne({ patientId: new Types.ObjectId(patientId) }).lean();
    if (stored) {
      return {
        dietType: stored.dietType,
        dietLabel: stored.dietLabel,
        targets: stored.targets,
        slots: stored.slots,
        version: stored.version,
        updatedAt: stored.updatedAt ?? null,
        updatedBy: stored.updatedBy ?? null,
      };
    }
    return {
      dietType: DEFAULT_DIET_TYPE,
      dietLabel: DEFAULT_DIET_LABEL,
      targets: DEFAULT_TARGETS,
      slots: DEFAULT_DIET_SLOTS,
      version: 0,
      updatedAt: null,
      updatedBy: null,
    };
  }

  private planResponse(patient: AuthUser, plan: Plan): DietPlanResponse {
    return {
      patientId: patient.id,
      dietType: plan.dietType,
      dietLabel: plan.dietLabel,
      targets: plan.targets,
      slots: plan.slots,
      version: plan.version,
      updatedAt: this.day.toLocalIso(plan.updatedAt, patient.timeZone),
      updatedBy: plan.updatedBy ? { id: String(plan.updatedBy.id), role: plan.updatedBy.role } : null,
    };
  }

  private dayResponse(patient: AuthUser, date: string, plan: Plan, log: MealLogDocument | null): MealDayResponse {
    const stored = log?.slots ?? {};
    const totals = log?.totals ?? { kcal: 0, proteinG: 0, slotsEaten: 0 };
    // Today's own targets once something is logged, else the plan's.
    const targets = log?.targets ?? plan.targets;
    return {
      date,
      timeZone: patient.timeZone,
      dietType: plan.dietType,
      dietLabel: plan.dietLabel,
      targets,
      totals,
      percent: { kcal: percentOf(totals.kcal, targets.kcal), protein: percentOf(totals.proteinG, targets.proteinG) },
      planVersion: plan.version,
      slots: plan.slots.map((slot) => {
        const ticked = stored[slot.code]?.optionCodes ?? [];
        return {
          ...slot,
          eaten: ticked.length > 0,
          loggedAt: this.day.toLocalIso(stored[slot.code]?.loggedAt ?? null, patient.timeZone),
          options: slot.options.map((o) => ({ ...o, ticked: ticked.includes(o.code) })),
        };
      }),
    };
  }

  private viewed(doctor: AuthUser, patient: AuthUser): Promise<void> {
    return this.audit.record({ actor: doctor, action: AUDIT_ACTIONS.PATIENT_NUTRITION_VIEWED, patientId: patient.id, resourceId: patient.id });
  }
}

/** Fills in a missing Hindi label as null, so stored slots always have the same shape. */
function normaliseSlot(slot: MealSlot): MealSlot {
  return {
    ...slot,
    label: { en: slot.label.en, hi: slot.label.hi ?? null },
    options: slot.options.map((o) => ({ ...o, label: { en: o.label.en, hi: o.label.hi ?? null } })),
  };
}
