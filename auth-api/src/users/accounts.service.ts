import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientSession } from 'mongoose';
import { AUDIT_ACTIONS, DETAIL_CODES, ROLES, Role } from '../common/constants';
import { ValidationFailedException } from '../common/api.exception';
import { TransactionRunner } from '../common/mongo/transaction.runner';
import { isValidTimeZone } from '../common/time';
import { AuditService } from '../audit/audit.service';
import { IDENTITY_PROVIDER, IdentityProvider } from '../identity/identity-provider';
import { UserDocument } from './user.schema';
import { UsersService } from './users.service';

export interface ProfileChanges {
  name?: string;
  phone?: string | null;
  timeZone?: string;
  specialization?: string | null;
}

const PROFILE_FIELDS = ['name', 'phone', 'timeZone', 'specialization'] as const;

/**
 * Basic-profile edits and (de)activation, for PATCH /users/me/profile,
 * PATCH /patients/:patientId and PATCH /doctors/:doctorId.
 *
 * Unchanged fields are dropped first, so re-sending the same body changes
 * nothing and writes no audit record.
 */
@Injectable()
export class AccountsService {
  private readonly logger = new Logger(AccountsService.name);

  constructor(
    @Inject(IDENTITY_PROVIDER) private readonly identity: IdentityProvider,
    private readonly users: UsersService,
    private readonly audit: AuditService,
    private readonly tx: TransactionRunner,
  ) {}

  async update(
    actor: { id: string; role: Role },
    user: UserDocument,
    changes: ProfileChanges,
    active?: boolean,
    /** Runs first inside the write transaction; throw to abort it. */
    guard?: (session: ClientSession) => Promise<void>,
  ): Promise<UserDocument> {
    if (changes.timeZone !== undefined && !isValidTimeZone(changes.timeZone)) {
      throw new ValidationFailedException([
        { field: 'timeZone', code: DETAIL_CODES.WRONG_SHAPE, issue: 'must be an IANA time zone, e.g. Asia/Kolkata' },
      ]);
    }

    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const field of PROFILE_FIELDS) {
      const next = changes[field];
      const current = user[field] ?? null;
      if (next === undefined || next === current) continue;
      before[field] = current;
      after[field] = next;
    }

    const activeChanged = active !== undefined && active !== user.active;
    if (!Object.keys(after).length && !activeChanged) return user;

    // Firebase first: a deactivated user must be locked out even if the
    // profile write then fails - and it is put back if it does.
    if (activeChanged) await this.identity.setDisabled(user.firebaseUid, !active);

    const patientId = user.role === ROLES.PATIENT ? user._id : null;
    try {
      await this.tx.run(async (session) => {
        await guard?.(session);
        await this.users.model
          .updateOne({ _id: user._id }, { $set: { ...after, ...(activeChanged ? { active } : {}) } }, { session })
          .exec();

        if (Object.keys(after).length) {
          await this.audit.record(
            { actor, action: AUDIT_ACTIONS.PROFILE_UPDATED, patientId, resourceId: String(user._id), before, after },
            session,
          );
        }
        if (activeChanged) {
          await this.audit.record(
            {
              actor,
              action: active ? AUDIT_ACTIONS.USER_REACTIVATED : AUDIT_ACTIONS.USER_DEACTIVATED,
              patientId,
              resourceId: String(user._id),
              before: { active: user.active },
              after: { active },
            },
            session,
          );
        }
      });
    } catch (error) {
      if (activeChanged) {
        await this.identity.setDisabled(user.firebaseUid, !user.active).catch((revert: Error) =>
          this.logger.error(`Could not restore Firebase state of ${user.firebaseUid}: ${revert.message}`),
        );
      }
      throw error;
    }

    return (await this.users.model.findById(user._id).exec())!;
  }
}
