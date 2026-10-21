import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { IANAZone } from 'luxon';
import { Model, Types } from 'mongoose';
import { ROLES, Role } from '../common/constants';
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
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectModel(User.name) private readonly users: Model<User>,
    private readonly config: ConfigService,
  ) {}

  /** Deactivated accounts are not found, so they are refused at the door. */
  async findByFirebaseUid(uid: string): Promise<AuthUser | null> {
    const user = await this.users.findOne({ firebaseUid: uid, active: true }).lean();
    return user ? this.toAuthUser(user as UserDocument) : null;
  }

  /**
   * A doctor reaches only patients linked to them. One query answers both
   * "does this patient exist" and "is it linked", so an unlinked patient and
   * a missing one look the same from outside (both 404).
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

  async getPatient(patientId: string): Promise<AuthUser | null> {
    if (!Types.ObjectId.isValid(patientId)) return null;
    const patient = await this.users
      .findOne({ _id: new Types.ObjectId(patientId), role: ROLES.PATIENT })
      .lean();
    return patient ? this.toAuthUser(patient as UserDocument) : null;
  }

  private toAuthUser(user: UserDocument): AuthUser {
    return {
      id: String(user._id),
      role: user.role,
      name: user.name,
      timeZone: this.zoneOf(user._id, user.timeZone),
      doctorIds: (user.doctorIds ?? []).map((id) => id.toString()),
    };
  }

  /**
   * The profile's zone if it is a real IANA zone, else DEFAULT_TIME_ZONE.
   * `users` is written by the Auth API, so a bad value is possible here;
   * checking it once means no caller sees it.
   */
  private zoneOf(userId: unknown, zone: string | null | undefined): string {
    const fallback = this.config.get<string>('DEFAULT_TIME_ZONE', 'Asia/Kolkata');
    if (!zone) return fallback;
    if (IANAZone.isValidZone(zone)) return zone;
    this.logger.warn(`User ${String(userId)} has time zone "${zone}", which is not IANA; using ${fallback}`);
    return fallback;
  }
}
