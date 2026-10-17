import { VALUE_KINDS } from '../common/constants';
import { VitalTypeDef } from '../vital-types/vital-type.schema';

/**
 * The value shapes from the v1.1 Parameters table: { num } for numeric and
 * scale, { systolic, diastolic } for BP, { text } for nutrition.
 */
export type NumericValue = { num: number };
export type PairValue = { systolic: number; diastolic: number };
export type TextValue = { text: string };
export type ReadingValue = NumericValue | PairValue | TextValue;

/** One comparable number out of a value, per field. BP yields two. */
export interface NumericField {
  /** null for single-field parameters; "systolic"/"diastolic" for BP. */
  field: string | null;
  value: number;
}

export function numericFields(def: VitalTypeDef, value: ReadingValue): NumericField[] {
  switch (def.valueKind) {
    case VALUE_KINDS.PAIR: {
      const pair = value as PairValue;
      return [
        { field: 'systolic', value: pair.systolic },
        { field: 'diastolic', value: pair.diastolic },
      ];
    }
    case VALUE_KINDS.NUMERIC:
    case VALUE_KINDS.SCALE:
      return [{ field: null, value: (value as NumericValue).num }];
    // Free text has no number to compare, so it never alerts and has no trend.
    case VALUE_KINDS.TEXT:
    default:
      return [];
  }
}

/**
 * Whether a sent value equals the stored one.
 *
 * v1.1 Duplicates and retries: "A sent value equal to the stored value counts
 * as unchanged. It keeps its loggedAt and creates no audit entry, alert or
 * event." Compared field by field, so key order in the request cannot make an
 * identical value look like a change.
 */
export function sameValue(a: ReadingValue | null, b: ReadingValue | null): boolean {
  if (a === null || b === null) return a === b;

  const keysA = Object.keys(a).sort();
  const keysB = Object.keys(b).sort();
  if (keysA.length !== keysB.length || keysA.some((k, i) => k !== keysB[i])) return false;

  return keysA.every(
    (key) =>
      (a as Record<string, unknown>)[key] === (b as Record<string, unknown>)[key],
  );
}
