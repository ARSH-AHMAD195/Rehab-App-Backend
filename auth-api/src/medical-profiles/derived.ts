import { DateTime } from 'luxon';

/**
 * Values the API works out from the medical profile rather than storing, so
 * they can never disagree with the fields they come from. Each is null when
 * a field it needs is missing. `today` is the patient's own calendar date
 * (YYYY-MM-DD), so a patient in another time zone gets their own answer.
 */

/** BMI = weight (kg) / height (m) squared, to 1 decimal place. */
export function bmiOf(weightKg: number | null | undefined, heightCm: number | null | undefined): number | null {
  if (!weightKg || !heightCm) return null;
  const metres = heightCm / 100;
  return Math.round((weightKg / (metres * metres)) * 10) / 10;
}

/**
 * Age in whole years on `today`: it goes up once the birth month and day are
 * reached, so someone born on 29 February turns a year older on 1 March in
 * years without a 29th.
 */
export function ageOn(dateOfBirth: string | null | undefined, today: string): number | null {
  if (!dateOfBirth) return null;
  const born = DateTime.fromISO(dateOfBirth);
  const now = DateTime.fromISO(today);
  if (!born.isValid || !now.isValid) return null;
  const birthdayReached = now.month > born.month || (now.month === born.month && now.day >= born.day);
  return now.year - born.year - (birthdayReached ? 0 : 1);
}

/**
 * Whole days from `today` to `date`: 0 on the day itself, negative once it
 * has passed (e.g. -3 means surgery was 3 days ago).
 */
export function daysUntil(date: string | null | undefined, today: string): number | null {
  if (!date) return null;
  const target = DateTime.fromISO(date);
  if (!target.isValid) return null;
  return Math.round(target.diff(DateTime.fromISO(today), 'days').days);
}
