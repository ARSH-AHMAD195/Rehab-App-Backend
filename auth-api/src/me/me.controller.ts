import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DETAIL_CODES, ROLES } from '../common/constants';
import { ErrorDetail, ValidationFailedException } from '../common/api.exception';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AllowUnverified } from '../common/guards/email-verified.guard';
import { AccountsService } from '../users/accounts.service';
import { AuthUser } from '../users/auth-user';
import { UpdateMyProfileDto } from '../users/user.dto';
import { ProfileResponse, UserResponses } from '../users/user.responses';
import { UsersService } from '../users/users.service';

interface MeResponse {
  id: string;
  role: string;
  name: string;
  email: string | null;
  emailVerified: boolean;
  active: boolean;
}

/** Identity and own profile. Every role; the user always comes from the token. */
@ApiTags('Identity and own profile')
@ApiBearerAuth()
@Controller()
export class MeController {
  constructor(
    private readonly users: UsersService,
    private readonly accounts: AccountsService,
    private readonly responses: UserResponses,
  ) {}

  @Get('auth/me')
  @AllowUnverified()
  @ApiOperation({
    summary: 'Who am I',
    description: 'Works while the email is unverified, so the app can show the "verify your email" screen.',
  })
  me(@CurrentUser() user: AuthUser): MeResponse {
    return {
      id: user.id,
      role: user.role,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      // The guard only lets active users through.
      active: true,
    };
  }

  @Get('users/me/profile')
  @ApiOperation({ summary: 'My basic profile' })
  async profile(@CurrentUser() user: AuthUser): Promise<ProfileResponse> {
    return this.responses.profile((await this.users.model.findById(user.id).exec())!);
  }

  @Patch('users/me/profile')
  @ApiOperation({
    summary: 'Update my basic profile',
    description: 'name and phone: any role. timeZone: patients. specialization: doctors.',
  })
  async update(@CurrentUser() user: AuthUser, @Body() body: UpdateMyProfileDto): Promise<ProfileResponse> {
    const details: ErrorDetail[] = [];
    if (body.timeZone !== undefined && user.role !== ROLES.PATIENT) {
      details.push({ field: 'timeZone', code: DETAIL_CODES.NOT_ALLOWED, issue: 'only patients have a time zone' });
    }
    if (body.specialization !== undefined && user.role !== ROLES.DOCTOR) {
      details.push({ field: 'specialization', code: DETAIL_CODES.NOT_ALLOWED, issue: 'only doctors have a specialization' });
    }
    if (details.length) throw new ValidationFailedException(details);

    const current = (await this.users.model.findById(user.id).exec())!;
    const updated = await this.accounts.update(user, current, body);
    return this.responses.profile(updated);
  }
}
