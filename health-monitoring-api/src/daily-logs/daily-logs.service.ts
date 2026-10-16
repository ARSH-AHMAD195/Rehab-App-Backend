import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import {
  AUDIT_ACTIONS,
  DEFAULT_LOGS_WINDOW_DAYS,
  DEFAULT_PAGE_LIMIT,
  DETAIL_CODES,
  EVENT_TYPES,
  READING_STATUS,
  TREND_EXCLUDED_TYPES,
  TrendPeriod,
  VALUE_KINDS,
} from '../common/constants';
import { DayChangedException, ValidationFailedException } from '../common/api.exception';
import { TransactionRunner } from '../common/mongo/transaction.runner';
import { decodeCursor, encodeCursor } from '../common/pagination/cursor';
import { AuditService } from '../audit/audit.service';
import { AlertsService, ChangedReading } from '../alerts/alerts.service';
import { NewEvent, OutboxService } from '../outbox/outbox.service';
import { ThresholdsService, thresholdKey } from '../thresholds/thresholds.service';
import { DayService } from '../time/day.service';
import { AuthUser, UsersService } from '../users/users.service';
import { VitalTypeDef } from '../vital-types/vital-type.schema';
import { VitalTypesService } from '../vital-types/vital-types.service';
import { DailyLog, DailyLogDocument, StoredReading } from './daily-log.schema';
import { ReadingsValidatorService, ValidatedReading } from './readings-validator.service';
import { ReadingValue, numericFields, sameValue } from './reading-value';
import { computeStatus } from './log-status';
import {
  DailyLogResponse,
  LogListResponse,
  SaveLogResponse,
  StoredLogLike,
  toLogResponse,
} from './log.response';
import { TrendResponse, ThresholdPair } from './trend.response';
import { LogsQueryDto, TrendsQueryDto } from './dto';

/** Whose log is being read or written, and the zone its days are worked out in. */
export interface LogTarget {
  id: string;
  timeZone: string;
}

@Injectable()
export class DailyLogsService {
  constructor(
    @InjectModel(DailyLog.name) private readonly model: Model<DailyLog>,
    private readonly vitalTypes: VitalTypesService,
    private readonly validator: ReadingsValidatorService,
    private readonly alerts: AlertsService,
    private readonly thresholds: ThresholdsService,
    private readonly users: UsersService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly day: DayService,
    private readonly tx: TransactionRunner,
  ) {}

  /**
   * GET /me/vitals/today (v1.1): "If nothing is logged yet, every parameter is
   * NOT_YET and dayStatus is NOT_STARTED." Reading a day never creates it - the
   * log is created on its first save.
   */
  async getToday(target: LogTarget): Promise<DailyLogResponse> {
    const date = this.day.today(target.timeZone);
    const defs = await this.vitalTypes.list();
    const log = await this.model
      .findOne({ patientId: new Types.ObjectId(target.id), date })
      .exec();

    return toLogResponse(log ?? this.emptyLog(target, date, defs), defs, this.day);
  }

