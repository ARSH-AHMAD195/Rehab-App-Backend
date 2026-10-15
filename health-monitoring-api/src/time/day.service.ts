import { Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import { DETAIL_CODES, TREND_PERIODS, TrendPeriod } from '../common/constants';
import { ValidationFailedException } from '../common/api.exception';

export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Day and time zone, v1.1:
 *  - all times travel as ISO 8601 with an offset; the server stores UTC;
 *  - "today" is the current calendar date in the patient's profile time zone,
 *    worked out by the server when the request arrives;
 *  - each daily log stores the date and the timeZone used to work it out, so a
 *    later profile change only affects future days;
 *  - trend labels and the from/to filters use these local dates.
 */
@Injectable()
export class DayService {
  /** The patient's today, as YYYY-MM-DD. */
  today(timeZone: string): string {
    return this.nowIn(timeZone).toISODate()!;
  }

  nowIn(timeZone: string): DateTime {
    const now = DateTime.now().setZone(timeZone);
    if (!now.isValid) {
      // A bad zone on the profile must not silently become UTC: dates and
      // "today" would drift against what the patient sees.
      throw new Error(`Invalid IANA time zone on profile: "${timeZone}"`);
    }
    return now;
  }

  /** Server clock, stored as UTC. */
  now(): Date {
    return new Date();
  }

  isValidDate(value: string): boolean {
    return DATE_PATTERN.test(value) && DateTime.fromISO(value).isValid;
  }

  /** `date` shifted by whole local days. */
  shift(date: string, days: number): string {
    return DateTime.fromISO(date).plus({ days }).toISODate()!;
  }

  /**
   * Trends, v1.1: "The period is the last N local days, ending with today."
   * Returned oldest-first, which is the order the chart labels need.
   */
  periodDates(timeZone: string, period: TrendPeriod): string[] {
    const days = TREND_PERIODS[period];
    const today = this.nowIn(timeZone).startOf('day');
    return Array.from({ length: days }, (_, i) =>
      today.minus({ days: days - 1 - i }).toISODate()!,
    );
  }

  /** GET /me/vitals/logs defaults: from = 30 days ago, to = today. */
  defaultLogsRange(timeZone: string, windowDays: number): { from: string; to: string } {
    const to = this.today(timeZone);
    return { from: this.shift(to, -(windowDays - 1)), to };
  }

  /** v1.1: "from must not be after to". */
  assertRangeOrder(from: string, to: string): void {
    if (from > to) {
      throw new ValidationFailedException([
        { field: 'from', code: DETAIL_CODES.OUT_OF_RANGE, issue: 'must not be after to' },
      ]);
    }
  }

  /**
   * A stored UTC instant as ISO 8601 with the patient's offset, e.g.
   * 2026-10-09T07:05:00+05:30.
   */
  toLocalIso(value: Date | null | undefined, timeZone: string): string | null {
    if (!value) return null;
    return DateTime.fromJSDate(value).setZone(timeZone).toISO({ suppressMilliseconds: true });
  }
}
