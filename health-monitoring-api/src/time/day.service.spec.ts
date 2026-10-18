import { DayService } from './day.service';

describe('DayService', () => {
  const day = new DayService();

  it('returns the last N local days ending with today, oldest first', () => {
    const dates = day.periodDates('Asia/Kolkata', '7d');
    expect(dates).toHaveLength(7);
    expect(dates[6]).toBe(day.today('Asia/Kolkata'));
    expect(dates[0]).toBe(day.shift(dates[6], -6));
    expect([...dates].sort()).toEqual(dates);
  });

  it('computes "today" in the patient zone, not the server zone', () => {
    // 19:00 UTC is already the next day in Asia/Kolkata (+05:30).
    jest.useFakeTimers().setSystemTime(new Date('2026-10-09T19:00:00Z'));
    try {
      expect(day.today('Asia/Kolkata')).toBe('2026-10-10');
      expect(day.today('UTC')).toBe('2026-10-09');
      expect(day.today('America/New_York')).toBe('2026-10-09');
    } finally {
      jest.useRealTimers();
    }
  });

  it('defaults the logs window to 30 days ending today', () => {
    const { from, to } = day.defaultLogsRange('UTC', 30);
    expect(to).toBe(day.today('UTC'));
    expect(from).toBe(day.shift(to, -29));
  });

  it('rejects from after to', () => {
    expect(() => day.assertRangeOrder('2026-10-10', '2026-10-09')).toThrow();
    expect(() => day.assertRangeOrder('2026-10-09', '2026-10-09')).not.toThrow();
  });

  it('renders stored instants with the patient offset', () => {
    const iso = day.toLocalIso(new Date('2026-10-09T01:35:00Z'), 'Asia/Kolkata');
    expect(iso).toBe('2026-10-09T07:05:00+05:30');
    expect(day.toLocalIso(null, 'Asia/Kolkata')).toBeNull();
  });

  it('refuses an invalid profile zone rather than defaulting to UTC', () => {
    expect(() => day.today('Mars/Olympus')).toThrow(/Invalid IANA time zone/);
  });

  it('validates date strings', () => {
    expect(day.isValidDate('2026-10-09')).toBe(true);
    expect(day.isValidDate('2026-13-09')).toBe(false);
    expect(day.isValidDate('09-10-2026')).toBe(false);
  });
});
