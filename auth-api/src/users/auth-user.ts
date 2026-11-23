import { LoginMethod, Role } from '../common/constants';

/** The caller, as every guard and service sees them. */
export interface AuthUser {
  id: string;
  firebaseUid: string;
  role: Role;
  name: string;
  email: string | null;
  /** From the verified token: Firebase is the source of truth for this. */
  emailVerified: boolean;
  /** LOGIN_CODE when this token came from a doctor-issued login code. */
  loginMethod: LoginMethod;
  /**
   * Signed in with a token this API made (after a login code or a patient
   * password), not with Firebase's own email and password.
   */
  viaCustomToken: boolean;
  timeZone: string | null;
  doctorIds: string[];
}
