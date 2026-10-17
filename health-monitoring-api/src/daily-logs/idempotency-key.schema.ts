import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

/** How long a key is remembered: long enough for any client retry. */
export const IDEMPOTENCY_KEY_TTL_SECONDS = 24 * 60 * 60;

/**
 * One Idempotency-Key a patient sent with PUT /me/vitals/today: the request it
 * was used for and, once that finished, the answer to give its retries.
 */
@Schema({ collection: 'idempotencyKeys' })
export class IdempotencyKey {
  @Prop({ type: Types.ObjectId, required: true })
  patientId!: Types.ObjectId;

  @Prop({ required: true })
  key!: string;

  /** SHA-256 of the request body, so a key reused for a different save is caught. */
  @Prop({ required: true })
  requestHash!: string;

  /** Null while the first request is still running. */
  @Prop({ type: Object, default: null })
  response!: Record<string, unknown> | null;

  /** When the running request took the key; a stale one was abandoned by a crash. */
  @Prop({ required: true })
  claimedAt!: Date;

  @Prop({ required: true, default: () => new Date(), expires: IDEMPOTENCY_KEY_TTL_SECONDS })
  createdAt!: Date;
}

export type IdempotencyKeyDocument = HydratedDocument<IdempotencyKey>;
export const IdempotencyKeySchema = SchemaFactory.createForClass(IdempotencyKey);
// Keys are per patient: two patients' apps may well generate the same one.
IdempotencyKeySchema.index({ patientId: 1, key: 1 }, { unique: true });
