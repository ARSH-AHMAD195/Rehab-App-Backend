import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Response } from 'express';
import { mongo } from 'mongoose';
import { ApiException, ErrorDetail, RateLimitedException } from '../api.exception';
import { ERROR_CODES, ErrorCode } from '../constants';
import { currentRequestId } from '../context/request-context';

interface ErrorBody {
  statusCode: number;
  code: ErrorCode;
  error: string;
  message: string;
  requestId?: string;
  details?: ErrorDetail[];
}

/**
 * The single error shape, shared with Health Monitoring:
 * { statusCode, code, error, message, requestId, details? }
 *
 * `code` is stable; `message` and `issue` are for people. 500s never leak
 * internals - they are logged instead.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const body = this.toBody(exception);

    if (exception instanceof RateLimitedException) {
      res.setHeader('Retry-After', String(exception.retryAfterSeconds));
    }

    if (body.statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `[${body.requestId}] ${body.code}: ${exception instanceof Error ? exception.message : String(exception)}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }
    res.status(body.statusCode).json(body);
  }

  private toBody(exception: unknown): ErrorBody {
    const requestId = currentRequestId();

    if (exception instanceof ApiException) {
      return this.build(exception.getStatus(), exception.code, exception.message, requestId, exception.details);
    }

    // @nestjs/throttler has already set Retry-After.
    if (exception instanceof ThrottlerException) {
      return this.build(HttpStatus.TOO_MANY_REQUESTS, ERROR_CODES.RATE_LIMITED, 'Rate limit exceeded', requestId);
    }

    // A unique-index clash that reached this far is a lost race (two saves of
    // the same medical profile, say). Email clashes are caught earlier and
    // reported as EMAIL_ALREADY_EXISTS.
    if (exception instanceof mongo.MongoServerError && exception.code === 11000) {
      return this.build(
        HttpStatus.CONFLICT,
        ERROR_CODES.CONCURRENT_UPDATE,
        'The record changed while saving. Reload and retry.',
        requestId,
      );
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      const message =
        typeof payload === 'string'
          ? payload
          : ((payload as { message?: string | string[] })?.message ?? exception.message);

      return this.build(
        status,
        this.codeForStatus(status),
        Array.isArray(message) ? message.join('; ') : message,
        requestId,
        typeof payload === 'object' ? (payload as { details?: ErrorDetail[] }).details : undefined,
      );
    }

    return this.build(HttpStatus.INTERNAL_SERVER_ERROR, ERROR_CODES.INTERNAL, 'Unexpected server error', requestId);
  }

  /** Fallback mapping for exceptions Nest raises before our code runs. */
  private codeForStatus(status: number): ErrorCode {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return ERROR_CODES.VALIDATION_FAILED;
      case HttpStatus.UNAUTHORIZED:
        return ERROR_CODES.UNAUTHENTICATED;
      case HttpStatus.FORBIDDEN:
        return ERROR_CODES.FORBIDDEN_ROLE;
      case HttpStatus.NOT_FOUND:
        return ERROR_CODES.NOT_FOUND;
      case HttpStatus.TOO_MANY_REQUESTS:
        return ERROR_CODES.RATE_LIMITED;
      default:
        return status >= 500 ? ERROR_CODES.INTERNAL : ERROR_CODES.VALIDATION_FAILED;
    }
  }

  private build(
    statusCode: number,
    code: ErrorCode,
    message: string,
    requestId?: string,
    details?: ErrorDetail[],
  ): ErrorBody {
    return {
      statusCode,
      code,
      error: HTTP_REASONS[statusCode] ?? 'Error',
      message,
      requestId,
      ...(details?.length ? { details } : {}),
    };
  }
}

const HTTP_REASONS: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  413: 'Payload Too Large',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
};
