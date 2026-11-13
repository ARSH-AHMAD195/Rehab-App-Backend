import request from 'supertest';
import { DateTime } from 'luxon';
import { createTestApp, TestContext, TestUser } from './helpers/test-app';

describe('Investigations (PAC grid)', () => {
  let t: TestContext;
  let admin: TestUser;
  let doctor: TestUser;
  let otherDoctor: TestUser;
  let patient: TestUser;
  const api = () => request(t.app.getHttpServer());
  const base = () => `/api/v1/patients/${patient.id}/investigations`;
  const add = (body: Record<string, unknown>, as: TestUser = doctor) =>
    api().post(base()).set('Authorization', t.auth(as)).send(body);
  const grid = (query = '', as: TestUser = doctor) => api().get(`${base()}${query}`).set('Authorization', t.auth(as));
  const setRange = (body: Record<string, unknown>) =>
    api().put('/api/v1/admin/investigation-ranges').set('Authorization', t.auth(admin)).send(body);
  const today = () => DateTime.now().setZone('Asia/Kolkata').startOf('day');
  const daysAgo = (n: number) => today().minus({ days: n }).toISODate()!;
  const row = (body: { tests: { test: string }[] }, test: string) =>
    body.tests.find((r) => r.test === test) as { test: string; label: string; results: Record<string, unknown>[] };

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

  it('lists the PAC tests with their fields; ranges are empty until the clinic sets them', async () => {
    const res = await api().get('/api/v1/investigation-tests').set('Authorization', t.auth(doctor)).expect(200);
    const codes = res.body.data.map((d: { code: string }) => d.code);
    expect(codes).toEqual([
      'HB', 'TLC', 'DLC', 'PLATELETS', 'PT_INR',
      'BLOOD_SUGAR', 'HBA1C', 'UREA', 'CREATININE', 'ELECTROLYTES', 'LFT', 'ALBUMIN', 'TFT', 'ABG',
      'ECG', 'ECHO', 'PFT', 'IMAGING',
      'MUST', 'PG_SGA',
    ]);
    const hb = res.body.data[0];
    expect(hb).toMatchObject({ label: 'Haemoglobin (Hb)', group: 'HAEMATOLOGY', allowWnl: false, feedsTriage: true });
    expect(hb.fields).toEqual([expect.objectContaining({ key: 'value', unit: 'g/dL', range: null })]);
  });

  it('keeps repeat results side by side, newest test date first, with the history audited', async () => {
    await add({ test: 'HB', takenOn: daysAgo(20), values: { value: 8.6 } }).expect(201);
    await add({ test: 'HB', takenOn: daysAgo(2), values: { value: 10.1 }, comment: 'After iron infusion' }).expect(201);
    // Entered late, but dated between the other two.
    const middle = await add({ test: 'HB', takenOn: daysAgo(10), values: { value: 9.2 } }).expect(201);
    expect(middle.body).toMatchObject({
      test: 'HB',
      takenOn: daysAgo(10),
      values: { value: 9.2 },
      wnl: false,
      flags: {},
      outOfRange: false,
      status: 'ACTIVE',
      enteredBy: { id: doctor.id, role: 'DOCTOR' },
    });

    const res = await grid().expect(200);
    expect(res.body.tests).toHaveLength(20);
    expect(row(res.body, 'HB').results.map((r) => r.values)).toEqual([{ value: 10.1 }, { value: 9.2 }, { value: 8.6 }]);
    expect(row(res.body, 'HB').results[0]).toMatchObject({ comment: 'After iron infusion' });
    expect(row(res.body, 'ALBUMIN').results).toEqual([]);

    expect(await t.connection.collection('auditLogs').countDocuments({ action: 'INVESTIGATION_ADDED' })).toBe(3);
    expect(await t.connection.collection('auditLogs').countDocuments({ action: 'INVESTIGATIONS_VIEWED' })).toBe(1);
  });

  it('WNL quick entry for LFT, TFT, ECG and imaging', async () => {
    await add({ test: 'LFT', takenOn: daysAgo(1), wnl: true }).expect(201);
    await add({ test: 'TFT', takenOn: daysAgo(1), wnl: true }).expect(201);
    await add({ test: 'ECG', takenOn: daysAgo(1), wnl: true }).expect(201);
    const xray = await add({ test: 'IMAGING', takenOn: daysAgo(1), wnl: true, values: { study: 'Chest X-ray' } }).expect(201);
    expect(xray.body).toMatchObject({ wnl: true, values: { study: 'Chest X-ray' }, outOfRange: false });

    const res = await add({ test: 'HB', takenOn: daysAgo(1), wnl: true }).expect(400);
    expect(res.body.details).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'wnl', code: 'NOT_ALLOWED' })]));
  });

  it('multi-value and text tests', async () => {
    await add({ test: 'ELECTROLYTES', takenOn: daysAgo(1), values: { sodium: 138, potassium: 4.2, chloride: 101 } }).expect(201);
    await add({ test: 'PT_INR', takenOn: daysAgo(1), values: { pt: 13.5, inr: 1.1 } }).expect(201);
    await add({ test: 'BLOOD_SUGAR', takenOn: daysAgo(1), values: { value: 112, sample: 'FASTING' } }).expect(201);
    await add({ test: 'ECHO', takenOn: daysAgo(1), values: { ef: 55 }, comment: 'No RWMA' }).expect(201);
    await add({ test: 'ABG', takenOn: daysAgo(1), values: { result: 'pH 7.38, pCO2 41' } }).expect(201);
    await add({ test: 'ECG', takenOn: daysAgo(1), values: { finding: 'ABNORMAL' }, comment: 'LBBB' }).expect(201);
  });

  describe('normal ranges and red flags', () => {
    it('nothing is flagged before the clinic approves a range', async () => {
      const res = await add({ test: 'HB', takenOn: daysAgo(1), values: { value: 6.5 } }).expect(201);
      expect(res.body).toMatchObject({ flags: {}, outOfRange: false });
    });

    it('once an admin sets a range, values outside it are flagged, past ones included', async () => {
      await add({ test: 'HB', takenOn: daysAgo(5), values: { value: 9.4 } }).expect(201);

      const set = await setRange({ test: 'HB', field: 'value', low: 12, high: 16 }).expect(200);
      expect(set.body).toEqual({ test: 'HB', field: 'value', low: 12, high: 16 });

      await add({ test: 'HB', takenOn: daysAgo(1), values: { value: 13.2 } }).expect(201);
      const res = await grid('?test=HB').expect(200);
      expect(res.body.tests).toHaveLength(1);
      expect(row(res.body, 'HB').results.map((r) => [r.values, r.flags, r.outOfRange])).toEqual([
        [{ value: 13.2 }, {}, false],
        [{ value: 9.4 }, { value: 'LOW' }, true],
      ]);

      const tests = await api().get('/api/v1/investigation-tests').set('Authorization', t.auth(doctor)).expect(200);
      expect(tests.body.data[0].fields[0].range).toEqual({ low: 12, high: 16 });

      const list = await api().get('/api/v1/admin/investigation-ranges').set('Authorization', t.auth(admin)).expect(200);
      expect(list.body.data).toEqual([expect.objectContaining({ test: 'HB', field: 'value', unit: 'g/dL', low: 12, high: 16 })]);
    });

    it('a range change is audited, and null for both removes it', async () => {
      await setRange({ test: 'ALBUMIN', field: 'value', low: 3.5, high: 5 }).expect(200);
      await setRange({ test: 'ALBUMIN', field: 'value', low: 3.4, high: 5 }).expect(200);
      await setRange({ test: 'ALBUMIN', field: 'value', low: null, high: null }).expect(200);
      const audits = await t.connection.collection('auditLogs').find({ action: 'INVESTIGATION_RANGE_CHANGED' }).sort({ at: 1 }).toArray();
      expect(audits.map((a) => [a.before, a.after])).toEqual([
        [null, { low: 3.5, high: 5 }],
        [{ low: 3.5, high: 5 }, { low: 3.4, high: 5 }],
        [{ low: 3.4, high: 5 }, null],
      ]);
      expect(await t.connection.collection('investigationRanges').countDocuments({})).toBe(0);
    });

    it('an abnormal ECG is flagged', async () => {
      const res = await add({ test: 'ECG', takenOn: daysAgo(1), values: { finding: 'ABNORMAL' } }).expect(201);
      expect(res.body).toMatchObject({ flags: { finding: 'ABNORMAL' }, outOfRange: true });
    });

    it.each([
      ['a text field', { test: 'LFT', field: 'result', low: 1, high: 2 }],
      ['an unknown field', { test: 'HB', field: 'nope', low: 1, high: 2 }],
      ['low not below high', { test: 'HB', field: 'value', low: 16, high: 12 }],
      ['beyond the entry limits', { test: 'HB', field: 'value', low: 0, high: 40 }],
      ['a missing side', { test: 'HB', field: 'value', low: 12 }],
    ])('400 for a range on %s', async (_label, body) => {
      const res = await setRange(body).expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });

    it('only an admin sets ranges', async () => {
      await api().put('/api/v1/admin/investigation-ranges').set('Authorization', t.auth(doctor))
        .send({ test: 'HB', field: 'value', low: 12, high: 16 }).expect(403);
    });
  });

  describe('corrections', () => {
    it('a wrong result is retracted with a reason, kept, and leaves the grid', async () => {
      const wrong = await add({ test: 'HBA1C', takenOn: daysAgo(3), values: { value: 85 / 10 } }).expect(201);
      const res = await api()
        .post(`${base()}/${wrong.body.id}/retract`)
        .set('Authorization', t.auth(doctor))
        .send({ reason: 'Belongs to another patient' })
        .expect(200);
      expect(res.body).toMatchObject({ status: 'RETRACTED', retraction: { reason: 'Belongs to another patient', by: { id: doctor.id } } });

      expect(row((await grid().expect(200)).body, 'HBA1C').results).toEqual([]);
      const all = await grid('?includeRetracted=true').expect(200);
      expect(row(all.body, 'HBA1C').results).toEqual([expect.objectContaining({ id: wrong.body.id, status: 'RETRACTED' })]);
      expect(await t.connection.collection('investigations').countDocuments({})).toBe(1);

      const twice = await api().post(`${base()}/${wrong.body.id}/retract`).set('Authorization', t.auth(doctor)).send({ reason: 'again' }).expect(400);
      expect(twice.body.code).toBe('VALIDATION_FAILED');
    });

    it('404 for a result of another patient or an unknown id; 400 without a reason', async () => {
      const otherPatient = await t.seed({ role: 'PATIENT', name: 'Other', doctorIds: [doctor.id] });
      const theirs = await api()
        .post(`/api/v1/patients/${otherPatient.id}/investigations`)
        .set('Authorization', t.auth(doctor))
        .send({ test: 'HB', takenOn: daysAgo(1), values: { value: 11 } })
        .expect(201);
      await api().post(`${base()}/${theirs.body.id}/retract`).set('Authorization', t.auth(doctor)).send({ reason: 'x' }).expect(404);
      await api().post(`${base()}/nope/retract`).set('Authorization', t.auth(doctor)).send({ reason: 'x' }).expect(404);
      await api().post(`${base()}/${theirs.body.id}/retract`).set('Authorization', t.auth(doctor)).send({}).expect(400);
    });
  });

  describe('access', () => {
    it('an unlinked doctor gets 404 and nothing is audited', async () => {
      await grid('', otherDoctor).expect(404);
      await add({ test: 'HB', takenOn: daysAgo(1), values: { value: 11 } }, otherDoctor).expect(404);
      expect(await t.connection.collection('auditLogs').countDocuments({ action: /^INVESTIGATION/ })).toBe(0);
    });

    it('admins and patients cannot read or add results', async () => {
      await grid('', admin).expect(403);
      await grid('', patient).expect(403);
      await add({ test: 'HB', takenOn: daysAgo(1), values: { value: 11 } }, patient).expect(403);
    });

    it('a failed audit write fails the read with 500, returning no data', async () => {
      const spy = jest.spyOn(t.connection.models.AuditLog, 'create').mockRejectedValueOnce(new Error('audit store down') as never);
      const res = await grid().expect(500);
      expect(res.body).not.toHaveProperty('tests');
      spy.mockRestore();
    });
  });

  describe('validation', () => {
    it.each([
      ['an unknown test', { test: 'XRAY', takenOn: '2026-01-01', values: { value: 1 } }],
      ['a future date', { test: 'HB', takenOn: '2999-01-01', values: { value: 11 } }],
      ['an impossible date', { test: 'HB', takenOn: '2026-02-30', values: { value: 11 } }],
      ['no values', { test: 'HB', takenOn: '2026-01-01' }],
      ['a typing mistake (Hb 110)', { test: 'HB', takenOn: '2026-01-01', values: { value: 110 } }],
      ['a value as text', { test: 'HB', takenOn: '2026-01-01', values: { value: '11' } }],
      ['a field the test lacks', { test: 'HB', takenOn: '2026-01-01', values: { value: 11, ef: 50 } }],
      ['values not an object', { test: 'HB', takenOn: '2026-01-01', values: 11 }],
      ['blood sugar without sample type', { test: 'BLOOD_SUGAR', takenOn: '2026-01-01', values: { value: 110 } }],
      ['an ECG finding that is not on the list', { test: 'ECG', takenOn: '2026-01-01', values: { finding: 'BORDERLINE' } }],
      ['a comment over 500 characters', { test: 'HB', takenOn: '2026-01-01', values: { value: 11 }, comment: 'x'.repeat(501) }],
    ])('400 for %s', async (_label, body) => {
      const res = await add(body).expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });
  });
});
