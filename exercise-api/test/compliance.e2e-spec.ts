import request from 'supertest';
import { DateTime } from 'luxon';
import { Types } from 'mongoose';
import { DETAIL_CODES } from '../src/common/constants';
import { TestContext, TestUser, createTestApp } from './helpers/test-app';

const ZONE = 'Asia/Kolkata';
const now = () => DateTime.now().setZone(ZONE);
const daysAgo = (n: number) => now().minus({ days: n }).toISODate()!;
const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7];

describe('Exercise compliance', () => {
  let ctx: TestContext;
  let admin: TestUser;
  let doctor: TestUser;
  let otherDoctor: TestUser;
  let patient: TestUser;
  let kneeId: string;
  let walkId: string;

  const http = () => request(ctx.app.getHttpServer());
  const as = (user: TestUser) => ({
    get: (path: string) => http().get(`/api/v1${path}`).set('Authorization', `Bearer ${ctx.token(user)}`),
    put: (path: string) => http().put(`/api/v1${path}`).set('Authorization', `Bearer ${ctx.token(user)}`),
    post: (path: string) => http().post(`/api/v1${path}`).set('Authorization', `Bearer ${ctx.token(user)}`),
  });
  const compliancePath = (query = '') => `/patients/${patient.id}/exercise-compliance${query}`;

  const addExercise = async (name: string, code: string) => {
    const category = await ctx.connection.collection('exerciseCategories').findOne({ code });
    const res = await as(admin).post('/exercises').send({ name, categoryId: String(category!._id) }).expect(201);
    return res.body.id as string;
  };

  /** Saves a plan, then dates it `ageDays` ago. Returns itemIds by exercise id. */
  const planFrom = async (ageDays: number, version: number, items: { exerciseId: string; times: number }[]) => {
    const res = await as(doctor)
      .put(`/patients/${patient.id}/exercise-plan`)
      .send({
        version,
        items: items.map((i) => ({ exerciseId: i.exerciseId, schedule: { daysOfWeek: EVERY_DAY, timesPerDay: i.times } })),
      })
      .expect(200);
    await ctx.connection
      .collection('exercisePlans')
      .updateOne({ version: version + 1 }, { $set: { createdAt: now().minus({ days: ageDays }).toJSDate() } });
    return Object.fromEntries(
      res.body.items.map((i: { itemId: string; exercise: { id: string } }) => [i.exercise.id, i.itemId]),
    ) as Record<string, string>;
  };

  /** A tick on an earlier day, written straight to the database (the API only takes today's). */
  const pastTicks = async (date: string, itemId: string, exerciseId: string, count: number, active = true) => {
    for (let slot = 0; slot < count; slot++) {
      await ctx.connection.collection('exerciseCompletions').insertOne({
        patientId: new Types.ObjectId(patient.id),
        itemId,
        exerciseId: new Types.ObjectId(exerciseId),
        planVersion: 1,
        date,
        slot: active ? slot : 99 + slot,
        completedAt: new Date(),
        details: null,
        active,
        undoneAt: active ? null : new Date(),
      });
    }
  };

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
    kneeId = await addExercise('Seated knee extension', 'STRENGTH');
    walkId = await addExercise('Brisk walk', 'WALKING');
  });

  it('counts planned and done per day and per exercise, each day against the plan in place then', async () => {
    // Ten days ago: knee extension twice a day. Three days ago: once a day, plus a walk.
    const v1 = await planFrom(10, 0, [{ exerciseId: kneeId, times: 2 }]);
    const v2 = await planFrom(3, 1, [
      { exerciseId: kneeId, times: 1 },
      { exerciseId: walkId, times: 1 },
    ]);
    const knee = v1[kneeId];
    expect(v2[kneeId]).toBe(knee); // same item across versions
    const walk = v2[walkId];

    await pastTicks(daysAgo(6), knee, kneeId, 2); // 2 of 2
    await pastTicks(daysAgo(5), knee, kneeId, 3); // 3 ticks, only 2 planned: counts 2
    // 4 days ago: nothing done
    await pastTicks(daysAgo(3), knee, kneeId, 1);
    await pastTicks(daysAgo(3), walk, walkId, 1); // 2 of 2
    await pastTicks(daysAgo(2), walk, walkId, 1);
    await pastTicks(daysAgo(2), knee, kneeId, 1, false); // undone: doesn't count
    // yesterday: nothing done
    await as(patient).post('/exercise-completions').send({ itemId: knee, date: daysAgo(0) }).expect(201); // today, via the API

    const res = await as(doctor).get(compliancePath()).expect(200);

    expect(res.body).toMatchObject({ from: daysAgo(6), to: daysAgo(0), planned: 14, done: 8, percentage: null });
    expect(res.body.byDay).toEqual([
      { date: daysAgo(6), planned: 2, done: 2 },
      { date: daysAgo(5), planned: 2, done: 2 },
      { date: daysAgo(4), planned: 2, done: 0 },
      { date: daysAgo(3), planned: 2, done: 2 },
      { date: daysAgo(2), planned: 2, done: 1 },
      { date: daysAgo(1), planned: 2, done: 0 },
      { date: daysAgo(0), planned: 2, done: 1 },
    ]);
    expect(res.body.byExercise).toEqual([
      { itemId: knee, exerciseId: kneeId, name: 'Seated knee extension', planned: 10, done: 6 },
      { itemId: walk, exerciseId: walkId, name: 'Brisk walk', planned: 4, done: 2 },
    ]);
  });

  it('plans nothing on days before the first plan', async () => {
    await planFrom(2, 0, [{ exerciseId: kneeId, times: 1 }]);

    const res = await as(doctor).get(compliancePath(`?from=${daysAgo(4)}&to=${daysAgo(0)}`)).expect(200);
    expect(res.body.byDay.map((d: { planned: number }) => d.planned)).toEqual([0, 0, 1, 1, 1]);
    expect(res.body).toMatchObject({ planned: 3, done: 0, percentage: null });
  });

  it('gives zeros, not an error, for a patient with no plan', async () => {
    const res = await as(doctor).get(compliancePath()).expect(200);
    expect(res.body).toMatchObject({ planned: 0, done: 0, percentage: null, byExercise: [] });
    expect(res.body.byDay).toHaveLength(7);
  });

  it('refuses a range past today, backwards, or longer than 90 days', async () => {
    const tomorrow = now().plus({ days: 1 }).toISODate();
    const future = await as(doctor).get(compliancePath(`?to=${tomorrow}`)).expect(400);
    expect(future.body.details[0]).toMatchObject({ field: 'to', code: DETAIL_CODES.OUT_OF_RANGE });

    await as(doctor).get(compliancePath(`?from=${daysAgo(0)}&to=${daysAgo(3)}`)).expect(400);

    const long = await as(doctor).get(compliancePath(`?from=${daysAgo(90)}&to=${daysAgo(0)}`)).expect(400);
    expect(long.body.details[0]).toMatchObject({ field: 'from', code: DETAIL_CODES.OUT_OF_RANGE });
    await as(doctor).get(compliancePath(`?from=${daysAgo(89)}&to=${daysAgo(0)}`)).expect(200);

    await as(doctor).get(compliancePath('?from=2026-02-30')).expect(400);
  });

  it('is for linked doctors only, and audited', async () => {
    await as(doctor).get(compliancePath()).expect(200);
    const views = await ctx.connection.collection('auditLogs').find({ action: 'EXERCISE_PLAN_VIEWED' }).toArray();
    expect(views).toHaveLength(1);
    expect(String(views[0].patientId)).toBe(patient.id);

    await as(otherDoctor).get(compliancePath()).expect(404);
    await as(patient).get(compliancePath()).expect(403);
    await as(admin).get(compliancePath()).expect(403);
  });
});
