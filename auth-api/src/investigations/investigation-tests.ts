/**
 * The investigations grid, from the hospital's pre-anaesthesia check-up (PAC)
 * form as listed in the client's change request (Nov 2026), plus serum
 * albumin, which the PAC grid lacks but triage needs.
 *
 * `min`/`max` are DATA-ENTRY limits that catch typing mistakes (a decimal
 * point in the wrong place), the same idea as the vital types' valid ranges.
 * They are NOT clinical normal ranges: those come from the clinical team and
 * are stored in `investigationRanges`, which starts empty.
 *
 * Blood group ("entered once") is not here: it is already on the medical profile.
 */

export const INVESTIGATION_GROUPS = {
  HAEMATOLOGY: 'HAEMATOLOGY',
  BIOCHEMISTRY: 'BIOCHEMISTRY',
  CARDIAC_RESPIRATORY_IMAGING: 'CARDIAC_RESPIRATORY_IMAGING',
} as const;
export type InvestigationGroup = (typeof INVESTIGATION_GROUPS)[keyof typeof INVESTIGATION_GROUPS];

export type FieldDef =
  | { key: string; label: string; kind: 'number'; unit: string; min: number; max: number; required?: boolean }
  | { key: string; label: string; kind: 'text'; maxLength: number; required?: boolean; alsoWithWnl?: boolean }
  | { key: string; label: string; kind: 'choice'; options: readonly string[]; abnormal?: readonly string[]; required?: boolean };

export interface TestDef {
  code: string;
  label: string;
  group: InvestigationGroup;
  fields: readonly FieldDef[];
  /** "WNL" (within normal limits) can be entered instead of values. */
  allowWnl: boolean;
  /** Will feed the triage tag once the triage rules are confirmed. */
  feedsTriage: boolean;
  note?: string;
}

const TEXT = 1000;
const num = (key: string, label: string, unit: string, min: number, max: number, required = true): FieldDef => ({
  key,
  label,
  kind: 'number',
  unit,
  min,
  max,
  required,
});

