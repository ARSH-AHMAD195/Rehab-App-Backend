import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Investigation, InvestigationSchema } from '../investigations/investigation.schema';
import { DailyLogView, DailyLogViewSchema } from '../triage/triage.schema';
import {
  CareAlert,
  CareAlertSchema,
  ExerciseCompletionView,
  ExerciseCompletionViewSchema,
  MealLogView,
  MealLogViewSchema,
} from './care-alert.schema';
import { CareAlertsService } from './care-alerts.service';
import { CareAlertsController } from './care-alerts.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CareAlert.name, schema: CareAlertSchema },
      { name: ExerciseCompletionView.name, schema: ExerciseCompletionViewSchema },
      { name: MealLogView.name, schema: MealLogViewSchema },
      // Same schema objects as their own modules, so they share one model.
      { name: Investigation.name, schema: InvestigationSchema },
      { name: DailyLogView.name, schema: DailyLogViewSchema },
    ]),
  ],
  controllers: [CareAlertsController],
  providers: [CareAlertsService],
})
export class CareAlertsModule {}
