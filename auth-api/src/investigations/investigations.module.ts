import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Investigation, InvestigationRange, InvestigationRangeSchema, InvestigationSchema } from './investigation.schema';
import { InvestigationsService } from './investigations.service';
import {
  InvestigationRangesController,
  InvestigationTestsController,
  PatientInvestigationsController,
} from './investigations.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Investigation.name, schema: InvestigationSchema },
      { name: InvestigationRange.name, schema: InvestigationRangeSchema },
    ]),
  ],
  controllers: [InvestigationTestsController, PatientInvestigationsController, InvestigationRangesController],
  providers: [InvestigationsService],
  exports: [InvestigationsService],
})
export class InvestigationsModule {}
