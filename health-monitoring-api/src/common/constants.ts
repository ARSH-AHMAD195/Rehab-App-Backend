/**
 * Values fixed by "Health Monitoring API reference v1.1" (13 Oct 2026).
 * Any change here is a change to the published contract.
 */

/** Errors table, v1.1. `code` is stable and the app may branch on it. */
export const ERROR_CODES = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN_ROLE: 'FORBIDDEN_ROLE',
  NOT_FOUND: 'NOT_FOUND',
  DAY_CHANGED: 'DAY_CHANGED',
  ALERT_ALREADY_ACKNOWLEDGED: 'ALERT_ALREADY_ACKNOWLEDGED',
  /**
   * NOT IN v1.1 - needs a row in the Errors table.
   *
   * The record changed under a concurrent write, so the request can simply be
   * retried. Keeping this separate from DAY_CHANGED matters: DAY_CHANGED tells
   * the app to reload today's log because midnight passed, which is the wrong
   * response to a lost race.
   */
  CONCURRENT_UPDATE: 'CONCURRENT_UPDATE',
  /**
   * NOT IN v1.1 - need rows in the Errors table. Idempotency-Key on
   * PUT /me/vitals/today: the key is still being processed by an earlier
   * request (409, retry shortly), or was used with a different body (422).
   */
  IDEMPOTENCY_KEY_IN_USE: 'IDEMPOTENCY_KEY_IN_USE',
  IDEMPOTENCY_KEY_REUSED: 'IDEMPOTENCY_KEY_REUSED',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL: 'INTERNAL',
} as const;
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** `details[].code` values for VALIDATION_FAILED, v1.1. */
export const DETAIL_CODES = {
  REQUIRED: 'REQUIRED',
  UNKNOWN_TYPE: 'UNKNOWN_TYPE',
  WRONG_SHAPE: 'WRONG_SHAPE',
  OUT_OF_RANGE: 'OUT_OF_RANGE',
  TOO_LONG: 'TOO_LONG',
  BP_SYSTOLIC_NOT_ABOVE_DIASTOLIC: 'BP_SYSTOLIC_NOT_ABOVE_DIASTOLIC',
  EMPTY_READINGS: 'EMPTY_READINGS',
} as const;
export type DetailCode = (typeof DETAIL_CODES)[keyof typeof DETAIL_CODES];

export const ROLES = { PATIENT: 'PATIENT', DOCTOR: 'DOCTOR', ADMIN: 'ADMIN' } as const;
export type Role = (typeof ROLES)[keyof typeof ROLES];

/** Status, v1.1. */
export const READING_STATUS = { LOGGED: 'LOGGED', NOT_YET: 'NOT_YET' } as const;
export type ReadingStatus = (typeof READING_STATUS)[keyof typeof READING_STATUS];

export const DAY_STATUS = {
  NOT_STARTED: 'NOT_STARTED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETE: 'COMPLETE',
} as const;
export type DayStatus = (typeof DAY_STATUS)[keyof typeof DAY_STATUS];

/** Parameters table, v1.1. 13 parameters, 14 form fields (BP counts twice). */
export const VITAL_TYPES = [
  'BP', 'PULSE', 'SPO2', 'TEMP', 'WEIGHT', 'SUGAR', 'PAIN',
  'WALK_MIN', 'STEPS', 'SLEEP_HRS', 'NUTRITION', 'WATER_ML', 'MOOD',
] as const;
export type VitalType = (typeof VITAL_TYPES)[number];

export const VALUE_KINDS = {
  NUMERIC: 'numeric',
  PAIR: 'pair',
  SCALE: 'scale',
  TEXT: 'text',
} as const;
export type ValueKind = (typeof VALUE_KINDS)[keyof typeof VALUE_KINDS];

export const BP_FIELDS = ['systolic', 'diastolic'] as const;
export type BpField = (typeof BP_FIELDS)[number];

/** Alert lifecycle, v1.1. States are OPEN -> ACKNOWLEDGED, and acknowledged is final. */
export const ALERT_STATUS = { OPEN: 'OPEN', ACKNOWLEDGED: 'ACKNOWLEDGED' } as const;
export type AlertStatus = (typeof ALERT_STATUS)[keyof typeof ALERT_STATUS];

export const ALERT_RULES = { BELOW_LOW: 'BELOW_LOW', ABOVE_HIGH: 'ABOVE_HIGH' } as const;
export type AlertRule = (typeof ALERT_RULES)[keyof typeof ALERT_RULES];

export const SEVERITIES = { LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH' } as const;
export type Severity = (typeof SEVERITIES)[keyof typeof SEVERITIES];
/** Used to decide "severity goes up", which re-raises the notification event. */
export const SEVERITY_RANK: Record<Severity, number> = { LOW: 1, MEDIUM: 2, HIGH: 3 };

/** Audit log actions, v1.1. */
export const AUDIT_ACTIONS = {
  VITALS_VALUE_CHANGED: 'VITALS_VALUE_CHANGED',
  PATIENT_VITALS_VIEWED: 'PATIENT_VITALS_VIEWED',
  ALERT_ACKNOWLEDGED: 'ALERT_ACKNOWLEDGED',
  THRESHOLD_CHANGED: 'THRESHOLD_CHANGED',
  VITAL_TYPE_CHANGED: 'VITAL_TYPE_CHANGED',
} as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

/** Events table, v1.1. This module publishes; it never calls other modules. */
export const EVENT_TYPES = {
  LOG_UPDATED: 'vitals.log.updated',
  ALERT_RAISED: 'vitals.alert.raised',
  ALERT_ACKNOWLEDGED: 'vitals.alert.acknowledged',
} as const;
export type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];

export const EVENT_SCHEMA_VERSION = 1;

/** Trends, v1.1: period is 7d, 30d or 90d; NUTRITION has no trend. */
export const TREND_PERIODS = { '7d': 7, '30d': 30, '90d': 90 } as const;
export type TrendPeriod = keyof typeof TREND_PERIODS;
export const TREND_EXCLUDED_TYPES: readonly string[] = ['NUTRITION'];

/** Pagination, v1.1: ?limit=20&cursor=..., maximum limit 100. */
export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;

/** GET /me/vitals/logs defaults: from = 30 days ago, to = today. */
export const DEFAULT_LOGS_WINDOW_DAYS = 30;

/** Size of one PUT, v1.1: at most 13 readings, body up to 16 KB. */
export const MAX_READINGS_PER_SAVE = 13;
export const MAX_BODY_SIZE = '16kb';

/** Rate limits, v1.1. Starting values, to be tuned after testing. */
export const RATE_LIMITS = {
  /** PUT /me/vitals/today: 30 requests per minute per user. */
  WRITE: { name: 'write', limit: 30, ttl: 60_000 },
  /** All other routes: 120 requests per minute per user. */
  USER: { name: 'user', limit: 120, ttl: 60_000 },
  /** Any route, by IP address: 300 requests per minute. */
  IP: { name: 'ip', limit: 300, ttl: 60_000 },
} as const;

/** Mood labels. v1.1 Open questions: only level 4 is agreed ("Good"). */
export const MOOD_LABELS: Record<number, string | null> = {
  1: null,
  2: null,
  3: null,
  4: 'Good',
  5: null,
};

export const MAX_NOTE_LENGTH = 500;
