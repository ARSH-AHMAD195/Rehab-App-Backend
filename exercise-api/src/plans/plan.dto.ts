import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDefined,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT, PLAN_LIMITS } from '../common/constants';
import { trim } from '../categories/category.dto';
import { ExerciseResponse } from '../exercises/exercise.dto';

export class ScheduleDto {
  @ApiProperty({ example: [1, 3, 5], description: '1 = Monday ... 7 = Sunday' })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(7) @ArrayUnique()
  @IsInt({ each: true }) @Min(1, { each: true }) @Max(7, { each: true })
  daysOfWeek!: number[];

  @ApiProperty({ example: 1 })
  @IsInt() @Min(1) @Max(PLAN_LIMITS.TIMES_PER_DAY)
  timesPerDay!: number;
}

export class TargetDto {
  @ApiPropertyOptional({ example: 2 })
  @IsOptional() @IsInt() @Min(1) @Max(PLAN_LIMITS.SETS)
  sets?: number | null;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional() @IsInt() @Min(1) @Max(PLAN_LIMITS.REPS)
  reps?: number | null;

  @ApiPropertyOptional({ example: null })
  @IsOptional() @IsInt() @Min(1) @Max(PLAN_LIMITS.DURATION_MIN)
  durationMin?: number | null;
}

export class PlanItemDto {
  @ApiProperty()
  @IsMongoId()
  exerciseId!: string;

  @ApiProperty({ type: ScheduleDto })
  // ValidateNested alone skips a missing value, which then reaches the service.
  @IsDefined() @ValidateNested() @Type(() => ScheduleDto)
  schedule!: ScheduleDto;

  @ApiPropertyOptional({ type: TargetDto, nullable: true })
  @IsOptional() @ValidateNested() @Type(() => TargetDto)
  target?: TargetDto | null;

  @ApiPropertyOptional({ example: 'Stop if pain goes above 5', nullable: true })
  @IsOptional() @Transform(trim) @IsString() @MaxLength(PLAN_LIMITS.NOTES)
  notes?: string | null;
}

/** PUT /patients/:patientId/exercise-plan */
export class SavePlanDto {
  @ApiProperty({ example: 0, description: 'The version you last saw; 0 when the patient has no plan yet.' })
  @IsInt() @Min(0)
  version!: number;

  @ApiProperty({ type: [PlanItemDto], description: 'An empty list clears the plan.' })
  @IsArray() @ArrayMaxSize(PLAN_LIMITS.ITEMS)
  @ValidateNested({ each: true }) @Type(() => PlanItemDto)
  items!: PlanItemDto[];
}

export class PlanVersionsQueryDto {
  @ApiPropertyOptional({ default: DEFAULT_PAGE_LIMIT, maximum: MAX_PAGE_LIMIT })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(MAX_PAGE_LIMIT)
  limit?: number;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  cursor?: string;
}

export class PlanExerciseResponse {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ example: 'STRENGTH' }) category!: string;
  @ApiProperty({ nullable: true, type: String }) description!: string | null;
  @ApiProperty({ type: [String] }) instructions!: string[];
  @ApiProperty({ nullable: true }) video!: ExerciseResponse['video'];
  @ApiProperty({ description: 'false if an admin deactivated it after it was planned' }) active!: boolean;
}

export class PlanItemResponse {
  @ApiProperty({ example: 'a1b2c3d4' }) itemId!: string;
  @ApiProperty({ type: PlanExerciseResponse }) exercise!: PlanExerciseResponse;
  @ApiProperty({ type: ScheduleDto }) schedule!: { daysOfWeek: number[]; timesPerDay: number };
  @ApiProperty({ type: TargetDto, nullable: true })
  target!: { sets: number | null; reps: number | null; durationMin: number | null } | null;
  @ApiProperty({ nullable: true, type: String }) notes!: string | null;
}

export class PlanResponse {
  @ApiProperty() patientId!: string;
  @ApiProperty({ example: 3, description: '0 when no plan has been assigned yet' }) version!: number;
  @ApiProperty({ type: [PlanItemResponse] }) items!: PlanItemResponse[];
  @ApiProperty({ nullable: true }) assignedBy!: { id: string; name: string } | null;
  @ApiProperty({ nullable: true, type: String, example: '2026-10-20T10:00:00+05:30' }) updatedAt!: string | null;
}

export class PlanVersionListResponse {
  @ApiProperty({ type: [PlanResponse] }) data!: PlanResponse[];
  @ApiProperty({ nullable: true, type: String }) nextCursor!: string | null;
}
