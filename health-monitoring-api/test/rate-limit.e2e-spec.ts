import request from 'supertest';
import { DateTime } from 'luxon';
import { ERROR_CODES, RATE_LIMITS } from '../src/common/constants';
import { TestContext, TestUser, createTestApp } from './helpers/test-app';

const ZONE = 'Asia/Kolkata';
const today = () => DateTime.now().setZone(ZONE).toISODate()!;

/**
 * Rate limits, v1.1: PUT /me/vitals/today is 30 requests per minute per user,
 * all other routes 120 per user, and a 429 carries Retry-After in seconds.
 */
describe('Rate limits (v1.1)', () => {
  let ctx: TestContext;
  let patient: TestUser;

  beforeAll(async () => {
    ctx = await createTestApp();
    patient = await ctx.createUser({
      uid: 'pat-rate',
      role: 'PATIENT',
      name: 'Rajesh Iyer',
      timeZone: ZONE,
    });
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('allows 30 saves a minute and then returns 429 with Retry-After', async () => {
    const save = (pulse: number) =>
      request(ctx.app.getHttpServer())
        .put('/api/v1/me/vitals/today')
        .set('Authorization', `Bearer ${ctx.token(patient)}`)
        // A changing value, so none of these is skipped as unchanged.
        .send({ date: today(), readings: { PULSE: { num: pulse } } });

    const statuses: number[] = [];
    for (let i = 0; i < RATE_LIMITS.WRITE.limit; i++) {
      statuses.push((await save(60 + i)).status);
    }
    expect(statuses.every((status) => status === 200)).toBe(true);

    const blocked = await save(199);
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({ statusCode: 429, code: ERROR_CODES.RATE_LIMITED });
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('keeps the wider limit on read routes', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get('/api/v1/me/vitals/today')
      .set('Authorization', `Bearer ${ctx.token(patient)}`)
      .expect(200);

    // The reads are counted against the 120/min bucket, not the save bucket.
    expect(Number(res.headers['x-ratelimit-limit-user'])).toBe(RATE_LIMITS.USER.limit);
  });
});
