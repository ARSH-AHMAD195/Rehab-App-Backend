import { Global, Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { FirebaseTokenVerifier } from './firebase-token-verifier';
import { TOKEN_VERIFIER } from './token-verifier';

/**
 * The Firebase verifier is the only binding here. Tests override the
 * TOKEN_VERIFIER provider instead of shipping a second auth mode into the app.
 */
@Global()
@Module({
  imports: [UsersModule],
  providers: [FirebaseTokenVerifier, { provide: TOKEN_VERIFIER, useExisting: FirebaseTokenVerifier }],
  exports: [TOKEN_VERIFIER, FirebaseTokenVerifier, UsersModule],
})
export class AuthModule {}
