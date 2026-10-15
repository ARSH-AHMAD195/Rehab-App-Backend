import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from '../users/users.module';
import { VitalTypesModule } from '../vital-types/vital-types.module';
import { AlertThreshold, AlertThresholdSchema } from './alert-threshold.schema';
import { ThresholdsService } from './thresholds.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: AlertThreshold.name, schema: AlertThresholdSchema }]),
    VitalTypesModule,
    UsersModule,
  ],
  providers: [ThresholdsService],
  exports: [ThresholdsService],
})
export class ThresholdsModule {}
