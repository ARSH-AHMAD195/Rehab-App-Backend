import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { DateTime } from 'luxon';
import { FilterQuery, Model, Types } from 'mongoose';
import { AUDIT_ACTIONS, CARE_ALERTS, CARE_ALERT_KINDS, DEFAULT_PAGE_LIMIT, ROLES, Role } from '../common/constants';
import { AlertAlreadyAcknowledgedException, NotFoundException } from '../common/api.exception';
import { TransactionRunner } from '../common/mongo/transaction.runner';
import { decodeCursor, encodeCursor } from '../common/pagination/cursor';
import { DEFAULT_DISPLAY_TIME_ZONE, toLocalIso, todayIn } from '../common/time';
import { AuditService } from '../audit/audit.service';
import { Investigation, RESULT_STATUS } from '../investigations/investigation.schema';
import { MedicalProfile } from '../medical-profiles/medical-profile.schema';
import { DailyLogView } from '../triage/triage.schema';
import { TriageService } from '../triage/triage.service';
import { UserDocument } from '../users/user.schema';
import { UsersService, toObjectId } from '../users/users.service';
import { AlertCandidate, ResultInput, VitalsDay, detectAlerts } from './care-alert-rules';
import { CARE_ALERT_STATUS, CareAlert, CareAlertDocument, CareAlertStatus, ExerciseCompletionView, MealLogView } from './care-alert.schema';

type Actor = { id: string; role: Role };

export interface CareAlertResponse {
  id: string;
  patient: { id: string; name: string };
  kind: string;
  message: string;
  details: Record<string, unknown>;
  status: string;
  createdAt: string | null;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  note: string | null;
}

const ALERT_TESTS = ['HB', 'ALBUMIN', 'HBA1C', 'CREATININE'];

/**
 * Care-team alerts (client change request, section 3.3).
 *
 * Alerts are found when a doctor opens the inbox: the patients' current data
 * is checked (detectAlerts) and anything new is stored. So the inbox is always
 * up to date when it is read, with no background job and no always-on server.
 * Sending alerts out (push, SMS) would need a timer; that waits on the
 * client's choice of channel.
 */
@Injectable()
export class CareAlertsService {
  constructor(
    @InjectModel(CareAlert.name) private readonly alerts: Model<CareAlert>,
    @InjectModel(Investigation.name) private readonly investigations: Model<Investigation>,
    @InjectModel(MedicalProfile.name) private readonly profiles: Model<MedicalProfile>,
    @InjectModel(DailyLogView.name) private readonly dailyLogs: Model<DailyLogView>,
    @InjectModel(ExerciseCompletionView.name) private readonly completions: Model<ExerciseCompletionView>,
    @InjectModel(MealLogView.name) private readonly meals: Model<MealLogView>,
    private readonly triage: TriageService,
    private readonly users: UsersService,
    private readonly audit: AuditService,
    private readonly tx: TransactionRunner,
  ) {}

  /** GET /doctor/care-alerts: the caller's patients' alerts, newest first, checked for new ones first. */
  async inbox(
    doctor: Actor,
    query: { status?: CareAlertStatus | 'ALL'; patientId?: string; limit?: number; cursor?: string },
  ): Promise<{ data: CareAlertResponse[]; nextCursor: string | null; openCount: number }> {
    const patients = query.patientId
      ? [await this.users.getPatientFor(doctor, query.patientId)].filter((p) => p.active)
      : await this.users.model.find({ role: ROLES.PATIENT, active: true, doctorIds: new Types.ObjectId(doctor.id) }).exec();
    if (!patients.length) return { data: [], nextCursor: null, openCount: 0 };

    await this.sync(patients);

    const ids = patients.map((p) => p._id as Types.ObjectId);
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const status = query.status ?? CARE_ALERT_STATUS.OPEN;
    const filter: FilterQuery<CareAlert> = { patientId: { $in: ids } };
    if (status !== 'ALL') filter.status = status;
    if (query.cursor) {
      const { k, id } = decodeCursor(query.cursor);
      filter.$or = [{ createdAt: { $lt: new Date(k) } }, { createdAt: new Date(k), _id: { $lt: new Types.ObjectId(id) } }];
    }

    const [rows, openCount] = await Promise.all([
      this.alerts.find(filter).sort({ createdAt: -1, _id: -1 }).limit(limit + 1).exec(),
      this.alerts.countDocuments({ patientId: { $in: ids }, status: CARE_ALERT_STATUS.OPEN }),
    ]);
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const byId = new Map(patients.map((p) => [String(p._id), p]));
    return {
      data: page.map((a) => this.toResponse(a, byId.get(String(a.patientId))!)),
      nextCursor: rows.length > limit && last ? encodeCursor({ k: last.createdAt.toISOString(), id: String(last._id) }) : null,
      openCount,
    };
  }