  /**
   * PUT /me/vitals/today (v1.1). Follows Save flow: validate, check the day,
   * drop unchanged fields, then one transaction for the log, its status,
   * alerts, audit entries and outbox events.
   */
  async save(
    patient: AuthUser,
    body: { date: string; readings: Record<string, unknown> },
  ): Promise<SaveLogResponse> {
    const validated = await this.validator.validate(body.readings);

    // Step 4: the date must be the patient's today. A retry that crosses
    // midnight is refused rather than landing on the wrong day.
    const today = this.day.today(patient.timeZone);
    if (body.date !== today) throw new DayChangedException(body.date, today);

    const defs = await this.vitalTypes.list();
    const patientId = new Types.ObjectId(patient.id);
    const existing = await this.model.findOne({ patientId, date: today }).exec();

    // Step 5: drop fields whose value is unchanged. An identical re-send is
    // therefore a no-op: same loggedAt, no audit entry, alert or event.
    const changed = validated.filter(
      ({ def, value }) => !sameValue(this.storedValue(existing, def.type), value),
    );

    if (!changed.length) {
      const log = existing ?? this.emptyLog({ id: patient.id, timeZone: patient.timeZone }, today, defs);
      return { ...toLogResponse(log, defs, this.day), alerts: [] };
    }

    const doctorIds = await this.users.doctorIdsForPatient(patient.id);
    const now = this.day.now();

    const { log, alerts } = await this.tx.run(async (session) => {
      const updated = await this.model
        .findOneAndUpdate(
          { patientId, date: today },
          {
            $set: this.toReadingUpdates(changed, now),
            $setOnInsert: { patientId, date: today, timeZone: patient.timeZone },
          },
          { new: true, upsert: true, session },
        )
        .exec();

      // Recount from the merged document, so two devices saving different
      // fields at once still end up with the right "9 of 14".
      const status = computeStatus(updated.readings, defs);
      await this.model.updateOne({ _id: updated._id }, { $set: status }, { session }).exec();
      updated.set(status);

      const evaluated = await this.alerts.evaluate(
        patient.id,
        today,
        changed as ChangedReading[],
        session,
      );

      await this.audit.record(
        {
          actor: patient,
          action: AUDIT_ACTIONS.VITALS_VALUE_CHANGED,
          patientId,
          resourceId: String(updated._id),
          before: Object.fromEntries(
            changed.map(({ def }) => [def.type, this.storedValue(existing, def.type)]),
          ),
          after: Object.fromEntries(changed.map(({ def, value }) => [def.type, value])),
        },
        session,
      );

      const events: NewEvent[] = [
        {
          type: EVENT_TYPES.LOG_UPDATED,
          patientId,
          data: {
            date: today,
            logId: String(updated._id),
            changedTypes: changed.map(({ def }) => def.type),
            filledCount: status.filledCount,
            dayStatus: status.dayStatus,
          },
        },
        ...evaluated
          .filter(({ emit }) => emit)
          .map(({ alert }) => ({
            type: EVENT_TYPES.ALERT_RAISED,
            patientId,
            data: {
              alertId: String(alert._id),
              logId: String(updated._id),
              type: alert.type,
              field: alert.field,
              value: alert.value,
              rule: alert.rule,
              threshold: alert.threshold,
              severity: alert.severity,
              doctorIds,
            },
          })),
      ];
      await this.outbox.enqueue(events, session);

      return { log: updated, alerts: this.alerts.toSaveResponse(evaluated) };
    });

    return { ...toLogResponse(log, defs, this.day), alerts };
  }

  /**
   * GET /me/vitals/logs (v1.1): past daily logs, newest first, in the same
   * shape as today's log. Days with no saves are left out.
   */
  async listLogs(target: LogTarget, query: LogsQueryDto): Promise<LogListResponse> {
    const defaults = this.day.defaultLogsRange(target.timeZone, DEFAULT_LOGS_WINDOW_DAYS);
    const from = query.from ?? defaults.from;
    const to = query.to ?? defaults.to;
    this.day.assertRangeOrder(from, to);

    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const filter: FilterQuery<DailyLog> = {
      patientId: new Types.ObjectId(target.id),
      date: { $gte: from, $lte: to },
    };
    if (query.cursor) {
      const { k, id } = decodeCursor(query.cursor, 'date');
      filter.$or = [{ date: { $lt: k } }, { date: k, _id: { $lt: new Types.ObjectId(id) } }];
    }

    const rows = await this.model.find(filter).sort({ date: -1, _id: -1 }).limit(limit + 1).exec();
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const defs = await this.vitalTypes.list();

    return {
      data: page.map((log) => toLogResponse(log, defs, this.day)),
      nextCursor:
        rows.length > limit && last ? encodeCursor({ k: last.date, id: String(last._id) }) : null,
    };
  }

