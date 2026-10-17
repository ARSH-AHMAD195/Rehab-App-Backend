/**
 * Values fixed by "Auth & User Management API reference v1.0" (15 Oct 2026).
 * Any change here is a change to the published contract.
 */

/** Errors table, v1.0. `code` is stable and the app may branch on it. */
export const ERROR_CODES = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN_ROLE: 'FORBIDDEN_ROLE',
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
  NOT_FOUND: 'NOT_FOUND',
  EMAIL_ALREADY_EXISTS: 'EMAIL_ALREADY_EXISTS',
  DOCTOR_HAS_PATIENTS: 'DOCTOR_HAS_PATIENTS',
  USER_INACTIVE: 'USER_INACTIVE',
  CONCURRENT_UPDATE: 'CONCURRENT_UPDATE',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL: 'INTERNAL',
} as const;
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** `details[].code` values for VALIDATION_FAILED - the same set as Health Monitoring. */
export const DETAIL_CODES = {
  REQUIRED: 'REQUIRED',
  WRONG_SHAPE: 'WRONG_SHAPE',
  OUT_OF_RANGE: 'OUT_OF_RANGE',
  TOO_LONG: 'TOO_LONG',
  NOT_ALLOWED: 'NOT_ALLOWED',
} as const;
export type DetailCode = (typeof DETAIL_CODES)[keyof typeof DETAIL_CODES];

export const ROLES = { PATIENT: 'PATIENT', DOCTOR: 'DOCTOR', ADMIN: 'ADMIN' } as const;
export type Role = (typeof ROLES)[keyof typeof ROLES];

/** Audit log actions, v1.0. */
export const AUDIT_ACTIONS = {
  USER_REGISTERED: 'USER_REGISTERED',
  PROFILE_UPDATED: 'PROFILE_UPDATED',
  USER_DEACTIVATED: 'USER_DEACTIVATED',
  USER_REACTIVATED: 'USER_REACTIVATED',
  DOCTOR_LINKS_CHANGED: 'DOCTOR_LINKS_CHANGED',
  INVITATION_SENT: 'INVITATION_SENT',
  MEDICAL_PROFILE_VIEWED: 'MEDICAL_PROFILE_VIEWED',
  MEDICAL_PROFILE_UPDATED: 'MEDICAL_PROFILE_UPDATED',
} as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

/** What a registration or resend reports about the set-password email. */
export const INVITATION_STATUS = { SENT: 'SENT', FAILED: 'FAILED' } as const;
export type InvitationStatus = (typeof INVITATION_STATUS)[keyof typeof INVITATION_STATUS];

/** Pagination, v1.0: ?limit=20&cursor=..., maximum limit 100. */
export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;

/** POST /patients: a patient's time zone when none is sent. */
export const DEFAULT_PATIENT_TIME_ZONE = 'Asia/Kolkata';

/** PUT /patients/:patientId/doctors: 1-10 doctors. */
export const MAX_DOCTORS_PER_PATIENT = 10;

/** E.164, e.g. +919876543210. */
export const PHONE_PATTERN = /^\+[1-9]\d{7,14}$/;

/** Rate limits, v1.0. Starting values, to be tuned after testing. */
export const RATE_LIMITS = {
  /** POST /patients, /doctors, /admins: 20 per minute per user. */
  REGISTER: { limit: 20, ttl: 60_000 },
  /** All other routes: 120 requests per minute per user. */
  USER: { name: 'user', limit: 120, ttl: 60_000 },
  /** Any route, by IP address: 300 requests per minute. */
  IP: { name: 'ip', limit: 300, ttl: 60_000 },
} as const;

/** POST /users/:userId/invitations: 5 per target user per hour. */
export const INVITATIONS_PER_HOUR = 5;

/** Medical profile enums, v1.0 (a proposal until the clinical team confirms). */
export const SEXES = ['MALE', 'FEMALE', 'OTHER', 'UNDISCLOSED'] as const;
export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'UNKNOWN'] as const;
export const SMOKING_STATUSES = ['NEVER', 'FORMER', 'CURRENT'] as const;
