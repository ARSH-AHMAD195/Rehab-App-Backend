import request from 'supertest';
import { DateTime } from 'luxon';
import { Types } from 'mongoose';
import { DEFAULT_TRIAGE_RULES } from '../src/triage/triage-rules';
import { createTestApp, TestContext, TestUser } from './helpers/test-app';

describe('Triage tag', () => {
  let t: TestContext;
  let admin: TestUser;
  let doctor: TestUser;
  let otherDoctor: TestUser;
  let patient: TestUser;
  const api = () => request(t.app.getHttpServer());
  const today = () => DateTime.now().setZone('Asia/Kolkata').startOf('day');
  const daysAgo = (n: number) => today().minus({ days: n }).toISODate()!;
  const yearsAgo = (n: number, extraDays = 0) => today().minus({ years: n, days: extraDays }).toISODate()!;

  const triage = (as: TestUser = doctor) => api().get(`/api/v1/patients/${patient.id}/triage`).set('Authorization', t.auth(as));
  const profile = (body: Record<string, unknown>) =>
    api().patch(`/api/v1/patients/${patient.id}/medical-profile`).set('Authorization', t.auth(doctor)).send(body);
  const result = (test: string, values: Record<string, unknown>, takenOn = daysAgo(1)) =>
    api().post(`/api/v1/patients/${patient.id}/investigations`).set('Authorization', t.auth(doctor)).send({ test, takenOn, values });
  /** Health Monitoring's daily log, written directly (that API isn't running here). */
  const vitals = (date: string, readings: Record<string, unknown>) =>
    t.connection.collection('dailyLogs').insertOne({
      patientId: new Types.ObjectId(patient.id),
      date,
      timeZone: 'Asia/Kolkata',
      readings: Object.fromEntries(Object.entries(readings).map(([k, value]) => [k, { value, status: 'LOGGED' }])),
    });

  /** Everything filled in, nothing at a cut-off. */
  const completeLowRisk = async () => {
    await profile({
      version: 0,
      dateOfBirth: yearsAgo(45),
      smokingStatus: 'NEVER',
      canClimbTwoFlights: true,
      chemotherapy: false,
      conditions: [],
    }).expect(200);
    await result('HB', { value: 13.4 }).expect(201);
    await result('ALBUMIN', { value: 4.1 }).expect(201);
    await result('MUST', { score: 0 }).expect(201);
    await vitals(daysAgo(0), { BP: { systolic: 122, diastolic: 78 }, PULSE: { num: 74 } });
  };

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => t.close());
  beforeEach(async () => {
    await t.reset();
    admin = await t.seed({ role: 'ADMIN', name: 'Admin' });
    doctor = await t.seed({ role: 'DOCTOR', name: 'Dr Meera Nair' });
    otherDoctor = await t.seed({ role: 'DOCTOR', name: 'Dr Other' });
    patient = await t.seed({ role: 'PATIENT', name: 'Rajesh Iyer', doctorIds: [doctor.id] });
  });

  it('a new patient is LOW but incomplete and provisional, listing what is missing', async () => {
    const res = await triage().expect(200);
    expect(res.body).toMatchObject({
      patientId: patient.id,
      tag: 'LOW',
      reasons: [],
      complete: false,
      provisional: true,
      rulesVersion: 1,
      evaluatedOn: today().toISODate(),
    });
    expect(res.body.missing.map((m: { parameter: string }) => m.parameter)).toEqual([
      'AGE', 'HAEMOGLOBIN', 'ALBUMIN', 'NUTRITION_MUST', 'SMOKING', 'HYPERTENSION', 'RESTING_HEART_RATE', 'FUNCTIONAL_CAPACITY',
    ]);
    expect(await t.connection.collection('auditLogs').countDocuments({ action: 'TRIAGE_VIEWED' })).toBe(1);
  });

  it('a complete low-risk patient is LOW and complete', async () => {
    await completeLowRisk();
    const res = await triage().expect(200);
    expect(res.body).toMatchObject({ tag: 'LOW', reasons: [], missing: [], complete: true });
  });

  it('updates as soon as new values are entered: profile, investigations and vitals', async () => {
    await completeLowRisk();

    // Age 64: one Medium.
    await profile({ version: 1, dateOfBirth: yearsAgo(64) }).expect(200);
    expect((await triage()).body).toMatchObject({ tag: 'MEDIUM', reasons: [expect.objectContaining({ parameter: 'AGE', level: 'MEDIUM' })] });

    // Hb 9.4 as well: two Mediums -> HIGH.
    await result('HB', { value: 9.4 }, daysAgo(0)).expect(201);
    expect((await triage()).body.tag).toBe('HIGH');

    // Better Hb, newer date: back to MEDIUM.
    await result('HB', { value: 12.1 }, daysAgo(0)).expect(201);
    expect((await triage()).body.tag).toBe('MEDIUM');

    // A pulse of 105 today in Health Monitoring: HIGH.
    await vitals(daysAgo(0), { PULSE: { num: 105 } });
    await t.connection.collection('dailyLogs').deleteMany({ 'readings.PULSE.value.num': 74 });
    const res = await triage().expect(200);
    expect(res.body.tag).toBe('HIGH');
    expect(res.body.reasons[0]).toMatchObject({
      parameter: 'RESTING_HEART_RATE',
      level: 'HIGH',
      date: daysAgo(0),
      explanation: `Pulse 105 bpm on ${daysAgo(0)} (High: over 100)`,
    });
  });

  it('uses the newest result by test date, and ignores retracted ones', async () => {
    await completeLowRisk();
    const wrong = await result('ALBUMIN', { value: 2.5 }, daysAgo(0)).expect(201);
    expect((await triage()).body.tag).toBe('HIGH');

    await api()
      .post(`/api/v1/patients/${patient.id}/investigations/${wrong.body.id}/retract`)
      .set('Authorization', t.auth(doctor))
      .send({ reason: 'Wrong patient' })
      .expect(200);
    expect((await triage()).body.tag).toBe('LOW');

    // An older result typed in later doesn't replace the newer one.
    await result('ALBUMIN', { value: 2.5 }, daysAgo(30)).expect(201);
    expect((await triage()).body.tag).toBe('LOW');
  });

  it('ignores vitals older than the look-back window (7 days)', async () => {
    await completeLowRisk();
    await t.connection.collection('dailyLogs').deleteMany({});
    await vitals(daysAgo(7), { BP: { systolic: 190, diastolic: 100 } });
    const res = await triage().expect(200);
    expect(res.body.tag).toBe('LOW');
    expect(res.body.missing.map((m: { parameter: string }) => m.parameter)).toEqual(['HYPERTENSION', 'RESTING_HEART_RATE']);

    await vitals(daysAgo(6), { BP: { systolic: 190, diastolic: 100 } });
    expect((await triage()).body.tag).toBe('HIGH');
  });

  it('eGFR from the creatinine result, MUST score, and the condition fields', async () => {
    await completeLowRisk();
    await profile({ version: 1, conditions: ['CKD', 'IHD'] }).expect(200);
    let res = await triage().expect(200);
    expect(res.body.missing.map((m: { parameter: string }) => m.parameter)).toEqual(['CKD', 'IHD']);

    await result('CREATININE', { value: 1.6, egfr: 45 }).expect(201);
    await profile({ version: 2, ihdStatus: 'STABLE' }).expect(200);
    res = await triage().expect(200);
    expect(res.body).toMatchObject({ tag: 'HIGH', complete: true });
    expect(res.body.reasons.map((r: { parameter: string }) => r.parameter).sort()).toEqual(['CKD', 'IHD']);

    await result('MUST', { score: 2 }, daysAgo(0)).expect(201);
    expect((await triage()).body.reasons[0]).toMatchObject({ parameter: 'NUTRITION_MUST', level: 'HIGH' });
  });

  it('the patient list shows each tag', async () => {
    await completeLowRisk();
    await profile({ version: 1, canClimbTwoFlights: false }).expect(200);
    const other = await t.seed({ role: 'PATIENT', name: 'Anil Kumar', doctorIds: [doctor.id] });

    const list = await api().get('/api/v1/patients').set('Authorization', t.auth(doctor)).expect(200);
    const byId = new Map(list.body.data.map((p: { id: string; triage: unknown }) => [p.id, p.triage]));
    expect(byId.get(patient.id)).toEqual({ tag: 'HIGH', provisional: true, complete: true });
    expect(byId.get(other.id)).toEqual({ tag: 'LOW', provisional: true, complete: false });
    // The list itself is not a triage read: nothing extra audited.
    expect(await t.connection.collection('auditLogs').countDocuments({ action: 'TRIAGE_VIEWED' })).toBe(0);
  });

  describe('rules', () => {
    const putRules = (body: Record<string, unknown>, as: TestUser = admin) =>
      api().put('/api/v1/admin/triage-rules').set('Authorization', t.auth(as)).send(body);

    it("starts as the client's table, version 1, not confirmed", async () => {
      const res = await api().get('/api/v1/admin/triage-rules').set('Authorization', t.auth(admin)).expect(200);
      expect(res.body).toMatchObject({ version: 1, confirmed: false, rules: DEFAULT_TRIAGE_RULES });
    });

    it('an admin saves a confirmed version: tags stop being provisional and use the new numbers', async () => {
      await completeLowRisk();
      await result('HB', { value: 12.5 }, daysAgo(0)).expect(201);
      expect((await triage()).body.tag).toBe('LOW');

      const stricter = { ...DEFAULT_TRIAGE_RULES, hb: { highBelow: 8, mediumBelow: 13 } };
      const res = await putRules({ rules: stricter, confirmed: true }).expect(200);
      expect(res.body).toMatchObject({ version: 2, confirmed: true });

      expect((await triage()).body).toMatchObject({ tag: 'MEDIUM', provisional: false, rulesVersion: 2 });

      const audit = await t.connection.collection('auditLogs').findOne({ action: 'TRIAGE_RULES_CHANGED' });
      expect(audit).toMatchObject({ before: { version: 1, confirmed: false }, after: { version: 2, confirmed: true } });
      expect(await t.connection.collection('triageRules').countDocuments({})).toBe(2);
    });

    it.each([
      ['a missing setting', { ...DEFAULT_TRIAGE_RULES, hb: { highBelow: 8 } }],
      ['an unknown setting', { ...DEFAULT_TRIAGE_RULES, extra: 1 }],
      ['text instead of a number', { ...DEFAULT_TRIAGE_RULES, age: { highAbove: '70', mediumFrom: 60 } }],
      ['Medium above High', { ...DEFAULT_TRIAGE_RULES, hb: { highBelow: 11, mediumBelow: 8 } }],
      ['a look-back of 0 days', { ...DEFAULT_TRIAGE_RULES, vitalsLookbackDays: 0 }],
    ])('400 for %s', async (_label, rules) => {
      const res = await putRules({ rules, confirmed: false }).expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });

    it('only an admin changes the rules', async () => {
      await putRules({ rules: DEFAULT_TRIAGE_RULES, confirmed: true }, doctor).expect(403);
    });
  });

  describe('access and new fields', () => {
    it('an unlinked doctor gets 404; admins and patients 403', async () => {
      await triage(otherDoctor).expect(404);
      await triage(admin).expect(403);
      await triage(patient).expect(403);
    });

    it('the extra onboarding fields are saved and checked', async () => {
      const res = await profile({
        version: 0,
        smokingStatus: 'FORMER',
        smokingQuitDate: daysAgo(20),
        hypertensionOnMedication: true,
        ihdStatus: 'STABLE',
        lastMiOrStentDate: daysAgo(400),
        canClimbTwoFlights: true,
      }).expect(200);
      expect(res.body).toMatchObject({ smokingQuitDate: daysAgo(20), ihdStatus: 'STABLE', canClimbTwoFlights: true });

      for (const body of [
        { version: 1, smokingQuitDate: today().plus({ days: 1 }).toISODate() },
        { version: 1, lastMiOrStentDate: today().plus({ days: 1 }).toISODate() },
        { version: 1, ihdStatus: 'UNSTABLE' },
        { version: 1, canClimbTwoFlights: 'yes' },
      ]) {
        await profile(body).expect(400);
      }
    });
  });
});
