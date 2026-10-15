import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Role, ROLES } from '../common/constants';
import { User, UserDocument } from './user.schema';

/** The caller, as every guard and service below sees them. */
export interface AuthUser {
  id: string;
  role: Role;
  name: string;
  /** Resolved zone: profile value, else DEFAULT_TIME_ZONE. */
  timeZone: string;
  doctorIds: string[];
}

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private readonly users: Model<User>,
    private readonly config: ConfigService,
  ) {}

  async findByFirebaseUid(uid: string): Promise<AuthUser | null> {
    const user = await this.users.findOne({ firebaseUid: uid, active: true }).lean();
    return user ? this.toAuthUser(user as UserDocument) : null;
  }

  /**
   * Doctor endpoints, v1.1: "PatientAccessGuard returns 404 when the patient
   * isn't linked to the calling doctor, so the doctor can't tell whether that
   * patient exists." One query answers both questions, so the two cases are
   * indistinguishable from outside.
   */
  async isPatientLinkedToDoctor(patientId: string, doctorId: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(patientId)) return false;
    const match = await this.users
      .exists({
        _id: new Types.ObjectId(patientId),
        role: ROLES.PATIENT,
        active: true,
        doctorIds: new Types.ObjectId(doctorId),
      })
      .exec();
    return match !== null;
  }

  /** Doctors linked to a patient: the `doctorIds` carried on vitals.alert.raised. */
  async doctorIdsForPatient(patientId: string): Promise<string[]> {
    const patient = await this.users
      .findOne({ _id: new Types.ObjectId(patientId) }, { doctorIds: 1 })
      .lean();
    return (patient?.doctorIds ?? []).map((id) => id.toString());
  }

  async getPatient(patientId: string): Promise<AuthUser | null> {
    if (!Types.ObjectId.isValid(patientId)) return null;
    const patient = await this.users
      .findOne({ _id: new Types.ObjectId(patientId), role: ROLES.PATIENT })
      .lean();
    return patient ? this.toAuthUser(patient as UserDocument) : null;
  }

  /** Patient ids for a doctor's alert queue ("alerts across the doctor's patients"). */
  async patientIdsForDoctor(doctorId: string): Promise<Types.ObjectId[]> {
    const patients = await this.users
      .find(
        { role: ROLES.PATIENT, active: true, doctorIds: new Types.ObjectId(doctorId) },
        { _id: 1 },
      )
      .lean();
    return patients.map((p) => p._id as Types.ObjectId);
  }

  /**
   * Name and time zone for a set of patients: the doctor's alert queue shows
   * the patient's name, and timestamps are rendered with the patient's offset.
   */
  async profilesByIds(
    ids: Types.ObjectId[],
  ): Promise<Map<string, { name: string; timeZone: string }>> {
    if (!ids.length) return new Map();
    const fallback = this.config.get<string>('DEFAULT_TIME_ZONE', 'Asia/Kolkata');
    const users = await this.users.find({ _id: { $in: ids } }, { name: 1, timeZone: 1 }).lean();
    return new Map(
      users.map((u) => [String(u._id), { name: u.name, timeZone: u.timeZone || fallback }]),
    );
  }

  private toAuthUser(user: UserDocument): AuthUser {
    return {
      id: String(user._id),
      role: user.role,
      name: user.name,
      timeZone: user.timeZone || this.config.get<string>('DEFAULT_TIME_ZONE', 'Asia/Kolkata'),
      doctorIds: (user.doctorIds ?? []).map((id) => id.toString()),
    };
  }
}
