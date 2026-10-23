/**
 * All three APIs against ONE database, the way they run for real: Auth owns
 * the `users` collection; Health Monitoring and Exercise read it. Walks a
 * patient's journey through all three and checks that a change made in Auth
 * is honoured by the other two at once.
 *
 * Each API is booted with its own NestJS copy (from its own node_modules), as
 * in production; mixing copies would break Nest's dependency injection.
 */
import request from 'supertest';
import { DateTime } from 'luxon';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

// --- Auth API, with its own Nest copy
import { Test as AuthTest } from '../auth-api/node_modules/@nestjs/testing';
import { ValidationPipe as AuthValidationPipe } from '../auth-api/node_modules/@nestjs/common';
import { getConnectionToken as authConnectionToken } from '../auth-api/node_modules/@nestjs/mongoose';
import { AppModule as AuthAppModule } from '../auth-api/src/app.module';
import { validationExceptionFactory as authValidation } from '../auth-api/src/common/validation-exception.factory';
import { IDENTITY_PROVIDER } from '../auth-api/src/identity/identity-provider';
import { FakeIdentityProvider } from '../auth-api/test/helpers/test-app';

// --- Health Monitoring API, with its own Nest copy
import { Test as HmTest } from '../health-monitoring-api/node_modules/@nestjs/testing';
import { ValidationPipe as HmValidationPipe } from '../health-monitoring-api/node_modules/@nestjs/common';
import { AppModule as HmAppModule } from '../health-monitoring-api/src/app.module';
import { validationExceptionFactory as hmValidation } from '../health-monitoring-api/src/common/validation-exception.factory';
import { TOKEN_VERIFIER as HM_TOKEN_VERIFIER } from '../health-monitoring-api/src/auth/token-verifier';
import { UnauthenticatedException as HmUnauthenticated } from '../health-monitoring-api/src/common/api.exception';

// --- Exercise API, with its own Nest copy
import { Test as ExTest } from '../exercise-api/node_modules/@nestjs/testing';
import { ValidationPipe as ExValidationPipe } from '../exercise-api/node_modules/@nestjs/common';
import { getConnectionToken as exConnectionToken } from '../exercise-api/node_modules/@nestjs/mongoose';
import { AppModule as ExAppModule } from '../exercise-api/src/app.module';
import { validationExceptionFactory as exValidation } from '../exercise-api/src/common/validation-exception.factory';
import { TOKEN_VERIFIER as EX_TOKEN_VERIFIER } from '../exercise-api/src/auth/token-verifier';
import { VIDEO_CHECKER as EX_VIDEO_CHECKER } from '../exercise-api/src/exercises/video-checker';
import { UnauthenticatedException as ExUnauthenticated } from '../exercise-api/src/common/api.exception';

const ZONE = 'Asia/Kolkata';
const todayIn = (zone: string) => DateTime.now().setZone(zone).toISODate()!;
const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7];

/**
 * In tests the bearer token is the Firebase uid. In production each API asks
 * Firebase to verify the real token and gets the same uid back.
 */
const verifierThrowing = (Unauthenticated: new () => Error) => ({
  async verify(idToken: string) {
    if (!idToken) throw new Unauthenticated();
    return { uid: idToken };
  },
});

type App = { getHttpServer(): unknown; get(token: unknown): any; close(): Promise<void> };

