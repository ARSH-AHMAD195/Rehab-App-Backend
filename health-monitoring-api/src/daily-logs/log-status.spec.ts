import { DAY_STATUS, READING_STATUS, VALUE_KINDS } from '../common/constants';
import { VITAL_TYPE_DEFAULTS } from '../vital-types/vital-type.defaults';
import { VitalTypeDef } from '../vital-types/vital-type.schema';
import { computeStatus } from './log-status';
import { StoredReading } from './daily-log.schema';

/** The 13 seeded parameters, shaped like documents (BP keeps a Map of fields). */
function defs(overrides: Partial<Record<string, Partial<VitalTypeDef>>> = {}): VitalTypeDef[] {
  return VITAL_TYPE_DEFAULTS.map((seed) => {
    const def = {
      ...seed,
      fields: seed.fields ? new Map(Object.entries(seed.fields)) : undefined,
      version: 1,
    } as unknown as VitalTypeDef;
    return { ...def, ...(overrides[seed.type] ?? {}) } as VitalTypeDef;
  });
}

const logged = (): StoredReading => ({
  value: { num: 1 },
  unit: 'x',
  typeVersion: 1,
  status: READING_STATUS.LOGGED,
  loggedAt: new Date(),
});

const cleared = (): StoredReading => ({
  value: null,
  unit: 'x',
  typeVersion: 1,
  status: READING_STATUS.NOT_YET,
  loggedAt: null,
});

describe('computeStatus', () => {
  it('counts 14 form fields for the 13 parameters, BP twice', () => {
    expect(computeStatus({}, defs()).totalCount).toBe(14);
  });

  it('is NOT_STARTED with nothing logged', () => {
    const status = computeStatus({}, defs());
    expect(status).toEqual({ filledCount: 0, totalCount: 14, dayStatus: DAY_STATUS.NOT_STARTED });
  });

  it('counts BP as two filled fields', () => {
    const status = computeStatus({ BP: logged() }, defs());
    expect(status.filledCount).toBe(2);
    expect(status.dayStatus).toBe(DAY_STATUS.IN_PROGRESS);
  });

  it('reaches 9 of 14 for the example in the reference', () => {
    // BP (2) + PULSE, SPO2, TEMP, WEIGHT, PAIN, STEPS, MOOD = 9 fields.
    const readings = Object.fromEntries(
      ['BP', 'PULSE', 'SPO2', 'TEMP', 'WEIGHT', 'PAIN', 'STEPS', 'MOOD'].map((type) => [
        type,
        logged(),
      ]),
    );
    expect(computeStatus(readings, defs())).toMatchObject({
      filledCount: 9,
      totalCount: 14,
      dayStatus: DAY_STATUS.IN_PROGRESS,
    });
  });

  it('is COMPLETE only when every field on the form is filled', () => {
    const all = Object.fromEntries(VITAL_TYPE_DEFAULTS.map((seed) => [seed.type, logged()]));
    expect(computeStatus(all, defs()).dayStatus).toBe(DAY_STATUS.COMPLETE);

    const withoutSugar = { ...all };
    delete withoutSugar.SUGAR;
    // v1.1 Open question: optional blood sugar may later count as complete.
    expect(computeStatus(withoutSugar, defs())).toMatchObject({
      filledCount: 13,
      dayStatus: DAY_STATUS.IN_PROGRESS,
    });
  });

  it('does not count a cleared value', () => {
    const status = computeStatus({ PULSE: logged(), PAIN: cleared() }, defs());
    expect(status.filledCount).toBe(1);
  });

  it('drops parameters taken off the form from both counts', () => {
    const status = computeStatus(
      { NUTRITION: logged(), PULSE: logged() },
      defs({ NUTRITION: { onForm: false, valueKind: VALUE_KINDS.TEXT } }),
    );
    expect(status).toMatchObject({ filledCount: 1, totalCount: 13 });
  });
});
