import { ArgumentsHost, HttpStatus, Logger } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { mongo } from 'mongoose';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { ERROR_CODES } from '../constants';
import { DayChangedException, ValidationFailedException } from '../api.exception';
import { requestContextStorage } from '../context/request-context';

interface CapturedResponse {
  status: number;
  body: Record<string, unknown>;
}

/** Captures what the filter would have sent. */
function capture(exception: unknown): CapturedResponse {
  const captured: CapturedResponse = { status: 0, body: {} };
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({
        status(code: number) {
          captured.status = code;
          return this;
        },
        json(body: Record<string, unknown>) {
          captured.body = body;
        },
      }),
    }),
  } as unknown as ArgumentsHost;

  requestContextStorage.run({ requestId: 'req-test' }, () => {
    new AllExceptionsFilter().catch(exception, host);
  });
  return captured;
}

describe('AllExceptionsFilter', () => {
  beforeAll(() => {
    // 500s are logged on purpose; keep the test output readable.
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  it('keeps the stable code and details of an API exception', () => {
    const res = capture(
      new ValidationFailedException([
        { field: 'readings.BP.systolic', code: 'OUT_OF_RANGE', issue: 'too high' },
      ]),
    );

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      statusCode: 400,
      code: ERROR_CODES.VALIDATION_FAILED,
      error: 'Bad Request',
      message: 'Validation failed',
      requestId: 'req-test',
      details: [{ field: 'readings.BP.systolic', code: 'OUT_OF_RANGE', issue: 'too high' }],
    });
  });

  it('maps a duplicate key to a retryable conflict, not DAY_CHANGED', () => {
    // A lost race on one of the two unique indexes. DAY_CHANGED would send the
    // app off to reload today's log as though midnight had passed.
    const duplicate = new mongo.MongoServerError({ message: 'E11000 duplicate key' });
    duplicate.code = 11000;

    const res = capture(duplicate);

    expect(res.status).toBe(HttpStatus.CONFLICT);
    expect(res.body).toMatchObject({
      statusCode: 409,
      code: ERROR_CODES.CONCURRENT_UPDATE,
      error: 'Conflict',
      requestId: 'req-test',
    });
    expect(res.body.message).toMatch(/retry/i);
    expect(res.body.code).not.toBe(ERROR_CODES.DAY_CHANGED);
  });

  it('still reports a real day change as DAY_CHANGED', () => {
    const res = capture(new DayChangedException('2026-10-09', '2026-10-10'));

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: ERROR_CODES.DAY_CHANGED });
    expect(res.body.message).toContain('2026-10-10');
  });

  it('maps a throttler rejection to RATE_LIMITED', () => {
    const res = capture(new ThrottlerException());

    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({
      code: ERROR_CODES.RATE_LIMITED,
      error: 'Too Many Requests',
    });
  });

  it('never leaks details of an unexpected error', () => {
    const res = capture(new Error('connection string contains a password'));

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      statusCode: 500,
      code: ERROR_CODES.INTERNAL,
      error: 'Internal Server Error',
      message: 'Unexpected server error',
      requestId: 'req-test',
    });
  });
});
