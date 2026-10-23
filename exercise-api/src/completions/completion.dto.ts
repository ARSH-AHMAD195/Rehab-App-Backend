import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { CHECKLIST_STATUS, COMPLETION_LIMITS, ChecklistStatus, DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from '../common/constants';
import { trim } from '../categories/category.dto';
import { IsCalendarDate } from '../time/day.service';
import { PlanExerciseResponse } from '../plans/plan.dto';

export class CompletionDetailsDto {
  @ApiPropertyOptional({ example: 15, nullable: true })
  @IsOptional() @IsInt() @Min(1) @Max(COMPLETION_LIMITS.DURATION_MIN)
  durationMin?: number | null;

  @ApiPropertyOptional({ example: 'Felt easy', nullable: true })
  @IsOptional() @Transform(trim) @IsString() @MaxLength(COMPLETION_LIMITS.NOTE)
  note?: string | null;
}

/** POST /exercise-completions */
export class RecordCompletionDto {
  @ApiProperty({ description: "The plan item's itemId, from the checklist or the plan" })
  @IsString() @MinLength(1) @MaxLength(64)
  itemId!: string;

  @ApiProperty({ example: '2026-10-20', description: "The patient's today, as the app saw it" })
  @IsCalendarDate()
  date!: string;

  @ApiPropertyOptional({ type: CompletionDetailsDto, nullable: true, description: 'Optional. ⏳ waiting for the client' })
  @IsOptional() @ValidateNested() @Type(() => CompletionDetailsDto)
  details?: CompletionDetailsDto | null;
}

export class ChecklistQueryDto {
  @ApiPropertyOptional({ example: '2026-10-20', description: "Defaults to the patient's today" })
  @IsOptional() @IsCalendarDate()
  date?: string;
}

export class HistoryQueryDto {
  @ApiPropertyOptional({ description: 'Defaults to 30 days before `to`' })
  @IsOptional() @IsCalendarDate()
  from?: string;

  @ApiPropertyOptional({ description: "Defaults to the patient's today" })
  @IsOptional() @IsCalendarDate()
  to?: string;

  @ApiPropertyOptional({ default: DEFAULT_PAGE_LIMIT, maximum: MAX_PAGE_LIMIT })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(MAX_PAGE_LIMIT)
  limit?: number;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  cursor?: string;
}

export class CompletionExerciseResponse {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ example: 'STRENGTH' }) category!: string;
}

export class CompletionResponse {
  @ApiProperty() id!: string;
  @ApiProperty() itemId!: string;
  @ApiProperty({ type: CompletionExerciseResponse }) exercise!: CompletionExerciseResponse;
  @ApiProperty({ example: 3 }) planVersion!: number;
  @ApiProperty({ example: '2026-10-20' }) date!: string;
  @ApiProperty({ example: '2026-10-20T08:15:00+05:30' }) completedAt!: string;
  @ApiProperty({ type: CompletionDetailsDto, nullable: true })
  details!: { durationMin: number | null; note: string | null } | null;
}

export class CompletionListResponse {
  @ApiProperty({ type: [CompletionResponse] }) data!: CompletionResponse[];
  @ApiProperty({ nullable: true, type: String }) nextCursor!: string | null;
}

export class ChecklistDoneResponse {
  @ApiProperty() id!: string;
  @ApiProperty({ example: '2026-10-20T08:15:00+05:30' }) completedAt!: string;
}

export class ChecklistItemResponse {
  @ApiProperty() itemId!: string;
  @ApiProperty({ type: PlanExerciseResponse }) exercise!: PlanExerciseResponse;
  @ApiProperty({ example: 1 }) timesPerDay!: number;
  @ApiProperty({ example: 1 }) doneCount!: number;
  @ApiProperty({ enum: Object.values(CHECKLIST_STATUS) }) status!: ChecklistStatus;
  @ApiProperty({ type: [ChecklistDoneResponse], description: "Today's ticks, oldest first; their ids are what undo takes" })
  completions!: ChecklistDoneResponse[];
  @ApiProperty({ nullable: true }) target!: { sets: number | null; reps: number | null; durationMin: number | null } | null;
  @ApiProperty({ nullable: true, type: String }) notes!: string | null;
}

export class ChecklistResponse {
  @ApiProperty({ example: '2026-10-20' }) date!: string;
  @ApiProperty({ example: 3, description: 'The plan version that applied that day; 0 if none' }) planVersion!: number;
  @ApiProperty({ type: [ChecklistItemResponse] }) items!: ChecklistItemResponse[];
  @ApiProperty({ description: 'Ticks that count, at most timesPerDay per item' }) doneCount!: number;
  @ApiProperty({ description: 'Sum of timesPerDay over the items planned that day' }) plannedCount!: number;
}
