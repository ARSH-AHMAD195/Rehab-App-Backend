import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { DateTime } from 'luxon';
import { Model, PipelineStage, Types } from 'mongoose';
import { AUDIT_ACTIONS, DETAIL_CODES, Role } from '../common/constants';
import { ErrorDetail, ValidationFailedException } from '../common/api.exception';
import { TransactionRunner } from '../common/mongo/transaction.runner';
import { DEFAULT_DISPLAY_TIME_ZONE, toLocalIso, todayIn } from '../common/time';
import { AuditService } from '../audit/audit.service';
import { Investigation, RESULT_STATUS } from '../investigations/investigation.schema';
import { MedicalProfile } from '../medical-profiles/medical-profile.schema';
import { UserDocument } from '../users/user.schema';
import {
  DEFAULT_TRIAGE_RULES,
  Dated,
  TriageEvaluation,
  TriageInputs,
  TriageRuleSet,
  TriageTag,
  evaluateTriage,
} from './triage-rules';
import { DailyLogView, TriageRules } from './triage.schema';

type Actor = { id: string; role: Role };

export interface TriageResult extends TriageEvaluation {
  /** True until the clinical team confirms the rules (see triageRules.confirmed). */
  provisional: boolean;
  /** No input was missing. */
  complete: boolean;
  rulesVersion: number;
  /** The patient's own date the tag was worked out for. */
  evaluatedOn: string;
}

/** What a patient list shows per row. */
export interface TriageSummary {
  tag: TriageTag;
  provisional: boolean;
  complete: boolean;
}

/** Investigations that feed triage, and the field each one gives. */
const FEEDS: { test: string; field: string; input: 'hb' | 'albumin' | 'must' | 'hba1c' | 'egfr' }[] = [
  { test: 'HB', field: 'value', input: 'hb' },
  { test: 'ALBUMIN', field: 'value', input: 'albumin' },
  { test: 'MUST', field: 'score', input: 'must' },
  { test: 'HBA1C', field: 'value', input: 'hba1c' },
  { test: 'CREATININE', field: 'egfr', input: 'egfr' },
];

/**
 * Works out each patient's triage tag from what is stored now: the medical
 * profile, the latest investigation results and the latest daily vitals.
 *
 * It is worked out on every read rather than saved, so it is never stale:
 * "the tag updates automatically whenever new values are entered", including
 * vitals saved through Health Monitoring. Each result carries the reasons and
 * the dated values behind them, and the rules version it used.
 */
@Injectable()
export class TriageService implements OnModuleInit {
  private readonly logger = new Logger(TriageService.name);

  constructor(
    @InjectModel(TriageRules.name) private readonly rulesModel: Model<TriageRules>,
    @InjectModel(MedicalProfile.name) private readonly profiles: Model<MedicalProfile>,
    @InjectModel(Investigation.name) private readonly investigations: Model<Investigation>,
    @InjectModel(DailyLogView.name) private readonly dailyLogs: Model<DailyLogView>,
    private readonly audit: AuditService,
    private readonly tx: TransactionRunner,
  ) {}

  /** Adds the client's table as version 1 the first time the app starts. */
  async onModuleInit(): Promise<void> {
    if (await this.rulesModel.exists({})) return;
    try {
      await this.rulesModel.create({ version: 1, rules: DEFAULT_TRIAGE_RULES, confirmed: false, isCurrent: true, updatedBy: null });
      this.logger.log('Added the triage rules from the client table as version 1 (not yet confirmed)');
    } catch (error) {
      // Another instance added it at the same moment.
      if ((error as { code?: number }).code !== 11000) throw error;
    }
  }

  async currentRules(): Promise<{ version: number; rules: TriageRuleSet; confirmed: boolean; updatedAt: Date | null }> {
    const row = await this.rulesModel.findOne({ isCurrent: true }).lean();
    if (!row) return { version: 0, rules: DEFAULT_TRIAGE_RULES, confirmed: false, updatedAt: null };
    return { version: row.version, rules: row.rules, confirmed: row.confirmed, updatedAt: row.updatedAt ?? null };
  }

