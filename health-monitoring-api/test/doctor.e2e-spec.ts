import request from 'supertest';
import { DateTime } from 'luxon';
import { ALERT_STATUS, ERROR_CODES, EVENT_TYPES } from '../src/common/constants';
import { TestContext, TestUser, createTestApp } from './helpers/test-app';

const ZONE = 'Asia/Kolkata';
const today = () => DateTime.now().setZone(ZONE).toISODate()!;

describe('Doctor endpoints and the alert lifecycle (v1.1 /doctor)', () => {
  let ctx: TestContext;
  let doctor: TestUser;
  let otherDoctor: TestUser;
  let admin: TestUser;
  let patient: TestUser;
  let unlinked: TestUser;

  const http = () => request(ctx.app.getHttpServer());
  const as = (user: TestUser, method: 'get' | 'put' | 'patch', path: string) =>
    http()[method](path).set('Authorization', `Bearer ${ctx.token(user)}`);

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await ctx.reset();
    doctor = await ctx.createUser({ uid: 'doc-1', role: 'DOCTOR', name: 'Dr Meera Nair' });
    otherDoctor = await ctx.createUser({ uid: 'doc-2', role: 'DOCTOR', name: 'Dr Arun Rao' });
    admin = await ctx.createUser({ uid: 'adm-1', role: 'ADMIN', name: 'Platform Admin' });
    patient = await ctx.createUser({
      uid: 'pat-1',
      role: 'PATIENT',
      name: 'Rajesh Iyer',
      timeZone: ZONE,
      doctorIds: [doctor.id],
    });
    unlinked = await ctx.createUser({
      uid: 'pat-2',
      role: 'PATIENT',
      name: 'Anita Shah',
      timeZone: ZONE,
      doctorIds: [otherDoctor.id],
    });
  });

  /** Puts a limit in place through the admin route, as the clinical team would. */
  const setLimit = (body: Record<string, unknown>, type = 'PAIN') =>
    as(admin, 'put', `/api/v1/admin/alert-thresholds/${type}`).send(body).expect(200);

  const save = (readings: Record<string, unknown>) =>
    as(patient, 'put', '/api/v1/me/vitals/today').send({ date: today(), readings }).expect(200);

  describe('GET /doctor/patients/:patientId/vitals/*', () => {
    it("returns the patient's log in the same shape as /me", async () => {
      await save({ PULSE: { num: 76 } });

      const res = await as(
        doctor,
        'get',
        `/api/v1/doctor/patients/${patient.id}/vitals/today`,
      ).expect(200);

      expect(res.body).toMatchObject({ date: today(), timeZone: ZONE, filledCount: 1 });
      expect(res.body.readings.PULSE.value).toEqual({ num: 76 });
      expect(Object.keys(res.body.readings)).toHaveLength(13);
    });

    it('serves logs and trends with the same parameters as /me', async () => {
      await save({ PULSE: { num: 76 } });

      const logs = await as(
        doctor,
        'get',
        `/api/v1/doctor/patients/${patient.id}/vitals/logs?limit=5`,
      ).expect(200);
      expect(logs.body.data[0].date).toBe(today());

      const trends = await as(
        doctor,
        'get',
        `/api/v1/doctor/patients/${patient.id}/vitals/trends?type=PULSE&period=7d`,
      ).expect(200);
      expect(trends.body.labels).toHaveLength(7);
      expect(trends.body.values[6]).toBe(76);
    });

    it('records every successful view in the audit log', async () => {
      await as(doctor, 'get', `/api/v1/doctor/patients/${patient.id}/vitals/today`)
        .set('X-Request-Id', 'req-view')
        .expect(200);

      const entries = await ctx.connection
        .collection('auditLogs')
        .find({ action: 'PATIENT_VITALS_VIEWED' })
        .toArray();

      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        actorRole: 'DOCTOR',
        route: `GET /api/v1/doctor/patients/${patient.id}/vitals/today`,
        requestId: 'req-view',
      });
      expect(String(entries[0].patientId)).toBe(patient.id);
    });

    it('hides a patient who is not linked behind the same 404 as one who does not exist', async () => {
      const notLinked = await as(
        doctor,
        'get',
        `/api/v1/doctor/patients/${unlinked.id}/vitals/today`,
      ).expect(404);
      const missing = await as(
        doctor,
        'get',
        '/api/v1/doctor/patients/6701f0a9e4b0f1a2b3c4d999/vitals/today',
      ).expect(404);

      expect(notLinked.body.code).toBe(ERROR_CODES.NOT_FOUND);
      expect(notLinked.body.message).toBe(missing.body.message);
      // Nothing is audited for a refused access.
      await expect(
        ctx.connection.collection('auditLogs').countDocuments({ action: 'PATIENT_VITALS_VIEWED' }),
      ).resolves.toBe(0);
    });

    it('is forbidden for a patient', async () => {
      const res = await as(
        patient,
        'get',
        `/api/v1/doctor/patients/${patient.id}/vitals/today`,
      ).expect(403);
      expect(res.body.code).toBe(ERROR_CODES.FORBIDDEN_ROLE);
    });
  });

  describe('Alerts', () => {
    it('raises nothing while no limit is set', async () => {
      await save({ PAIN: { num: 10 } });

      await expect(ctx.connection.collection('vitalAlerts').countDocuments()).resolves.toBe(0);
      const res = await as(doctor, 'get', '/api/v1/doctor/alerts').expect(200);
      expect(res.body).toEqual({ data: [], nextCursor: null });
    });

    it('raises an alert when a saved value crosses the limit', async () => {
      await setLimit({ field: null, low: null, high: 6, severity: 'MEDIUM' });

      const saved = await save({ PAIN: { num: 7 } });

      expect(saved.body.alerts).toEqual([
        {
          id: expect.any(String),
          type: 'PAIN',
          field: null,
          rule: 'ABOVE_HIGH',
          threshold: 6,
          severity: 'MEDIUM',
          status: ALERT_STATUS.OPEN,
        },
      ]);

      const queue = await as(doctor, 'get', '/api/v1/doctor/alerts').expect(200);
      expect(queue.body.data[0]).toMatchObject({
        patient: { id: patient.id, name: 'Rajesh Iyer' },
        date: today(),
        type: 'PAIN',
        value: { num: 7 },
        currentValue: { num: 7 },
        rule: 'ABOVE_HIGH',
        threshold: 6,
        thresholdVersion: 1,
        severity: 'MEDIUM',
        status: ALERT_STATUS.OPEN,
        acknowledgedBy: null,
        note: null,
      });
      expect(queue.body.data[0].createdAt).toMatch(/\+05:30$/);
    });

    it('announces the alert to the linked doctors through the outbox', async () => {
      await setLimit({ field: null, low: null, high: 6, severity: 'MEDIUM' });
      await save({ PAIN: { num: 7 } });

      const raised = await ctx.connection
        .collection('outboxEvents')
        .find({ type: EVENT_TYPES.ALERT_RAISED })
        .toArray();

      expect(raised).toHaveLength(1);
      expect(raised[0].data).toMatchObject({
        type: 'PAIN',
        rule: 'ABOVE_HIGH',
        threshold: 6,
        severity: 'MEDIUM',
        doctorIds: [doctor.id],
      });
    });

    it('keeps one alert per parameter and day, and re-raises only on a higher severity', async () => {
      await setLimit({ field: null, low: null, high: 6, severity: 'MEDIUM' });
      await save({ PAIN: { num: 7 } });
      await save({ PAIN: { num: 8 } });

      await expect(ctx.connection.collection('vitalAlerts').countDocuments()).resolves.toBe(1);
      let alert = await ctx.connection.collection('vitalAlerts').findOne({});
      expect(alert).toMatchObject({ value: { num: 8 }, severity: 'MEDIUM' });
      // Still one notification: the severity did not change.
      await expect(
        ctx.connection.collection('outboxEvents').countDocuments({ type: EVENT_TYPES.ALERT_RAISED }),
      ).resolves.toBe(1);

      // The clinical team raises the severity, and the next save escalates.
      await setLimit({ field: null, low: null, high: 6, severity: 'HIGH' });
      await save({ PAIN: { num: 9 } });

      await expect(ctx.connection.collection('vitalAlerts').countDocuments()).resolves.toBe(1);
      alert = await ctx.connection.collection('vitalAlerts').findOne({});
      expect(alert).toMatchObject({ severity: 'HIGH' });
      await expect(
        ctx.connection.collection('outboxEvents').countDocuments({ type: EVENT_TYPES.ALERT_RAISED }),
      ).resolves.toBe(2);
    });

    it('re-points the de-duplicated alert at the breach the latest value made', async () => {
      await setLimit({ field: null, low: 50, high: 110, severity: 'MEDIUM' }, 'PULSE');
      await save({ PULSE: { num: 40 } });
      // The patient corrects a typo to a value that crosses the other limit.
      await setLimit({ field: null, low: 50, high: 120, severity: 'MEDIUM' }, 'PULSE');
      const saved = await save({ PULSE: { num: 180 } });

      expect(saved.body.alerts[0]).toMatchObject({ rule: 'ABOVE_HIGH', threshold: 120 });
      const current = await ctx.connection.collection('alertThresholds').findOne({}, { sort: { version: -1 } });
      const alert = await ctx.connection.collection('vitalAlerts').findOne({});
      expect(alert).toMatchObject({
        value: { num: 180 },
        rule: 'ABOVE_HIGH',
        threshold: 120,
        thresholdId: current!._id,
        thresholdVersion: current!.version,
      });
    });

    it('400, not 500, for a cursor whose timestamp is not a date', async () => {
      const forged = Buffer.from(JSON.stringify({ k: 'garbage', id: '6700aa01e4b0f1a2b3c4d5e6' })).toString('base64url');
      const res = await as(doctor, 'get', `/api/v1/doctor/alerts?cursor=${forged}`).expect(400);
      expect(res.body.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    });

    it('treats a profile zone that is not IANA as the default zone, everywhere', async () => {
      const ist = await ctx.createUser({
        uid: 'pat-ist',
        role: 'PATIENT',
        name: 'Kiran Rao',
        // Windows' name for Asia/Kolkata - not an IANA zone. (Node accepts "IST" itself.)
        timeZone: 'India Standard Time',
        doctorIds: [doctor.id],
      });
      await setLimit({ field: null, low: null, high: 6, severity: 'MEDIUM' });
      await as(ist, 'put', '/api/v1/me/vitals/today').send({ date: today(), readings: { PAIN: { num: 7 } } }).expect(200);

      const queue = await as(doctor, 'get', `/api/v1/doctor/alerts?patientId=${ist.id}`).expect(200);
      expect(queue.body.data[0].createdAt).toMatch(/\+05:30$/);
      expect(queue.body.data[0].updatedAt).toMatch(/\+05:30$/);
      await as(doctor, 'get', `/api/v1/doctor/patients/${ist.id}/vitals/today`).expect(200);
    });

    it('keeps the alert open when the value is edited back into range', async () => {
      await setLimit({ field: null, low: null, high: 6, severity: 'MEDIUM' });
      await save({ PAIN: { num: 7 } });
      await save({ PAIN: { num: 2 } });

      const queue = await as(doctor, 'get', '/api/v1/doctor/alerts').expect(200);
      expect(queue.body.data).toHaveLength(1);
      expect(queue.body.data[0]).toMatchObject({
        status: ALERT_STATUS.OPEN,
        // The doctor sees both the reading that crossed and the value now.
        value: { num: 7 },
        currentValue: { num: 2 },
      });
    });

    it('raises a separate alert per BP field', async () => {
      await setLimit({ field: 'systolic', low: null, high: 140, severity: 'HIGH' }, 'BP');
      await setLimit({ field: 'diastolic', low: null, high: 90, severity: 'MEDIUM' }, 'BP');

      const saved = await save({ BP: { systolic: 150, diastolic: 95 } });

      expect(saved.body.alerts).toHaveLength(2);
      expect(saved.body.alerts.map((a: { field: string }) => a.field).sort()).toEqual([
        'diastolic',
        'systolic',
      ]);
    });

    it('raises a BELOW_LOW alert under the low limit', async () => {
      await setLimit({ field: null, low: 92, high: null, severity: 'HIGH' }, 'SPO2');
      const saved = await save({ SPO2: { num: 88 } });

      expect(saved.body.alerts[0]).toMatchObject({ rule: 'BELOW_LOW', threshold: 92, severity: 'HIGH' });
    });

    it('filters the queue by status and patient, and 404s for an unlinked patient', async () => {
      await setLimit({ field: null, low: null, high: 6, severity: 'MEDIUM' });
      await save({ PAIN: { num: 7 } });

      const open = await as(doctor, 'get', `/api/v1/doctor/alerts?patientId=${patient.id}`).expect(200);
      expect(open.body.data).toHaveLength(1);

      const acknowledged = await as(doctor, 'get', '/api/v1/doctor/alerts?status=ACKNOWLEDGED').expect(200);
      expect(acknowledged.body.data).toHaveLength(0);

      await as(doctor, 'get', `/api/v1/doctor/alerts?patientId=${unlinked.id}`).expect(404);
    });

    it('shows a doctor only their own patients’ alerts', async () => {
      await setLimit({ field: null, low: null, high: 6, severity: 'MEDIUM' });
      await save({ PAIN: { num: 7 } });

      const res = await as(otherDoctor, 'get', '/api/v1/doctor/alerts').expect(200);
      expect(res.body.data).toHaveLength(0);
    });
  });

  describe('PATCH /doctor/alerts/:alertId', () => {
    const raiseAlert = async (): Promise<string> => {
      await setLimit({ field: null, low: null, high: 6, severity: 'MEDIUM' });
      const saved = await save({ PAIN: { num: 7 } });
      return saved.body.alerts[0].id;
    };

    it('acknowledges an alert, with the doctor and time recorded', async () => {
      const alertId = await raiseAlert();

      const res = await as(doctor, 'patch', `/api/v1/doctor/alerts/${alertId}`)
        .send({ status: 'ACKNOWLEDGED', note: 'Called patient, pain settled after rest' })
        .expect(200);

      expect(res.body).toMatchObject({
        id: alertId,
        status: ALERT_STATUS.ACKNOWLEDGED,
        acknowledgedBy: doctor.id,
        note: 'Called patient, pain settled after rest',
      });
      expect(res.body.acknowledgedAt).toMatch(/\+05:30$/);
    });

    it('audits the acknowledgement and announces it', async () => {
      const alertId = await raiseAlert();
      await as(doctor, 'patch', `/api/v1/doctor/alerts/${alertId}`)
        .send({ status: 'ACKNOWLEDGED' })
        .expect(200);

      const audit = await ctx.connection
        .collection('auditLogs')
        .findOne({ action: 'ALERT_ACKNOWLEDGED' });
      expect(audit).toMatchObject({
        actorRole: 'DOCTOR',
        before: { status: 'OPEN', note: null },
        after: { status: 'ACKNOWLEDGED', note: null },
      });

      const event = await ctx.connection
        .collection('outboxEvents')
        .findOne({ type: EVENT_TYPES.ALERT_ACKNOWLEDGED });
      expect(event!.data).toMatchObject({ alertId, acknowledgedBy: doctor.id });
    });

    it('refuses a second acknowledgement with 409', async () => {
      const alertId = await raiseAlert();
      await as(doctor, 'patch', `/api/v1/doctor/alerts/${alertId}`)
        .send({ status: 'ACKNOWLEDGED' })
        .expect(200);

      const res = await as(doctor, 'patch', `/api/v1/doctor/alerts/${alertId}`)
        .send({ status: 'ACKNOWLEDGED', note: 'again' })
        .expect(409);
      expect(res.body.code).toBe(ERROR_CODES.ALERT_ALREADY_ACKNOWLEDGED);
    });

    it('raises a fresh alert for the same day only after the earlier one is acknowledged', async () => {
      const alertId = await raiseAlert();
      await as(doctor, 'patch', `/api/v1/doctor/alerts/${alertId}`)
        .send({ status: 'ACKNOWLEDGED' })
        .expect(200);

      const saved = await save({ PAIN: { num: 9 } });
      expect(saved.body.alerts[0].id).not.toBe(alertId);
      await expect(ctx.connection.collection('vitalAlerts').countDocuments()).resolves.toBe(2);
    });

    it('rejects any status other than ACKNOWLEDGED', async () => {
      const alertId = await raiseAlert();
      const res = await as(doctor, 'patch', `/api/v1/doctor/alerts/${alertId}`)
        .send({ status: 'OPEN' })
        .expect(400);
      expect(res.body.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    });

    it('rejects a note longer than 500 characters', async () => {
      const alertId = await raiseAlert();
      await as(doctor, 'patch', `/api/v1/doctor/alerts/${alertId}`)
        .send({ status: 'ACKNOWLEDGED', note: 'x'.repeat(501) })
        .expect(400);
    });

    it('404s for an unknown alert, and for one belonging to another doctor', async () => {
      const alertId = await raiseAlert();

      await as(otherDoctor, 'patch', `/api/v1/doctor/alerts/${alertId}`)
        .send({ status: 'ACKNOWLEDGED' })
        .expect(404);
      await as(doctor, 'patch', '/api/v1/doctor/alerts/6701f0a9e4b0f1a2b3c4d999')
        .send({ status: 'ACKNOWLEDGED' })
        .expect(404);
      await as(doctor, 'patch', '/api/v1/doctor/alerts/not-an-id')
        .send({ status: 'ACKNOWLEDGED' })
        .expect(404);
    });

    it('cannot be acknowledged by a patient or an admin', async () => {
      const alertId = await raiseAlert();
      await as(patient, 'patch', `/api/v1/doctor/alerts/${alertId}`)
        .send({ status: 'ACKNOWLEDGED' })
        .expect(403);
      await as(admin, 'patch', `/api/v1/doctor/alerts/${alertId}`)
        .send({ status: 'ACKNOWLEDGED' })
        .expect(403);
    });
  });
});
