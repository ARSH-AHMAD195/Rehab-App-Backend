import request from 'supertest';
import { createTestApp, TestContext } from './helpers/test-app';

describe('Identity and own profile', () => {
  let t: TestContext;
  const api = () => request(t.app.getHttpServer());

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => t.close());
  beforeEach(async () => t.reset());

  describe('GET /auth/me', () => {
    it('returns identity and role', async () => {
      const doctor = await t.seed({ role: 'DOCTOR', name: 'Dr Meera Nair' });
      const res = await api().get('/api/v1/auth/me').set('Authorization', t.auth(doctor)).expect(200);
      expect(res.body).toEqual({
        id: doctor.id,
        role: 'DOCTOR',
        name: 'Dr Meera Nair',
        email: doctor.email,
        emailVerified: true,
        active: true,
      });
    });

    it('works for an unverified user, so the app can show the verify screen', async () => {
      const patient = await t.seed({ role: 'PATIENT', name: 'Rajesh', emailVerified: false });
      const res = await api().get('/api/v1/auth/me').set('Authorization', t.auth(patient)).expect(200);
      expect(res.body.emailVerified).toBe(false);
    });

    it('401 without a token, with a bad token, or for a deactivated user', async () => {
      const gone = await t.seed({ role: 'PATIENT', name: 'Gone', active: false });
      await api().get('/api/v1/auth/me').expect(401);
      const bad = await api().get('/api/v1/auth/me').set('Authorization', 'Bearer nope').expect(401);
      expect(bad.body.code).toBe('UNAUTHENTICATED');
      await api().get('/api/v1/auth/me').set('Authorization', t.auth(gone)).expect(401);
    });

    it('401 for a valid Firebase login that has no profile', async () => {
      t.identity.accounts.set('orphan', { email: 'x@test.example', emailVerified: true, disabled: false });
      await api().get('/api/v1/auth/me').set('Authorization', 'Bearer orphan').expect(401);
    });

    it('returns a request id on every response', async () => {
      const res = await api().get('/api/v1/auth/me').set('X-Request-Id', 'req-123').expect(401);
      expect(res.headers['x-request-id']).toBe('req-123');
      expect(res.body.requestId).toBe('req-123');
    });
  });

  describe('email verification', () => {
    it('403 EMAIL_NOT_VERIFIED on every other route until verified', async () => {
      const patient = await t.seed({ role: 'PATIENT', name: 'Rajesh', emailVerified: false });
      const res = await api().get('/api/v1/users/me/profile').set('Authorization', t.auth(patient)).expect(403);
      expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');

      t.identity.verifyEmail(patient.uid);
      await api().get('/api/v1/users/me/profile').set('Authorization', t.auth(patient)).expect(200);
    });

    it('keeps the stored emailVerified in step with Firebase', async () => {
      const doctor = await t.seed({ role: 'DOCTOR', name: 'Dr A' });
      const patient = await t.seed({ role: 'PATIENT', name: 'P', doctorIds: [doctor.id], emailVerified: false });
      t.identity.verifyEmail(patient.uid);
      await api().get('/api/v1/auth/me').set('Authorization', t.auth(patient)).expect(200);

      const res = await api().get(`/api/v1/patients/${patient.id}`).set('Authorization', t.auth(doctor)).expect(200);
      expect(res.body.emailVerified).toBe(true);
    });
  });

  describe('GET /users/me/profile', () => {
    it('patient: time zone and doctors', async () => {
      const doctor = await t.seed({ role: 'DOCTOR', name: 'Dr Meera Nair' });
      const patient = await t.seed({ role: 'PATIENT', name: 'Rajesh', doctorIds: [doctor.id] });
      const res = await api().get('/api/v1/users/me/profile').set('Authorization', t.auth(patient)).expect(200);
      expect(res.body).toMatchObject({
        id: patient.id,
        role: 'PATIENT',
        timeZone: 'Asia/Kolkata',
        doctors: [{ id: doctor.id, name: 'Dr Meera Nair' }],
      });
      expect(res.body.createdAt).toMatch(/\+05:30$/);
      expect(res.body).not.toHaveProperty('specialization');
    });

    it('doctor: specialization, no time zone', async () => {
      const doctor = await t.seed({ role: 'DOCTOR', name: 'Dr A' });
      const res = await api().get('/api/v1/users/me/profile').set('Authorization', t.auth(doctor)).expect(200);
      expect(res.body).toHaveProperty('specialization', null);
      expect(res.body).not.toHaveProperty('timeZone');
      expect(res.body).not.toHaveProperty('doctors');
    });
  });

  describe('PATCH /users/me/profile', () => {
    it('updates and audits only what changed', async () => {
      const patient = await t.seed({ role: 'PATIENT', name: 'Rajesh' });
      const res = await api()
        .patch('/api/v1/users/me/profile')
        .set('Authorization', t.auth(patient))
        .send({ name: 'Rajesh Iyer', phone: '+919876543210', timeZone: 'Asia/Kolkata' })
        .expect(200);
      expect(res.body).toMatchObject({ name: 'Rajesh Iyer', phone: '+919876543210' });

      const audit = await t.connection.collection('auditLogs').findOne({ action: 'PROFILE_UPDATED' });
      expect(audit).toMatchObject({
        actorRole: 'PATIENT',
        before: { name: 'Rajesh', phone: null },
        after: { name: 'Rajesh Iyer', phone: '+919876543210' },
        route: 'PATCH /api/v1/users/me/profile',
      });
      expect(String(audit!.patientId)).toBe(patient.id);
    });

    it('re-sending the same body writes no audit record', async () => {
      const patient = await t.seed({ role: 'PATIENT', name: 'Rajesh' });
      for (let i = 0; i < 2; i++) {
        await api().patch('/api/v1/users/me/profile').set('Authorization', t.auth(patient)).send({ name: 'R' }).expect(200);
      }
      expect(await t.connection.collection('auditLogs').countDocuments({ action: 'PROFILE_UPDATED' })).toBe(1);
    });

    it('400 for role-specific fields on the wrong role', async () => {
      const doctor = await t.seed({ role: 'DOCTOR', name: 'Dr A' });
      const patient = await t.seed({ role: 'PATIENT', name: 'P' });
      const a = await api().patch('/api/v1/users/me/profile').set('Authorization', t.auth(doctor)).send({ timeZone: 'Asia/Kolkata' }).expect(400);
      expect(a.body.details[0]).toMatchObject({ field: 'timeZone', code: 'NOT_ALLOWED' });
      await api().patch('/api/v1/users/me/profile').set('Authorization', t.auth(patient)).send({ specialization: 'x' }).expect(400);
      await api().patch('/api/v1/users/me/profile').set('Authorization', t.auth(doctor)).send({ specialization: 'Oncology' }).expect(200);
    });

    it('400 for email, role or active, which cannot be changed here', async () => {
      const patient = await t.seed({ role: 'PATIENT', name: 'P' });
      for (const body of [{ email: 'new@test.example' }, { role: 'ADMIN' }, { active: false }, { doctorIds: [] }]) {
        const res = await api().patch('/api/v1/users/me/profile').set('Authorization', t.auth(patient)).send(body).expect(400);
        expect(res.body.code).toBe('VALIDATION_FAILED');
      }
    });

    it('400 for a bad phone, an unknown time zone, or a null name', async () => {
      const patient = await t.seed({ role: 'PATIENT', name: 'P' });
      for (const body of [{ phone: '98765' }, { timeZone: 'Mars/Olympus' }, { name: null }, { name: '' }]) {
        await api().patch('/api/v1/users/me/profile').set('Authorization', t.auth(patient)).send(body).expect(400);
      }
    });

    it('null clears the phone', async () => {
      const patient = await t.seed({ role: 'PATIENT', name: 'P' });
      await api().patch('/api/v1/users/me/profile').set('Authorization', t.auth(patient)).send({ phone: '+919876543210' }).expect(200);
      const res = await api().patch('/api/v1/users/me/profile').set('Authorization', t.auth(patient)).send({ phone: null }).expect(200);
      expect(res.body.phone).toBeNull();
    });
  });
});
