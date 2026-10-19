/**
 * Values fixed by docs/EXERCISE_API_REFERENCE.md. Error codes, roles and
 * conventions match the Health Monitoring API, so the app handles both alike.
 * Any change here is a change to the published contract.
 */

/** Errors. `code` is stable and the app may branch on it. */
export const ERROR_CODES = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN_ROLE: 'FORBIDDEN_ROLE',
  NOT_FOUND: 'NOT_FOUND',
  /** The record changed under a concurrent write; the same request can be retried. */
  CONCURRENT_UPDATE: 'CONCURRENT_UPDATE',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL: 'INTERNAL',
} as const;
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** `details[].code` values for VALIDATION_FAILED. */
export const DETAIL_CODES = {
  REQUIRED: 'REQUIRED',
  WRONG_SHAPE: 'WRONG_SHAPE',
  OUT_OF_RANGE: 'OUT_OF_RANGE',
  TOO_LONG: 'TOO_LONG',
  /** Points at a record that doesn't exist, e.g. an unknown categoryId. */
  UNKNOWN_ID: 'UNKNOWN_ID',
  /** A category code that is already taken. */
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  /** Using a deactivated record, or deactivating a category that's in use. */
  NOT_ALLOWED: 'NOT_ALLOWED',
} as const;
export type DetailCode = (typeof DETAIL_CODES)[keyof typeof DETAIL_CODES];

export const ROLES = { PATIENT: 'PATIENT', DOCTOR: 'DOCTOR', ADMIN: 'ADMIN' } as const;
export type Role = (typeof ROLES)[keyof typeof ROLES];

/** Audit log actions, reference section 6. */
export const AUDIT_ACTIONS = {
  EXERCISE_PLAN_CHANGED: 'EXERCISE_PLAN_CHANGED',
  EXERCISE_PLAN_VIEWED: 'EXERCISE_PLAN_VIEWED',
  EXERCISE_LIBRARY_CHANGED: 'EXERCISE_LIBRARY_CHANGED',
} as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

/** The four categories named in the SRS, created on first start. */
export const DEFAULT_CATEGORIES = [
  { code: 'WALKING', name: 'Walking', order: 1 },
  { code: 'STRENGTH', name: 'Strength', order: 2 },
  { code: 'BREATHING', name: 'Breathing', order: 3 },
  { code: 'STRETCHING', name: 'Stretching', order: 4 },
] as const;

/** A category code: capitals, digits and underscores, starting with a letter. */
export const CATEGORY_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,29}$/;

export const VIDEO_PROVIDERS = { YOUTUBE: 'YOUTUBE' } as const;
export type VideoProvider = (typeof VIDEO_PROVIDERS)[keyof typeof VIDEO_PROVIDERS];

/** Text limits for the library. */
export const LIMITS = {
  CATEGORY_NAME: 60,
  EXERCISE_NAME: 120,
  DESCRIPTION: 1000,
  INSTRUCTION_STEPS: 30,
  INSTRUCTION_STEP: 500,
  SEARCH: 100,
} as const;

/** Pagination: ?limit=20&cursor=..., maximum limit 100. Same as Health Monitoring. */
export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;

export const MAX_BODY_SIZE = '32kb';

/** Rate limits, same starting values as Health Monitoring. */
export const RATE_LIMITS = {
  /** All routes: 120 requests per minute per user. */
  USER: { name: 'user', limit: 120, ttl: 60_000 },
  /** Any route, by IP address: 300 requests per minute. */
  IP: { name: 'ip', limit: 300, ttl: 60_000 },
} as const;
