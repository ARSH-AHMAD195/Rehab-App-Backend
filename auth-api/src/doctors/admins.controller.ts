import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RegisteredAdminDoc } from '../common/response-docs';
import { RATE_LIMITS, ROLES } from '../common/constants';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RegistrationService } from '../registration/registration.service';
import { AuthUser } from '../users/auth-user';
import { RegisterAdminDto } from '../users/user.dto';
import { AdminResponse, UserResponses } from '../users/user.responses';

/**
 * POST /admins. The first admin can't come from here - nobody could call it -
 * so it is made once with `npm run create-admin`.
 */
@ApiTags('Admins')
@ApiBearerAuth()
@Roles(ROLES.ADMIN)
@Controller('admins')
export class AdminsController {
  constructor(
    private readonly registration: RegistrationService,
    private readonly responses: UserResponses,
  ) {}

  @Post()
  @Throttle({ [RATE_LIMITS.USER.name]: RATE_LIMITS.REGISTER })
  @ApiOperation({ summary: 'Register another admin' })
  @ApiCreatedResponse({ type: RegisteredAdminDoc })
  async register(@CurrentUser() admin: AuthUser, @Body() body: RegisterAdminDto): Promise<AdminResponse & { invitation: string }> {
    const { user, invitation } = await this.registration.register({ ...body, role: ROLES.ADMIN }, admin);
    return { ...this.responses.admin(user), invitation };
  }
}
