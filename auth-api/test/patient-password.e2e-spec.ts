import request from 'supertest';
import { getStorageToken } from '@nestjs/throttler';
import { createTestApp, TestContext, TestUser } from './helpers/test-app';

/** Issue #20: a code for the first sign-in and for resets, a password after that. */
describe('Patient password (code first, then phone + password)', () => {
  let t: TestContext;
  let doctor: TestUser;
  let patient: TestUser;
  const PHONE = '+919876543210';
  const api = () => request(t.app.getHttpServer());

  const passwordLogin = (password: string, phone = '9876543210') =>
    api().post('/api/v1/auth/password-login').send({ phone, password });
  const setPassword = (password: string, bearer: string) =>
    api().put('/api/v1/users/me/password').set('Authorization', `Bearer ${bearer}`).send({ password });
  const me = (bearer: string) => api().get('/api/v1/auth/me').set('Authorization', `Bearer ${bearer}`);

  /** Doctor makes a code, the patient signs in with it: the bearer token of that session. */
  const signInWithCode = async () => {
    const issued = await api().post(`/api/v1/patients/${patient.id}/login-code`).set('Authorization', t.auth(doctor)).expect(201);
    const verified = await api().post('/api/v1/auth/login-code/verify').send({ phone: PHONE, code: issued.body.code }).expect(200);
    return t.identity.signInWithCustomToken(verified.body.customToken);
  };
  const signInWithPassword = async (password: string) => {
    const res = await passwordLogin(password).expect(200);
    return t.identity.signInWithCustomToken(res.body.customToken);
  };

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => t.close());
  /** The sign-in routes allow 10 calls a minute per address; some tests here make more. */
  const resetRateLimits = () => {
    const limits = t.app.get(getStorageToken()) as { storage: Map<string, unknown>; hitExpirations: Map<string, unknown> };
    limits.storage.clear();
    limits.hitExpirations.clear();
  };

  beforeEach(async () => {
    await t.reset();
    resetRateLimits();
    doctor = await t.seed({ role: 'DOCTOR', name: 'Dr Meera Nair' });
    patient = await t.seed({ role: 'PATIENT', name: 'Rajesh Iyer', phone: PHONE, doctorIds: [doctor.id], emailVerified: false });
  });

  it('the whole flow: code, set a password, then sign in with phone and password', async () => {
    const codeSession = await signInWithCode();
    expect((await me(codeSession).expect(200)).body).toMatchObject({ loginMethod: 'LOGIN_CODE', hasPassword: false });

    const set = await setPassword('ganga123', codeSession).expect(200);
    expect(set.body).toEqual({ hasPassword: true, passwordSetAt: expect.stringMatching(/\+05:30$/) });
    expect((await me(codeSession).expect(200)).body.hasPassword).toBe(true);

    const passwordSession = await signInWithPassword('ganga123');
    expect((await me(passwordSession).expect(200)).body).toMatchObject({ id: patient.id, loginMethod: 'PASSWORD', hasPassword: true });
    // No email to verify: let through like a code sign-in.
    await api().get('/api/v1/patients/me/medical-profile').set('Authorization', `Bearer ${passwordSession}`).expect(200);

    const actions = (await t.connection.collection('auditLogs').find({ action: /^PATIENT_PASSWORD_/ }).sort({ at: 1 }).toArray()).map((a) => a.action);
    expect(actions).toEqual(['PATIENT_PASSWORD_SET', 'PATIENT_PASSWORD_SIGN_IN']);
  });

  it('only a hash is stored, and the password is never logged or sent back', async () => {
    await setPassword('ganga123', await signInWithCode()).expect(200);
    const stored = await t.connection.collection('users').findOne({ phone: PHONE });
    expect(stored!.passwordHash).toMatch(/^scrypt\$/);
    const everything = JSON.stringify(await t.connection.collection('auditLogs').find({}).toArray());
    expect(everything).not.toContain('ganga123');
    expect(everything).not.toContain(stored!.passwordHash);

    const session = await signInWithPassword('ganga123');
    const profile = await api().get('/api/v1/users/me/profile').set('Authorization', `Bearer ${session}`).expect(200);
    expect(JSON.stringify(profile.body)).not.toContain('scrypt');
    const list = await api().get('/api/v1/patients').set('Authorization', t.auth(doctor)).expect(200);
    expect(JSON.stringify(list.body)).not.toContain('scrypt');
  });

  it('forgot the password: a new code from the doctor, then a new password', async () => {
    await setPassword('old-pass', await signInWithCode()).expect(200);
    await setPassword('new-pass', await signInWithCode()).expect(200);
    await passwordLogin('old-pass').expect(401);
    await signInWithPassword('new-pass');
  });

  it('a password session cannot change the password: that needs a fresh code', async () => {
    await setPassword('ganga123', await signInWithCode()).expect(200);
    const res = await setPassword('changed1', await signInWithPassword('ganga123')).expect(403);
    expect(res.body.code).toBe('LOGIN_CODE_SESSION_REQUIRED');
  });

  it('one answer for a wrong password, an unknown number, and no password yet', async () => {
    const none = await passwordLogin('ganga123').expect(401);
    expect(none.body.code).toBe('INVALID_CREDENTIALS');
    await setPassword('ganga123', await signInWithCode()).expect(200);
    const wrong = await passwordLogin('ganga124').expect(401);
    const unknown = await passwordLogin('ganga123', '9123456789').expect(401);
    expect(wrong.body).toMatchObject({ code: 'INVALID_CREDENTIALS', message: none.body.message });
    expect(unknown.body).toMatchObject({ code: 'INVALID_CREDENTIALS', message: none.body.message });
  });

  it('5 wrong tries lock password sign-in for 15 minutes; a code still works and resets it', async () => {
    await setPassword('ganga123', await signInWithCode()).expect(200);
    for (let i = 0; i < 5; i++) await passwordLogin('nope-nope').expect(401);
    // Locked: even the right password is refused now.
    await passwordLogin('ganga123').expect(401);
    expect(await t.connection.collection('auditLogs').countDocuments({ action: 'PATIENT_PASSWORD_LOCKED' })).toBe(1);

    // 15 minutes later it works again.
    await t.connection.collection('users').updateOne({ phone: PHONE }, { $set: { passwordLockedUntil: new Date(Date.now() - 1000) } });
    await signInWithPassword('ganga123');

    // Or straight away: the doctor's code, then a new password, clears the lock.
    resetRateLimits();
    for (let i = 0; i < 5; i++) await passwordLogin('nope-nope').expect(401);
    await setPassword('fresh-one', await signInWithCode()).expect(200);
    await signInWithPassword('fresh-one');
  });

  it('a right password resets the count of wrong ones', async () => {
    await setPassword('ganga123', await signInWithCode()).expect(200);
    for (let i = 0; i < 4; i++) await passwordLogin('nope-nope').expect(401);
    await signInWithPassword('ganga123');
    resetRateLimits();
    for (let i = 0; i < 4; i++) await passwordLogin('nope-nope').expect(401);
    await signInWithPassword('ganga123');
  });

  it('a deactivated patient cannot sign in with their password', async () => {
    await setPassword('ganga123', await signInWithCode()).expect(200);
    await t.connection.collection('users').updateOne({ phone: PHONE }, { $set: { active: false } });
    await passwordLogin('ganga123').expect(401);
  });

  it('at least 6 characters; patients only', async () => {
    const session = await signInWithCode();
    const short = await setPassword('12345', session).expect(400);
    expect(short.body.details[0]).toMatchObject({ field: 'password', issue: expect.stringContaining('6 to 128') });
    await setPassword('123456', session).expect(200);
    await api().put('/api/v1/users/me/password').set('Authorization', t.auth(doctor)).send({ password: 'doctor-pass' }).expect(403);
  });

  it('staff get hasPassword null', async () => {
    const res = await api().get('/api/v1/auth/me').set('Authorization', t.auth(doctor)).expect(200);
    expect(res.body).toMatchObject({ loginMethod: 'PASSWORD', hasPassword: null });
  });
});
