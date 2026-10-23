import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';
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
}

export class ComplianceExerciseResponse {
  @ApiProperty() itemId!: string;
  @ApiProperty() exerciseId!: string;
  @ApiProperty({ example: 'Seated knee extension' }) name!: string;
  @ApiProperty({ example: 7 }) planned!: number;
  @ApiProperty({ example: 7 }) done!: number;
}

export class ComplianceResponse {
  @ApiProperty({ example: '2026-10-14' }) from!: string;
  @ApiProperty({ example: '2026-10-20' }) to!: string;
  @ApiProperty({ example: 35, description: 'Planned times over the range' }) planned!: number;
  @ApiProperty({ example: 28, description: 'Of those, how many were done' }) done!: number;
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
