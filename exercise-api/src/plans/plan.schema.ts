import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

@Schema({ _id: false })
export class PlanSchedule {
  /** 1 = Monday ... 7 = Sunday, sorted, no repeats. */
  @Prop({ type: [Number], required: true })
  daysOfWeek!: number[];

  @Prop({ required: true })
  timesPerDay!: number;
}
const PlanScheduleSchema = SchemaFactory.createForClass(PlanSchedule);

/** Shown to the patient; not checked against what they record. ⏳ Plan structure */
@Schema({ _id: false })
export class PlanTarget {
  @Prop({ type: Number, default: null }) sets!: number | null;
  @Prop({ type: Number, default: null }) reps!: number | null;
  @Prop({ type: Number, default: null }) durationMin!: number | null;
}
const PlanTargetSchema = SchemaFactory.createForClass(PlanTarget);

@Schema({ _id: false })
export class PlanItem {
  /**
   * Stays the same from version to version while the exercise stays in the
   * plan, so completions recorded against it remain linked.
   */
  @Prop({ required: true })
  itemId!: string;

  @Prop({ type: Types.ObjectId, required: true })
  exerciseId!: Types.ObjectId;

  @Prop({ type: PlanScheduleSchema, required: true })
  schedule!: PlanSchedule;

  @Prop({ type: PlanTargetSchema, default: null })
  target!: PlanTarget | null;

  @Prop({ type: String, default: null })
  notes!: string | null;
}
const PlanItemSchema = SchemaFactory.createForClass(PlanItem);

/**
 * One version of one patient's plan. Every change adds a new version and the
 * old ones are kept, so history can always show what was planned on a day.
 * Exactly one version per patient is current.
 */
@Schema({ collection: 'exercisePlans', timestamps: { createdAt: true, updatedAt: false } })
export class ExercisePlan {
  @Prop({ type: Types.ObjectId, required: true })
  patientId!: Types.ObjectId;

  /** 1, 2, 3... per patient. */
  @Prop({ required: true })
  version!: number;

  @Prop({ required: true })
  isCurrent!: boolean;

  @Prop({ type: [PlanItemSchema], default: [] })
  items!: PlanItem[];

  @Prop({ type: Types.ObjectId, required: true })
  assignedById!: Types.ObjectId;

  /** The doctor's name when they saved it, so history reads right after a rename. */
  @Prop({ required: true })
  assignedByName!: string;

  createdAt!: Date;
}

export type ExercisePlanDocument = HydratedDocument<ExercisePlan>;
export const ExercisePlanSchema = SchemaFactory.createForClass(ExercisePlan);
// Two doctors saving at once both try to write the same next version; this
// index lets only one of them in.
ExercisePlanSchema.index({ patientId: 1, version: -1 }, { unique: true });
ExercisePlanSchema.index({ patientId: 1 }, { unique: true, partialFilterExpression: { isCurrent: true } });
