import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CategoriesModule } from '../categories/categories.module';
import { ExercisePlan, ExercisePlanSchema } from '../plans/plan.schema';
import { Exercise, ExerciseSchema } from './exercise.schema';
import { ExercisesService } from './exercises.service';
import { ExercisesController } from './exercises.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Exercise.name, schema: ExerciseSchema },
      // Read only here, for the patient's plan-only view of the library.
      { name: ExercisePlan.name, schema: ExercisePlanSchema },
    ]),
    CategoriesModule,
  ],
  controllers: [ExercisesController],
  providers: [ExercisesService],
  exports: [ExercisesService],
})
export class ExercisesModule {}
