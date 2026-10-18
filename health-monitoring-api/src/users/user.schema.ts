import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ROLES, Role } from '../common/constants';

/**
 * OWNED BY THE AUTH MODULE, NOT THIS ONE.
 *
 * The architecture plan says this module "needs only login (user ID and role)
 * from the Auth module", but v1.1 also needs two things that live on the
 * profile: the patient's IANA time zone (Day and time zone) and the
 * patient-doctor link (PatientAccessGuard). Until the Auth module exists this
 * module reads them from `users`.
 *
 * This module never writes to this collection. When Auth ships, point
 * UsersService at their collection and delete the seed.
 */
@Schema({ collection: 'users', timestamps: true })
export class User {
  /** Firebase `uid` from the verified ID token. */
  @Prop({ required: true, unique: true, index: true })
  firebaseUid!: string;

  @Prop({ required: true, enum: Object.values(ROLES) })
  role!: Role;

  @Prop({ required: true })
  name!: string;

  /** IANA zone, e.g. "Asia/Kolkata". Patients only; falls back to DEFAULT_TIME_ZONE. */
  @Prop()
  timeZone?: string;

  /** Patients only: the doctors this patient is linked to. */
  @Prop({ type: [Types.ObjectId], default: [] })
  doctorIds!: Types.ObjectId[];

  @Prop({ default: true })
  active!: boolean;
}

export type UserDocument = HydratedDocument<User>;
export const UserSchema = SchemaFactory.createForClass(User);
UserSchema.index({ role: 1, doctorIds: 1 });
