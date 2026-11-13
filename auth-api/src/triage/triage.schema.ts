import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { TriageRuleSet } from './triage-rules';

/**
 * The triage cut-offs in force, versioned like Health Monitoring's alert
 * thresholds: each change adds a new row and the old one stays, so any tag can
 * be traced to the rules it was worked out with.
 *
 * Version 1 is the client's table, added on first start, with `confirmed`
 * false. An admin sets `confirmed` once the clinical team signs the rules off;
 * until then every tag is reported as provisional.
 */
@Schema({ collection: 'triageRules', timestamps: true })
export class TriageRules {
  @Prop({ required: true })
  version!: number;

  @Prop({ type: Object, required: true })
  rules!: TriageRuleSet;

  @Prop({ required: true, default: false })
  confirmed!: boolean;

  @Prop({ required: true, default: true })
  isCurrent!: boolean;

  /** Null for version 1, added by the app itself. */
  @Prop({ type: Types.ObjectId, default: null })
  updatedBy!: Types.ObjectId | null;

  createdAt!: Date;
  updatedAt!: Date;
}

export type TriageRulesDocument = HydratedDocument<TriageRules>;
export const TriageRulesSchema = SchemaFactory.createForClass(TriageRules);
TriageRulesSchema.index({ isCurrent: 1 }, { unique: true, partialFilterExpression: { isCurrent: true } });
TriageRulesSchema.index({ version: 1 }, { unique: true });

/**
 * READ-ONLY view of Health Monitoring's `dailyLogs`, for the latest pulse and
 * BP. That module owns the collection and its indexes; this one never writes
 * to it (autoIndex off, so it creates nothing there either).
 */
@Schema({ collection: 'dailyLogs', strict: false, autoIndex: false })
export class DailyLogView {
  @Prop({ type: Types.ObjectId }) patientId!: Types.ObjectId;
  @Prop() date!: string;
  @Prop({ type: Object }) readings!: Record<string, { value: Record<string, number> | null } | undefined>;
}

export const DailyLogViewSchema = SchemaFactory.createForClass(DailyLogView);
