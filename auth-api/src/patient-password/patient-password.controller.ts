import { Body, Controller, HttpCode, HttpStatus, Post, Put } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { LOGIN_CODE, PATIENT_PASSWORD, RATE_LIMITS, ROLES } from '../common/constants';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AuthUser } from '../users/auth-user';
import { PatientPasswordLoginDto, SetPatientPasswordDto } from './patient-password.dto';
import { PatientPasswordService } from './patient-password.service';

class PasswordTokenDoc {
  @ApiProperty({ description: "Pass to Firebase's signInWithCustomToken; after that use normal ID tokens." }) customToken!: string;
}

class PasswordSetDoc {
  @ApiProperty({ example: true }) hasPassword!: true;
  @ApiProperty({ type: String, nullable: true, example: '2026-11-23T10:15:00+05:30' }) passwordSetAt!: string | null;
}

/** Signing in with phone and password: before the patient is signed in. */
@ApiTags('Patient password')
@Public()
// Per IP address, like the login-code routes; wrong passwords are also limited per patient.
@Throttle({ [RATE_LIMITS.USER.name]: LOGIN_CODE.PUBLIC_RATE })
@Controller('auth/password-login')
export class PatientPasswordLoginController {
  constructor(private readonly passwords: PatientPasswordService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sign in with my phone number and password (patient)',
    description:
      `No sign-in needed. 401 INVALID_CREDENTIALS for a wrong number or password, no password set yet, ` +
      `or after ${PATIENT_PASSWORD.MAX_FAILURES} wrong tries in a row (locked ${PATIENT_PASSWORD.LOCK_MINUTES} minutes; ` +
      `a login code from the doctor still works). Deactivated patients are refused the same way.`,
  })
  @ApiOkResponse({ type: PasswordTokenDoc })
  signIn(@Body() body: PatientPasswordLoginDto): Promise<{ customToken: string }> {
    return this.passwords.signIn(body.phone, body.password);
  }
}

/** Setting or resetting the password, once signed in with a doctor's code. */
@ApiTags('Patient password')
@ApiBearerAuth()
@Roles(ROLES.PATIENT)
@Controller('users/me/password')
export class PatientPasswordController {
  constructor(private readonly passwords: PatientPasswordService) {}

  @Put()
  @ApiOperation({
    summary: 'Set or reset my password (patient)',
    description:
      `At least ${PATIENT_PASSWORD.MIN_LENGTH} characters. Only in a session that started from a login code ` +
      '(the first sign-in, or after asking the doctor for a code because the password was forgotten); ' +
      'otherwise 403 LOGIN_CODE_SESSION_REQUIRED. Audited; the password is never stored or logged, only its hash.',
  })
  @ApiOkResponse({ type: PasswordSetDoc })
  set(@CurrentUser() patient: AuthUser, @Body() body: SetPatientPasswordDto): ReturnType<PatientPasswordService['set']> {
    return this.passwords.set(patient, body.password);
  }
}
