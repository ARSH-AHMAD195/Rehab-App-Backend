import { HttpException, HttpStatus } from '@nestjs/common';
import { DetailCode, ERROR_CODES, ErrorCode } from './constants';

/** One entry of `details[]` in the error body. */
export interface ErrorDetail {
  field: string;
  code: DetailCode | string;
  issue: string;
}

/**
 * Every error this module returns carries a stable `code`. Throw this (or a
 * subclass) rather than Nest's built-in exceptions so the code is never lost.
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

/**
 * Also returned when a record belongs to a patient the caller can't access, so
 * a doctor can't tell whether that patient exists.
 */
export class NotFoundException extends ApiException {
  constructor(message = 'Record not found') {
    super(HttpStatus.NOT_FOUND, ERROR_CODES.NOT_FOUND, message);
  }
}

export class DayChangedException extends ApiException {
  constructor(message: string) {
    super(HttpStatus.CONFLICT, ERROR_CODES.DAY_CHANGED, message);
  }
}

export class ExerciseNotInPlanException extends ApiException {
  constructor(message = "This exercise isn't in your current plan. Reload today's checklist.") {
    super(HttpStatus.CONFLICT, ERROR_CODES.EXERCISE_NOT_IN_PLAN, message);
  }
}

export class ExerciseAlreadyDoneException extends ApiException {
  constructor(timesPerDay: number) {
    super(
      HttpStatus.CONFLICT,
      ERROR_CODES.EXERCISE_ALREADY_DONE,
      `Already done ${timesPerDay} time${timesPerDay === 1 ? '' : 's'} today, as planned.`,
    );
  }
}

/** An earlier request with this Idempotency-Key hasn't finished; retry shortly to get its answer. */
export class IdempotencyKeyInUseException extends ApiException {
  constructor() {
    super(
      HttpStatus.CONFLICT,
      ERROR_CODES.IDEMPOTENCY_KEY_IN_USE,
      'A request with this Idempotency-Key is still being processed. Retry in a moment.',
    );
  }
}

/** The Idempotency-Key was already used for a different request body - a client bug. */
export class IdempotencyKeyReusedException extends ApiException {
  constructor() {
    super(
      HttpStatus.UNPROCESSABLE_ENTITY,
      ERROR_CODES.IDEMPOTENCY_KEY_REUSED,
      'This Idempotency-Key was already used with a different request body. Use a new key for a new request.',
    );
  }
}

/** A concurrent write won the race, so nothing was saved and the same request can be sent again. */
export class ConcurrentUpdateException extends ApiException {
  constructor(message = 'The record changed while saving. Retry the request.') {
    super(HttpStatus.CONFLICT, ERROR_CODES.CONCURRENT_UPDATE, message);
  }
}
