import { DETAIL_CODES } from '../constants';
import { ValidationFailedException } from '../api.exception';
import { DateTime } from 'luxon';
import { isCalendarDate } from '../../time/day.service';

const OBJECT_ID = /^[0-9a-f]{24}$/i;
const isTimestamp = (value: unknown) => typeof value === 'string' && DateTime.fromISO(value).isValid;

/**
 * Opaque cursor for the v1.1 pagination convention
 * (?limit=20&cursor=..., lists return { data, nextCursor }).
 *
 * Keyset pagination, not skip/limit: pages stay stable while new logs and
 * alerts arrive.
 */
export interface CursorPayload {
  /** Primary sort value: a local date (logs) or an ISO timestamp (alerts). */
  k: string;
  /** Document id, to break ties deterministically. */
  id: string;
}

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/**
 * Callers put `k` and `id` straight into a query as a Date / ObjectId, which
 * throws (a 500) on anything else - so both are checked here, against the kind
 * of sort key the caller's list uses.
 */
export function decodeCursor(cursor: string, kind: 'date' | 'timestamp', field = 'cursor'): CursorPayload {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    const validKey = kind === 'date' ? isCalendarDate(parsed?.k) : isTimestamp(parsed?.k);
    if (!validKey || typeof parsed?.id !== 'string' || !OBJECT_ID.test(parsed.id)) throw new Error('shape');
    return parsed;
  } catch {
    throw new ValidationFailedException([
      { field, code: DETAIL_CODES.WRONG_SHAPE, issue: 'is not a cursor returned by this API' },
    ]);
  }
}
