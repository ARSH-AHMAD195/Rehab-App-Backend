import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'node:fs';
import * as admin from 'firebase-admin';
import { UnauthenticatedException } from '../common/api.exception';
import { TokenVerifier, VerifiedToken } from './token-verifier';

/**
 * Authorization: Bearer <Firebase ID token>, same Firebase project as the
 * other two APIs.
 *
 * The app is initialised on first use so that tests and tooling that never
 * verify a token don't need credentials. `assertConfigured` in main.ts fails
 * the boot early when they are missing in a real run.
 */
@Injectable()
export class FirebaseTokenVerifier implements TokenVerifier {
  private readonly logger = new Logger(FirebaseTokenVerifier.name);
  private app?: admin.app.App;

  constructor(private readonly config: ConfigService) {}

  async verify(idToken: string): Promise<VerifiedToken> {
    try {
      const decoded = await admin.auth(this.getApp()).verifyIdToken(idToken);
      return { uid: decoded.uid };
    } catch (error) {
      this.logger.debug(`Token rejected: ${(error as Error).message}`);
      throw new UnauthenticatedException();
    }
  }

  assertConfigured(): void {
    this.getApp();
  }

  private getApp(): admin.app.App {
    if (this.app) return this.app;

    const credential = this.loadCredential();
    this.app =
      admin.apps.length && admin.apps[0]
        ? admin.app()
        : admin.initializeApp({
            credential,
            projectId: this.config.get<string>('FIREBASE_PROJECT_ID') || undefined,
          });
    return this.app;
  }

  private loadCredential(): admin.credential.Credential {
    const inline = this.config.get<string>('FIREBASE_SERVICE_ACCOUNT_JSON');
    if (inline) {
      return admin.credential.cert(JSON.parse(inline) as admin.ServiceAccount);
    }

    const path = this.config.get<string>('GOOGLE_APPLICATION_CREDENTIALS');
    if (path) {
      return admin.credential.cert(
        JSON.parse(readFileSync(path, 'utf8')) as admin.ServiceAccount,
      );
    }

    throw new Error(
      'Firebase credentials missing. Set GOOGLE_APPLICATION_CREDENTIALS (path to the ' +
        'service account JSON) or FIREBASE_SERVICE_ACCOUNT_JSON (the JSON itself).',
    );
  }
}
