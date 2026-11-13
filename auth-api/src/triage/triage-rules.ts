import { DateTime } from 'luxon';
import { ageOn } from '../medical-profiles/derived';

/**
 * Triage tag, from the client's change request (Nov 2026), section 3.
 *
 * Combining (client's rules, in order):
 *   1. any parameter at a High cut-off             -> HIGH
 *   2. two or more parameters at a Medium cut-off  -> HIGH
 *   3. one parameter at a Medium cut-off           -> MEDIUM
 *   4. none                                        -> LOW
 *
 * THE NUMBERS ARE THE CLIENT'S. Where their table leaves a boundary open, the
 * choice is spelled out in the setting's name (e.g. `mediumBelow: 11` means
 * "8-10.9" is read as 8 up to but not including 11). All of it is stored as a
 * versioned setting (triageRules) that an admin can change, and every result is
 * marked provisional until the clinical team confirms the rules.
 *
 * Missing data never raises the tag; it is listed in `missing`, so the doctor
 * can see the tag is based on incomplete information.
 */

export const TRIAGE_TAGS = { HIGH: 'HIGH', MEDIUM: 'MEDIUM', LOW: 'LOW' } as const;
export type TriageTag = (typeof TRIAGE_TAGS)[keyof typeof TRIAGE_TAGS];
export type Level = 'HIGH' | 'MEDIUM';

export interface TriageRuleSet {
  age: { highAbove: number; mediumFrom: number };
  hb: { highBelow: number; mediumBelow: number };
  albumin: { highBelow: number; mediumBelow: number };
  must: { highFrom: number; mediumFrom: number };
  smoking: { mediumQuitWithinDays: number };
  bloodPressure: { highSystolicFrom: number; highDiastolicFrom: number };
  hba1c: { highAbove: number; mediumFrom: number };
  egfr: { highBelow: number; mediumBelow: number };
  ihd: { highEventWithinDays: number };
  heartRate: { highAbove: number; mediumFrom: number };
  recentChemo: { mediumWithinDays: number };
  /** BP and heart rate come from the daily vitals of the last N days. */
  vitalsLookbackDays: number;
}

/**
 * The client's table as first read. Each line notes how an open boundary was
 * read; change the setting, not the code, once the clinical team answers.
 */
export const DEFAULT_TRIAGE_RULES: TriageRuleSet = {
  age: { highAbove: 70, mediumFrom: 60 }, // >70 High; 60-70 (70 included) Medium
  hb: { highBelow: 8, mediumBelow: 11 }, // <8 High; 8-10.9 Medium
  albumin: { highBelow: 3.0, mediumBelow: 3.5 }, // <3.0 High; 3.0-3.4 Medium
  must: { highFrom: 2, mediumFrom: 1 }, // >=2 High; 1 Medium
  smoking: { mediumQuitWithinDays: 56 }, // current High; quit < 8 weeks Medium
  bloodPressure: { highSystolicFrom: 180, highDiastolicFrom: 110 }, // >=180 systolic OR >=110 diastolic High
  hba1c: { highAbove: 8.5, mediumFrom: 7 }, // >8.5 High; 7-8.5 (8.5 included) Medium
  egfr: { highBelow: 30, mediumBelow: 60 }, // <30 High; 30-59 Medium
  ihd: { highEventWithinDays: 183 }, // symptomatic or MI/stent within 6 months High; stable Medium
  heartRate: { highAbove: 100, mediumFrom: 90 }, // >100 High; 90-100 Medium
  recentChemo: { mediumWithinDays: 28 }, // chemo within the last 4 weeks Medium
  vitalsLookbackDays: 7,
};

/** A dated value from an investigation or a daily vital. */
export interface Dated<T = number> {
  value: T;
  date: string;
}

export interface TriageInputs {
  /** The patient's own calendar date. */
  today: string;
  dateOfBirth: string | null;
  hb: Dated | null;
  albumin: Dated | null;
  must: Dated | null;
  hba1c: Dated | null;
  egfr: Dated | null;
  bloodPressure: Dated<{ systolic: number; diastolic: number }> | null;
  heartRate: Dated | null;
  conditions: string[] | null;
  smokingStatus: string | null;
  smokingQuitDate: string | null;
  hypertensionOnMedication: boolean | null;
  ihdStatus: string | null;
  lastMiOrStentDate: string | null;
  canClimbTwoFlights: boolean | null;
  chemotherapy: boolean | null;
  lastChemoDate: string | null;
}

export const PARAMETERS = [
  'AGE',
  'HAEMOGLOBIN',
  'ALBUMIN',
  'NUTRITION_MUST',
  'SMOKING',
  'HYPERTENSION',
  'DIABETES',
  'CKD',
  'IHD',
  'RESTING_HEART_RATE',
  'FUNCTIONAL_CAPACITY',
  'RECENT_CHEMOTHERAPY',
] as const;
export type Parameter = (typeof PARAMETERS)[number];

