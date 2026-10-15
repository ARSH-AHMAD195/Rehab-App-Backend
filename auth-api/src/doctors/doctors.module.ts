import { Module } from '@nestjs/common';
import { AdminsController } from './admins.controller';
import { DoctorsController } from './doctors.controller';
import { DoctorsService } from './doctors.service';

@Module({
  controllers: [AdminsController, DoctorsController],
  providers: [DoctorsService],
})
export class DoctorsModule {}
