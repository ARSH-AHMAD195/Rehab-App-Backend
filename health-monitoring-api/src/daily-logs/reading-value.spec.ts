import { VALUE_KINDS } from '../common/constants';
import { VitalTypeDef } from '../vital-types/vital-type.schema';
import { numericFields, sameValue } from './reading-value';

const bp = {
  type: 'BP',
  valueKind: VALUE_KINDS.PAIR,
  fields: new Map([
    ['systolic', { minValid: 60, maxValid: 260 }],
    ['diastolic', { minValid: 30, maxValid: 160 }],
  ]),
} as unknown as VitalTypeDef;

const pulse = { type: 'PULSE', valueKind: VALUE_KINDS.NUMERIC } as unknown as VitalTypeDef;
const mood = { type: 'MOOD', valueKind: VALUE_KINDS.SCALE } as unknown as VitalTypeDef;
const nutrition = { type: 'NUTRITION', valueKind: VALUE_KINDS.TEXT } as unknown as VitalTypeDef;

describe('numericFields', () => {
  it('splits BP into two separately checked fields', () => {
    expect(numericFields(bp, { systolic: 128, diastolic: 82 })).toEqual([
      { field: 'systolic', value: 128 },
      { field: 'diastolic', value: 82 },
    ]);
  });

  it('yields one unnamed field for numeric and scale parameters', () => {
    expect(numericFields(pulse, { num: 76 })).toEqual([{ field: null, value: 76 }]);
    expect(numericFields(mood, { num: 4 })).toEqual([{ field: null, value: 4 }]);
  });

  it('yields nothing for free text, so it never alerts', () => {
    expect(numericFields(nutrition, { text: 'rice and dal' })).toEqual([]);
  });
});

describe('sameValue', () => {
  it('treats an identical re-send as unchanged, whatever the key order', () => {
    expect(sameValue({ num: 76 }, { num: 76 })).toBe(true);
    expect(
      sameValue({ systolic: 128, diastolic: 82 }, { diastolic: 82, systolic: 128 } as never),
    ).toBe(true);
  });

  it('sees a different value as changed', () => {
    expect(sameValue({ num: 76 }, { num: 77 })).toBe(false);
    expect(sameValue({ systolic: 128, diastolic: 82 }, { systolic: 128, diastolic: 83 })).toBe(false);
  });

  it('handles clearing and first saves', () => {
    expect(sameValue(null, null)).toBe(true);
    expect(sameValue(null, { num: 76 })).toBe(false);
    expect(sameValue({ num: 76 }, null)).toBe(false);
  });

  it('does not confuse different shapes', () => {
    expect(sameValue({ num: 1 }, { text: '1' } as never)).toBe(false);
  });
});
