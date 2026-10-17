import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { DateTime } from 'luxon';
import { Model, Types } from 'mongoose';
import { AUDIT_ACTIONS, DETAIL_CODES, Role } from '../common/constants';
import {
  ConcurrentUpdateException,
  ErrorDetail,
  ValidationFailedException,
} from '../common/api.exception';
import { TransactionRunner } from '../common/mongo/transaction.runner';
import { toLocalIso } from '../common/time';
import { AuditService } from '../audit/audit.service';
import { UserDocument } from '../users/user.schema';
import {
  MEDICAL_FIELDS,
  MedicalField,
  MedicalProfile,
  MedicalProfileDocument,
} from './medical-profile.schema';
import { UpdateMedicalProfileDto } from './medical-profile.dto';

type Actor = { id: string; role: Role };

export type MedicalProfileResponse = Record<MedicalField, unknown> & {
  patientId: string;
  version: number;
  updatedAt: string | null;
  updatedBy: { id: string; role: string } | null;
};

/**
 * v1.0 Medical profile. The patient and their linked doctors read and edit
 * it; every change is audited with old and new values, and a doctor's read is
 * audited too.
 */
@Injectable()
export class MedicalProfilesService {
  constructor(
    @InjectModel(MedicalProfile.name) private readonly model: Model<MedicalProfile>,
    private readonly audit: AuditService,
    private readonly tx: TransactionRunner,
  ) {}

  async get(patient: UserDocument): Promise<MedicalProfileResponse> {
    const profile = await this.model.findOne({ patientId: patient._id }).exec();
    return this.toResponse(patient, profile);
  }

  /** A doctor's read: audited first, and a failed audit fails the call (500). */
  async getAsDoctor(doctor: Actor, patient: UserDocument): Promise<MedicalProfileResponse> {
    await this.audit.record({
      actor: doctor,
      action: AUDIT_ACTIONS.MEDICAL_PROFILE_VIEWED,
      patientId: patient._id,
      resourceId: String(patient._id),
    });
    return this.get(patient);
  }

  async update(
    actor: Actor,
    patient: UserDocument,
    dto: UpdateMedicalProfileDto,
  ): Promise<MedicalProfileResponse> {
    this.assertDates(dto);

    const current = await this.model.findOne({ patientId: patient._id }).exec();
    if ((current?.version ?? 0) !== dto.version) {
      throw new ConcurrentUpdateException('The medical profile was changed by someone else. Reload and retry.');
    }

    // Drop unchanged fields: re-sending the same body is a no-op.
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const field of MEDICAL_FIELDS) {
      if (dto[field] === undefined) continue;
      const next = this.plain(dto[field]);
      const was = this.plain(current?.[field] ?? null);
      if (JSON.stringify(next) === JSON.stringify(was)) continue;
      before[field] = was;
      after[field] = next;
    }
    if (!Object.keys(after).length) return this.toResponse(patient, current);

    const updatedBy = { id: new Types.ObjectId(actor.id), role: actor.role };
    const saved = await this.tx.run(async (session) => {
      let doc: MedicalProfileDocument | null;
      if (dto.version === 0) {
        // First save. A concurrent first save trips the unique index on
        // patientId, which the filter reports as CONCURRENT_UPDATE.
        [doc] = await this.model.create([{ patientId: patient._id, ...after, version: 1, updatedBy }], { session });
      } else {
        doc = await this.model
          .findOneAndUpdate(
            { patientId: patient._id, version: dto.version },
            { $set: { ...after, updatedBy }, $inc: { version: 1 } },
            { new: true, session },
          )
          .exec();
        if (!doc) {
          throw new ConcurrentUpdateException('The medical profile was changed by someone else. Reload and retry.');
        }
      }

      await this.audit.record(
        {
          actor,
          action: AUDIT_ACTIONS.MEDICAL_PROFILE_UPDATED,
          patientId: patient._id,
          resourceId: String(doc._id),
          before,
          after,
        },
        session,
      );
      return doc;
    }, 0);

    return this.toResponse(patient, saved);
  }

  /** Calendar checks the DTO can't do: real dates, a birth date in the past, age 0-120. */
  private assertDates(dto: UpdateMedicalProfileDto): void {
    const details: ErrorDetail[] = [];
    for (const field of ['dateOfBirth', 'plannedSurgeryDate'] as const) {
      const value = dto[field];
      if (value && !DateTime.fromISO(value).isValid) {
        details.push({ field, code: DETAIL_CODES.WRONG_SHAPE, issue: 'is not a real calendar date' });
      }
    }
    if (dto.dateOfBirth && DateTime.fromISO(dto.dateOfBirth).isValid) {
      const born = DateTime.fromISO(dto.dateOfBirth);
      const today = DateTime.now().startOf('day');
      if (born > today || born < today.minus({ years: 120 })) {
        details.push({ field: 'dateOfBirth', code: DETAIL_CODES.OUT_OF_RANGE, issue: 'must be in the past, age 0-120' });
      }
    }
    if (details.length) throw new ValidationFailedException(details);
  }

  /** Strips class instances and Mongoose wrappers, for comparing and storing. */
  private plain(value: unknown): unknown {
    return value === null || value === undefined ? null : JSON.parse(JSON.stringify(value));
  }

  private toResponse(patient: UserDocument, profile: MedicalProfileDocument | null): MedicalProfileResponse {
    const fields = Object.fromEntries(
      MEDICAL_FIELDS.map((field) => [field, this.plain(profile?.[field] ?? null)]),
    ) as Record<MedicalField, unknown>;

    return {
      patientId: String(patient._id),
      ...fields,
      version: profile?.version ?? 0,
      updatedAt: toLocalIso(profile?.updatedAt, patient.timeZone),
      updatedBy: profile?.updatedBy
        ? { id: String(profile.updatedBy.id), role: profile.updatedBy.role }
        : null,
    };
  }
}
