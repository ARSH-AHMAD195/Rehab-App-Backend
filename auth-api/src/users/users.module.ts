import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from './user.schema';
import { UsersService } from './users.service';
import { UserResponses } from './user.responses';
import { AccountsService } from './accounts.service';
import { MedicalProfile, MedicalProfileSchema } from '../medical-profiles/medical-profile.schema';

/**
 * MedicalProfile is registered here, not in MedicalProfilesModule, because
 * patient lists (UserResponses) read each patient's surgery date. This module
 * is global and exports MongooseModule, so MedicalProfilesModule still gets it.
 */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: MedicalProfile.name, schema: MedicalProfileSchema },
    ]),
  ],
  providers: [UsersService, UserResponses, AccountsService],
  exports: [UsersService, UserResponses, AccountsService, MongooseModule],
})
export class UsersModule {}
