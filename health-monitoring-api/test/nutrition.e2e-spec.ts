import request from 'supertest';
import { DateTime } from 'luxon';
import { createTestApp, TestContext } from './helpers/test-app';

const ZONE = 'Asia/Kolkata';

describe('Nutrition (diet chart and meal logging)', () => {
  let ctx: TestContext;
  type User = Awaited<ReturnType<TestContext['createUser']>>;
  let doctor: User;
  let otherDoctor: User;
  let patient: User;
  const http = () => request(ctx.app.getHttpServer());
  const as = (user: User) => ({
    get: (url: string) => http().get(`/api/v1${url}`).set('Authorization', `Bearer ${ctx.token(user)}`),
    put: (url: string, body: unknown) => http().put(`/api/v1${url}`).set('Authorization', `Bearer ${ctx.token(user)}`).send(body as object),
    patch: (url: string, body: unknown) => http().patch(`/api/v1${url}`).set('Authorization', `Bearer ${ctx.token(user)}`).send(body as object),
  });
  const today = () => DateTime.now().setZone(ZONE).toISODate()!;
  const eat = (slot: string, optionCodes: string[], date = today()) => as(patient).put(`/me/meals/today/${slot}`, { date, optionCodes });

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => ctx.close());
  beforeEach(async () => {
    await ctx.reset();
    doctor = await ctx.createUser({ uid: 'doc-1', role: 'DOCTOR', name: 'Dr Meera Nair' });
    otherDoctor = await ctx.createUser({ uid: 'doc-2', role: 'DOCTOR', name: 'Dr Other' });
    patient = await ctx.createUser({ uid: 'pat-1', role: 'PATIENT', name: 'Rajesh Iyer', timeZone: ZONE, doctorIds: [doctor.id] });
  });

  it("a new patient follows the hospital chart: 7 slots, 2206 kcal and 82.4 g protein", async () => {
    const res = await as(patient).get('/me/diet-plan').expect(200);
    expect(res.body).toMatchObject({
      patientId: patient.id,
      dietType: 'HIGH_CALORIE_HIGH_PROTEIN',
      dietLabel: { en: 'High-calorie, High-protein Diet for Cancer Patients', hi: null },
      targets: { kcal: 2206, proteinG: 82.4 },
      version: 0,
      updatedBy: null,
    });
    expect(res.body.slots.map((s: { code: string }) => s.code)).toEqual([
      'BEFORE_BREAKFAST', 'BREAKFAST', 'MID_MORNING', 'LUNCH', 'EVENING_SNACK', 'DINNER', 'AFTER_DINNER',
    ]);
    expect(res.body.slots[0]).toMatchObject({
      label: { en: 'Before breakfast', hi: null },
      window: '06:00-07:00',
      kcal: 183,
      proteinG: 4.2,
      options: expect.arrayContaining([expect.objectContaining({ code: 'BANANA_MAKHANA_CHANA', quantity: '1 / 1 katori', kind: 'ADDON' })]),
    });
  });

  it('ticking meals adds up calories and protein for the day, with a progress percent', async () => {
    const empty = await as(patient).get('/me/meals/today').expect(200);
    expect(empty.body).toMatchObject({ date: today(), totals: { kcal: 0, proteinG: 0, slotsEaten: 0 }, percent: { kcal: 0, protein: 0 } });

    await eat('BREAKFAST', ['POHA_DALIYA_UPMA', 'MILK']).expect(200);
    const res = await eat('LUNCH', ['ROTI_RICE']).expect(200);
    expect(res.body).toMatchObject({
      totals: { kcal: 1171, proteinG: 47, slotsEaten: 2 },
      targets: { kcal: 2206, proteinG: 82.4 },
      percent: { kcal: 53, protein: 57 },
    });
    const breakfast = res.body.slots.find((s: { code: string }) => s.code === 'BREAKFAST');
    expect(breakfast.eaten).toBe(true);
    expect(breakfast.loggedAt).toMatch(/\+05:30$/);
    expect(breakfast.options.filter((o: { ticked: boolean }) => o.ticked).map((o: { code: string }) => o.code)).toEqual(['POHA_DALIYA_UPMA', 'MILK']);
  });

  it('the whole chart eaten gives the chart totals', async () => {
    const choices: Record<string, string> = {
      BEFORE_BREAKFAST: 'TEA', BREAKFAST: 'IDLI_SAMBAR', MID_MORNING: 'FRUIT', LUNCH: 'ROTI_RICE',
      EVENING_SNACK: 'SOUP', DINNER: 'ROTI_RICE', AFTER_DINNER: 'MILK',
    };
    let last: request.Response | undefined;
    for (const [slot, option] of Object.entries(choices)) last = await eat(slot, [option]).expect(200);
    expect(last!.body).toMatchObject({ totals: { kcal: 2207, proteinG: 82.4, slotsEaten: 7 }, percent: { kcal: 100, protein: 100 } });
  });

  it('changing or clearing a slot, re-sending the same, and the audit trail', async () => {
    await eat('LUNCH', ['ROTI_RICE']).expect(200);
    await eat('LUNCH', ['ROTI_RICE']).expect(200); // same again: nothing changes
    await eat('LUNCH', ['KHICHDI_DALIYA', 'DAL_CURD']).expect(200);
    const cleared = await eat('LUNCH', []).expect(200);
    expect(cleared.body.totals).toEqual({ kcal: 0, proteinG: 0, slotsEaten: 0 });

    const audits = await ctx.connection.collection('auditLogs').find({ action: 'MEAL_LOG_CHANGED' }).sort({ at: 1 }).toArray();
    expect(audits.map((a) => a.after.optionCodes)).toEqual([['ROTI_RICE'], ['KHICHDI_DALIYA', 'DAL_CURD'], []]);
    expect(await ctx.connection.collection('mealLogs').countDocuments({})).toBe(1);
  });

  it('only today can be changed', async () => {
    const yesterday = DateTime.now().setZone(ZONE).minus({ days: 1 }).toISODate()!;
    const res = await eat('LUNCH', ['ROTI_RICE'], yesterday).expect(409);
    expect(res.body.code).toBe('DAY_CHANGED');
  });

  it.each([
    ['an unknown slot', 'SUPPER', ['ROTI_RICE']],
    ['an option from another slot', 'LUNCH', ['IDLI_SAMBAR']],
    ['the same option twice', 'LUNCH', ['ROTI_RICE', 'ROTI_RICE']],
  ])('400 for %s', async (_label, slot, optionCodes) => {
    const res = await eat(slot, optionCodes).expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('history: one row per day, newest first, with each day’s own targets', async () => {
    const yesterday = DateTime.now().setZone(ZONE).minus({ days: 1 }).toISODate()!;
    await ctx.connection.collection('mealLogs').insertOne({
      patientId: new (require('mongoose').Types.ObjectId)(patient.id),
      date: yesterday,
      timeZone: ZONE,
      slots: {},
      totals: { kcal: 1500, proteinG: 50, slotsEaten: 4 },
      targets: { kcal: 2000, proteinG: 80 },
      planVersion: 1,
    });
    await eat('LUNCH', ['ROTI_RICE']).expect(200);

    const res = await as(patient).get('/me/meals').expect(200);
    expect(res.body.data).toHaveLength(7);
    expect(res.body.data[0]).toMatchObject({ date: today(), logged: true, totals: { kcal: 711 }, percent: { kcal: 32, protein: 30 } });
    expect(res.body.data[1]).toMatchObject({ date: yesterday, logged: true, targets: { kcal: 2000 }, percent: { kcal: 75, protein: 63 } });
    expect(res.body.data[2]).toMatchObject({ logged: false, totals: null });

    await as(patient).get('/me/meals?from=2026-01-01&to=2026-12-31').expect(400);
    await as(patient).get('/me/meals?from=2026-11-10&to=2026-11-01').expect(400);
  });

  describe('the doctor', () => {
    const plan = (body: unknown, user = doctor) => as(user).patch(`/doctor/patients/${patient.id}/diet-plan`, body);

    it("changes the patient's targets: the patient sees them, and progress follows", async () => {
      const res = await plan({ version: 0, targets: { kcal: 1800, proteinG: 70 } }).expect(200);
      expect(res.body).toMatchObject({ version: 1, targets: { kcal: 1800, proteinG: 70 }, updatedBy: { id: doctor.id, role: 'DOCTOR' } });
      // Everything else is still the hospital chart.
      expect(res.body.slots).toHaveLength(7);

      const day = await eat('LUNCH', ['ROTI_RICE']).expect(200);
      expect(day.body).toMatchObject({ targets: { kcal: 1800, proteinG: 70 }, percent: { kcal: 40, protein: 35 }, planVersion: 1 });

      const audit = await ctx.connection.collection('auditLogs').findOne({ action: 'DIET_PLAN_CHANGED' });
      expect(audit?.after.targets).toEqual({ kcal: 1800, proteinG: 70 });
    });

    it('changes the diet type and food options', async () => {
      const slots = (await as(patient).get('/me/diet-plan')).body.slots;
      slots[3].options = slots[3].options.filter((o: { code: string }) => o.code !== 'DAL_CURD');
      slots[3].options.push({ code: 'CURD_RICE', label: { en: 'Curd rice' }, quantity: '1 plate', kind: 'OPTION' });

      const res = await plan({ version: 0, dietType: 'SOFT_DIET', dietLabel: { en: 'Soft diet' }, slots }).expect(200);
      expect(res.body).toMatchObject({ dietType: 'SOFT_DIET', dietLabel: { en: 'Soft diet', hi: null } });
      const lunch = res.body.slots[3];
      expect(lunch.options.map((o: { code: string }) => o.code)).toEqual(['ROTI_RICE', 'KHICHDI_DALIYA', 'VEGETABLES', 'CURD_RICE']);
      expect(lunch.options[3].label).toEqual({ en: 'Curd rice', hi: null });

      await eat('LUNCH', ['CURD_RICE']).expect(200);
      await eat('LUNCH', ['DAL_CURD']).expect(400);
    });

    it('a stale version is refused; re-sending the same change does nothing', async () => {
      await plan({ version: 0, targets: { kcal: 1800, proteinG: 70 } }).expect(200);
      expect((await plan({ version: 0, targets: { kcal: 1900, proteinG: 70 } }).expect(409)).body.code).toBe('CONCURRENT_UPDATE');
      expect((await plan({ version: 1, targets: { kcal: 1800, proteinG: 70 } }).expect(200)).body.version).toBe(1);
    });

    it('past days keep the values they were logged with', async () => {
      await eat('LUNCH', ['ROTI_RICE']).expect(200);
      const slots = (await as(patient).get('/me/diet-plan')).body.slots;
      slots[3].kcal = 900;
      await plan({ version: 0, slots }).expect(200);
      const log = await ctx.connection.collection('mealLogs').findOne({});
      expect(log?.slots.LUNCH.kcal).toBe(711);
    });

    it.each([
      ['a tiny calorie target', { version: 0, targets: { kcal: 100, proteinG: 70 } }],
      ['a slot with only add-ons', { version: 0, slots: [{ code: 'X', label: { en: 'X' }, window: '08:00-09:00', kcal: 100, proteinG: 5, options: [{ code: 'A', label: { en: 'A' }, quantity: '1', kind: 'ADDON' }] }] }],
      ['a bad slot code', { version: 0, slots: [{ code: 'lunch', label: { en: 'X' }, window: '08:00-09:00', kcal: 100, proteinG: 5, options: [{ code: 'A', label: { en: 'A' }, quantity: '1', kind: 'OPTION' }] }] }],
      ['no version', { targets: { kcal: 1800, proteinG: 70 } }],
    ])('400 for %s', async (_label, body) => {
      expect((await plan(body).expect(400)).body.code).toBe('VALIDATION_FAILED');
    });

    it("sees the patient's day and history, audited", async () => {
      await eat('LUNCH', ['ROTI_RICE']).expect(200);
      const day = await as(doctor).get(`/doctor/patients/${patient.id}/meals/today`).expect(200);
      expect(day.body.totals.kcal).toBe(711);
      await as(doctor).get(`/doctor/patients/${patient.id}/meals`).expect(200);
      await as(doctor).get(`/doctor/patients/${patient.id}/diet-plan`).expect(200);
      expect(await ctx.connection.collection('auditLogs').countDocuments({ action: 'PATIENT_NUTRITION_VIEWED' })).toBe(3);
    });

    it('an unlinked doctor gets 404; a patient cannot use doctor routes or change the plan', async () => {
      await as(otherDoctor).get(`/doctor/patients/${patient.id}/meals/today`).expect(404);
      await plan({ version: 0, targets: { kcal: 1800, proteinG: 70 } }, otherDoctor).expect(404);
      await as(patient).get(`/doctor/patients/${patient.id}/diet-plan`).expect(403);
      await as(doctor).get('/me/meals/today').expect(403);
    });
  });
});