export const INVESTIGATION_TESTS: readonly TestDef[] = [
  // ------------------------------------------------------------ haematology
  { code: 'HB', label: 'Haemoglobin (Hb)', group: 'HAEMATOLOGY', fields: [num('value', 'Hb', 'g/dL', 1, 25)], allowWnl: false, feedsTriage: true },
  { code: 'TLC', label: 'Total leucocyte count (TLC)', group: 'HAEMATOLOGY', fields: [num('value', 'TLC', '×10³/µL', 0.1, 500)], allowWnl: false, feedsTriage: false },
  {
    code: 'DLC',
    label: 'Differential leucocyte count (DLC)',
    group: 'HAEMATOLOGY',
    fields: [
      num('neutrophils', 'Neutrophils', '%', 0, 100, false),
      num('lymphocytes', 'Lymphocytes', '%', 0, 100, false),
      num('monocytes', 'Monocytes', '%', 0, 100, false),
      num('eosinophils', 'Eosinophils', '%', 0, 100, false),
      num('basophils', 'Basophils', '%', 0, 100, false),
    ],
    allowWnl: false,
    feedsTriage: false,
  },
  { code: 'PLATELETS', label: 'Platelets', group: 'HAEMATOLOGY', fields: [num('value', 'Platelets', '×10³/µL', 1, 2000)], allowWnl: false, feedsTriage: false },
  {
    code: 'PT_INR',
    label: 'PT / INR',
    group: 'HAEMATOLOGY',
    fields: [num('pt', 'PT', 'seconds', 5, 200, false), num('inr', 'INR', 'ratio', 0.5, 20, false)],
    allowWnl: false,
    feedsTriage: false,
  },

  // ------------------------------------------------------------ biochemistry
  {
    code: 'BLOOD_SUGAR',
    label: 'Blood sugar',
    group: 'BIOCHEMISTRY',
    fields: [
      num('value', 'Blood sugar', 'mg/dL', 10, 1500),
      { key: 'sample', label: 'Sample', kind: 'choice', options: ['FASTING', 'RANDOM'], required: true },
    ],
    allowWnl: false,
    feedsTriage: false,
  },
  { code: 'HBA1C', label: 'HbA1c', group: 'BIOCHEMISTRY', fields: [num('value', 'HbA1c', '%', 2, 20)], allowWnl: false, feedsTriage: true },
  { code: 'UREA', label: 'Blood urea', group: 'BIOCHEMISTRY', fields: [num('value', 'Urea', 'mg/dL', 1, 500)], allowWnl: false, feedsTriage: false },
  {
    code: 'CREATININE',
    label: 'Serum creatinine',
    group: 'BIOCHEMISTRY',
    fields: [num('value', 'Creatinine', 'mg/dL', 0.1, 30)],
    allowWnl: false,
    feedsTriage: true,
    note: 'eGFR will be worked out from this once the clinic confirms the formula.',
  },
  {
    code: 'ELECTROLYTES',
    label: 'Serum electrolytes',
    group: 'BIOCHEMISTRY',
    fields: [
      num('sodium', 'Na', 'mmol/L', 80, 200, false),
      num('potassium', 'K', 'mmol/L', 1, 12, false),
      num('chloride', 'Cl', 'mmol/L', 50, 150, false),
    ],
    allowWnl: false,
    feedsTriage: false,
  },
  {
    code: 'LFT',
    label: 'Liver function tests (LFT)',
    group: 'BIOCHEMISTRY',
    fields: [{ key: 'result', label: 'Values', kind: 'text', maxLength: TEXT, required: true }],
    allowWnl: true,
    feedsTriage: false,
  },
  {
    code: 'ALBUMIN',
    label: 'Serum albumin',
    group: 'BIOCHEMISTRY',
    fields: [num('value', 'Albumin', 'g/dL', 0.5, 7)],
    allowWnl: false,
    feedsTriage: true,
    note: 'Not on the PAC grid; needed for triage.',
  },
  {
    code: 'TFT',
    label: 'Thyroid function tests (TFT)',
    group: 'BIOCHEMISTRY',
    fields: [{ key: 'result', label: 'Values', kind: 'text', maxLength: TEXT, required: true }],
    allowWnl: true,
    feedsTriage: false,
  },
  {
    code: 'ABG',
    label: 'Arterial blood gas (ABG)',
    group: 'BIOCHEMISTRY',
    fields: [{ key: 'result', label: 'Result', kind: 'text', maxLength: TEXT, required: true }],
    allowWnl: false,
    feedsTriage: false,
  },

  // ------------------------------------------------ cardiac, respiratory, imaging
  {
    code: 'ECG',
    label: 'ECG',
    group: 'CARDIAC_RESPIRATORY_IMAGING',
    fields: [{ key: 'finding', label: 'Finding', kind: 'choice', options: ['NORMAL', 'ABNORMAL'], abnormal: ['ABNORMAL'], required: true }],
    allowWnl: true,
    feedsTriage: false,
  },
  { code: 'ECHO', label: '2D-Echo', group: 'CARDIAC_RESPIRATORY_IMAGING', fields: [num('ef', 'EF', '%', 5, 90)], allowWnl: false, feedsTriage: false },
  {
    code: 'PFT',
    label: 'Pulmonary function tests (PFT)',
    group: 'CARDIAC_RESPIRATORY_IMAGING',
    fields: [{ key: 'result', label: 'Result', kind: 'text', maxLength: TEXT, required: true }],
    allowWnl: false,
    feedsTriage: false,
  },
  {
    code: 'IMAGING',
    label: 'Chest X-ray / other imaging',
    group: 'CARDIAC_RESPIRATORY_IMAGING',
    fields: [
      { key: 'study', label: 'Study', kind: 'text', maxLength: 100, required: true, alsoWithWnl: true },
      { key: 'result', label: 'Result', kind: 'text', maxLength: TEXT, required: true },
    ],
    allowWnl: true,
    feedsTriage: false,
  },
];

export const TEST_CODES = INVESTIGATION_TESTS.map((t) => t.code);
const BY_CODE = new Map(INVESTIGATION_TESTS.map((t) => [t.code, t]));

export function testDef(code: string): TestDef | undefined {
  return BY_CODE.get(code);
}
