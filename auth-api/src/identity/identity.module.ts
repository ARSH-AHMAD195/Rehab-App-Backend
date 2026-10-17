import { Global, Module } from '@nestjs/common';
import { FirebaseIdentityProvider } from './firebase-identity.provider';
import { IDENTITY_PROVIDER } from './identity-provider';

/**
 * Firebase is the only binding. Tests override IDENTITY_PROVIDER instead of
 * shipping a second auth mode into the app.
 */
@Global()
@Module({
  providers: [
    FirebaseIdentityProvider,
    { provide: IDENTITY_PROVIDER, useExisting: FirebaseIdentityProvider },
  ],
  exports: [IDENTITY_PROVIDER, FirebaseIdentityProvider],
})
export class IdentityModule {}
