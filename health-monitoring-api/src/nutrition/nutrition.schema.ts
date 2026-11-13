import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ROLES, Role } from '../common/constants';
import { DietTargets, MealSlot, Text } from './diet-chart';

/**
 * A patient's own diet plan: a copy of the hospital chart that their doctor
 * can change (targets, diet type, food options). Until a doctor saves one,
 * the patient follows the hospital chart and nothing is stored.
 */
@Schema({ collection: 'patientDietPlans', timestamps: true, minimize: false })
export class PatientDietPlan {
  @Prop({ type: Types.ObjectId, required: true, unique: true })
  patientId!: Types.ObjectId;

  @Prop({ required: true })
  dietType!: string;

  @Prop({ type: Object, required: true })
  dietLabel!: Text;

  @Prop({ type: Object, required: true })
  targets!: DietTargets;

  @Prop({ type: [Object], required: true })
  slots!: MealSlot[];

  /** Optimistic concurrency: an edit sends the version it read (0 = still the hospital chart). */
  @Prop({ required: true, default: 1 })
  version!: number;

  @Prop({ type: { id: Types.ObjectId, role: { type: String, enum: Object.values(ROLES) } }, required: true, _id: false })
  updatedBy!: { id: Types.ObjectId; role: Role };

  createdAt!: Date;
  updatedAt!: Date;
}

export type PatientDietPlanDocument = HydratedDocument<PatientDietPlan>;
export const PatientDietPlanSchema = SchemaFactory.createForClass(PatientDietPlan);

/** One slot of one day: what was ticked and what it counted for. */
export interface StoredMealSlot {
  optionCodes: string[];
  /** The slot's values when ticked, so a later plan change never rewrites past days. */
  kcal: number;
  proteinG: number;
  loggedAt: Date | null;
}

/**
 * One patient's meals for one local day, like the vitals daily log. Today is
 * editable; past days are kept as they were.
 */
@Schema({ collection: 'mealLogs', timestamps: true, minimize: false })
export class MealLog {
  @Prop({ type: Types.ObjectId, required: true })
  patientId!: Types.ObjectId;

  @Prop({ required: true })
  date!: string;

  @Prop({ required: true })
  timeZone!: string;

  /** Keyed by slot code. */
  @Prop({ type: Object, required: true, default: {} })
  slots!: Record<string, StoredMealSlot>;

  @Prop({ type: Object, required: true })
  totals!: { kcal: number; proteinG: number; slotsEaten: number };

  /** The targets in force that day. */
  @Prop({ type: Object, required: true })
  targets!: DietTargets;

  @Prop({ required: true })
  planVersion!: number;

  createdAt!: Date;
  updatedAt!: Date;
}

export type MealLogDocument = HydratedDocument<MealLog>;
export const MealLogSchema = SchemaFactory.createForClass(MealLog);
MealLogSchema.index({ patientId: 1, date: 1 }, { unique: true });
