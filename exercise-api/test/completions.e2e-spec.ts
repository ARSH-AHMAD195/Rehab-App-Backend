import request from 'supertest';
import { DateTime } from 'luxon';
import { Types } from 'mongoose';
import { DETAIL_CODES, ERROR_CODES } from '../src/common/constants';
import { TestContext, TestUser, createTestApp } from './helpers/test-app';

const ZONE = 'Asia/Kolkata';
const now = () => DateTime.now().setZone(ZONE);
const today = () => now().toISODate()!;
const daysAgo = (n: number) => now().minus({ days: n }).toISODate()!;
const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7];

describe('Checklist, completions and history', () => {
  let ctx: TestContext;
  let admin: TestUser;
  let doctor: TestUser;
  let otherDoctor: TestUser;
  let patient: TestUser;
  let otherPatient: TestUser;
  let kneeId: string;
  let walkId: string;
  let breathId: string;

  const http = () => request(ctx.app.getHttpServer());
  const as = (user: TestUser) => ({
    get: (path: string) => http().get(`/api/v1${path}`).set('Authorization', `Bearer ${ctx.token(user)}`),
    put: (path: string) => http().put(`/api/v1${path}`).set('Authorization', `Bearer ${ctx.token(user)}`),
    post: (path: string) => http().post(`/api/v1${path}`).set('Authorization', `Bearer ${ctx.token(user)}`),
    delete: (path: string) => http().delete(`/api/v1${path}`).set('Authorization', `Bearer ${ctx.token(user)}`),
  });

  const addExercise = async (name: string, code: string) => {
    const category = await ctx.connection.collection('exerciseCategories').findOne({ code });
    const res = await as(admin).post('/exercises').send({ name, categoryId: String(category!._id) }).expect(201);
    return res.body.id as string;
  };

  /** Saves a plan for `patient` and returns its itemIds by exercise id. */
  const assign = async (version: number, items: { exerciseId: string; days?: number[]; times?: number }[]) => {
    const res = await as(doctor)
      .put(`/patients/${patient.id}/exercise-plan`)
      .send({
        version,
        items: items.map((i) => ({
          exerciseId: i.exerciseId,
          schedule: { daysOfWeek: i.days ?? EVERY_DAY, timesPerDay: i.times ?? 1 },
        })),
      })
      .expect(200);
    return Object.fromEntries(
      res.body.items.map((i: { itemId: string; exercise: { id: string } }) => [i.exercise.id, i.itemId]),
    ) as Record<string, string>;
  };

  const tick = (itemId: string, extra: Record<string, unknown> = {}, by: TestUser = patient) =>
    as(by).post('/exercise-completions').send({ itemId, date: today(), ...extra });

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await ctx.reset();
    admin = await ctx.createUser({ uid: 'adm-1', role: 'ADMIN', name: 'Platform Admin' });
    doctor = await ctx.createUser({ uid: 'doc-1', role: 'DOCTOR', name: 'Dr Meera Nair' });
    otherDoctor = await ctx.createUser({ uid: 'doc-2', role: 'DOCTOR', name: 'Dr Arjun Rao' });
    patient = await ctx.createUser({ uid: 'pat-1', role: 'PATIENT', name: 'Rajesh Iyer', timeZone: ZONE, doctorIds: [doctor.id] });
    otherPatient = await ctx.createUser({ uid: 'pat-2', role: 'PATIENT', name: 'Anita Shah', timeZone: ZONE, doctorIds: [doctor.id] });
    kneeId = await addExercise('Seated knee extension', 'STRENGTH');
    walkId = await addExercise('Brisk walk', 'WALKING');
    breathId = await addExercise('Deep breathing', 'BREATHING');
  });

  describe("today's checklist", () => {
    it('is empty before any plan', async () => {
      const res = await as(patient).get('/patients/me/exercise-checklist').expect(200);
      expect(res.body).toEqual({ date: today(), planVersion: 0, items: [], doneCount: 0, plannedCount: 0 });
    });

    it("lists only what is planned for today's day of the week", async () => {
      const notToday = EVERY_DAY.filter((d) => d !== now().weekday);
      const ids = await assign(0, [
        { exerciseId: kneeId, times: 2 },
        { exerciseId: walkId },
        { exerciseId: breathId, days: notToday },
      ]);

      const res = await as(patient).get('/patients/me/exercise-checklist').expect(200);
      expect(res.body).toMatchObject({ date: today(), planVersion: 1, doneCount: 0, plannedCount: 3 });
      expect(res.body.items).toEqual([
        expect.objectContaining({
          itemId: ids[kneeId],
          exercise: expect.objectContaining({ id: kneeId, name: 'Seated knee extension' }),
          timesPerDay: 2,
          doneCount: 0,
          status: 'NOT_YET',
          completions: [],
        }),
        expect.objectContaining({ itemId: ids[walkId], timesPerDay: 1, status: 'NOT_YET' }),
      ]);
    });
  });

  describe('ticking an exercise off', () => {
    it('records it, moves the checklist on, and audits it', async () => {
      const ids = await assign(0, [{ exerciseId: kneeId, times: 2 }]);

      const first = await tick(ids[kneeId], { details: { durationMin: 10, note: ' Felt fine ' } }).expect(201);
      expect(first.body).toMatchObject({
        itemId: ids[kneeId],
        exercise: { id: kneeId, name: 'Seated knee extension', category: 'STRENGTH' },
        planVersion: 1,
        date: today(),
        details: { durationMin: 10, note: 'Felt fine' },
      });
      expect(first.body.completedAt).toMatch(/\+05:30$/);

      let checklist = await as(patient).get('/patients/me/exercise-checklist').expect(200);
      expect(checklist.body.items[0]).toMatchObject({ doneCount: 1, status: 'PARTLY_DONE', completions: [{ id: first.body.id }] });

      await tick(ids[kneeId]).expect(201);
      checklist = await as(patient).get('/patients/me/exercise-checklist').expect(200);
      expect(checklist.body).toMatchObject({ doneCount: 2, plannedCount: 2 });
      expect(checklist.body.items[0]).toMatchObject({ doneCount: 2, status: 'DONE' });

      const audit = await ctx.connection.collection('auditLogs').findOne({ resourceId: first.body.id });
      expect(audit).toMatchObject({ action: 'EXERCISE_COMPLETION_RECORDED', actorRole: 'PATIENT' });
      const events = await ctx.connection.collection('exerciseOutboxEvents').find({ type: 'exercise.completed' }).toArray();
      expect(events).toHaveLength(2);
      expect(events[0].data).toMatchObject({ completionId: first.body.id, itemId: ids[kneeId], date: today() });
    });

    it('refuses more than the planned number of times', async () => {
      const ids = await assign(0, [{ exerciseId: kneeId }]);
      await tick(ids[kneeId]).expect(201);

      const again = await tick(ids[kneeId]).expect(409);
      expect(again.body.code).toBe(ERROR_CODES.EXERCISE_ALREADY_DONE);
      expect(await ctx.connection.collection('exerciseCompletions').countDocuments()).toBe(1);
    });

    it('counts a burst of taps on the last planned time only once', async () => {
      const ids = await assign(0, [{ exerciseId: kneeId }]);

      const results = await Promise.all(Array.from({ length: 5 }, () => tick(ids[kneeId])));
      const statuses = results.map((r) => r.status);
      expect(statuses.filter((s) => s === 201)).toHaveLength(1);
      expect(statuses.every((s) => s === 201 || s === 409)).toBe(true);
      expect(await ctx.connection.collection('exerciseCompletions').countDocuments({ active: true })).toBe(1);
    });

    it('refuses an item that is not in the current plan, or not planned today', async () => {
      const notToday = EVERY_DAY.filter((d) => d !== now().weekday);
      const ids = await assign(0, [{ exerciseId: kneeId }, { exerciseId: walkId, days: notToday }]);

      const unknown = await tick('no-such-item').expect(409);
      expect(unknown.body.code).toBe(ERROR_CODES.EXERCISE_NOT_IN_PLAN);

      const notPlannedToday = await tick(ids[walkId]).expect(409);
      expect(notPlannedToday.body).toMatchObject({ code: ERROR_CODES.EXERCISE_NOT_IN_PLAN, message: expect.stringMatching(/today/) });

      // Taken out of the plan by the doctor.
      await assign(1, [{ exerciseId: walkId }]);
      const removed = await tick(ids[kneeId]).expect(409);
      expect(removed.body.code).toBe(ERROR_CODES.EXERCISE_NOT_IN_PLAN);

      // Another patient's plan item is not this patient's.
      await tick(ids[walkId], {}, otherPatient).expect(409);
    });

    it('refuses a date that is not the patient’s today, and a malformed one', async () => {
      const ids = await assign(0, [{ exerciseId: kneeId }]);

      const yesterday = await tick(ids[kneeId], { date: daysAgo(1) }).expect(409);
      expect(yesterday.body.code).toBe(ERROR_CODES.DAY_CHANGED);

      const bad = await tick(ids[kneeId], { date: '2026-02-30' }).expect(400);
      expect(bad.body.details[0]).toMatchObject({ field: 'date', code: DETAIL_CODES.WRONG_SHAPE });

      await tick(ids[kneeId], { details: { durationMin: 0 } }).expect(400);
      await tick(ids[kneeId], { details: { pain: 3 } }).expect(400);
    });

    it('is for patients only', async () => {
      const ids = await assign(0, [{ exerciseId: kneeId }]);
      await tick(ids[kneeId], {}, doctor).expect(403);
      await tick(ids[kneeId], {}, admin).expect(403);
    });
  });

  describe('Idempotency-Key', () => {
    it('answers a retry with the first result and counts it once', async () => {
      const ids = await assign(0, [{ exerciseId: kneeId, times: 3 }]);

      const first = await tick(ids[kneeId]).set('Idempotency-Key', 'tap-1').expect(201);
      const retry = await tick(ids[kneeId]).set('Idempotency-Key', 'tap-1').expect(201);
      expect(retry.body).toEqual(first.body);
      expect(await ctx.connection.collection('exerciseCompletions').countDocuments()).toBe(1);

      // Without a key, each request is a new tick.
      await tick(ids[kneeId]).expect(201);
      await tick(ids[kneeId]).expect(201);
      expect(await ctx.connection.collection('exerciseCompletions').countDocuments()).toBe(3);
    });

    it('refuses a key reused for a different tick', async () => {
      const ids = await assign(0, [{ exerciseId: kneeId }, { exerciseId: walkId }]);
      await tick(ids[kneeId]).set('Idempotency-Key', 'tap-1').expect(201);

      const reused = await tick(ids[walkId]).set('Idempotency-Key', 'tap-1').expect(422);
      expect(reused.body.code).toBe(ERROR_CODES.IDEMPOTENCY_KEY_REUSED);
    });

    it('lets the same key be used again after a refused request', async () => {
      const ids = await assign(0, [{ exerciseId: kneeId }]);
      await tick(ids[kneeId], { date: daysAgo(1) }).set('Idempotency-Key', 'tap-1').expect(409);
      await tick(ids[kneeId], { date: daysAgo(1) }).set('Idempotency-Key', 'tap-1').expect(409);
    });
  });

  describe('undo', () => {
    it("takes back one of today's ticks, which can then be done again", async () => {
      const ids = await assign(0, [{ exerciseId: kneeId }]);
      const done = await tick(ids[kneeId]).expect(201);

      await as(patient).delete(`/exercise-completions/${done.body.id}`).expect(204);

      const checklist = await as(patient).get('/patients/me/exercise-checklist').expect(200);
      expect(checklist.body.items[0]).toMatchObject({ doneCount: 0, status: 'NOT_YET', completions: [] });
      await tick(ids[kneeId]).expect(201);

      // Kept, but no longer counted.
      const stored = await ctx.connection.collection('exerciseCompletions').findOne({ _id: new Types.ObjectId(done.body.id) });
      expect(stored).toMatchObject({ active: false });
      expect(stored!.undoneAt).toBeInstanceOf(Date);

      const audit = await ctx.connection.collection('auditLogs').findOne({ action: 'EXERCISE_COMPLETION_UNDONE' });
      expect(audit).toMatchObject({ resourceId: done.body.id, actorRole: 'PATIENT' });
      const event = await ctx.connection.collection('exerciseOutboxEvents').findOne({ type: 'exercise.completion.undone' });
      expect(event!.data).toMatchObject({ completionId: done.body.id });
    });

    it('404s a tick already undone, another patient’s tick, and a made-up id', async () => {
      const ids = await assign(0, [{ exerciseId: kneeId }]);
      const done = await tick(ids[kneeId]).expect(201);

      await as(otherPatient).delete(`/exercise-completions/${done.body.id}`).expect(404);
      await as(patient).delete(`/exercise-completions/${done.body.id}`).expect(204);
      await as(patient).delete(`/exercise-completions/${done.body.id}`).expect(404);
      await as(patient).delete('/exercise-completions/not-an-id').expect(404);
    });

    it('refuses to undo a tick from an earlier day', async () => {
      const ids = await assign(0, [{ exerciseId: kneeId }]);
      const done = await tick(ids[kneeId]).expect(201);
      await ctx.connection
        .collection('exerciseCompletions')
        .updateOne({ _id: new Types.ObjectId(done.body.id) }, { $set: { date: daysAgo(1) } });

      const res = await as(patient).delete(`/exercise-completions/${done.body.id}`).expect(409);
      expect(res.body.code).toBe(ERROR_CODES.DAY_CHANGED);
    });
  });

  describe('history', () => {
    it('lists my ticks newest first, without undone ones, a page at a time', async () => {
      const ids = await assign(0, [{ exerciseId: kneeId, times: 3 }, { exerciseId: walkId }]);
      const a = await tick(ids[kneeId]).expect(201);
      const b = await tick(ids[walkId]).expect(201);
      const c = await tick(ids[kneeId]).expect(201);
      const undone = await tick(ids[kneeId]).expect(201);
      await as(patient).delete(`/exercise-completions/${undone.body.id}`).expect(204);

      const first = await as(patient).get('/patients/me/exercise-completions?limit=2').expect(200);
      expect(first.body.data.map((x: { id: string }) => x.id)).toEqual([c.body.id, b.body.id]);
      const second = await as(patient)
        .get(`/patients/me/exercise-completions?limit=2&cursor=${first.body.nextCursor}`)
        .expect(200);
      expect(second.body.data.map((x: { id: string }) => x.id)).toEqual([a.body.id]);
      expect(second.body.nextCursor).toBeNull();
    });

    it('filters by date and refuses from after to or a bad cursor', async () => {
      const ids = await assign(0, [{ exerciseId: kneeId }]);
      await tick(ids[kneeId]).expect(201);

      const old = await as(patient).get(`/patients/me/exercise-completions?from=${daysAgo(10)}&to=${daysAgo(1)}`).expect(200);
      expect(old.body.data).toEqual([]);

      await as(patient).get(`/patients/me/exercise-completions?from=${today()}&to=${daysAgo(1)}`).expect(400);
      await as(patient).get('/patients/me/exercise-completions?cursor=rubbish').expect(400);
    });

    it("shows a linked doctor the patient's history, audited, and nobody else", async () => {
      const ids = await assign(0, [{ exerciseId: kneeId }]);
      await tick(ids[kneeId]).expect(201);

      const res = await as(doctor).get(`/patients/${patient.id}/exercise-completions`).expect(200);
      expect(res.body.data).toHaveLength(1);
      expect(await ctx.connection.collection('auditLogs').countDocuments({ action: 'EXERCISE_PLAN_VIEWED' })).toBe(1);

      await as(otherDoctor).get(`/patients/${patient.id}/exercise-completions`).expect(404);
      await as(patient).get(`/patients/${patient.id}/exercise-completions`).expect(403);
    });
  });

  describe("a doctor's view of a day", () => {
    it('shows each day with the plan that applied that day', async () => {
      await assign(0, [{ exerciseId: kneeId }]);
      // Version 1 was saved five days ago; version 2 replaces it today.
      await ctx.connection
        .collection('exercisePlans')
        .updateOne({ version: 1 }, { $set: { createdAt: now().minus({ days: 5 }).toJSDate() } });
      await assign(1, [{ exerciseId: walkId }]);

      const past = await as(doctor).get(`/patients/${patient.id}/exercise-checklist?date=${daysAgo(2)}`).expect(200);
      expect(past.body).toMatchObject({ date: daysAgo(2), planVersion: 1 });
      expect(past.body.items.map((i: { exercise: { id: string } }) => i.exercise.id)).toEqual([kneeId]);

      const current = await as(doctor).get(`/patients/${patient.id}/exercise-checklist`).expect(200);
      expect(current.body).toMatchObject({ date: today(), planVersion: 2 });
      expect(current.body.items.map((i: { exercise: { id: string } }) => i.exercise.id)).toEqual([walkId]);

      // Before the first plan there was nothing to do.
      const before = await as(doctor).get(`/patients/${patient.id}/exercise-checklist?date=${daysAgo(9)}`).expect(200);
      expect(before.body).toMatchObject({ planVersion: 0, items: [] });
    });

    it('refuses a future date and keeps unlinked doctors out', async () => {
      const tomorrow = now().plus({ days: 1 }).toISODate();
      const res = await as(doctor).get(`/patients/${patient.id}/exercise-checklist?date=${tomorrow}`).expect(400);
      expect(res.body.details[0]).toMatchObject({ field: 'date', code: DETAIL_CODES.OUT_OF_RANGE });

      await as(otherDoctor).get(`/patients/${patient.id}/exercise-checklist`).expect(404);
      await as(doctor).get('/patients/me/exercise-checklist').expect(403);
    });

    it('never counts more than is now planned after the doctor lowers it', async () => {
      const ids = await assign(0, [{ exerciseId: kneeId, times: 2 }]);
      await tick(ids[kneeId]).expect(201);
      await tick(ids[kneeId]).expect(201);
      await assign(1, [{ exerciseId: kneeId, times: 1 }]);

      const res = await as(doctor).get(`/patients/${patient.id}/exercise-checklist`).expect(200);
      expect(res.body).toMatchObject({ doneCount: 1, plannedCount: 1 });
      expect(res.body.items[0]).toMatchObject({ doneCount: 1, status: 'DONE' });
      expect(res.body.items[0].completions).toHaveLength(2);
    });
  });
});
