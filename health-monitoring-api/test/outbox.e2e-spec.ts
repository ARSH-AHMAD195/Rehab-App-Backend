import request from 'supertest';
import { DateTime } from 'luxon';
import { EVENT_TYPES } from '../src/common/constants';
import { EVENT_PUBLISHER, EventEnvelope, EventPublisher } from '../src/outbox/event-publisher';
import { OutboxPublisherService } from '../src/outbox/outbox-publisher.service';
import { OUTBOX_STATUS } from '../src/outbox/outbox-event.schema';
import { TestContext, TestUser, createTestApp } from './helpers/test-app';

const ZONE = 'Asia/Kolkata';
const today = () => DateTime.now().setZone(ZONE).toISODate()!;

/** Records what it was handed, and fails on demand. */
class FlakyPublisher implements EventPublisher {
  readonly published: EventEnvelope[] = [];
  failures = 0;

  async publish(event: EventEnvelope): Promise<void> {
    if (this.failures > 0) {
      this.failures--;
      throw new Error('broker unavailable');
    }
    this.published.push(event);
  }
}

describe('Outbox delivery (v1.1 Events)', () => {
  let ctx: TestContext;
  let publisher: FlakyPublisher;
  let outbox: OutboxPublisherService;
  let patient: TestUser;

  beforeAll(async () => {
    publisher = new FlakyPublisher();
    ctx = await createTestApp([{ token: EVENT_PUBLISHER, value: publisher }]);
    outbox = ctx.app.get(OutboxPublisherService);
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await ctx.reset();
    publisher.published.length = 0;
    publisher.failures = 0;
    patient = await ctx.createUser({
      uid: 'pat-1',
      role: 'PATIENT',
      name: 'Rajesh Iyer',
      timeZone: ZONE,
    });
  });

  const save = (readings: Record<string, unknown>) =>
    request(ctx.app.getHttpServer())
      .put('/api/v1/me/vitals/today')
      .set('Authorization', `Bearer ${ctx.token(patient)}`)
      .set('X-Request-Id', 'req-outbox')
      .send({ date: today(), readings })
      .expect(200);

  it('publishes a queued event in the v1.1 envelope', async () => {
    await save({ PULSE: { num: 76 } });

    // Nothing leaves before the publisher runs: the save only queues it.
    expect(publisher.published).toHaveLength(0);
    await expect(outbox.tick()).resolves.toBe(1);

    expect(publisher.published).toHaveLength(1);
    const event = publisher.published[0];
    expect(event).toMatchObject({
      type: EVENT_TYPES.LOG_UPDATED,
      schemaVersion: 1,
      patientId: patient.id,
      requestId: 'req-outbox',
    });
    expect(event.eventId).toMatch(/^[0-9a-f]{24}$/);
    expect(Date.parse(event.occurredAt)).not.toBeNaN();

    const stored = await ctx.connection.collection('outboxEvents').findOne({});
    expect(stored).toMatchObject({ status: OUTBOX_STATUS.PUBLISHED, attempts: 1 });
    expect(stored!.publishedAt).toBeTruthy();
  });

  it('leaves a failed event pending and retries it with backoff', async () => {
    publisher.failures = 1;
    await save({ PULSE: { num: 76 } });

    await expect(outbox.tick()).resolves.toBe(0);

    let stored = await ctx.connection.collection('outboxEvents').findOne({});
    expect(stored).toMatchObject({
      status: OUTBOX_STATUS.PENDING,
      attempts: 1,
      lastError: 'broker unavailable',
    });
    // First retry waits a second, so it is not due yet.
    expect(stored!.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    expect(stored!.nextAttemptAt.getTime()).toBeLessThanOrEqual(Date.now() + 1_000);
    await expect(outbox.tick()).resolves.toBe(0);

    // Once due, the retry succeeds and the event is delivered exactly once.
    await ctx.connection
      .collection('outboxEvents')
      .updateOne({ _id: stored!._id }, { $set: { nextAttemptAt: new Date(Date.now() - 1) } });

    await expect(outbox.tick()).resolves.toBe(1);
    expect(publisher.published).toHaveLength(1);
    stored = await ctx.connection.collection('outboxEvents').findOne({});
    expect(stored).toMatchObject({ status: OUTBOX_STATUS.PUBLISHED, attempts: 2 });
  });

  it('dead-letters an event that has been failing for 24 hours', async () => {
    publisher.failures = 1;
    await save({ PULSE: { num: 76 } });

    const stored = await ctx.connection.collection('outboxEvents').findOne({});
    await ctx.connection.collection('outboxEvents').updateOne(
      { _id: stored!._id },
      {
        $set: {
          firstQueuedAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
          nextAttemptAt: new Date(Date.now() - 1),
        },
      },
    );

    await expect(outbox.tick()).resolves.toBe(0);

    const after = await ctx.connection.collection('outboxEvents').findOne({});
    expect(after).toMatchObject({
      status: OUTBOX_STATUS.DEAD_LETTER,
      lastError: 'broker unavailable',
    });
    // A dead-lettered event is never picked up again.
    await expect(outbox.tick()).resolves.toBe(0);
  });

  it('publishes nothing when there is nothing due', async () => {
    await expect(outbox.tick()).resolves.toBe(0);
    expect(publisher.published).toHaveLength(0);
  });
});
