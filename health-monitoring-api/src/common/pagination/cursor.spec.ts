import { ValidationFailedException } from '../api.exception';
import { decodeCursor, encodeCursor } from './cursor';

const ID = '6700aa01e4b0f1a2b3c4d5e6';
const raw = (payload: unknown) => Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');

describe('decodeCursor', () => {
  it('round-trips what encodeCursor produced', () => {
    expect(decodeCursor(encodeCursor({ k: '2026-10-09', id: ID }), 'date')).toEqual({ k: '2026-10-09', id: ID });
    const at = '2026-10-09T01:35:00.000Z';
    expect(decodeCursor(encodeCursor({ k: at, id: ID }), 'timestamp')).toEqual({ k: at, id: ID });
  });

  // Each of these used to reach new Types.ObjectId / new Date in a query and come back as 500.
  it.each([
    ['garbage', 'date'],
    [raw({ k: '2026-10-09', id: 'zzz' }), 'date'],
    [raw({ k: '2026-02-30', id: ID }), 'date'],
    [raw({ k: 'garbage', id: ID }), 'timestamp'],
    [raw({ k: 7, id: ID }), 'timestamp'],
  ] as const)('rejects %s as a %s cursor with 400', (cursor, kind) => {
    expect(() => decodeCursor(cursor, kind)).toThrow(ValidationFailedException);
  });
});
