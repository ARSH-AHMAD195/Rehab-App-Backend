import { Module } from '@nestjs/common';
import { PatientPasswordController, PatientPasswordLoginController } from './patient-password.controller';
import { PatientPasswordService } from './patient-password.service';

@Module({
  controllers: [PatientPasswordLoginController, PatientPasswordController],
  providers: [PatientPasswordService],
})
export class PatientPasswordModule {}
