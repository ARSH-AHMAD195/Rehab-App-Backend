import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MedicalProfile, MedicalProfileSchema } from './medical-profile.schema';
import { MedicalProfilesService } from './medical-profiles.service';
import { MyMedicalProfileController, PatientMedicalProfileController } from './medical-profiles.controller';

@Module({
  imports: [MongooseModule.forFeature([{ name: MedicalProfile.name, schema: MedicalProfileSchema }])],
  // Order matters: /patients/me/... must be matched before /patients/:patientId/...
  controllers: [MyMedicalProfileController, PatientMedicalProfileController],
  providers: [MedicalProfilesService],
})
export class MedicalProfilesModule {}
