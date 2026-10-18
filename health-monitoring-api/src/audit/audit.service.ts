import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { AuditAction } from '../common/constants';
import { currentRequestId, currentRoute } from '../common/context/request-context';
import { AuthUser } from '../users/users.service';
import { AuditLog } from './audit-log.schema';

export interface AuditEntry {
  actor: AuthUser;
  action: AuditAction;
  patientId?: string | Types.ObjectId | null;
  resourceId?: string | null;
  before?: unknown;
  after?: unknown;
}

@Injectable()
export class AuditService {
  constructor(@InjectModel(AuditLog.name) private readonly model: Model<AuditLog>) {}

  /**
   * Writes one audit record. Pass the session for changes, so the record lands
   * in the same transaction as the change it describes (v1.1: "Change records
   * are written in the same transaction as the change").
   *
   * This never swallows errors. Doctor reads rely on that: v1.1 says a view
   * that cannot be audited "fails with 500 rather than returning data
   * unaudited", which is what an unhandled rejection here produces.
   */
  async record(entry: AuditEntry, session?: ClientSession): Promise<void> {
    const doc: Partial<AuditLog> = {
      actorId: new Types.ObjectId(entry.actor.id),
      actorRole: entry.actor.role,
      patientId: entry.patientId ? new Types.ObjectId(String(entry.patientId)) : null,
      action: entry.action,
      route: currentRoute() ?? 'unknown',
      resourceId: entry.resourceId ?? null,
      before: entry.before ?? null,
      after: entry.after ?? null,
      requestId: currentRequestId() ?? null,
      at: new Date(),
    };

    await this.model.create([doc], { session: session ?? undefined, ordered: true });
  }
}
