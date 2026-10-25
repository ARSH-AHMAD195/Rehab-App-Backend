import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { EVENT_SCHEMA_VERSION, EventType } from '../common/constants';
import { currentRequestId } from '../common/context/request-context';
import { OutboxEvent } from './outbox-event.schema';

export interface NewEvent {
  type: EventType;
  patientId: string | Types.ObjectId;
  data: Record<string, unknown>;
  occurredAt?: Date;
}

@Injectable()
export class OutboxService {
  constructor(@InjectModel(OutboxEvent.name) private readonly model: Model<OutboxEvent>) {}

  /**
   * Queues events inside the caller's transaction. Nothing is sent here - the
   * publisher picks them up after the commit, so a rolled-back change never
   * reaches another module.
   */
  async enqueue(events: NewEvent[], session: ClientSession): Promise<void> {
    if (!events.length) return;

    const now = new Date();
    const requestId = currentRequestId() ?? null;

    await this.model.create(
      events.map((event) => ({
        type: event.type,
        schemaVersion: EVENT_SCHEMA_VERSION,
        occurredAt: event.occurredAt ?? now,
        patientId: new Types.ObjectId(String(event.patientId)),
        requestId,
        data: event.data,
        firstQueuedAt: now,
        nextAttemptAt: now,
      })),
      // Mongoose requires ordered writes when several documents share a session.
      { session, ordered: true },
    );
  }
}
