import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { DateTime } from 'luxon';
import { FilterQuery, Model, Types } from 'mongoose';
import { AUDIT_ACTIONS, DETAIL_CODES, Role } from '../common/constants';
import { ErrorDetail, NotFoundException, ValidationFailedException } from '../common/api.exception';
import { TransactionRunner } from '../common/mongo/transaction.runner';
import { DEFAULT_DISPLAY_TIME_ZONE, toLocalIso, todayIn } from '../common/time';
import { AuditService } from '../audit/audit.service';
import { UserDocument } from '../users/user.schema';
import { UsersService, toObjectId } from '../users/users.service';
import { AddInvestigationDto, InvestigationGridQueryDto, SetInvestigationRangeDto } from './investigation.dto';
import { FieldDef, INVESTIGATION_TESTS, TestDef, testDef } from './investigation-tests';
import { Flag, Range, checkValues, flagsOf, rangeKey } from './investigation-values';
import { Investigation, InvestigationDocument, InvestigationRange, RESULT_STATUS } from './investigation.schema';

type Actor = { id: string; role: Role };

export interface InvestigationResponse {
  id: string;
  test: string;
  takenOn: string;
  values: Record<string, number | string>;
  wnl: boolean;
  comment: string | null;
  /** Field key -> LOW / HIGH / ABNORMAL; only fields outside an approved range. */
  flags: Record<string, Flag>;
  /** True when anything is flagged: show it in red. */
  outOfRange: boolean;
  status: string;
  enteredBy: { id: string; role: string };
  enteredAt: string | null;
  retraction: { reason: string; by: { id: string; role: string }; at: string | null } | null;
}

export interface GridRow {
  test: string;
  label: string;
  group: string;
  /** Newest first, by test date. Show the first 2-3 side by side for the trend. */
  results: InvestigationResponse[];
}

export type FieldResponse = FieldDef & { range: Range | null };
export interface TestResponse extends Omit<TestDef, 'fields'> {
  fields: FieldResponse[];
}

/**
 * The investigations menu (client change request, Nov 2026): dated results
 * from the hospital's PAC grid, kept as history, flagged in red only against
 * normal ranges the clinical team has approved.
 *
 * Only the patient's linked doctors read and add results. Every read and
 * change is audited, like the medical profile.
 */
@Injectable()
export class InvestigationsService {
  constructor(
    @InjectModel(Investigation.name) private readonly results: Model<Investigation>,
    @InjectModel(InvestigationRange.name) private readonly ranges: Model<InvestigationRange>,
    private readonly users: UsersService,
    private readonly audit: AuditService,
    private readonly tx: TransactionRunner,
  ) {}

  /** GET /investigation-tests: the grid's tests and fields, with any approved ranges. */
  async tests(): Promise<{ data: TestResponse[] }> {
    const ranges = await this.rangeMap();
    return {
      data: INVESTIGATION_TESTS.map((def) => ({
        ...def,
        fields: def.fields.map((field) => ({
          ...field,
          range: field.kind === 'number' ? (ranges.get(rangeKey(def.code, field.key)) ?? null) : null,
        })),
      })),
    };
  }

  /** POST /patients/:patientId/investigations */
  async add(doctor: Actor, patientId: string, dto: AddInvestigationDto): Promise<InvestigationResponse> {
    const patient = await this.users.getPatientFor(doctor, patientId);
    const def = testDef(dto.test)!; // the DTO already checked the code
    const wnl = dto.wnl ?? false;

    const details: ErrorDetail[] = [];
    if (!DateTime.fromISO(dto.takenOn).isValid) {
      details.push({ field: 'takenOn', code: DETAIL_CODES.WRONG_SHAPE, issue: 'is not a real calendar date' });
    } else if (dto.takenOn > this.today(patient)) {
      details.push({ field: 'takenOn', code: DETAIL_CODES.OUT_OF_RANGE, issue: 'cannot be in the future' });
    }
    const checked = checkValues(def, dto.values, wnl);
    details.push(...checked.details);
    if (details.length) throw new ValidationFailedException(details);

    const saved = await this.tx.run(async (session) => {
      const [doc] = await this.results.create(
        [
          {
            patientId: patient._id,
            test: def.code,
            takenOn: dto.takenOn,
            values: checked.values,
            wnl,
            comment: dto.comment ?? null,
            status: RESULT_STATUS.ACTIVE,
            enteredBy: { id: new Types.ObjectId(doctor.id), role: doctor.role },
          },
        ],
        { session },
      );
      await this.audit.record(
        {
          actor: doctor,
          action: AUDIT_ACTIONS.INVESTIGATION_ADDED,
          patientId: patient._id,
          resourceId: String(doc._id),
          after: { test: def.code, takenOn: dto.takenOn, values: checked.values, wnl, comment: dto.comment ?? null },
        },
        session,
      );
      return doc;
    }, 0);

    return this.toResponse(saved, await this.rangeMap(), patient.timeZone);
  }

