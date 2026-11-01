import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BLOOD_GROUPS, INVITATION_STATUS, ROLES, SEXES, SMOKING_STATUSES } from './constants';
import { AdminResponse, DoctorResponse, PatientResponse, ProfileResponse } from '../users/user.responses';
import { MedicalProfileResponse } from '../medical-profiles/medical-profiles.service';

/**
 * Response shapes for the docs page (Swagger). The services return plain
 * interfaces, which Swagger can't see, so these classes describe them. The
 * checks at the bottom fail the build if a class and its interface stop having
 * the same fields.
 */

const TIME = '2026-10-20T10:00:00+05:30';

export class DoctorRefDoc {
  @ApiProperty({ example: '6712a0b1c2d3e4f5a6b7c8d9' }) id!: string;
  @ApiProperty({ example: 'Dr Meera Nair' }) name!: string;
}

export class MeResponseDoc {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: Object.values(ROLES) }) role!: string;
  @ApiProperty({ example: 'Rajesh Iyer' }) name!: string;
  @ApiProperty({ type: String, nullable: true, example: 'patient@example.com' }) email!: string | null;
  @ApiProperty({ description: 'false until the user clicks the link in the verification email' }) emailVerified!: boolean;
  @ApiProperty({ description: 'Always true: a switched-off user gets 401 instead' }) active!: boolean;
}

export class ProfileResponseDoc {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: Object.values(ROLES) }) role!: string;
  @ApiProperty({ example: 'Rajesh Iyer' }) name!: string;
  @ApiProperty({ type: String, nullable: true }) email!: string | null;
  @ApiProperty({ type: String, nullable: true, example: '+919876543210' }) phone!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, example: 'Asia/Kolkata', description: 'Patients only' }) timeZone?: string | null;
  @ApiPropertyOptional({ type: [DoctorRefDoc], description: 'Patients only' }) doctors?: DoctorRefDoc[];
  @ApiPropertyOptional({ type: String, nullable: true, example: 'Surgical oncology', description: 'Doctors only' }) specialization?: string | null;
  @ApiProperty({ type: String, nullable: true, example: TIME }) createdAt!: string | null;
  @ApiProperty({ type: String, nullable: true, example: TIME }) updatedAt!: string | null;
}

export class PatientResponseDoc {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'Rajesh Iyer' }) name!: string;
  @ApiProperty({ type: String, nullable: true }) email!: string | null;
  @ApiProperty({ type: String, nullable: true }) phone!: string | null;
  @ApiProperty({ type: String, nullable: true, example: 'Asia/Kolkata' }) timeZone!: string | null;
  @ApiProperty() active!: boolean;
  @ApiProperty() emailVerified!: boolean;
  @ApiProperty({ type: [DoctorRefDoc] }) doctors!: DoctorRefDoc[];
  @ApiProperty({ type: String, nullable: true, example: TIME }) createdAt!: string | null;
}

export class DoctorResponseDoc {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'Dr Meera Nair' }) name!: string;
  @ApiProperty({ type: String, nullable: true }) email!: string | null;
  @ApiProperty({ type: String, nullable: true }) phone!: string | null;
  @ApiProperty({ type: String, nullable: true, example: 'Surgical oncology' }) specialization!: string | null;
  @ApiProperty() active!: boolean;
  @ApiProperty() emailVerified!: boolean;
  @ApiProperty({ description: 'Active patients linked to this doctor' }) patientCount!: number;
  @ApiProperty({ type: String, nullable: true, example: TIME }) createdAt!: string | null;
}

export class AdminResponseDoc {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'Platform Admin' }) name!: string;
  @ApiProperty({ type: String, nullable: true }) email!: string | null;
  @ApiProperty({ type: String, nullable: true }) phone!: string | null;
  @ApiProperty() active!: boolean;
  @ApiProperty() emailVerified!: boolean;
  @ApiProperty({ type: String, nullable: true, example: TIME }) createdAt!: string | null;
}

const invitation = { enum: Object.values(INVITATION_STATUS), description: 'Whether the set-password email went out' };

export class RegisteredPatientDoc extends PatientResponseDoc {
  @ApiProperty(invitation) invitation!: string;
}

export class RegisteredDoctorDoc extends DoctorResponseDoc {
  @ApiProperty(invitation) invitation!: string;
}

export class RegisteredAdminDoc extends AdminResponseDoc {
  @ApiProperty(invitation) invitation!: string;
}

export class InvitationResponseDoc {
  @ApiProperty(invitation) invitation!: string;
}

export class PatientListDoc {
  @ApiProperty({ type: [PatientResponseDoc] }) data!: PatientResponseDoc[];
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
}

export class DoctorListDoc {
  @ApiProperty({ type: [DoctorResponseDoc] }) data!: DoctorResponseDoc[];
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
}

export class EmergencyContactDoc {
  @ApiProperty({ example: 'Sunita Iyer' }) name!: string;
  @ApiProperty({ example: 'Wife' }) relation!: string;
  @ApiProperty({ example: '+919812345678' }) phone!: string;
}

export class UpdatedByDoc {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: Object.values(ROLES) }) role!: string;
}

export class MedicalProfileResponseDoc {
  @ApiProperty() patientId!: string;
  @ApiProperty({ type: String, nullable: true, example: '1962-04-18' }) dateOfBirth!: string | null;
  @ApiProperty({ enum: SEXES, nullable: true }) sex!: string | null;
  @ApiProperty({ type: Number, nullable: true, example: 172 }) heightCm!: number | null;
  @ApiProperty({ enum: BLOOD_GROUPS, nullable: true }) bloodGroup!: string | null;
  @ApiProperty({ type: String, nullable: true, example: 'Colorectal cancer, stage II' }) diagnosis!: string | null;
  @ApiProperty({ type: String, nullable: true, example: 'Laparoscopic right hemicolectomy' }) plannedSurgery!: string | null;
  @ApiProperty({ type: String, nullable: true, example: '2026-11-20' }) plannedSurgeryDate!: string | null;
  @ApiProperty({ type: [String], nullable: true, example: ['Type 2 diabetes'] }) comorbidities!: string[] | null;
  @ApiProperty({ type: [String], nullable: true, example: ['Penicillin'] }) allergies!: string[] | null;
  @ApiProperty({ type: [String], nullable: true, example: ['Metformin 500 mg twice daily'] }) medications!: string[] | null;
  @ApiProperty({ enum: SMOKING_STATUSES, nullable: true }) smokingStatus!: string | null;
  @ApiProperty({ type: EmergencyContactDoc, nullable: true }) emergencyContact!: EmergencyContactDoc | null;
  @ApiProperty({ example: 1, description: '0 until first saved; send it back with your next PATCH' }) version!: number;
  @ApiProperty({ type: String, nullable: true, example: TIME }) updatedAt!: string | null;
  @ApiProperty({ type: UpdatedByDoc, nullable: true }) updatedBy!: UpdatedByDoc | null;
}

// Build-time checks: each class has exactly the fields of the shape it documents.
type SameKeys<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const checks: [
  SameKeys<keyof ProfileResponseDoc, keyof ProfileResponse>,
  SameKeys<keyof PatientResponseDoc, keyof PatientResponse>,
  SameKeys<keyof DoctorResponseDoc, keyof DoctorResponse>,
  SameKeys<keyof AdminResponseDoc, keyof AdminResponse>,
  SameKeys<keyof MedicalProfileResponseDoc, keyof MedicalProfileResponse>,
] = [true, true, true, true, true];
void checks;
