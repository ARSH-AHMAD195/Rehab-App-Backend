import { HttpException, HttpStatus } from '@nestjs/common';
import { DetailCode, ERROR_CODES, ErrorCode } from './constants';

/** One entry of `details[]` in the error body. */
export interface ErrorDetail {
  field: string;
  code: DetailCode | string;
  issue: string;
}

/**
 * Every error this module returns carries a stable `code` from the v1.0 Errors
 * table. Throw this (or a subclass) rather than Nest's built-in exceptions so
 * the code is never lost.
 */
export class ApiException extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: ErrorCode,
    message: string,
    readonly details?: ErrorDetail[],
  ) {
    super({ code, message, details }, status);
  }
}

export class ValidationFailedException extends ApiException {
  constructor(details: ErrorDetail[], message = 'Validation failed') {
    super(HttpStatus.BAD_REQUEST, ERROR_CODES.VALIDATION_FAILED, message, details);
  }
}

export class UnauthenticatedException extends ApiException {
  constructor(message = 'Token missing, invalid or expired') {
    super(HttpStatus.UNAUTHORIZED, ERROR_CODES.UNAUTHENTICATED, message);
  }
}

export class ForbiddenRoleException extends ApiException {
  constructor(message = "Caller's role can't use this route") {
    super(HttpStatus.FORBIDDEN, ERROR_CODES.FORBIDDEN_ROLE, message);
  }
}

export class EmailNotVerifiedException extends ApiException {
  constructor() {
    super(
      HttpStatus.FORBIDDEN,
      ERROR_CODES.EMAIL_NOT_VERIFIED,
      'Verify your email address before using this route',
    );
  }
}

/**
 * Also returned when a record belongs to a patient the caller can't access, so
 * a doctor can't tell whether that patient exists (v1.0, Access rules).
 */
export class NotFoundException extends ApiException {
  constructor(message = 'Record not found') {
    super(HttpStatus.NOT_FOUND, ERROR_CODES.NOT_FOUND, message);
  }
}

export class EmailAlreadyExistsException extends ApiException {
  constructor() {
    super(HttpStatus.CONFLICT, ERROR_CODES.EMAIL_ALREADY_EXISTS, 'A user with this email already exists');
  }
}

export class DoctorHasPatientsException extends ApiException {
  constructor(count: number) {
    super(
      HttpStatus.CONFLICT,
      ERROR_CODES.DOCTOR_HAS_PATIENTS,
      `This doctor is the only active doctor of ${count} active patient(s). Link them to another doctor first.`,
    );
  }
}

export class UserInactiveException extends ApiException {
  constructor() {
    super(HttpStatus.CONFLICT, ERROR_CODES.USER_INACTIVE, 'This user is deactivated');
  }
}

/** Someone else saved first; nothing was saved and the request can be retried. */
export class ConcurrentUpdateException extends ApiException {
  constructor(message = 'The record changed while saving. Reload and retry.') {
    super(HttpStatus.CONFLICT, ERROR_CODES.CONCURRENT_UPDATE, message);
  }
}

/** A limit counted by this module itself; the filter turns retryAfterSeconds into Retry-After. */
export class RateLimitedException extends ApiException {
  constructor(
    readonly retryAfterSeconds: number,
    message = 'Rate limit exceeded',
  ) {
    super(HttpStatus.TOO_MANY_REQUESTS, ERROR_CODES.RATE_LIMITED, message);
  }
}
