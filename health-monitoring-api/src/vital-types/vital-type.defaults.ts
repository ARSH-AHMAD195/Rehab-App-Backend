import { VALUE_KINDS, ValueKind, VitalType } from '../common/constants';

/**
 * The 13 SRS parameters exactly as the v1.1 Parameters table lists them:
 * value shape, unit and the initial valid range (minValid-maxValid).
 *
 * v1.1: "The ranges above are initial data-entry limits that an admin can
 * change. They are not clinical limits." They reject typing mistakes only -
 * alerting is a separate decision made by the thresholds.
 */
export interface VitalTypeSeed {
  type: VitalType;
  label: string;
  unit: string | null;
  valueKind: ValueKind;
  minValid: number | null;
  maxValid: number | null;
  fields?: Record<string, { minValid: number; maxValid: number }>;
  isOptional: boolean;
  onForm: boolean;
  integerOnly: boolean;
  step: number | null;
  order: number;
}

export const VITAL_TYPE_DEFAULTS: VitalTypeSeed[] = [
  {
    type: 'BP',
    label: 'Blood pressure',
    unit: 'mmHg',
    valueKind: VALUE_KINDS.PAIR,
    minValid: null,
    maxValid: null,
    fields: {
      systolic: { minValid: 60, maxValid: 260 },
      diastolic: { minValid: 30, maxValid: 160 },
    },
    isOptional: false,
    onForm: true,
    integerOnly: false,
    step: null,
    order: 1,
  },
  { type: 'PULSE', label: 'Pulse rate', unit: 'bpm', valueKind: VALUE_KINDS.NUMERIC, minValid: 30, maxValid: 220, isOptional: false, onForm: true, integerOnly: false, step: null, order: 2 },
  { type: 'SPO2', label: 'SpO2', unit: '%', valueKind: VALUE_KINDS.NUMERIC, minValid: 50, maxValid: 100, isOptional: false, onForm: true, integerOnly: false, step: null, order: 3 },
  { type: 'TEMP', label: 'Temperature', unit: '\u00B0C', valueKind: VALUE_KINDS.NUMERIC, minValid: 32.0, maxValid: 43.0, isOptional: false, onForm: true, integerOnly: false, step: null, order: 4 },
  { type: 'WEIGHT', label: 'Weight', unit: 'kg', valueKind: VALUE_KINDS.NUMERIC, minValid: 20, maxValid: 250, isOptional: false, onForm: true, integerOnly: false, step: null, order: 5 },
  // "Blood sugar (optional)" is the one optional parameter in the SRS list.
  { type: 'SUGAR', label: 'Blood sugar', unit: 'mg/dL', valueKind: VALUE_KINDS.NUMERIC, minValid: 20, maxValid: 600, isOptional: true, onForm: true, integerOnly: false, step: null, order: 6 },
  { type: 'PAIN', label: 'Pain score', unit: '/10', valueKind: VALUE_KINDS.NUMERIC, minValid: 0, maxValid: 10, isOptional: false, onForm: true, integerOnly: true, step: null, order: 7 },
  { type: 'WALK_MIN', label: 'Walking duration', unit: 'minutes', valueKind: VALUE_KINDS.NUMERIC, minValid: 0, maxValid: 1440, isOptional: false, onForm: true, integerOnly: true, step: null, order: 8 },
  { type: 'STEPS', label: 'Step count', unit: 'steps', valueKind: VALUE_KINDS.NUMERIC, minValid: 0, maxValid: 100000, isOptional: false, onForm: true, integerOnly: true, step: null, order: 9 },
  { type: 'SLEEP_HRS', label: 'Sleep duration', unit: 'hours', valueKind: VALUE_KINDS.NUMERIC, minValid: 0, maxValid: 24, isOptional: false, onForm: true, integerOnly: false, step: 0.5, order: 10 },
  // Free text up to 500 characters until the clinical/frontend teams decide
  // whether nutrition is fixed options (v1.1, Open questions).
  { type: 'NUTRITION', label: 'Nutrition intake', unit: null, valueKind: VALUE_KINDS.TEXT, minValid: 1, maxValid: 500, isOptional: false, onForm: true, integerOnly: false, step: null, order: 11 },
  { type: 'WATER_ML', label: 'Water intake', unit: 'ml', valueKind: VALUE_KINDS.NUMERIC, minValid: 0, maxValid: 10000, isOptional: false, onForm: true, integerOnly: true, step: null, order: 12 },
  { type: 'MOOD', label: 'Mood', unit: 'level', valueKind: VALUE_KINDS.SCALE, minValid: 1, maxValid: 5, isOptional: false, onForm: true, integerOnly: true, step: null, order: 13 },
];
