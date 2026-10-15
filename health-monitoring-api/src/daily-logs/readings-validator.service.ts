import { Injectable } from '@nestjs/common';
import {
  DETAIL_CODES,
  MAX_READINGS_PER_SAVE,
  VALUE_KINDS,
} from '../common/constants';
import { ErrorDetail, ValidationFailedException } from '../common/api.exception';
import { VitalTypeDef } from '../vital-types/vital-type.schema';
import { VitalTypesService } from '../vital-types/vital-types.service';
import { PairValue, ReadingValue } from './reading-value';

/** A validated reading, ready to store. null means "clear this value". */
export interface ValidatedReading {
  def: VitalTypeDef;
  value: ReadingValue | null;
}

/**
 * PUT /me/vitals/today, Rules (v1.1):
 *  - at least one reading must be sent; unknown type codes are rejected;
 *  - each value must match its type's shape and be within its valid range;
 *  - for BP both fields are sent together, each checked against its own range,
 *    and systolic must be greater than diastolic;
 *  - sending null clears a value.
 *
 * Validation is not alerting (v1.1): the valid range only rejects typing
 * mistakes and impossible values. A value inside the range is always saved,
 * and whether it is clinically worrying is decided by the thresholds.
 *
 * The ranges are read from the database, not from this file, because an admin
 * can change them through PUT /admin/vital-types/:type.
 */
@Injectable()
export class ReadingsValidatorService {
  constructor(private readonly vitalTypes: VitalTypesService) {}

  async validate(readings: unknown): Promise<ValidatedReading[]> {
    const details: ErrorDetail[] = [];

    if (readings === null || typeof readings !== 'object' || Array.isArray(readings)) {
      throw new ValidationFailedException([
        { field: 'readings', code: DETAIL_CODES.WRONG_SHAPE, issue: 'must be an object of readings' },
      ]);
    }

    const entries = Object.entries(readings as Record<string, unknown>);
    if (!entries.length) {
      throw new ValidationFailedException([
        { field: 'readings', code: DETAIL_CODES.EMPTY_READINGS, issue: 'at least one reading is required' },
      ]);
    }
    if (entries.length > MAX_READINGS_PER_SAVE) {
      throw new ValidationFailedException([
        {
          field: 'readings',
          code: DETAIL_CODES.WRONG_SHAPE,
          issue: `at most ${MAX_READINGS_PER_SAVE} readings per request`,
        },
      ]);
    }

    const defs = await this.vitalTypes.byType();
    const validated: ValidatedReading[] = [];

    for (const [type, raw] of entries) {
      const def = defs.get(type);
      if (!def) {
        details.push({
          field: `readings.${type}`,
          code: DETAIL_CODES.UNKNOWN_TYPE,
          issue: 'is not a known parameter',
        });
        continue;
      }

      // Sending null clears a value, and its status goes back to NOT_YET.
      if (raw === null) {
        validated.push({ def, value: null });
        continue;
      }

      const value = this.checkValue(def, raw, details);
      if (value) validated.push({ def, value });
    }

    if (details.length) throw new ValidationFailedException(details);
    return validated;
  }

  private checkValue(
    def: VitalTypeDef,
    raw: unknown,
    details: ErrorDetail[],
  ): ReadingValue | null {
    const path = `readings.${def.type}`;

    if (typeof raw !== 'object' || Array.isArray(raw)) {
      details.push({ field: path, code: DETAIL_CODES.WRONG_SHAPE, issue: this.shapeHint(def) });
      return null;
    }

    switch (def.valueKind) {
      case VALUE_KINDS.PAIR:
        return this.checkPair(def, raw as Record<string, unknown>, details);
      case VALUE_KINDS.TEXT:
        return this.checkText(def, raw as Record<string, unknown>, details);
      default:
        return this.checkNumeric(def, raw as Record<string, unknown>, details);
    }
  }

  private checkNumeric(
    def: VitalTypeDef,
    raw: Record<string, unknown>,
    details: ErrorDetail[],
  ): ReadingValue | null {
    const path = `readings.${def.type}`;
    if (!this.hasExactKeys(raw, ['num'])) {
      details.push({ field: path, code: DETAIL_CODES.WRONG_SHAPE, issue: this.shapeHint(def) });
      return null;
    }
    const num = raw.num;
    if (!this.isFiniteNumber(num)) {
      details.push({ field: `${path}.num`, code: DETAIL_CODES.WRONG_SHAPE, issue: 'must be a number' });
      return null;
    }
    if (!this.checkNumberRules(def, num, `${path}.num`, def.minValid, def.maxValid, details)) {
      return null;
    }
    return { num };
  }