  /** GET /patients/:patientId/investigations: every test, its results newest first. */
  async grid(doctor: Actor, patientId: string, query: InvestigationGridQueryDto): Promise<{ patientId: string; tests: GridRow[] }> {
    const patient = await this.users.getPatientFor(doctor, patientId);
    await this.audit.record({
      actor: doctor,
      action: AUDIT_ACTIONS.INVESTIGATIONS_VIEWED,
      patientId: patient._id,
      resourceId: String(patient._id),
    });

    const filter: FilterQuery<Investigation> = { patientId: patient._id };
    if (query.test) filter.test = query.test;
    if (query.includeRetracted !== 'true') filter.status = RESULT_STATUS.ACTIVE;

    const [rows, ranges] = await Promise.all([
      this.results.find(filter).sort({ takenOn: -1, createdAt: -1 }).limit(2000).exec(),
      this.rangeMap(),
    ]);
    const byTest = new Map<string, InvestigationResponse[]>();
    for (const row of rows) {
      const list = byTest.get(row.test) ?? [];
      list.push(this.toResponse(row, ranges, patient.timeZone));
      byTest.set(row.test, list);
    }

    return {
      patientId: String(patient._id),
      tests: INVESTIGATION_TESTS.filter((def) => !query.test || def.code === query.test).map((def) => ({
        test: def.code,
        label: def.label,
        group: def.group,
        results: byTest.get(def.code) ?? [],
      })),
    };
  }

  /**
   * POST /patients/:patientId/investigations/:resultId/retract. The result is
   * kept, marked as entered in error, and drops out of the grid.
   */
  async retract(doctor: Actor, patientId: string, resultId: string, reason: string): Promise<InvestigationResponse> {
    const patient = await this.users.getPatientFor(doctor, patientId);
    const id = toObjectId(resultId);
    const existing = id ? await this.results.findOne({ _id: id, patientId: patient._id }).exec() : null;
    if (!existing) throw new NotFoundException('Investigation result not found');
    if (existing.status === RESULT_STATUS.RETRACTED) {
      throw new ValidationFailedException([{ field: 'resultId', code: DETAIL_CODES.NOT_ALLOWED, issue: 'is already retracted' }]);
    }

    const updated = await this.tx.run(async (session) => {
      const doc = await this.results
        .findOneAndUpdate(
          { _id: existing._id, status: RESULT_STATUS.ACTIVE },
          {
            $set: {
              status: RESULT_STATUS.RETRACTED,
              retraction: { reason, by: { id: new Types.ObjectId(doctor.id), role: doctor.role }, at: new Date() },
            },
          },
          { new: true, session },
        )
        .exec();
      if (!doc) {
        throw new ValidationFailedException([{ field: 'resultId', code: DETAIL_CODES.NOT_ALLOWED, issue: 'is already retracted' }]);
      }
      await this.audit.record(
        {
          actor: doctor,
          action: AUDIT_ACTIONS.INVESTIGATION_RETRACTED,
          patientId: patient._id,
          resourceId: String(doc._id),
          before: { status: RESULT_STATUS.ACTIVE },
          after: { status: RESULT_STATUS.RETRACTED, reason },
        },
        session,
      );
      return doc;
    }, 0);

    return this.toResponse(updated, await this.rangeMap(), patient.timeZone);
  }

