import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  DEFAULT_PAGE_LIMIT,
  LANGUAGES,
  Language,
  MAX_DOCTORS_PER_PATIENT,
  MAX_PAGE_LIMIT,
  PHONE_PATTERN,
} from '../common/constants';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const lower = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);

/** Present-but-null must fail, so these use ValidateIf, not IsOptional (which lets null through). */
const ifSent = ValidateIf((_o: unknown, value: unknown) => value !== undefined);

const PHONE_ISSUE = 'must be in E.164 format, e.g. +919876543210';

// ---------------------------------------------------------------- registration

/** Name and phone: what every registration has in common. */
class RegisterBaseDto {
  @ApiProperty({ example: 'Priya Menon' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({
    example: '+919876543210',
    nullable: true,
    description: 'E.164. For a patient it is also their login (with a code from their doctor), so it must be unused by other patients.',
  })
  @IsOptional()
  @Matches(PHONE_PATTERN, { message: PHONE_ISSUE })
  phone?: string | null;
}

export class RegisterAdminDto extends RegisterBaseDto {
  @ApiProperty({ example: 'priya@example.com', description: 'Stored in lower case. Must be unused.' })
  @Transform(lower)
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class RegisterDoctorDto extends RegisterAdminDto {
  @ApiPropertyOptional({ example: 'Surgical oncology', nullable: true })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  specialization?: string | null;
}

/**
 * A patient needs a phone number, an email, or both (checked in
 * PatientsService). The phone number is their login, with a doctor-issued
 * code; with only an email they get the set-password email as before.
 */
export class RegisterPatientDto extends RegisterBaseDto {
  @ApiPropertyOptional({
    example: 'rajesh@example.com',
    description: 'Optional when a phone number is given. Stored in lower case. Must be unused.',
  })
  @ifSent
  @Transform(lower)
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @ApiPropertyOptional({ example: 'Asia/Kolkata', description: 'IANA zone. Defaults to Asia/Kolkata.' })
  @ifSent
  @IsString()
  timeZone?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Admin: required, 1-10 active doctors. Doctor: must not be sent - the caller is linked.',
  })
  @ifSent
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_DOCTORS_PER_PATIENT)
  @ArrayUnique()
  @IsMongoId({ each: true })
  doctorIds?: string[];
}

// ---------------------------------------------------------------- updates

export class UpdateMyProfileDto {
  @ApiPropertyOptional()
  @ifSent
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Matches(PHONE_PATTERN, { message: PHONE_ISSUE })
  phone?: string | null;

  @ApiPropertyOptional({ description: 'Patients only. IANA zone.' })
  @ifSent
  @IsString()
  timeZone?: string;

  @ApiPropertyOptional({ description: 'Doctors only.', nullable: true })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  specialization?: string | null;

  @ApiPropertyOptional({ enum: LANGUAGES, description: 'App language' })
  @ifSent
  @IsIn(LANGUAGES)
  preferredLanguage?: Language;
}

export class UpdatePatientDto {
  @ApiPropertyOptional()
  @ifSent
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Matches(PHONE_PATTERN, { message: PHONE_ISSUE })
  phone?: string | null;

  @ApiPropertyOptional()
  @ifSent
  @IsString()
  timeZone?: string;

  @ApiPropertyOptional({ description: 'Admin only. false deactivates, true reactivates.' })
  @ifSent
  @IsBoolean()
  active?: boolean;
}

export class UpdateDoctorDto {
  @ApiPropertyOptional()
  @ifSent
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Matches(PHONE_PATTERN, { message: PHONE_ISSUE })
  phone?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  specialization?: string | null;

  @ApiPropertyOptional({ description: 'false deactivates, true reactivates.' })
  @ifSent
  @IsBoolean()
  active?: boolean;
}

export class SetDoctorsDto {
  @ApiProperty({ type: [String], description: '1-10 active doctors, no duplicates. Replaces the list.' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_DOCTORS_PER_PATIENT)
  @ArrayUnique()
  @IsMongoId({ each: true })
  doctorIds!: string[];
}

// ---------------------------------------------------------------- lists

export class UserListQueryDto {
  @ApiPropertyOptional({ description: 'Name, email or phone contains (case-insensitive).' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ enum: ['true', 'false', 'all'], default: 'true' })
  @IsOptional()
  @IsIn(['true', 'false', 'all'])
  active?: 'true' | 'false' | 'all';

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_PAGE_LIMIT, default: DEFAULT_PAGE_LIMIT })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_LIMIT)
  limit?: number;

  @ApiPropertyOptional({ description: 'nextCursor from the previous page.' })
  @IsOptional()
  @IsString()
  cursor?: string;
}

export class PatientListQueryDto extends UserListQueryDto {
  @ApiPropertyOptional({ description: 'Admin only: patients linked to this doctor.' })
  @IsOptional()
  @IsMongoId()
  doctorId?: string;
}
