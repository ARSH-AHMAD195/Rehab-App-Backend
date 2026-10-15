import { DETAIL_CODES } from '../constants';
import { ValidationFailedException } from '../api.exception';

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

export function decodeCursor(cursor: string, field = 'cursor'): CursorPayload {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof parsed?.k !== 'string' || typeof parsed?.id !== 'string') throw new Error('shape');
    return parsed;
  } catch {
    throw new ValidationFailedException([
      { field, code: DETAIL_CODES.WRONG_SHAPE, issue: 'is not a cursor returned by this API' },
    ]);
  }
}
