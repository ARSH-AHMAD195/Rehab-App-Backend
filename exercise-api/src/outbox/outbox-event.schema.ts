import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { EVENT_SCHEMA_VERSION, EVENT_TYPES, EventType } from '../common/constants';

export const OUTBOX_STATUS = {
  PENDING: 'PENDING',
  PUBLISHED: 'PUBLISHED',
  DEAD_LETTER: 'DEAD_LETTER',
} as const;
export type OutboxStatus = (typeof OUTBOX_STATUS)[keyof typeof OUTBOX_STATUS];

/**
 * Same envelope as Health Monitoring's events:
 * { eventId, type, schemaVersion, occurredAt, patientId, requestId, data }
 *
 * Written inside the change's transaction and published only after it
 * commits, which makes delivery at-least-once without ever announcing a
 * change that was rolled back.
 *
 * Its own collection, not Health Monitoring's `outboxEvents`: each API's
 * publisher claims every pending event in its collection, so sharing one
 * would have each API sending the other's events.
 */
@Schema({ collection: 'exerciseOutboxEvents', timestamps: true })
export class OutboxEvent {
  @Prop({ required: true, enum: Object.values(EVENT_TYPES), index: true })
  type!: EventType;

  @Prop({ required: true, default: EVENT_SCHEMA_VERSION })
  schemaVersion!: number;

  @Prop({ required: true })
  occurredAt!: Date;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  patientId!: Types.ObjectId;

  @Prop({ type: String, default: null })
  requestId!: string | null;

  @Prop({ type: Object, required: true })
  data!: Record<string, unknown>;

  @Prop({ required: true, enum: Object.values(OUTBOX_STATUS), default: OUTBOX_STATUS.PENDING })
  status!: OutboxStatus;

  @Prop({ required: true, default: 0 })
  attempts!: number;

  /** When the publisher may next try. Set by the backoff schedule. */
  @Prop({ required: true, default: () => new Date() })
  nextAttemptAt!: Date;

  @Prop({ type: String, default: null })
  lastError!: string | null;

  @Prop({ type: Date, default: null })
  publishedAt!: Date | null;

  /** First attempt time, used for the 24-hour give-up window. */
  @Prop({ required: true, default: () => new Date() })
  firstQueuedAt!: Date;
}

export type OutboxEventDocument = HydratedDocument<OutboxEvent>;
export const OutboxEventSchema = SchemaFactory.createForClass(OutboxEvent);
OutboxEventSchema.index({ status: 1, nextAttemptAt: 1 });
