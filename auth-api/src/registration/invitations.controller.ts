import { Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InvitationStatus, ROLES } from '../common/constants';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../users/auth-user';
import { InvitationsService } from './invitations.service';

@ApiTags('Registration')
@ApiBearerAuth()
@Controller('users/:userId/invitations')
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @Roles(ROLES.ADMIN, ROLES.DOCTOR)
  @ApiOperation({
    summary: 'Send the set-password email again',
    description:
      'Admin: any user. Doctor: linked patients only (others are 404). At most 5 per user per hour. ' +
      'Also works as a password reset once a password is set.',
  })
  async resend(
    @CurrentUser() caller: AuthUser,
    @Param('userId') userId: string,
  ): Promise<{ invitation: InvitationStatus }> {
    return { invitation: await this.invitations.resend(caller, userId) };
  }
}
