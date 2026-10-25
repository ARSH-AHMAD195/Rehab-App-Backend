import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/**
 * An exercise category (Walking, Strength, Breathing, Stretching to start).
 *
 * Categories are never deleted, only deactivated, so exercises and old plans
 * that point at one keep working.
 */
@Schema({ collection: 'exerciseCategories', timestamps: true })
export class ExerciseCategory {
  /** Stable code the app may branch on, e.g. "STRENGTH". Cannot change once created. */
  @Prop({ required: true, unique: true })
  code!: string;

  @Prop({ required: true })
  name!: string;

  /** Display order. */
  @Prop({ required: true, default: 0 })
  order!: number;

  @Prop({ required: true, default: true })
  active!: boolean;

  /**
   * Bumped by every change that depends on this category being active (adding
   * an exercise to it, deactivating it). Two such changes running at once then
   * write the same document, so MongoDB makes one of them retry and see the
   * other's result - an exercise can't slip into a category as it's switched off.
   */
  @Prop({ required: true, default: 0 })
  lockVersion!: number;
}

export type ExerciseCategoryDocument = HydratedDocument<ExerciseCategory>;
export const ExerciseCategorySchema = SchemaFactory.createForClass(ExerciseCategory);
