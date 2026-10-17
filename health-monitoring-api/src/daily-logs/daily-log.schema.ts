import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { DAY_STATUS, DayStatus, READING_STATUS, ReadingStatus } from '../common/constants';

/** One parameter inside a day's log. */
export interface StoredReading {
  /** null once cleared; status then goes back to NOT_YET. */
  value: Record<string, unknown> | null;
  /** The unit the value was saved under, so old values stay readable. */
  unit: string | null;
  /** The parameter version the value was saved under. */
  typeVersion: number;
  status: ReadingStatus;
  loggedAt: Date | null;
}

/**
 * One document per patient per day (architecture plan, Data model), holding
 * the readings filled in so far, when each was logged, and the day's status.
 *
 * Reading lifecycle, v1.1: today is editable, past days are read-only, and
 * "logs and readings are never deleted" - clearing a value is the only
 * removal, and it is audited.
 */
@Schema({ collection: 'dailyLogs', timestamps: true, minimize: false })
export class DailyLog {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  patientId!: Types.ObjectId;

  /** The patient's local calendar day, YYYY-MM-DD. */
  @Prop({ required: true })
  date!: string;

  /** The zone the date was worked out in. Past logs keep theirs. */
  @Prop({ required: true })
  timeZone!: string;

  /** Keyed by parameter type code. */
  @Prop({ type: Object, required: true, default: {} })
  readings!: Record<string, StoredReading>;

  /** Fields filled today. BP upper and lower count separately. */
  @Prop({ required: true, default: 0 })
  filledCount!: number;

  /** Fields of the parameters where onForm is true (14 when all are). */
  @Prop({ required: true, default: 0 })
  totalCount!: number;

  @Prop({ required: true, enum: Object.values(DAY_STATUS), default: DAY_STATUS.NOT_STARTED })
  dayStatus!: DayStatus;

  createdAt!: Date;
  updatedAt!: Date;
}

export type DailyLogDocument = HydratedDocument<DailyLog>;
export const DailyLogSchema = SchemaFactory.createForClass(DailyLog);

// One log per patient per day. This is what makes a retried save replace a
// value instead of adding a second reading.
DailyLogSchema.index({ patientId: 1, date: 1 }, { unique: true });

export const EMPTY_READING = (unit: string | null, typeVersion: number): StoredReading => ({
  value: null,
  unit,
  typeVersion,
  status: READING_STATUS.NOT_YET,
  loggedAt: null,
});
