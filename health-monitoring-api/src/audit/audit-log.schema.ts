import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { AUDIT_ACTIONS, AuditAction, ROLES, Role } from '../common/constants';

/**
 * Audit log, v1.1: "Each record holds actorId, actorRole, patientId (if any),
 * action, route, resourceId, before, after, requestId and at. Records are
 * never edited or deleted."
 *
 * There is deliberately no update or delete path to this collection.
 */
@Schema({ collection: 'auditLogs', timestamps: false })
export class AuditLog {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  actorId!: Types.ObjectId;

  @Prop({ required: true, enum: Object.values(ROLES) })
  actorRole!: Role;

  /** The patient the record is about, when there is one. */
  @Prop({ type: Types.ObjectId, default: null, index: true })
  patientId!: Types.ObjectId | null;

  @Prop({ required: true, enum: Object.values(AUDIT_ACTIONS), index: true })
  action!: AuditAction;

  /** e.g. "PUT /api/v1/me/vitals/today". */
  @Prop({ required: true })
  route!: string;

  @Prop({ type: String, default: null })
  resourceId!: string | null;

  @Prop({ type: Object, default: null })
  before!: unknown;

  @Prop({ type: Object, default: null })
  after!: unknown;

  @Prop({ type: String, default: null, index: true })
  requestId!: string | null;

  @Prop({ required: true })
  at!: Date;
}

export type AuditLogDocument = HydratedDocument<AuditLog>;
export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);
AuditLogSchema.index({ patientId: 1, at: -1 });
AuditLogSchema.index({ action: 1, at: -1 });