  /** GET /admin/investigation-ranges */
  async listRanges(): Promise<{ data: { test: string; field: string; unit: string; low: number | null; high: number | null; updatedAt: string | null }[] }> {
    const rows = await this.ranges.find({}).sort({ test: 1, field: 1 }).exec();
    return {
      data: rows.map((row) => ({
        test: row.test,
        field: row.field,
        unit: this.numberField(row.test, row.field)?.unit ?? '',
        low: row.low,
        high: row.high,
        updatedAt: toLocalIso(row.updatedAt),
      })),
    };
  }

  /**
   * PUT /admin/investigation-ranges. Sets (or, with low and high both null,
   * removes) the approved normal range of one number field. Old values are
   * kept in the audit log. Results are flagged against the range in force
   * when they are read.
   */
  async setRange(admin: Actor, dto: SetInvestigationRangeDto): Promise<{ test: string; field: string; low: number | null; high: number | null }> {
    const field = this.numberField(dto.test, dto.field);
    const details: ErrorDetail[] = [];
    if (!field) {
      details.push({ field: 'field', code: DETAIL_CODES.NOT_ALLOWED, issue: `${dto.test} has no number field "${dto.field}"` });
    } else {
      for (const side of ['low', 'high'] as const) {
        const value = dto[side];
        if (value !== null && (value < field.min || value > field.max)) {
          details.push({ field: side, code: DETAIL_CODES.OUT_OF_RANGE, issue: `must be ${field.min}-${field.max} ${field.unit}` });
        }
      }
      if (dto.low !== null && dto.high !== null && dto.low >= dto.high) {
        details.push({ field: 'low', code: DETAIL_CODES.OUT_OF_RANGE, issue: 'must be less than high' });
      }
    }
    if (details.length) throw new ValidationFailedException(details);

    await this.tx.run(async (session) => {
      const before = await this.ranges.findOne({ test: dto.test, field: dto.field }).session(session).lean();
      if (dto.low === null && dto.high === null) {
        await this.ranges.deleteOne({ test: dto.test, field: dto.field }, { session });
      } else {
        await this.ranges.updateOne(
          { test: dto.test, field: dto.field },
          { $set: { low: dto.low, high: dto.high, updatedBy: new Types.ObjectId(admin.id) } },
          { upsert: true, session },
        );
      }
      await this.audit.record(
        {
          actor: admin,
          action: AUDIT_ACTIONS.INVESTIGATION_RANGE_CHANGED,
          resourceId: `${dto.test}:${dto.field}`,
          before: before ? { low: before.low, high: before.high } : null,
          after: dto.low === null && dto.high === null ? null : { low: dto.low, high: dto.high },
        },
        session,
      );
    });

    return { test: dto.test, field: dto.field, low: dto.low, high: dto.high };
  }

  private numberField(test: string, key: string): Extract<FieldDef, { kind: 'number' }> | undefined {
    const field = testDef(test)?.fields.find((f) => f.key === key);
    return field?.kind === 'number' ? field : undefined;
  }

  private async rangeMap(): Promise<Map<string, Range>> {
    const rows = await this.ranges.find({}).lean();
    return new Map(rows.map((r) => [rangeKey(r.test, r.field), { low: r.low ?? null, high: r.high ?? null }]));
  }

  private today(patient: UserDocument): string {
    return todayIn(patient.timeZone || DEFAULT_DISPLAY_TIME_ZONE);
  }

  private toResponse(doc: InvestigationDocument, ranges: Map<string, Range>, zone?: string | null): InvestigationResponse {
    const def = testDef(doc.test);
    const values = { ...(doc.values ?? {}) };
    const flags = def ? flagsOf(def, values, ranges) : {};
    return {
      id: String(doc._id),
      test: doc.test,
      takenOn: doc.takenOn,
      values,
      wnl: doc.wnl,
      comment: doc.comment ?? null,
      flags,
      outOfRange: Object.keys(flags).length > 0,
      status: doc.status,
      enteredBy: { id: String(doc.enteredBy.id), role: doc.enteredBy.role },
      enteredAt: toLocalIso(doc.createdAt, zone),
      retraction: doc.retraction
        ? {
            reason: doc.retraction.reason,
            by: { id: String(doc.retraction.by.id), role: doc.retraction.by.role },
            at: toLocalIso(doc.retraction.at, zone),
          }
        : null,
    };
  }
}
