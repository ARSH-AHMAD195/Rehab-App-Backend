import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { PATIENT_PASSWORD, PHONE_ISSUE, PHONE_PATTERN, toMobile } from '../common/constants';

const LENGTH_ISSUE = `must be ${PATIENT_PASSWORD.MIN_LENGTH} to ${PATIENT_PASSWORD.MAX_LENGTH} characters`;

/** PUT /users/me/password. Not trimmed: a space the patient typed is part of it. */
export class SetPatientPasswordDto {
  @ApiProperty({ example: 'ganga123', minLength: PATIENT_PASSWORD.MIN_LENGTH, maxLength: PATIENT_PASSWORD.MAX_LENGTH })
  @IsString()
  @MinLength(PATIENT_PASSWORD.MIN_LENGTH, { message: LENGTH_ISSUE })
  @MaxLength(PATIENT_PASSWORD.MAX_LENGTH, { message: LENGTH_ISSUE })
  password!: string;
}

/** POST /auth/password-login */
export class PatientPasswordLoginDto {
  @ApiProperty({ example: '9876543210', description: 'The 10-digit mobile number. +91 in front is accepted too.' })
  @Transform(toMobile)
  @IsString()
  @Matches(PHONE_PATTERN, { message: PHONE_ISSUE })
  phone!: string;

  @ApiProperty({ example: 'ganga123' })
  @IsString()
  @MinLength(1)
  @MaxLength(PATIENT_PASSWORD.MAX_LENGTH)
  password!: string;
}
