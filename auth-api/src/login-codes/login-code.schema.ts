import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ROLES, Role } from '../common/constants';

/**
 * One row per patient: their open "send me a code" request and/or the code
 * their doctor made. A new code replaces the old one, so a patient never has
 * two codes that work.
 *
 * The code itself is never stored, only its hash, and it is gone once used,
 * used up (too many wrong tries) or expired.
 */
@Schema({ collection: 'loginCodes', timestamps: true })
export class LoginCode {
  @Prop({ type: Types.ObjectId, required: true, unique: true })
  patientId!: Types.ObjectId;

  /** When the patient last asked for a code; cleared once a doctor makes one. */
  @Prop({ type: Date, default: null })
  requestedAt!: Date | null;

  /** sha256 of "<patientId>:<code>"; null when there is no working code. */
  @Prop({ type: String, default: null })
  codeHash!: string | null;

  @Prop({ type: Date, default: null })
  codeExpiresAt!: Date | null;

  /** Tries against the current code, right or wrong. */
  @Prop({ default: 0 })
  attempts!: number;

  @Prop({ type: { id: Types.ObjectId, role: { type: String, enum: Object.values(ROLES) } }, default: null, _id: false })
  issuedBy!: { id: Types.ObjectId; role: Role } | null;

  /** MongoDB deletes the row after this, so stale requests and codes clean themselves up. */
  @Prop({ type: Date, required: true })
  deleteAt!: Date;

  createdAt!: Date;
  updatedAt!: Date;
}

export type LoginCodeDocument = HydratedDocument<LoginCode>;
export const LoginCodeSchema = SchemaFactory.createForClass(LoginCode);

LoginCodeSchema.index({ deleteAt: 1 }, { expireAfterSeconds: 0 });
// The doctor's list of open requests, newest first.
LoginCodeSchema.index({ requestedAt: -1 });
