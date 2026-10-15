import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  AUDIT_ACTIONS,
  INVITATIONS_PER_HOUR,
  INVITATION_STATUS,
  InvitationStatus,
  ROLES,
  Role,
} from '../common/constants';
import { NotFoundException, RateLimitedException, UserInactiveException } from '../common/api.exception';
import { AuditService } from '../audit/audit.service';
import { IDENTITY_PROVIDER, IdentityProvider } from '../identity/identity-provider';
import { UserDocument } from '../users/user.schema';
import { UsersService, toObjectId } from '../users/users.service';

const HOUR_MS = 60 * 60 * 1000;

/**
 * The set-password email (v1.0 Onboarding). Sent on registration, and again
 * through POST /users/:userId/invitations when the link expired or was lost.
 */
@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(
    @Inject(IDENTITY_PROVIDER) private readonly identity: IdentityProvider,
    private readonly users: UsersService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Sends the email and records it. A failure to send never undoes a
   * registration: it is reported as FAILED, and the email can be re-sent.
   */
  async send(user: UserDocument, actor: { id: string; role: Role } | null): Promise<InvitationStatus> {
    if (!user.email) return INVITATION_STATUS.FAILED;
    try {
      await this.identity.sendSetPasswordEmail(user.email);
    } catch (error) {
      this.logger.error(`Set-password email to user ${String(user._id)} failed: ${(error as Error).message}`);
      return INVITATION_STATUS.FAILED;
    }

    // The email is out, so a failed audit write must not turn this into an
    // error: a retried registration would then hit EMAIL_ALREADY_EXISTS.
    await this.audit
      .record({
        actor,
        action: AUDIT_ACTIONS.INVITATION_SENT,
        patientId: user.role === ROLES.PATIENT ? user._id : null,
        resourceId: String(user._id),
      })
      .catch((error: Error) =>
        this.logger.error(`Could not record the invitation to user ${String(user._id)}: ${error.message}`),
      );
    return INVITATION_STATUS.SENT;
  }

  /**
   * POST /users/:userId/invitations. An admin may resend for anyone; a doctor
   * only for their linked patients - anyone else is a 404 to them.
   */
  async resend(caller: { id: string; role: Role }, userId: string): Promise<InvitationStatus> {
    const objectId = toObjectId(userId);
    const user = objectId ? await this.users.model.findById(objectId).exec() : null;
    const visible =
      !!user &&
      (caller.role === ROLES.ADMIN ||
        (user.role === ROLES.PATIENT && user.doctorIds.some((id) => String(id) === caller.id)));
    if (!user || !visible) throw new NotFoundException('User not found');
    if (!user.active) throw new UserInactiveException();

    // 5 per target user per hour, counted from the audit log so the limit
    // survives restarts and holds across instances.
    const since = new Date(Date.now() - HOUR_MS);
    const sent = await this.audit.countSince(AUDIT_ACTIONS.INVITATION_SENT, String(user._id), since);
    if (sent >= INVITATIONS_PER_HOUR) {
      throw new RateLimitedException(
        60 * 60,
        `At most ${INVITATIONS_PER_HOUR} set-password emails per user per hour`,
      );
    }

    return this.send(user, caller);
  }
}
