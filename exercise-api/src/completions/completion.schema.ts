import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

/** ⏳ What the patient records: optional until the client decides. */
@Schema({ _id: false })
export class CompletionDetails {
  @Prop({ type: Number, default: null }) durationMin!: number | null;
  @Prop({ type: String, default: null }) note!: string | null;
}
const CompletionDetailsSchema = SchemaFactory.createForClass(CompletionDetails);

/**
 * One "done" tick: the patient did one planned exercise once.
 *
 * Linked to the plan item (and the exercise and plan version behind it), so
 * every completion belongs to the right patient and the right assigned
 * exercise (SRS). An undo marks it inactive rather than deleting it.
 */
@Schema({ collection: 'exerciseCompletions', timestamps: false })
export class ExerciseCompletion {
  @Prop({ type: Types.ObjectId, required: true })
  patientId!: Types.ObjectId;

  @Prop({ required: true })
  itemId!: string;

  @Prop({ type: Types.ObjectId, required: true })
  exerciseId!: Types.ObjectId;

  @Prop({ required: true })
  planVersion!: number;

  /** The patient's local date, YYYY-MM-DD, in their profile time zone. */
  @Prop({ required: true })
  date!: string;

  /**
   * Which of the day's planned times this is: 0 to timesPerDay - 1. The unique
   * index below lets each slot be filled once, so two taps at the same moment
   * can't both count as the last planned time.
   */
  @Prop({ required: true })
  slot!: number;

  @Prop({ required: true })
  completedAt!: Date;

  @Prop({ type: CompletionDetailsSchema, default: null })
  details!: CompletionDetails | null;

  /** False once undone. Undone ticks are kept but no longer count. */
  @Prop({ required: true, default: true })
  active!: boolean;

  @Prop({ type: Date, default: null })
  undoneAt!: Date | null;
}

export type ExerciseCompletionDocument = HydratedDocument<ExerciseCompletion>;
export const ExerciseCompletionSchema = SchemaFactory.createForClass(ExerciseCompletion);
ExerciseCompletionSchema.index(
  { patientId: 1, date: 1, itemId: 1, slot: 1 },
  { unique: true, partialFilterExpression: { active: true } },
);
ExerciseCompletionSchema.index({ patientId: 1, completedAt: -1, _id: -1 });
