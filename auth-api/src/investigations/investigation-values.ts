import { DETAIL_CODES } from '../common/constants';
import { ErrorDetail } from '../common/api.exception';
import { TestDef } from './investigation-tests';

export type Values = Record<string, number | string>;
export type Flag = 'LOW' | 'HIGH' | 'ABNORMAL';
export interface Range {
  low: number | null;
  high: number | null;
}

/**
 * Checks a result's values against its test's fields and returns them cleaned
 * (text trimmed), or the problems found. With wnl, only fields marked
 * alsoWithWnl (the imaging study's name) may be sent.
 */
export function checkValues(
  def: TestDef,
  raw: Record<string, unknown> | undefined,
  wnl: boolean,
): { values: Values; details: ErrorDetail[] } {
  const details: ErrorDetail[] = [];
  const values: Values = {};
  const input = raw ?? {};
  const fields = new Map(def.fields.map((f) => [f.key, f]));

  if (wnl && !def.allowWnl) {
    details.push({ field: 'wnl', code: DETAIL_CODES.NOT_ALLOWED, issue: `${def.code} can't be entered as WNL` });
  }

  for (const key of Object.keys(input)) {
    if (!fields.has(key)) {
      details.push({ field: `values.${key}`, code: DETAIL_CODES.NOT_ALLOWED, issue: `${def.code} has no field "${key}"` });
    }
  }

  for (const field of def.fields) {
    const path = `values.${field.key}`;
    const usedWithWnl = field.kind === 'text' && field.alsoWithWnl === true;
    const value = input[field.key];
    const missing = value === undefined || value === null || (typeof value === 'string' && value.trim() === '');

    if (wnl && def.allowWnl && !usedWithWnl) {
      if (!missing) details.push({ field: path, code: DETAIL_CODES.NOT_ALLOWED, issue: 'leave out values when the result is WNL' });
      continue;
    }
    if (missing) {
      if (field.required) details.push({ field: path, code: DETAIL_CODES.REQUIRED, issue: 'is required' });
      continue;
    }

    if (field.kind === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        details.push({ field: path, code: DETAIL_CODES.WRONG_SHAPE, issue: `must be a number (${field.unit})` });
      } else if (field.integer && !Number.isInteger(value)) {
        details.push({ field: path, code: DETAIL_CODES.WRONG_SHAPE, issue: 'must be a whole number' });
      } else if (value < field.min || value > field.max) {
        details.push({
          field: path,
          code: DETAIL_CODES.OUT_OF_RANGE,
          issue: `must be ${field.min}-${field.max} ${field.unit}; check for a typing mistake`,
        });
      } else {
        values[field.key] = value;
      }
    } else if (field.kind === 'text') {
      if (typeof value !== 'string') {
        details.push({ field: path, code: DETAIL_CODES.WRONG_SHAPE, issue: 'must be text' });
      } else if (value.trim().length > field.maxLength) {
        details.push({ field: path, code: DETAIL_CODES.TOO_LONG, issue: `must be at most ${field.maxLength} characters` });
      } else {
        values[field.key] = value.trim();
      }
    } else if (typeof value !== 'string' || !field.options.includes(value)) {
      details.push({ field: path, code: DETAIL_CODES.WRONG_SHAPE, issue: `must be one of ${field.options.join(', ')}` });
    } else {
      values[field.key] = value;
    }
  }

  // Tests whose fields are all optional (DLC, PT/INR, electrolytes) still need one value.
  const expectsValues = !(wnl && def.allowWnl);
  if (expectsValues && !details.length && !Object.keys(values).length) {
    details.push({ field: 'values', code: DETAIL_CODES.REQUIRED, issue: 'enter at least one value' });
  }

  return { values, details };
}

/**
 * Which values fall outside the approved normal range. A field with no
 * approved range is never flagged - the ranges come from the clinical team,
 * not from this code. A choice listed as abnormal (ECG "ABNORMAL") is
 * flagged as such. WNL is never flagged.
 */
export function flagsOf(def: TestDef, values: Values, ranges: Map<string, Range>): Record<string, Flag> {
  const flags: Record<string, Flag> = {};
  for (const field of def.fields) {
    const value = values[field.key];
    if (value === undefined) continue;
    if (field.kind === 'number' && typeof value === 'number') {
      const range = ranges.get(rangeKey(def.code, field.key));
      if (range?.low !== null && range?.low !== undefined && value < range.low) flags[field.key] = 'LOW';
      else if (range?.high !== null && range?.high !== undefined && value > range.high) flags[field.key] = 'HIGH';
    } else if (field.kind === 'choice' && field.abnormal?.includes(String(value))) {
      flags[field.key] = 'ABNORMAL';
    }
  }
  return flags;
}

export function rangeKey(test: string, field: string): string {
  return `${test}:${field}`;
}
