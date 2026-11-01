import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { DEFAULT_COMPLIANCE_DAYS, MAX_COMPLIANCE_DAYS } from '../common/constants';
import { IsCalendarDate } from '../time/day.service';

export class ComplianceQueryDto {
  @ApiPropertyOptional({ description: 'Defaults to 6 days before `to` (a week). At most 90 days.' })
  @IsOptional() @IsCalendarDate()
  from?: string;

  @ApiPropertyOptional({ description: "Defaults to the patient's today. Can't be later." })
  @IsOptional() @IsCalendarDate()
  to?: string;
}

export class ComplianceDayResponse {
  @ApiProperty({ example: '2026-10-20' }) date!: string;
  @ApiProperty({ example: 5 }) planned!: number;
  @ApiProperty({ example: 4 }) done!: number;
  @ApiProperty({ example: 1, description: 'Planned times left undone because the patient skipped' }) skipped!: number;
}

export class ComplianceExerciseResponse {
  @ApiProperty() itemId!: string;
  @ApiProperty() exerciseId!: string;
  @ApiProperty({ example: 'Seated knee extension' }) name!: string;
  @ApiProperty({ example: 7 }) planned!: number;
  @ApiProperty({ example: 7 }) done!: number;
  @ApiProperty({ example: 0 }) skipped!: number;
}

export class ComplianceResponse {
  @ApiProperty({ example: '2026-10-14' }) from!: string;
  @ApiProperty({ example: '2026-10-20' }) to!: string;
  @ApiProperty({ example: 35, description: 'Planned times over the range' }) planned!: number;
  @ApiProperty({ example: 28, description: 'Of those, how many were done' }) done!: number;
  @ApiProperty({ example: 2, description: 'Of those, how many were skipped (with a reason)' }) skipped!: number;
  @ApiProperty({
    nullable: true,
    type: Number,
    description: '⏳ Always null until the client agrees how compliance is worked out',
  })
  percentage!: number | null;
  @ApiProperty({ type: [ComplianceDayResponse], description: 'Every day in the range, oldest first' })
  byDay!: ComplianceDayResponse[];
  @ApiProperty({ type: [ComplianceExerciseResponse], description: 'Each planned item in the range' })
  byExercise!: ComplianceExerciseResponse[];
}

export class CaseloadQueryDto {
  @ApiPropertyOptional({
    default: DEFAULT_COMPLIANCE_DAYS,
    maximum: MAX_COMPLIANCE_DAYS,
    description: "How many days back, ending on each patient's own today",
  })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(MAX_COMPLIANCE_DAYS)
  days?: number;
}

export class CaseloadCountsResponse {
  @ApiProperty({ example: 5 }) planned!: number;
  @ApiProperty({ example: 4 }) done!: number;
  @ApiProperty({ example: 1 }) skipped!: number;
}

export class CaseloadPatientResponse {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'Rajesh Iyer' }) name!: string;
}

export class CaseloadRowResponse {
  @ApiProperty({ type: CaseloadPatientResponse }) patient!: CaseloadPatientResponse;
  @ApiProperty({ example: '2026-10-14' }) from!: string;
  @ApiProperty({ example: '2026-10-20', description: "The patient's today" }) to!: string;
  @ApiProperty({ example: 35 }) planned!: number;
  @ApiProperty({ example: 28 }) done!: number;
  @ApiProperty({ example: 2 }) skipped!: number;
  @ApiProperty({ nullable: true, type: Number, description: '⏳ Always null until the client agrees the formula' })
  percentage!: number | null;
  @ApiProperty({ type: CaseloadCountsResponse, description: "The patient's today, so far" }) today!: CaseloadCountsResponse;
  @ApiProperty({
    nullable: true,
    type: String,
    example: '2026-10-20T08:15:00+05:30',
    description: 'Their last tick or skip, ever; null if none',
  })
  lastActivityAt!: string | null;
}

export class CaseloadResponse {
  @ApiProperty({ example: 7 }) days!: number;
  @ApiProperty({ type: [CaseloadRowResponse], description: 'Every active patient linked to you, by name' })
  data!: CaseloadRowResponse[];
}
