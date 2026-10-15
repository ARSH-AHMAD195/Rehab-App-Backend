import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ROLES, Role } from '../common/constants';

/**
 * `users` - owned by this module.
 *
 * Health Monitoring reads this same collection for the caller's role, a
 * patient's time zone and the patient-doctor links. The fields it reads
 * (firebaseUid, role, name, timeZone, doctorIds, active) keep their names and
 * meaning; everything else here is additive.
 */
@Schema({ collection: 'users', timestamps: true })
export class User {
  /** Firebase `uid`, from the verified ID token. */
  @Prop({ required: true, unique: true, index: true })
  firebaseUid!: string;

  @Prop({ required: true, enum: Object.values(ROLES) })
  role!: Role;

  @Prop({ required: true })
  name!: string;

  /** Stored in lower case. Unique - see the index below. */
  @Prop({ type: String, default: null })
  email!: string | null;

  /** E.164, e.g. +919876543210. */
  @Prop({ type: String, default: null })
  phone!: string | null;

  /** IANA zone, e.g. "Asia/Kolkata". Patients only. */
  @Prop({ type: String })
  timeZone?: string;

  /** Patients only: the doctors this patient is linked to. */
  @Prop({ type: [Types.ObjectId], default: [] })
  doctorIds!: Types.ObjectId[];

  /** Doctors only. */
  @Prop({ type: String, default: null })
  specialization!: string | null;

  @Prop({ default: true })
  active!: boolean;

  /**
   * Last value seen in this user's own token. Firebase is the source of truth;
   * this copy lets lists show it without one Firebase call per row. Refreshed
   * by the auth guard whenever the user calls the API.
   */
  @Prop({ default: false })
  emailVerified!: boolean;

  /** Who registered this user; null for the first admin, made by script. */
  @Prop({ type: Types.ObjectId, default: null })
  createdBy!: Types.ObjectId | null;

  createdAt!: Date;
  updatedAt!: Date;
}

export type UserDocument = HydratedDocument<User>;
export const UserSchema = SchemaFactory.createForClass(User);

// Partial: users seeded by Health Monitoring before this module existed have
// no email, and a plain unique index would treat all of them as one duplicate.
UserSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { email: { $type: 'string' } } },
);
UserSchema.index({ role: 1, doctorIds: 1 });
UserSchema.index({ role: 1, active: 1, name: 1 });