export interface TriageReason {
  parameter: Parameter;
  level: Level;
  /** What the doctor sees, e.g. "Hb 7.6 g/dL on 2026-11-08 (High: below 8)". */
  explanation: string;
  /** The date of the value behind it, when it has one. */
  date: string | null;
}

export interface TriageEvaluation {
  tag: TriageTag;
  /** Every parameter at a Medium or High cut-off, High first. */
  reasons: TriageReason[];
  /** Parameters with no data, so they could not count. */
  missing: { parameter: Parameter; needs: string }[];
}

export function evaluateTriage(input: TriageInputs, rules: TriageRuleSet): TriageEvaluation {
  const reasons: TriageReason[] = [];
  const missing: TriageEvaluation['missing'] = [];
  const has = (condition: string) => input.conditions?.includes(condition) ?? false;
  const add = (parameter: Parameter, level: Level, explanation: string, date: string | null = null) =>
    reasons.push({ parameter, level, explanation, date });
  const daysSince = (date: string) => Math.round(DateTime.fromISO(input.today).diff(DateTime.fromISO(date), 'days').days);
  const on = (d: Dated<unknown>) => ` on ${d.date}`;

  // Age
  const age = ageOn(input.dateOfBirth, input.today);
  if (age === null) missing.push({ parameter: 'AGE', needs: 'date of birth' });
  else if (age > rules.age.highAbove) add('AGE', 'HIGH', `Age ${age} (High: over ${rules.age.highAbove})`);
  else if (age >= rules.age.mediumFrom) add('AGE', 'MEDIUM', `Age ${age} (Medium: ${rules.age.mediumFrom}-${rules.age.highAbove})`);

  // Haemoglobin
  if (!input.hb) missing.push({ parameter: 'HAEMOGLOBIN', needs: 'an Hb result' });
  else if (input.hb.value < rules.hb.highBelow) add('HAEMOGLOBIN', 'HIGH', `Hb ${input.hb.value} g/dL${on(input.hb)} (High: below ${rules.hb.highBelow})`, input.hb.date);
  else if (input.hb.value < rules.hb.mediumBelow) add('HAEMOGLOBIN', 'MEDIUM', `Hb ${input.hb.value} g/dL${on(input.hb)} (Medium: ${rules.hb.highBelow} to under ${rules.hb.mediumBelow})`, input.hb.date);

  // Albumin
  if (!input.albumin) missing.push({ parameter: 'ALBUMIN', needs: 'an albumin result' });
  else if (input.albumin.value < rules.albumin.highBelow) add('ALBUMIN', 'HIGH', `Albumin ${input.albumin.value} g/dL${on(input.albumin)} (High: below ${rules.albumin.highBelow})`, input.albumin.date);
  else if (input.albumin.value < rules.albumin.mediumBelow) add('ALBUMIN', 'MEDIUM', `Albumin ${input.albumin.value} g/dL${on(input.albumin)} (Medium: ${rules.albumin.highBelow} to under ${rules.albumin.mediumBelow})`, input.albumin.date);

  // Nutrition (MUST)
  if (!input.must) missing.push({ parameter: 'NUTRITION_MUST', needs: 'a MUST score' });
  else if (input.must.value >= rules.must.highFrom) add('NUTRITION_MUST', 'HIGH', `MUST ${input.must.value}${on(input.must)} (High: ${rules.must.highFrom} or more)`, input.must.date);
  else if (input.must.value >= rules.must.mediumFrom) add('NUTRITION_MUST', 'MEDIUM', `MUST ${input.must.value}${on(input.must)} (Medium: ${rules.must.mediumFrom})`, input.must.date);

  // Smoking
  if (!input.smokingStatus) missing.push({ parameter: 'SMOKING', needs: 'smoking status' });
  else if (input.smokingStatus === 'CURRENT') add('SMOKING', 'HIGH', 'Current smoker (High)');
  else if (input.smokingStatus === 'FORMER') {
    if (!input.smokingQuitDate) missing.push({ parameter: 'SMOKING', needs: 'the date they quit smoking' });
    else if (daysSince(input.smokingQuitDate) < rules.smoking.mediumQuitWithinDays) {
      add('SMOKING', 'MEDIUM', `Quit smoking on ${input.smokingQuitDate}, under ${rules.smoking.mediumQuitWithinDays} days ago (Medium)`);
    }
  }

  // Hypertension: a high reading is High; controlled on medication is Medium.
  const bp = input.bloodPressure;
  if (bp && (bp.value.systolic >= rules.bloodPressure.highSystolicFrom || bp.value.diastolic >= rules.bloodPressure.highDiastolicFrom)) {
    add('HYPERTENSION', 'HIGH', `BP ${bp.value.systolic}/${bp.value.diastolic} mmHg${on(bp)} (High: ${rules.bloodPressure.highSystolicFrom}/${rules.bloodPressure.highDiastolicFrom} or above)`, bp.date);
  } else if (input.hypertensionOnMedication === true) {
    add('HYPERTENSION', 'MEDIUM', 'Hypertension controlled on medication (Medium)');
  } else {
    if (!bp) missing.push({ parameter: 'HYPERTENSION', needs: `a BP reading in the last ${rules.vitalsLookbackDays} days` });
    if (has('HTN') && input.hypertensionOnMedication === null) {
      missing.push({ parameter: 'HYPERTENSION', needs: 'whether the hypertension is on medication' });
    }
  }

  // Diabetes (HbA1c). Without diabetes and without a result, there is nothing to miss.
  if (input.hba1c) {
    if (input.hba1c.value > rules.hba1c.highAbove) add('DIABETES', 'HIGH', `HbA1c ${input.hba1c.value}%${on(input.hba1c)} (High: above ${rules.hba1c.highAbove})`, input.hba1c.date);
    else if (input.hba1c.value >= rules.hba1c.mediumFrom) add('DIABETES', 'MEDIUM', `HbA1c ${input.hba1c.value}%${on(input.hba1c)} (Medium: ${rules.hba1c.mediumFrom}-${rules.hba1c.highAbove})`, input.hba1c.date);
  } else if (has('DM')) {
    missing.push({ parameter: 'DIABETES', needs: 'an HbA1c result' });
  }

  // CKD (eGFR, as the lab reports it)
  if (input.egfr) {
    if (input.egfr.value < rules.egfr.highBelow) add('CKD', 'HIGH', `eGFR ${input.egfr.value}${on(input.egfr)} (High: below ${rules.egfr.highBelow})`, input.egfr.date);
    else if (input.egfr.value < rules.egfr.mediumBelow) add('CKD', 'MEDIUM', `eGFR ${input.egfr.value}${on(input.egfr)} (Medium: ${rules.egfr.highBelow} to under ${rules.egfr.mediumBelow})`, input.egfr.date);
  } else if (has('CKD')) {
    missing.push({ parameter: 'CKD', needs: 'an eGFR result' });
  }

  // Ischaemic heart disease
  const recentEvent = input.lastMiOrStentDate !== null && daysSince(input.lastMiOrStentDate) <= rules.ihd.highEventWithinDays;
  if (recentEvent) add('IHD', 'HIGH', `MI or stent on ${input.lastMiOrStentDate}, within ${rules.ihd.highEventWithinDays} days (High)`);
  else if (input.ihdStatus === 'SYMPTOMATIC') add('IHD', 'HIGH', 'Symptomatic ischaemic heart disease (High)');
  else if (input.ihdStatus === 'STABLE') add('IHD', 'MEDIUM', 'Stable ischaemic heart disease (Medium)');
  else if (has('IHD')) missing.push({ parameter: 'IHD', needs: 'whether the heart disease is stable or symptomatic' });

  // Resting heart rate
  const hr = input.heartRate;
  if (!hr) missing.push({ parameter: 'RESTING_HEART_RATE', needs: `a pulse reading in the last ${rules.vitalsLookbackDays} days` });
  else if (hr.value > rules.heartRate.highAbove) add('RESTING_HEART_RATE', 'HIGH', `Pulse ${hr.value} bpm${on(hr)} (High: over ${rules.heartRate.highAbove})`, hr.date);
  else if (hr.value >= rules.heartRate.mediumFrom) add('RESTING_HEART_RATE', 'MEDIUM', `Pulse ${hr.value} bpm${on(hr)} (Medium: ${rules.heartRate.mediumFrom}-${rules.heartRate.highAbove})`, hr.date);

  // Functional capacity
  if (input.canClimbTwoFlights === null) missing.push({ parameter: 'FUNCTIONAL_CAPACITY', needs: 'whether they can climb 2 flights of stairs' });
  else if (input.canClimbTwoFlights === false) add('FUNCTIONAL_CAPACITY', 'HIGH', 'Cannot climb 2 flights of stairs, under 4 METs (High)');

  // Recent chemotherapy
  if (input.lastChemoDate) {
    if (daysSince(input.lastChemoDate) <= rules.recentChemo.mediumWithinDays) {
      add('RECENT_CHEMOTHERAPY', 'MEDIUM', `Last chemotherapy on ${input.lastChemoDate}, within ${rules.recentChemo.mediumWithinDays} days (Medium)`);
    }
  } else if (input.chemotherapy === true) {
    missing.push({ parameter: 'RECENT_CHEMOTHERAPY', needs: 'the date of the last chemotherapy' });
  }

  const highs = reasons.filter((r) => r.level === 'HIGH').length;
  const mediums = reasons.filter((r) => r.level === 'MEDIUM').length;
  const tag: TriageTag = highs >= 1 || mediums >= 2 ? 'HIGH' : mediums === 1 ? 'MEDIUM' : 'LOW';

  reasons.sort((a, b) => (a.level === b.level ? 0 : a.level === 'HIGH' ? -1 : 1));
  return { tag, reasons, missing };
}
