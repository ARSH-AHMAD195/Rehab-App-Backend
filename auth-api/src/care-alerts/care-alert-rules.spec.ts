import { DEFAULT_TRIAGE_RULES } from '../triage/triage-rules';
import { AlertInputs, AlertSettings, detectAlerts } from './care-alert-rules';

const TODAY = '2026-11-14';
const settings: AlertSettings = { weightLossPercent: 5, noLoggingDays: 3, recentDays: 14 };
const quiet = (): AlertInputs => ({
  today: TODAY,
  results: [],
  vitals: [{ date: TODAY, pulse: 72, bp: { systolic: 120, diastolic: 80 }, weight: 70 }],
  onboardingWeightKg: 70,
  lastActivityDate: TODAY,
  registeredOn: '2026-10-01',
});
const detect = (change: Partial<AlertInputs>) => detectAlerts({ ...quiet(), ...change }, DEFAULT_TRIAGE_RULES, settings);
const keys = (change: Partial<AlertInputs>) => detect(change).map((a) => a.key);
const result = (id: string, test: string, values: Record<string, number>, takenOn = '2026-11-12') => ({ id, test, takenOn, values });
const day = (date: string, v: Partial<{ pulse: number; bp: { systolic: number; diastolic: number }; weight: number }>) => ({
  date,
  pulse: v.pulse ?? null,
  bp: v.bp ?? null,
  weight: v.weight ?? null,
});

describe('care-team alert rules', () => {
  it('nothing for a patient with nothing to report', () => {
    expect(detect({})).toEqual([]);
  });

  describe('new High values', () => {
    it.each([
      ['Hb 7.9', result('r1', 'HB', { value: 7.9 }), true],
      ['Hb 8', result('r1', 'HB', { value: 8 }), false],
      ['albumin 2.9', result('r1', 'ALBUMIN', { value: 2.9 }), true],
      ['albumin 3.0', result('r1', 'ALBUMIN', { value: 3.0 }), false],
      ['HbA1c 8.6', result('r1', 'HBA1C', { value: 8.6 }), true],
      ['HbA1c 8.5', result('r1', 'HBA1C', { value: 8.5 }), false],
      ['eGFR 29', result('r1', 'CREATININE', { value: 2.4, egfr: 29 }), true],
      ['creatinine without eGFR', result('r1', 'CREATININE', { value: 2.4 }), false],
      ['MUST 2', result('r1', 'MUST', { score: 2 }), true],
      ['MUST 1', result('r1', 'MUST', { score: 1 }), false],
    ])('%s -> alert: %s', (_label, r, alerts) => {
      expect(keys({ results: [r] })).toEqual(alerts ? ['HIGH_VALUE:result:r1'] : []);
    });

    it('only results from the last 14 days count as new', () => {
      expect(keys({ results: [result('r1', 'HB', { value: 7 }, '2026-10-31')] })).toEqual(['HIGH_VALUE:result:r1']);
      expect(keys({ results: [result('r1', 'HB', { value: 7 }, '2026-10-30')] })).toEqual([]);
    });

    it('pulse over 100 and BP at 180/110, one alert per day', () => {
      const vitals = [
        day(TODAY, { pulse: 101, bp: { systolic: 182, diastolic: 90 } }),
        day('2026-11-13', { pulse: 100, bp: { systolic: 150, diastolic: 110 } }),
      ];
      expect(keys({ vitals })).toEqual(['HIGH_VALUE:PULSE:2026-11-14', 'HIGH_VALUE:BP:2026-11-14', 'HIGH_VALUE:BP:2026-11-13']);
    });

    it('says what and why', () => {
      expect(detect({ results: [result('r1', 'HB', { value: 7.6 }, '2026-11-08')] })[0]).toMatchObject({
        kind: 'HIGH_VALUE',
        message: 'Hb 7.6 g/dL on 2026-11-08 (High: below 8)',
        details: { source: 'INVESTIGATION', test: 'HB', value: 7.6, date: '2026-11-08', resultId: 'r1' },
      });
    });
  });

  describe('weight loss', () => {
    it('more than 5% below the onboarding weight', () => {
      expect(keys({ vitals: [day(TODAY, { weight: 66.4 })] })).toEqual(['WEIGHT_LOSS:2026-11-14']); // 5.1%
      expect(keys({ vitals: [day(TODAY, { weight: 66.5 })] })).toEqual([]); // exactly 5%
    });

    it('uses the newest weight', () => {
      const vitals = [day(TODAY, { weight: 69 }), day('2026-11-12', { weight: 60 })];
      expect(keys({ vitals })).toEqual([]);
    });

    it('nothing without an onboarding weight', () => {
      expect(keys({ onboardingWeightKg: null, vitals: [day(TODAY, { weight: 50 })] })).toEqual([]);
    });

    it('explains the drop', () => {
      expect(detect({ vitals: [day(TODAY, { weight: 63 })] })[0].message).toBe(
        'Weight 63 kg on 2026-11-14: 10% below the onboarding weight of 70 kg (alert: more than 5%)',
      );
    });
  });

  describe('MUST rise', () => {
    it('the newest score above the previous one', () => {
      const results = [result('m1', 'MUST', { score: 0 }, '2026-11-01'), result('m2', 'MUST', { score: 1 }, '2026-11-10')];
      expect(keys({ results })).toEqual(['MUST_RISE:m2']);
    });

    it('no alert for a fall or the same score', () => {
      expect(keys({ results: [result('m1', 'MUST', { score: 1 }, '2026-11-01'), result('m2', 'MUST', { score: 1 }, '2026-11-10')] })).toEqual([]);
      expect(keys({ results: [result('m1', 'MUST', { score: 1 }, '2026-11-01'), result('m2', 'MUST', { score: 0 }, '2026-11-10')] })).toEqual([]);
    });

    it('a rise to 2 is both a High value and a rise', () => {
      const results = [result('m1', 'MUST', { score: 1 }, '2026-11-01'), result('m2', 'MUST', { score: 2 }, '2026-11-10')];
      expect(keys({ results }).sort()).toEqual(['HIGH_VALUE:result:m2', 'MUST_RISE:m2']);
    });
  });

  describe('no logging', () => {
    it('3 days or more since the last log', () => {
      expect(keys({ lastActivityDate: '2026-11-12' })).toEqual([]); // 2 days
      expect(keys({ lastActivityDate: '2026-11-11' })).toEqual(['NO_LOGGING:2026-11-11']); // 3 days
    });

    it('counts from registration for a patient who never logged', () => {
      expect(keys({ lastActivityDate: null, registeredOn: '2026-11-13' })).toEqual([]);
      expect(detect({ lastActivityDate: null, registeredOn: '2026-11-10' })[0]).toMatchObject({
        key: 'NO_LOGGING:2026-11-10',
        message: 'Nothing logged in the 4 days since registering',
      });
    });
  });

  it('uses the rules it is given', () => {
    const stricter = { ...DEFAULT_TRIAGE_RULES, hb: { highBelow: 9, mediumBelow: 11 } };
    expect(detectAlerts({ ...quiet(), results: [result('r1', 'HB', { value: 8.5 })] }, stricter, settings)).toHaveLength(1);
  });
});
