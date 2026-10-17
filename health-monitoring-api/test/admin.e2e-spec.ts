import request from 'supertest';
import { DateTime } from 'luxon';
import { ERROR_CODES, DETAIL_CODES } from '../src/common/constants';
import { TestContext, TestUser, createTestApp } from './helpers/test-app';

const ZONE = 'Asia/Kolkata';
const today = () => DateTime.now().setZone(ZONE).toISODate()!;

describe('Admin endpoints (v1.1 /admin)', () => {
  let ctx: TestContext;
  let admin: TestUser;
  let doctor: TestUser;
  let patient: TestUser;
  let otherPatient: TestUser;

  const http = () => request(ctx.app.getHttpServer());
  const as = (user: TestUser, method: 'get' | 'put', path: string) =>
    http()[method](path).set('Authorization', `Bearer ${ctx.token(user)}`);

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await ctx.reset();
    // Parameters are reference data; restore any range a previous test changed.
    await ctx.connection.collection('vitalTypes').deleteMany({});
    await ctx.app.get(
      (await import('../src/vital-types/vital-types.service')).VitalTypesService,
    ).seedMissing();

    admin = await ctx.createUser({ uid: 'adm-1', role: 'ADMIN', name: 'Platform Admin' });
    doctor = await ctx.createUser({ uid: 'doc-1', role: 'DOCTOR', name: 'Dr Meera Nair' });
    patient = await ctx.createUser({
      uid: 'pat-1',
      role: 'PATIENT',
      name: 'Rajesh Iyer',
      timeZone: ZONE,
      doctorIds: [doctor.id],
    });
    otherPatient = await ctx.createUser({
      uid: 'pat-2',
      role: 'PATIENT',
      name: 'Anita Shah',
      timeZone: ZONE,
      doctorIds: [doctor.id],
    });
  });

  const save = (readings: Record<string, unknown>, expected = 200) =>
    as(patient, 'put' as 'get', '/api/v1/me/vitals/today')
      .send({ date: today(), readings })
      .expect(expected);

  describe('access', () => {
    it('is admin only', async () => {
      await as(doctor, 'get', '/api/v1/admin/alert-thresholds').expect(403);
      const res = await as(patient, 'get', '/api/v1/admin/alert-thresholds').expect(403);
      expect(res.body.code).toBe(ERROR_CODES.FORBIDDEN_ROLE);
    });
  });

  describe('PUT /admin/alert-thresholds/:type', () => {
    it('creates version 1 and keeps earlier versions on the next save', async () => {
      const first = await as(admin, 'put', '/api/v1/admin/alert-thresholds/PAIN')
        .send({ field: null, low: null, high: 6, severity: 'MEDIUM', patientId: null })
        .expect(200);

      expect(first.body).toMatchObject({
        type: 'PAIN',
        field: null,
        low: null,
        high: 6,
        severity: 'MEDIUM',
        patientId: null,
        version: 1,
        updatedBy: admin.id,
      });
      expect(first.body.effectiveFrom).toBeTruthy();

      const second = await as(admin, 'put', '/api/v1/admin/alert-thresholds/PAIN')
        .send({ field: null, low: null, high: 5, severity: 'HIGH' })
        .expect(200);
      expect(second.body).toMatchObject({ version: 2, high: 5, severity: 'HIGH' });

      const rows = await ctx.connection
        .collection('alertThresholds')
        .find({ type: 'PAIN' })
        .sort({ version: 1 })
        .toArray();
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({ version: 1, isCurrent: false, high: 6 });
      expect(rows[1]).toMatchObject({ version: 2, isCurrent: true, high: 5 });
    });

    it('lists only the current version', async () => {
      await as(admin, 'put', '/api/v1/admin/alert-thresholds/PAIN')
        .send({ high: 6, severity: 'MEDIUM' })
        .expect(200);
      await as(admin, 'put', '/api/v1/admin/alert-thresholds/PAIN')
        .send({ high: 5, severity: 'HIGH' })
        .expect(200);
      await as(admin, 'put', '/api/v1/admin/alert-thresholds/SPO2')
        .send({ low: 92, severity: 'HIGH' })
        .expect(200);

      const all = await as(admin, 'get', '/api/v1/admin/alert-thresholds').expect(200);
      expect(all.body.data).toHaveLength(2);
      expect(all.body.nextCursor).toBeNull();

      const filtered = await as(admin, 'get', '/api/v1/admin/alert-thresholds?type=PAIN').expect(200);
      expect(filtered.body.data).toEqual([expect.objectContaining({ version: 2, high: 5 })]);
    });

    it('applies a patient override over the global default', async () => {
      await as(admin, 'put', '/api/v1/admin/alert-thresholds/PAIN')
        .send({ high: 8, severity: 'LOW' })
        .expect(200);
      await as(admin, 'put', '/api/v1/admin/alert-thresholds/PAIN')
        .send({ high: 3, severity: 'HIGH', patientId: patient.id })
        .expect(200);

      // 5 is under the global limit of 8 but over this patient's override of 3.
      const saved = await save({ PAIN: { num: 5 } });
      expect(saved.body.alerts[0]).toMatchObject({ threshold: 3, severity: 'HIGH' });

      const trends = await as(patient, 'get', '/api/v1/me/vitals/trends?type=PAIN&period=7d').expect(200);
      expect(trends.body.thresholds).toEqual({ low: null, high: 3 });
    });

    it('takes a limit per BP field and refuses a missing one', async () => {
      await as(admin, 'put', '/api/v1/admin/alert-thresholds/BP')
        .send({ field: 'systolic', high: 140, severity: 'HIGH' })
        .expect(200);

      const missingField = await as(admin, 'put', '/api/v1/admin/alert-thresholds/BP')
        .send({ high: 140, severity: 'HIGH' })
        .expect(400);
      expect(missingField.body.details[0]).toMatchObject({
        field: 'field',
        code: DETAIL_CODES.REQUIRED,
      });
    });

    it('refuses a field on a parameter that has none', async () => {
      const res = await as(admin, 'put', '/api/v1/admin/alert-thresholds/PAIN')
        .send({ field: 'systolic', high: 6, severity: 'MEDIUM' })
        .expect(400);
      expect(res.body.details[0]).toMatchObject({ field: 'field', code: DETAIL_CODES.WRONG_SHAPE });
    });

    it('requires at least one of low or high, with low below high', async () => {
      const neither = await as(admin, 'put', '/api/v1/admin/alert-thresholds/PULSE')
        .send({ severity: 'MEDIUM' })
        .expect(400);
      expect(neither.body.details[0]).toMatchObject({ field: 'low', code: DETAIL_CODES.REQUIRED });

      const inverted = await as(admin, 'put', '/api/v1/admin/alert-thresholds/PULSE')
        .send({ low: 120, high: 60, severity: 'MEDIUM' })
        .expect(400);
      expect(inverted.body.details[0]).toMatchObject({ field: 'low', code: DETAIL_CODES.OUT_OF_RANGE });
    });

    it("refuses limits outside the parameter's valid range", async () => {
      const res = await as(admin, 'put', '/api/v1/admin/alert-thresholds/SPO2')
        .send({ low: 10, severity: 'HIGH' })
        .expect(400);
      expect(res.body.details[0]).toMatchObject({ field: 'low', code: DETAIL_CODES.OUT_OF_RANGE });
    });

    it('refuses a limit on free text, an unknown parameter and an unknown patient', async () => {
      await as(admin, 'put', '/api/v1/admin/alert-thresholds/NUTRITION')
        .send({ high: 10, severity: 'LOW' })
        .expect(400);
      await as(admin, 'put', '/api/v1/admin/alert-thresholds/HEIGHT')
        .send({ high: 10, severity: 'LOW' })
        .expect(404);
      await as(admin, 'put', '/api/v1/admin/alert-thresholds/PAIN')
        .send({ high: 6, severity: 'LOW', patientId: '6701f0a9e4b0f1a2b3c4d999' })
        .expect(404);
    });

    it('rejects a severity outside LOW/MEDIUM/HIGH', async () => {
      await as(admin, 'put', '/api/v1/admin/alert-thresholds/PAIN')
        .send({ high: 6, severity: 'CRITICAL' })
        .expect(400);
    });

    it('audits the change with both versions', async () => {
      await as(admin, 'put', '/api/v1/admin/alert-thresholds/PAIN')
        .send({ high: 6, severity: 'MEDIUM' })
        .expect(200);
      await as(admin, 'put', '/api/v1/admin/alert-thresholds/PAIN')
        .send({ high: 5, severity: 'MEDIUM' })
        .expect(200);

      const entries = await ctx.connection
        .collection('auditLogs')
        .find({ action: 'THRESHOLD_CHANGED' })
        .sort({ at: 1 })
        .toArray();

      expect(entries).toHaveLength(2);
      expect(entries[0].before).toBeNull();
      expect(entries[1]).toMatchObject({
        actorRole: 'ADMIN',
        before: { version: 1, high: 6 },
        after: { version: 2, high: 5 },
      });
    });

    it('keeps the threshold version an alert was raised under', async () => {
      await as(admin, 'put', '/api/v1/admin/alert-thresholds/PAIN')
        .send({ high: 6, severity: 'MEDIUM' })
        .expect(200);
      await save({ PAIN: { num: 7 } });

      // A later change must not recompute the alert already raised.
      await as(admin, 'put', '/api/v1/admin/alert-thresholds/PAIN')
        .send({ high: 9, severity: 'LOW' })
        .expect(200);

      const alert = await ctx.connection.collection('vitalAlerts').findOne({});
      expect(alert).toMatchObject({ threshold: 6, thresholdVersion: 1, severity: 'MEDIUM' });
    });
  });

  describe('PUT /admin/vital-types/:type', () => {
    it('is not refused as a conflict because this instance cached an older version', async () => {
      // This instance caches version 1; another instance then saves version 2.
      await ctx.app.get((await import('../src/vital-types/vital-types.service')).VitalTypesService).list();
      await ctx.connection.collection('vitalTypes').updateOne({ type: 'PULSE' }, { $inc: { version: 1 } });

      const res = await as(admin, 'put', '/api/v1/admin/vital-types/PULSE')
        .send({ minValid: 40, maxValid: 180 })
        .expect(200);
      expect(res.body.version).toBe(3);
    });

    it('raises the version and applies to later saves', async () => {
      const res = await as(admin, 'put', '/api/v1/admin/vital-types/PULSE')
        .send({ minValid: 40, maxValid: 180 })
        .expect(200);

      expect(res.body).toMatchObject({ type: 'PULSE', minValid: 40, maxValid: 180, version: 2 });

      // 35 was valid under the seeded 30-220 range, and is not any more.
      const rejected = await save({ PULSE: { num: 35 } }, 400);
      expect(rejected.body.details[0]).toMatchObject({
        field: 'readings.PULSE.num',
        code: DETAIL_CODES.OUT_OF_RANGE,
      });
    });

    it('records the version each reading was saved under, and does not re-check old values', async () => {
      await save({ PULSE: { num: 35 } });

      await as(admin, 'put', '/api/v1/admin/vital-types/PULSE')
        .send({ minValid: 40, maxValid: 180, unit: 'beats/min' })
        .expect(200);

      // The stored value keeps the unit and version it was saved under.
      const log = await ctx.connection.collection('dailyLogs').findOne({});
      expect(log!.readings.PULSE).toMatchObject({ value: { num: 35 }, unit: 'bpm', typeVersion: 1 });

      const today = await as(patient, 'get', '/api/v1/me/vitals/today').expect(200);
      expect(today.body.readings.PULSE).toMatchObject({ value: { num: 35 }, unit: 'bpm' });
      // An untouched parameter shows the new unit.
      expect(today.body.readings.SPO2.unit).toBe('%');
    });

    it('merges one BP field into the stored ranges instead of replacing them', async () => {
      const ok = await as(admin, 'put', '/api/v1/admin/vital-types/BP')
        .send({ fields: { systolic: { minValid: 70, maxValid: 250 } } })
        .expect(200);

      expect(ok.body.fields.systolic).toEqual({ minValid: 70, maxValid: 250 });
      // The field that was not sent keeps its range.
      expect(ok.body.fields.diastolic).toEqual({ minValid: 30, maxValid: 160 });
      expect(ok.body.version).toBe(2);

      const stored = await ctx.connection.collection('vitalTypes').findOne({ type: 'BP' });
      expect(stored!.fields).toMatchObject({
        systolic: { minValid: 70, maxValid: 250 },
        diastolic: { minValid: 30, maxValid: 160 },
      });

      // Without the diastolic range a BP save would fail validation, so this
      // is the check that matters to the patient.
      const saved = await save({ BP: { systolic: 128, diastolic: 82 } });
      expect(saved.body.readings.BP.value).toEqual({ systolic: 128, diastolic: 82 });
      expect(saved.body.filledCount).toBe(2);

      // And the merged range is the one now enforced.
      const rejected = await save({ BP: { systolic: 65, diastolic: 40 } }, 400);
      expect(rejected.body.details[0]).toMatchObject({
        field: 'readings.BP.systolic',
        code: DETAIL_CODES.OUT_OF_RANGE,
      });
    });

    it('refuses minValid/maxValid on BP', async () => {

      const wrong = await as(admin, 'put', '/api/v1/admin/vital-types/BP')
        .send({ minValid: 70, maxValid: 250 })
        .expect(400);
      expect(wrong.body.details[0]).toMatchObject({ code: DETAIL_CODES.WRONG_SHAPE });
    });

    it('refuses per-field ranges on parameters that have none, and an inverted range', async () => {
      await as(admin, 'put', '/api/v1/admin/vital-types/PULSE')
        .send({ fields: { systolic: { minValid: 1, maxValid: 2 } } })
        .expect(400);
      await as(admin, 'put', '/api/v1/admin/vital-types/PULSE')
        .send({ minValid: 200, maxValid: 100 })
        .expect(400);
    });

    it('refuses changing the type or value shape', async () => {
      await as(admin, 'put', '/api/v1/admin/vital-types/PULSE')
        .send({ valueKind: 'text' })
        .expect(400);
      await as(admin, 'put', '/api/v1/admin/vital-types/PULSE')
        .send({ type: 'HEART_RATE' })
        .expect(400);
    });

    it('can take a parameter off the form, which changes totalCount', async () => {
      await as(admin, 'put', '/api/v1/admin/vital-types/SUGAR').send({ onForm: false }).expect(200);

      const res = await as(patient, 'get', '/api/v1/me/vitals/today').expect(200);
      expect(res.body.totalCount).toBe(13);
      // The parameter is still returned, so a stored value stays visible.
      expect(res.body.readings.SUGAR).toBeDefined();
    });

    it('404s for an unknown parameter and audits a real change', async () => {
      await as(admin, 'put', '/api/v1/admin/vital-types/HEIGHT').send({ maxValid: 1 }).expect(404);

      await as(admin, 'put', '/api/v1/admin/vital-types/WEIGHT').send({ maxValid: 300 }).expect(200);
      const entry = await ctx.connection
        .collection('auditLogs')
        .findOne({ action: 'VITAL_TYPE_CHANGED' });
      expect(entry).toMatchObject({
        actorRole: 'ADMIN',
        before: { maxValid: 250, version: 1 },
        after: { maxValid: 300, version: 2 },
      });
    });

    it('reports a lost race as a retryable conflict, not a 404', async () => {
      // Three admins saving the same parameter at once: one wins the version
      // check and the others are told to retry. The parameter exists
      // throughout, so a 404 would be a lie.
      const results = await Promise.all(
        [100, 200, 300].map((maxValid) =>
          as(admin, 'put', '/api/v1/admin/vital-types/PULSE').send({ maxValid }),
        ),
      );

      const statuses = results.map((res) => res.status).sort();
      expect(statuses).toEqual([200, 409, 409]);

      for (const conflict of results.filter((res) => res.status === 409)) {
        expect(conflict.body).toMatchObject({
          statusCode: 409,
          code: ERROR_CODES.CONCURRENT_UPDATE,
          error: 'Conflict',
        });
        expect(conflict.body.message).toMatch(/retry/i);
      }

      // Exactly one change landed.
      const stored = await ctx.connection.collection('vitalTypes').findOne({ type: 'PULSE' });
      expect(stored!.version).toBe(2);
    });

    it('keeps each patient’s data separate when limits differ', async () => {
      await as(admin, 'put', '/api/v1/admin/alert-thresholds/PAIN')
        .send({ high: 3, severity: 'HIGH', patientId: patient.id })
        .expect(200);

      await save({ PAIN: { num: 5 } });
      await http()
        .put('/api/v1/me/vitals/today')
        .set('Authorization', `Bearer ${ctx.token(otherPatient)}`)
        .send({ date: today(), readings: { PAIN: { num: 5 } } })
        .expect(200);

      const alerts = await ctx.connection.collection('vitalAlerts').find({}).toArray();
      expect(alerts).toHaveLength(1);
      expect(String(alerts[0].patientId)).toBe(patient.id);
    });
  });
});
