import { ValidationFailedException } from '../common/api.exception';
import { DayService, isCalendarDate } from './day.service';

describe('DayService', () => {
  const day = new DayService();

  it('numbers days Monday = 1 to Sunday = 7, like plans do', () => {
    expect(day.dayOfWeek('2026-10-19')).toBe(1); // a Monday
    expect(day.dayOfWeek('2026-10-25')).toBe(7); // a Sunday
  });

  it("finds when a patient's local day starts, in UTC", () => {
    expect(day.startOfDay('2026-10-20', 'Asia/Kolkata').toISOString()).toBe('2026-10-19T18:30:00.000Z');
    expect(day.startOfDay('2026-10-20', 'America/New_York').toISOString()).toBe('2026-10-20T04:00:00.000Z');
  });

  it('defaults a range to the last N days and refuses from after to', () => {
    expect(day.range('UTC', 30, undefined, '2026-10-30')).toEqual({ from: '2026-10-01', to: '2026-10-30' });
    expect(() => day.range('UTC', 30, '2026-10-10', '2026-10-01')).toThrow(ValidationFailedException);
  });

  it('accepts only real calendar dates', () => {
    expect(isCalendarDate('2026-10-20')).toBe(true);
    expect(isCalendarDate('2026-02-30')).toBe(false);
    expect(isCalendarDate('20-10-2026')).toBe(false);
  });
});
