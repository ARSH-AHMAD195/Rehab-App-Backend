import { Global, Module } from '@nestjs/common';
import { DayService } from './day.service';

@Global()
@Module({ providers: [DayService], exports: [DayService] })
export class TimeModule {}
