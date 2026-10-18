import { Module } from '@nestjs/common';
import { ThresholdsModule } from '../thresholds/thresholds.module';
import { VitalTypesModule } from '../vital-types/vital-types.module';
import { AdminController } from './admin.controller';

@Module({
  imports: [ThresholdsModule, VitalTypesModule],
  controllers: [AdminController],
})
export class AdminModule {}
