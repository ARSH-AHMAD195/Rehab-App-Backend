import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { ROLES, Role } from '../common/constants';
import { ConcurrentUpdateException, NotFoundException } from '../common/api.exception';
import { User, UserDocument } from './user.schema';

/** ObjectId for a path parameter, or null when it isn't one (callers 404). */
export function toObjectId(value: string): Types.ObjectId | null {
  return Types.ObjectId.isValid(value) && String(new Types.ObjectId(value)) === value
    ? new Types.ObjectId(value)
    : null;
}

/**
 * Reads of `users` shared by every controller. Writes live in the services that
 * own them, except the two transaction locks below.
 */
@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) readonly model: Model<User>) {}

  /**
   * In a transaction that links a patient to these doctors: fails unless each
   * is still an active doctor, and writes to each one. A read alone would not
   * conflict with a concurrent deactivation; the write does, so one of the two
   * transactions is retried and sees the other's result.
   */
  async lockActiveDoctors(ids: Types.ObjectId[], session: ClientSession): Promise<void> {
    const { modifiedCount } = await this.model
      .updateMany(
        { _id: { $in: ids }, role: ROLES.DOCTOR, active: true },
        { $inc: { lockVersion: 1 } },
        { session, timestamps: false },
      )
      .exec();
    if (modifiedCount !== ids.length) {
      throw new ConcurrentUpdateException('A doctor was deactivated while saving. Reload and retry.');
    }
  }

  /** Writes to these users only so that a concurrent transaction touching them conflicts with this one. */
  async lock(ids: Types.ObjectId[], session: ClientSession): Promise<void> {
    if (!ids.length) return;
    await this.model
      .updateMany({ _id: { $in: ids } }, { $inc: { lockVersion: 1 } }, { session, timestamps: false })
      .exec();
  }

  findActiveByFirebaseUid(uid: string): Promise<UserDocument | null> {
    return this.model.findOne({ firebaseUid: uid, active: true }).exec();
  }

  emailTaken(email: string, session?: ClientSession): Promise<boolean> {
    return this.model
      .exists({ email: email.toLowerCase() })
      .session(session ?? null)
      .then((found) => found !== null);
  }

  /** A user of the given role, or 404. */
  async getByRole(id: string, role: Role, message: string): Promise<UserDocument> {
    const objectId = toObjectId(id);
    const user = objectId ? await this.model.findOne({ _id: objectId, role }).exec() : null;
    if (!user) throw new NotFoundException(message);
    return user;
  }

  /**
   * A patient the caller may manage: any patient for an admin, a linked one
   * for a doctor. Unknown and unlinked look the same - 404 - so a doctor
   * can't tell whether a patient exists (v1.0, Access rules).
   */
  async getPatientFor(caller: { id: string; role: Role }, patientId: string): Promise<UserDocument> {
    const patient = await this.getByRole(patientId, ROLES.PATIENT, 'Patient not found');
    if (caller.role === ROLES.DOCTOR && !patient.doctorIds.some((id) => String(id) === caller.id)) {
      throw new NotFoundException('Patient not found');
    }
    return patient;
  }

  /** Names of the given doctors, for the `doctors: [{ id, name }]` fields. */
  async doctorNames(ids: Types.ObjectId[]): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const doctors = await this.model.find({ _id: { $in: ids }, role: ROLES.DOCTOR }, { name: 1 }).lean();
    return new Map(doctors.map((d) => [String(d._id), d.name]));
  }
}
