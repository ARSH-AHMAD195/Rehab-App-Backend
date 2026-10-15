import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { AuditAction, ROLES, Role } from '../common/constants';

/**
 * Audit log - the same `auditLogs` collection and record shape as Health
 * Monitoring: actorId, actorRole, patientId (if any), action, route,
 * resourceId, before, after, requestId and at. Records are never edited or
 * deleted.
 *
 * `action` is not enum-checked here: both modules write to this collection,
 * each with its own actions.
 */
@Schema({ collection: 'auditLogs', timestamps: false })
export class AuditLog {
  /** Null only for records written by a command-line script. */
  @Prop({ type: Types.ObjectId, default: null, index: true })
  actorId!: Types.ObjectId | null;

  @Prop({ type: String, enum: [...Object.values(ROLES), 'SYSTEM'], required: true })
  actorRole!: Role | 'SYSTEM';

  @Prop({ type: Types.ObjectId, default: null, index: true })
  patientId!: Types.ObjectId | null;

  @Prop({ required: true, index: true })
  action!: AuditAction;

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
AuditLogSchema.index({ action: 1, resourceId: 1, at: -1 });
