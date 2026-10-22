import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from './user.schema';
import { UsersService } from './users.service';
import { UserResponses } from './user.responses';
import { AccountsService } from './accounts.service';

@Global()
@Module({
  imports: [MongooseModule.forFeature([{ name: User.name, schema: UserSchema }])],
  providers: [UsersService, UserResponses, AccountsService],
  exports: [UsersService, UserResponses, AccountsService, MongooseModule],
})
export class UsersModule {}