  /** PATCH /doctor/care-alerts/:alertId: any linked doctor, once. */
  async acknowledge(doctor: Actor, alertId: string, note: string | null): Promise<CareAlertResponse> {
    const id = toObjectId(alertId);
    const alert = id ? await this.alerts.findById(id).exec() : null;
    // An alert of a patient this doctor isn't linked to looks like no alert at all.
    const patient = alert ? await this.users.model.findOne({ _id: alert.patientId, role: ROLES.PATIENT }).exec() : null;
    if (!alert || !patient || !patient.doctorIds.some((d) => String(d) === doctor.id)) {
      throw new NotFoundException('Alert not found');
    }
    if (alert.status === CARE_ALERT_STATUS.ACKNOWLEDGED) throw new AlertAlreadyAcknowledgedException();

    const updated = await this.tx.run(async (session) => {
      const next = await this.alerts
        .findOneAndUpdate(
          { _id: alert._id, status: CARE_ALERT_STATUS.OPEN },
          { $set: { status: CARE_ALERT_STATUS.ACKNOWLEDGED, acknowledgedBy: new Types.ObjectId(doctor.id), acknowledgedAt: new Date(), note } },
          { new: true, session },
        )
        .exec();
      // Another doctor acknowledged it a moment earlier.
      if (!next) throw new AlertAlreadyAcknowledgedException();
      await this.audit.record(
        {
          actor: doctor,
          action: AUDIT_ACTIONS.CARE_ALERT_ACKNOWLEDGED,
          patientId: next.patientId,
          resourceId: String(next._id),
          before: { status: CARE_ALERT_STATUS.OPEN },
          after: { status: next.status, note },
        },
        session,
      );
      return next;
    }, 0);
    return this.toResponse(updated, patient);
  }

