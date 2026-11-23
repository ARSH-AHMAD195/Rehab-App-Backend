import { LoginMethod } from '../common/constants';

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
  /**
   * For a custom-token sign-in: what this API checked before making the token,
   * LOGIN_CODE or PASSWORD (a patient's phone and password). Carried in the
   * token as the LOGIN_CLAIM claim. Null otherwise, and on tokens made before
   * the claim existed (those were all login codes).
   */
  loginClaim: string | null;
}

/** Firebase's sign_in_provider for a sign-in with a custom token. */
export const CUSTOM_SIGN_IN = 'custom';

/** The custom-token claim saying how the patient proved who they are. */
export const LOGIN_CLAIM = 'ffs_login';

/**
 * Everything this module asks of the identity provider (Firebase
 * Authentication). Staff passwords live only there. Patients, who often have
 * no email, keep a phone-and-password sign-in in this module instead
 * (patient-password/), which then signs them in with a custom token.
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
   * A one-time sign-in token for this account, after a correct login code or
   * patient password (`method`, kept in the token). The app passes it to
   * Firebase's signInWithCustomToken and from then on uses normal ID tokens.
   */
  createCustomToken(uid: string, method: LoginMethod): Promise<string>;
}

/**
 * Injection token. Production binds the Firebase implementation; tests bind a
 * fake so every route can be exercised without a Firebase project.
 */
export const IDENTITY_PROVIDER = Symbol('IDENTITY_PROVIDER');
