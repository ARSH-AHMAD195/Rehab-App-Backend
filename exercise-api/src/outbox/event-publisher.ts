import { Injectable, Logger } from '@nestjs/common';
import { EventType } from '../common/constants';

/** The v1.1 event envelope, as consumers receive it. */
export interface EventEnvelope {
  eventId: string;
  type: EventType;
  schemaVersion: number;
  occurredAt: string;
  patientId: string;
  requestId: string | null;
  data: Record<string, unknown>;
}

export interface EventPublisher {
  publish(event: EventEnvelope): Promise<void>;
}

export const EVENT_PUBLISHER = Symbol('EVENT_PUBLISHER');

/**
 * Default transport until the Timeline and Notifications modules name one.
 *
 * The envelope, the retry schedule and de-duplication by eventId are fixed
 * (same as Health Monitoring), but not the broker, so that choice is isolated here: swap this provider for
 * the real one (SNS/SQS, Kafka, Redis Streams, an HTTP fan-out) and nothing
 * else in the module changes.
 */
@Injectable()
export class LoggingEventPublisher implements EventPublisher {
  private readonly logger = new Logger(LoggingEventPublisher.name);

  async publish(event: EventEnvelope): Promise<void> {
    this.logger.log(
      `event ${event.type} eventId=${event.eventId} patient=${event.patientId} ` +
        `requestId=${event.requestId ?? '-'} data=${JSON.stringify(event.data)}`,
    );
  }
}
