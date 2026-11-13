import { DateTime } from 'luxon';
import { CARE_ALERT_KINDS, CareAlertKind } from '../common/constants';
import { TriageRuleSet } from '../triage/triage-rules';

/**
 * Care-team alerts, client change request section 3.3: raise an alert to the
 * whole care team for
 *   - a new High-level value (Hb, heart rate, ...): the triage High cut-offs,
 *     so an alert and the tag always agree;
 *   - weight loss of more than 5% since onboarding;
 *   - a rise in MUST score;
 *   - no patient logging for 3 or more days.
 *
 * This works out which alerts SHOULD exist for one patient now. Each has a
 * `key` naming exactly what it is about (this Hb result, this day's pulse),
 * and the store keeps one alert per key - so nothing is raised twice, and an
 * alert a doctor acknowledged never comes back for the same reading.
 *
 * Other vitals (SpO2, temperature, ...) keep alerting through Health
 * Monitoring's own alert limits, as before.
 */

export interface AlertSettings {
  weightLossPercent: number;
  noLoggingDays: number;
  recentDays: number;
}

export interface ResultInput {
  id: string;
  test: string;
  takenOn: string;
  values: Record<string, number | string>;
}

export interface VitalsDay {
  date: string;
  pulse: number | null;
  bp: { systolic: number; diastolic: number } | null;
  weight: number | null;
}

export interface AlertInputs {
  today: string;
  /** Active results of the feeding tests, any date; only recent ones can alert. */
  results: ResultInput[];
  /** Daily vitals within the triage look-back window, newest first. */
  vitals: VitalsDay[];
  onboardingWeightKg: number | null;
  /** The last day anything was logged (vitals or exercise); null if never. */
  lastActivityDate: string | null;
  /** The patient's registration day, for "no logging" when they never logged. */
  registeredOn: string;
}

export interface AlertCandidate {
  kind: CareAlertKind;
  key: string;
  message: string;
  details: Record<string, unknown>;
}

const days = (from: string, to: string) => Math.round(DateTime.fromISO(to).diff(DateTime.fromISO(from), 'days').days);

