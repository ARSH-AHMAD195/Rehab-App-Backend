import { ageOn, bmiOf, daysUntil } from './derived';

describe('derived medical values', () => {
  describe('bmiOf', () => {
    it('is weight / height in metres squared, to 1 decimal', () => {
      expect(bmiOf(70, 175)).toBe(22.9);
      expect(bmiOf(68.5, 172)).toBe(23.2);
    });
    it('is null when weight or height is missing', () => {
      expect(bmiOf(null, 175)).toBeNull();
      expect(bmiOf(70, null)).toBeNull();
      expect(bmiOf(undefined, undefined)).toBeNull();
    });
  });

  describe('ageOn', () => {
    it('counts whole years, turning over on the birthday', () => {
      expect(ageOn('1956-11-10', '2026-11-09')).toBe(69);
      expect(ageOn('1956-11-10', '2026-11-10')).toBe(70);
      expect(ageOn('1956-11-10', '2026-11-11')).toBe(70);
    });
    it('handles a 29 February birthday', () => {
      expect(ageOn('1960-02-29', '2026-02-28')).toBe(65);
      expect(ageOn('1960-02-29', '2026-03-01')).toBe(66);
    });
    it('is null without a birth date', () => {
      expect(ageOn(null, '2026-11-10')).toBeNull();
    });
  });

  describe('daysUntil', () => {
    it('counts days ahead, 0 on the day, negative after', () => {
      expect(daysUntil('2026-11-20', '2026-11-10')).toBe(10);
      expect(daysUntil('2026-11-10', '2026-11-10')).toBe(0);
      expect(daysUntil('2026-11-07', '2026-11-10')).toBe(-3);
    });
    it('is not thrown off by a month or year boundary', () => {
      expect(daysUntil('2027-01-02', '2026-12-30')).toBe(3);
    });
    it('is null without a date', () => {
      expect(daysUntil(null, '2026-11-10')).toBeNull();
    });
  });
});
