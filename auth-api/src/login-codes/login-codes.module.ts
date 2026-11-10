import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LoginCode, LoginCodeSchema } from './login-code.schema';
import { LoginCodesService } from './login-codes.service';
import { LoginCodeIssueController, LoginCodeSignInController } from './login-codes.controller';

@Module({
  imports: [MongooseModule.forFeature([{ name: LoginCode.name, schema: LoginCodeSchema }])],
  controllers: [LoginCodeSignInController, LoginCodeIssueController],
  providers: [LoginCodesService],
})
export class LoginCodesModule {}
