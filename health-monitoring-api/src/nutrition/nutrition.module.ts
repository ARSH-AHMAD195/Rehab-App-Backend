import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MealLog, MealLogSchema, PatientDietPlan, PatientDietPlanSchema } from './nutrition.schema';
import { NutritionService } from './nutrition.service';
import { DoctorNutritionController, MeNutritionController } from './nutrition.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PatientDietPlan.name, schema: PatientDietPlanSchema },
      { name: MealLog.name, schema: MealLogSchema },
    ]),
  ],
  controllers: [MeNutritionController, DoctorNutritionController],
  providers: [NutritionService],
})
export class NutritionModule {}
