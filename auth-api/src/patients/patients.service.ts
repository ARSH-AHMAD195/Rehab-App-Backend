import { Injectable } from '@nestjs/common';
import { FilterQuery, Types } from 'mongoose';
import { AUDIT_ACTIONS, DEFAULT_PATIENT_TIME_ZONE, DETAIL_CODES, ROLES, Role } from '../common/constants';
import {
  ErrorDetail,
  ForbiddenRoleException,
  NotFoundException,
  ValidationFailedException,
} from '../common/api.exception';
import { TransactionRunner } from '../common/mongo/transaction.runner';
import { isValidTimeZone } from '../common/time';
import { AuditService } from '../audit/audit.service';
import { RegistrationService } from '../registration/registration.service';
import { AccountsService } from '../users/accounts.service';
import { listUsers } from '../users/user-directory';
import { User } from '../users/user.schema';
import { PatientListQueryDto, RegisterPatientDto, UpdatePatientDto } from '../users/user.dto';
import { PatientResponse, UserResponses } from '../users/user.responses';
import { UsersService } from '../users/users.service';

type Actor = { id: string; role: Role };

@Injectable()
export class PatientsService {
  constructor(
    private readonly users: UsersService,
    private readonly accounts: AccountsService,
    private readonly registration: RegistrationService,
    private readonly responses: UserResponses,
    private readonly audit: AuditService,
    private readonly tx: TransactionRunner,
  ) {}

  /**
   * POST /patients. A doctor's patient is linked to that doctor; an admin
   * must name at least one active doctor.
   */
  async register(actor: Actor, dto: RegisterPatientDto): Promise<PatientResponse & { invitation: string }> {
    const details: ErrorDetail[] = [];
    if (dto.timeZone !== undefined && !isValidTimeZone(dto.timeZone)) {
      details.push({ field: 'timeZone', code: DETAIL_CODES.WRONG_SHAPE, issue: 'must be an IANA time zone, e.g. Asia/Kolkata' });
    }
    if (actor.role === ROLES.DOCTOR && dto.doctorIds !== undefined) {
      details.push({ field: 'doctorIds', code: DETAIL_CODES.NOT_ALLOWED, issue: 'is set to you when a doctor registers a patient' });
    }
    if (actor.role === ROLES.ADMIN && dto.doctorIds === undefined) {
      details.push({ field: 'doctorIds', code: DETAIL_CODES.REQUIRED, issue: 'at least one doctor is required' });
    }
    if (details.length) throw new ValidationFailedException(details);

    const doctorIds =
      actor.role === ROLES.DOCTOR
        ? [new Types.ObjectId(actor.id)]
        : await this.activeDoctors(dto.doctorIds!);

    const { user, invitation } = await this.registration.register(
      {
        role: ROLES.PATIENT,
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        timeZone: dto.timeZone ?? DEFAULT_PATIENT_TIME_ZONE,
        doctorIds,
      },
      actor,
    );
    const [patient] = await this.responses.patients([user]);
    return { ...patient, invitation };
  }

  /** GET /patients: a doctor's linked patients, or every patient for an admin. */
  async list(actor: Actor, query: PatientListQueryDto): Promise<{ data: PatientResponse[]; nextCursor: string | null }> {
    if (query.doctorId && actor.role !== ROLES.ADMIN) {
      throw new ValidationFailedException([
        { field: 'doctorId', code: DETAIL_CODES.NOT_ALLOWED, issue: 'is an admin-only filter' },
      ]);
    }
    const scope: FilterQuery<User> =
      actor.role === ROLES.DOCTOR
        ? { doctorIds: new Types.ObjectId(actor.id) }
        : query.doctorId
          ? { doctorIds: new Types.ObjectId(query.doctorId) }
          : {};

    const { rows, nextCursor } = await listUsers(this.users.model, ROLES.PATIENT, query, scope);
    return { data: await this.responses.patients(rows), nextCursor };
  }

  async get(actor: Actor, patientId: string): Promise<PatientResponse> {
    const [patient] = await this.responses.patients([await this.users.getPatientFor(actor, patientId)]);
    return patient;
  }

  /** PATCH /patients/:patientId. Only an admin may change `active`. */
  async update(actor: Actor, patientId: string, dto: UpdatePatientDto): Promise<PatientResponse> {
    const patient = await this.users.getPatientFor(actor, patientId);
    if (dto.active !== undefined && actor.role !== ROLES.ADMIN) {
      throw new ForbiddenRoleException('Only an admin can deactivate or reactivate a patient');
    }

    const { active, ...changes } = dto;
    const updated = await this.accounts.update(actor, patient, changes, active);
    const [response] = await this.responses.patients([updated]);
    return response;
  }

  /**
   * PUT /patients/:patientId/doctors (admin). Replaces the list. A doctor taken
   * off it loses access at once - in Health Monitoring too, which reads the
   * same field.
   */
  async setDoctors(actor: Actor, patientId: string, doctorIdList: string[]): Promise<PatientResponse> {
    const patient = await this.users.getByRole(patientId, ROLES.PATIENT, 'Patient not found');
    const doctorIds = await this.activeDoctors(doctorIdList);

    const before = patient.doctorIds.map(String);
    const after = doctorIds.map(String);
    const unchanged = before.length === after.length && before.every((id) => after.includes(id));

    if (!unchanged) {
      await this.tx.run(async (session) => {
        await this.users.lockActiveDoctors(doctorIds, session);
        await this.users.model.updateOne({ _id: patient._id }, { $set: { doctorIds } }, { session }).exec();
        await this.audit.record(
          {
            actor,
            action: AUDIT_ACTIONS.DOCTOR_LINKS_CHANGED,
            patientId: patient._id,
            resourceId: String(patient._id),
            before: { doctorIds: before },
            after: { doctorIds: after },
          },
          session,
        );
      });
    }

    const [response] = await this.responses.patients([(await this.users.model.findById(patient._id).exec())!]);
    return response;
  }

  /** Every id must be a doctor (404 otherwise) and active (400 otherwise). */
  private async activeDoctors(ids: string[]): Promise<Types.ObjectId[]> {
    const objectIds = ids.map((id) => new Types.ObjectId(id));
    const found = await this.users.model
      .find({ _id: { $in: objectIds }, role: ROLES.DOCTOR }, { active: 1 })
      .lean();
    const byId = new Map(found.map((d) => [String(d._id), d.active]));
    // Map keys are canonical lower-case hex; @IsMongoId also accepts upper case.
    const canonical = objectIds.map(String);

    if (canonical.some((id) => !byId.has(id))) throw new NotFoundException('Doctor not found');

    const inactive = canonical.filter((id) => byId.get(id) === false);
    if (inactive.length) {
      throw new ValidationFailedException(
        inactive.map((id) => ({
          field: 'doctorIds',
          code: DETAIL_CODES.NOT_ALLOWED,
          issue: `doctor ${id} is deactivated`,
        })),
      );
    }
    return objectIds;
  }
}
