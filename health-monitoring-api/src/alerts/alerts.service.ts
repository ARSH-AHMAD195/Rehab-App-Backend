import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, FilterQuery, Model, Types } from 'mongoose';
import {
  ALERT_RULES,
  ALERT_STATUS,
  AUDIT_ACTIONS,
  AlertRule,
  AlertStatus,
  DEFAULT_PAGE_LIMIT,
  EVENT_TYPES,
  SEVERITY_RANK,
} from '../common/constants';
import {
  AlertAlreadyAcknowledgedException,
  NotFoundException,
} from '../common/api.exception';
import { TransactionRunner } from '../common/mongo/transaction.runner';
import { decodeCursor, encodeCursor } from '../common/pagination/cursor';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../outbox/outbox.service';
import { DailyLog, StoredReading } from '../daily-logs/daily-log.schema';
import { ReadingValue, numericFields } from '../daily-logs/reading-value';
import { DayService } from '../time/day.service';
import { AuthUser, UsersService } from '../users/users.service';
import { VitalTypeDef } from '../vital-types/vital-type.schema';
import { ThresholdsService, thresholdKey } from '../thresholds/thresholds.service';
import { VitalAlert, VitalAlertDocument } from './vital-alert.schema';
import { AcknowledgeAlertDto } from './acknowledge-alert.dto';
import { AlertResponse, SaveAlertResponse } from './alert.response';

/** A reading that was actually changed by a save, with its definition. */
export interface ChangedReading {
  def: VitalTypeDef;
  value: ReadingValue | null;
}

/** An alert this save created or updated, and whether it must be announced. */
export interface EvaluatedAlert {
  alert: VitalAlertDocument;
  /**
   * v1.1 Doctor notification: "One vitals.alert.raised event when an alert is
   * created, and again only if an update raises its severity."
   */
  emit: boolean;
}

@Injectable()
export class AlertsService {
  constructor(
    @InjectModel(VitalAlert.name) private readonly model: Model<VitalAlert>,
    @InjectModel(DailyLog.name) private readonly logs: Model<DailyLog>,
    private readonly thresholds: ThresholdsService,
    private readonly users: UsersService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly day: DayService,
    private readonly tx: TransactionRunner,
  ) {}

  /**
   * Alert lifecycle, v1.1: an alert is raised "when a saved value is below low
   * or above high of the limit in effect for that patient (patient override,
   * else global). No limit set means no alert."
   *
   * Runs inside the save transaction, so a log and its alerts are never saved
   * partly. Only changed readings are passed in, so an unchanged value cannot
   * raise anything.
   */
  async evaluate(
    patientId: string,
    date: string,
    changed: ChangedReading[],
    session: ClientSession,
  ): Promise<EvaluatedAlert[]> {
    const effective = await this.thresholds.effectiveFor(patientId);
    if (!effective.size) return [];

    const results: EvaluatedAlert[] = [];

    for (const { def, value } of changed) {
      // A cleared value raises nothing, and never closes what is already open.
      if (value === null) continue;

      for (const { field, value: num } of numericFields(def, value)) {
        const threshold = effective.get(thresholdKey(def.type, field));
        if (!threshold) continue;

        const breach = this.breachOf(num, threshold.low, threshold.high);
        if (!breach) continue;

        const existing = await this.model
          .findOne({
            patientId: new Types.ObjectId(patientId),
            date,
            type: def.type,
            field,
            status: ALERT_STATUS.OPEN,
          })
          .session(session)
          .exec();

        if (existing) {
          // De-duplication: the same day's alert is updated, not duplicated.
          const escalated =
            SEVERITY_RANK[threshold.severity] > SEVERITY_RANK[existing.severity];

          existing.value = value as Record<string, unknown>;
          if (escalated) existing.severity = threshold.severity;
          existing.markModified('value');
          await existing.save({ session });

          results.push({ alert: existing, emit: escalated });
          continue;
        }

        const [created] = await this.model.create(
          [
            {
              patientId: new Types.ObjectId(patientId),
              date,
              type: def.type,
              field,
              value,
              rule: breach.rule,
              threshold: breach.limit,
              thresholdId: threshold._id,
              thresholdVersion: threshold.version,
              severity: threshold.severity,
              status: ALERT_STATUS.OPEN,
            },
          ],
          { session },
        );
        results.push({ alert: created, emit: true });
      }
    }

    return results;
  }

  private breachOf(
    value: number,
    low: number | null,
    high: number | null,
  ): { rule: AlertRule; limit: number } | null {
    if (low !== null && value < low) return { rule: ALERT_RULES.BELOW_LOW, limit: low };
    if (high !== null && value > high) return { rule: ALERT_RULES.ABOVE_HIGH, limit: high };
    return null;
  }

  /** The `alerts` array on the PUT /me/vitals/today response. */
  toSaveResponse(evaluated: EvaluatedAlert[]): SaveAlertResponse[] {
    return evaluated.map(({ alert }) => ({
      id: String(alert._id),
      type: alert.type,
      field: alert.field,
      rule: alert.rule,
      threshold: alert.threshold,
      severity: alert.severity,
      status: alert.status,
    }));
  }

