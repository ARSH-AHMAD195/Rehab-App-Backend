import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { CARE_ALERT_KINDS, CareAlertKind } from '../common/constants';

export const CARE_ALERT_STATUS = { OPEN: 'OPEN', ACKNOWLEDGED: 'ACKNOWLEDGED' } as const;
export type CareAlertStatus = (typeof CARE_ALERT_STATUS)[keyof typeof CARE_ALERT_STATUS];

/**
 * One alert to a patient's whole care team. Any linked doctor sees it and
 * can acknowledge it, once (OPEN -> ACKNOWLEDGED, like Health Monitoring's
 * vital alerts).
 *
 * `key` names what the alert is about (this Hb result, this day's pulse);
 * one alert per patient and key, so nothing is raised twice and an
 * acknowledged alert never comes back for the same reading.
 */
@Schema({ collection: 'careAlerts', timestamps: true })
export class CareAlert {
  @Prop({ type: Types.ObjectId, required: true })
  patientId!: Types.ObjectId;

  @Prop({ required: true, enum: Object.values(CARE_ALERT_KINDS) })
  kind!: CareAlertKind;

  @Prop({ required: true })
  key!: string;

  /** What the doctor reads, e.g. "Hb 7.6 g/dL on 2026-11-08 (High: below 8)". */
  @Prop({ required: true })
  message!: string;

  @Prop({ type: Object, default: {} })
  details!: Record<string, unknown>;

  @Prop({ required: true, enum: Object.values(CARE_ALERT_STATUS), default: CARE_ALERT_STATUS.OPEN })
  status!: CareAlertStatus;

  @Prop({ type: Types.ObjectId, default: null })
  acknowledgedBy!: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  acknowledgedAt!: Date | null;

  @Prop({ type: String, default: null })
  note!: string | null;

  createdAt!: Date;
  updatedAt!: Date;
}

export type CareAlertDocument = HydratedDocument<CareAlert>;
export const CareAlertSchema = SchemaFactory.createForClass(CareAlert);
CareAlertSchema.index({ patientId: 1, key: 1 }, { unique: true });
// The inbox: by patient and status, newest first.
CareAlertSchema.index({ patientId: 1, status: 1, createdAt: -1, _id: -1 });

/**
 * READ-ONLY view of the Exercise API's `exerciseCompletions`, for the last
 * day a patient ticked or skipped an exercise. That API owns the collection
 * and its indexes; this one never writes to it.
 */
@Schema({ collection: 'exerciseCompletions', strict: false, autoIndex: false })
export class ExerciseCompletionView {
  @Prop({ type: Types.ObjectId }) patientId!: Types.ObjectId;
  @Prop() date!: string;
  @Prop() active!: boolean;
}

export const ExerciseCompletionViewSchema = SchemaFactory.createForClass(ExerciseCompletionView);
