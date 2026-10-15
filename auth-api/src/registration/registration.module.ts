import { Global, Module } from '@nestjs/common';
import { InvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';
import { RegistrationService } from './registration.service';

@Global()
@Module({
  controllers: [InvitationsController],
  providers: [RegistrationService, InvitationsService],
  exports: [RegistrationService, InvitationsService],
})
export class RegistrationModule {}
