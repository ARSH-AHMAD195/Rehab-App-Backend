import request from 'supertest';
import { DateTime } from 'luxon';
import { ERROR_CODES, DETAIL_CODES, DAY_STATUS, READING_STATUS } from '../src/common/constants';
import { EVENT_TYPES } from '../src/common/constants';
import { UsersService } from '../src/users/users.service';
import { DailyLogsService } from '../src/daily-logs/daily-logs.service';
import { TestContext, TestUser, createTestApp } from './helpers/test-app';

const ZONE = 'Asia/Kolkata';
const today = () => DateTime.now().setZone(ZONE).toISODate()!;

describe('Patient vitals (v1.1 /me/vitals)', () => {
  let ctx: TestContext;
  let patient: TestUser;
  let doctor: TestUser;
  let http: () => request.Agent;

  beforeAll(async () => {
    ctx = await createTestApp();
    http = () => request(ctx.app.getHttpServer());
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await ctx.reset();
    doctor = await ctx.createUser({ uid: 'doc-1', role: 'DOCTOR', name: 'Dr Meera Nair' });
    patient = await ctx.createUser({
      uid: 'pat-1',
      role: 'PATIENT',
      name: 'Rajesh Iyer',
      timeZone: ZONE,
      doctorIds: [doctor.id],
    });
  });

  const asPatient = (method: 'get' | 'put', path: string) =>
    http()[method](path).set('Authorization', `Bearer ${ctx.token(patient)}`);

  describe('GET /vital-types', () => {
    it('returns all 13 parameters with their ranges', async () => {
      const res = await asPatient('get', '/api/v1/vital-types').expect(200);

      expect(res.body.data).toHaveLength(13);
      const bp = res.body.data.find((d: { type: string }) => d.type === 'BP');
      expect(bp).toMatchObject({
        type: 'BP',
        unit: 'mmHg',
        valueKind: 'pair',
        version: 1,
        fields: {
          systolic: { minValid: 60, maxValid: 260 },
          diastolic: { minValid: 30, maxValid: 160 },
        },
      });
      expect(bp.minValid).toBeUndefined();

      const spo2 = res.body.data.find((d: { type: string }) => d.type === 'SPO2');
      expect(spo2).toMatchObject({ unit: '%', valueKind: 'numeric', minValid: 50, maxValid: 100 });

      const sugar = res.body.data.find((d: { type: string }) => d.type === 'SUGAR');
      expect(sugar.isOptional).toBe(true);
    });

    it('rejects a missing or bad token with UNAUTHENTICATED', async () => {
      await http().get('/api/v1/vital-types').expect(401);
      const res = await http()
        .get('/api/v1/vital-types')
        .set('Authorization', 'Bearer invalid')
        .expect(401);
      expect(res.body.code).toBe(ERROR_CODES.UNAUTHENTICATED);
    });

    it('returns the request id it was given', async () => {
      const res = await asPatient('get', '/api/v1/vital-types')
        .set('X-Request-Id', 'req-abc')
        .expect(200);
      expect(res.headers['x-request-id']).toBe('req-abc');
    });
  });

  describe('GET /me/vitals/today', () => {
    it('shows every parameter as NOT_YET before anything is logged', async () => {
      const res = await asPatient('get', '/api/v1/me/vitals/today').expect(200);

      expect(res.body).toMatchObject({
        date: today(),
        timeZone: ZONE,
        dayStatus: DAY_STATUS.NOT_STARTED,
        filledCount: 0,
        totalCount: 14,
      });
      expect(Object.keys(res.body.readings)).toHaveLength(13);
      expect(res.body.readings.PULSE).toEqual({
        value: null,
        unit: 'bpm',
        status: READING_STATUS.NOT_YET,
        loggedAt: null,
      });
    });

    it('does not create the log just by reading it', async () => {
      await asPatient('get', '/api/v1/me/vitals/today').expect(200);
      await expect(ctx.connection.collection('dailyLogs').countDocuments()).resolves.toBe(0);
    });

    it('is forbidden for a doctor', async () => {
      const res = await http()
        .get('/api/v1/me/vitals/today')
        .set('Authorization', `Bearer ${ctx.token(doctor)}`)
        .expect(403);
      expect(res.body.code).toBe(ERROR_CODES.FORBIDDEN_ROLE);
    });
  });

  describe('PUT /me/vitals/today', () => {
    it('saves a partial set of readings and counts the status', async () => {
      const res = await asPatient('put', '/api/v1/me/vitals/today')
        .send({
          date: today(),
          readings: { WEIGHT: { num: 56 }, STEPS: { num: 5000 }, PAIN: { num: 7 }, MOOD: { num: 4 } },
        })
        .expect(200);

      expect(res.body).toMatchObject({
        date: today(),
        dayStatus: DAY_STATUS.IN_PROGRESS,
        filledCount: 4,
        totalCount: 14,
        alerts: [],
      });
      expect(res.body.readings.WEIGHT).toMatchObject({
        value: { num: 56 },
        unit: 'kg',
        status: READING_STATUS.LOGGED,
      });
      // The server sets loggedAt, with the patient's offset.
      expect(res.body.readings.WEIGHT.loggedAt).toMatch(/\+05:30$/);
      // Mood level 4 is the one agreed label.
      expect(res.body.readings.MOOD.label).toBe('Good');
      expect(res.body.readings.PULSE.status).toBe(READING_STATUS.NOT_YET);
    });

    it('merges later saves instead of replacing the day', async () => {
      await asPatient('put', '/api/v1/me/vitals/today')
        .send({ date: today(), readings: { PULSE: { num: 76 } } })
        .expect(200);

      const res = await asPatient('put', '/api/v1/me/vitals/today')
        .send({ date: today(), readings: { BP: { systolic: 128, diastolic: 82 } } })
        .expect(200);

      expect(res.body.readings.PULSE.value).toEqual({ num: 76 });
      expect(res.body.readings.BP.value).toEqual({ systolic: 128, diastolic: 82 });
      // BP counts as two fields, plus pulse.
      expect(res.body.filledCount).toBe(3);
      await expect(ctx.connection.collection('dailyLogs').countDocuments()).resolves.toBe(1);
    });

    it('replaces a value rather than adding a second reading', async () => {
      await asPatient('put', '/api/v1/me/vitals/today')
        .send({ date: today(), readings: { PULSE: { num: 76 } } })
        .expect(200);
      const res = await asPatient('put', '/api/v1/me/vitals/today')
        .send({ date: today(), readings: { PULSE: { num: 90 } } })
        .expect(200);

      expect(res.body.readings.PULSE.value).toEqual({ num: 90 });
      expect(res.body.filledCount).toBe(1);
    });

    it('is idempotent: an identical re-send changes nothing', async () => {
      const body = { date: today(), readings: { PAIN: { num: 7 } } };
      const first = await asPatient('put', '/api/v1/me/vitals/today').send(body).expect(200);
      const second = await asPatient('put', '/api/v1/me/vitals/today').send(body).expect(200);

      // Same loggedAt, so the value was not re-stamped.
      expect(second.body.readings.PAIN.loggedAt).toBe(first.body.readings.PAIN.loggedAt);
      // No second audit entry and no second event.
      await expect(
        ctx.connection.collection('auditLogs').countDocuments({ action: 'VITALS_VALUE_CHANGED' }),
      ).resolves.toBe(1);
      await expect(
        ctx.connection.collection('outboxEvents').countDocuments({ type: EVENT_TYPES.LOG_UPDATED }),
      ).resolves.toBe(1);
    });

    it('stays idempotent when a retry runs while the first request is still in flight', async () => {
      // Hold both requests after their first read of the log, so neither has seen the other's write.
      let arrived = 0;
      let release!: () => void;
      const bothRead = new Promise<void>((resolve) => (release = resolve));
      const users = ctx.app.get(UsersService);
      const doctorIdsForPatient = users.doctorIdsForPatient.bind(users);
      const spy = jest.spyOn(users, 'doctorIdsForPatient').mockImplementation(async (id) => {
        if (++arrived === 2) release();
        await Promise.race([bothRead, new Promise((resolve) => setTimeout(resolve, 2000))]);
        return doctorIdsForPatient(id);
      });

      try {
        const body = { date: today(), readings: { PULSE: { num: 76 } } };
        const [first, second] = await Promise.all([
          asPatient('put', '/api/v1/me/vitals/today').send(body),
          asPatient('put', '/api/v1/me/vitals/today').send(body),
        ]);
        expect([first.status, second.status]).toEqual([200, 200]);
        expect(second.body.readings.PULSE.loggedAt).toBe(first.body.readings.PULSE.loggedAt);
      } finally {
        spy.mockRestore();
      }

      await expect(
        ctx.connection.collection('auditLogs').countDocuments({ action: 'VITALS_VALUE_CHANGED' }),
      ).resolves.toBe(1);
      await expect(
        ctx.connection.collection('outboxEvents').countDocuments({ type: EVENT_TYPES.LOG_UPDATED }),
      ).resolves.toBe(1);
    });

    describe('with an Idempotency-Key', () => {
      const saveWithKey = (key: string, readings: Record<string, unknown>) =>
        asPatient('put', '/api/v1/me/vitals/today').set('Idempotency-Key', key).send({ date: today(), readings });
      const count = (collection: string, filter: object) =>
        ctx.connection.collection(collection).countDocuments(filter);

      it('a retry after a timeout gets the first answer back and is not saved again', async () => {
        const first = await saveWithKey('save-1', { PULSE: { num: 76 } }).expect(200);
        // Another save changes the value in between, so a re-applied retry would show.
        await asPatient('put', '/api/v1/me/vitals/today')
          .send({ date: today(), readings: { PULSE: { num: 80 } } })
          .expect(200);

        const retry = await saveWithKey('save-1', { PULSE: { num: 76 } }).expect(200);

        expect(retry.body).toEqual(first.body);
        const log = await ctx.connection.collection('dailyLogs').findOne({});
        expect(log!.readings.PULSE.value).toEqual({ num: 80 });
        await expect(count('auditLogs', { action: 'VITALS_VALUE_CHANGED' })).resolves.toBe(2);
      });

      it('two requests with the same key at once: one saves, the other is told to retry', async () => {
        // A slow save keeps the first request running while the second arrives.
        const logs = ctx.app.get(DailyLogsService);
        const save = logs.save.bind(logs);
        const spy = jest.spyOn(logs, 'save').mockImplementation(async (...args) => {
          await new Promise((resolve) => setTimeout(resolve, 300));
          return save(...args);
        });
        let a: request.Response;
        let b: request.Response;
        try {
          [a, b] = await Promise.all([
            saveWithKey('save-2', { PAIN: { num: 4 } }),
            saveWithKey('save-2', { PAIN: { num: 4 } }),
          ]);
        } finally {
          spy.mockRestore();
        }

        expect([a.status, b.status].sort()).toEqual([200, 409]);
        const refused = a.status === 409 ? a : b;
        expect(refused.body.code).toBe(ERROR_CODES.IDEMPOTENCY_KEY_IN_USE);
        await expect(count('auditLogs', { action: 'VITALS_VALUE_CHANGED' })).resolves.toBe(1);
        await expect(count('outboxEvents', { type: EVENT_TYPES.LOG_UPDATED })).resolves.toBe(1);

        // Retrying once the first has finished returns its answer.
        const retry = await saveWithKey('save-2', { PAIN: { num: 4 } }).expect(200);
        expect(retry.body.readings.PAIN.value).toEqual({ num: 4 });
      });

      it('refuses the same key with a different body with 422', async () => {
        await saveWithKey('save-3', { PAIN: { num: 4 } }).expect(200);
        const res = await saveWithKey('save-3', { PAIN: { num: 9 } }).expect(422);
        expect(res.body.code).toBe(ERROR_CODES.IDEMPOTENCY_KEY_REUSED);
        await expect(count('auditLogs', { action: 'VITALS_VALUE_CHANGED' })).resolves.toBe(1);
      });

      it('a request that failed does not use up its key', async () => {
        await saveWithKey('save-4', { PAIN: { num: 99 } }).expect(400);
        await saveWithKey('save-4', { PAIN: { num: 4 } }).expect(200);
      });

      it('keys belong to one patient', async () => {
        const other = await ctx.createUser({ uid: 'pat-2', role: 'PATIENT', name: 'Anita', timeZone: ZONE });
        await saveWithKey('shared', { PAIN: { num: 4 } }).expect(200);
        await http()
          .put('/api/v1/me/vitals/today')
          .set('Authorization', `Bearer ${ctx.token(other)}`)
          .set('Idempotency-Key', 'shared')
          .send({ date: today(), readings: { PAIN: { num: 5 } } })
          .expect(200);
      });

      it('rejects an empty or over-long key', async () => {
        for (const key of [' ', 'x'.repeat(256)]) {
          const res = await saveWithKey(key, { PAIN: { num: 4 } }).expect(400);
          expect(res.body.details[0]).toMatchObject({ field: 'Idempotency-Key' });
        }
      });
    });

    it('clears a value with null and puts it back to NOT_YET', async () => {
      await asPatient('put', '/api/v1/me/vitals/today')
        .send({ date: today(), readings: { PAIN: { num: 7 }, PULSE: { num: 76 } } })
        .expect(200);

      const res = await asPatient('put', '/api/v1/me/vitals/today')
        .send({ date: today(), readings: { PAIN: null } })
        .expect(200);

      expect(res.body.readings.PAIN).toMatchObject({
        value: null,
        status: READING_STATUS.NOT_YET,
        loggedAt: null,
      });
      expect(res.body.filledCount).toBe(1);
    });

    it('refuses a date that is not the patient’s today with 409 DAY_CHANGED', async () => {
      const res = await asPatient('put', '/api/v1/me/vitals/today')
        .send({ date: '2026-10-01', readings: { PULSE: { num: 76 } } })
        .expect(409);

      expect(res.body).toMatchObject({ statusCode: 409, code: ERROR_CODES.DAY_CHANGED });
      // "the server returns 409 DAY_CHANGED and saves nothing"
      await expect(ctx.connection.collection('dailyLogs').countDocuments()).resolves.toBe(0);
    });

    it('rejects a date that is not on the calendar with 400, not DAY_CHANGED', async () => {
      const res = await asPatient('put', '/api/v1/me/vitals/today')
        .send({ date: '2026-02-30', readings: { PULSE: { num: 76 } } })
        .expect(400);
      expect(res.body.details).toEqual([
        { field: 'date', code: DETAIL_CODES.WRONG_SHAPE, issue: expect.any(String) },
      ]);
    });

    it('requires the date', async () => {
      const res = await asPatient('put', '/api/v1/me/vitals/today')
        .send({ readings: { PULSE: { num: 76 } } })
        .expect(400);
      expect(res.body.code).toBe(ERROR_CODES.VALIDATION_FAILED);
      expect(res.body.details.map((d: { field: string }) => d.field)).toContain('date');
    });

    it('rejects an empty readings object', async () => {
      const res = await asPatient('put', '/api/v1/me/vitals/today')
        .send({ date: today(), readings: {} })
        .expect(400);
      expect(res.body.details).toEqual([
        { field: 'readings', code: DETAIL_CODES.EMPTY_READINGS, issue: expect.any(String) },
      ]);
    });

    it('reports the failing field with a stable code', async () => {
      const res = await asPatient('put', '/api/v1/me/vitals/today')
        .send({ date: today(), readings: { BP: { systolic: 80, diastolic: 90 } } })
        .expect(400);

      expect(res.body).toMatchObject({
        statusCode: 400,
        code: ERROR_CODES.VALIDATION_FAILED,
        error: 'Bad Request',
      });
      expect(res.body.requestId).toBeTruthy();
      expect(res.body.details).toEqual([
        {
          field: 'readings.BP.systolic',
          code: DETAIL_CODES.BP_SYSTOLIC_NOT_ABOVE_DIASTOLIC,
          issue: 'must be greater than diastolic',
        },
      ]);
    });

    it('stores the unit and parameter version each value was saved under', async () => {
      await asPatient('put', '/api/v1/me/vitals/today')
        .send({ date: today(), readings: { TEMP: { num: 37.2 } } })
        .expect(200);

      const log = await ctx.connection.collection('dailyLogs').findOne({});
      expect(log!.readings.TEMP).toMatchObject({ unit: '°C', typeVersion: 1 });
    });

    it('queues one vitals.log.updated event per save, after the commit', async () => {
      await asPatient('put', '/api/v1/me/vitals/today')
        .send({ date: today(), readings: { PULSE: { num: 76 }, PAIN: { num: 3 } } })
        .expect(200);

      const events = await ctx.connection.collection('outboxEvents').find({}).toArray();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: EVENT_TYPES.LOG_UPDATED,
        schemaVersion: 1,
        status: 'PENDING',
        patientId: expect.anything(),
      });
      expect(events[0].data).toMatchObject({
        date: today(),
        changedTypes: ['PULSE', 'PAIN'],
        filledCount: 2,
        dayStatus: DAY_STATUS.IN_PROGRESS,
      });
    });

    it('audits the change with the old and new value', async () => {
      await asPatient('put', '/api/v1/me/vitals/today')
        .send({ date: today(), readings: { PAIN: { num: 3 } } })
        .expect(200);
      await asPatient('put', '/api/v1/me/vitals/today')
        .set('X-Request-Id', 'req-edit')
        .send({ date: today(), readings: { PAIN: { num: 8 } } })
        .expect(200);

      const entries = await ctx.connection
        .collection('auditLogs')
        .find({ action: 'VITALS_VALUE_CHANGED' })
        .sort({ at: 1 })
        .toArray();

      expect(entries).toHaveLength(2);
      expect(entries[1]).toMatchObject({
        actorRole: 'PATIENT',
        route: 'PUT /api/v1/me/vitals/today',
        requestId: 'req-edit',
        before: { PAIN: { num: 3 } },
        after: { PAIN: { num: 8 } },
      });
    });
  });

  describe('GET /me/vitals/logs', () => {
    it('returns saved days newest first and leaves empty days out', async () => {
      await asPatient('put', '/api/v1/me/vitals/today')
        .send({ date: today(), readings: { PULSE: { num: 76 } } })
        .expect(200);
      // A day the patient filled in earlier.
      await seedPastLog(ctx, patient.id, DateTime.now().setZone(ZONE).minus({ days: 3 }).toISODate()!);

      const res = await asPatient('get', '/api/v1/me/vitals/logs').expect(200);

      expect(res.body.data.map((log: { date: string }) => log.date)).toEqual([
        today(),
        DateTime.now().setZone(ZONE).minus({ days: 3 }).toISODate(),
      ]);
      expect(res.body.nextCursor).toBeNull();
      // Same shape as today's log.
      expect(Object.keys(res.body.data[0].readings)).toHaveLength(13);
    });

    it('pages with a cursor', async () => {
      for (let i = 1; i <= 3; i++) {
        await seedPastLog(ctx, patient.id, DateTime.now().setZone(ZONE).minus({ days: i }).toISODate()!);
      }

      const first = await asPatient('get', '/api/v1/me/vitals/logs?limit=2').expect(200);
      expect(first.body.data).toHaveLength(2);
      expect(first.body.nextCursor).toBeTruthy();

      const second = await asPatient(
        'get',
        `/api/v1/me/vitals/logs?limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`,
      ).expect(200);
      expect(second.body.data).toHaveLength(1);
      expect(second.body.nextCursor).toBeNull();
    });

    it('rejects from/to that are not on the calendar', async () => {
      const res = await asPatient('get', '/api/v1/me/vitals/logs?from=2026-99-01&to=2026-99-30').expect(400);
      expect(res.body.details.map((d: { field: string }) => d.field).sort()).toEqual(['from', 'to']);
    });

    it('400, not 500, for a well-formed cursor with a bad id', async () => {
      const forged = Buffer.from(JSON.stringify({ k: today(), id: 'zzz' })).toString('base64url');
      const res = await asPatient('get', `/api/v1/me/vitals/logs?cursor=${forged}`).expect(400);
      expect(res.body.details[0]).toMatchObject({ field: 'cursor', code: DETAIL_CODES.WRONG_SHAPE });
    });

    it('rejects from after to, and a limit above 100', async () => {
      const bad = await asPatient('get', '/api/v1/me/vitals/logs?from=2026-10-10&to=2026-10-01').expect(400);
      expect(bad.body.details[0]).toMatchObject({ field: 'from', code: DETAIL_CODES.OUT_OF_RANGE });

      const tooBig = await asPatient('get', '/api/v1/me/vitals/logs?limit=500').expect(400);
      expect(tooBig.body.details[0]).toMatchObject({ field: 'limit', code: DETAIL_CODES.OUT_OF_RANGE });
    });
  });

  describe('GET /me/vitals/trends', () => {
    it('returns one value per day with gaps as null', async () => {
      const zone = DateTime.now().setZone(ZONE);
      await seedPastLog(ctx, patient.id, zone.minus({ days: 2 }).toISODate()!, { PULSE: 78 });
      await asPatient('put', '/api/v1/me/vitals/today')
        .send({ date: today(), readings: { PULSE: { num: 76 } } })
        .expect(200);

      const res = await asPatient('get', '/api/v1/me/vitals/trends?type=PULSE&period=7d').expect(200);

      expect(res.body).toMatchObject({ type: 'PULSE', unit: 'bpm', period: '7d' });
      expect(res.body.labels).toHaveLength(7);
      expect(res.body.labels[6]).toBe(today());
      expect(res.body.values[6]).toBe(76);
      expect(res.body.values[4]).toBe(78);
      expect(res.body.values[5]).toBeNull();
      // No limits are configured, so there is nothing to draw.
      expect(res.body.thresholds).toBeNull();
    });

    it('splits BP into two series with a threshold entry per field', async () => {
      await asPatient('put', '/api/v1/me/vitals/today')
        .send({ date: today(), readings: { BP: { systolic: 128, diastolic: 82 } } })
        .expect(200);

      const res = await asPatient('get', '/api/v1/me/vitals/trends?type=BP&period=7d').expect(200);

      expect(res.body.values).toBeUndefined();
      expect(res.body.systolic[6]).toBe(128);
      expect(res.body.diastolic[6]).toBe(82);
      expect(res.body.thresholds).toEqual({ systolic: null, diastolic: null });
    });

    it('defaults to 30 days', async () => {
      const res = await asPatient('get', '/api/v1/me/vitals/trends?type=WEIGHT').expect(200);
      expect(res.body.period).toBe('30d');
      expect(res.body.labels).toHaveLength(30);
    });

    it('refuses NUTRITION and unknown parameters', async () => {
      const nutrition = await asPatient('get', '/api/v1/me/vitals/trends?type=NUTRITION').expect(400);
      expect(nutrition.body.code).toBe(ERROR_CODES.VALIDATION_FAILED);

      const unknown = await asPatient('get', '/api/v1/me/vitals/trends?type=HEIGHT').expect(400);
      expect(unknown.body.details[0]).toMatchObject({ code: DETAIL_CODES.UNKNOWN_TYPE });
    });

    it('requires the type', async () => {
      await asPatient('get', '/api/v1/me/vitals/trends').expect(400);
    });
  });
});

/** A past day, written straight to the collection: the API only writes today. */
async function seedPastLog(
  ctx: TestContext,
  patientId: string,
  date: string,
  values: Record<string, number> = { PULSE: 80 },
): Promise<void> {
  const { Types } = await import('mongoose');
  const readings = Object.fromEntries(
    Object.entries(values).map(([type, num]) => [
      type,
      {
        value: { num },
        unit: 'bpm',
        typeVersion: 1,
        status: READING_STATUS.LOGGED,
        loggedAt: new Date(`${date}T07:05:00Z`),
      },
    ]),
  );

  await ctx.connection.collection('dailyLogs').insertOne({
    patientId: new Types.ObjectId(patientId),
    date,
    timeZone: ZONE,
    readings,
    filledCount: Object.keys(values).length,
    totalCount: 14,
    dayStatus: DAY_STATUS.IN_PROGRESS,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}
