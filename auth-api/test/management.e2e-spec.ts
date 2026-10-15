import request from 'supertest';
import { Types } from 'mongoose';
import { AuditService } from '../src/audit/audit.service';
import { createTestApp, TestContext, TestUser } from './helpers/test-app';

describe('Patient and doctor management', () => {
  let t: TestContext;
  let admin: TestUser;
  let drMeera: TestUser;
  let drArjun: TestUser;
  let rajesh: TestUser;
  let anita: TestUser;
  const api = () => request(t.app.getHttpServer());
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const activeDoctorsOf = async (patientId: string) => {
    const patient = await t.connection.collection('users').findOne({ _id: new Types.ObjectId(patientId) });
    return t.connection.collection('users').find({ _id: { $in: patient!.doctorIds }, active: true }).toArray();
  };

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => t.close());
  beforeEach(async () => {
    await t.reset();
    admin = await t.seed({ role: 'ADMIN', name: 'Admin' });
    drMeera = await t.seed({ role: 'DOCTOR', name: 'Dr Meera Nair' });
    drArjun = await t.seed({ role: 'DOCTOR', name: 'Dr Arjun Rao' });
    rajesh = await t.seed({ role: 'PATIENT', name: 'Rajesh Iyer', email: 'rajesh@example.com', doctorIds: [drMeera.id] });
    anita = await t.seed({ role: 'PATIENT', name: 'Anita Shah', doctorIds: [drArjun.id] });
  });

  describe('GET /patients', () => {
    it('a doctor sees only their linked patients', async () => {
      const res = await api().get('/api/v1/patients').set('Authorization', t.auth(drMeera)).expect(200);
      expect(res.body.data.map((p: { name: string }) => p.name)).toEqual(['Rajesh Iyer']);
      expect(res.body.nextCursor).toBeNull();
    });

    it('an admin sees everyone, sorted by name, and can filter by doctor', async () => {
      const all = await api().get('/api/v1/patients').set('Authorization', t.auth(admin)).expect(200);
      expect(all.body.data.map((p: { name: string }) => p.name)).toEqual(['Anita Shah', 'Rajesh Iyer']);

      const arjuns = await api().get(`/api/v1/patients?doctorId=${drArjun.id}`).set('Authorization', t.auth(admin)).expect(200);
      expect(arjuns.body.data.map((p: { name: string }) => p.name)).toEqual(['Anita Shah']);
    });

    it('doctorId is an admin-only filter', async () => {
      await api().get(`/api/v1/patients?doctorId=${drArjun.id}`).set('Authorization', t.auth(drMeera)).expect(400);
    });

    it('searches name or email, case-insensitively', async () => {
      const byName = await api().get('/api/v1/patients?q=ANITA').set('Authorization', t.auth(admin)).expect(200);
      expect(byName.body.data).toHaveLength(1);
      const byEmail = await api().get('/api/v1/patients?q=rajesh@ex').set('Authorization', t.auth(admin)).expect(200);
      expect(byEmail.body.data[0].name).toBe('Rajesh Iyer');
      const regexIsLiteral = await api().get('/api/v1/patients?q=.*').set('Authorization', t.auth(admin)).expect(200);
      expect(regexIsLiteral.body.data).toHaveLength(0);
    });

    it('active=false and active=all', async () => {
      await t.seed({ role: 'PATIENT', name: 'Zed Former', doctorIds: [drMeera.id], active: false });
      const active = await api().get('/api/v1/patients').set('Authorization', t.auth(drMeera)).expect(200);
      expect(active.body.data).toHaveLength(1);
      const inactive = await api().get('/api/v1/patients?active=false').set('Authorization', t.auth(drMeera)).expect(200);
      expect(inactive.body.data.map((p: { name: string }) => p.name)).toEqual(['Zed Former']);
      const all = await api().get('/api/v1/patients?active=all').set('Authorization', t.auth(drMeera)).expect(200);
      expect(all.body.data).toHaveLength(2);
    });

    it('pages with a cursor', async () => {
      for (const name of ['Bala', 'Chitra', 'Dev']) await t.seed({ role: 'PATIENT', name, doctorIds: [drMeera.id] });
      const first = await api().get('/api/v1/patients?limit=2').set('Authorization', t.auth(drMeera)).expect(200);
      expect(first.body.data.map((p: { name: string }) => p.name)).toEqual(['Bala', 'Chitra']);
      const second = await api()
        .get(`/api/v1/patients?limit=2&cursor=${first.body.nextCursor}`)
        .set('Authorization', t.auth(drMeera))
        .expect(200);
      expect(second.body.data.map((p: { name: string }) => p.name)).toEqual(['Dev', 'Rajesh Iyer']);
      expect(second.body.nextCursor).toBeNull();

      await api().get('/api/v1/patients?cursor=garbage').set('Authorization', t.auth(drMeera)).expect(400);
      await api().get('/api/v1/patients?limit=101').set('Authorization', t.auth(drMeera)).expect(400);
    });

    it('400, not 500, for a well-formed cursor with a bad id', async () => {
      const forged = Buffer.from(JSON.stringify({ k: 'x', id: 'not-an-id' })).toString('base64url');
      const res = await api().get(`/api/v1/patients?cursor=${forged}`).set('Authorization', t.auth(drMeera)).expect(400);
      expect(res.body.details).toEqual([{ field: 'cursor', code: 'WRONG_SHAPE', issue: expect.any(String) }]);
    });

    it('400 OUT_OF_RANGE for a one-letter search', async () => {
      const res = await api().get('/api/v1/patients?q=a').set('Authorization', t.auth(admin)).expect(400);
      expect(res.body.details).toEqual([{ field: 'q', code: 'OUT_OF_RANGE', issue: expect.any(String) }]);
    });

    it('403 for a patient', async () => {
      await api().get('/api/v1/patients').set('Authorization', t.auth(rajesh)).expect(403);
    });
  });

  describe('GET /patients/:patientId', () => {
    it('404 for an unlinked, unknown or malformed id - indistinguishable', async () => {
      await api().get(`/api/v1/patients/${rajesh.id}`).set('Authorization', t.auth(drMeera)).expect(200);
      for (const id of [anita.id, '6700aa01e4b0f1a2b3c4d999', 'abc', drArjun.id]) {
        const res = await api().get(`/api/v1/patients/${id}`).set('Authorization', t.auth(drMeera)).expect(404);
        expect(res.body.message).toBe('Patient not found');
      }
    });
  });

  describe('PATCH /patients/:patientId', () => {
    it('a linked doctor updates basic details', async () => {
      const res = await api()
        .patch(`/api/v1/patients/${rajesh.id}`)
        .set('Authorization', t.auth(drMeera))
        .send({ phone: '+919876543210' })
        .expect(200);
      expect(res.body.phone).toBe('+919876543210');
      await api().patch(`/api/v1/patients/${anita.id}`).set('Authorization', t.auth(drMeera)).send({ name: 'X' }).expect(404);
    });

    it('only an admin may deactivate', async () => {
      const res = await api().patch(`/api/v1/patients/${rajesh.id}`).set('Authorization', t.auth(drMeera)).send({ active: false }).expect(403);
      expect(res.body.code).toBe('FORBIDDEN_ROLE');
    });

    it('deactivating locks the user out at once; reactivating lets them back in', async () => {
      await api().get('/api/v1/auth/me').set('Authorization', t.auth(rajesh)).expect(200);

      const off = await api().patch(`/api/v1/patients/${rajesh.id}`).set('Authorization', t.auth(admin)).send({ active: false }).expect(200);
      expect(off.body.active).toBe(false);
      expect(t.identity.accounts.get(rajesh.uid)!.disabled).toBe(true);
      await api().get('/api/v1/auth/me').set('Authorization', t.auth(rajesh)).expect(401);

      const audit = await t.connection.collection('auditLogs').findOne({ action: 'USER_DEACTIVATED' });
      expect(audit).toMatchObject({ before: { active: true }, after: { active: false }, resourceId: rajesh.id });

      await api().patch(`/api/v1/patients/${rajesh.id}`).set('Authorization', t.auth(admin)).send({ active: true }).expect(200);
      await api().get('/api/v1/auth/me').set('Authorization', t.auth(rajesh)).expect(200);
      expect(await t.connection.collection('auditLogs').countDocuments({ action: 'USER_REACTIVATED' })).toBe(1);
    });
  });

  describe('PUT /patients/:patientId/doctors', () => {
    it('replaces the links; a removed doctor loses access at once', async () => {
      const res = await api()
        .put(`/api/v1/patients/${rajesh.id}/doctors`)
        .set('Authorization', t.auth(admin))
        .send({ doctorIds: [drArjun.id] })
        .expect(200);
      expect(res.body.doctors).toEqual([{ id: drArjun.id, name: 'Dr Arjun Rao' }]);

      await api().get(`/api/v1/patients/${rajesh.id}`).set('Authorization', t.auth(drMeera)).expect(404);
      await api().get(`/api/v1/patients/${rajesh.id}`).set('Authorization', t.auth(drArjun)).expect(200);

      const audit = await t.connection.collection('auditLogs').findOne({ action: 'DOCTOR_LINKS_CHANGED' });
      expect(audit).toMatchObject({ before: { doctorIds: [drMeera.id] }, after: { doctorIds: [drArjun.id] } });
    });

    it('no-op when unchanged, 400 for empty or duplicate lists, 404 for unknown', async () => {
      await api().put(`/api/v1/patients/${rajesh.id}/doctors`).set('Authorization', t.auth(admin)).send({ doctorIds: [drMeera.id] }).expect(200);
      expect(await t.connection.collection('auditLogs').countDocuments({ action: 'DOCTOR_LINKS_CHANGED' })).toBe(0);

      await api().put(`/api/v1/patients/${rajesh.id}/doctors`).set('Authorization', t.auth(admin)).send({ doctorIds: [] }).expect(400);
      await api().put(`/api/v1/patients/${rajesh.id}/doctors`).set('Authorization', t.auth(admin)).send({ doctorIds: [drMeera.id, drMeera.id] }).expect(400);
      await api().put(`/api/v1/patients/${rajesh.id}/doctors`).set('Authorization', t.auth(admin)).send({ doctorIds: [admin.id] }).expect(404);
      await api().put(`/api/v1/patients/${drMeera.id}/doctors`).set('Authorization', t.auth(admin)).send({ doctorIds: [drMeera.id] }).expect(404);
    });

    it('accepts doctor ids in upper case', async () => {
      const res = await api()
        .put(`/api/v1/patients/${rajesh.id}/doctors`)
        .set('Authorization', t.auth(admin))
        .send({ doctorIds: [drArjun.id.toUpperCase()] })
        .expect(200);
      expect(res.body.doctors).toEqual([{ id: drArjun.id, name: 'Dr Arjun Rao' }]);
    });

    it('403 for a doctor', async () => {
      await api().put(`/api/v1/patients/${rajesh.id}/doctors`).set('Authorization', t.auth(drMeera)).send({ doctorIds: [drMeera.id] }).expect(403);
    });
  });

  describe('doctors', () => {
    it('GET /doctors lists with patientCount (active linked patients)', async () => {
      await t.seed({ role: 'PATIENT', name: 'Former', doctorIds: [drMeera.id], active: false });
      const res = await api().get('/api/v1/doctors').set('Authorization', t.auth(admin)).expect(200);
      expect(res.body.data.map((d: { name: string; patientCount: number }) => [d.name, d.patientCount])).toEqual([
        ['Dr Arjun Rao', 1],
        ['Dr Meera Nair', 1],
      ]);
      await api().get('/api/v1/doctors').set('Authorization', t.auth(drMeera)).expect(403);
    });

    it('GET /doctors/:doctorId, 404 for a non-doctor', async () => {
      await api().get(`/api/v1/doctors/${drMeera.id}`).set('Authorization', t.auth(admin)).expect(200);
      await api().get(`/api/v1/doctors/${rajesh.id}`).set('Authorization', t.auth(admin)).expect(404);
    });

    it('PATCH updates specialization', async () => {
      const res = await api()
        .patch(`/api/v1/doctors/${drMeera.id}`)
        .set('Authorization', t.auth(admin))
        .send({ specialization: 'Anaesthesia' })
        .expect(200);
      expect(res.body.specialization).toBe('Anaesthesia');
    });

    it('409 DOCTOR_HAS_PATIENTS when deactivation would strand a patient', async () => {
      const res = await api().patch(`/api/v1/doctors/${drMeera.id}`).set('Authorization', t.auth(admin)).send({ active: false }).expect(409);
      expect(res.body.code).toBe('DOCTOR_HAS_PATIENTS');
      expect(t.identity.accounts.get(drMeera.uid)!.disabled).toBe(false);

      // Once Rajesh also has Dr Arjun, Dr Meera can go.
      await api().put(`/api/v1/patients/${rajesh.id}/doctors`).set('Authorization', t.auth(admin)).send({ doctorIds: [drMeera.id, drArjun.id] }).expect(200);
      await api().patch(`/api/v1/doctors/${drMeera.id}`).set('Authorization', t.auth(admin)).send({ active: false }).expect(200);
      expect(t.identity.accounts.get(drMeera.uid)!.disabled).toBe(true);
    });

    it('two doctors of one patient deactivated at once: one is refused, the patient keeps a doctor', async () => {
      const drA = await t.seed({ role: 'DOCTOR', name: 'Dr A' });
      const drB = await t.seed({ role: 'DOCTOR', name: 'Dr B' });
      const shared = await t.seed({ role: 'PATIENT', name: 'Shared', doctorIds: [drA.id, drB.id] });

      // Hold both requests after their up-front check, so both have seen the other doctor as active.
      let arrived = 0;
      let release!: () => void;
      const bothChecked = new Promise<void>((resolve) => (release = resolve));
      const setDisabled = t.identity.setDisabled.bind(t.identity);
      const spy = jest.spyOn(t.identity, 'setDisabled').mockImplementation(async (uid, disabled) => {
        if (disabled) {
          if (++arrived === 2) release();
          await Promise.race([bothChecked, sleep(2000)]);
        }
        return setDisabled(uid, disabled);
      });

      try {
        const results = await Promise.all(
          [drA, drB].map((d) =>
            api().patch(`/api/v1/doctors/${d.id}`).set('Authorization', t.auth(admin)).send({ active: false }),
          ),
        );
        expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      } finally {
        spy.mockRestore();
      }

      expect(await activeDoctorsOf(shared.id)).toHaveLength(1);
      // The refused doctor's Firebase account is put back.
      expect([drA, drB].filter((d) => t.identity.accounts.get(d.uid)!.disabled)).toHaveLength(1);
    });

    it('linking a doctor while they are deactivated: the patient never ends up with an inactive doctor', async () => {
      const drNew = await t.seed({ role: 'DOCTOR', name: 'Dr New' });

      // Hold the link change inside its transaction until the deactivation has run.
      let deactivated!: Promise<unknown>;
      const audit = t.app.get(AuditService);
      const record = audit.record.bind(audit);
      const spy = jest.spyOn(audit, 'record').mockImplementation(async (entry, session) => {
        if (entry.action === 'DOCTOR_LINKS_CHANGED') {
          deactivated = api().patch(`/api/v1/doctors/${drNew.id}`).set('Authorization', t.auth(admin)).send({ active: false }).then((r) => r);
          await Promise.race([deactivated, sleep(1000)]);
        }
        return record(entry, session);
      });

      try {
        const linked = await api()
          .put(`/api/v1/patients/${rajesh.id}/doctors`)
          .set('Authorization', t.auth(admin))
          .send({ doctorIds: [drNew.id] });
        const deactivation = (await deactivated) as { status: number };
        expect([linked.status, deactivation.status].sort()).not.toEqual([200, 200]);
      } finally {
        spy.mockRestore();
      }

      const patient = await t.connection.collection('users').findOne({ _id: new Types.ObjectId(rajesh.id) });
      expect(await activeDoctorsOf(rajesh.id)).toHaveLength(patient!.doctorIds.length);
    });

    it('an inactive co-doctor does not count as cover', async () => {
      const retired = await t.seed({ role: 'DOCTOR', name: 'Dr Retired', active: false });
      await t.connection
        .collection('users')
        .updateOne({ name: 'Rajesh Iyer' }, { $push: { doctorIds: new Types.ObjectId(retired.id) } as never });
      await api().patch(`/api/v1/doctors/${drMeera.id}`).set('Authorization', t.auth(admin)).send({ active: false }).expect(409);
    });
  });
});
