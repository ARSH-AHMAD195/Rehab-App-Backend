import { Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';

/**
 * Day and time zone, same rules as Health Monitoring: times travel as ISO 8601
 * with the patient's offset, the server stores UTC, and "today" is the date in
 * the patient's profile time zone.
 */
@Injectable()
export class DayService {
  /**
   * A stored UTC instant as ISO 8601 with the patient's offset, e.g.
   * 2026-10-20T10:00:00+05:30.
   */
  toLocalIso(value: Date | null | undefined, timeZone: string): string | null {
    if (!value) return null;
    return DateTime.fromJSDate(value).setZone(timeZone).toISO({ suppressMilliseconds: true });
  }
}
