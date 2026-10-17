import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ClientSession, Connection } from 'mongoose';

/**
 * Runs work in one MongoDB transaction (v1.1, Save flow step 6: "In one
 * MongoDB transaction: update the daily log, recount the status, create or
 * update alerts, write audit entries, and write the events to an outbox
 * collection").
 *
 * withTransaction already retries transient and commit-unknown errors.
 * Duplicate-key errors are not transient, but two first-saves of the same day
 * racing produce exactly one, so those are retried a bounded number of times:
 * the loser of the race then finds the document and updates it.
 *
 * Requires a replica set - see docker-compose.yml.
 */
@Injectable()
export class TransactionRunner {
  private readonly logger = new Logger(TransactionRunner.name);

  constructor(@InjectConnection() private readonly connection: Connection) {}

  async run<T>(work: (session: ClientSession) => Promise<T>, retriesOnDuplicate = 2): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const session = await this.connection.startSession();
      try {
        let result!: T;
        await session.withTransaction(async () => {
          result = await work(session);
        });
        return result;
      } catch (error) {
        if (this.isDuplicateKey(error) && attempt < retriesOnDuplicate) {
          this.logger.debug(`Duplicate key on attempt ${attempt + 1}; retrying`);
          continue;
        }
        throw error;
      } finally {
        await session.endSession();
      }
    }
  }

  private isDuplicateKey(error: unknown): boolean {
    return (error as { code?: number })?.code === 11000;
  }
}
