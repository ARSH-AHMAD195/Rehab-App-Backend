import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { VALUE_KINDS, ValueKind, VitalType } from '../common/constants';

@Schema({ _id: false })
export class FieldRange {
  @Prop({ required: true }) minValid!: number;
  @Prop({ required: true }) maxValid!: number;
}
const FieldRangeSchema = SchemaFactory.createForClass(FieldRange);

/**
 * One of the 13 parameters from the SRS, with the unit and valid range the
 * form is built from (v1.1, Parameters and GET /vital-types).
 *
 * Versioning, v1.1: "Every parameter has a version, starting at 1. Any admin
 * change to its unit or range adds 1 ... A parameter's value shape (valueKind)
 * never changes. A new shape needs a new type code."
 */
@Schema({ collection: 'vitalTypes', timestamps: true })
export class VitalTypeDef {
  @Prop({ required: true, unique: true, index: true })
  type!: VitalType;

  @Prop({ required: true })
  label!: string;

  /** NUTRITION has no unit. */
  @Prop({ type: String, default: null })
  unit!: string | null;

  @Prop({ required: true, enum: Object.values(VALUE_KINDS) })
  valueKind!: ValueKind;

  /** numeric/scale: the value range. text: character counts. Null for BP. */
  @Prop({ type: Number, default: null })
  minValid!: number | null;

  @Prop({ type: Number, default: null })
  maxValid!: number | null;

  /** BP only: a separate range per field, each checked on its own. */
  @Prop({ type: Map, of: FieldRangeSchema, default: undefined })
  fields?: Map<string, FieldRange>;

  @Prop({ required: true, default: false })
  isOptional!: boolean;

  /** totalCount counts the fields of the parameters where onForm is true. */
  @Prop({ required: true, default: true })
  onForm!: boolean;

  /**
   * Additive to the v1.1 response: the Parameters table calls out whole-number
   * parameters (pain, walking, steps, water, mood) and sleep in 0.5 steps, but
   * the GET /vital-types example has no field for it. Without these the form
   * can't render the right input and the server can't reject 7.3 steps.
   */
  @Prop({ required: true, default: false })
  integerOnly!: boolean;

  @Prop({ type: Number, default: null })
  step!: number | null;

  /** Display order on the form. */
  @Prop({ required: true, default: 0 })
  order!: number;

  @Prop({ required: true, default: 1 })
  version!: number;
}

export type VitalTypeDocument = HydratedDocument<VitalTypeDef>;
export const VitalTypeSchema = SchemaFactory.createForClass(VitalTypeDef);
