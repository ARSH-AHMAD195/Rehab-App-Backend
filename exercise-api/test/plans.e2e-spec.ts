import request from 'supertest';
import { Types } from 'mongoose';
import { DETAIL_CODES, ERROR_CODES } from '../src/common/constants';
import { TestContext, TestUser, createTestApp } from './helpers/test-app';

const VIDEO_ID = 'dQw4w9WgXcQ';

describe('Exercise plans', () => {
  let ctx: TestContext;
  let admin: TestUser;
  let doctor: TestUser;
  let otherDoctor: TestUser;
  let patient: TestUser;
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
  const planPath = () => `/patients/${patient.id}/exercise-plan`;

  const item = (exerciseId: string, extra: Record<string, unknown> = {}) => ({
    exerciseId,
    schedule: { daysOfWeek: [1, 3, 5], timesPerDay: 1 },
    ...extra,
  });
  const savePlan = (version: number, items: unknown[], by: TestUser = doctor) =>
    as(by).put(planPath()).send({ version, items });

  const addExercise = async (name: string, code: string, extra: Record<string, unknown> = {}) => {
    const category = await ctx.connection.collection('exerciseCategories').findOne({ code });
    const res = await as(admin)
      .post('/exercises')
      .send({ name, categoryId: String(category!._id), ...extra })
      .expect(201);
    return res.body.id as string;
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
    patient = await ctx.createUser({
      uid: 'pat-1',
      role: 'PATIENT',
      name: 'Rajesh Iyer',
      timeZone: 'Asia/Kolkata',
      doctorIds: [doctor.id],
    });
    kneeId = await addExercise('Seated knee extension', 'STRENGTH', {
      instructions: ['Sit upright', 'Straighten one knee slowly'],
      videoUrl: VIDEO_ID,
    });
    walkId = await addExercise('Brisk walk', 'WALKING');
    breathId = await addExercise('Deep breathing', 'BREATHING');
  });

  describe('before any plan', () => {
    it('shows an empty plan at version 0, to patient and doctor', async () => {
      const empty = { patientId: patient.id, version: 0, items: [], assignedBy: null, updatedAt: null };
      expect((await as(patient).get('/patients/me/exercise-plan').expect(200)).body).toEqual(empty);
      expect((await as(doctor).get(planPath()).expect(200)).body).toEqual(empty);
    });
  });

  describe('assigning', () => {
    it('saves version 1 and shows the patient their exercises, steps and video', async () => {
      const saved = await savePlan(0, [
        item(kneeId, { target: { sets: 2, reps: 10 }, notes: ' Stop if pain goes above 5 ' }),
        item(walkId, { schedule: { daysOfWeek: [7, 1, 3], timesPerDay: 2 }, target: { durationMin: 20 } }),
      ]).expect(200);

      expect(saved.body).toMatchObject({
        patientId: patient.id,
        version: 1,
        assignedBy: { id: doctor.id, name: 'Dr Meera Nair' },
      });
      // In the patient's own time zone.
      expect(saved.body.updatedAt).toMatch(/\+05:30$/);

      const mine = await as(patient).get('/patients/me/exercise-plan').expect(200);
      expect(mine.body.items).toEqual([
        {
          itemId: expect.any(String),
          exercise: {
            id: kneeId,
            name: 'Seated knee extension',
            category: 'STRENGTH',
            description: null,
            instructions: ['Sit upright', 'Straighten one knee slowly'],
            video: { provider: 'YOUTUBE', videoId: VIDEO_ID, url: `https://www.youtube.com/watch?v=${VIDEO_ID}` },
            active: true,
          },
          schedule: { daysOfWeek: [1, 3, 5], timesPerDay: 1 },
          target: { sets: 2, reps: 10, durationMin: null },
          notes: 'Stop if pain goes above 5',
        },
        expect.objectContaining({
          exercise: expect.objectContaining({ id: walkId, video: null }),
          // Days come back sorted.
          schedule: { daysOfWeek: [1, 3, 7], timesPerDay: 2 },
          target: { sets: null, reps: null, durationMin: 20 },
          notes: null,
        }),
      ]);
    });

    it('records the change in the audit log and queues an event', async () => {
      await savePlan(0, [item(kneeId)]).expect(200);
      await savePlan(1, [item(walkId)]).expect(200);

      const audits = await ctx.connection
        .collection('auditLogs')
        .find({ action: 'EXERCISE_PLAN_CHANGED' })
        .sort({ at: 1 })
        .toArray();
      expect(audits).toHaveLength(2);
      expect(audits[0]).toMatchObject({ actorRole: 'DOCTOR', before: null, after: { version: 1 } });
      expect(String(audits[0].patientId)).toBe(patient.id);
      expect(audits[1]).toMatchObject({
        before: { version: 1, items: [{ exerciseId: kneeId }] },
        after: { version: 2, items: [{ exerciseId: walkId }] },
      });

      const events = await ctx.connection.collection('exerciseOutboxEvents').find({}).sort({ _id: 1 }).toArray();
      expect(events.map((e) => e.type)).toEqual(['exercise.plan.assigned', 'exercise.plan.assigned']);
      expect(events[1]).toMatchObject({ status: 'PENDING', data: { planVersion: 2, itemCount: 1, assignedBy: doctor.id } });
    });

    it('keeps old versions, and keeps an itemId while the exercise stays in the plan', async () => {
      const v1 = await savePlan(0, [item(kneeId), item(walkId)]).expect(200);
      const v2 = await savePlan(1, [item(walkId, { schedule: { daysOfWeek: [1], timesPerDay: 1 } }), item(breathId)]).expect(200);

      const walkV1 = v1.body.items.find((i: { exercise: { id: string } }) => i.exercise.id === walkId).itemId;
      const walkV2 = v2.body.items.find((i: { exercise: { id: string } }) => i.exercise.id === walkId).itemId;
      const breathV2 = v2.body.items.find((i: { exercise: { id: string } }) => i.exercise.id === breathId).itemId;
      expect(walkV2).toBe(walkV1);
      expect(v1.body.items.map((i: { itemId: string }) => i.itemId)).not.toContain(breathV2);

      const stored = await ctx.connection.collection('exercisePlans').find({}).sort({ version: 1 }).toArray();
      expect(stored.map((p) => [p.version, p.isCurrent])).toEqual([
        [1, false],
        [2, true],
      ]);
    });

    it('changes nothing when the same plan is saved again', async () => {
      await savePlan(0, [item(kneeId, { target: { sets: 2 } })]).expect(200);
      // Same content, days in another order.
      const again = await savePlan(1, [item(kneeId, { target: { sets: 2 }, schedule: { daysOfWeek: [5, 3, 1], timesPerDay: 1 } })]).expect(200);

      expect(again.body.version).toBe(1);
      expect(await ctx.connection.collection('exercisePlans').countDocuments()).toBe(1);
      expect(await ctx.connection.collection('auditLogs').countDocuments({ action: 'EXERCISE_PLAN_CHANGED' })).toBe(1);
    });

    it('clears the plan with an empty list, as a new version', async () => {
      await savePlan(0, [item(kneeId)]).expect(200);
      const cleared = await savePlan(1, []).expect(200);
      expect(cleared.body).toMatchObject({ version: 2, items: [] });

      // Clearing a plan that was never set saves nothing.
      const other = await ctx.createUser({ uid: 'pat-2', role: 'PATIENT', name: 'Anita', doctorIds: [doctor.id] });
      const nothing = await as(doctor).put(`/patients/${other.id}/exercise-plan`).send({ version: 0, items: [] }).expect(200);
      expect(nothing.body.version).toBe(0);
    });
  });

  describe('two doctors at once', () => {
    it('refuses a save based on an old version', async () => {
      await savePlan(0, [item(kneeId)]).expect(200);
      await savePlan(1, [item(walkId)]).expect(200);

      const stale = await savePlan(1, [item(breathId)]).expect(409);
      expect(stale.body.code).toBe(ERROR_CODES.CONCURRENT_UPDATE);
      expect(stale.body.message).toMatch(/version 2/);

      await savePlan(5, [item(breathId)]).expect(409);
    });

    it('lets exactly one of two simultaneous saves through', async () => {
      // Both doctors linked to the patient.
      await ctx.connection
        .collection('users')
        .updateOne({ firebaseUid: 'pat-1' }, { $push: { doctorIds: new Types.ObjectId(otherDoctor.id) } } as never);
      await savePlan(0, [item(kneeId)]).expect(200);

      const results = await Promise.all([savePlan(1, [item(walkId)], doctor), savePlan(1, [item(breathId)], otherDoctor)]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);

      const current = await ctx.connection.collection('exercisePlans').find({ isCurrent: true }).toArray();
      expect(current).toHaveLength(1);
      expect(current[0].version).toBe(2);
    });
  });

  describe('checks on the items', () => {
    it('refuses an unknown exercise, a deactivated one and the same exercise twice', async () => {
      await as(admin).delete(`/exercises/${breathId}`).expect(200);

      const res = await savePlan(0, [item('6712a0b1c2d3e4f5a6b7c8d9'), item(breathId)]).expect(400);
      expect(res.body.details).toEqual([
        expect.objectContaining({ field: 'items.0.exerciseId', code: DETAIL_CODES.UNKNOWN_ID }),
        expect.objectContaining({ field: 'items.1.exerciseId', code: DETAIL_CODES.NOT_ALLOWED }),
      ]);

      const twice = await savePlan(0, [item(kneeId), item(kneeId)]).expect(400);
      expect(twice.body.details).toEqual([
        expect.objectContaining({ field: 'items.1.exerciseId', code: DETAIL_CODES.ALREADY_EXISTS }),
      ]);
      expect(await ctx.connection.collection('exercisePlans').countDocuments()).toBe(0);
    });

    it.each([
      ['no days', { daysOfWeek: [], timesPerDay: 1 }, 'items.0.schedule.daysOfWeek', DETAIL_CODES.REQUIRED],
      ['day 0', { daysOfWeek: [0], timesPerDay: 1 }, 'items.0.schedule.daysOfWeek', DETAIL_CODES.OUT_OF_RANGE],
      ['day 8', { daysOfWeek: [8], timesPerDay: 1 }, 'items.0.schedule.daysOfWeek', DETAIL_CODES.OUT_OF_RANGE],
      ['a repeated day', { daysOfWeek: [1, 1], timesPerDay: 1 }, 'items.0.schedule.daysOfWeek', DETAIL_CODES.WRONG_SHAPE],
      ['zero times a day', { daysOfWeek: [1], timesPerDay: 0 }, 'items.0.schedule.timesPerDay', DETAIL_CODES.OUT_OF_RANGE],
      ['half a time a day', { daysOfWeek: [1], timesPerDay: 1.5 }, 'items.0.schedule.timesPerDay', DETAIL_CODES.WRONG_SHAPE],
    ])('refuses a schedule with %s', async (_label, schedule, field, code) => {
      const res = await savePlan(0, [item(kneeId, { schedule })]).expect(400);
      expect(res.body.details).toContainEqual(expect.objectContaining({ field, code }));
    });

    it('refuses a missing version, a missing schedule and an unknown field', async () => {
      const noVersion = await as(doctor).put(planPath()).send({ items: [] }).expect(400);
      expect(noVersion.body.details).toEqual([expect.objectContaining({ field: 'version', code: DETAIL_CODES.REQUIRED })]);

      const noSchedule = await savePlan(0, [{ exerciseId: kneeId }]).expect(400);
      expect(noSchedule.body.details[0]).toMatchObject({ field: 'items.0.schedule', code: DETAIL_CODES.REQUIRED });

      await savePlan(0, [null]).expect(400);
      await savePlan(0, ['x']).expect(400);
      await savePlan(0, [item(kneeId, { schedule: null })]).expect(400);
      await savePlan(0, [item(kneeId, { priority: 1 })]).expect(400);
      await savePlan(0, [item(kneeId, { target: { sets: 0 } })]).expect(400);
    });
  });

  describe('who can see and change a plan', () => {
    it('gives 404 to a doctor the patient is not linked to, whatever the route', async () => {
      for (const res of [
        await as(otherDoctor).get(planPath()),
        await savePlan(0, [item(kneeId)], otherDoctor),
        await as(otherDoctor).get(`${planPath()}/versions`),
      ]) {
        expect(res.status).toBe(404);
        expect(res.body.code).toBe(ERROR_CODES.NOT_FOUND);
      }
      // Same answer as for a patient that doesn't exist.
      await as(doctor).get('/patients/6712a0b1c2d3e4f5a6b7c8d9/exercise-plan').expect(404);
      await as(doctor).get('/patients/not-an-id/exercise-plan').expect(404);
      // A doctor's own id is not a patient.
      await as(doctor).get(`/patients/${doctor.id}/exercise-plan`).expect(404);
    });

    it('gives 404 once the patient account is deactivated', async () => {
      await ctx.connection
        .collection('users')
        .updateOne({ firebaseUid: 'pat-1' }, { $set: { active: false } });
      await as(doctor).get(planPath()).expect(404);
    });

    it('keeps patients and admins to their own routes', async () => {
      await as(patient).get(planPath()).expect(403);
      await savePlan(0, [item(kneeId)], patient).expect(403);
      await as(admin).get(planPath()).expect(403);
      await as(doctor).get('/patients/me/exercise-plan').expect(403);
    });

    it("audits a doctor's views, not the patient's own", async () => {
      await as(doctor).get(planPath()).expect(200);
      await as(doctor).get(`${planPath()}/versions`).expect(200);
      await as(patient).get('/patients/me/exercise-plan').expect(200);

      const views = await ctx.connection.collection('auditLogs').find({ action: 'EXERCISE_PLAN_VIEWED' }).toArray();
      expect(views).toHaveLength(2);
      expect(views.every((v) => v.actorRole === 'DOCTOR' && String(v.patientId) === patient.id)).toBe(true);
    });
  });

  describe('versions', () => {
    it('lists every version newest first, a page at a time', async () => {
      await savePlan(0, [item(kneeId)]).expect(200);
      await savePlan(1, [item(walkId)]).expect(200);
      await savePlan(2, [item(breathId)]).expect(200);

      const first = await as(doctor).get(`${planPath()}/versions?limit=2`).expect(200);
      expect(first.body.data.map((p: { version: number }) => p.version)).toEqual([3, 2]);
      expect(first.body.data[1].items[0].exercise.id).toBe(walkId);

      const second = await as(doctor).get(`${planPath()}/versions?limit=2&cursor=${first.body.nextCursor}`).expect(200);
      expect(second.body.data.map((p: { version: number }) => p.version)).toEqual([1]);
      expect(second.body.nextCursor).toBeNull();

      await as(doctor).get(`${planPath()}/versions?cursor=rubbish`).expect(400);
    });
  });

  describe("the patient's view of the library", () => {
    it('shows only the exercises in their plan', async () => {
      await savePlan(0, [item(kneeId), item(walkId)]).expect(200);

      const list = await as(patient).get('/exercises').expect(200);
      expect(list.body.data.map((e: { id: string }) => e.id).sort()).toEqual([kneeId, walkId].sort());

      await as(patient).get(`/exercises/${kneeId}`).expect(200);
      await as(patient).get(`/exercises/${breathId}`).expect(404);

      // Filters still work inside the plan.
      const walking = await as(patient).get('/exercises?category=WALKING').expect(200);
      expect(walking.body.data.map((e: { id: string }) => e.id)).toEqual([walkId]);
    });

    it('still shows a planned exercise after an admin switches it off, marked inactive', async () => {
      await savePlan(0, [item(kneeId)]).expect(200);
      await as(admin).delete(`/exercises/${kneeId}`).expect(200);

      const plan = await as(patient).get('/patients/me/exercise-plan').expect(200);
      expect(plan.body.items[0].exercise).toMatchObject({ id: kneeId, active: false });
      const list = await as(patient).get('/exercises').expect(200);
      expect(list.body.data).toHaveLength(1);
    });

    it('shows a new video to the patient as soon as the admin adds it', async () => {
      await savePlan(0, [item(walkId)]).expect(200);
      await http()
        .patch(`/api/v1/exercises/${walkId}`)
        .set('Authorization', `Bearer ${ctx.token(admin)}`)
        .send({ videoUrl: `https://youtu.be/${VIDEO_ID}` })
        .expect(200);

      const plan = await as(patient).get('/patients/me/exercise-plan').expect(200);
      expect(plan.body.items[0].exercise.video).toMatchObject({ videoId: VIDEO_ID });
    });
  });
});
