import { Injectable } from '@nestjs/common';
import { ClientSession, FilterQuery, Types } from 'mongoose';
import { AUDIT_ACTIONS, DEFAULT_PATIENT_TIME_ZONE, DETAIL_CODES, MAX_DOCTORS_PER_PATIENT, ROLES, Role } from '../common/constants';
import {
  ConcurrentUpdateException,
  ErrorDetail,
  ForbiddenRoleException,
  LastDoctorException,
  NotFoundException,
  ValidationFailedException,
} from '../common/api.exception';
import { TransactionRunner } from '../common/mongo/transaction.runner';
import { isValidTimeZone } from '../common/time';
import { AuditService } from '../audit/audit.service';
import { RegistrationService } from '../registration/registration.service';
import { AccountsService } from '../users/accounts.service';
import { listUsers } from '../users/user-directory';
import { User, UserDocument } from '../users/user.schema';
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
    if (!dto.email && !dto.phone) {
      details.push({
        field: 'phone',
        code: DETAIL_CODES.REQUIRED,
        issue: 'a patient needs a phone number (to sign in with a code from their doctor) or an email',
      });
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
        email: dto.email ?? null,
        phone: dto.phone ?? null,
        timeZone: dto.timeZone ?? DEFAULT_PATIENT_TIME_ZONE,
        doctorIds,
      },
      actor,
    );
    const [patient] = await this.responses.patients([user]);
    return { ...patient, invitation };
  }

  /** GET /patients: every patient (a doctor may narrow it to their own with scope=mine). */
  async list(actor: Actor, query: PatientListQueryDto): Promise<{ data: PatientResponse[]; nextCursor: string | null }> {
    if (query.doctorId && actor.role !== ROLES.ADMIN) {
      throw new ValidationFailedException([
        { field: 'doctorId', code: DETAIL_CODES.NOT_ALLOWED, issue: 'is an admin-only filter' },
      ]);
    }
    if (query.scope && actor.role !== ROLES.DOCTOR) {
      throw new ValidationFailedException([
        { field: 'scope', code: DETAIL_CODES.NOT_ALLOWED, issue: 'is a doctor-only filter; admins use doctorId' },
      ]);
    }
    const scope: FilterQuery<User> =
      actor.role === ROLES.DOCTOR
        ? query.scope === 'mine'
          ? { doctorIds: new Types.ObjectId(actor.id) }
          : {}
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

    let saved = patient;
    if (!unchanged) {
      saved = await this.tx.run(async (session) => {
        await this.users.lockActiveDoctors(doctorIds, session);
        const updated = await this.users.model
          .findOneAndUpdate({ _id: patient._id }, { $set: { doctorIds } }, { new: true, session })
          .exec();
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
        return updated!;
      });
    }

    const [response] = await this.responses.patients([saved]);
    return response;
  }

  /**
   * PUT /patients/:patientId/doctors/me: the calling doctor adds the patient to
   * "my patients" (their alerts and login-code requests reach this doctor's
   * inbox). Doing it again changes nothing.
   */
  async linkMe(doctor: Actor, patientId: string): Promise<PatientResponse> {
    const patient = await this.users.getByRole(patientId, ROLES.PATIENT, 'Patient not found');
    if (patient.doctorIds.some((id) => String(id) === doctor.id)) return this.respond(patient);
    if (patient.doctorIds.length >= MAX_DOCTORS_PER_PATIENT) {
      throw new ValidationFailedException([
        { field: 'doctorIds', code: DETAIL_CODES.OUT_OF_RANGE, issue: `a patient can have at most ${MAX_DOCTORS_PER_PATIENT} doctors` },
      ]);
    }
    const me = new Types.ObjectId(doctor.id);
    const saved = await this.tx.run(async (session) => {
      const updated = await this.users.model
        .findOneAndUpdate(
          { _id: patient._id, [`doctorIds.${MAX_DOCTORS_PER_PATIENT - 1}`]: { $exists: false } },
          { $addToSet: { doctorIds: me } },
          { new: true, session },
        )
        .exec();
      if (!updated) throw new ConcurrentUpdateException();
      await this.recordLinks(doctor, patient, updated, session);
      return updated;
    });
    return this.respond(saved);
  }

  /**
   * DELETE /patients/:patientId/doctors/me: the calling doctor takes the patient
   * off "my patients". They can still open the chart. Refused with 409
   * LAST_DOCTOR when no doctor would be left. Doing it again changes nothing.
   */
  async unlinkMe(doctor: Actor, patientId: string): Promise<PatientResponse> {
    const patient = await this.users.getByRole(patientId, ROLES.PATIENT, 'Patient not found');
    if (!patient.doctorIds.some((id) => String(id) === doctor.id)) return this.respond(patient);
    if (patient.doctorIds.length <= 1) throw new LastDoctorException();
    const me = new Types.ObjectId(doctor.id);
    const saved = await this.tx.run(async (session) => {
      // Only while another doctor stays on: two doctors leaving at once can't strand the patient.
      const updated = await this.users.model
        .findOneAndUpdate({ _id: patient._id, doctorIds: me, 'doctorIds.1': { $exists: true } }, { $pull: { doctorIds: me } }, { new: true, session })
        .exec();
      if (!updated) throw new LastDoctorException();
      await this.recordLinks(doctor, patient, updated, session);
      return updated;
    });
    return this.respond(saved);
  }

  private recordLinks(actor: Actor, before: UserDocument, after: UserDocument, session: ClientSession) {
    return this.audit.record(
      {
        actor,
        action: AUDIT_ACTIONS.DOCTOR_LINKS_CHANGED,
        patientId: before._id,
        resourceId: String(before._id),
        before: { doctorIds: before.doctorIds.map(String) },
        after: { doctorIds: after.doctorIds.map(String) },
      },
      session,
    );
  }

  private async respond(patient: UserDocument): Promise<PatientResponse> {
    const [response] = await this.responses.patients([patient]);
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
    // The same doctor sent twice in different letter case is still one doctor:
    // dedupe by canonical id, or lockActiveDoctors's modifiedCount check (one
    // document written) would not match ids.length (two entries) and wrongly
    // report a concurrent deactivation.
    return [...new Map(objectIds.map((id) => [String(id), id])).values()];
  }
}
