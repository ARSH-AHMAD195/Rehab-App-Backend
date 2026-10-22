import { Inject, Injectable, Logger } from '@nestjs/common';
import { Types } from 'mongoose';
import { AUDIT_ACTIONS, InvitationStatus, ROLES, Role } from '../common/constants';
import { EmailAlreadyExistsException } from '../common/api.exception';
import { TransactionRunner } from '../common/mongo/transaction.runner';
import { AuditService } from '../audit/audit.service';
import { IDENTITY_PROVIDER, IdentityProvider } from '../identity/identity-provider';
import { UserDocument } from '../users/user.schema';
import { UsersService } from '../users/users.service';
import { InvitationsService } from './invitations.service';

export interface NewUser {
  role: Role;
  name: string;
  email: string;
  phone?: string | null;
  timeZone?: string;
  doctorIds?: Types.ObjectId[];
  specialization?: string | null;
}

/**
 * v1.0 Onboarding, steps 1-3: create the Firebase account, then the profile,
 * then send the set-password email.
 *
 * The two writes can't share a transaction, so the Firebase account is
 * removed again if the profile can't be saved: nothing is left half-created.
 */
@Injectable()
export class RegistrationService {
  private readonly logger = new Logger(RegistrationService.name);

  constructor(
    @Inject(IDENTITY_PROVIDER) private readonly identity: IdentityProvider,
    private readonly users: UsersService,
    private readonly audit: AuditService,
    private readonly invitations: InvitationsService,
    private readonly tx: TransactionRunner,
  ) {}

  async register(
    input: NewUser,
    actor: { id: string; role: Role } | null,
  ): Promise<{ user: UserDocument; invitation: InvitationStatus }> {
    const email = input.email.trim().toLowerCase();
    if (await this.users.emailTaken(email)) throw new EmailAlreadyExistsException();

    const { uid } = await this.identity.createAccount({ email, name: input.name });

    let user: UserDocument;
    try {
      user = await this.tx.run(async (session) => {
        if (input.doctorIds?.length) await this.users.lockActiveDoctors(input.doctorIds, session);
        const [created] = await this.users.model.create(
          [
            {
              firebaseUid: uid,
              role: input.role,
              name: input.name,
              email,
              phone: input.phone ?? null,
              ...(input.role === ROLES.PATIENT
                ? { timeZone: input.timeZone, doctorIds: input.doctorIds ?? [] }
                : {}),
              ...(input.role === ROLES.DOCTOR ? { specialization: input.specialization ?? null } : {}),
              active: true,
              emailVerified: false,
              createdBy: actor ? new Types.ObjectId(actor.id) : null,
            },
          ],
          { session },
        );

        await this.audit.record(
          {
            actor,
            action: AUDIT_ACTIONS.USER_REGISTERED,
            patientId: input.role === ROLES.PATIENT ? created._id : null,
            resourceId: String(created._id),
            after: { role: input.role, name: input.name, email },
          },
          session,
        );
        return created;
      }, 0);
    } catch (error) {
      await this.identity.deleteAccount(uid).catch((cleanup: Error) =>
        this.logger.error(`Could not remove Firebase account ${uid} after a failed registration: ${cleanup.message}`),
      );
      // Two registrations of one email racing: the unique index catches the loser.
      const clash = error as { code?: number; keyPattern?: Record<string, unknown> };
      if (clash.code === 11000 && clash.keyPattern?.email) throw new EmailAlreadyExistsException();
      throw error;
    }

    const invitation = await this.invitations.send(user, actor);
    return { user, invitation };
  }
}
