import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { SEVERITIES, Severity } from '../common/constants';

/**
 * Alert limits, global or per patient (v1.1, PUT /admin/alert-thresholds/:type).
 *
 * Versioning: "Each save creates a new version with effectiveFrom set to now.
 * Earlier versions are kept, not overwritten." So rows are append-only and the
 * live row carries isCurrent - which also lets an alert keep the thresholdId
 * and thresholdVersion it was raised under, as Traceability requires.
 */
@Schema({ collection: 'alertThresholds', timestamps: true })
export class AlertThreshold {
  @Prop({ required: true, index: true })
  type!: string;

  /** BP only: "systolic" or "diastolic". Null for every other parameter. */
  @Prop({ type: String, default: null })
  field!: string | null;

  /** Null means the global default; set means an override for that patient. */
  @Prop({ type: Types.ObjectId, default: null, index: true })
  patientId!: Types.ObjectId | null;

  @Prop({ type: Number, default: null })
  low!: number | null;

  @Prop({ type: Number, default: null })
  high!: number | null;

  @Prop({ required: true, enum: Object.values(SEVERITIES) })
  severity!: Severity;

  @Prop({ required: true, default: 1 })
  version!: number;

  @Prop({ required: true })
  effectiveFrom!: Date;

  /** The live version of this (type, field, patient) rule. */
  @Prop({ required: true, default: true })
  isCurrent!: boolean;

  @Prop({ type: Types.ObjectId, required: true })
  updatedBy!: Types.ObjectId;
}

export type AlertThresholdDocument = HydratedDocument<AlertThreshold>;
export const AlertThresholdSchema = SchemaFactory.createForClass(AlertThreshold);

// One live rule per scope. The partial filter lets the superseded versions
// stay in the collection.
AlertThresholdSchema.index(
  { type: 1, field: 1, patientId: 1, isCurrent: 1 },
  { unique: true, partialFilterExpression: { isCurrent: true } },
);
AlertThresholdSchema.index({ type: 1, patientId: 1, version: -1 });
