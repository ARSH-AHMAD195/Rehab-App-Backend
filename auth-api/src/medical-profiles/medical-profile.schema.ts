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
  /** The prehab programme: the day it starts and how many days it runs. */
  @Prop({ type: String, default: null }) programmeStartDate!: string | null;
  @Prop({ type: Number, default: null }) programmeLengthDays!: number | null;

  // Doctor onboarding (client change request, Nov 2026).
  /** Weight taken at onboarding: the baseline for BMI and later weight-loss checks. */
  @Prop({ type: Number, default: null }) onboardingWeightKg!: number | null;
  @Prop({ type: Boolean, default: null }) chemotherapy!: boolean | null;
  @Prop({ type: Boolean, default: null }) radiotherapy!: boolean | null;
  @Prop({ type: String, default: null }) lastChemoDate!: string | null;
  @Prop({ type: String, default: null }) chemoSchedule!: string | null;
  @Prop({ type: Boolean, default: null }) anaemia!: boolean | null;
  /** Checkbox codes from CONDITIONS. Separate from the older free-text comorbidities, which stay as they are. */
  @Prop({ type: [String], default: null }) conditions!: string[] | null;
  @Prop({ type: String, default: null }) otherConditions!: string | null;

  // Extra triage inputs the client's table needs (Nov 2026).
  /** Former smokers: quitting less than 8 weeks ago is a Medium triage parameter. */
  @Prop({ type: String, default: null }) smokingQuitDate!: string | null;
  /** Hypertension "controlled on medication" (a Medium triage parameter). */
  @Prop({ type: Boolean, default: null }) hypertensionOnMedication!: boolean | null;
  /** IHD_STATUSES; null = no ischaemic heart disease recorded. */
  @Prop({ type: String, default: null }) ihdStatus!: string | null;
  /** Last myocardial infarction or stent; within 6 months is High. */
  @Prop({ type: String, default: null }) lastMiOrStentDate!: string | null;
  /** Functional capacity: false means under 4 METs (High). */
  @Prop({ type: Boolean, default: null }) canClimbTwoFlights!: boolean | null;

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
  programmeStartDate: true,
  programmeLengthDays: true,
  onboardingWeightKg: true,
  chemotherapy: true,
  radiotherapy: true,
  lastChemoDate: true,
  chemoSchedule: true,
  anaemia: true,
  conditions: true,
  otherConditions: true,
  smokingQuitDate: true,
  hypertensionOnMedication: true,
  ihdStatus: true,
  lastMiOrStentDate: true,
  canClimbTwoFlights: true,
};
export type MedicalField = keyof typeof FIELD_SET;
export const MEDICAL_FIELDS = Object.keys(FIELD_SET) as MedicalField[];
