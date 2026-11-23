import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Investigation, InvestigationRange, InvestigationRangeSchema, InvestigationSchema } from './investigation.schema';
import { InvestigationsService } from './investigations.service';
import {
  InvestigationRangesController,
  InvestigationTestsController,
  MyInvestigationsController,
  PatientInvestigationsController,
} from './investigations.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Investigation.name, schema: InvestigationSchema },
      { name: InvestigationRange.name, schema: InvestigationRangeSchema },
    ]),
  ],
  // /patients/me/... must be matched before /patients/:patientId/...
  controllers: [InvestigationTestsController, MyInvestigationsController, PatientInvestigationsController, InvestigationRangesController],
  providers: [InvestigationsService],
  exports: [InvestigationsService],
})
export class InvestigationsModule {}
