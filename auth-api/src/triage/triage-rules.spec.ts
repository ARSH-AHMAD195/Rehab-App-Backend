import { DEFAULT_TRIAGE_RULES, TriageInputs, evaluateTriage } from './triage-rules';

const TODAY = '2026-11-13';
const rules = DEFAULT_TRIAGE_RULES;

/** A complete patient with nothing at any cut-off: Low, nothing missing. */
const healthy = (): TriageInputs => ({
  today: TODAY,
  dateOfBirth: '1980-01-01', // 46
  hb: { value: 13.5, date: '2026-11-01' },
  albumin: { value: 4.2, date: '2026-11-01' },
  must: { value: 0, date: '2026-11-01' },
  hba1c: null,
  egfr: null,
  bloodPressure: { value: { systolic: 124, diastolic: 78 }, date: '2026-11-12' },
  heartRate: { value: 72, date: '2026-11-12' },
  conditions: [],
  smokingStatus: 'NEVER',
  smokingQuitDate: null,
  hypertensionOnMedication: null,
  ihdStatus: null,
  lastMiOrStentDate: null,
  canClimbTwoFlights: true,
  chemotherapy: false,
  lastChemoDate: null,
});
const tagOf = (change: Partial<TriageInputs>) => evaluateTriage({ ...healthy(), ...change }, rules).tag;
const born = (age: number, daysAfterBirthday = 0) =>
  // A birthday `daysAfterBirthday` days before TODAY, `age` years ago.
  new Date(Date.UTC(2026 - age, 10, 13 - daysAfterBirthday)).toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.UTC(2026, 10, 13 - n)).toISOString().slice(0, 10);
const v = (value: number) => ({ value, date: '2026-11-01' });

