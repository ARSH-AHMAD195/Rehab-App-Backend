import request from 'supertest';
import { DateTime } from 'luxon';
import { DETAIL_CODES, ERROR_CODES } from '../src/common/constants';
import { ExercisesService } from '../src/exercises/exercises.service';
import { TestContext, TestUser, createTestApp } from './helpers/test-app';

const ZONE = 'Asia/Kolkata';
const today = () => DateTime.now().setZone(ZONE).toISODate()!;
const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7];

describe('Incentive spirometry and Hindi text', () => {
  let ctx: TestContext;
  let admin: TestUser;
  let doctor: TestUser;
  let patient: TestUser;

  const http = () => request(ctx.app.getHttpServer());
  const as = (user: TestUser) => ({
    get: (path: string) => http().get(`/api/v1${path}`).set('Authorization', `Bearer ${ctx.token(user)}`),
    put: (path: string) => http().put(`/api/v1${path}`).set('Authorization', `Bearer ${ctx.token(user)}`),
    post: (path: string) => http().post(`/api/v1${path}`).set('Authorization', `Bearer ${ctx.token(user)}`),
    patch: (path: string) => http().patch(`/api/v1${path}`).set('Authorization', `Bearer ${ctx.token(user)}`),
  });

  const spirometry = async () => {
    const res = await as(admin).get('/exercises?category=BREATHING').expect(200);
    return res.body.data.find((e: { code: string | null }) => e.code === 'INCENTIVE_SPIROMETRY');
  };

  const categoryId = async (code: string) =>
    String((await ctx.connection.collection('exerciseCategories').findOne({ code }))!._id);

  const assign = (items: { exerciseId: string; target?: Record<string, unknown> }[]) =>
    as(doctor)
      .put(`/patients/${patient.id}/exercise-plan`)
      .send({
        version: 0,
        items: items.map((i) => ({ exerciseId: i.exerciseId, schedule: { daysOfWeek: EVERY_DAY, timesPerDay: 2 }, target: i.target })),
      });

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await ctx.reset();
    // As on a fresh start: spirometry goes into the library.
    await ctx.app.get(ExercisesService).seedMissing();
    admin = await ctx.createUser({ uid: 'adm-1', role: 'ADMIN', name: 'Platform Admin' });
    doctor = await ctx.createUser({ uid: 'doc-1', role: 'DOCTOR', name: 'Dr Meera Nair' });
    patient = await ctx.createUser({ uid: 'pat-1', role: 'PATIENT', name: 'Rajesh Iyer', timeZone: ZONE, doctorIds: [doctor.id] });
  });

  describe('incentive spirometry in the library', () => {
    it('is there from the start, under Breathing, name only', async () => {
      expect(await spirometry()).toMatchObject({
        name: 'Incentive spirometry',
        category: 'BREATHING',
        code: 'INCENTIVE_SPIROMETRY',
        recordsVolume: true,
        description: null,
        instructions: [],
        video: null,
        active: true,
        createdBy: null,
      });
    });

    it('is added once, and an admin edit survives a restart', async () => {
      const { id } = await spirometry();
      await as(admin).patch(`/exercises/${id}`).send({ instructions: ['Breathe out', 'Seal lips', 'Breathe in slowly'] }).expect(200);
      await ctx.app.get(ExercisesService).seedMissing();

      expect(await ctx.connection.collection('exercises').countDocuments({ code: 'INCENTIVE_SPIROMETRY' })).toBe(1);
      expect((await spirometry()).instructions).toEqual(['Breathe out', 'Seal lips', 'Breathe in slowly']);
    });
  });

  describe('target and recorded volume', () => {
    it('the doctor sets a target volume; the patient records what they reached with each tick', async () => {
      const { id } = await spirometry();
      const plan = await assign([{ exerciseId: id, target: { reps: 10, volumeMl: 1500 } }]).expect(200);
      const itemId = plan.body.items[0].itemId;
      expect(plan.body.items[0]).toMatchObject({
        exercise: { id, recordsVolume: true },
        target: { sets: null, reps: 10, durationMin: null, volumeMl: 1500 },
      });

      const done = await as(patient)
        .post('/exercise-completions')
        .send({ itemId, date: today(), details: { volumeMl: 1250 } })
        .expect(201);
      expect(done.body.details).toEqual({ durationMin: null, note: null, volumeMl: 1250 });

      const checklist = await as(patient).get('/patients/me/exercise-checklist').expect(200);
      expect(checklist.body.items[0]).toMatchObject({
        target: { volumeMl: 1500 },
        doneCount: 1,
        completions: [{ id: done.body.id, volumeMl: 1250 }],
      });

      const history = await as(patient).get('/patients/me/exercise-completions').expect(200);
      expect(history.body.data[0].details).toEqual({ durationMin: null, note: null, volumeMl: 1250 });
    });

    it('a tick without a volume is still fine', async () => {
      const { id } = await spirometry();
      const plan = await assign([{ exerciseId: id }]).expect(200);
      const done = await as(patient).post('/exercise-completions').send({ itemId: plan.body.items[0].itemId, date: today() }).expect(201);
      expect(done.body.details).toBeNull();
    });

    it.each([
      [-1, DETAIL_CODES.OUT_OF_RANGE],
      [5001, DETAIL_CODES.OUT_OF_RANGE],
      [1250.5, DETAIL_CODES.WRONG_SHAPE],
    ])('refuses a volume of %s', async (volumeMl, code) => {
      const { id } = await spirometry();
      const plan = await assign([{ exerciseId: id }]).expect(200);
      const res = await as(patient)
        .post('/exercise-completions')
        .send({ itemId: plan.body.items[0].itemId, date: today(), details: { volumeMl } })
        .expect(400);
      expect(res.body.code).toBe(ERROR_CODES.VALIDATION_FAILED);
      expect(res.body.details[0]).toMatchObject({ field: 'details.volumeMl', code });
    });

    it('a volume only goes with an exercise that records one', async () => {
      const knee = await as(admin).post('/exercises').send({ name: 'Seated knee extension', categoryId: await categoryId('STRENGTH') }).expect(201);

      const target = await assign([{ exerciseId: knee.body.id, target: { volumeMl: 1500 } }]).expect(400);
      expect(target.body.details[0]).toMatchObject({ field: 'items.0.target.volumeMl', code: DETAIL_CODES.NOT_ALLOWED });

      const plan = await assign([{ exerciseId: knee.body.id }]).expect(200);
      const tick = await as(patient)
        .post('/exercise-completions')
        .send({ itemId: plan.body.items[0].itemId, date: today(), details: { volumeMl: 1000 } })
        .expect(400);
      expect(tick.body.details[0]).toMatchObject({ field: 'details.volumeMl', code: DETAIL_CODES.NOT_ALLOWED });
    });

    it('an admin can mark another exercise as recording a volume', async () => {
      const other = await as(admin)
        .post('/exercises')
        .send({ name: 'Spirometer, sitting', categoryId: await categoryId('BREATHING'), recordsVolume: true })
        .expect(201);
      expect(other.body).toMatchObject({ recordsVolume: true, code: null });
    });
  });

  describe('Hindi text', () => {
    it('every exercise carries a Hindi part, empty until it is filled in', async () => {
      expect((await spirometry()).hi).toEqual({ name: null, description: null, instructions: [] });
    });

    it('is saved, shown in the patient plan, and audited', async () => {
      const { id } = await spirometry();
      const hi = { name: 'इंसेंटिव स्पाइरोमेट्री', description: 'फेफड़ों के लिए', instructions: ['धीरे साँस लें'] };
      const saved = await as(admin).patch(`/exercises/${id}`).send({ hi }).expect(200);
      expect(saved.body.hi).toEqual(hi);

      await assign([{ exerciseId: id }]).expect(200);
      const mine = await as(patient).get('/patients/me/exercise-plan').expect(200);
      expect(mine.body.items[0].exercise.hi).toEqual(hi);

      const audit = await ctx.connection.collection('auditLogs').findOne({ action: 'EXERCISE_LIBRARY_CHANGED', resourceId: id });
      expect(audit!.after.exercise.hi).toEqual(hi);
    });

    it('a part left out falls back to English; null removes it all', async () => {
      const { id } = await spirometry();
      const partial = await as(admin).patch(`/exercises/${id}`).send({ hi: { name: 'स्पाइरोमेट्री' } }).expect(200);
      expect(partial.body.hi).toEqual({ name: 'स्पाइरोमेट्री', description: null, instructions: [] });

      const removed = await as(admin).patch(`/exercises/${id}`).send({ hi: null }).expect(200);
      expect(removed.body.hi).toEqual({ name: null, description: null, instructions: [] });
    });

    it('refuses text that is too long', async () => {
      const { id } = await spirometry();
      const res = await as(admin).patch(`/exercises/${id}`).send({ hi: { name: 'अ'.repeat(121) } }).expect(400);
      expect(res.body.details[0]).toMatchObject({ field: 'hi.name' });
    });

    it('categories have a Hindi name too', async () => {
      const list = await as(admin).get('/exercise-categories').expect(200);
      expect(list.body.data[0]).toMatchObject({ code: 'WALKING', nameHi: null });

      const breathing = await categoryId('BREATHING');
      const saved = await as(admin).patch(`/exercise-categories/${breathing}`).send({ nameHi: 'साँस' }).expect(200);
      expect(saved.body).toMatchObject({ code: 'BREATHING', name: 'Breathing', nameHi: 'साँस' });

      const cleared = await as(admin).patch(`/exercise-categories/${breathing}`).send({ nameHi: null }).expect(200);
      expect(cleared.body.nameHi).toBeNull();
    });
  });
});
