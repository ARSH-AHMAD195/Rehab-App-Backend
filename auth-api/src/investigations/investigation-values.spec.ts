import { testDef } from './investigation-tests';
import { checkValues, flagsOf, Range, rangeKey } from './investigation-values';

const def = (code: string) => testDef(code)!;
const codes = (r: ReturnType<typeof checkValues>) => r.details.map((d) => `${d.field}:${d.code}`);

describe('investigation values', () => {
  describe('checkValues', () => {
    it('accepts a single number within the entry limits', () => {
      expect(checkValues(def('HB'), { value: 9.4 }, false)).toEqual({ values: { value: 9.4 }, details: [] });
    });

    it('rejects a missing, text or mistyped number', () => {
      expect(codes(checkValues(def('HB'), {}, false))).toEqual(['values.value:REQUIRED']);
      expect(codes(checkValues(def('HB'), { value: '9.4' }, false))).toEqual(['values.value:WRONG_SHAPE']);
      expect(codes(checkValues(def('HB'), { value: 94 }, false))).toEqual(['values.value:OUT_OF_RANGE']);
    });

    it('rejects a field the test does not have', () => {
      expect(codes(checkValues(def('HB'), { value: 9, extra: 1 }, false))).toEqual(['values.extra:NOT_ALLOWED']);
    });

    it('needs at least one value for tests with only optional fields', () => {
      expect(codes(checkValues(def('ELECTROLYTES'), {}, false))).toEqual(['values:REQUIRED']);
      expect(checkValues(def('ELECTROLYTES'), { sodium: 138 }, false).details).toEqual([]);
    });

    it('blood sugar needs the sample type', () => {
      expect(codes(checkValues(def('BLOOD_SUGAR'), { value: 110 }, false))).toEqual(['values.sample:REQUIRED']);
      expect(codes(checkValues(def('BLOOD_SUGAR'), { value: 110, sample: 'PP' }, false))).toEqual(['values.sample:WRONG_SHAPE']);
      expect(checkValues(def('BLOOD_SUGAR'), { value: 110, sample: 'FASTING' }, false).details).toEqual([]);
    });

    it('WNL: allowed for LFT, TFT, ECG and imaging only, with no values', () => {
      expect(checkValues(def('LFT'), undefined, true)).toEqual({ values: {}, details: [] });
      expect(checkValues(def('ECG'), {}, true).details).toEqual([]);
      expect(codes(checkValues(def('LFT'), { result: 'Bili 1.1' }, true))).toEqual(['values.result:NOT_ALLOWED']);
      expect(codes(checkValues(def('HB'), {}, true))).toContain('wnl:NOT_ALLOWED');
    });

    it('imaging WNL still names the study', () => {
      expect(checkValues(def('IMAGING'), { study: ' Chest X-ray ' }, true)).toEqual({ values: { study: 'Chest X-ray' }, details: [] });
      expect(codes(checkValues(def('IMAGING'), {}, true))).toEqual(['values.study:REQUIRED']);
    });

    it('trims text and limits its length', () => {
      expect(checkValues(def('ABG'), { result: '  pH 7.38  ' }, false).values).toEqual({ result: 'pH 7.38' });
      expect(codes(checkValues(def('ABG'), { result: 'x'.repeat(1001) }, false))).toEqual(['values.result:TOO_LONG']);
    });
  });

  describe('flagsOf', () => {
    const ranges = new Map<string, Range>([[rangeKey('HB', 'value'), { low: 12, high: 16 }]]);

    it('flags only against an approved range, with the edges counting as normal', () => {
      expect(flagsOf(def('HB'), { value: 11.9 }, ranges)).toEqual({ value: 'LOW' });
      expect(flagsOf(def('HB'), { value: 12 }, ranges)).toEqual({});
      expect(flagsOf(def('HB'), { value: 16 }, ranges)).toEqual({});
      expect(flagsOf(def('HB'), { value: 16.1 }, ranges)).toEqual({ value: 'HIGH' });
    });

    it('never flags a field with no approved range', () => {
      expect(flagsOf(def('ALBUMIN'), { value: 1 }, ranges)).toEqual({});
    });

    it('a range with only one side flags only that side', () => {
      const onlyHigh = new Map<string, Range>([[rangeKey('HBA1C', 'value'), { low: null, high: 6.5 }]]);
      expect(flagsOf(def('HBA1C'), { value: 3 }, onlyHigh)).toEqual({});
      expect(flagsOf(def('HBA1C'), { value: 7 }, onlyHigh)).toEqual({ value: 'HIGH' });
    });

    it('an abnormal ECG is flagged, a normal one is not', () => {
      expect(flagsOf(def('ECG'), { finding: 'ABNORMAL' }, new Map())).toEqual({ finding: 'ABNORMAL' });
      expect(flagsOf(def('ECG'), { finding: 'NORMAL' }, new Map())).toEqual({});
    });
  });
});
