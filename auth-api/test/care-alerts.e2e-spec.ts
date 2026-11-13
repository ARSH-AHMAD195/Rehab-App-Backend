import request from 'supertest';
import { DateTime } from 'luxon';
import { Types } from 'mongoose';
import { createTestApp, TestContext, TestUser } from './helpers/test-app';

describe('Care-team alerts', () => {
  let t: TestContext;
  let admin: TestUser;
  let drA: TestUser;
  let drB: TestUser;
  let outsider: TestUser;
  let patient: TestUser;
  const api = () => request(t.app.getHttpServer());
  const today = () => DateTime.now().setZone('Asia/Kolkata').startOf('day');
  const daysAgo = (n: number) => today().minus({ days: n }).toISODate()!;

  const inbox = (as: TestUser = drA, query = '') => api().get(`/api/v1/doctor/care-alerts${query}`).set('Authorization', t.auth(as));
  const ack = (id: string, as: TestUser = drA, note?: string) =>
    api().patch(`/api/v1/doctor/care-alerts/${id}`).set('Authorization', t.auth(as)).send(note ? { note } : {});
  const result = (test: string, values: Record<string, unknown>, takenOn = daysAgo(1)) =>
    api().post(`/api/v1/patients/${patient.id}/investigations`).set('Authorization', t.auth(drA)).send({ test, takenOn, values });
  const vitals = (date: string, readings: Record<string, unknown>) =>
    t.connection.collection('dailyLogs').insertOne({
      patientId: new Types.ObjectId(patient.id),
      date,
      timeZone: 'Asia/Kolkata',
      filledCount: Object.keys(readings).length,
      readings: Object.fromEntries(Object.entries(readings).map(([k, value]) => [k, { value, status: 'LOGGED' }])),
    });
  const registeredDaysAgo = (n: number) =>
    t.connection.collection('users').updateOne({ _id: new Types.ObjectId(patient.id) }, { $set: { createdAt: today().minus({ days: n }).plus({ hours: 12 }).toJSDate() } });
  const kinds = (res: request.Response) => res.body.data.map((a: { kind: string }) => a.kind);

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => t.close());
  beforeEach(async () => {
    await t.reset();
    admin = await t.seed({ role: 'ADMIN', name: 'Admin' });
    drA = await t.seed({ role: 'DOCTOR', name: 'Dr Meera Nair' });
    drB = await t.seed({ role: 'DOCTOR', name: 'Dr Arjun Rao' });
    outsider = await t.seed({ role: 'DOCTOR', name: 'Dr Other' });
    // Two doctors on the care team.
    patient = await t.seed({ role: 'PATIENT', name: 'Rajesh Iyer', doctorIds: [drA.id, drB.id] });
  });

  it('a new patient with nothing to report: empty inbox', async () => {
    const res = await inbox().expect(200);
    expect(res.body).toEqual({ data: [], nextCursor: null, openCount: 0 });
  });

  it('a High Hb reaches the whole care team, once, and stays acknowledged', async () => {
    const hb = await result('HB', { value: 7.6 }).expect(201);

    const first = await inbox(drA).expect(200);
    expect(first.body.openCount).toBe(1);
    expect(first.body.data[0]).toMatchObject({
      patient: { id: patient.id, name: 'Rajesh Iyer' },
      kind: 'HIGH_VALUE',
      message: `Hb 7.6 g/dL on ${daysAgo(1)} (High: below 8)`,
      details: { source: 'INVESTIGATION', test: 'HB', value: 7.6, resultId: hb.body.id },
      status: 'OPEN',
      acknowledgedBy: null,
    });

    // The other doctor on the team sees the same alert; checking again adds nothing.
    const second = await inbox(drB).expect(200);
    expect(second.body.data.map((a: { id: string }) => a.id)).toEqual([first.body.data[0].id]);
    expect(await t.connection.collection('careAlerts').countDocuments({})).toBe(1);

    // Dr Meera acknowledges it; Dr Arjun sees that, and can't acknowledge it again.
    const done = await ack(first.body.data[0].id, drA, 'Repeat Hb booked').expect(200);
    expect(done.body).toMatchObject({ status: 'ACKNOWLEDGED', acknowledgedBy: drA.id, note: 'Repeat Hb booked' });
    expect((await ack(first.body.data[0].id, drB).expect(409)).body.code).toBe('ALERT_ALREADY_ACKNOWLEDGED');
    expect((await inbox(drB).expect(200)).body).toMatchObject({ data: [], openCount: 0 });
    expect((await inbox(drB, '?status=ACKNOWLEDGED').expect(200)).body.data).toHaveLength(1);

    // Not raised again for the same result.
    expect((await inbox(drA).expect(200)).body.openCount).toBe(0);
    expect(await t.connection.collection('auditLogs').countDocuments({ action: 'CARE_ALERT_ACKNOWLEDGED' })).toBe(1);
  });

  it('a High pulse or BP logged in Health Monitoring', async () => {
    await vitals(daysAgo(0), { PULSE: { num: 105 }, BP: { systolic: 185, diastolic: 95 } });
    const res = await inbox().expect(200);
    expect(res.body.data.map((a: { message: string }) => a.message).sort()).toEqual([
      `BP 185/95 mmHg on ${daysAgo(0)} (High: 180/110 or above)`,
      `Pulse 105 bpm on ${daysAgo(0)} (High: over 100)`,
    ]);
  });

  it('old results and normal values raise nothing', async () => {
    await result('HB', { value: 7 }, daysAgo(20)).expect(201);
    await result('HB', { value: 12.5 }).expect(201);
    await vitals(daysAgo(0), { PULSE: { num: 80 } });
    expect((await inbox().expect(200)).body.data).toEqual([]);
  });

  it('weight loss over 5% since onboarding: one open alert at a time', async () => {
    await api().patch(`/api/v1/patients/${patient.id}/medical-profile`).set('Authorization', t.auth(drA))
      .send({ version: 0, onboardingWeightKg: 70 }).expect(200);
    await vitals(daysAgo(1), { WEIGHT: { num: 66 } });
    const first = await inbox().expect(200);
    expect(kinds(first)).toEqual(['WEIGHT_LOSS']);
    expect(first.body.data[0].details).toMatchObject({ onboardingWeightKg: 70, weightKg: 66, lossPercent: 5.7 });

    // Another low weight the next day while the first is still open: no second alert.
    await vitals(daysAgo(0), { WEIGHT: { num: 65 } });
    expect(kinds(await inbox().expect(200))).toEqual(['WEIGHT_LOSS']);

    // Once acknowledged, a newer low reading raises a new one.
    await ack(first.body.data[0].id).expect(200);
    await t.connection.collection('dailyLogs').deleteMany({ date: daysAgo(0) });
    expect((await inbox().expect(200)).body.openCount).toBe(0);
    await vitals(daysAgo(0), { WEIGHT: { num: 64.5 } });
    expect((await inbox().expect(200)).body.openCount).toBe(1);
  });

  it('a rise in MUST score', async () => {
    await result('MUST', { score: 0 }, daysAgo(10)).expect(201);
    await result('MUST', { score: 1 }, daysAgo(1)).expect(201);
    const res = await inbox().expect(200);
    expect(res.body.data[0]).toMatchObject({ kind: 'MUST_RISE', message: `MUST score rose from 0 (${daysAgo(10)}) to 1 (${daysAgo(1)})` });
  });

  describe('no logging for 3 days', () => {
    it('counts from the last vitals log', async () => {
      await registeredDaysAgo(10);
      await vitals(daysAgo(3), { PULSE: { num: 72 } });
      const res = await inbox().expect(200);
      expect(res.body.data[0]).toMatchObject({ kind: 'NO_LOGGING', message: `Nothing logged for 3 days (last on ${daysAgo(3)})` });
    });

    it('an exercise tick counts as logging', async () => {
      await registeredDaysAgo(10);
      await vitals(daysAgo(5), { PULSE: { num: 72 } });
      await t.connection.collection('exerciseCompletions').insertOne({
        patientId: new Types.ObjectId(patient.id),
        date: daysAgo(1),
        active: true,
        completedAt: new Date(),
      });
      expect((await inbox().expect(200)).body.data).toEqual([]);
    });

    it('an undone tick does not count', async () => {
      await registeredDaysAgo(10);
      await t.connection.collection('exerciseCompletions').insertOne({
        patientId: new Types.ObjectId(patient.id),
        date: daysAgo(1),
        active: false,
        completedAt: new Date(),
      });
      expect(kinds(await inbox().expect(200))).toEqual(['NO_LOGGING']);
    });

    it('a patient who never logged, counted from registration', async () => {
      await registeredDaysAgo(4);
      expect((await inbox().expect(200)).body.data[0].message).toBe('Nothing logged in the 4 days since registering');
    });
  });

  describe('access', () => {
    it("a doctor outside the care team sees nothing and can't acknowledge", async () => {
      await result('HB', { value: 7 }).expect(201);
      const mine = await inbox(drA).expect(200);
      expect((await inbox(outsider).expect(200)).body.data).toEqual([]);
      await ack(mine.body.data[0].id, outsider).expect(404);
      await inbox(outsider, `?patientId=${patient.id}`).expect(404);
    });

    it('admins and patients have no inbox', async () => {
      await inbox(admin).expect(403);
      await inbox(patient).expect(403);
    });

    it('404 for an unknown alert id', async () => {
      await ack('nope').expect(404);
      await ack(new Types.ObjectId().toString()).expect(404);
    });

    it('a deactivated patient raises nothing', async () => {
      await result('HB', { value: 7 }).expect(201);
      await t.connection.collection('users').updateOne({ _id: new Types.ObjectId(patient.id) }, { $set: { active: false } });
      expect((await inbox().expect(200)).body.data).toEqual([]);
    });
  });

  it('one patient only, pages, and the open count', async () => {
    await result('HB', { value: 7 }).expect(201);
    await result('ALBUMIN', { value: 2.5 }).expect(201);
    await result('HBA1C', { value: 9.1 }).expect(201);
    const other = await t.seed({ role: 'PATIENT', name: 'Anil', doctorIds: [drA.id] });

    const page1 = await inbox(drA, '?limit=2').expect(200);
    expect(page1.body).toMatchObject({ openCount: 3 });
    expect(page1.body.data).toHaveLength(2);
    const page2 = await inbox(drA, `?limit=2&cursor=${page1.body.nextCursor}`).expect(200);
    expect(page2.body.data).toHaveLength(1);
    expect(page2.body.nextCursor).toBeNull();

    expect((await inbox(drA, `?patientId=${other.id}`).expect(200)).body.data).toEqual([]);
    await inbox(drA, '?status=MAYBE').expect(400);
  });
});
