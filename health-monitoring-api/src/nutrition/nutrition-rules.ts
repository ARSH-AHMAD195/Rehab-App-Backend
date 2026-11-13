import { DETAIL_CODES } from '../common/constants';
import { ErrorDetail } from '../common/api.exception';
import { DietTargets, MealSlot, OPTION_KINDS } from './diet-chart';

/**
 * How a day's intake is counted (client change request, section 5.2: "the
 * patient ticks the option they ate in each slot; the app adds up calories and
 * protein for the day").
 *
 * The chart gives calories and protein per meal SLOT, not per food option, so
 * a slot counts in full once anything in it is ticked. ⏳ To confirm with the
 * client (open question 15): whether add-ons count separately, and whether a
 * "half eaten" choice is wanted.
 */
export interface SlotEntry {
  optionCodes: string[];
  kcal: number;
  proteinG: number;
}

export interface DayTotals {
  kcal: number;
  proteinG: number;
  slotsEaten: number;
}

/** What one slot adds, given what was ticked in it. */
export function slotIntake(slot: Pick<MealSlot, 'kcal' | 'proteinG'>, optionCodes: string[]): { kcal: number; proteinG: number } {
  return optionCodes.length ? { kcal: slot.kcal, proteinG: slot.proteinG } : { kcal: 0, proteinG: 0 };
}

export function dayTotals(entries: SlotEntry[]): DayTotals {
  const eaten = entries.filter((e) => e.optionCodes.length);
  return {
    kcal: round1(eaten.reduce((sum, e) => sum + e.kcal, 0)),
    proteinG: round1(eaten.reduce((sum, e) => sum + e.proteinG, 0)),
    slotsEaten: eaten.length,
  };
}

/** Whole percent of target, for the progress bar; null with no target. */
export function percentOf(value: number, target: number): number | null {
  return target > 0 ? Math.round((value / target) * 100) : null;
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * A doctor's edit of a patient's plan: slots and options with unique codes,
 * an English name for each, sensible numbers, and at least one main option
 * per slot.
 */
export function checkPlan(slots: MealSlot[] | undefined, targets: DietTargets | undefined): ErrorDetail[] {
  const details: ErrorDetail[] = [];
  if (targets) {
    if (!(targets.kcal >= 500 && targets.kcal <= 6000)) {
      details.push({ field: 'targets.kcal', code: DETAIL_CODES.OUT_OF_RANGE, issue: 'must be 500-6000 kcal' });
    }
    if (!(targets.proteinG >= 10 && targets.proteinG <= 300)) {
      details.push({ field: 'targets.proteinG', code: DETAIL_CODES.OUT_OF_RANGE, issue: 'must be 10-300 g' });
    }
  }
  if (!slots) return details;

  const slotCodes = new Set<string>();
  slots.forEach((slot, i) => {
    const at = `slots[${i}]`;
    if (slotCodes.has(slot.code)) details.push({ field: `${at}.code`, code: DETAIL_CODES.WRONG_SHAPE, issue: `"${slot.code}" is used twice` });
    slotCodes.add(slot.code);
    if (!(slot.kcal >= 0 && slot.kcal <= 3000)) details.push({ field: `${at}.kcal`, code: DETAIL_CODES.OUT_OF_RANGE, issue: 'must be 0-3000' });
    if (!(slot.proteinG >= 0 && slot.proteinG <= 200)) details.push({ field: `${at}.proteinG`, code: DETAIL_CODES.OUT_OF_RANGE, issue: 'must be 0-200' });

    const optionCodes = new Set<string>();
    slot.options.forEach((option, j) => {
      if (optionCodes.has(option.code)) {
        details.push({ field: `${at}.options[${j}].code`, code: DETAIL_CODES.WRONG_SHAPE, issue: `"${option.code}" is used twice in this slot` });
      }
      optionCodes.add(option.code);
    });
    if (!slot.options.some((o) => o.kind === OPTION_KINDS.OPTION)) {
      details.push({ field: `${at}.options`, code: DETAIL_CODES.REQUIRED, issue: 'needs at least one main option (not only add-ons)' });
    }
  });
  return details;
}
