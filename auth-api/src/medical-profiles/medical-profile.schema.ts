import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ROLES, Role } from '../common/constants';

export class EmergencyContact {
  name!: string;
  relation!: string;
  phone!: string;
}

/**
 * One medical profile per patient (v1.0 Medical profile), kept apart from
 * `users` so that admin screens, which load users, never load medical data.
 *
 * The fields are a proposal until the clinical team confirms them. Dates are
 * calendar dates (YYYY-MM-DD strings): a birthday has no time zone.
 */
@Schema({ collection: 'medicalProfiles', timestamps: true })
export class MedicalProfile {
  @Prop({ type: Types.ObjectId, required: true, unique: true })
  patientId!: Types.ObjectId;

  @Prop({ type: String, default: null }) dateOfBirth!: string | null;
  @Prop({ type: String, default: null }) sex!: string | null;
  @Prop({ type: Number, default: null }) heightCm!: number | null;
  @Prop({ type: String, default: null }) bloodGroup!: string | null;
  @Prop({ type: String, default: null }) diagnosis!: string | null;
  @Prop({ type: String, default: null }) plannedSurgery!: string | null;
  @Prop({ type: String, default: null }) plannedSurgeryDate!: string | null;
  @Prop({ type: [String], default: null }) comorbidities!: string[] | null;
  @Prop({ type: [String], default: null }) allergies!: string[] | null;
  @Prop({ type: [String], default: null }) medications!: string[] | null;
  @Prop({ type: String, default: null }) smokingStatus!: string | null;
  @Prop({ type: Object, default: null }) emergencyContact!: EmergencyContact | null;


  /** Optimistic concurrency: PATCH sends the version it read. */
  @Prop({ required: true, default: 1 })
  version!: number;

  @Prop({ type: { id: Types.ObjectId, role: { type: String, enum: Object.values(ROLES) } }, required: true, _id: false })
  updatedBy!: { id: Types.ObjectId; role: Role };

  createdAt!: Date;
  updatedAt!: Date;
}

export type MedicalProfileDocument = HydratedDocument<MedicalProfile>;
export const MedicalProfileSchema = SchemaFactory.createForClass(MedicalProfile);

/**
 * The clinical fields, which the service reads, diffs and returns - a field
 * missing here is silently dropped. Typed against the class above, so a new
 * @Prop that isn't added here fails to compile; UpdateMedicalProfileDto checks
 * itself against MedicalField the same way.
 */
const FIELD_SET: Record<
  Exclude<keyof MedicalProfile, 'patientId' | 'version' | 'updatedBy' | 'createdAt' | 'updatedAt'>,
  true
> = {
  dateOfBirth: true,
  sex: true,
  heightCm: true,
  bloodGroup: true,
  diagnosis: true,
  plannedSurgery: true,
  plannedSurgeryDate: true,
  comorbidities: true,
  allergies: true,
  medications: true,
  smokingStatus: true,
  emergencyContact: true,
};
export type MedicalField = keyof typeof FIELD_SET;
export const MEDICAL_FIELDS = Object.keys(FIELD_SET) as MedicalField[];
