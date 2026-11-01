import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ROLES, Role, VIDEO_PROVIDERS, VideoProvider } from '../common/constants';

@Schema({ _id: false })
export class ExerciseVideo {
  @Prop({ required: true, enum: Object.values(VIDEO_PROVIDERS) })
  provider!: VideoProvider;

  @Prop({ required: true })
  videoId!: string;
}
const ExerciseVideoSchema = SchemaFactory.createForClass(ExerciseVideo);

/**
 * One exercise in the library. The content comes from the clinical team; an
 * admin or a doctor enters it.
 *
 * Exercises are never deleted, only deactivated, so plans and completions
 * that point at one keep working.
 */
@Schema({ collection: 'exercises', timestamps: true })
export class Exercise {
  @Prop({ required: true })
  name!: string;

  /** Lower-cased name: the sort and search key, so "arm" and "Arm" sort together. */
  @Prop({ required: true })
  sortKey!: string;

  @Prop({ type: Types.ObjectId, required: true })
  categoryId!: Types.ObjectId;

  @Prop({ type: String, default: null })
  description!: string | null;

  /** Steps, shown in order. Also the fallback when a video won't play. */
  @Prop({ type: [String], default: [] })
  instructions!: string[];

  /**
   * Null until the clinic supplies the video. Stored as provider + id rather
   * than a link, so another provider (e.g. clinic-hosted files) can be added
   * later without changing what's already saved.
   */
  @Prop({ type: ExerciseVideoSchema, default: null })
  video!: ExerciseVideo | null;

  @Prop({ required: true, default: true })
  active!: boolean;

  /** Who added it. Null for exercises added before this was recorded. A doctor may edit only their own. */
  @Prop({ type: { id: Types.ObjectId, role: { type: String, enum: Object.values(ROLES) } }, default: null, _id: false })
  createdBy!: { id: Types.ObjectId; role: Role } | null;

  createdAt!: Date;
  updatedAt!: Date;
}

export type ExerciseDocument = HydratedDocument<Exercise>;
export const ExerciseSchema = SchemaFactory.createForClass(Exercise);
ExerciseSchema.index({ active: 1, sortKey: 1, _id: 1 });
ExerciseSchema.index({ categoryId: 1, active: 1 });
