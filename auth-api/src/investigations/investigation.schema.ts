import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ROLES, Role } from '../common/constants';

export const RESULT_STATUS = { ACTIVE: 'ACTIVE', RETRACTED: 'RETRACTED' } as const;
export type ResultStatus = (typeof RESULT_STATUS)[keyof typeof RESULT_STATUS];

const ActorSchema = { id: Types.ObjectId, role: { type: String, enum: Object.values(ROLES) } };

/**
 * One investigation result: one test, on one date, for one patient. Repeat
 * tests are new rows, so the history (2-3 serial values on a PAC sheet, or
 * more) is always there.
 *
 * Results are never edited or deleted. A wrong entry is retracted (with a
 * reason) and kept, and the right value entered as a new result.
 */
@Schema({ collection: 'investigations', timestamps: true })
export class Investigation {
  @Prop({ type: Types.ObjectId, required: true })
  patientId!: Types.ObjectId;

  /** A code from INVESTIGATION_TESTS. */
  @Prop({ required: true })
  test!: string;

  /** The day the sample was taken or the test done (YYYY-MM-DD), not the day it was typed in. */
  @Prop({ required: true })
  takenOn!: string;

  /** Field key -> value, as the test's definition describes. Empty when wnl. */
  @Prop({ type: Object, default: {} })
  values!: Record<string, number | string>;

  /** "Within normal limits" quick entry, for the tests that allow it. */
  @Prop({ default: false })
  wnl!: boolean;

  @Prop({ type: String, default: null })
  comment!: string | null;

  @Prop({ required: true, enum: Object.values(RESULT_STATUS), default: RESULT_STATUS.ACTIVE })
  status!: ResultStatus;

  @Prop({ type: ActorSchema, required: true, _id: false })
  enteredBy!: { id: Types.ObjectId; role: Role };

  @Prop({
    type: { reason: String, by: ActorSchema, at: Date },
    default: null,
    _id: false,
  })
  retraction!: { reason: string; by: { id: Types.ObjectId; role: Role }; at: Date } | null;

  createdAt!: Date;
  updatedAt!: Date;
}

export type InvestigationDocument = HydratedDocument<Investigation>;
export const InvestigationSchema = SchemaFactory.createForClass(Investigation);

// A patient's grid: per test, newest first.
InvestigationSchema.index({ patientId: 1, test: 1, takenOn: -1, createdAt: -1 });

/**
 * The approved normal range for one numeric field of one test, set by an
 * admin from the clinical team's values. Nothing is flagged until a range
 * exists. Changes are kept in the audit log (before and after).
 */
@Schema({ collection: 'investigationRanges', timestamps: true })
export class InvestigationRange {
  @Prop({ required: true })
  test!: string;

  @Prop({ required: true })
  field!: string;

  @Prop({ type: Number, default: null })
  low!: number | null;

  @Prop({ type: Number, default: null })
  high!: number | null;

  @Prop({ type: Types.ObjectId, required: true })
  updatedBy!: Types.ObjectId;

  createdAt!: Date;
  updatedAt!: Date;
}

export type InvestigationRangeDocument = HydratedDocument<InvestigationRange>;
export const InvestigationRangeSchema = SchemaFactory.createForClass(InvestigationRange);
InvestigationRangeSchema.index({ test: 1, field: 1 }, { unique: true });
