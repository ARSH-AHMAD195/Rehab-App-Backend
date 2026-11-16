import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  CHECKLIST_STATUS,
  COMPLETION_LIMITS,
  COMPLETION_STATUS,
  ChecklistStatus,
  CompletionStatus,
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  SPIROMETRY,
} from '../common/constants';
import { trim } from '../categories/category.dto';
import { IsCalendarDate } from '../time/day.service';
import { PlanExerciseResponse, PlanTargetValues } from '../plans/plan.dto';

export class CompletionDetailsDto {
  @ApiPropertyOptional({ example: 15, nullable: true })
  @IsOptional() @IsInt() @Min(1) @Max(COMPLETION_LIMITS.DURATION_MIN)
  durationMin?: number | null;

  @ApiPropertyOptional({ example: 'Felt easy', nullable: true })
  @IsOptional() @Transform(trim) @IsString() @MaxLength(COMPLETION_LIMITS.NOTE)
  note?: string | null;

  @ApiPropertyOptional({
    example: 1250,
    nullable: true,
    description: 'Incentive spirometry: the volume reached, in mL. Only for exercises with recordsVolume.',
  })
  @IsOptional() @IsInt() @Min(0) @Max(SPIROMETRY.MAX_VOLUME_ML)
  volumeMl?: number | null;
}

export type CompletionDetailValues = { durationMin: number | null; note: string | null; volumeMl: number | null };

/** POST /exercise-completions */
export class RecordCompletionDto {
  @ApiProperty({ description: "The plan item's itemId, from the checklist or the plan" })
  @IsString() @MinLength(1) @MaxLength(64)
  itemId!: string;

  @ApiProperty({ example: '2026-10-20', description: "The patient's today, as the app saw it" })
  @IsCalendarDate()
  date!: string;

  @ApiPropertyOptional({
    enum: Object.values(COMPLETION_STATUS),
    default: COMPLETION_STATUS.DONE,
    description: 'DONE (default): one tick. SKIPPED: skip the rest of this exercise today; needs a reason.',
  })
  @IsOptional() @IsIn(Object.values(COMPLETION_STATUS))
  status?: CompletionStatus;

  @ApiPropertyOptional({ example: 'Knee pain this morning', description: 'Why it was skipped. Required with SKIPPED, refused otherwise.' })
  @ValidateIf((dto: RecordCompletionDto) => dto.status === COMPLETION_STATUS.SKIPPED || dto.reason !== undefined)
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(COMPLETION_LIMITS.SKIP_REASON)
  reason?: string;

  @ApiPropertyOptional({ type: CompletionDetailsDto, nullable: true, description: 'Optional, ticks only. ⏳ waiting for the client' })
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
  @ApiProperty({ enum: Object.values(COMPLETION_STATUS) }) status!: CompletionStatus;
  @ApiProperty({ nullable: true, type: String, example: null, description: 'Why it was skipped; null for a tick' })
  reason!: string | null;
  @ApiProperty({ example: '2026-10-20T08:15:00+05:30', description: 'When it was ticked, or skipped' }) completedAt!: string;
  @ApiProperty({ type: CompletionDetailsDto, nullable: true })
  details!: CompletionDetailValues | null;
}

export class CompletionListResponse {
  @ApiProperty({ type: [CompletionResponse] }) data!: CompletionResponse[];
  @ApiProperty({ nullable: true, type: String }) nextCursor!: string | null;
}

export class ChecklistDoneResponse {
  @ApiProperty() id!: string;
  @ApiProperty({ example: '2026-10-20T08:15:00+05:30' }) completedAt!: string;
  @ApiProperty({ nullable: true, type: Number, example: null, description: 'Incentive spirometry: the volume reached, in mL' })
  volumeMl!: number | null;
}

export class ChecklistSkipResponse {
  @ApiProperty({ description: 'What undo takes' }) id!: string;
  @ApiProperty({ example: 'Knee pain this morning' }) reason!: string;
  @ApiProperty({ example: '2026-10-20T09:00:00+05:30' }) skippedAt!: string;
}

export class ChecklistItemResponse {
  @ApiProperty() itemId!: string;
  @ApiProperty({ type: PlanExerciseResponse }) exercise!: PlanExerciseResponse;
  @ApiProperty({ example: 1 }) timesPerDay!: number;
  @ApiProperty({ example: 1 }) doneCount!: number;
  @ApiProperty({ enum: Object.values(CHECKLIST_STATUS) }) status!: ChecklistStatus;
  @ApiProperty({ type: [ChecklistDoneResponse], description: "Today's ticks, oldest first; their ids are what undo takes" })
  completions!: ChecklistDoneResponse[];
  @ApiProperty({ type: ChecklistSkipResponse, nullable: true, description: 'Set when the item was skipped that day' })
  skip!: ChecklistSkipResponse | null;
  @ApiProperty({ nullable: true }) target!: PlanTargetValues | null;
  @ApiProperty({ nullable: true, type: String }) notes!: string | null;
}

export class ChecklistResponse {
  @ApiProperty({ example: '2026-10-20' }) date!: string;
  @ApiProperty({ example: 3, description: 'The plan version that applied that day; 0 if none' }) planVersion!: number;
  @ApiProperty({ type: [ChecklistItemResponse] }) items!: ChecklistItemResponse[];
  @ApiProperty({ description: 'Ticks that count, at most timesPerDay per item' }) doneCount!: number;
  @ApiProperty({ description: 'Planned times left undone because the item was skipped' }) skippedCount!: number;
  @ApiProperty({ description: 'Sum of timesPerDay over the items planned that day' }) plannedCount!: number;
}