  /**
   * GET /me/vitals/trends (v1.1): one value per day for one parameter.
   *
   * "A log holds one value per parameter per day, so the trend value is that
   * day's current saved value. No averaging is done." Days with no value are
   * null, so the chart shows a gap.
   */
  async trends(target: LogTarget, query: TrendsQueryDto): Promise<TrendResponse> {
    if (TREND_EXCLUDED_TYPES.includes(query.type)) {
      throw new ValidationFailedException([
        {
          field: 'type',
          code: DETAIL_CODES.WRONG_SHAPE,
          issue: `${query.type} is free text and has no trend`,
        },
      ]);
    }

    const defs = await this.vitalTypes.byType();
    const def = defs.get(query.type);
    if (!def) {
      throw new ValidationFailedException([
        { field: 'type', code: DETAIL_CODES.UNKNOWN_TYPE, issue: 'is not a known parameter' },
      ]);
    }

    const period: TrendPeriod = query.period ?? '30d';
    const labels = this.day.periodDates(target.timeZone, period);

    const logs = await this.model
      .find(
        {
          patientId: new Types.ObjectId(target.id),
          date: { $gte: labels[0], $lte: labels[labels.length - 1] },
        },
        { date: 1, readings: 1 },
      )
      .lean();

    const byDate = new Map(logs.map((log) => [log.date, log.readings]));
    const effective = await this.thresholds.effectiveFor(target.id);

    if (def.valueKind === VALUE_KINDS.PAIR) {
      const fieldNames = [...(def.fields?.keys() ?? [])];
      const series: Record<string, (number | null)[]> = {};
      const thresholds: Record<string, ThresholdPair | null> = {};

      for (const name of fieldNames) {
        series[name] = labels.map((date) => this.fieldValueOn(byDate, date, def, name));
        thresholds[name] = this.thresholdPair(effective, def.type, name);
      }

      return {
        type: def.type,
        unit: def.unit,
        period,
        labels,
        systolic: series.systolic,
        diastolic: series.diastolic,
        thresholds,
      };
    }

    return {
      type: def.type,
      unit: def.unit,
      period,
      labels,
      values: labels.map((date) => this.fieldValueOn(byDate, date, def, null)),
      thresholds: this.thresholdPair(effective, def.type, null),
    };
  }

  /** Audit for a doctor's read, written before any data is returned. */
  async recordDoctorView(doctor: AuthUser, patientId: string): Promise<void> {
    await this.audit.record({
      actor: doctor,
      action: AUDIT_ACTIONS.PATIENT_VITALS_VIEWED,
      patientId,
    });
  }

  private fieldValueOn(
    byDate: Map<string, Record<string, StoredReading>>,
    date: string,
    def: VitalTypeDef,
    field: string | null,
  ): number | null {
    const reading = byDate.get(date)?.[def.type];
    if (!reading || reading.value === null) return null;

    const fields = numericFields(def, reading.value as unknown as ReadingValue);
    return fields.find((entry) => entry.field === field)?.value ?? null;
  }

  private thresholdPair(
    effective: Map<string, { low: number | null; high: number | null }>,
    type: string,
    field: string | null,
  ): ThresholdPair | null {
    const threshold = effective.get(thresholdKey(type, field));
    return threshold ? { low: threshold.low, high: threshold.high } : null;
  }

  private storedValue(
    log: DailyLogDocument | null,
    type: string,
  ): ReadingValue | null {
    const value = log?.readings?.[type]?.value;
    return (value ?? null) as ReadingValue | null;
  }

  /**
   * The server sets loggedAt for each changed field; the app doesn't send
   * times. Clearing a value puts the field back to NOT_YET with no loggedAt.
   */
  private toReadingUpdates(
    changed: ValidatedReading[],
    now: Date,
  ): Record<string, StoredReading> {
    const updates: Record<string, StoredReading> = {};

    for (const { def, value } of changed) {
      updates[`readings.${def.type}`] = {
        value: value as Record<string, unknown> | null,
        unit: def.unit,
        typeVersion: def.version,
        status: value === null ? READING_STATUS.NOT_YET : READING_STATUS.LOGGED,
        loggedAt: value === null ? null : now,
      };
    }
    return updates;
  }

  /** A day with nothing logged, as the response shape, without creating it. */
  private emptyLog(target: LogTarget, date: string, defs: VitalTypeDef[]): StoredLogLike {
    const status = computeStatus({}, defs);
    return {
      date,
      timeZone: target.timeZone,
      dayStatus: status.dayStatus,
      filledCount: status.filledCount,
      totalCount: status.totalCount,
      readings: {},
    };
  }
}