  /** Checks these patients' current data and stores any alert not raised before. */
  async sync(patients: UserDocument[]): Promise<void> {
    if (!patients.length) return;
    const { rules } = await this.triage.currentRules();
    const ids = patients.map((p) => p._id as Types.ObjectId);
    const todayOf = new Map(patients.map((p) => [String(p._id), todayIn(p.timeZone || DEFAULT_DISPLAY_TIME_ZONE)]));
    const earliest = (days: number) =>
      [...todayOf.values()].map((d) => DateTime.fromISO(d).minus({ days }).toISODate()!).sort()[0];

    const [results, logs, profiles, lastLogs, lastTicks, mealRows, lastMeals] = await Promise.all([
      this.investigations
        .find(
          {
            patientId: { $in: ids },
            status: RESULT_STATUS.ACTIVE,
            $or: [{ test: { $in: ALERT_TESTS }, takenOn: { $gte: earliest(CARE_ALERTS.RECENT_DAYS) } }, { test: 'MUST' }],
          },
          { patientId: 1, test: 1, takenOn: 1, values: 1 },
        )
        .lean(),
      this.dailyLogs
        .find(
          { patientId: { $in: ids }, date: { $gte: earliest(rules.vitalsLookbackDays - 1) } },
          { patientId: 1, date: 1, 'readings.PULSE.value': 1, 'readings.BP.value': 1, 'readings.WEIGHT.value': 1 },
        )
        .sort({ date: -1 })
        .lean(),
      this.profiles.find({ patientId: { $in: ids } }, { patientId: 1, onboardingWeightKg: 1 }).lean(),
      this.dailyLogs.aggregate<{ _id: Types.ObjectId; date: string }>([
        { $match: { patientId: { $in: ids }, filledCount: { $gt: 0 } } },
        { $group: { _id: '$patientId', date: { $max: '$date' } } },
      ]),
      this.completions.aggregate<{ _id: Types.ObjectId; date: string }>([
        { $match: { patientId: { $in: ids }, active: true } },
        { $group: { _id: '$patientId', date: { $max: '$date' } } },
      ]),
      this.meals
        .find({ patientId: { $in: ids }, date: { $gte: earliest(CARE_ALERTS.NUTRITION_LOW_DAYS) } }, { patientId: 1, date: 1, totals: 1, targets: 1 })
        .lean(),
      this.meals.aggregate<{ _id: Types.ObjectId; date: string }>([
        { $match: { patientId: { $in: ids }, 'totals.slotsEaten': { $gt: 0 } } },
        { $group: { _id: '$patientId', date: { $max: '$date' } } },
      ]),
    ]);

    const weightOf = new Map(profiles.map((p) => [String(p.patientId), p.onboardingWeightKg ?? null]));
    const lastLogOf = new Map(lastLogs.map((r) => [String(r._id), r.date]));
    const lastTickOf = new Map(lastTicks.map((r) => [String(r._id), r.date]));
    const lastMealOf = new Map(lastMeals.map((r) => [String(r._id), r.date]));

    const candidates: { patientId: Types.ObjectId; alert: AlertCandidate }[] = [];
    for (const patient of patients) {
      const id = String(patient._id);
      const today = todayOf.get(id)!;
      const from = DateTime.fromISO(today).minus({ days: rules.vitalsLookbackDays - 1 }).toISODate()!;
      const vitals: VitalsDay[] = logs
        .filter((l) => String(l.patientId) === id && l.date >= from && l.date <= today)
        .map((l) => {
          const r = (l.readings ?? {}) as Record<string, { value?: Record<string, number> | null } | undefined>;
          const bp = r.BP?.value;
          return {
            date: l.date,
            pulse: typeof r.PULSE?.value?.num === 'number' ? r.PULSE.value.num : null,
            bp: bp && typeof bp.systolic === 'number' && typeof bp.diastolic === 'number' ? { systolic: bp.systolic, diastolic: bp.diastolic } : null,
            weight: typeof r.WEIGHT?.value?.num === 'number' ? r.WEIGHT.value.num : null,
          };
        });
      const mine: ResultInput[] = results
        .filter((r) => String(r.patientId) === id)
        .map((r) => ({ id: String(r._id), test: r.test, takenOn: r.takenOn, values: r.values ?? {} }));
      const activity = [lastLogOf.get(id), lastTickOf.get(id), lastMealOf.get(id)].filter((d): d is string => !!d && d <= today).sort();
      const meals = mealRows
        .filter((m) => String(m.patientId) === id && m.totals && m.targets)
        .map((m) => ({ date: m.date, kcal: m.totals.kcal, targetKcal: m.targets.kcal, slotsEaten: m.totals.slotsEaten }));

      const found = detectAlerts(
        {
          today,
          results: mine,
          vitals,
          onboardingWeightKg: weightOf.get(id) ?? null,
          meals,
          lastActivityDate: activity[activity.length - 1] ?? null,
          registeredOn: DateTime.fromJSDate(patient.createdAt).setZone(patient.timeZone || DEFAULT_DISPLAY_TIME_ZONE).toISODate()!,
        },
        rules,
        {
          weightLossPercent: CARE_ALERTS.WEIGHT_LOSS_PERCENT,
          noLoggingDays: CARE_ALERTS.NO_LOGGING_DAYS,
          recentDays: CARE_ALERTS.RECENT_DAYS,
          nutritionLowPercent: CARE_ALERTS.NUTRITION_LOW_PERCENT,
          nutritionLowDays: CARE_ALERTS.NUTRITION_LOW_DAYS,
        },
      );
      for (const alert of found) candidates.push({ patientId: patient._id as Types.ObjectId, alert });
    }
    if (!candidates.length) return;

    // Skip what is already stored, and - for the ongoing conditions (weight
    // loss, low intake) - a new alert while one of that kind is still open.
    const ongoing: string[] = [CARE_ALERT_KINDS.WEIGHT_LOSS, CARE_ALERT_KINDS.NUTRITION_LOW];
    const existing = await this.alerts
      .find(
        { patientId: { $in: ids }, $or: [{ key: { $in: candidates.map((c) => c.alert.key) } }, { kind: { $in: ongoing }, status: CARE_ALERT_STATUS.OPEN }] },
        { patientId: 1, key: 1, kind: 1, status: 1 },
      )
      .lean();
    const seen = new Set(existing.map((e) => `${String(e.patientId)}|${e.key}`));
    const openOngoing = new Set(
      existing.filter((e) => ongoing.includes(e.kind) && e.status === CARE_ALERT_STATUS.OPEN).map((e) => `${String(e.patientId)}|${e.kind}`),
    );

    const fresh = candidates.filter(
      (c) => !seen.has(`${String(c.patientId)}|${c.alert.key}`) && !openOngoing.has(`${String(c.patientId)}|${c.alert.kind}`),
    );
    if (!fresh.length) return;
    try {
      await this.alerts.insertMany(
        fresh.map((c) => ({ patientId: c.patientId, kind: c.alert.kind, key: c.alert.key, message: c.alert.message, details: c.alert.details })),
        { ordered: false },
      );
    } catch (error) {
      // Two doctors opening the inbox at once: the other request stored them first.
      if ((error as { code?: number }).code !== 11000) throw error;
    }
  }

  private toResponse(alert: CareAlertDocument, patient: UserDocument): CareAlertResponse {
    const zone = patient.timeZone;
    return {
      id: String(alert._id),
      patient: { id: String(patient._id), name: patient.name },
      kind: alert.kind,
      message: alert.message,
      details: alert.details ?? {},
      status: alert.status,
      createdAt: toLocalIso(alert.createdAt, zone),
      acknowledgedBy: alert.acknowledgedBy ? String(alert.acknowledgedBy) : null,
      acknowledgedAt: toLocalIso(alert.acknowledgedAt, zone),
      note: alert.note ?? null,
    };
  }
}
