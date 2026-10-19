import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';
import { requestContextStorage } from './request-context';

export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Optional X-Request-Id header. The server creates one if missing, returns it
 * on every response and stores it in audit records.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.headers[REQUEST_ID_HEADER];
    const requestId =
      (Array.isArray(incoming) ? incoming[0] : incoming)?.trim() || randomUUID();

    res.setHeader(REQUEST_ID_HEADER, requestId);
    const route = `${req.method} ${req.originalUrl.split('?')[0]}`;
    requestContextStorage.run({ requestId, route }, () => next());
  }
}
