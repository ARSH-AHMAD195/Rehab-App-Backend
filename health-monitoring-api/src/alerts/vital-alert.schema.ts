import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  ALERT_RULES,
  ALERT_STATUS,
  AlertRule,
  AlertStatus,
  SEVERITIES,
  Severity,
} from '../common/constants';

/**
 * A raised alert (v1.1, Alert lifecycle).
 *
 * De-duplication: "At most one alert per patient, parameter, field and day."
 * A new alert for the same day is raised only once the earlier one is
 * acknowledged, which the partial unique index below enforces.
 */
@Schema({ collection: 'vitalAlerts', timestamps: true })
export class VitalAlert {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  patientId!: Types.ObjectId;

  /** The patient's local day the reading belongs to. */
  @Prop({ required: true })
  date!: string;

  @Prop({ required: true })
  type!: string;

  /** BP only: which field crossed. Null otherwise. */
  @Prop({ type: String, default: null })
  field!: string | null;

  /** The reading that crossed the limit, kept as saved. */
  @Prop({ type: Object, required: true })
  value!: Record<string, unknown>;

  @Prop({ required: true, enum: Object.values(ALERT_RULES) })
  rule!: AlertRule;

  @Prop({ required: true })
  threshold!: number;

  @Prop({ type: Types.ObjectId, required: true })
  thresholdId!: Types.ObjectId;

  /** Traceability: later threshold changes never recompute this alert. */
  @Prop({ required: true })
  thresholdVersion!: number;

  @Prop({ required: true, enum: Object.values(SEVERITIES) })
  severity!: Severity;

  @Prop({ required: true, enum: Object.values(ALERT_STATUS), default: ALERT_STATUS.OPEN })
  status!: AlertStatus;

  @Prop({ type: Types.ObjectId, default: null })
  acknowledgedBy!: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  acknowledgedAt!: Date | null;

  /** Set once when acknowledging; it cannot be edited afterwards. */
  @Prop({ type: String, default: null })
  note!: string | null;

  createdAt!: Date;
  updatedAt!: Date;
}

export type VitalAlertDocument = HydratedDocument<VitalAlert>;
export const VitalAlertSchema = SchemaFactory.createForClass(VitalAlert);

// At most one OPEN alert per patient, parameter, field and day.
VitalAlertSchema.index(
  { patientId: 1, date: 1, type: 1, field: 1 },
  { unique: true, partialFilterExpression: { status: ALERT_STATUS.OPEN } },
);
// The doctor queue: newest first, filtered by status and patient.
VitalAlertSchema.index({ patientId: 1, status: 1, createdAt: -1 });
