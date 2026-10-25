import { DETAIL_CODES } from '../constants';
import { ValidationFailedException } from '../api.exception';

const OBJECT_ID = /^[0-9a-f]{24}$/i;

/**
 * Opaque cursor for the pagination convention shared with Health Monitoring
 * (?limit=20&cursor=..., lists return { data, nextCursor }).
 *
 * Keyset pagination, not skip/limit: pages stay stable while records are added.
 */
export interface CursorPayload {
  /** Primary sort value, e.g. an exercise's lower-cased name. */
  k: string;
  /** Document id, to break ties deterministically. */
  id: string;
}

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/** Callers put `id` straight into a query as an ObjectId, which throws (a 500) on anything else. */
export function decodeCursor(cursor: string, field = 'cursor'): CursorPayload {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof parsed?.k !== 'string' || typeof parsed?.id !== 'string' || !OBJECT_ID.test(parsed.id)) {
      throw new Error('shape');
    }
    return parsed;
  } catch {
    throw new ValidationFailedException([
      { field, code: DETAIL_CODES.WRONG_SHAPE, issue: 'is not a cursor returned by this API' },
    ]);
  }
}
