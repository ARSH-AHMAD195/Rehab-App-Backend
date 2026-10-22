import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { EmailNotVerifiedException } from '../api.exception';
import { AuthUser } from '../../users/auth-user';

const ALLOW_UNVERIFIED_KEY = 'allowUnverified';

/** Marks the one route an unverified user may call: GET /auth/me. */
export const AllowUnverified = () => SetMetadata(ALLOW_UNVERIFIED_KEY, true);

/** v1.0 Access rules: every route except GET /auth/me needs a verified email. */
@Injectable()
export class EmailVerifiedGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_UNVERIFIED_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (allowed) return true;

    const user = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>().user;
    if (!user?.emailVerified) throw new EmailNotVerifiedException();
    return true;
  }
}
