import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerLimitDetail, ThrottlerRequest } from '@nestjs/throttler';
import { Request } from 'express';
import { RATE_LIMITS } from '../constants';
import { AuthUser } from '../../users/auth-user';

/**
 * Rate limits, v1.0 - the same two-guard design as Health Monitoring:
 *
 *   IpThrottlerGuard   runs BEFORE the auth guard, counts by address only (300/min)
 *   UserThrottlerGuard runs AFTER it, counts by user id (120/min, 20/min on
 *                      the three registration routes)
 *
 * Each guard ignores the other's named limit, so a request increments each
 * bucket exactly once, and a flood of bad tokens never reaches Firebase.
 */
abstract class RetryAfterThrottlerGuard extends ThrottlerGuard {
  /** With named limits the base guard emits Retry-After-<name>; v1.0 promises plain Retry-After. */
  protected override async throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const { res } = this.getRequestResponse(context);
    const seconds = Math.ceil((detail.timeToBlockExpire || detail.timeToExpire || 60) as number);
    this.setResponseHeader(res, 'Retry-After', seconds);
    await super.throwThrottlingException(context, detail);
  }

  protected ipOf(req: Record<string, unknown>): string {
    const ips = req.ips as string[] | undefined;
    return ips?.length ? ips[0] : ((req.ip as string) ?? 'unknown');
  }
}

@Injectable()
export class IpThrottlerGuard extends RetryAfterThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    return this.ipOf(req);
  }

  protected override async handleRequest(request: ThrottlerRequest): Promise<boolean> {
    if (request.throttler.name !== RATE_LIMITS.IP.name) return true;
    return super.handleRequest(request);
  }
}

@Injectable()
export class UserThrottlerGuard extends RetryAfterThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    return this.ipOf(req);
  }

  protected override async handleRequest(request: ThrottlerRequest): Promise<boolean> {
    if (request.throttler.name === RATE_LIMITS.IP.name) return true;

    const req = request.context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const tracker = req.user?.id ?? `anon:${this.ipOf(req as unknown as Record<string, unknown>)}`;
    return super.handleRequest({ ...request, getTracker: async () => tracker });
  }
}