describe('triage rules (client table, Nov 2026)', () => {
  it('a complete patient with nothing at a cut-off is LOW with nothing missing', () => {
    expect(evaluateTriage(healthy(), rules)).toEqual({ tag: 'LOW', reasons: [], missing: [] });
  });

  describe('combining', () => {
    it('one High -> HIGH', () => expect(tagOf({ hb: v(7.9) })).toBe('HIGH'));
    it('one Medium -> MEDIUM', () => expect(tagOf({ hb: v(9) })).toBe('MEDIUM'));
    it('two Mediums -> HIGH', () => expect(tagOf({ hb: v(9), albumin: v(3.2) })).toBe('HIGH'));
    it('lists High reasons before Medium ones', () => {
      const result = evaluateTriage({ ...healthy(), hb: v(9), canClimbTwoFlights: false }, rules);
      expect(result.reasons.map((r) => [r.parameter, r.level])).toEqual([
        ['FUNCTIONAL_CAPACITY', 'HIGH'],
        ['HAEMOGLOBIN', 'MEDIUM'],
      ]);
    });
  });

  describe('boundaries, each side', () => {
    it.each([
      ['age 59', { dateOfBirth: born(59) }, 'LOW'],
      ['age 60', { dateOfBirth: born(60) }, 'MEDIUM'],
      ['age 70', { dateOfBirth: born(70) }, 'MEDIUM'],
      ['age 71', { dateOfBirth: born(71) }, 'HIGH'],
      ['age 70 the day before turning 71', { dateOfBirth: born(71, -1) }, 'MEDIUM'],
      ['Hb 7.9', { hb: v(7.9) }, 'HIGH'],
      ['Hb 8', { hb: v(8) }, 'MEDIUM'],
      ['Hb 10.9', { hb: v(10.9) }, 'MEDIUM'],
      ['Hb 11', { hb: v(11) }, 'LOW'],
      ['albumin 2.9', { albumin: v(2.9) }, 'HIGH'],
      ['albumin 3.0', { albumin: v(3.0) }, 'MEDIUM'],
      ['albumin 3.4', { albumin: v(3.4) }, 'MEDIUM'],
      ['albumin 3.5', { albumin: v(3.5) }, 'LOW'],
      ['MUST 0', { must: v(0) }, 'LOW'],
      ['MUST 1', { must: v(1) }, 'MEDIUM'],
      ['MUST 2', { must: v(2) }, 'HIGH'],
      ['HbA1c 6.9', { hba1c: v(6.9) }, 'LOW'],
      ['HbA1c 7', { hba1c: v(7) }, 'MEDIUM'],
      ['HbA1c 8.5', { hba1c: v(8.5) }, 'MEDIUM'],
      ['HbA1c 8.6', { hba1c: v(8.6) }, 'HIGH'],
      ['eGFR 29', { egfr: v(29) }, 'HIGH'],
      ['eGFR 30', { egfr: v(30) }, 'MEDIUM'],
      ['eGFR 59', { egfr: v(59) }, 'MEDIUM'],
      ['eGFR 60', { egfr: v(60) }, 'LOW'],
      ['pulse 89', { heartRate: v(89) }, 'LOW'],
      ['pulse 90', { heartRate: v(90) }, 'MEDIUM'],
      ['pulse 100', { heartRate: v(100) }, 'MEDIUM'],
      ['pulse 101', { heartRate: v(101) }, 'HIGH'],
      ['BP 179/109', { bloodPressure: { value: { systolic: 179, diastolic: 109 }, date: TODAY } }, 'LOW'],
      ['BP 180/80', { bloodPressure: { value: { systolic: 180, diastolic: 80 }, date: TODAY } }, 'HIGH'],
      ['BP 150/110', { bloodPressure: { value: { systolic: 150, diastolic: 110 }, date: TODAY } }, 'HIGH'],
      ['current smoker', { smokingStatus: 'CURRENT' }, 'HIGH'],
      ['quit 55 days ago', { smokingStatus: 'FORMER', smokingQuitDate: daysAgo(55) }, 'MEDIUM'],
      ['quit 56 days ago', { smokingStatus: 'FORMER', smokingQuitDate: daysAgo(56) }, 'LOW'],
      ['hypertension on medication', { conditions: ['HTN'], hypertensionOnMedication: true }, 'MEDIUM'],
      ['hypertension, not on medication', { conditions: ['HTN'], hypertensionOnMedication: false }, 'LOW'],
      ['stable IHD', { conditions: ['IHD'], ihdStatus: 'STABLE' }, 'MEDIUM'],
      ['symptomatic IHD', { conditions: ['IHD'], ihdStatus: 'SYMPTOMATIC' }, 'HIGH'],
      ['stent 183 days ago', { ihdStatus: 'STABLE', lastMiOrStentDate: daysAgo(183) }, 'HIGH'],
      ['stent 184 days ago (stable)', { ihdStatus: 'STABLE', lastMiOrStentDate: daysAgo(184) }, 'MEDIUM'],
      ['cannot climb 2 flights', { canClimbTwoFlights: false }, 'HIGH'],
      ['chemo 28 days ago', { chemotherapy: true, lastChemoDate: daysAgo(28) }, 'MEDIUM'],
      ['chemo 29 days ago', { chemotherapy: true, lastChemoDate: daysAgo(29) }, 'LOW'],
    ] as [string, Partial<TriageInputs>, string][])('%s -> %s', (_label, change, tag) => {
      expect(tagOf(change)).toBe(tag);
    });

    it('a high BP outranks "controlled on medication"', () => {
      const result = evaluateTriage(
        { ...healthy(), conditions: ['HTN'], hypertensionOnMedication: true, bloodPressure: { value: { systolic: 185, diastolic: 95 }, date: TODAY } },
        rules,
      );
      expect(result.reasons).toEqual([expect.objectContaining({ parameter: 'HYPERTENSION', level: 'HIGH' })]);
    });
  });

  describe('missing data', () => {
    it('never raises the tag, and says what is missing', () => {
      const empty: TriageInputs = {
        ...healthy(),
        dateOfBirth: null,
        hb: null,
        albumin: null,
        must: null,
        bloodPressure: null,
        heartRate: null,
        smokingStatus: null,
        canClimbTwoFlights: null,
      };
      const result = evaluateTriage(empty, rules);
      expect(result.tag).toBe('LOW');
      expect(result.missing.map((m) => m.parameter)).toEqual([
        'AGE', 'HAEMOGLOBIN', 'ALBUMIN', 'NUTRITION_MUST', 'SMOKING', 'HYPERTENSION', 'RESTING_HEART_RATE', 'FUNCTIONAL_CAPACITY',
      ]);
    });

    it('asks for condition-specific values only when the condition is ticked', () => {
      const without = evaluateTriage(healthy(), rules);
      expect(without.missing).toEqual([]);
      const withConditions = evaluateTriage({ ...healthy(), conditions: ['DM', 'CKD', 'IHD', 'HTN'], chemotherapy: true }, rules);
      expect(withConditions.missing.map((m) => m.parameter)).toEqual(['HYPERTENSION', 'DIABETES', 'CKD', 'IHD', 'RECENT_CHEMOTHERAPY']);
    });

    it('a former smoker without a quit date is missing, not Medium', () => {
      const result = evaluateTriage({ ...healthy(), smokingStatus: 'FORMER' }, rules);
      expect(result.tag).toBe('LOW');
      expect(result.missing).toEqual([{ parameter: 'SMOKING', needs: 'the date they quit smoking' }]);
    });
  });

  it('uses the rules it is given, not fixed numbers', () => {
    const stricter = { ...rules, hb: { highBelow: 9, mediumBelow: 12 } };
    expect(evaluateTriage({ ...healthy(), hb: v(8.5) }, stricter).tag).toBe('HIGH');
    expect(evaluateTriage({ ...healthy(), hb: v(8.5) }, rules).tag).toBe('MEDIUM');
  });

  it('explains each reason with the value and its date', () => {
    const result = evaluateTriage({ ...healthy(), hb: { value: 7.6, date: '2026-11-08' } }, rules);
    expect(result.reasons[0]).toEqual({
      parameter: 'HAEMOGLOBIN',
      level: 'HIGH',
      explanation: 'Hb 7.6 g/dL on 2026-11-08 (High: below 8)',
      date: '2026-11-08',
    });
  });
});
