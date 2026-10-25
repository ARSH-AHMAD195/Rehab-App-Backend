import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EVENT_PUBLISHER, EventPublisher } from './event-publisher';
import { OUTBOX_STATUS, OutboxEvent, OutboxEventDocument } from './outbox-event.schema';

/**
 * Delivery, same as Health Monitoring: at least once. Events are written to the
 * outbox in the change's transaction and published only after it commits.
 * Failed publishes retry with backoff (1 s, 5 s, 30 s, then every 5 min) for
 * 24 hours, then go to a dead-letter list for review.
 *
 * Consumers de-duplicate on eventId, which is what makes at-least-once safe.
 */
@Injectable()
export class OutboxPublisherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxPublisherService.name);

  /** Attempt n (1-based) waits BACKOFF_MS[n-1], then STEADY_BACKOFF_MS. */
  private static readonly BACKOFF_MS = [1_000, 5_000, 30_000];
  private static readonly STEADY_BACKOFF_MS = 5 * 60_000;
  private static readonly GIVE_UP_AFTER_MS = 24 * 60 * 60_000;
  private static readonly TICK_MS = 1_000;
  private static readonly BATCH = 50;
  /** How long a claimed event stays invisible to other instances. */
  private static readonly CLAIM_MS = 30_000;

  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @InjectModel(OutboxEvent.name) private readonly model: Model<OutboxEvent>,
    @Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisher,
  ) {}

  onModuleInit(): void {
    if (process.env.OUTBOX_PUBLISHER_DISABLED === 'true') {
      this.logger.warn('Outbox publisher disabled by OUTBOX_PUBLISHER_DISABLED');
      return;
    }
    this.timer = setInterval(() => void this.tick(), OutboxPublisherService.TICK_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** One pass over the due events. Safe to call directly from tests. */
  async tick(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let published = 0;
    try {
      for (let i = 0; i < OutboxPublisherService.BATCH; i++) {
        const event = await this.claimNext();
        if (!event) break;
        if (await this.deliver(event)) published++;
      }
    } catch (error) {
      this.logger.error(`Outbox tick failed: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
    return published;
  }

  /**
   * Takes the next due event and hides it from other instances for CLAIM_MS,
   * so two app processes don't publish the same event back to back. A crash
   * mid-publish just means the event becomes due again - consumers already
   * de-duplicate.
   */
  private async claimNext(): Promise<OutboxEventDocument | null> {
    const now = new Date();
    return this.model
      .findOneAndUpdate(
        { status: OUTBOX_STATUS.PENDING, nextAttemptAt: { $lte: now } },
        {
          $inc: { attempts: 1 },
          $set: { nextAttemptAt: new Date(now.getTime() + OutboxPublisherService.CLAIM_MS) },
        },
        { new: true, sort: { nextAttemptAt: 1 } },
      )
      .exec();
  }

  private async deliver(event: OutboxEventDocument): Promise<boolean> {
    try {
      await this.publisher.publish({
        eventId: String(event._id),
        type: event.type,
        schemaVersion: event.schemaVersion,
        occurredAt: event.occurredAt.toISOString(),
        patientId: String(event.patientId),
        requestId: event.requestId,
        data: event.data,
      });

      await this.model.updateOne(
        { _id: event._id },
        { $set: { status: OUTBOX_STATUS.PUBLISHED, publishedAt: new Date(), lastError: null } },
      );
      return true;
    } catch (error) {
      await this.reschedule(event, error as Error);
      return false;
    }
  }

  private async reschedule(event: OutboxEventDocument, error: Error): Promise<void> {
    const age = Date.now() - event.firstQueuedAt.getTime();

    if (age >= OutboxPublisherService.GIVE_UP_AFTER_MS) {
      this.logger.error(
        `Event ${String(event._id)} (${event.type}) dead-lettered after ${event.attempts} attempts: ${error.message}`,
      );
      await this.model.updateOne(
        { _id: event._id },
        { $set: { status: OUTBOX_STATUS.DEAD_LETTER, lastError: error.message } },
      );
      return;
    }

    const wait =
      OutboxPublisherService.BACKOFF_MS[event.attempts - 1] ??
      OutboxPublisherService.STEADY_BACKOFF_MS;

    await this.model.updateOne(
      { _id: event._id },
      {
        $set: {
          status: OUTBOX_STATUS.PENDING,
          nextAttemptAt: new Date(Date.now() + wait),
          lastError: error.message,
        },
      },
    );
  }
}
