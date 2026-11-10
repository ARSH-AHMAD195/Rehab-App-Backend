import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import { LOGIN_CODE, RATE_LIMITS, ROLES } from '../common/constants';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AuthUser } from '../users/auth-user';
import { RequestLoginCodeDto, VerifyLoginCodeDto } from './login-code.dto';
import { IssuedLoginCodeResponse, LoginCodeRequestResponse, LoginCodesService } from './login-codes.service';

// ---------------------------------------------------------------- docs page shapes

class RequestAcceptedDoc {
  @ApiProperty({ example: 'If this number belongs to a patient, their doctor can now see the request.' }) message!: string;
}

class CustomTokenDoc {
  @ApiProperty({ description: "Pass to Firebase's signInWithCustomToken; after that use normal ID tokens." }) customToken!: string;
}

class RequestPatientDoc {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'Rajesh Iyer' }) name!: string;
  @ApiProperty({ type: String, nullable: true, example: '+919876543210' }) phone!: string | null;
}

class LoginCodeRequestDoc {
  @ApiProperty({ type: RequestPatientDoc }) patient!: RequestPatientDoc;
  @ApiProperty({ type: String, nullable: true, example: '2026-11-10T09:15:00+05:30' }) requestedAt!: string | null;
}

class LoginCodeRequestListDoc {
  @ApiProperty({ type: [LoginCodeRequestDoc] }) data!: LoginCodeRequestDoc[];
}

class IssuedLoginCodeDoc {
  @ApiProperty() patientId!: string;
  @ApiProperty({ example: '+919876543210' }) phone!: string;
  @ApiProperty({ example: '482913', description: 'Shown only here, once. Tell it to the patient.' }) code!: string;
  @ApiProperty({ type: String, nullable: true, example: '2026-11-10T09:25:00+05:30' }) expiresAt!: string | null;
  @ApiProperty({ example: LOGIN_CODE.DEFAULT_TTL_MINUTES }) expiresInMinutes!: number;
  @ApiProperty({ example: LOGIN_CODE.DEFAULT_MAX_ATTEMPTS }) maxAttempts!: number;
}

// ---------------------------------------------------------------- patient: signing in

/** The two routes a patient calls before they are signed in. */
@ApiTags('Login code (patient sign-in)')
@Public()
@Throttle({ [RATE_LIMITS.USER.name]: LOGIN_CODE.PUBLIC_RATE })
@Controller('auth/login-code')
export class LoginCodeSignInController {
  constructor(private readonly codes: LoginCodesService) {}

  @Post('request')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Ask my doctor for a login code',
    description: "No sign-in needed. Puts the request on the doctor's list. Same answer whether or not the number is known.",
  })
  @ApiAcceptedResponse({ type: RequestAcceptedDoc })
  async request(@Body() body: RequestLoginCodeDto): Promise<{ message: string }> {
    await this.codes.request(body.phone);
    return { message: 'If this number belongs to a patient, their doctor can now see the request.' };
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sign in with the code from my doctor',
    description: 'No sign-in needed. 401 INVALID_LOGIN_CODE for a wrong, expired or used-up code, or an unknown number.',
  })
  @ApiOkResponse({ type: CustomTokenDoc })
  verify(@Body() body: VerifyLoginCodeDto): Promise<{ customToken: string }> {
    return this.codes.verify(body.phone, body.code);
  }
}

// ---------------------------------------------------------------- doctor: making codes

@ApiTags('Login code (doctor, admin)')
@ApiBearerAuth()
@Roles(ROLES.DOCTOR, ROLES.ADMIN)
@Controller()
export class LoginCodeIssueController {
  constructor(private readonly codes: LoginCodesService) {}

  @Get('doctor/login-code-requests')
  @ApiOperation({
    summary: 'Patients waiting for a login code',
    description: 'Doctor: linked patients. Admin: every patient. Requests from the last 24 hours, newest first.',
  })
  @ApiOkResponse({ type: LoginCodeRequestListDoc })
  openRequests(@CurrentUser() caller: AuthUser): Promise<{ data: LoginCodeRequestResponse[] }> {
    return this.codes.openRequests(caller);
  }

  @Post('patients/:patientId/login-code')
  @ApiOperation({
    summary: 'Make a login code for a patient',
    description: 'Returns the code once, to pass on to the patient. Any earlier code stops working.',
  })
  @ApiCreatedResponse({ type: IssuedLoginCodeDoc })
  issue(@CurrentUser() caller: AuthUser, @Param('patientId') patientId: string): Promise<IssuedLoginCodeResponse> {
    return this.codes.issue(caller, patientId);
  }
}

// Build-time check: the docs shape has exactly the response's fields.
type SameKeys<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const check: SameKeys<keyof IssuedLoginCodeDoc, keyof IssuedLoginCodeResponse> = true;
void check;
