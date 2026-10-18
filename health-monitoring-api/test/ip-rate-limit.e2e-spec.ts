import request from 'supertest';
import { ERROR_CODES, RATE_LIMITS } from '../src/common/constants';
import { TestContext, createTestApp } from './helpers/test-app';

/**
 * Rate limits, v1.1: "Any route, by IP address - 300 requests per minute."
 *
 * This guard runs before authentication, so the limit applies to callers who
 * never present a usable token. Its own app instance, because the per-IP
 * counter is process-wide and would otherwise be spent by other suites.
 */
describe('Per-IP rate limit (v1.1)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('blocks by address before the token is checked', async () => {
    const call = () =>
      request(ctx.app.getHttpServer())
        .get('/api/v1/vital-types')
        .set('Authorization', 'Bearer invalid');

    const statuses: number[] = [];
    for (let i = 0; i < RATE_LIMITS.IP.limit; i++) {
      statuses.push((await call()).status);
    }

    // Up to the limit, each request is rejected by the auth guard: the IP
    // guard let it through, so authentication is still what answers.
    expect(new Set(statuses)).toEqual(new Set([401]));

    const blocked = await call();
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({
      statusCode: 429,
      code: ERROR_CODES.RATE_LIMITED,
      error: 'Too Many Requests',
    });
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  });
});
