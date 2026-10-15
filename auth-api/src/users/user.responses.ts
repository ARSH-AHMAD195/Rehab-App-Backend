import { Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import { ROLES } from '../common/constants';
import { toLocalIso } from '../common/time';
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
  constructor(private readonly users: UsersService) {}

  async profile(user: UserDocument): Promise<ProfileResponse> {
    const zone = user.timeZone;
    const base: ProfileResponse = {
      id: String(user._id),
      role: user.role,
      name: user.name,
      email: user.email,
      phone: user.phone ?? null,
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

  /** Patients, with their doctors' names looked up in one query. */
  async patients(users: UserDocument[]): Promise<PatientResponse[]> {
    const doctorIds = [...new Set(users.flatMap((u) => u.doctorIds.map(String)))].map(
      (id) => new Types.ObjectId(id),
    );
    const names = await this.users.doctorNames(doctorIds);

    return users.map((user) => ({
      id: String(user._id),
      name: user.name,
      email: user.email,
      phone: user.phone ?? null,
      timeZone: user.timeZone ?? null,
      active: user.active,
      emailVerified: user.emailVerified ?? false,
      doctors: user.doctorIds.map((id) => ({ id: String(id), name: names.get(String(id)) ?? 'Unknown' })),
      createdAt: toLocalIso(user.createdAt, user.timeZone),
    }));
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
