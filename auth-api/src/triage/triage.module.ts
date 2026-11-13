import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Investigation, InvestigationSchema } from '../investigations/investigation.schema';
import { DailyLogView, DailyLogViewSchema, TriageRules, TriageRulesSchema } from './triage.schema';
import { TriageService } from './triage.service';
import { PatientTriageController, TriageRulesController } from './triage.controller';

/**
 * Global, because patient lists (UserResponses) show each patient's tag.
 * Investigation is registered here too, with the same schema object as in
 * InvestigationsModule, so both get the same model.
 */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TriageRules.name, schema: TriageRulesSchema },
      { name: DailyLogView.name, schema: DailyLogViewSchema },
      { name: Investigation.name, schema: InvestigationSchema },
    ]),
  ],
  controllers: [PatientTriageController, TriageRulesController],
  providers: [TriageService],
  exports: [TriageService],
})
export class TriageModule {}