  private checkPair(
    def: VitalTypeDef,
    raw: Record<string, unknown>,
    details: ErrorDetail[],
  ): ReadingValue | null {
    const path = `readings.${def.type}`;
    const names = [...(def.fields?.keys() ?? [])];

    // "For BP, both fields are sent together."
    if (!this.hasExactKeys(raw, names)) {
      details.push({ field: path, code: DETAIL_CODES.WRONG_SHAPE, issue: this.shapeHint(def) });
      return null;
    }

    let ok = true;
    for (const name of names) {
      const value = raw[name];
      if (!this.isFiniteNumber(value)) {
        details.push({
          field: `${path}.${name}`,
          code: DETAIL_CODES.WRONG_SHAPE,
          issue: 'must be a number',
        });
        ok = false;
        continue;
      }
      const range = def.fields?.get(name);
      if (
        !this.checkNumberRules(
          def,
          value,
          `${path}.${name}`,
          range?.minValid ?? null,
          range?.maxValid ?? null,
          details,
        )
      ) {
        ok = false;
      }
    }
    if (!ok) return null;

    const pair = raw as unknown as PairValue;
    if (pair.systolic <= pair.diastolic) {
      details.push({
        field: `${path}.systolic`,
        code: DETAIL_CODES.BP_SYSTOLIC_NOT_ABOVE_DIASTOLIC,
        issue: 'must be greater than diastolic',
      });
      return null;
    }
    return { systolic: pair.systolic, diastolic: pair.diastolic };
  }

  private checkText(
    def: VitalTypeDef,
    raw: Record<string, unknown>,
    details: ErrorDetail[],
  ): ReadingValue | null {
    const path = `readings.${def.type}`;
    if (!this.hasExactKeys(raw, ['text'])) {
      details.push({ field: path, code: DETAIL_CODES.WRONG_SHAPE, issue: this.shapeHint(def) });
      return null;
    }
    const text = raw.text;
    if (typeof text !== 'string') {
      details.push({ field: `${path}.text`, code: DETAIL_CODES.WRONG_SHAPE, issue: 'must be text' });
      return null;
    }
    // For text, minValid and maxValid are character counts (v1.1).
    if (def.maxValid !== null && text.length > def.maxValid) {
      details.push({
        field: `${path}.text`,
        code: DETAIL_CODES.TOO_LONG,
        issue: `must be at most ${def.maxValid} characters`,
      });
      return null;
    }
    if (def.minValid !== null && text.trim().length < def.minValid) {
      details.push({
        field: `${path}.text`,
        code: DETAIL_CODES.REQUIRED,
        issue: `must be at least ${def.minValid} characters; send null to clear it`,
      });
      return null;
    }
    return { text };
  }

  private checkNumberRules(
    def: VitalTypeDef,
    value: number,
    field: string,
    min: number | null,
    max: number | null,
    details: ErrorDetail[],
  ): boolean {
    if ((min !== null && value < min) || (max !== null && value > max)) {
      details.push({
        field,
        code: DETAIL_CODES.OUT_OF_RANGE,
        issue: `must be between ${min} and ${max}`,
      });
      return false;
    }
    if (def.integerOnly && !Number.isInteger(value)) {
      details.push({ field, code: DETAIL_CODES.WRONG_SHAPE, issue: 'must be a whole number' });
      return false;
    }
    if (def.step !== null && def.step > 0) {
      // Compared with a tolerance: 7.5 / 0.5 is not exactly 15 in binary floats.
      const steps = value / def.step;
      if (Math.abs(steps - Math.round(steps)) > 1e-9) {
        details.push({
          field,
          code: DETAIL_CODES.WRONG_SHAPE,
          issue: `must be in steps of ${def.step}`,
        });
        return false;
      }
    }
    return true;
  }

  private hasExactKeys(raw: Record<string, unknown>, expected: string[]): boolean {
    const keys = Object.keys(raw);
    return keys.length === expected.length && expected.every((key) => keys.includes(key));
  }

  private isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
  }

  private shapeHint(def: VitalTypeDef): string {
    switch (def.valueKind) {
      case VALUE_KINDS.PAIR:
        return `must be { ${[...(def.fields?.keys() ?? [])].join(', ')} }`;
      case VALUE_KINDS.TEXT:
        return 'must be { text }';
      default:
        return 'must be { num }';
    }
  }
}
