import { Module } from '@nestjs/common';
import { MedicalProfilesService } from './medical-profiles.service';
import { MyMedicalProfileController, PatientMedicalProfileController } from './medical-profiles.controller';

/** The MedicalProfile model comes from the global UsersModule (see there). */
@Module({
  // Order matters: /patients/me/... must be matched before /patients/:patientId/...
  controllers: [MyMedicalProfileController, PatientMedicalProfileController],
  providers: [MedicalProfilesService],
})
export class MedicalProfilesModule {}
