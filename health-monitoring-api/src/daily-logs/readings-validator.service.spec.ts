import { DETAIL_CODES } from '../common/constants';
import { ApiException } from '../common/api.exception';
import { VITAL_TYPE_DEFAULTS } from '../vital-types/vital-type.defaults';
import { VitalTypeDef } from '../vital-types/vital-type.schema';
import { VitalTypesService } from '../vital-types/vital-types.service';
import { ReadingsValidatorService } from './readings-validator.service';

function defs(): Map<string, VitalTypeDef> {
  return new Map(
    VITAL_TYPE_DEFAULTS.map((seed) => [
      seed.type,
      {
        ...seed,
        fields: seed.fields ? new Map(Object.entries(seed.fields)) : undefined,
        version: 1,
      } as unknown as VitalTypeDef,
    ]),
  );
}

/** Reads the v1.1 `details[]` out of a thrown ValidationFailedException. */
async function detailsOf(
  validator: ReadingsValidatorService,
  readings: unknown,
): Promise<{ field: string; code: string }[]> {
  try {
    await validator.validate(readings);
    throw new Error('expected validation to fail');
  } catch (error) {
    if (!(error instanceof ApiException)) throw error;
    return (error.details ?? []).map(({ field, code }) => ({ field, code }));
  }
}

describe('ReadingsValidatorService', () => {
  let validator: ReadingsValidatorService;

  beforeEach(() => {
    const vitalTypes = { byType: async () => defs() } as unknown as VitalTypesService;
    validator = new ReadingsValidatorService(vitalTypes);
  });

  it('accepts a partial save of the fields that changed', async () => {
    const validated = await validator.validate({
      WEIGHT: { num: 56 },
      STEPS: { num: 5000 },
      PAIN: { num: 7 },
      MOOD: { num: 4 },
    });
    expect(validated.map((entry) => entry.def.type)).toEqual(['WEIGHT', 'STEPS', 'PAIN', 'MOOD']);
  });

  it('rejects an empty body with EMPTY_READINGS', async () => {
    await expect(detailsOf(validator, {})).resolves.toEqual([
      { field: 'readings', code: DETAIL_CODES.EMPTY_READINGS },
    ]);
  });

  it('rejects an unknown type code', async () => {
    await expect(detailsOf(validator, { HEIGHT: { num: 170 } })).resolves.toEqual([
      { field: 'readings.HEIGHT', code: DETAIL_CODES.UNKNOWN_TYPE },
    ]);
  });

  it('rejects the wrong value shape', async () => {
    await expect(detailsOf(validator, { PULSE: 76 })).resolves.toEqual([
      { field: 'readings.PULSE', code: DETAIL_CODES.WRONG_SHAPE },
    ]);
    await expect(detailsOf(validator, { PULSE: { value: 76 } })).resolves.toEqual([
      { field: 'readings.PULSE', code: DETAIL_CODES.WRONG_SHAPE },
    ]);
  });

  it('rejects values outside the valid range', async () => {
    await expect(detailsOf(validator, { SPO2: { num: 20 } })).resolves.toEqual([
      { field: 'readings.SPO2.num', code: DETAIL_CODES.OUT_OF_RANGE },
    ]);
    await expect(detailsOf(validator, { TEMP: { num: 50 } })).resolves.toEqual([
      { field: 'readings.TEMP.num', code: DETAIL_CODES.OUT_OF_RANGE },
    ]);
  });

  it('checks each BP field against its own range', async () => {
    await expect(detailsOf(validator, { BP: { systolic: 300, diastolic: 20 } })).resolves.toEqual([
      { field: 'readings.BP.systolic', code: DETAIL_CODES.OUT_OF_RANGE },
      { field: 'readings.BP.diastolic', code: DETAIL_CODES.OUT_OF_RANGE },
    ]);
  });

  it('requires both BP fields together', async () => {
    await expect(detailsOf(validator, { BP: { systolic: 128 } })).resolves.toEqual([
      { field: 'readings.BP', code: DETAIL_CODES.WRONG_SHAPE },
    ]);
  });

  it('requires systolic above diastolic', async () => {
    await expect(detailsOf(validator, { BP: { systolic: 80, diastolic: 90 } })).resolves.toEqual([
      { field: 'readings.BP.systolic', code: DETAIL_CODES.BP_SYSTOLIC_NOT_ABOVE_DIASTOLIC },
    ]);
  });

  it('accepts a BP pair inside both ranges', async () => {
    const [reading] = await validator.validate({ BP: { systolic: 128, diastolic: 82 } });
    expect(reading.value).toEqual({ systolic: 128, diastolic: 82 });
  });

  it('enforces whole numbers where the parameters table says so', async () => {
    await expect(detailsOf(validator, { STEPS: { num: 5000.5 } })).resolves.toEqual([
      { field: 'readings.STEPS.num', code: DETAIL_CODES.WRONG_SHAPE },
    ]);
    await expect(detailsOf(validator, { PAIN: { num: 7.5 } })).resolves.toEqual([
      { field: 'readings.PAIN.num', code: DETAIL_CODES.WRONG_SHAPE },
    ]);
  });

  it('allows sleep in half hours but not other fractions', async () => {
    await expect(validator.validate({ SLEEP_HRS: { num: 7.5 } })).resolves.toHaveLength(1);
    await expect(detailsOf(validator, { SLEEP_HRS: { num: 7.3 } })).resolves.toEqual([
      { field: 'readings.SLEEP_HRS.num', code: DETAIL_CODES.WRONG_SHAPE },
    ]);
  });

  it('limits nutrition text to its character count', async () => {
    await expect(detailsOf(validator, { NUTRITION: { text: 'x'.repeat(501) } })).resolves.toEqual([
      { field: 'readings.NUTRITION.text', code: DETAIL_CODES.TOO_LONG },
    ]);
    await expect(detailsOf(validator, { NUTRITION: { text: '   ' } })).resolves.toEqual([
      { field: 'readings.NUTRITION.text', code: DETAIL_CODES.REQUIRED },
    ]);
  });

  it('treats null as clearing a value', async () => {
    const [reading] = await validator.validate({ PAIN: null });
    expect(reading.value).toBeNull();
  });

  it('reports every bad field at once', async () => {
    const details = await detailsOf(validator, {
      SPO2: { num: 10 },
      HEIGHT: { num: 1 },
      PULSE: { num: 'fast' },
    });
    expect(details).toEqual([
      { field: 'readings.SPO2.num', code: DETAIL_CODES.OUT_OF_RANGE },
      { field: 'readings.HEIGHT', code: DETAIL_CODES.UNKNOWN_TYPE },
      { field: 'readings.PULSE.num', code: DETAIL_CODES.WRONG_SHAPE },
    ]);
  });

  it('refuses more than 13 readings in one request', async () => {
    const tooMany = Object.fromEntries(
      Array.from({ length: 14 }, (_, i) => [`T${i}`, { num: 1 }]),
    );
    await expect(detailsOf(validator, tooMany)).resolves.toEqual([
      { field: 'readings', code: DETAIL_CODES.WRONG_SHAPE },
    ]);
  });
});
