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
  /** Another patient already has this phone number, which is their login. */
  PHONE_ALREADY_EXISTS: 'PHONE_ALREADY_EXISTS',
  /** Login code wrong, expired, used up, or no such patient - deliberately one answer for all. */
  INVALID_LOGIN_CODE: 'INVALID_LOGIN_CODE',
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
  /** Doctor-issued login codes. The code itself is never recorded. */
  LOGIN_CODE_REQUESTED: 'LOGIN_CODE_REQUESTED',
  LOGIN_CODE_ISSUED: 'LOGIN_CODE_ISSUED',
  LOGIN_CODE_USED: 'LOGIN_CODE_USED',
  /** Investigations (PAC grid). Reads are audited, like the medical profile. */
  INVESTIGATION_ADDED: 'INVESTIGATION_ADDED',
  INVESTIGATION_RETRACTED: 'INVESTIGATION_RETRACTED',
  INVESTIGATIONS_VIEWED: 'INVESTIGATIONS_VIEWED',
  INVESTIGATION_RANGE_CHANGED: 'INVESTIGATION_RANGE_CHANGED',
} as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

/**
 * What a registration or resend reports about the set-password email.
 * NOT_NEEDED: a patient registered with a phone number only signs in with a
 * doctor-issued login code, so no email is sent.
 */
export const INVITATION_STATUS = { SENT: 'SENT', FAILED: 'FAILED', NOT_NEEDED: 'NOT_NEEDED' } as const;
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

/**
 * Doctor-issued login codes (client change request, Nov 2026): the code goes
 * to the patient's doctor, who passes it on - no SMS.
 *
 * The lifetime and the number of tries are defaults until the client confirms
 * them; override with LOGIN_CODE_TTL_MINUTES and LOGIN_CODE_MAX_ATTEMPTS.
 */
export const LOGIN_CODE = {
  DIGITS: 6,
  DEFAULT_TTL_MINUTES: 10,
  DEFAULT_MAX_ATTEMPTS: 5,
  /** A patient's "send me a code" request shows in the doctor's list this long. */
  REQUEST_VISIBLE_HOURS: 24,
  /** Repeated requests within this window are ignored (no extra audit rows). */
  REQUEST_REPEAT_SECONDS: 60,
  /** POST /auth/login-code/request and /verify: per IP address, per minute. */
  PUBLIC_RATE: { limit: 10, ttl: 60_000 },
} as const;

/** How a caller signed in, from the token: the app hides "verify your email" for LOGIN_CODE. */
export const LOGIN_METHODS = { PASSWORD: 'PASSWORD', LOGIN_CODE: 'LOGIN_CODE' } as const;
export type LoginMethod = (typeof LOGIN_METHODS)[keyof typeof LOGIN_METHODS];

/** Patient app language. Content in Hindi arrives with the translations. */
export const LANGUAGES = ['en', 'hi'] as const;
export type Language = (typeof LANGUAGES)[number];

/** Medical profile enums, v1.0 (a proposal until the clinical team confirms). */
export const SEXES = ['MALE', 'FEMALE', 'OTHER', 'UNDISCLOSED'] as const;
export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'UNKNOWN'] as const;
export const SMOKING_STATUSES = ['NEVER', 'FORMER', 'CURRENT'] as const;

/**
 * Onboarding "other conditions" checkboxes, as the client's change request
 * lists them: hypertension, diabetes, chronic kidney disease, ischaemic heart
 * disease, smoking, other. OTHER's details go in otherConditions.
 */
export const CONDITIONS = ['HTN', 'DM', 'CKD', 'IHD', 'SMOKING', 'OTHER'] as const;

/** Onboarding weight, kg: the same data-entry limits as the daily weight vital. */
export const WEIGHT_KG_RANGE = { min: 20, max: 250 } as const;
