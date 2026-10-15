/** What the auth guard needs out of a verified bearer token. */
export interface VerifiedToken {
  uid: string;
  email: string | null;
  emailVerified: boolean;
}

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

  /** Creates the login account. Throws EmailAlreadyExistsException on a clash. */
  createAccount(input: { email: string; name: string }): Promise<{ uid: string }>;

  /** Removes an account created moments ago, when saving the profile failed. */
  deleteAccount(uid: string): Promise<void>;

  /** Disables (and revokes all sessions of) or re-enables an account. */
  setDisabled(uid: string, disabled: boolean): Promise<void>;

  /** Emails the user a link to set (or reset) their password. */
  sendSetPasswordEmail(email: string): Promise<void>;
}

/**
 * Injection token. Production binds the Firebase implementation; tests bind a
 * fake so every route can be exercised without a Firebase project.
 */
export const IDENTITY_PROVIDER = Symbol('IDENTITY_PROVIDER');
