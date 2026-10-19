import { ValidationFailedException } from '../api.exception';
import { decodeCursor, encodeCursor } from './cursor';

describe('cursor', () => {
  it('round-trips', () => {
    const payload = { k: 'seated knee extension', id: '6712a0b1c2d3e4f5a6b7c8d9' };
    expect(decodeCursor(encodeCursor(payload))).toEqual(payload);
  });

  it.each([
    ['not base64 json', 'abc'],
    ['missing id', encodeCursor({ k: 'a' } as never)],
    ['id is not an ObjectId', encodeCursor({ k: 'a', id: 'nope' })],
    ['k is not a string', Buffer.from(JSON.stringify({ k: 5, id: '6712a0b1c2d3e4f5a6b7c8d9' })).toString('base64url')],
  ])('rejects %s as a 400, not a 500', (_label, cursor) => {
    expect(() => decodeCursor(cursor)).toThrow(ValidationFailedException);
  });
});
