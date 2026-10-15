import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AlertsModule } from '../alerts/alerts.module';
import { ThresholdsModule } from '../thresholds/thresholds.module';
import { UsersModule } from '../users/users.module';
import { VitalTypesModule } from '../vital-types/vital-types.module';
import { DailyLog, DailyLogSchema } from './daily-log.schema';
import { DailyLogsService } from './daily-logs.service';
import { ReadingsValidatorService } from './readings-validator.service';
import { MeVitalsController } from './me-vitals.controller';
import { DoctorVitalsController } from './doctor-vitals.controller';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: DailyLog.name, schema: DailyLogSchema }]),
    VitalTypesModule,
    ThresholdsModule,
    AlertsModule,
    UsersModule,
  ],
  controllers: [MeVitalsController, DoctorVitalsController],
  providers: [DailyLogsService, ReadingsValidatorService],
  exports: [DailyLogsService],
})
export class DailyLogsModule {}