  /** Full results for a set of patients, in a fixed number of queries. */
  async forPatients(patients: UserDocument[]): Promise<Map<string, TriageResult>> {
    if (!patients.length) return new Map();
    const current = await this.currentRules();
    const ids = patients.map((p) => p._id as Types.ObjectId);
    const todayOf = new Map(patients.map((p) => [String(p._id), todayIn(p.timeZone || DEFAULT_DISPLAY_TIME_ZONE)]));
    const earliest = [...todayOf.values()]
      .map((d) => DateTime.fromISO(d).minus({ days: current.rules.vitalsLookbackDays - 1 }).toISODate()!)
      .sort()[0];

    const [profiles, latest, logs] = await Promise.all([
      this.profiles.find({ patientId: { $in: ids } }).lean(),
      this.latestInvestigations(ids),
      this.dailyLogs
        .find(
          { patientId: { $in: ids }, date: { $gte: earliest } },
          { patientId: 1, date: 1, 'readings.BP.value': 1, 'readings.PULSE.value': 1 },
        )
        .sort({ date: -1 })
        .lean(),
    ]);
    const profileOf = new Map(profiles.map((p) => [String(p.patientId), p]));

    const results = new Map<string, TriageResult>();
    for (const patient of patients) {
      const id = String(patient._id);
      const today = todayOf.get(id)!;
      const from = DateTime.fromISO(today).minus({ days: current.rules.vitalsLookbackDays - 1 }).toISODate()!;
      const recent = logs.filter((l) => String(l.patientId) === id && l.date >= from && l.date <= today);
      const bpLog = recent.find((l) => isPair(l.readings?.BP?.value));
      const pulseLog = recent.find((l) => typeof l.readings?.PULSE?.value?.num === 'number');
      const profile = profileOf.get(id);
      const values = latest.get(id) ?? {};

      const inputs: TriageInputs = {
        today,
        dateOfBirth: profile?.dateOfBirth ?? null,
        hb: values.hb ?? null,
        albumin: values.albumin ?? null,
        must: values.must ?? null,
        hba1c: values.hba1c ?? null,
        egfr: values.egfr ?? null,
        bloodPressure: bpLog
          ? {
              value: { systolic: bpLog.readings.BP!.value!.systolic, diastolic: bpLog.readings.BP!.value!.diastolic },
              date: bpLog.date,
            }
          : null,
        heartRate: pulseLog ? { value: pulseLog.readings.PULSE!.value!.num, date: pulseLog.date } : null,
        conditions: profile?.conditions ?? null,
        smokingStatus: profile?.smokingStatus ?? null,
        smokingQuitDate: profile?.smokingQuitDate ?? null,
        hypertensionOnMedication: profile?.hypertensionOnMedication ?? null,
        ihdStatus: profile?.ihdStatus ?? null,
        lastMiOrStentDate: profile?.lastMiOrStentDate ?? null,
        canClimbTwoFlights: profile?.canClimbTwoFlights ?? null,
        chemotherapy: profile?.chemotherapy ?? null,
        lastChemoDate: profile?.lastChemoDate ?? null,
      };
      const evaluation = evaluateTriage(inputs, current.rules);
      results.set(id, {
        ...evaluation,
        provisional: !current.confirmed,
        complete: evaluation.missing.length === 0,
        rulesVersion: current.version,
        evaluatedOn: today,
      });
    }
    return results;
  }

  /** The short form for patient lists. */
  async summaries(patients: UserDocument[]): Promise<Map<string, TriageSummary>> {
    const full = await this.forPatients(patients);
    return new Map([...full].map(([id, r]) => [id, { tag: r.tag, provisional: r.provisional, complete: r.complete }]));
  }

  /** GET /patients/:patientId/triage: one patient, with reasons. The read is audited. */
  async forPatientAsDoctor(doctor: Actor, patient: UserDocument): Promise<TriageResult & { patientId: string }> {
    await this.audit.record({
      actor: doctor,
      action: AUDIT_ACTIONS.TRIAGE_VIEWED,
      patientId: patient._id,
      resourceId: String(patient._id),
    });
    const result = (await this.forPatients([patient])).get(String(patient._id))!;
    return { patientId: String(patient._id), ...result };
  }

  /**
   * PUT /admin/triage-rules: a new version of the rules. Old versions stay.
   * `confirmed` records that the clinical team has signed these numbers off.
   */
  async setRules(
    admin: Actor,
    rules: unknown,
    confirmed: boolean,
  ): Promise<{ version: number; rules: TriageRuleSet; confirmed: boolean; updatedAt: string | null }> {
    const checked = checkRuleSet(rules);
    const saved = await this.tx.run(async (session) => {
      const previous = await this.rulesModel
        .findOneAndUpdate({ isCurrent: true }, { $set: { isCurrent: false } }, { session })
        .lean();
      const [row] = await this.rulesModel.create(
        [{ version: (previous?.version ?? 0) + 1, rules: checked, confirmed, isCurrent: true, updatedBy: new Types.ObjectId(admin.id) }],
        { session },
      );
      await this.audit.record(
        {
          actor: admin,
          action: AUDIT_ACTIONS.TRIAGE_RULES_CHANGED,
          resourceId: `triageRules:v${row.version}`,
          before: previous ? { version: previous.version, rules: previous.rules, confirmed: previous.confirmed } : null,
          after: { version: row.version, rules: checked, confirmed },
        },
        session,
      );
      return row;
    });
    return { version: saved.version, rules: saved.rules, confirmed: saved.confirmed, updatedAt: toLocalIso(saved.updatedAt) };
  }

