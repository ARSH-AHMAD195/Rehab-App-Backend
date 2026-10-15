import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export interface ThresholdPair {
  low: number | null;
  high: number | null;
}

/**
 * GET /me/vitals/trends (v1.1), shaped for Chart.js:
 *
 *   { type, unit, period, labels[], values[], thresholds }
 *
 * For BP the response carries `systolic` and `diastolic` arrays instead of
 * `values`, and `thresholds` has one entry per field.
 */
export class TrendResponse {
  @ApiProperty({ example: 'PULSE' }) type!: string;
  @ApiProperty({ nullable: true, example: 'bpm' }) unit!: string | null;
  @ApiProperty({ example: '7d' }) period!: string;

  @ApiProperty({
    description: 'Local dates, oldest first, ending with today.',
    example: ['2026-10-03', '2026-10-04'],
  })
  labels!: string[];

  @ApiPropertyOptional({
    description: 'One value per day; null where nothing was logged, so the chart shows a gap.',
    example: [78, 80, null],
  })
  values?: (number | null)[];

  @ApiPropertyOptional({ description: 'BP only.', example: [128, 130, null] })
  systolic?: (number | null)[];

  @ApiPropertyOptional({ description: 'BP only.', example: [82, 84, null] })
  diastolic?: (number | null)[];

  @ApiProperty({
    nullable: true,
    description:
      'The limits in effect today for this patient (override, else global), or null when none ' +
      'is set. One entry per field for BP.',
    example: { low: 50, high: 110 },
  })
  thresholds!: ThresholdPair | Record<string, ThresholdPair | null> | null;
}
