import { Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import { ROLES, Role } from '../common/constants';
import { DoctorHasPatientsException } from '../common/api.exception';
import { RegistrationService } from '../registration/registration.service';
import { AccountsService } from '../users/accounts.service';
import { listUsers } from '../users/user-directory';
import { RegisterDoctorDto, UpdateDoctorDto, UserListQueryDto } from '../users/user.dto';
import { DoctorResponse, UserResponses } from '../users/user.responses';
import { UsersService } from '../users/users.service';

type Actor = { id: string; role: Role };

@Injectable()
export class DoctorsService {
  constructor(
    private readonly users: UsersService,
    private readonly accounts: AccountsService,
    private readonly registration: RegistrationService,
    private readonly responses: UserResponses,
  ) {}

  async register(actor: Actor, dto: RegisterDoctorDto): Promise<DoctorResponse & { invitation: string }> {
    const { user, invitation } = await this.registration.register({ ...dto, role: ROLES.DOCTOR }, actor);
    const [doctor] = await this.responses.doctors([user]);
    return { ...doctor, invitation };
  }

  async list(query: UserListQueryDto): Promise<{ data: DoctorResponse[]; nextCursor: string | null }> {
    const { rows, nextCursor } = await listUsers(this.users.model, ROLES.DOCTOR, query);
    return { data: await this.responses.doctors(rows), nextCursor };
  }

  async get(doctorId: string): Promise<DoctorResponse> {
    const doctor = await this.users.getByRole(doctorId, ROLES.DOCTOR, 'Doctor not found');
    const [response] = await this.responses.doctors([doctor]);
    return response;
  }

  async update(actor: Actor, doctorId: string, dto: UpdateDoctorDto): Promise<DoctorResponse> {
    const doctor = await this.users.getByRole(doctorId, ROLES.DOCTOR, 'Doctor not found');
    if (dto.active === false && doctor.active) await this.assertNotSoleDoctor(doctor._id);

    const { active, ...changes } = dto;
    const updated = await this.accounts.update(actor, doctor, changes, active);
    const [response] = await this.responses.doctors([updated]);
    return response;
  }

  /**
   * v1.0: a doctor who is the only active doctor of any active patient can't
   * be deactivated - that patient would be left with nobody to review them.
   */
  private async assertNotSoleDoctor(doctorId: Types.ObjectId): Promise<void> {
    const patients = await this.users.model
      .find({ role: ROLES.PATIENT, active: true, doctorIds: doctorId }, { doctorIds: 1 })
      .lean();
    if (!patients.length) return;

    const otherIds = [...new Set(patients.flatMap((p) => p.doctorIds.map(String)))].filter(
      (id) => id !== String(doctorId),
    );
    const activeOthers = new Set(
      (
        await this.users.model
          .find({ _id: { $in: otherIds.map((id) => new Types.ObjectId(id)) }, role: ROLES.DOCTOR, active: true }, { _id: 1 })
          .lean()
      ).map((d) => String(d._id)),
    );

    const stranded = patients.filter((p) => !p.doctorIds.some((id) => activeOthers.has(String(id))));
    if (stranded.length) throw new DoctorHasPatientsException(stranded.length);
  }
}
