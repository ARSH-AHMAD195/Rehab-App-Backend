import { DAY_STATUS, DayStatus, READING_STATUS, VALUE_KINDS } from '../common/constants';
import { VitalTypeDef } from '../vital-types/vital-type.schema';
import { StoredReading } from './daily-log.schema';

export interface LogStatus {
  filledCount: number;
  totalCount: number;
  dayStatus: DayStatus;
}

/**
 * Status, v1.1:
 *   filledCount - fields filled today; BP upper and lower count separately
 *   totalCount  - fields of the parameters where onForm is true (14 when all)
 *   dayStatus   - NOT_STARTED, IN_PROGRESS or COMPLETE: 0 filled, some
 *                 filled, or all fields filled
 *
 * Stored with the log so the app can show "Not yet" and "9 of 14 logged"
 * without working it out itself.
 *
 * Open question (v1.1): blood sugar is optional, so whether a day can be
 * COMPLETE at 12 of 14 is undecided. Until it is, COMPLETE means every field
 * on the form is filled, exactly as the Status table states.
 */
export function computeStatus(
  readings: Record<string, StoredReading>,
  defs: VitalTypeDef[],
): LogStatus {
  let filledCount = 0;
  let totalCount = 0;

  for (const def of defs) {
    if (!def.onForm) continue;

    const fields = def.valueKind === VALUE_KINDS.PAIR ? (def.fields?.size ?? 2) : 1;
    totalCount += fields;

    if (readings[def.type]?.status === READING_STATUS.LOGGED) filledCount += fields;
  }

  return { filledCount, totalCount, dayStatus: dayStatusOf(filledCount, totalCount) };
}

function dayStatusOf(filledCount: number, totalCount: number): DayStatus {
  if (filledCount === 0) return DAY_STATUS.NOT_STARTED;
  if (filledCount >= totalCount) return DAY_STATUS.COMPLETE;
  return DAY_STATUS.IN_PROGRESS;
}
