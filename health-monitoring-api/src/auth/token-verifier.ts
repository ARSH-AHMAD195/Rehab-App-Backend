/** What the auth guard needs out of a verified bearer token. */
export interface VerifiedToken {
  uid: string;
  /** The token's own email_verified claim, as the Auth API reads it. */
  emailVerified: boolean;
  /**
   * Firebase's sign_in_provider: "custom" when the app signed in with the token
   * the Auth API makes after a correct doctor-issued login code.
   */
  signInProvider: string | null;
}

export interface TokenVerifier {
  verify(idToken: string): Promise<VerifiedToken>;
}

/**
 * Injection token for the verifier. Production binds the Firebase
 * implementation; tests bind a stub so the 13 routes can be exercised without
 * a Firebase project.
 */
export const TOKEN_VERIFIER = Symbol('TOKEN_VERIFIER');