  /**
   * GET /doctor/alerts: alerts across the doctor's patients, newest first.
   * `patientId` is validated by the caller (404 when not linked).
   */
  async listForDoctor(
    doctor: AuthUser,
    params: { status?: AlertStatus; patientId?: string; limit?: number; cursor?: string },
  ): Promise<{ data: AlertResponse[]; nextCursor: string | null }> {
    const limit = params.limit ?? DEFAULT_PAGE_LIMIT;
    const patientIds = params.patientId
      ? [new Types.ObjectId(params.patientId)]
      : await this.users.patientIdsForDoctor(doctor.id);

    if (!patientIds.length) return { data: [], nextCursor: null };

    const filter: FilterQuery<VitalAlert> = {
      patientId: { $in: patientIds },
      status: params.status ?? ALERT_STATUS.OPEN,
    };
    if (params.cursor) {
      const { k, id } = decodeCursor(params.cursor);
      filter.$or = [
        { createdAt: { $lt: new Date(k) } },
        { createdAt: new Date(k), _id: { $lt: new Types.ObjectId(id) } },
      ];
    }

    const rows = await this.model
      .find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .exec();

    const page = rows.slice(0, limit);
    const last = page[page.length - 1];

    return {
      data: await this.toResponses(page),
      nextCursor:
        rows.length > limit && last
          ? encodeCursor({ k: last.createdAt.toISOString(), id: String(last._id) })
          : null,
    };
  }

  /**
   * PATCH /doctor/alerts/:alertId. Acknowledged is final; the note is set once
   * and cannot be edited afterwards.
   */
  async acknowledge(
    alertId: string,
    dto: AcknowledgeAlertDto,
    doctor: AuthUser,
  ): Promise<AlertResponse> {
    if (!Types.ObjectId.isValid(alertId)) throw new NotFoundException('Alert not found');

    const alert = await this.model.findById(alertId).exec();
    // 404 also covers "its patient isn't linked to this doctor", so an
    // unrelated alert id reveals nothing.
    if (!alert) throw new NotFoundException('Alert not found');
    if (!(await this.users.isPatientLinkedToDoctor(String(alert.patientId), doctor.id))) {
      throw new NotFoundException('Alert not found');
    }
    if (alert.status === ALERT_STATUS.ACKNOWLEDGED) {
      throw new AlertAlreadyAcknowledgedException();
    }

    const updated = await this.tx.run(async (session) => {
      const acknowledgedAt = new Date();
      const next = await this.model
        .findOneAndUpdate(
          { _id: alert._id, status: ALERT_STATUS.OPEN },
          {
            $set: {
              status: ALERT_STATUS.ACKNOWLEDGED,
              acknowledgedBy: new Types.ObjectId(doctor.id),
              acknowledgedAt,
              note: dto.note ?? null,
            },
          },
          { new: true, session },
        )
        .exec();

      // Lost the race with another doctor acknowledging the same alert.
      if (!next) throw new AlertAlreadyAcknowledgedException();

      await this.audit.record(
        {
          actor: doctor,
          action: AUDIT_ACTIONS.ALERT_ACKNOWLEDGED,
          patientId: next.patientId,
          resourceId: String(next._id),
          before: { status: alert.status, note: alert.note },
          after: { status: next.status, note: next.note },
        },
        session,
      );

      await this.outbox.enqueue(
        [
          {
            type: EVENT_TYPES.ALERT_ACKNOWLEDGED,
            patientId: next.patientId,
            data: {
              alertId: String(next._id),
              acknowledgedBy: doctor.id,
              acknowledgedAt: acknowledgedAt.toISOString(),
            },
          },
        ],
        session,
      );

      return next;
    });

    const [response] = await this.toResponses([updated]);
    return response;
  }

  /** The doctors to notify for an alert (carried on vitals.alert.raised). */
  async doctorIdsForPatient(patientId: string): Promise<string[]> {
    return this.users.doctorIdsForPatient(patientId);
  }

  /**
   * Fills in the patient name and `currentValue` - "that parameter's value in
   * the log now, which may differ after the patient edits it".
   */
  private async toResponses(alerts: VitalAlertDocument[]): Promise<AlertResponse[]> {
    if (!alerts.length) return [];

    const profiles = await this.users.profilesByIds([
      ...new Set(alerts.map((a) => String(a.patientId))),
    ].map((id) => new Types.ObjectId(id)));

    const logs = await this.logs
      .find(
        { $or: alerts.map((a) => ({ patientId: a.patientId, date: a.date })) },
        { patientId: 1, date: 1, readings: 1 },
      )
      .lean();

    const readingsByKey = new Map<string, Record<string, StoredReading>>(
      logs.map((log) => [`${String(log.patientId)}:${log.date}`, log.readings]),
    );

    return alerts.map((alert) => {
      const profile = profiles.get(String(alert.patientId));
      const timeZone = profile?.timeZone ?? 'UTC';
      const reading = readingsByKey.get(`${String(alert.patientId)}:${alert.date}`)?.[alert.type];

      return {
        id: String(alert._id),
        patient: { id: String(alert.patientId), name: profile?.name ?? 'Unknown' },
        date: alert.date,
        type: alert.type,
        field: alert.field,
        value: alert.value,
        currentValue: reading?.value ?? null,
        rule: alert.rule,
        threshold: alert.threshold,
        thresholdId: String(alert.thresholdId),
        thresholdVersion: alert.thresholdVersion,
        severity: alert.severity,
        status: alert.status,
        createdAt: this.day.toLocalIso(alert.createdAt, timeZone)!,
        updatedAt: this.day.toLocalIso(alert.updatedAt, timeZone)!,
        acknowledgedBy: alert.acknowledgedBy ? String(alert.acknowledgedBy) : null,
        acknowledgedAt: this.day.toLocalIso(alert.acknowledgedAt, timeZone),
        note: alert.note,
      };
    });
  }
}
