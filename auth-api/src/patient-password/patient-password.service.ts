import { Inject, Injectable } from '@nestjs/common';
import { AUDIT_ACTIONS, LOGIN_METHODS, PATIENT_PASSWORD, ROLES } from '../common/constants';
import { InvalidCredentialsException, LoginCodeSessionRequiredException } from '../common/api.exception';
import { toLocalIso } from '../common/time';
import { AuditService } from '../audit/audit.service';
import { IDENTITY_PROVIDER, IdentityProvider } from '../identity/identity-provider';
import { AuthUser } from '../users/auth-user';
import { UsersService } from '../users/users.service';
import { DECOY_HASH, hashPassword, passwordMatches } from './password-hash';

const MINUTE_MS = 60_000;

/**
 * Patient passwords (client, Nov 2026; issue #20). Asking the doctor for a code
 * every time was too much, so:
 *
 *   1. First sign-in: phone + a code from the doctor (login-codes/).
 *   2. Still in that session, the patient sets a password (PUT /users/me/password).
 *   3. From then on: phone + password (POST /auth/password-login).
 *   4. Forgot it: a new code from the doctor, then a new password, as in 1-2.
 *
 * No email is needed anywhere. Only a scrypt hash of the password is kept.
 */
@Injectable()
export class PatientPasswordService {
  constructor(
    private readonly users: UsersService,
    @Inject(IDENTITY_PROVIDER) private readonly identity: IdentityProvider,
    private readonly audit: AuditService,
  ) {}

  /**
   * POST /auth/password-login. Every failure is the same 401. Each try is
   * counted before the password is checked, atomically, so parallel guesses
   * can't get more than MAX_FAILURES between them.
   */
  async signIn(phone: string, password: string): Promise<{ customToken: string }> {
    const now = new Date();
    const patient = await this.users.findActivePatientByPhone(phone);
    const counted = patient
      ? await this.users.model
          .findOneAndUpdate(
            {
              _id: patient._id,
              passwordHash: { $type: 'string' },
              $or: [{ passwordLockedUntil: null }, { passwordLockedUntil: { $lte: now } }],
            },
            { $inc: { passwordFailures: 1 } },
            { new: true },
          )
          .lean()
      : null;

    // Unknown number, no password yet, locked, or over the limit by parallel
    // tries: checked against a decoy so it takes as long as a real check.
    if (!counted?.passwordHash || counted.passwordFailures > PATIENT_PASSWORD.MAX_FAILURES) {
      await passwordMatches(password, DECOY_HASH);
      throw new InvalidCredentialsException();
    }

    if (!(await passwordMatches(password, counted.passwordHash))) {
      if (counted.passwordFailures >= PATIENT_PASSWORD.MAX_FAILURES) {
        await this.users.model.updateOne(
          { _id: counted._id },
          { $set: { passwordLockedUntil: new Date(now.getTime() + PATIENT_PASSWORD.LOCK_MINUTES * MINUTE_MS), passwordFailures: 0 } },
        );
        await this.audit.record({
          actor: { id: String(counted._id), role: ROLES.PATIENT },
          action: AUDIT_ACTIONS.PATIENT_PASSWORD_LOCKED,
          patientId: counted._id,
          resourceId: String(counted._id),
          after: { lockedForMinutes: PATIENT_PASSWORD.LOCK_MINUTES },
        });
      }
      throw new InvalidCredentialsException();
    }

    await this.users.model.updateOne({ _id: counted._id }, { $set: { passwordFailures: 0, passwordLockedUntil: null } });
    await this.audit.record({
      actor: { id: String(counted._id), role: ROLES.PATIENT },
      action: AUDIT_ACTIONS.PATIENT_PASSWORD_SIGN_IN,
      patientId: counted._id,
      resourceId: String(counted._id),
    });
    return { customToken: await this.identity.createCustomToken(counted.firebaseUid, LOGIN_METHODS.PASSWORD) };
  }

  /**
   * PUT /users/me/password: set, or reset, the patient's password. Only in a
   * session that started from a doctor's login code - so a password can only
   * ever be set by someone their doctor has just vouched for. Clears any lock.
   */
  async set(patient: AuthUser, password: string): Promise<{ hasPassword: true; passwordSetAt: string | null }> {
    if (patient.loginMethod !== LOGIN_METHODS.LOGIN_CODE) throw new LoginCodeSessionRequiredException();

    const passwordSetAt = new Date();
    await this.users.model.updateOne(
      { _id: patient.id },
      { $set: { passwordHash: await hashPassword(password), passwordSetAt, passwordFailures: 0, passwordLockedUntil: null } },
    );
    await this.audit.record({
      actor: patient,
      action: AUDIT_ACTIONS.PATIENT_PASSWORD_SET,
      patientId: patient.id,
      resourceId: patient.id,
      after: { passwordSetAt: passwordSetAt.toISOString() },
    });
    return { hasPassword: true, passwordSetAt: toLocalIso(passwordSetAt, patient.timeZone) };
  }
}
