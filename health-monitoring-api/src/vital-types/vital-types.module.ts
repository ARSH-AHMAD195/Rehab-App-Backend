import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { VitalTypeDef, VitalTypeSchema } from './vital-type.schema';
import { VitalTypesService } from './vital-types.service';
import { VitalTypesController } from './vital-types.controller';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: VitalTypeDef.name, schema: VitalTypeSchema }]),
  ],
  controllers: [VitalTypesController],
  providers: [VitalTypesService],
  exports: [VitalTypesService],
})
export class VitalTypesModule {}