export function detectAlerts(input: AlertInputs, rules: TriageRuleSet, settings: AlertSettings): AlertCandidate[] {
  const alerts: AlertCandidate[] = [];
  const recent = (date: string) => days(date, input.today) <= settings.recentDays && date <= input.today;

  // 1. New High values in investigation results.
  for (const r of input.results) {
    if (!recent(r.takenOn)) continue;
    const num = (field: string) => (typeof r.values[field] === 'number' ? (r.values[field] as number) : null);
    let message: string | null = null;
    let value: number | null = null;
    if (r.test === 'HB' && (value = num('value')) !== null && value < rules.hb.highBelow) {
      message = `Hb ${value} g/dL on ${r.takenOn} (High: below ${rules.hb.highBelow})`;
    } else if (r.test === 'ALBUMIN' && (value = num('value')) !== null && value < rules.albumin.highBelow) {
      message = `Albumin ${value} g/dL on ${r.takenOn} (High: below ${rules.albumin.highBelow})`;
    } else if (r.test === 'HBA1C' && (value = num('value')) !== null && value > rules.hba1c.highAbove) {
      message = `HbA1c ${value}% on ${r.takenOn} (High: above ${rules.hba1c.highAbove})`;
    } else if (r.test === 'CREATININE' && (value = num('egfr')) !== null && value < rules.egfr.highBelow) {
      message = `eGFR ${value} on ${r.takenOn} (High: below ${rules.egfr.highBelow})`;
    } else if (r.test === 'MUST' && (value = num('score')) !== null && value >= rules.must.highFrom) {
      message = `MUST score ${value} on ${r.takenOn} (High: ${rules.must.highFrom} or more)`;
    }
    if (message) {
      alerts.push({
        kind: CARE_ALERT_KINDS.HIGH_VALUE,
        key: `HIGH_VALUE:result:${r.id}`,
        message,
        details: { source: 'INVESTIGATION', test: r.test, value, date: r.takenOn, resultId: r.id },
      });
    }
  }

  // 2. New High values in daily vitals: resting pulse and BP.
  for (const day of input.vitals) {
    if (day.pulse !== null && day.pulse > rules.heartRate.highAbove) {
      alerts.push({
        kind: CARE_ALERT_KINDS.HIGH_VALUE,
        key: `HIGH_VALUE:PULSE:${day.date}`,
        message: `Pulse ${day.pulse} bpm on ${day.date} (High: over ${rules.heartRate.highAbove})`,
        details: { source: 'VITALS', type: 'PULSE', value: day.pulse, date: day.date },
      });
    }
    if (day.bp && (day.bp.systolic >= rules.bloodPressure.highSystolicFrom || day.bp.diastolic >= rules.bloodPressure.highDiastolicFrom)) {
      alerts.push({
        kind: CARE_ALERT_KINDS.HIGH_VALUE,
        key: `HIGH_VALUE:BP:${day.date}`,
        message: `BP ${day.bp.systolic}/${day.bp.diastolic} mmHg on ${day.date} (High: ${rules.bloodPressure.highSystolicFrom}/${rules.bloodPressure.highDiastolicFrom} or above)`,
        details: { source: 'VITALS', type: 'BP', value: day.bp, date: day.date },
      });
    }
  }

  // 3. Weight loss of more than X% since onboarding, from the newest weight.
  const weighed = input.vitals.find((d) => d.weight !== null);
  if (weighed && input.onboardingWeightKg) {
    const lossPercent = ((input.onboardingWeightKg - weighed.weight!) / input.onboardingWeightKg) * 100;
    if (lossPercent > settings.weightLossPercent) {
      const rounded = Math.round(lossPercent * 10) / 10;
      alerts.push({
        kind: CARE_ALERT_KINDS.WEIGHT_LOSS,
        key: `WEIGHT_LOSS:${weighed.date}`,
        message: `Weight ${weighed.weight} kg on ${weighed.date}: ${rounded}% below the onboarding weight of ${input.onboardingWeightKg} kg (alert: more than ${settings.weightLossPercent}%)`,
        details: { onboardingWeightKg: input.onboardingWeightKg, weightKg: weighed.weight, lossPercent: rounded, date: weighed.date },
      });
    }
  }

  // 4. A rise in MUST score: the newest score above the one before it.
  const musts = input.results
    .filter((r) => r.test === 'MUST' && typeof r.values.score === 'number')
    .sort((a, b) => (a.takenOn === b.takenOn ? 0 : a.takenOn < b.takenOn ? 1 : -1));
  if (musts.length >= 2 && recent(musts[0].takenOn) && (musts[0].values.score as number) > (musts[1].values.score as number)) {
    alerts.push({
      kind: CARE_ALERT_KINDS.MUST_RISE,
      key: `MUST_RISE:${musts[0].id}`,
      message: `MUST score rose from ${musts[1].values.score} (${musts[1].takenOn}) to ${musts[0].values.score} (${musts[0].takenOn})`,
      details: { from: musts[1].values.score, to: musts[0].values.score, fromDate: musts[1].takenOn, date: musts[0].takenOn, resultId: musts[0].id },
    });
  }

  // 5. No logging for N days or more.
  const since = input.lastActivityDate ?? input.registeredOn;
  const quietDays = days(since, input.today);
  if (quietDays >= settings.noLoggingDays) {
    alerts.push({
      kind: CARE_ALERT_KINDS.NO_LOGGING,
      key: `NO_LOGGING:${since}`,
      message: input.lastActivityDate
        ? `Nothing logged for ${quietDays} days (last on ${input.lastActivityDate})`
        : `Nothing logged in the ${quietDays} days since registering`,
      details: { lastActivityDate: input.lastActivityDate, days: quietDays },
    });
  }

  return alerts;
}
