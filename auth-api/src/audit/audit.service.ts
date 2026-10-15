import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { AuditAction, Role } from '../common/constants';
import { currentRequestId, currentRoute } from '../common/context/request-context';
import { AuditLog } from './audit-log.schema';

export interface AuditEntry {
  /** Null when a command-line script acts, e.g. creating the first admin. */
  actor: { id: string; role: Role } | null;
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
   * in the same transaction as the change it describes.
   *
   * This never swallows errors: a doctor's medical-profile read that can't be
   * audited fails with 500 rather than returning data unaudited (v1.0).
   */
  async record(entry: AuditEntry, session?: ClientSession): Promise<void> {
    const doc: Partial<AuditLog> = {
      actorId: entry.actor ? new Types.ObjectId(entry.actor.id) : null,
      actorRole: entry.actor?.role ?? 'SYSTEM',
      patientId: entry.patientId ? new Types.ObjectId(String(entry.patientId)) : null,
      action: entry.action,
      route: currentRoute() ?? 'script',
      resourceId: entry.resourceId ?? null,
      before: entry.before ?? null,
      after: entry.after ?? null,
      requestId: currentRequestId() ?? null,
      at: new Date(),
    };
    await this.model.create([doc], { session: session ?? undefined, ordered: true });
  }

  /** How many times an action was recorded for one resource since a time. */
  countSince(action: AuditAction, resourceId: string, since: Date): Promise<number> {
    return this.model.countDocuments({ action, resourceId, at: { $gte: since } }).exec();
  }
}
