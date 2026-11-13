/** What the auth guard needs out of a verified bearer token. */
export interface VerifiedToken {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  /**
   * How the user signed in, from the token (Firebase's sign_in_provider):
   * "password", or "custom" when the app signed in with a token this API made
   * after a correct login code. Only this API can make custom tokens.
   */
  signInProvider: string | null;
}

/** Firebase's sign_in_provider for a sign-in with a custom token. */
export const CUSTOM_SIGN_IN = 'custom';

/**
 * Everything this module asks of the identity provider (Firebase
 * Authentication). Passwords live only there; this module never sees one.
 */
export interface IdentityProvider {
  /**
   * Verifies an ID token, including that it was not revoked and the account is
   * not disabled - so a deactivated user is locked out at once, not when their
   * token expires.
   */
  verifyToken(idToken: string): Promise<VerifiedToken>;

  /**
   * Creates the login account. Throws EmailAlreadyExistsException on a clash.
   * Without an email (a patient who signs in with a login code) the account
   * has no password at all.
   */
  createAccount(input: { email?: string | null; name: string }): Promise<{ uid: string }>;

  /** Removes an account created moments ago, when saving the profile failed. */
  deleteAccount(uid: string): Promise<void>;

  /** Disables (and revokes all sessions of) or re-enables an account. */
  setDisabled(uid: string, disabled: boolean): Promise<void>;

  /** Emails the user a link to set (or reset) their password. */
  sendSetPasswordEmail(email: string): Promise<void>;

  /**
   * A one-time sign-in token for this account, after a correct login code. The
   * app passes it to Firebase's signInWithCustomToken and from then on uses
   * normal ID tokens.
   */
  createCustomToken(uid: string): Promise<string>;
}

/**
 * Injection token. Production binds the Firebase implementation; tests bind a
 * fake so every route can be exercised without a Firebase project.
 */
export const IDENTITY_PROVIDER = Symbol('IDENTITY_PROVIDER');