describe('Auth + Health Monitoring + Exercise APIs, one database', () => {
  let mongo: MongoMemoryReplSet;
  let authApp: App;
  let hmApp: App;
  let exApp: App;
  const identity = new FakeIdentityProvider();

  const auth = () => request(authApp.getHttpServer() as never);
  const hm = () => request(hmApp.getHttpServer() as never);
  const ex = () => request(exApp.getHttpServer() as never);
  const bearer = (uid: string) => `Bearer ${uid}`;

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
    process.env.MONGODB_URI = mongo.getUri('ffs_health_journey');
    process.env.SWAGGER_ENABLED = 'false';
    process.env.DEFAULT_TIME_ZONE = ZONE;
    process.env.OUTBOX_PUBLISHER_DISABLED = 'true';

    const authModule = await AuthTest.createTestingModule({ imports: [AuthAppModule] })
      .overrideProvider(IDENTITY_PROVIDER)
      .useValue(identity)
      .compile();
    const a = authModule.createNestApplication();
    a.setGlobalPrefix('api/v1');
    a.useGlobalPipes(
      new AuthValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true, exceptionFactory: authValidation }),
    );
    await a.init();
    authApp = a as never;

    const hmModule = await HmTest.createTestingModule({ imports: [HmAppModule] })
      .overrideProvider(HM_TOKEN_VERIFIER)
      .useValue(verifierThrowing(HmUnauthenticated))
      .compile();
    const h = hmModule.createNestApplication();
    h.setGlobalPrefix('api/v1');
    h.useGlobalPipes(
      new HmValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true, exceptionFactory: hmValidation }),
    );
    await h.init();
    hmApp = h as never;

    const exModule = await ExTest.createTestingModule({ imports: [ExAppModule] })
      .overrideProvider(EX_TOKEN_VERIFIER)
      .useValue(verifierThrowing(ExUnauthenticated))
      // Every video plays; the Exercise API's own tests cover what YouTube says.
      .overrideProvider(EX_VIDEO_CHECKER)
      .useValue({ check: async () => null })
      .compile();
    const e = exModule.createNestApplication();
    e.setGlobalPrefix('api/v1');
    e.useGlobalPipes(
      new ExValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true, exceptionFactory: exValidation }),
    );
    await e.init();
    exApp = e as never;

    // Create (never drop) every index the APIs declare, as Mongoose does in
    // production. Shared collections (auditLogs) must accept all of them.
    for (const connection of [authApp.get(authConnectionToken()), exApp.get(exConnectionToken())]) {
      for (const model of Object.values(connection.models) as { createIndexes(): Promise<void> }[]) {
        await model.createIndexes();
      }
    }
  });

  afterAll(async () => {
    await authApp?.close();
    await hmApp?.close();
    await exApp?.close();
    await mongo?.stop();
  });

  it('a patient registered in Auth works in Health Monitoring and Exercise, and Auth changes take effect in both', async () => {
    const db = authApp.get(authConnectionToken());
    const users = db.collection('users');
    const ObjectId = require('../auth-api/node_modules/mongoose').Types.ObjectId;
    const uidOf = async (id: string) => (await users.findOne({ _id: new ObjectId(id) }))!.firebaseUid as string;

    // The first admin, as the create-admin script makes them.
    await users.insertOne({
      firebaseUid: 'admin-1', role: 'ADMIN', name: 'Admin', email: 'admin@test.example', phone: null,
      doctorIds: [], specialization: null, active: true, emailVerified: true, createdBy: null,
      createdAt: new Date(), updatedAt: new Date(),
    });
    identity.accounts.set('admin-1', { email: 'admin@test.example', emailVerified: true, disabled: false });
    const admin = bearer('admin-1');

    // 1. AUTH: the admin registers two doctors and a patient linked to the first.
    const drA = (await auth().post('/api/v1/doctors').set('Authorization', admin).send({ name: 'Dr Meera Nair', email: 'meera@test.example' }).expect(201)).body;
    const drB = (await auth().post('/api/v1/doctors').set('Authorization', admin).send({ name: 'Dr Arjun Rao', email: 'arjun@test.example' }).expect(201)).body;
    const patient = (
      await auth()
        .post('/api/v1/patients')
        .set('Authorization', admin)
        .send({ name: 'Rajesh Iyer', email: 'rajesh@test.example', doctorIds: [drA.id], timeZone: ZONE })
        .expect(201)
    ).body;

    const [uidA, uidB, uidP] = await Promise.all([uidOf(drA.id), uidOf(drB.id), uidOf(patient.id)]);
    for (const uid of [uidA, uidB, uidP]) identity.verifyEmail(uid); // they click the emailed link

    // 2. HEALTH MONITORING: the same admin sets a pain limit; the patient saves today's vitals.
    await hm().put('/api/v1/admin/alert-thresholds/PAIN').set('Authorization', admin)
      .send({ field: null, low: null, high: 6, severity: 'MEDIUM' }).expect(200);

    const saved = await hm().put('/api/v1/me/vitals/today').set('Authorization', bearer(uidP))
      .send({ date: todayIn(ZONE), readings: { PAIN: { num: 8 }, PULSE: { num: 76 } } }).expect(200);
    expect(saved.body).toMatchObject({ date: todayIn(ZONE), timeZone: ZONE, filledCount: 2 });
    expect(saved.body.alerts).toEqual([expect.objectContaining({ type: 'PAIN', rule: 'ABOVE_HIGH', severity: 'MEDIUM' })]);

    // 3. HEALTH MONITORING: the linked doctor sees the patient (by the name Auth stored) and the alert.
    const queueA = await hm().get('/api/v1/doctor/alerts').set('Authorization', bearer(uidA)).expect(200);
    expect(queueA.body.data).toEqual([expect.objectContaining({ patient: { id: patient.id, name: 'Rajesh Iyer' } })]);
    await hm().get(`/api/v1/doctor/patients/${patient.id}/vitals/today`).set('Authorization', bearer(uidA)).expect(200);
    await hm().get(`/api/v1/doctor/patients/${patient.id}/vitals/today`).set('Authorization', bearer(uidB)).expect(404);

    // 4. EXERCISE: the same admin (role from Auth) builds the library.
    const categories = (await ex().get('/api/v1/exercise-categories').set('Authorization', admin).expect(200)).body.data;
    const strength = categories.find((c: { code: string }) => c.code === 'STRENGTH');
    const walking = categories.find((c: { code: string }) => c.code === 'WALKING');
    const knee = (await ex().post('/api/v1/exercises').set('Authorization', admin)
      .send({ name: 'Seated knee extension', categoryId: strength.id, instructions: ['Sit upright', 'Straighten one knee'], videoUrl: 'https://youtu.be/dQw4w9WgXcQ' })
      .expect(201)).body;
    const walk = (await ex().post('/api/v1/exercises').set('Authorization', admin)
      .send({ name: 'Brisk walk', categoryId: walking.id }).expect(201)).body;
    // A doctor or patient can't change the library.
    await ex().post('/api/v1/exercises').set('Authorization', bearer(uidA)).send({ name: 'X', categoryId: strength.id }).expect(403);

    // 5. EXERCISE: Dr Meera, linked in Auth, assigns a plan. Dr Arjun, not linked, can't see the patient.
    const plan = (await ex().put(`/api/v1/patients/${patient.id}/exercise-plan`).set('Authorization', bearer(uidA))
      .send({
        version: 0,
        items: [
          { exerciseId: knee.id, schedule: { daysOfWeek: EVERY_DAY, timesPerDay: 2 }, target: { sets: 2, reps: 10 } },
          { exerciseId: walk.id, schedule: { daysOfWeek: EVERY_DAY, timesPerDay: 1 }, target: { durationMin: 20 } },
        ],
      })
      .expect(200)).body;
    // The doctor's name comes from Auth's users record.
    expect(plan).toMatchObject({ patientId: patient.id, version: 1, assignedBy: { id: drA.id, name: 'Dr Meera Nair' } });
    await ex().get(`/api/v1/patients/${patient.id}/exercise-plan`).set('Authorization', bearer(uidB)).expect(404);
    const kneeItem = plan.items.find((i: { exercise: { id: string } }) => i.exercise.id === knee.id).itemId;
    const walkItem = plan.items.find((i: { exercise: { id: string } }) => i.exercise.id === walk.id).itemId;

    // 6. EXERCISE: the patient sees their checklist, in the time zone Auth stored, and ticks things off.
    const before = (await ex().get('/api/v1/patients/me/exercise-checklist').set('Authorization', bearer(uidP)).expect(200)).body;
    expect(before).toMatchObject({ date: todayIn(ZONE), planVersion: 1, doneCount: 0, plannedCount: 3 });
    // Only their plan's exercises are visible to them.
    expect((await ex().get('/api/v1/exercises').set('Authorization', bearer(uidP)).expect(200)).body.data).toHaveLength(2);

    await ex().post('/api/v1/exercise-completions').set('Authorization', bearer(uidP)).set('Idempotency-Key', 'tick-1')
      .send({ itemId: kneeItem, date: todayIn(ZONE) }).expect(201);
    // The app retries after a timeout: not counted twice.
    await ex().post('/api/v1/exercise-completions').set('Authorization', bearer(uidP)).set('Idempotency-Key', 'tick-1')
      .send({ itemId: kneeItem, date: todayIn(ZONE) }).expect(201);
    await ex().post('/api/v1/exercise-completions').set('Authorization', bearer(uidP))
      .send({ itemId: walkItem, date: todayIn(ZONE) }).expect(201);

    const after = (await ex().get('/api/v1/patients/me/exercise-checklist').set('Authorization', bearer(uidP)).expect(200)).body;
    expect(after).toMatchObject({ doneCount: 2, plannedCount: 3 });

    // 7. EXERCISE: Dr Meera sees compliance for the week.
    const compliance = (await ex().get(`/api/v1/patients/${patient.id}/exercise-compliance`).set('Authorization', bearer(uidA)).expect(200)).body;
    expect(compliance).toMatchObject({ to: todayIn(ZONE), planned: 3, done: 2, percentage: null });

    // 8. AUTH: the admin moves the patient to Dr Arjun. BOTH other APIs follow at once.
    await auth().put(`/api/v1/patients/${patient.id}/doctors`).set('Authorization', admin).send({ doctorIds: [drB.id] }).expect(200);
    // Health Monitoring
    await hm().get(`/api/v1/doctor/patients/${patient.id}/vitals/today`).set('Authorization', bearer(uidA)).expect(404);
    expect((await hm().get('/api/v1/doctor/alerts').set('Authorization', bearer(uidA)).expect(200)).body.data).toHaveLength(0);
    await hm().get(`/api/v1/doctor/patients/${patient.id}/vitals/today`).set('Authorization', bearer(uidB)).expect(200);
    expect((await hm().get('/api/v1/doctor/alerts').set('Authorization', bearer(uidB)).expect(200)).body.data).toHaveLength(1);
    // Exercise: the plan belongs to the patient, so Dr Arjun takes it over as it is.
    await ex().get(`/api/v1/patients/${patient.id}/exercise-plan`).set('Authorization', bearer(uidA)).expect(404);
    const takenOver = (await ex().get(`/api/v1/patients/${patient.id}/exercise-plan`).set('Authorization', bearer(uidB)).expect(200)).body;
    expect(takenOver).toMatchObject({ version: 1, assignedBy: { name: 'Dr Meera Nair' } });
    await ex().put(`/api/v1/patients/${patient.id}/exercise-plan`).set('Authorization', bearer(uidB))
      .send({ version: 1, items: [{ exerciseId: walk.id, schedule: { daysOfWeek: EVERY_DAY, timesPerDay: 1 } }] })
      .expect(200);

    // 9. AUTH: the patient changes their time zone. "Today" follows it in both APIs.
    // A zone whose date differs from India's right now (UTC+14 and UTC-11 can't
    // both match it), or ignoring the new zone would go unnoticed.
    const newZone = ['Pacific/Kiritimati', 'Pacific/Pago_Pago'].find((zone) => todayIn(zone) !== todayIn(ZONE))!;
    expect(newZone).toBeDefined();
    await auth().patch('/api/v1/users/me/profile').set('Authorization', bearer(uidP)).send({ timeZone: newZone }).expect(200);
    expect((await hm().get('/api/v1/me/vitals/today').set('Authorization', bearer(uidP)).expect(200)).body.date).toBe(todayIn(newZone));
    expect((await ex().get('/api/v1/patients/me/exercise-checklist').set('Authorization', bearer(uidP)).expect(200)).body.date).toBe(todayIn(newZone));

    // 10. AUTH: Dr Meera, now with no patients, is deactivated. Both APIs refuse her.
    await auth().patch(`/api/v1/doctors/${drA.id}`).set('Authorization', admin).send({ active: false }).expect(200);
    await hm().get('/api/v1/doctor/alerts').set('Authorization', bearer(uidA)).expect(401);
    await ex().get('/api/v1/exercises').set('Authorization', bearer(uidA)).expect(401);

    // 11. AUTH: the patient is deactivated. Both APIs refuse them and hide them from their doctor.
    await auth().patch(`/api/v1/patients/${patient.id}`).set('Authorization', admin).send({ active: false }).expect(200);
    await hm().get('/api/v1/me/vitals/today').set('Authorization', bearer(uidP)).expect(401);
    await hm().get(`/api/v1/doctor/patients/${patient.id}/vitals/today`).set('Authorization', bearer(uidB)).expect(404);
    await ex().get('/api/v1/patients/me/exercise-checklist').set('Authorization', bearer(uidP)).expect(401);
    await ex().get(`/api/v1/patients/${patient.id}/exercise-plan`).set('Authorization', bearer(uidB)).expect(404);

    // 12. SHARED DATA: one audit log for all three, and each API's events kept apart.
    const audit = db.collection('auditLogs');
    expect(await audit.countDocuments({ action: 'THRESHOLD_CHANGED' })).toBe(1); // Health Monitoring
    expect(await audit.countDocuments({ action: 'EXERCISE_PLAN_CHANGED' })).toBe(2); // Exercise
    expect(await audit.countDocuments({ action: 'EXERCISE_COMPLETION_RECORDED' })).toBe(2);
    const vitalsEvents = await db.collection('outboxEvents').distinct('type');
    const exerciseEvents = await db.collection('exerciseOutboxEvents').distinct('type');
    expect(vitalsEvents.every((t: string) => t.startsWith('vitals.'))).toBe(true);
    expect(exerciseEvents.sort()).toEqual(['exercise.completed', 'exercise.plan.assigned']);
    // Nobody but Auth wrote to users: still exactly the 4 people the admin script and Auth created.
    expect(await users.countDocuments()).toBe(4);
  });
});
