import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ROLES, Role } from '../common/constants';

/**
 * OWNED BY THE AUTH API, NOT THIS ONE.
 *
 * This API only reads the six fields below - the same ones Health Monitoring
 * reads - and never writes to `users`.
 *
 * autoIndex is off: the indexes on this collection are Auth's to define, and
 * building our own copy of them could clash with theirs.
 */
@Schema({ collection: 'users', timestamps: true, autoIndex: false })
export class User {
  /** Firebase `uid` from the verified ID token. */
  @Prop({ required: true })
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
