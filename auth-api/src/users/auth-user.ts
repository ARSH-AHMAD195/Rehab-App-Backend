import { Role } from '../common/constants';

/** The caller, as every guard and service sees them. */
export interface AuthUser {
  id: string;
  firebaseUid: string;
  role: Role;
  name: string;
  email: string | null;
  /** From the verified token: Firebase is the source of truth for this. */
  emailVerified: boolean;
  timeZone: string | null;
  doctorIds: string[];
}
