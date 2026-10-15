import request from 'supertest';
import { Types } from 'mongoose';
import { AuditService } from '../src/audit/audit.service';
import { createTestApp, TestContext, TestUser } from './helpers/test-app';

describe('Registration and invitations', () => {
  let t: TestContext;
  let admin: TestUser;
  let doctor: TestUser;
  const api = () => request(t.app.getHttpServer());

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => t.close());
  beforeEach(async () => {
    await t.reset();
    admin = await t.seed({ role: 'ADMIN', name: 'Admin' });
    doctor = await t.seed({ role: 'DOCTOR', name: 'Dr Meera Nair' });
  });

  describe('POST /doctors', () => {
    it('creates the Firebase account and profile, and sends the set-password email', async () => {
      const res = await api()
        .post('/api/v1/doctors')
        .set('Authorization', t.auth(admin))
        .send({ name: 'Dr Arjun Rao', email: '  Arjun.Rao@Example.com ', specialization: 'Surgical oncology' })
        .expect(201);

      expect(res.body).toMatchObject({
        name: 'Dr Arjun Rao',
        email: 'arjun.rao@example.com',
        specialization: 'Surgical oncology',
        active: true,
        emailVerified: false,
        patientCount: 0,
        invitation: 'SENT',
      });
      expect(t.identity.sentEmails).toEqual(['arjun.rao@example.com']);

      const uid = await t.uidOf(res.body.id);
      expect(t.identity.accounts.get(uid)).toMatchObject({ email: 'arjun.rao@example.com', emailVerified: false });

      const actions = await t.connection.collection('auditLogs').find({ resourceId: res.body.id }).toArray();
      expect(actions.map((a) => a.action).sort()).toEqual(['INVITATION_SENT', 'USER_REGISTERED']);
      expect(String(actions[0].actorId)).toBe(admin.id);
    });

    it('409 EMAIL_ALREADY_EXISTS, case-insensitively', async () => {
      const res = await api()
        .post('/api/v1/doctors')
        .set('Authorization', t.auth(admin))
        .send({ name: 'Dup', email: doctor.email.toUpperCase() })
        .expect(409);
      expect(res.body.code).toBe('EMAIL_ALREADY_EXISTS');
      expect(t.identity.accounts.size).toBe(2);
    });

    it('409 when the email exists in Firebase but not in our database', async () => {
      t.identity.accounts.set('stray', { email: 'stray@test.example', emailVerified: true, disabled: false });
      const res = await api()
        .post('/api/v1/doctors')
        .set('Authorization', t.auth(admin))
        .send({ name: 'Stray', email: 'stray@test.example' })
        .expect(409);
      expect(res.body.code).toBe('EMAIL_ALREADY_EXISTS');
    });

    it('403 for a doctor or patient', async () => {
      const patient = await t.seed({ role: 'PATIENT', name: 'P', doctorIds: [doctor.id] });
      for (const caller of [doctor, patient]) {
        const res = await api().post('/api/v1/doctors').set('Authorization', t.auth(caller)).send({ name: 'X', email: 'x@test.example' }).expect(403);
        expect(res.body.code).toBe('FORBIDDEN_ROLE');
      }
    });

    it('400 for a bad email or a missing name', async () => {
      await api().post('/api/v1/doctors').set('Authorization', t.auth(admin)).send({ name: 'X', email: 'not-an-email' }).expect(400);
      await api().post('/api/v1/doctors').set('Authorization', t.auth(admin)).send({ email: 'x@test.example' }).expect(400);
    });

    it('a failed email is reported, not fatal: the user exists and can be re-invited', async () => {
      t.identity.failEmails = true;
      const res = await api()
        .post('/api/v1/doctors')
        .set('Authorization', t.auth(admin))
        .send({ name: 'Dr X', email: 'x@test.example' })
        .expect(201);
      expect(res.body.invitation).toBe('FAILED');

      t.identity.failEmails = false;
      const again = await api().post(`/api/v1/users/${res.body.id}/invitations`).set('Authorization', t.auth(admin)).expect(202);
      expect(again.body).toEqual({ invitation: 'SENT' });
    });

    it('an audit failure after the email went out does not fail a finished registration', async () => {
      const audit = t.app.get(AuditService);
      const record = audit.record.bind(audit);
      const spy = jest.spyOn(audit, 'record').mockImplementation(async (entry, session) => {
        if (entry.action === 'INVITATION_SENT') throw new Error('mongo blip');
        return record(entry, session);
      });
      try {
        const res = await api()
          .post('/api/v1/doctors')
          .set('Authorization', t.auth(admin))
          .send({ name: 'Dr X', email: 'x@test.example' })
          .expect(201);
        expect(res.body.invitation).toBe('SENT');
        expect(t.identity.sentEmails).toEqual(['x@test.example']);
      } finally {
        spy.mockRestore();
      }
    });

    it('400 details carry the documented codes', async () => {
      const cases: [object, string, string][] = [
        [{ email: 'x@test.example' }, 'name', 'REQUIRED'],
        [{ name: '   ', email: 'x@test.example' }, 'name', 'REQUIRED'],
        [{ name: 'x'.repeat(101), email: 'x@test.example' }, 'name', 'TOO_LONG'],
      ];
      for (const [body, field, code] of cases) {
        const res = await api().post('/api/v1/doctors').set('Authorization', t.auth(admin)).send(body).expect(400);
        expect(res.body.details).toEqual([{ field, code, issue: expect.any(String) }]);
      }
    });

    it('removes the Firebase account again when the profile cannot be saved', async () => {
      // The fake's next uid is fb-1; occupy it so the profile insert clashes.
      await t.connection.collection('users').insertOne({ firebaseUid: 'fb-1', role: 'ADMIN', name: 'clash', active: true });
      await api().post('/api/v1/doctors').set('Authorization', t.auth(admin)).send({ name: 'Dr X', email: 'x@test.example' }).expect(409);
      expect(t.identity.deleted).toEqual(['fb-1']);
      expect(await t.connection.collection('users').countDocuments({ email: 'x@test.example' })).toBe(0);
    });
  });

  describe('POST /patients', () => {
    it('a doctor registers a patient, who is linked to that doctor', async () => {
      const res = await api()
        .post('/api/v1/patients')
        .set('Authorization', t.auth(doctor))
        .send({ name: 'Rajesh Iyer', email: 'rajesh@example.com', phone: '+919876543210' })
        .expect(201);
      expect(res.body).toMatchObject({
        name: 'Rajesh Iyer',
        timeZone: 'Asia/Kolkata',
        doctors: [{ id: doctor.id, name: 'Dr Meera Nair' }],
        invitation: 'SENT',
      });

      const audit = await t.connection.collection('auditLogs').findOne({ action: 'USER_REGISTERED' });
      expect(String(audit!.patientId)).toBe(res.body.id);
    });

    it('a doctor may not choose doctorIds', async () => {
      const res = await api()
        .post('/api/v1/patients')
        .set('Authorization', t.auth(doctor))
        .send({ name: 'R', email: 'r@test.example', doctorIds: [doctor.id] })
        .expect(400);
      expect(res.body.details[0]).toMatchObject({ field: 'doctorIds', code: 'NOT_ALLOWED' });
    });

    it('an admin must name at least one active doctor', async () => {
      await api().post('/api/v1/patients').set('Authorization', t.auth(admin)).send({ name: 'R', email: 'r@test.example' }).expect(400);
      await api().post('/api/v1/patients').set('Authorization', t.auth(admin)).send({ name: 'R', email: 'r@test.example', doctorIds: [] }).expect(400);

      const res = await api()
        .post('/api/v1/patients')
        .set('Authorization', t.auth(admin))
        .send({ name: 'R', email: 'r@test.example', doctorIds: [doctor.id], timeZone: 'Europe/London' })
        .expect(201);
      expect(res.body).toMatchObject({ timeZone: 'Europe/London', doctors: [{ id: doctor.id }] });
    });

    it('accepts a doctor id in upper case', async () => {
      const res = await api()
        .post('/api/v1/patients')
        .set('Authorization', t.auth(admin))
        .send({ name: 'R', email: 'r@test.example', doctorIds: [doctor.id.toUpperCase()] })
        .expect(201);
      expect(res.body.doctors).toEqual([{ id: doctor.id, name: 'Dr Meera Nair' }]);
    });

    it('400 REQUIRED for an empty doctor list, TOO_LONG for more than 10', async () => {
      const tooMany = Array.from({ length: 11 }, () => new Types.ObjectId().toString());
      for (const [doctorIds, code] of [[[], 'REQUIRED'], [tooMany, 'TOO_LONG']] as const) {
        const res = await api()
          .post('/api/v1/patients')
          .set('Authorization', t.auth(admin))
          .send({ name: 'R', email: 'r@test.example', doctorIds })
          .expect(400);
        expect(res.body.details).toEqual([{ field: 'doctorIds', code, issue: expect.any(String) }]);
      }
    });

    it('404 for an unknown doctor, 400 for a deactivated one', async () => {
      const retired = await t.seed({ role: 'DOCTOR', name: 'Dr Old', active: false });
      const unknown = await api()
        .post('/api/v1/patients')
        .set('Authorization', t.auth(admin))
        .send({ name: 'R', email: 'r@test.example', doctorIds: ['6700aa01e4b0f1a2b3c4d500'] })
        .expect(404);
      expect(unknown.body.code).toBe('NOT_FOUND');
      await api()
        .post('/api/v1/patients')
        .set('Authorization', t.auth(admin))
        .send({ name: 'R', email: 'r@test.example', doctorIds: [retired.id] })
        .expect(400);
      expect(t.identity.sentEmails).toEqual([]);
    });

    it('400 for an unknown time zone', async () => {
      await api()
        .post('/api/v1/patients')
        .set('Authorization', t.auth(doctor))
        .send({ name: 'R', email: 'r@test.example', timeZone: 'Asia/Atlantis' })
        .expect(400);
    });

    it('403 for a patient', async () => {
      const patient = await t.seed({ role: 'PATIENT', name: 'P', doctorIds: [doctor.id] });
      await api().post('/api/v1/patients').set('Authorization', t.auth(patient)).send({ name: 'R', email: 'r@test.example' }).expect(403);
    });

    it('a new user starts unverified, and is let in once they verify', async () => {
      const res = await api().post('/api/v1/patients').set('Authorization', t.auth(doctor)).send({ name: 'R', email: 'r@test.example' }).expect(201);
      const uid = await t.uidOf(res.body.id);

      const me = await api().get('/api/v1/auth/me').set('Authorization', `Bearer ${uid}`).expect(200);
      expect(me.body).toMatchObject({ role: 'PATIENT', emailVerified: false });
      await api().get('/api/v1/users/me/profile').set('Authorization', `Bearer ${uid}`).expect(403);

      t.identity.verifyEmail(uid);
      await api().get('/api/v1/users/me/profile').set('Authorization', `Bearer ${uid}`).expect(200);
    });
  });

  describe('rate limit', () => {
    it('the 21st registration in a minute gets 429 with Retry-After', async () => {
      const rateAdmin = await t.seed({ role: 'ADMIN', name: 'Busy admin' });
      for (let i = 0; i < 20; i++) {
        await api().post('/api/v1/admins').set('Authorization', t.auth(rateAdmin)).send({ name: `A${i}`, email: `a${i}@rate.example` }).expect(201);
      }
      const res = await api().post('/api/v1/admins').set('Authorization', t.auth(rateAdmin)).send({ name: 'A20', email: 'a20@rate.example' }).expect(429);
      expect(res.body.code).toBe('RATE_LIMITED');
      expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);

      // Other routes still have their own, larger budget.
      await api().get('/api/v1/auth/me').set('Authorization', t.auth(rateAdmin)).expect(200);
    });
  });

  describe('POST /admins', () => {
    it('an admin registers another admin', async () => {
      const res = await api().post('/api/v1/admins').set('Authorization', t.auth(admin)).send({ name: 'Priya', email: 'priya@test.example' }).expect(201);
      expect(res.body).toMatchObject({ name: 'Priya', active: true, invitation: 'SENT' });
      await api().post('/api/v1/admins').set('Authorization', t.auth(doctor)).send({ name: 'X', email: 'x@test.example' }).expect(403);
    });
  });

  describe('POST /users/:userId/invitations', () => {
    it('an admin can resend for anyone', async () => {
      await api().post(`/api/v1/users/${doctor.id}/invitations`).set('Authorization', t.auth(admin)).expect(202);
      expect(t.identity.sentEmails).toEqual([doctor.email]);
    });

    it('a doctor only for their linked patients; anyone else is 404', async () => {
      const mine = await t.seed({ role: 'PATIENT', name: 'Mine', doctorIds: [doctor.id] });
      const other = await t.seed({ role: 'PATIENT', name: 'Other' });
      await api().post(`/api/v1/users/${mine.id}/invitations`).set('Authorization', t.auth(doctor)).expect(202);
      await api().post(`/api/v1/users/${other.id}/invitations`).set('Authorization', t.auth(doctor)).expect(404);
      await api().post(`/api/v1/users/${admin.id}/invitations`).set('Authorization', t.auth(doctor)).expect(404);
      await api().post('/api/v1/users/not-an-id/invitations').set('Authorization', t.auth(doctor)).expect(404);
    });

    it('409 USER_INACTIVE for a deactivated user', async () => {
      const gone = await t.seed({ role: 'DOCTOR', name: 'Gone', active: false });
      const res = await api().post(`/api/v1/users/${gone.id}/invitations`).set('Authorization', t.auth(admin)).expect(409);
      expect(res.body.code).toBe('USER_INACTIVE');
    });

    it('429 with Retry-After after 5 emails to one user in an hour', async () => {
      for (let i = 0; i < 5; i++) {
        await api().post(`/api/v1/users/${doctor.id}/invitations`).set('Authorization', t.auth(admin)).expect(202);
      }
      const res = await api().post(`/api/v1/users/${doctor.id}/invitations`).set('Authorization', t.auth(admin)).expect(429);
      expect(res.body.code).toBe('RATE_LIMITED');
      expect(res.headers['retry-after']).toBe('3600');
    });

    it('403 for a patient', async () => {
      const patient = await t.seed({ role: 'PATIENT', name: 'P', doctorIds: [doctor.id] });
      await api().post(`/api/v1/users/${patient.id}/invitations`).set('Authorization', t.auth(patient)).expect(403);
    });
  });
});
