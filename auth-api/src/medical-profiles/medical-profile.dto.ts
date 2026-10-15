import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { BLOOD_GROUPS, PHONE_PATTERN, SEXES, SMOKING_STATUSES } from '../common/constants';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_ISSUE = 'must be a date as YYYY-MM-DD';
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimEach = ({ value }: { value: unknown }) =>
  Array.isArray(value) ? value.map((v) => (typeof v === 'string' ? v.trim() : v)) : value;

export class EmergencyContactDto {
  @ApiProperty({ example: 'Sunita Iyer' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiProperty({ example: 'Wife' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  relation!: string;

  @ApiProperty({ example: '+919812345678' })
  @Matches(PHONE_PATTERN, { message: 'must be in E.164 format, e.g. +919876543210' })
  phone!: string;
}

/**
 * PATCH .../medical-profile (v1.0). Send only the fields that change, plus the
 * version you last read. null clears a field (IsOptional lets null through).
 */
export class UpdateMedicalProfileDto {
  @ApiProperty({ description: 'The version from your last GET. 0 when nothing has been saved yet.' })
  @IsInt()
  @Min(0)
  version!: number;

  @ApiPropertyOptional({ example: '1962-04-18', nullable: true })
  @IsOptional()
  @Matches(DATE, { message: DATE_ISSUE })
  dateOfBirth?: string | null;

  @ApiPropertyOptional({ enum: SEXES, nullable: true })
  @IsOptional()
  @IsIn(SEXES)
  sex?: string | null;

  @ApiPropertyOptional({ example: 172, nullable: true })
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(50)
  @Max(250)
  heightCm?: number | null;

  @ApiPropertyOptional({ enum: BLOOD_GROUPS, nullable: true })
  @IsOptional()
  @IsIn(BLOOD_GROUPS)
  bloodGroup?: string | null;

  @ApiPropertyOptional({ example: 'Colorectal cancer, stage II', nullable: true })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  diagnosis?: string | null;

  @ApiPropertyOptional({ example: 'Laparoscopic right hemicolectomy', nullable: true })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  plannedSurgery?: string | null;

  @ApiPropertyOptional({ example: '2026-11-20', nullable: true })
  @IsOptional()
  @Matches(DATE, { message: DATE_ISSUE })
  plannedSurgeryDate?: string | null;

  @ApiPropertyOptional({ type: [String], example: ['Type 2 diabetes'], nullable: true })
  @IsOptional()
  @Transform(trimEach)
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  comorbidities?: string[] | null;

  @ApiPropertyOptional({ type: [String], example: ['Penicillin'], nullable: true })
  @IsOptional()
  @Transform(trimEach)
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  allergies?: string[] | null;

  @ApiPropertyOptional({ type: [String], example: ['Metformin 500 mg twice daily'], nullable: true })
  @IsOptional()
  @Transform(trimEach)
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  medications?: string[] | null;

  @ApiPropertyOptional({ enum: SMOKING_STATUSES, nullable: true })
  @IsOptional()
  @IsIn(SMOKING_STATUSES)
  smokingStatus?: string | null;

  @ApiPropertyOptional({ type: EmergencyContactDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => EmergencyContactDto)
  emergencyContact?: EmergencyContactDto | null;
}
