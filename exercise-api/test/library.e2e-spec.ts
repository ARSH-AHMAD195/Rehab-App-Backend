import request from 'supertest';
import { DETAIL_CODES, ERROR_CODES } from '../src/common/constants';
import { TestContext, TestUser, createTestApp } from './helpers/test-app';

const VIDEO_ID = 'dQw4w9WgXcQ';

describe('Exercise library (categories and exercises)', () => {
  let ctx: TestContext;
  let admin: TestUser;
  let doctor: TestUser;
  let patient: TestUser;

  const http = () => request(ctx.app.getHttpServer());
  const as = (user: TestUser) => ({
    get: (path: string) => http().get(`/api/v1${path}`).set('Authorization', `Bearer ${ctx.token(user)}`),
    post: (path: string) => http().post(`/api/v1${path}`).set('Authorization', `Bearer ${ctx.token(user)}`),
    patch: (path: string) => http().patch(`/api/v1${path}`).set('Authorization', `Bearer ${ctx.token(user)}`),
    delete: (path: string) => http().delete(`/api/v1${path}`).set('Authorization', `Bearer ${ctx.token(user)}`),
  });

  const categoryId = async (code: string): Promise<string> => {
    const row = await ctx.connection.collection('exerciseCategories').findOne({ code });
    return String(row!._id);
  };

  const addExercise = async (body: Record<string, unknown> = {}) => {
    const res = await as(admin)
      .post('/exercises')
      .send({ name: 'Seated knee extension', categoryId: await categoryId('STRENGTH'), ...body })
      .expect(201);
    return res.body;
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
    patient = await ctx.createUser({ uid: 'pat-1', role: 'PATIENT', name: 'Rajesh Iyer', doctorIds: [doctor.id] });
  });

  describe('login', () => {
    it('refuses a missing token, an unknown user and a deactivated account', async () => {
      const missing = await http().get('/api/v1/exercise-categories').expect(401);
      expect(missing.body).toMatchObject({ statusCode: 401, code: ERROR_CODES.UNAUTHENTICATED });
      expect(missing.headers['x-request-id']).toBeTruthy();

      await http().get('/api/v1/exercise-categories').set('Authorization', 'Bearer nobody').expect(401);

      const gone = await ctx.createUser({ uid: 'pat-old', role: 'PATIENT', name: 'Old', active: false });
      await as(gone).get('/exercise-categories').expect(401);
    });
  });

  describe('categories', () => {
    it('starts with the four SRS categories, in order, for every role', async () => {
      for (const user of [admin, doctor, patient]) {
        const res = await as(user).get('/exercise-categories').expect(200);
        expect(res.body.data.map((c: { code: string }) => c.code)).toEqual([
          'WALKING',
          'STRENGTH',
          'BREATHING',
          'STRETCHING',
        ]);
      }
    });

    it('lets an admin add one, placed last by default', async () => {
      const res = await as(admin).post('/exercise-categories').send({ code: 'BALANCE', name: ' Balance ' }).expect(201);
      expect(res.body).toMatchObject({ code: 'BALANCE', name: 'Balance', order: 5, active: true });

      const audit = await ctx.connection.collection('auditLogs').findOne({ action: 'EXERCISE_LIBRARY_CHANGED' });
      expect(audit).toMatchObject({ actorRole: 'ADMIN', before: null, after: { category: { code: 'BALANCE' } } });
    });

    it('refuses a taken code, a badly formed code and a non-admin', async () => {
      const taken = await as(admin).post('/exercise-categories').send({ code: 'WALKING', name: 'Walk' }).expect(400);
      expect(taken.body.details).toEqual([expect.objectContaining({ field: 'code', code: DETAIL_CODES.ALREADY_EXISTS })]);

      const bad = await as(admin).post('/exercise-categories').send({ code: 'balance', name: 'Balance' }).expect(400);
      expect(bad.body.details[0]).toMatchObject({ field: 'code', code: DETAIL_CODES.WRONG_SHAPE });

      const forbidden = await as(doctor).post('/exercise-categories').send({ code: 'BALANCE', name: 'B' }).expect(403);
      expect(forbidden.body.code).toBe(ERROR_CODES.FORBIDDEN_ROLE);
    });

    it('renames and reorders, and records nothing when nothing changed', async () => {
      const id = await categoryId('WALKING');
      const res = await as(admin).patch(`/exercise-categories/${id}`).send({ name: 'Walking and steps', order: 9 }).expect(200);
      expect(res.body).toMatchObject({ code: 'WALKING', name: 'Walking and steps', order: 9 });

      await as(admin).patch(`/exercise-categories/${id}`).send({ name: 'Walking and steps' }).expect(200);
      expect(await ctx.connection.collection('auditLogs').countDocuments()).toBe(1);
    });

    it('refuses a change to the code, and 404s an unknown category', async () => {
      const id = await categoryId('WALKING');
      await as(admin).patch(`/exercise-categories/${id}`).send({ code: 'WALK' }).expect(400);
      await as(admin).patch('/exercise-categories/6712a0b1c2d3e4f5a6b7c8d9').send({ name: 'X' }).expect(404);
      await as(admin).patch('/exercise-categories/not-an-id').send({ name: 'X' }).expect(404);
    });

    it('deactivates an unused category: hidden from the list, visible to an admin who asks', async () => {
      const id = await categoryId('BREATHING');
      const res = await as(admin).delete(`/exercise-categories/${id}`).expect(200);
      expect(res.body.active).toBe(false);

      const list = await as(doctor).get('/exercise-categories').expect(200);
      expect(list.body.data.map((c: { code: string }) => c.code)).not.toContain('BREATHING');

      // Only an admin can ask for deactivated ones.
      const doctorAsks = await as(doctor).get('/exercise-categories?includeInactive=true').expect(200);
      expect(doctorAsks.body.data).toHaveLength(3);
      const adminAsks = await as(admin).get('/exercise-categories?includeInactive=true').expect(200);
      expect(adminAsks.body.data).toHaveLength(4);
    });

    it('refuses to deactivate a category while an active exercise uses it', async () => {
      await addExercise();
      const id = await categoryId('STRENGTH');

      const res = await as(admin).delete(`/exercise-categories/${id}`).expect(400);
      expect(res.body.details[0]).toMatchObject({ field: 'active', code: DETAIL_CODES.NOT_ALLOWED });
      const stored = await ctx.connection.collection('exerciseCategories').findOne({ code: 'STRENGTH' });
      expect(stored!.active).toBe(true);
    });

    it('never leaves an active exercise in a deactivated category when both happen at once', async () => {
      for (let round = 0; round < 5; round++) {
        const code = `RACE${round}`;
        const created = await as(admin).post('/exercise-categories').send({ code, name: code }).expect(201);

        const [addition, deactivation] = await Promise.all([
          as(admin).post('/exercises').send({ name: `Race ${round}`, categoryId: created.body.id }),
          as(admin).delete(`/exercise-categories/${created.body.id}`),
        ]);

        // Exactly one wins: either the exercise went in first and the
        // deactivation was refused, or the other way round.
        expect([201, 400]).toContain(addition.status);
        expect([200, 400]).toContain(deactivation.status);
        expect(addition.status === 201).not.toBe(deactivation.status === 200);

        const category = await ctx.connection.collection('exerciseCategories').findOne({ code });
        const activeInIt = await ctx.connection
          .collection('exercises')
          .countDocuments({ categoryId: category!._id, active: true });
        expect(category!.active === false && activeInIt > 0).toBe(false);
        expect(addition.status === 201).toBe(activeInIt === 1);
      }
    });
  });

  describe('exercises', () => {
    it('adds an exercise with its steps and a YouTube link, and audits it', async () => {
      const body = await addExercise({
        description: 'Strengthens the thigh muscles.',
        instructions: [' Sit upright ', 'Straighten one knee slowly'],
        videoUrl: `https://youtu.be/${VIDEO_ID}?si=share`,
      });

      expect(body).toMatchObject({
        name: 'Seated knee extension',
        category: 'STRENGTH',
        description: 'Strengthens the thigh muscles.',
        instructions: ['Sit upright', 'Straighten one knee slowly'],
        video: { provider: 'YOUTUBE', videoId: VIDEO_ID, url: `https://www.youtube.com/watch?v=${VIDEO_ID}` },
        active: true,
      });

      const audit = await ctx.connection.collection('auditLogs').findOne({ resourceId: body.id });
      expect(audit).toMatchObject({
        action: 'EXERCISE_LIBRARY_CHANGED',
        route: 'POST /api/v1/exercises',
        before: null,
        after: { exercise: { name: 'Seated knee extension' } },
      });
    });

    it('takes an exercise without a video, for when the clinic has not sent it yet', async () => {
      const body = await addExercise();
      expect(body).toMatchObject({ video: null, description: null, instructions: [] });
    });

    it('refuses a link that is not a YouTube video', async () => {
      const res = await as(admin)
        .post('/exercises')
        .send({ name: 'X', categoryId: await categoryId('STRENGTH'), videoUrl: 'https://vimeo.com/123' })
        .expect(400);
      expect(res.body.details).toEqual([expect.objectContaining({ field: 'videoUrl', code: DETAIL_CODES.WRONG_SHAPE })]);
    });

    it('refuses an unknown or deactivated category', async () => {
      const unknown = await as(admin)
        .post('/exercises')
        .send({ name: 'X', categoryId: '6712a0b1c2d3e4f5a6b7c8d9' })
        .expect(400);
      expect(unknown.body.details[0]).toMatchObject({ field: 'categoryId', code: DETAIL_CODES.UNKNOWN_ID });

      const id = await categoryId('BREATHING');
      await as(admin).delete(`/exercise-categories/${id}`).expect(200);
      const inactive = await as(admin).post('/exercises').send({ name: 'X', categoryId: id }).expect(400);
      expect(inactive.body.details[0]).toMatchObject({ field: 'categoryId', code: DETAIL_CODES.NOT_ALLOWED });
    });

    it('gives one REQUIRED per missing field and refuses unknown fields', async () => {
      const missing = await as(admin).post('/exercises').send({}).expect(400);
      expect(missing.body.details).toEqual([
        expect.objectContaining({ field: 'name', code: DETAIL_CODES.REQUIRED }),
        expect.objectContaining({ field: 'categoryId', code: DETAIL_CODES.REQUIRED }),
      ]);

      await as(admin)
        .post('/exercises')
        .send({ name: 'X', categoryId: await categoryId('STRENGTH'), sets: 3 })
        .expect(400);
    });

    it('keeps the library away from patients without a plan, and edits away from doctors', async () => {
      const exercise = await addExercise();

      // Patients only see exercises in their own plan; this one has none.
      const list = await as(patient).get('/exercises').expect(200);
      expect(list.body.data).toEqual([]);
      const one = await as(patient).get(`/exercises/${exercise.id}`).expect(404);
      expect(one.body.code).toBe(ERROR_CODES.NOT_FOUND);
      await as(patient).post('/exercises').send({ name: 'X', categoryId: exercise.categoryId }).expect(403);

      await as(doctor).get('/exercises').expect(200);
      await as(doctor).get(`/exercises/${exercise.id}`).expect(200);
      await as(doctor).post('/exercises').send({ name: 'X', categoryId: exercise.categoryId }).expect(403);
      await as(doctor).patch(`/exercises/${exercise.id}`).send({ name: 'Y' }).expect(403);
      await as(doctor).delete(`/exercises/${exercise.id}`).expect(403);
    });

    it('404s an unknown id and a malformed one', async () => {
      await as(doctor).get('/exercises/6712a0b1c2d3e4f5a6b7c8d9').expect(404);
      await as(doctor).get('/exercises/nope').expect(404);
      await as(admin).patch('/exercises/nope').send({ name: 'Y' }).expect(404);
    });

    it('changes an exercise, replaces and removes its video, and audits before and after', async () => {
      const exercise = await addExercise({ videoUrl: VIDEO_ID });

      const renamed = await as(admin)
        .patch(`/exercises/${exercise.id}`)
        .send({ name: 'Knee extension', videoUrl: `https://www.youtube.com/watch?v=aaaaaaaaaaa` })
        .expect(200);
      expect(renamed.body).toMatchObject({ name: 'Knee extension', video: { videoId: 'aaaaaaaaaaa' } });

      const cleared = await as(admin).patch(`/exercises/${exercise.id}`).send({ videoUrl: null }).expect(200);
      expect(cleared.body.video).toBeNull();

      const entries = await ctx.connection
        .collection('auditLogs')
        .find({ resourceId: exercise.id })
        .sort({ at: 1 })
        .toArray();
      expect(entries).toHaveLength(3);
      expect(entries[1]).toMatchObject({
        before: { exercise: { name: 'Seated knee extension', video: { videoId: VIDEO_ID } } },
        after: { exercise: { name: 'Knee extension', video: { videoId: 'aaaaaaaaaaa' } } },
      });
    });

    it('records nothing when an edit changes nothing', async () => {
      const exercise = await addExercise({ instructions: ['Sit upright'], videoUrl: VIDEO_ID });
      await as(admin)
        .patch(`/exercises/${exercise.id}`)
        .send({ name: 'Seated knee extension', instructions: ['Sit upright'], videoUrl: `https://youtu.be/${VIDEO_ID}` })
        .expect(200);
      expect(await ctx.connection.collection('auditLogs').countDocuments({ resourceId: exercise.id })).toBe(1);
    });

    it('refuses null for a field that must have a value', async () => {
      const exercise = await addExercise();
      const res = await as(admin).patch(`/exercises/${exercise.id}`).send({ name: null }).expect(400);
      expect(res.body.details[0]).toMatchObject({ field: 'name' });
    });

    it('moves an exercise only into an active category', async () => {
      const exercise = await addExercise();
      const walking = await categoryId('WALKING');
      const moved = await as(admin).patch(`/exercises/${exercise.id}`).send({ categoryId: walking }).expect(200);
      expect(moved.body).toMatchObject({ categoryId: walking, category: 'WALKING' });

      const breathing = await categoryId('BREATHING');
      await as(admin).delete(`/exercise-categories/${breathing}`).expect(200);
      const refused = await as(admin).patch(`/exercises/${exercise.id}`).send({ categoryId: breathing }).expect(400);
      expect(refused.body.details[0]).toMatchObject({ field: 'categoryId', code: DETAIL_CODES.NOT_ALLOWED });
    });

    it('checks the category on a move even when the exercise is or becomes inactive', async () => {
      const exercise = await addExercise();

      // Moving and switching off in one request: the category must still be real.
      const unknown = await as(admin)
        .patch(`/exercises/${exercise.id}`)
        .send({ categoryId: '6712a0b1c2d3e4f5a6b7c8d9', active: false })
        .expect(400);
      expect(unknown.body.details[0]).toMatchObject({ field: 'categoryId', code: DETAIL_CODES.UNKNOWN_ID });

      // An exercise that is already off can't be moved into a switched-off category either.
      await as(admin).delete(`/exercises/${exercise.id}`).expect(200);
      const breathing = await categoryId('BREATHING');
      await as(admin).delete(`/exercise-categories/${breathing}`).expect(200);
      const inactive = await as(admin).patch(`/exercises/${exercise.id}`).send({ categoryId: breathing }).expect(400);
      expect(inactive.body.details[0]).toMatchObject({ field: 'categoryId', code: DETAIL_CODES.NOT_ALLOWED });

      // Nothing was changed, so it still reads back with its category code.
      const stored = await as(admin).get(`/exercises/${exercise.id}`).expect(200);
      expect(stored.body.category).toBe('STRENGTH');
    });

    it('answers an over-size body with 413, not a server error', async () => {
      const res = await as(admin)
        .post('/exercises')
        .send({ name: 'X', categoryId: await categoryId('STRENGTH'), description: 'x'.repeat(40_000) })
        .expect(413);
      expect(res.body).toMatchObject({ statusCode: 413, code: ERROR_CODES.PAYLOAD_TOO_LARGE, error: 'Payload Too Large' });
    });

    it('deactivates instead of deleting, and brings back only into an active category', async () => {
      const exercise = await addExercise();

      const gone = await as(admin).delete(`/exercises/${exercise.id}`).expect(200);
      expect(gone.body.active).toBe(false);
      expect(await ctx.connection.collection('exercises').countDocuments()).toBe(1);

      // Still readable by id (old plans point at it), but off the default list.
      await as(doctor).get(`/exercises/${exercise.id}`).expect(200);
      const list = await as(doctor).get('/exercises').expect(200);
      expect(list.body.data).toHaveLength(0);
      const inactive = await as(doctor).get('/exercises?active=false').expect(200);
      expect(inactive.body.data).toHaveLength(1);

      // Its category can now be switched off; bringing it back is then refused.
      await as(admin).delete(`/exercise-categories/${exercise.categoryId}`).expect(200);
      await as(admin).patch(`/exercises/${exercise.id}`).send({ active: true }).expect(400);

      await as(admin).patch(`/exercise-categories/${exercise.categoryId}`).send({ active: true }).expect(200);
      const back = await as(admin).patch(`/exercises/${exercise.id}`).send({ active: true }).expect(200);
      expect(back.body.active).toBe(true);
    });

    describe('list', () => {
      beforeEach(async () => {
        const strength = await categoryId('STRENGTH');
        const walking = await categoryId('WALKING');
        for (const [name, category] of [
          ['wall push-up', strength],
          ['Arm raise', strength],
          ['Brisk walk', walking],
          ['arm circles', strength],
          ['Calf raise (standing)', strength],
        ]) {
          await as(admin).post('/exercises').send({ name, categoryId: category }).expect(201);
        }
      });

      it('sorts A to Z ignoring case', async () => {
        const res = await as(doctor).get('/exercises').expect(200);
        expect(res.body.data.map((e: { name: string }) => e.name)).toEqual([
          'arm circles',
          'Arm raise',
          'Brisk walk',
          'Calf raise (standing)',
          'wall push-up',
        ]);
        expect(res.body.nextCursor).toBeNull();
      });

      it('pages with a cursor, without repeats or gaps', async () => {
        const names: string[] = [];
        let cursor: string | null = null;
        let pages = 0;
        do {
          const query: string = cursor ? `?limit=2&cursor=${cursor}` : '?limit=2';
          const res = await as(doctor).get(`/exercises${query}`).expect(200);
          names.push(...res.body.data.map((e: { name: string }) => e.name));
          cursor = res.body.nextCursor;
          pages++;
        } while (cursor);

        expect(pages).toBe(3);
        expect(names).toHaveLength(5);
        expect(new Set(names).size).toBe(5);
      });

      it('filters by category code and searches by name', async () => {
        const walking = await as(doctor).get('/exercises?category=WALKING').expect(200);
        expect(walking.body.data.map((e: { name: string }) => e.name)).toEqual(['Brisk walk']);

        const unknown = await as(doctor).get('/exercises?category=NOPE').expect(200);
        expect(unknown.body.data).toEqual([]);

        const arm = await as(doctor).get('/exercises?q=ARM').expect(200);
        expect(arm.body.data).toHaveLength(2);

        // Regex characters are matched literally, not as a pattern.
        const brackets = await as(doctor).get(`/exercises?q=${encodeURIComponent('(standing)')}`).expect(200);
        expect(brackets.body.data.map((e: { name: string }) => e.name)).toEqual(['Calf raise (standing)']);
        await as(doctor).get(`/exercises?q=${encodeURIComponent('.*')}`).expect(200).expect((res) => {
          expect(res.body.data).toEqual([]);
        });
      });

      it('rejects a bad cursor or limit as a 400', async () => {
        await as(doctor).get('/exercises?cursor=rubbish').expect(400);
        await as(doctor).get('/exercises?limit=0').expect(400);
        await as(doctor).get('/exercises?limit=101').expect(400);
      });
    });
  });
});
