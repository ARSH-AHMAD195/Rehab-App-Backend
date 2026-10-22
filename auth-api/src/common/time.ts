import { DateTime, IANAZone } from 'luxon';

/** Doctors and admins have no profile time zone; their times use this one. */
export const DEFAULT_DISPLAY_TIME_ZONE = 'Asia/Kolkata';

export function isValidTimeZone(zone: string): boolean {
  return IANAZone.isValidZone(zone);
}

/** v1.0 Conventions: ISO 8601 with offset, e.g. 2026-10-15T10:30:00+05:30. */
export function toLocalIso(date: Date | null | undefined, zone?: string | null): string | null {
  if (!date) return null;
  return DateTime.fromJSDate(date)
    .setZone(zone || DEFAULT_DISPLAY_TIME_ZONE)
    .toISO({ suppressMilliseconds: true });
}

/** Today's calendar date (YYYY-MM-DD) in a zone. */
export function todayIn(zone: string): string {
  return DateTime.now().setZone(zone).toISODate()!;
}
