import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as admin from 'firebase-admin';
import { EmailAlreadyExistsException, UnauthenticatedException } from '../common/api.exception';
import { IdentityProvider, VerifiedToken } from './identity-provider';

/**
 * Firebase Authentication, through the Admin SDK (accounts, tokens) and the
 * Identity Toolkit REST API (emails).
 *
 * Emails go through Firebase's own mailer (`accounts:sendOobCode`), so v1.0
 * needs no SMTP server. That call is authenticated with the project's Web API
 * key, the same public key the app uses to sign in.
 */
@Injectable()
export class FirebaseIdentityProvider implements IdentityProvider {
  private readonly logger = new Logger(FirebaseIdentityProvider.name);
  private app?: admin.app.App;

  constructor(private readonly config: ConfigService) {}

  async verifyToken(idToken: string): Promise<VerifiedToken> {
    try {
      // checkRevoked: a deactivated user's existing tokens stop working at
      // once. It also rejects tokens of disabled accounts.
      const decoded = await this.auth().verifyIdToken(idToken, true);
      return {
        uid: decoded.uid,
        email: decoded.email ?? null,
        emailVerified: decoded.email_verified === true,
      };
    } catch (error) {
      this.logger.debug(`Token rejected: ${(error as Error).message}`);
      throw new UnauthenticatedException();
    }
  }

  async createAccount(input: { email: string; name: string }): Promise<{ uid: string }> {
    try {
      const user = await this.auth().createUser({
        email: input.email,
        displayName: input.name,
        emailVerified: false,
        // A random password nobody knows. The user sets their own through the
        // emailed link; having a password from the start guarantees Firebase
        // treats the account as email/password, so the reset link works.
        password: randomBytes(32).toString('base64url'),
      });
      return { uid: user.uid };
    } catch (error) {
      if ((error as { code?: string }).code === 'auth/email-already-exists') {
        throw new EmailAlreadyExistsException();
      }
      throw error;
    }
  }

  async deleteAccount(uid: string): Promise<void> {
    await this.auth().deleteUser(uid);
  }

  async setDisabled(uid: string, disabled: boolean): Promise<void> {
    await this.auth().updateUser(uid, { disabled });
    if (disabled) await this.auth().revokeRefreshTokens(uid);
  }

  async sendSetPasswordEmail(email: string): Promise<void> {
    const apiKey = this.config.getOrThrow<string>('FIREBASE_WEB_API_KEY');
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestType: 'PASSWORD_RESET', email }),
      },
    );
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Firebase sendOobCode failed (${response.status}): ${body.slice(0, 200)}`);
    }
  }

  /** Fails the boot, not the first request, when Firebase is misconfigured. */
  assertConfigured(): void {
    this.getApp();
    this.config.getOrThrow<string>('FIREBASE_WEB_API_KEY');
  }

  private auth(): admin.auth.Auth {
    return admin.auth(this.getApp());
  }

  private getApp(): admin.app.App {
    if (this.app) return this.app;

    this.app =
      admin.apps.length && admin.apps[0]
        ? admin.app()
        : admin.initializeApp({
            credential: this.loadCredential(),
            projectId: this.config.get<string>('FIREBASE_PROJECT_ID') || undefined,
          });
    return this.app;
  }

  private loadCredential(): admin.credential.Credential {
    const inline = this.config.get<string>('FIREBASE_SERVICE_ACCOUNT_JSON');
    if (inline) return admin.credential.cert(JSON.parse(inline) as admin.ServiceAccount);

    const path = this.config.get<string>('GOOGLE_APPLICATION_CREDENTIALS');
    if (path) {
      return admin.credential.cert(JSON.parse(readFileSync(path, 'utf8')) as admin.ServiceAccount);
    }

    throw new Error(
      'Firebase credentials missing. Set GOOGLE_APPLICATION_CREDENTIALS (path to the ' +
        'service account JSON) or FIREBASE_SERVICE_ACCOUNT_JSON (the JSON itself).',
    );
  }
}