  /** The newest active result of each feeding test, per patient. */
  private async latestInvestigations(ids: Types.ObjectId[]): Promise<Map<string, Partial<Record<(typeof FEEDS)[number]['input'], Dated>>>> {
    const pipeline: PipelineStage[] = [
      {
        $match: {
          patientId: { $in: ids },
          status: RESULT_STATUS.ACTIVE,
          $or: FEEDS.map((f) => ({ test: f.test, [`values.${f.field}`]: { $type: 'number' } })),
        },
      },
      { $sort: { takenOn: -1, createdAt: -1 } },
      { $group: { _id: { patientId: '$patientId', test: '$test' }, values: { $first: '$values' }, takenOn: { $first: '$takenOn' } } },
    ];
    const rows = await this.investigations.aggregate<{ _id: { patientId: Types.ObjectId; test: string }; values: Record<string, number>; takenOn: string }>(pipeline);

    const byPatient = new Map<string, Partial<Record<(typeof FEEDS)[number]['input'], Dated>>>();
    for (const row of rows) {
      const feed = FEEDS.find((f) => f.test === row._id.test)!;
      const entry = byPatient.get(String(row._id.patientId)) ?? {};
      entry[feed.input] = { value: row.values[feed.field], date: row.takenOn };
      byPatient.set(String(row._id.patientId), entry);
    }
    return byPatient;
  }
}

function isPair(value: unknown): value is { systolic: number; diastolic: number } {
  const v = value as { systolic?: unknown; diastolic?: unknown } | null | undefined;
  return typeof v?.systolic === 'number' && typeof v?.diastolic === 'number';
}

/**
 * A new rule set must have exactly the shape of the defaults, every value a
 * number in a sensible place, and each Medium band on the right side of its
 * High band - so a typing slip can't silently switch a parameter off.
 */
export function checkRuleSet(input: unknown): TriageRuleSet {
  const details: ErrorDetail[] = [];
  const walk = (template: unknown, value: unknown, path: string) => {
    if (typeof template === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        details.push({ field: path, code: DETAIL_CODES.WRONG_SHAPE, issue: 'must be a number, 0 or more' });
      }
      return;
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      details.push({ field: path, code: DETAIL_CODES.WRONG_SHAPE, issue: 'must be an object' });
      return;
    }
    const keys = Object.keys(template as object);
    for (const key of keys) walk((template as Record<string, unknown>)[key], (value as Record<string, unknown>)[key], `${path}.${key}`);
    for (const key of Object.keys(value)) {
      if (!keys.includes(key)) details.push({ field: `${path}.${key}`, code: DETAIL_CODES.NOT_ALLOWED, issue: 'is not a triage setting' });
    }
  };
  walk(DEFAULT_TRIAGE_RULES, input, 'rules');
  if (details.length) throw new ValidationFailedException(details);

  const r = input as TriageRuleSet;
  const order = (ok: boolean, field: string, issue: string) => {
    if (!ok) details.push({ field: `rules.${field}`, code: DETAIL_CODES.OUT_OF_RANGE, issue });
  };
  order(r.age.mediumFrom <= r.age.highAbove, 'age', 'mediumFrom must not be above highAbove');
  order(r.hb.highBelow <= r.hb.mediumBelow, 'hb', 'highBelow must not be above mediumBelow');
  order(r.albumin.highBelow <= r.albumin.mediumBelow, 'albumin', 'highBelow must not be above mediumBelow');
  order(r.must.mediumFrom <= r.must.highFrom, 'must', 'mediumFrom must not be above highFrom');
  order(r.hba1c.mediumFrom <= r.hba1c.highAbove, 'hba1c', 'mediumFrom must not be above highAbove');
  order(r.egfr.highBelow <= r.egfr.mediumBelow, 'egfr', 'highBelow must not be above mediumBelow');
  order(r.heartRate.mediumFrom <= r.heartRate.highAbove, 'heartRate', 'mediumFrom must not be above highAbove');
  order(r.vitalsLookbackDays >= 1 && r.vitalsLookbackDays <= 90 && Number.isInteger(r.vitalsLookbackDays), 'vitalsLookbackDays', 'must be a whole number of days, 1-90');
  if (details.length) throw new ValidationFailedException(details);
  return r;
}
