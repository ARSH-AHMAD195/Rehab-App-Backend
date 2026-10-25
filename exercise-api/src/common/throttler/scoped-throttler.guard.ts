import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerLimitDetail, ThrottlerRequest } from '@nestjs/throttler';
import { Request } from 'express';
import { RATE_LIMITS } from '../constants';
import { AuthUser } from '../../users/users.service';

/**
 * Rate limits, same as Health Monitoring:
 *   All routes       - 120 requests per minute per user  ("user")
 *   Any route, by IP - 300 requests per minute           ("ip")
 *
 * Two guards share one storage, because the per-user limit needs an identity
 * and the per-IP limit must not wait for one:
 *
 *   IpThrottlerGuard   runs BEFORE the auth guard, counts by address only
 *   UserThrottlerGuard runs AFTER it, counts by authenticated user id only
 *
 * Each guard ignores the other's named limit, so a request increments each
 * bucket exactly once.
 */
abstract class RetryAfterThrottlerGuard extends ThrottlerGuard {
  /** With named limits the base guard emits Retry-After-user / -ip; set a plain Retry-After too. */
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

/**
 * The per-IP limit, enforced before the token is verified, so a flood of
 * invalid tokens never reaches Firebase or the users collection.
 */
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

/** The per-user limit, keyed on the identity the auth guard resolved. */
@Injectable()
export class UserThrottlerGuard extends RetryAfterThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    return this.ipOf(req);
  }

  protected override async handleRequest(request: ThrottlerRequest): Promise<boolean> {
    // Already counted by IpThrottlerGuard, before authentication.
    if (request.throttler.name === RATE_LIMITS.IP.name) return true;

    const req = request.context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const tracker =
      req.user?.id ?? `anon:${this.ipOf(req as unknown as Record<string, unknown>)}`;

    return super.handleRequest({ ...request, getTracker: async () => tracker });
  }
}
