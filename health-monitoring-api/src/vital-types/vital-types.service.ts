import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AUDIT_ACTIONS, DETAIL_CODES, VALUE_KINDS } from '../common/constants';
import {
  ConcurrentUpdateException,
  ErrorDetail,
  NotFoundException,
  ValidationFailedException,
} from '../common/api.exception';
import { TransactionRunner } from '../common/mongo/transaction.runner';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../users/users.service';
import { VITAL_TYPE_DEFAULTS } from './vital-type.defaults';
import { VitalTypeDef } from './vital-type.schema';
import { UpdateVitalTypeDto } from './update-vital-type.dto';
import { VitalTypeResponse, toVitalTypeResponse } from './vital-type.response';

@Injectable()
export class VitalTypesService implements OnModuleInit {
  /**
   * The definitions are read on every save and every form load but change only
   * when an admin edits one. Cached for a few seconds and dropped on write; a
   * second instance therefore serves an old range for at most CACHE_TTL_MS.
   */
  private static readonly CACHE_TTL_MS = 10_000;
  private cache?: { at: number; defs: VitalTypeDef[] };

  constructor(
    @InjectModel(VitalTypeDef.name) private readonly model: Model<VitalTypeDef>,
    private readonly audit: AuditService,
    private readonly tx: TransactionRunner,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seedMissing();
  }

  /** Inserts any of the 13 parameters that are not in the database yet. */
  async seedMissing(): Promise<void> {
    await this.model.bulkWrite(
      VITAL_TYPE_DEFAULTS.map((seed) => ({
        updateOne: {
          filter: { type: seed.type },
          update: {
            $setOnInsert: {
              ...seed,
              // The schema stores per-field ranges as a Map.
              fields: seed.fields ? new Map(Object.entries(seed.fields)) : undefined,
              version: 1,
            },
          },
          upsert: true,
        },
      })),
    );
    this.cache = undefined;
  }

  async list(): Promise<VitalTypeDef[]> {
    if (this.cache && Date.now() - this.cache.at < VitalTypesService.CACHE_TTL_MS) {
      return this.cache.defs;
    }
    const defs = await this.model.find().sort({ order: 1 }).exec();
    this.cache = { at: Date.now(), defs };
    return defs;
  }

  async listResponse(): Promise<VitalTypeResponse[]> {
    return (await this.list()).map(toVitalTypeResponse);
  }

  async byType(): Promise<Map<string, VitalTypeDef>> {
    return new Map((await this.list()).map((def) => [def.type, def]));
  }

  async get(type: string): Promise<VitalTypeDef> {
    const def = (await this.byType()).get(type);
    if (!def) throw new NotFoundException(`Unknown parameter "${type}"`);
    return def;
  }

  /**
   * Status, v1.1: "totalCount - fields of the parameters where onForm is true.
   * 14 when all are on the form." BP contributes two fields.
   */
  async totalFieldCount(): Promise<number> {
    return (await this.list())
      .filter((def) => def.onForm)
      .reduce((sum, def) => sum + this.fieldCount(def), 0);
  }

  fieldCount(def: VitalTypeDef): number {
    return def.valueKind === VALUE_KINDS.PAIR ? (def.fields?.size ?? 2) : 1;
  }

  /**
   * PUT /admin/vital-types/:type (v1.1). type and valueKind cannot change, the
   * version increases by 1, and values already logged are not re-checked and
   * keep the unit they were saved with.
   */
  async update(
    type: string,
    dto: UpdateVitalTypeDto,
    actor: AuthUser,
  ): Promise<VitalTypeResponse> {
    // From the database, not the cache: the cache on this instance may predate
    // a save made through another one, and the version guard below would then
    // report that as someone else's edit.
    const current = await this.model.findOne({ type }).exec();
    if (!current) throw new NotFoundException(`Unknown parameter "${type}"`);
    this.assertValid(current, dto);

    const updated = await this.tx.run(async (session) => {
      const next = await this.model
        .findOneAndUpdate(
          { type, version: current.version },
          { $set: this.toSetDocument(dto, current), $inc: { version: 1 } },
          { new: true, session },
        )
        .exec();

      // The version guard failed: another admin saved first. The parameter
      // exists, so this is a conflict to retry, not a 404.
      if (!next) {
        throw new ConcurrentUpdateException(
          `Parameter "${type}" was changed by someone else. Retry the request.`,
        );
      }

      await this.audit.record(
        {
          actor,
          action: AUDIT_ACTIONS.VITAL_TYPE_CHANGED,
          resourceId: String(next._id),
          before: toVitalTypeResponse(current),
          after: toVitalTypeResponse(next),
        },
        session,
      );
      return next;
    });

    this.cache = undefined;
    return toVitalTypeResponse(updated);
  }

