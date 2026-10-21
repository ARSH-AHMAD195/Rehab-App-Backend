import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ExercisesModule } from '../exercises/exercises.module';
import { PlansModule } from '../plans/plans.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { ExerciseCompletion, ExerciseCompletionSchema } from './completion.schema';
import { CompletionsService } from './completions.service';
import { ComplianceService } from './compliance.service';
import { CompletionsController, PatientCompletionsController } from './completions.controller';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: ExerciseCompletion.name, schema: ExerciseCompletionSchema }]),
    ExercisesModule,
    PlansModule,
    IdempotencyModule,
  ],
  controllers: [CompletionsController, PatientCompletionsController],
  providers: [CompletionsService, ComplianceService],
  exports: [CompletionsService],
})
export class CompletionsModule {}
