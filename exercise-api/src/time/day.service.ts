import { Injectable } from '@nestjs/common';
import { ValidateBy } from 'class-validator';
import { DateTime } from 'luxon';
import { DETAIL_CODES } from '../common/constants';
import { ValidationFailedException } from '../common/api.exception';

export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** YYYY-MM-DD and a real calendar day: 2026-02-30 matches the pattern but is not one. */
export function isCalendarDate(value: unknown): value is string {
  return typeof value === 'string' && DATE_PATTERN.test(value) && DateTime.fromISO(value).isValid;
}

/** DTO rule for a YYYY-MM-DD date that must exist on the calendar. */
export const IsCalendarDate = () =>
  ValidateBy({
    name: 'isCalendarDate',
    validator: { validate: isCalendarDate, defaultMessage: () => 'must be a date as YYYY-MM-DD' },
  });

/**
 * Day and time zone, same rules as Health Monitoring: times travel as ISO 8601
 * with the patient's offset, the server stores UTC, and "today" is the date in
 * the patient's profile time zone, worked out when the request arrives.
 */
@Injectable()
export class DayService {
  /** The patient's today, as YYYY-MM-DD. */
  today(timeZone: string): string {
    return DateTime.now().setZone(timeZone).toISODate()!;
  }

  /** 1 = Monday ... 7 = Sunday, the numbering plans use. */
  dayOfWeek(date: string): number {
    return DateTime.fromISO(date).weekday;
  }

  /** The UTC instant a local day starts, e.g. 2026-10-20 in Kolkata starts 2026-10-19T18:30Z. */
  startOfDay(date: string, timeZone: string): Date {
    return DateTime.fromISO(date, { zone: timeZone }).startOf('day').toJSDate();
  }

  /** `date` shifted by whole days. */
  shift(date: string, days: number): string {
    return DateTime.fromISO(date).plus({ days }).toISODate()!;
  }

  /** from = 30 days ago, to = today, unless given. */
  range(timeZone: string, windowDays: number, from?: string, to?: string): { from: string; to: string } {
    const end = to ?? this.today(timeZone);
    const start = from ?? this.shift(end, -(windowDays - 1));
    if (start > end) {
      throw new ValidationFailedException([
        { field: 'from', code: DETAIL_CODES.OUT_OF_RANGE, issue: 'must not be after to' },
      ]);
    }
    return { from: start, to: end };
  }

  /**
   * A stored UTC instant as ISO 8601 with the patient's offset, e.g.
   * 2026-10-20T10:00:00+05:30.
   */
  toLocalIso(value: Date | null | undefined, timeZone: string): string | null {
    if (!value) return null;
    return DateTime.fromJSDate(value).setZone(timeZone).toISO({ suppressMilliseconds: true });
  }
}