  private toSetDocument(
    dto: UpdateVitalTypeDto,
    current: VitalTypeDef,
  ): Record<string, unknown> {
    const set: Record<string, unknown> = {};
    const keys = [
      'unit',
      'label',
      'minValid',
      'maxValid',
      'isOptional',
      'onForm',
      'integerOnly',
      'step',
      'order',
    ] as const;
    for (const key of keys) {
      if (dto[key] !== undefined) set[key] = dto[key];
    }

    // The sent fields are merged into the stored ranges, not swapped for them:
    // an admin who narrows systolic alone must not wipe the diastolic range,
    // which would leave BP unsaveable for every patient.
    if (dto.fields) {
      const merged = new Map<string, { minValid: number; maxValid: number }>();
      for (const [name, range] of current.fields?.entries() ?? []) {
        merged.set(name, { minValid: range.minValid, maxValid: range.maxValid });
      }
      for (const [name, range] of Object.entries(dto.fields)) {
        merged.set(name, { minValid: range.minValid, maxValid: range.maxValid });
      }
      set.fields = merged;
    }
    return set;
  }

  /**
   * Admin ranges must stay coherent or patient saves start failing: low below
   * high, BP keeps its two fields, and text ranges stay character counts.
   */
  private assertValid(current: VitalTypeDef, dto: UpdateVitalTypeDto): void {
    const details: ErrorDetail[] = [];
    const isPair = current.valueKind === VALUE_KINDS.PAIR;

    if (isPair) {
      if (dto.minValid !== undefined || dto.maxValid !== undefined) {
        details.push({
          field: 'minValid',
          code: DETAIL_CODES.WRONG_SHAPE,
          issue: `${current.type} takes a range per field, in "fields", not minValid/maxValid`,
        });
      }
      for (const [name, range] of Object.entries(dto.fields ?? {})) {
        if (
          typeof range !== 'object' ||
          range === null ||
          typeof range.minValid !== 'number' ||
          typeof range.maxValid !== 'number'
        ) {
          details.push({
            field: `fields.${name}`,
            code: DETAIL_CODES.WRONG_SHAPE,
            issue: 'must be { minValid, maxValid } as numbers',
          });
          continue;
        }
        if (!current.fields?.has(name)) {
          details.push({
            field: `fields.${name}`,
            code: DETAIL_CODES.UNKNOWN_TYPE,
            issue: `${current.type} has no field "${name}"`,
          });
          continue;
        }
        if (range.minValid >= range.maxValid) {
          details.push({
            field: `fields.${name}.minValid`,
            code: DETAIL_CODES.OUT_OF_RANGE,
            issue: 'must be less than maxValid',
          });
        }
      }
    } else {
      if (dto.fields) {
        details.push({
          field: 'fields',
          code: DETAIL_CODES.WRONG_SHAPE,
          issue: `only BP takes per-field ranges; ${current.type} uses minValid/maxValid`,
        });
      }
      const min = dto.minValid ?? current.minValid;
      const max = dto.maxValid ?? current.maxValid;
      if (min !== null && max !== null && min >= max) {
        details.push({
          field: 'minValid',
          code: DETAIL_CODES.OUT_OF_RANGE,
          issue: 'must be less than maxValid',
        });
      }
      if (current.valueKind === VALUE_KINDS.TEXT && min !== null && min < 0) {
        details.push({
          field: 'minValid',
          code: DETAIL_CODES.OUT_OF_RANGE,
          issue: 'is a character count, so it cannot be negative',
        });
      }
    }

    if (dto.unit === null && current.valueKind !== VALUE_KINDS.TEXT) {
      details.push({
        field: 'unit',
        code: DETAIL_CODES.REQUIRED,
        issue: `${current.type} must keep a unit`,
      });
    }

    if (details.length) throw new ValidationFailedException(details);
  }
}
