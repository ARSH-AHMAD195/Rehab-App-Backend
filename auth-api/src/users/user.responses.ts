import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ROLES } from '../common/constants';
import { DEFAULT_DISPLAY_TIME_ZONE, toLocalIso, todayIn } from '../common/time';
import { daysUntil } from '../medical-profiles/derived';
import { MedicalProfile } from '../medical-profiles/medical-profile.schema';
import { UserDocument } from './user.schema';
import { UsersService } from './users.service';

export interface DoctorRef {
  id: string;
  name: string;
}

export interface ProfileResponse {
  id: string;
  role: string;
  name: string;
  email: string | null;
  phone: string | null;
  preferredLanguage: string;
  timeZone?: string | null;
  doctors?: DoctorRef[];
  specialization?: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface PatientResponse {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  timeZone: string | null;
  active: boolean;
  emailVerified: boolean;
  doctors: DoctorRef[];
  /** From the medical profile: shown on the doctor's patient list. */
  plannedSurgeryDate: string | null;
  /** Whole days from the patient's today; negative once surgery has passed. */
  daysToSurgery: number | null;
  createdAt: string | null;
}

export interface DoctorResponse {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  specialization: string | null;
  active: boolean;
  emailVerified: boolean;
  patientCount: number;
  createdAt: string | null;
}

export interface AdminResponse {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  active: boolean;
  emailVerified: boolean;
  createdAt: string | null;
}

/** Turns `users` documents into the response shapes of v1.0. */
@Injectable()
export class UserResponses {
  constructor(
    private readonly users: UsersService,
    @InjectModel(MedicalProfile.name) private readonly profiles: Model<MedicalProfile>,
  ) {}

  async profile(user: UserDocument): Promise<ProfileResponse> {
    const zone = user.timeZone;
    const base: ProfileResponse = {
      id: String(user._id),
      role: user.role,
      name: user.name,
      email: user.email,
      phone: user.phone ?? null,
      preferredLanguage: user.preferredLanguage ?? 'en',
      createdAt: toLocalIso(user.createdAt, zone),
      updatedAt: toLocalIso(user.updatedAt, zone),
    };
    if (user.role === ROLES.PATIENT) {
      const [patient] = await this.patients([user]);
      return { ...base, timeZone: user.timeZone ?? null, doctors: patient.doctors };
    }
    if (user.role === ROLES.DOCTOR) return { ...base, specialization: user.specialization ?? null };
    return base;
  }

  /** Patients, with their doctors' names and surgery dates looked up in one query each. */
  async patients(users: UserDocument[]): Promise<PatientResponse[]> {
    const doctorIds = [...new Set(users.flatMap((u) => u.doctorIds.map(String)))].map(
      (id) => new Types.ObjectId(id),
    );
    const [names, profiles] = await Promise.all([
      this.users.doctorNames(doctorIds),
      users.length
        ? this.profiles
            .find({ patientId: { $in: users.map((u) => u._id) } }, { patientId: 1, plannedSurgeryDate: 1 })
            .lean()
        : Promise.resolve([]),
    ]);
    const surgeryById = new Map(profiles.map((p) => [String(p.patientId), p.plannedSurgeryDate ?? null]));

    return users.map((user) => {
      const plannedSurgeryDate = surgeryById.get(String(user._id)) ?? null;
      return {
        ...this.patientBase(user, names),
        plannedSurgeryDate,
        daysToSurgery: daysUntil(plannedSurgeryDate, todayIn(user.timeZone || DEFAULT_DISPLAY_TIME_ZONE)),
        createdAt: toLocalIso(user.createdAt, user.timeZone),
      };
    });
  }

  private patientBase(user: UserDocument, names: Map<string, string>) {
    return {
      id: String(user._id),
      name: user.name,
      email: user.email,
      phone: user.phone ?? null,
      timeZone: user.timeZone ?? null,
      active: user.active,
      emailVerified: user.emailVerified ?? false,
      doctors: user.doctorIds.map((id) => ({ id: String(id), name: names.get(String(id)) ?? 'Unknown' })),
    };
  }

  /** Doctors, with `patientCount` (active linked patients) counted in one query. */
  async doctors(users: UserDocument[]): Promise<DoctorResponse[]> {
    const counts = await this.users.model
      .aggregate<{ _id: Types.ObjectId; count: number }>([
        { $match: { role: ROLES.PATIENT, active: true, doctorIds: { $in: users.map((u) => u._id) } } },
        { $unwind: '$doctorIds' },
        { $match: { doctorIds: { $in: users.map((u) => u._id) } } },
        { $group: { _id: '$doctorIds', count: { $sum: 1 } } },
      ])
      .exec();
    const countById = new Map(counts.map((c) => [String(c._id), c.count]));

    return users.map((user) => ({
      id: String(user._id),
      name: user.name,
      email: user.email,
      phone: user.phone ?? null,
      specialization: user.specialization ?? null,
      active: user.active,
      emailVerified: user.emailVerified ?? false,
      patientCount: countById.get(String(user._id)) ?? 0,
      createdAt: toLocalIso(user.createdAt),
    }));
  }

  admin(user: UserDocument): AdminResponse {
    return {
      id: String(user._id),
      name: user.name,
      email: user.email,
      phone: user.phone ?? null,
      active: user.active,
      emailVerified: user.emailVerified ?? false,
      createdAt: toLocalIso(user.createdAt),
    };
  }
}
