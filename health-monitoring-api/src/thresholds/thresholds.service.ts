import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import {
  AUDIT_ACTIONS,
  DEFAULT_PAGE_LIMIT,
  DETAIL_CODES,
  VALUE_KINDS,
} from '../common/constants';
import {
  ErrorDetail,
  NotFoundException,
  ValidationFailedException,
} from '../common/api.exception';
import { TransactionRunner } from '../common/mongo/transaction.runner';
import { encodeCursor, decodeCursor } from '../common/pagination/cursor';
import { AuditService } from '../audit/audit.service';
import { AuthUser, UsersService } from '../users/users.service';
import { VitalTypesService } from '../vital-types/vital-types.service';
import { AlertThreshold, AlertThresholdDocument } from './alert-threshold.schema';
import { SetThresholdDto } from './set-threshold.dto';

/** Key for the (type, field) pair a threshold applies to. */
export function thresholdKey(type: string, field: string | null): string {
  return `${type}:${field ?? ''}`;
}

export interface ThresholdResponse {
  id: string;
  type: string;
  field: string | null;
  low: number | null;
  high: number | null;
  severity: string;
  patientId: string | null;
  version: number;
  effectiveFrom: string;
  updatedBy: string;
}

@Injectable()
export class ThresholdsService {
  constructor(
    @InjectModel(AlertThreshold.name) private readonly model: Model<AlertThreshold>,
    private readonly vitalTypes: VitalTypesService,
    private readonly users: UsersService,
    private readonly audit: AuditService,
    private readonly tx: TransactionRunner,
  ) {}

  /**
   * The limits in effect for one patient: the patient override if one exists,
   * else the global default (v1.1, Alert lifecycle). No row means no limit,
   * and "No limit set means no alert".
   */
  async effectiveFor(patientId: string): Promise<Map<string, AlertThresholdDocument>> {
    const rows = await this.model
      .find({
        isCurrent: true,
        $or: [{ patientId: null }, { patientId: new Types.ObjectId(patientId) }],
      })
      .exec();

    const effective = new Map<string, AlertThresholdDocument>();
    for (const row of rows) {
      const key = thresholdKey(row.type, row.field);
      const existing = effective.get(key);
      // A patient override always beats the global default.
      if (!existing || (row.patientId && !existing.patientId)) effective.set(key, row);
    }
    return effective;
  }

