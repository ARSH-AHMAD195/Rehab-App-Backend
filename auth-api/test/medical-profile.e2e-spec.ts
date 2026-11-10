import request from 'supertest';
import { DateTime } from 'luxon';
import { createTestApp, TestContext, TestUser } from './helpers/test-app';

describe('Medical profile', () => {
  let t: TestContext;
  let admin: TestUser;
  let doctor: TestUser;
  let otherDoctor: TestUser;
  let patient: TestUser;
  const api = () => request(t.app.getHttpServer());
  const mine = '/api/v1/patients/me/medical-profile';
  const theirs = () => `/api/v1/patients/${patient.id}/medical-profile`;

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

  it('is empty with version 0 before the first save', async () => {
    const res = await api().get(mine).set('Authorization', t.auth(patient)).expect(200);
    expect(res.body).toMatchObject({ patientId: patient.id, dateOfBirth: null, comorbidities: null, version: 0, updatedBy: null });
  });

  it('the patient saves it; version goes 0 -> 1 -> 2', async () => {
    const first = await api()
      .patch(mine)
      .set('Authorization', t.auth(patient))
      .send({
        version: 0,
        dateOfBirth: '1962-04-18',
        sex: 'MALE',
        heightCm: 172,
        bloodGroup: 'B+',
        comorbidities: [' Type 2 diabetes '],
        emergencyContact: { name: 'Sunita Iyer', relation: 'Wife', phone: '+919812345678' },
      })
      .expect(200);
    expect(first.body).toMatchObject({
      version: 1,
      dateOfBirth: '1962-04-18',
      comorbidities: ['Type 2 diabetes'],
      emergencyContact: { name: 'Sunita Iyer', relation: 'Wife', phone: '+919812345678' },
      updatedBy: { id: patient.id, role: 'PATIENT' },
    });
    expect(first.body.updatedAt).toMatch(/\+05:30$/);

    const second = await api().patch(mine).set('Authorization', t.auth(patient)).send({ version: 1, heightCm: null }).expect(200);
    expect(second.body).toMatchObject({ version: 2, heightCm: null, sex: 'MALE' });

    const audits = await t.connection.collection('auditLogs').find({ action: 'MEDICAL_PROFILE_UPDATED' }).sort({ at: 1 }).toArray();
    expect(audits).toHaveLength(2);
    expect(audits[1]).toMatchObject({ before: { heightCm: 172 }, after: { heightCm: null } });
    expect(String(audits[1].patientId)).toBe(patient.id);
  });

  it('409 CONCURRENT_UPDATE when the version is stale', async () => {
    await api().patch(mine).set('Authorization', t.auth(patient)).send({ version: 0, sex: 'MALE' }).expect(200);
    const res = await api().patch(mine).set('Authorization', t.auth(patient)).send({ version: 0, sex: 'OTHER' }).expect(409);
    expect(res.body.code).toBe('CONCURRENT_UPDATE');
    await api().patch(theirs()).set('Authorization', t.auth(doctor)).send({ version: 5, sex: 'OTHER' }).expect(409);
  });

  it('re-sending unchanged values keeps the version and writes no audit', async () => {
    await api().patch(mine).set('Authorization', t.auth(patient)).send({ version: 0, allergies: ['Penicillin'] }).expect(200);
    const res = await api().patch(mine).set('Authorization', t.auth(patient)).send({ version: 1, allergies: ['Penicillin'] }).expect(200);
    expect(res.body.version).toBe(1);
    expect(await t.connection.collection('auditLogs').countDocuments({ action: 'MEDICAL_PROFILE_UPDATED' })).toBe(1);
  });

  it('a linked doctor reads (audited) and edits it', async () => {
    await api().patch(mine).set('Authorization', t.auth(patient)).send({ version: 0, diagnosis: 'Colorectal cancer' }).expect(200);

    const read = await api().get(theirs()).set('Authorization', t.auth(doctor)).expect(200);
    expect(read.body.diagnosis).toBe('Colorectal cancer');
    const viewed = await t.connection.collection('auditLogs').findOne({ action: 'MEDICAL_PROFILE_VIEWED' });
    expect(viewed).toMatchObject({ actorRole: 'DOCTOR', resourceId: patient.id });

    const edit = await api()
      .patch(theirs())
      .set('Authorization', t.auth(doctor))
      .send({ version: 1, plannedSurgery: 'Right hemicolectomy', plannedSurgeryDate: '2026-11-20' })
      .expect(200);
    expect(edit.body).toMatchObject({ version: 2, updatedBy: { id: doctor.id, role: 'DOCTOR' } });
  });

  it('a doctor sets the programme dates; they come back on the next read', async () => {
    const edit = await api()
      .patch(theirs())
      .set('Authorization', t.auth(doctor))
      .send({ version: 0, programmeStartDate: '2026-10-23', programmeLengthDays: 28 })
      .expect(200);
    expect(edit.body).toMatchObject({ version: 1, programmeStartDate: '2026-10-23', programmeLengthDays: 28 });

    const read = await api().get(mine).set('Authorization', t.auth(patient)).expect(200);
    expect(read.body).toMatchObject({ programmeStartDate: '2026-10-23', programmeLengthDays: 28 });
  });

  describe('doctor onboarding', () => {
    // The patient's own today (seeded patients are in Asia/Kolkata).
    const today = () => DateTime.now().setZone('Asia/Kolkata').startOf('day');
    const iso = (d: DateTime) => d.toISODate()!;

    it('a doctor saves the onboarding fields; BMI, age and days to surgery are worked out', async () => {
      const res = await api()
        .patch(theirs())
        .set('Authorization', t.auth(doctor))
        .send({
          version: 0,
          dateOfBirth: iso(today().minus({ years: 64, days: 1 })),
          sex: 'MALE',
          heightCm: 172,
          onboardingWeightKg: 68.5,
          chemotherapy: true,
          radiotherapy: false,
          lastChemoDate: iso(today().minus({ days: 20 })),
          chemoSchedule: ' FOLFOX, every 2 weeks ',
          anaemia: false,
          medications: ['Metformin 500 mg twice daily'],
          conditions: ['HTN', 'DM', 'OTHER'],
          otherConditions: 'Hypothyroidism',
          plannedSurgeryDate: iso(today().plus({ days: 10 })),
        })
        .expect(200);

      expect(res.body).toMatchObject({
        version: 1,
        onboardingWeightKg: 68.5,
        chemotherapy: true,
        radiotherapy: false,
        chemoSchedule: 'FOLFOX, every 2 weeks',
        anaemia: false,
        conditions: ['HTN', 'DM', 'OTHER'],
        otherConditions: 'Hypothyroidism',
        age: 64,
        bmi: 23.2,
        daysToSurgery: 10,
        updatedBy: { id: doctor.id, role: 'DOCTOR' },
      });

      // The patient sees the same on their own read.
      const mineRead = await api().get(mine).set('Authorization', t.auth(patient)).expect(200);
      expect(mineRead.body).toMatchObject({ age: 64, bmi: 23.2, daysToSurgery: 10, chemotherapy: true });

      const audit = await t.connection.collection('auditLogs').findOne({ action: 'MEDICAL_PROFILE_UPDATED' });
      expect(audit?.after).toMatchObject({ onboardingWeightKg: 68.5, conditions: ['HTN', 'DM', 'OTHER'] });
    });

    it('calculated values are null until their inputs are set, and follow later changes', async () => {
      const empty = await api().get(theirs()).set('Authorization', t.auth(doctor)).expect(200);
      expect(empty.body).toMatchObject({ age: null, bmi: null, daysToSurgery: null });

      await api()
        .patch(theirs())
        .set('Authorization', t.auth(doctor))
        .send({ version: 0, heightCm: 175, onboardingWeightKg: 70, plannedSurgeryDate: iso(today().minus({ days: 3 })) })
        .expect(200);
      const cleared = await api()
        .patch(theirs())
        .set('Authorization', t.auth(doctor))
        .send({ version: 1, onboardingWeightKg: null })
        .expect(200);
      expect(cleared.body).toMatchObject({ bmi: null, daysToSurgery: -3 });
    });

    it('calculated values cannot be written', async () => {
      const res = await api().patch(theirs()).set('Authorization', t.auth(doctor)).send({ version: 0, bmi: 22 }).expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });

    it('the patient list shows each patient\'s surgery date and days to surgery', async () => {
      const noProfile = await t.seed({ role: 'PATIENT', name: 'Anil Kumar', doctorIds: [doctor.id] });
      await api()
        .patch(theirs())
        .set('Authorization', t.auth(doctor))
        .send({ version: 0, plannedSurgeryDate: iso(today().plus({ days: 14 })) })
        .expect(200);

      const list = await api().get('/api/v1/patients').set('Authorization', t.auth(doctor)).expect(200);
      const byId = new Map(list.body.data.map((p: { id: string }) => [p.id, p]));
      expect(byId.get(patient.id)).toMatchObject({ plannedSurgeryDate: iso(today().plus({ days: 14 })), daysToSurgery: 14 });
      expect(byId.get(noProfile.id)).toMatchObject({ plannedSurgeryDate: null, daysToSurgery: null });

      const one = await api().get(`/api/v1/patients/${patient.id}`).set('Authorization', t.auth(doctor)).expect(200);
      expect(one.body).toMatchObject({ daysToSurgery: 14 });
    });

    it('400 for a last chemo date in the future', async () => {
      const res = await api()
        .patch(theirs())
        .set('Authorization', t.auth(doctor))
        .send({ version: 0, lastChemoDate: iso(today().plus({ days: 1 })) })
        .expect(400);
      expect(res.body.details[0]).toMatchObject({ field: 'lastChemoDate', code: 'OUT_OF_RANGE' });
    });
  });

  it('an unlinked doctor gets 404; an admin and the patient get 403 on the doctor route', async () => {
    await api().get(theirs()).set('Authorization', t.auth(otherDoctor)).expect(404);
    await api().patch(theirs()).set('Authorization', t.auth(otherDoctor)).send({ version: 0, sex: 'MALE' }).expect(404);
    await api().get(theirs()).set('Authorization', t.auth(admin)).expect(403);
    await api().get(theirs()).set('Authorization', t.auth(patient)).expect(403);
    expect(await t.connection.collection('auditLogs').countDocuments({ action: 'MEDICAL_PROFILE_VIEWED' })).toBe(0);
  });

  it('admins and doctors cannot use the /me route', async () => {
    await api().get(mine).set('Authorization', t.auth(admin)).expect(403);
    await api().get(mine).set('Authorization', t.auth(doctor)).expect(403);
  });

  it('a failed audit write fails the doctor read with 500, returning no data', async () => {
    const spy = jest
      .spyOn(t.connection.models.AuditLog, 'create')
      .mockRejectedValueOnce(new Error('audit store down') as never);
    const res = await api().get(theirs()).set('Authorization', t.auth(doctor)).expect(500);
    expect(res.body).toMatchObject({ code: 'INTERNAL', message: 'Unexpected server error' });
    expect(res.body).not.toHaveProperty('diagnosis');
    spy.mockRestore();
  });

  describe('validation', () => {
    const bad: [string, Record<string, unknown>][] = [
      ['missing version', { sex: 'MALE' }],
      ['future birth date', { version: 0, dateOfBirth: '2999-01-01' }],
      ['impossible date', { version: 0, dateOfBirth: '1990-02-30' }],
      ['age over 120', { version: 0, dateOfBirth: '1850-01-01' }],
      ['unknown sex', { version: 0, sex: 'M' }],
      ['height out of range', { version: 0, heightCm: 20 }],
      ['unknown blood group', { version: 0, bloodGroup: 'C+' }],
      ['too many allergies', { version: 0, allergies: Array.from({ length: 21 }, (_, i) => `a${i}`) }],
      ['bad emergency phone', { version: 0, emergencyContact: { name: 'S', relation: 'Wife', phone: '123' } }],
      ['unknown field', { version: 0, weightKg: 70 }],
      ['diagnosis too long', { version: 0, diagnosis: 'x'.repeat(501) }],
      ['impossible programme start', { version: 0, programmeStartDate: '2026-02-30' }],
      ['programme of 0 days', { version: 0, programmeLengthDays: 0 }],
      ['programme over a year', { version: 0, programmeLengthDays: 366 }],
      ['programme length not whole', { version: 0, programmeLengthDays: 7.5 }],
      ['onboarding weight too low', { version: 0, onboardingWeightKg: 10 }],
      ['onboarding weight too high', { version: 0, onboardingWeightKg: 300 }],
      ['onboarding weight not a number', { version: 0, onboardingWeightKg: '70' }],
      ['chemotherapy not yes/no', { version: 0, chemotherapy: 'yes' }],
      ['anaemia not yes/no', { version: 0, anaemia: 1 }],
      ['impossible last chemo date', { version: 0, lastChemoDate: '2026-02-30' }],
      ['chemo schedule too long', { version: 0, chemoSchedule: 'x'.repeat(501) }],
      ['unknown condition', { version: 0, conditions: ['ASTHMA'] }],
      ['condition twice', { version: 0, conditions: ['HTN', 'HTN'] }],
      ['conditions not a list', { version: 0, conditions: 'HTN' }],
      ['other conditions too long', { version: 0, otherConditions: 'x'.repeat(201) }],
    ];

    it.each(bad)('400 for %s', async (_label, body) => {
      const res = await api().patch(mine).set('Authorization', t.auth(patient)).send(body).expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(res.body.details.length).toBeGreaterThan(0);
    });
  });
});
