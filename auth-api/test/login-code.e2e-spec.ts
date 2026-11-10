import request from 'supertest';
import { getStorageToken } from '@nestjs/throttler';
import { createTestApp, TestContext, TestUser } from './helpers/test-app';

describe('Login code (doctor-issued, no SMS)', () => {
  let t: TestContext;
  let admin: TestUser;
  let doctor: TestUser;
  let otherDoctor: TestUser;
  let patient: TestUser;
  const PHONE = '+919876543210';
  const api = () => request(t.app.getHttpServer());
  const requestCode = (phone = PHONE) => api().post('/api/v1/auth/login-code/request').send({ phone });
  const verify = (code: string, phone = PHONE) => api().post('/api/v1/auth/login-code/verify').send({ phone, code });
  const issue = (caller: TestUser, patientId = patient.id) =>
    api().post(`/api/v1/patients/${patientId}/login-code`).set('Authorization', t.auth(caller));
  const wrong = (code: string) => (code === '000000' ? '000001' : '000000');

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => t.close());
  beforeEach(async () => {
    await t.reset();
    // Every test here calls the 10-per-minute sign-in routes; start each one with a clean count.
    const limits = t.app.get(getStorageToken()) as { storage: Map<string, unknown>; hitExpirations: Map<string, unknown> };
    limits.storage.clear();
    limits.hitExpirations.clear();
    admin = await t.seed({ role: 'ADMIN', name: 'Admin' });
    doctor = await t.seed({ role: 'DOCTOR', name: 'Dr Meera Nair' });
    otherDoctor = await t.seed({ role: 'DOCTOR', name: 'Dr Other' });
    patient = await t.seed({ role: 'PATIENT', name: 'Rajesh Iyer', phone: PHONE, doctorIds: [doctor.id] });
  });

  it('the whole flow: patient asks, doctor makes a code, patient signs in with it', async () => {
    const asked = await requestCode().expect(202);
    expect(asked.body.message).toMatch(/doctor/);

    const list = await api().get('/api/v1/doctor/login-code-requests').set('Authorization', t.auth(doctor)).expect(200);
    expect(list.body.data).toEqual([
      { patient: { id: patient.id, name: 'Rajesh Iyer', phone: PHONE }, requestedAt: expect.stringMatching(/\+05:30$/) },
    ]);

    const issued = await issue(doctor).expect(201);
    expect(issued.body).toMatchObject({ patientId: patient.id, phone: PHONE, expiresInMinutes: 10, maxAttempts: 5 });
    expect(issued.body.code).toMatch(/^\d{6}$/);
    expect(issued.body.expiresAt).toMatch(/\+05:30$/);

    // Making the code closes the request.
    const after = await api().get('/api/v1/doctor/login-code-requests').set('Authorization', t.auth(doctor)).expect(200);
    expect(after.body.data).toEqual([]);

    const signedIn = await verify(issued.body.code).expect(200);
    expect(signedIn.body.customToken).toBeDefined();

    // The app signs in to Firebase with it and uses normal tokens from then on.
    const uid = t.identity.signInWithCustomToken(signedIn.body.customToken);
    expect(uid).toBe(patient.uid);
    t.identity.accounts.get(uid)!.emailVerified = false; // a code patient has no verified email
    const me = await api().get('/api/v1/auth/me').set('Authorization', t.auth(patient)).expect(200);
    expect(me.body).toMatchObject({ id: patient.id, loginMethod: 'LOGIN_CODE', emailVerified: false });
    // ...and is let through everywhere a verified email is needed.
    await api().get('/api/v1/patients/me/medical-profile').set('Authorization', t.auth(patient)).expect(200);

    const audits = await t.connection.collection('auditLogs').find({ action: /^LOGIN_CODE_/ }).sort({ at: 1 }).toArray();
    expect(audits.map((a) => a.action)).toEqual(['LOGIN_CODE_REQUESTED', 'LOGIN_CODE_ISSUED', 'LOGIN_CODE_USED']);
    expect(audits[1]).toMatchObject({ actorId: expect.anything(), actorRole: 'DOCTOR' });
    // The code itself is never written anywhere.
    expect(JSON.stringify(audits)).not.toContain(issued.body.code);
    const row = await t.connection.collection('loginCodes').findOne({});
    expect(row).toBeNull(); // used, so gone
  });

  it('a doctor can make a code without being asked', async () => {
    const issued = await issue(doctor).expect(201);
    await verify(issued.body.code).expect(200);
  });

  it('a code works only once', async () => {
    const issued = await issue(doctor).expect(201);
    await verify(issued.body.code).expect(200);
    const again = await verify(issued.body.code).expect(401);
    expect(again.body.code).toBe('INVALID_LOGIN_CODE');
  });

  it('5 wrong tries use the code up, even the right code fails after that', async () => {
    const issued = await issue(doctor).expect(201);
    for (let i = 0; i < 5; i++) await verify(wrong(issued.body.code)).expect(401);
    await verify(issued.body.code).expect(401);
  });

  it('4 wrong tries still leave the 5th for the right code', async () => {
    const issued = await issue(doctor).expect(201);
    for (let i = 0; i < 4; i++) await verify(wrong(issued.body.code)).expect(401);
    await verify(issued.body.code).expect(200);
  });

  it('an expired code fails', async () => {
    const issued = await issue(doctor).expect(201);
    await t.connection.collection('loginCodes').updateOne({}, { $set: { codeExpiresAt: new Date(Date.now() - 1000) } });
    await verify(issued.body.code).expect(401);
  });

  it('a new code replaces the old one', async () => {
    const first = await issue(doctor).expect(201);
    const second = await issue(doctor).expect(201);
    if (first.body.code !== second.body.code) await verify(first.body.code).expect(401);
    await verify(second.body.code).expect(200);
  });

  it('parallel tries with the right code sign in only once', async () => {
    const issued = await issue(doctor).expect(201);
    const results = await Promise.all(Array.from({ length: 4 }, () => verify(issued.body.code)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 401)).toHaveLength(3);
  });

  it('an unknown number gets the same answers as a known one', async () => {
    const asked = await requestCode('+919999999999').expect(202);
    const known = await requestCode().expect(202);
    expect(asked.body).toEqual(known.body);
    expect(await t.connection.collection('loginCodes').countDocuments({})).toBe(1);

    const unknown = await verify('123456', '+919999999999').expect(401);
    const issued = await issue(doctor).expect(201);
    const bad = await verify(wrong(issued.body.code)).expect(401);
    // Same code and wording; only the per-request id differs.
    const visible = (body: { code: string; message: string }) => ({ code: body.code, message: body.message });
    expect(visible(unknown.body)).toEqual(visible(bad.body));
  });

  it('asking again within a minute adds nothing', async () => {
    await requestCode().expect(202);
    await requestCode().expect(202);
    expect(await t.connection.collection('auditLogs').countDocuments({ action: 'LOGIN_CODE_REQUESTED' })).toBe(1);
  });

  it('a deactivated patient cannot ask, get a code or sign in', async () => {
    const issued = await issue(doctor).expect(201);
    await t.connection.collection('users').updateOne({ phone: PHONE }, { $set: { active: false } });
    await verify(issued.body.code).expect(401);
    await requestCode().expect(202);
    expect((await t.connection.collection('loginCodes').findOne({}))?.requestedAt ?? null).toBeNull();
    const res = await issue(doctor).expect(409);
    expect(res.body.code).toBe('USER_INACTIVE');
  });

  describe('who can make codes and see requests', () => {
    it('an unlinked doctor gets 404 and does not see the request', async () => {
      await requestCode().expect(202);
      await issue(otherDoctor).expect(404);
      const list = await api().get('/api/v1/doctor/login-code-requests').set('Authorization', t.auth(otherDoctor)).expect(200);
      expect(list.body.data).toEqual([]);
    });

    it('an admin sees every request and can make a code', async () => {
      await requestCode().expect(202);
      const list = await api().get('/api/v1/doctor/login-code-requests').set('Authorization', t.auth(admin)).expect(200);
      expect(list.body.data).toHaveLength(1);
      const issued = await issue(admin).expect(201);
      await verify(issued.body.code).expect(200);
      const audit = await t.connection.collection('auditLogs').findOne({ action: 'LOGIN_CODE_ISSUED' });
      expect(audit?.actorRole).toBe('ADMIN');
    });

    it('a patient cannot make codes or see requests', async () => {
      await issue(patient).expect(403);
      await api().get('/api/v1/doctor/login-code-requests').set('Authorization', t.auth(patient)).expect(403);
    });

    it('400 when the patient has no phone number', async () => {
      const noPhone = await t.seed({ role: 'PATIENT', name: 'No Phone', doctorIds: [doctor.id] });
      const res = await issue(doctor, noPhone.id).expect(400);
      expect(res.body.details[0]).toMatchObject({ field: 'phone', code: 'REQUIRED' });
    });

    it('a doctor signed in with a custom token still needs a verified email', async () => {
      const account = t.identity.accounts.get(doctor.uid)!;
      account.emailVerified = false;
      account.signInProvider = 'custom';
      const res = await api().get('/api/v1/patients').set('Authorization', t.auth(doctor)).expect(403);
      expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');
    });
  });

  describe('registering a patient by phone', () => {
    it('phone only: no email is sent, and they sign in with a code', async () => {
      const res = await api()
        .post('/api/v1/patients')
        .set('Authorization', t.auth(doctor))
        .send({ name: 'Sunita Rao', phone: '+919811111111' })
        .expect(201);
      expect(res.body).toMatchObject({ email: null, phone: '+919811111111', invitation: 'NOT_NEEDED' });
      expect(t.identity.sentEmails).toEqual([]);

      const issued = await issue(doctor, res.body.id).expect(201);
      const signedIn = await verify(issued.body.code, '+919811111111').expect(200);
      const uid = t.identity.signInWithCustomToken(signedIn.body.customToken);
      await api().get('/api/v1/patients/me/medical-profile').set('Authorization', `Bearer ${uid}`).expect(200);
    });

    it('400 with neither phone nor email', async () => {
      const res = await api().post('/api/v1/patients').set('Authorization', t.auth(doctor)).send({ name: 'Nobody' }).expect(400);
      expect(res.body.details).toEqual([expect.objectContaining({ field: 'phone', code: 'REQUIRED' })]);
    });

    it("409 PHONE_ALREADY_EXISTS for another patient's number, on registration and on edit", async () => {
      const dup = await api()
        .post('/api/v1/patients')
        .set('Authorization', t.auth(doctor))
        .send({ name: 'Copy', phone: PHONE })
        .expect(409);
      expect(dup.body.code).toBe('PHONE_ALREADY_EXISTS');

      const other = await t.seed({ role: 'PATIENT', name: 'Other', phone: '+919822222222', doctorIds: [doctor.id] });
      const edit = await api()
        .patch(`/api/v1/patients/${other.id}`)
        .set('Authorization', t.auth(doctor))
        .send({ phone: PHONE })
        .expect(409);
      expect(edit.body.code).toBe('PHONE_ALREADY_EXISTS');
    });

    it("a doctor may share a patient's number", async () => {
      await api()
        .post('/api/v1/doctors')
        .set('Authorization', t.auth(admin))
        .send({ name: 'Dr Desk', email: 'desk@test.example', phone: PHONE })
        .expect(201);
    });

    it('a doctor finds a patient by phone number', async () => {
      const res = await api().get('/api/v1/patients?q=98765').set('Authorization', t.auth(doctor)).expect(200);
      expect(res.body.data.map((p: { id: string }) => p.id)).toEqual([patient.id]);
    });
  });

  describe('validation and limits', () => {
    it.each([
      ['request', { phone: '9876543210' }],
      ['verify', { phone: PHONE, code: '12345' }],
      ['verify', { phone: PHONE, code: '12a456' }],
      ['verify', { phone: PHONE }],
    ])('400 on %s with %j', async (route, body) => {
      const res = await api().post(`/api/v1/auth/login-code/${route}`).send(body).expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });

    it('the 11th sign-in try in a minute from one address gets 429', async () => {
      for (let i = 0; i < 10; i++) await verify('123456').expect(401);
      const res = await verify('123456').expect(429);
      expect(res.body.code).toBe('RATE_LIMITED');
      expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    });
  });
});