  /** GET /admin/alert-thresholds: current versions only, with optional filters. */
  async list(params: {
    type?: string;
    patientId?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{ data: ThresholdResponse[]; nextCursor: string | null }> {
    const limit = params.limit ?? DEFAULT_PAGE_LIMIT;
    const filter: FilterQuery<AlertThreshold> = { isCurrent: true };

    if (params.type) {
      await this.vitalTypes.get(params.type);
      filter.type = params.type;
    }
    if (params.patientId) {
      if (!(await this.users.getPatient(params.patientId))) {
        throw new NotFoundException('Patient not found');
      }
      filter.patientId = new Types.ObjectId(params.patientId);
    }
    if (params.cursor) {
      const { k, id } = decodeCursor(params.cursor, 'timestamp');
      filter.$or = [
        { effectiveFrom: { $lt: new Date(k) } },
        { effectiveFrom: new Date(k), _id: { $lt: new Types.ObjectId(id) } },
      ];
    }

    const rows = await this.model
      .find(filter)
      .sort({ effectiveFrom: -1, _id: -1 })
      .limit(limit + 1)
      .exec();

    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      data: page.map((row) => this.toResponse(row)),
      nextCursor:
        rows.length > limit && last
          ? encodeCursor({ k: last.effectiveFrom.toISOString(), id: String(last._id) })
          : null,
    };
  }

  /**
   * PUT /admin/alert-thresholds/:type (v1.1). Each save supersedes the current
   * row and inserts the next version, so earlier versions are kept and alerts
   * already raised keep pointing at the version that raised them.
   */
  async set(type: string, dto: SetThresholdDto, actor: AuthUser): Promise<ThresholdResponse> {
    const def = await this.vitalTypes.get(type);
    const field = dto.field ?? null;
    await this.assertValid(def.type, field, dto);

    const scope = {
      type,
      field,
      patientId: dto.patientId ? new Types.ObjectId(dto.patientId) : null,
    };

    const created = await this.tx.run(async (session) => {
      const previous = await this.model
        .findOneAndUpdate({ ...scope, isCurrent: true }, { $set: { isCurrent: false } }, { session })
        .exec();

      const [next] = await this.model.create(
        [
          {
            ...scope,
            low: dto.low ?? null,
            high: dto.high ?? null,
            severity: dto.severity,
            version: (previous?.version ?? 0) + 1,
            effectiveFrom: new Date(),
            isCurrent: true,
            updatedBy: new Types.ObjectId(actor.id),
          },
        ],
        { session },
      );

      await this.audit.record(
        {
          actor,
          action: AUDIT_ACTIONS.THRESHOLD_CHANGED,
          patientId: scope.patientId,
          resourceId: String(next._id),
          before: previous ? this.toResponse(previous) : null,
          after: this.toResponse(next),
        },
        session,
      );
      return next;
    });

    return this.toResponse(created);
  }

  toResponse(row: AlertThresholdDocument): ThresholdResponse {
    return {
      id: String(row._id),
      type: row.type,
      field: row.field,
      low: row.low,
      high: row.high,
      severity: row.severity,
      patientId: row.patientId ? String(row.patientId) : null,
      version: row.version,
      effectiveFrom: row.effectiveFrom.toISOString(),
      updatedBy: String(row.updatedBy),
    };
  }

  /**
   * v1.1 rules: BP needs a field and others must not have one; at least one of
   * low/high; low below high; both inside the parameter's valid range; and
   * NUTRITION takes no limits at all.
   */
  private async assertValid(
    type: string,
    field: string | null,
    dto: SetThresholdDto,
  ): Promise<void> {
    const def = await this.vitalTypes.get(type);
    const details: ErrorDetail[] = [];

    if (def.valueKind === VALUE_KINDS.TEXT) {
      throw new ValidationFailedException([
        {
          field: 'type',
          code: DETAIL_CODES.WRONG_SHAPE,
          issue: `${type} is free text, so it cannot have an alert limit`,
        },
      ]);
    }

    let range: { minValid: number | null; maxValid: number | null } = {
      minValid: def.minValid,
      maxValid: def.maxValid,
    };

    if (def.valueKind === VALUE_KINDS.PAIR) {
      if (!field) {
        details.push({
          field: 'field',
          code: DETAIL_CODES.REQUIRED,
          issue: `${type} needs a field: systolic or diastolic`,
        });
      } else {
        const fieldRange = def.fields?.get(field);
        if (!fieldRange) {
          details.push({
            field: 'field',
            code: DETAIL_CODES.UNKNOWN_TYPE,
            issue: `${type} has no field "${field}"`,
          });
        } else {
          range = fieldRange;
        }
      }
    } else if (field) {
      details.push({
        field: 'field',
        code: DETAIL_CODES.WRONG_SHAPE,
        issue: `${type} takes no field; send null`,
      });
    }

    const low = dto.low ?? null;
    const high = dto.high ?? null;

    if (low === null && high === null) {
      details.push({
        field: 'low',
        code: DETAIL_CODES.REQUIRED,
        issue: 'at least one of low or high is required',
      });
    }
    if (low !== null && high !== null && low >= high) {
      details.push({
        field: 'low',
        code: DETAIL_CODES.OUT_OF_RANGE,
        issue: 'must be less than high',
      });
    }
    for (const [name, value] of [
      ['low', low],
      ['high', high],
    ] as const) {
      if (value === null) continue;
      if (
        (range.minValid !== null && value < range.minValid) ||
        (range.maxValid !== null && value > range.maxValid)
      ) {
        details.push({
          field: name,
          code: DETAIL_CODES.OUT_OF_RANGE,
          issue: `must be within the valid range ${range.minValid}-${range.maxValid}`,
        });
      }
    }

    if (dto.patientId && !(await this.users.getPatient(dto.patientId))) {
      throw new NotFoundException('Patient not found');
    }

    if (details.length) throw new ValidationFailedException(details);
  }
}
