/** What the auth guard needs out of a verified bearer token. */
export interface VerifiedToken {
  uid: string;
}

export interface TokenVerifier {
  verify(idToken: string): Promise<VerifiedToken>;
}

/**
 * Injection token for the verifier. Production binds the Firebase
 * implementation; tests bind a stub so routes can be exercised without a
 * Firebase project.
 */
export const TOKEN_VERIFIER = Symbol('TOKEN_VERIFIER');
