import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import {
  ALERT_STATUS,
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  TREND_PERIODS,
  TrendPeriod,
  VITAL_TYPES,
} from '../common/constants';
import { IsCalendarDate } from '../time/day.service';

/** PUT /me/vitals/today body (v1.1). */
export class SaveTodayDto {
  @ApiProperty({
    example: '2026-10-09',
    description:
      'Required. The day the form was opened for; it must equal the patient’s today, ' +
      'otherwise the save is refused with 409 DAY_CHANGED.',
  })
  @IsString()
  @IsNotEmpty()
  @IsCalendarDate()
  date!: string;

  @ApiProperty({
    example: { WEIGHT: { num: 56 }, STEPS: { num: 5000 }, PAIN: { num: 7 }, MOOD: { num: 4 } },
    description:
      'Only the fields that changed. Fields not sent stay as they are; null clears a value. ' +
      'Shapes and ranges are checked against the stored parameter definitions.',
  })
  @IsObject()
  readings!: Record<string, unknown>;
}

export class PaginationQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: MAX_PAGE_LIMIT, default: DEFAULT_PAGE_LIMIT })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_LIMIT)
  limit?: number;

  @ApiPropertyOptional({ description: 'nextCursor from the previous page.' })
  @IsOptional()
  @IsString()
  cursor?: string;
}

/** GET /me/vitals/logs and the doctor equivalent (v1.1). */
export class LogsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: '2026-09-10', description: 'Defaults to 30 days ago.' })
  @IsOptional()
  @IsCalendarDate()
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-09', description: 'Defaults to today.' })
  @IsOptional()
  @IsCalendarDate()
  to?: string;
}

/** GET /me/vitals/trends and the doctor equivalent (v1.1). */
export class TrendsQueryDto {
  @ApiProperty({
    enum: VITAL_TYPES.filter((type) => type !== 'NUTRITION'),
    description: 'Any parameter except NUTRITION.',
  })
  @IsString()
  @IsNotEmpty()
  type!: string;

  @ApiPropertyOptional({ enum: Object.keys(TREND_PERIODS), default: '30d' })
  @IsOptional()
  @IsIn(Object.keys(TREND_PERIODS))
  period?: TrendPeriod;
}

/** GET /doctor/alerts (v1.1). */
export class AlertsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: Object.values(ALERT_STATUS), default: ALERT_STATUS.OPEN })
  @IsOptional()
  @IsIn(Object.values(ALERT_STATUS))
  status?: 'OPEN' | 'ACKNOWLEDGED';

  @ApiPropertyOptional({ description: 'Filter to one patient. 404 if not linked.' })
  @IsOptional()
  @IsString()
  patientId?: string;
}

/** GET /admin/alert-thresholds (v1.1). */
export class ThresholdsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: VITAL_TYPES })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (value === '' ? undefined : value))
  patientId?: string;
}
