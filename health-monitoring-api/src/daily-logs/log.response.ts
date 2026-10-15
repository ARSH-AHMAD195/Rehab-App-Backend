import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  DAY_STATUS,
  MOOD_LABELS,
  READING_STATUS,
  VALUE_KINDS,
} from '../common/constants';
import { DayService } from '../time/day.service';
import { VitalTypeDef } from '../vital-types/vital-type.schema';
import { DailyLogDocument, StoredReading } from './daily-log.schema';
import { SaveAlertResponse } from '../alerts/alert.response';

export class ReadingResponse {
  @ApiProperty({ nullable: true, example: { systolic: 128, diastolic: 82 } })
  value!: Record<string, unknown> | null;

  @ApiProperty({ nullable: true, example: 'mmHg' })
  unit!: string | null;

  @ApiProperty({ enum: Object.values(READING_STATUS) })
  status!: string;

  @ApiProperty({ nullable: true, example: '2026-10-09T07:05:00+05:30' })
  loggedAt!: string | null;

  @ApiPropertyOptional({ description: 'MOOD only: the level label.', example: 'Good' })
  label?: string | null;
}

/** GET /me/vitals/today, and each entry of GET /me/vitals/logs (v1.1). */
export class DailyLogResponse {
  @ApiProperty({ example: '2026-10-09' }) date!: string;
  @ApiProperty({ example: 'Asia/Kolkata' }) timeZone!: string;
  @ApiProperty({ enum: Object.values(DAY_STATUS) }) dayStatus!: string;
  @ApiProperty({ example: 9 }) filledCount!: number;
  @ApiProperty({ example: 14 }) totalCount!: number;

  @ApiProperty({
    description: 'All 13 parameters, whether logged or not.',
    type: 'object',
    additionalProperties: { $ref: '#/components/schemas/ReadingResponse' },
  })
  readings!: Record<string, ReadingResponse>;
}

/** PUT /me/vitals/today: the full log plus the alerts this save raised. */
export class SaveLogResponse extends DailyLogResponse {
  @ApiProperty({ type: [SaveAlertResponse] })
  alerts!: SaveAlertResponse[];
}

export class LogListResponse {
  @ApiProperty({ type: [DailyLogResponse] }) data!: DailyLogResponse[];
  @ApiProperty({ nullable: true }) nextCursor!: string | null;
}

/**
 * v1.1: "The example shows 5 of the 13 parameters. The real response always
 * includes all 13." Parameters with nothing logged come back as NOT_YET with a
 * null value, so the form never has to guess what exists.
 */
export function toLogResponse(
  log: DailyLogDocument | StoredLogLike,
  defs: VitalTypeDef[],
  day: DayService,
): DailyLogResponse {
  const readings: Record<string, ReadingResponse> = {};

  for (const def of defs) {
    const stored: StoredReading | undefined = log.readings?.[def.type];
    readings[def.type] = toReadingResponse(def, stored, log.timeZone, day);
  }

  return {
    date: log.date,
    timeZone: log.timeZone,
    dayStatus: log.dayStatus,
    filledCount: log.filledCount,
    totalCount: log.totalCount,
    readings,
  };
}

export interface StoredLogLike {
  date: string;
  timeZone: string;
  dayStatus: string;
  filledCount: number;
  totalCount: number;
  readings: Record<string, StoredReading>;
}

function toReadingResponse(
  def: VitalTypeDef,
  stored: StoredReading | undefined,
  timeZone: string,
  day: DayService,
): ReadingResponse {
  const response: ReadingResponse = {
    // A value saved before an admin changed the unit keeps the unit it was
    // saved with; untouched parameters show the current one.
    value: stored?.value ?? null,
    unit: stored?.unit ?? def.unit,
    status: stored?.status ?? READING_STATUS.NOT_YET,
    loggedAt: day.toLocalIso(stored?.loggedAt ?? null, timeZone),
  };

  if (def.valueKind === VALUE_KINDS.SCALE && def.type === 'MOOD') {
    const level = (stored?.value as { num?: number } | null)?.num;
    response.label = level === undefined ? null : (MOOD_LABELS[level] ?? null);
  }

  return response;
}
