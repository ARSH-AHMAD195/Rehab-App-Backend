import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DailyLog, DailyLogSchema } from '../daily-logs/daily-log.schema';
import { ThresholdsModule } from '../thresholds/thresholds.module';
import { UsersModule } from '../users/users.module';
import { VitalAlert, VitalAlertSchema } from './vital-alert.schema';
import { AlertsService } from './alerts.service';
import { DoctorAlertsController } from './doctor-alerts.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: VitalAlert.name, schema: VitalAlertSchema },
      // Read-only here, for the `currentValue` on an alert.
      { name: DailyLog.name, schema: DailyLogSchema },
    ]),
    ThresholdsModule,
    UsersModule,
  ],
  controllers: [DoctorAlertsController],
  providers: [AlertsService],
  exports: [AlertsService],
})
export class AlertsModule {}
