import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { EmailNotVerifiedException } from '../api.exception';
import { LOGIN_METHODS, ROLES } from '../constants';
import { PUBLIC_KEY } from '../decorators/public.decorator';
import { AuthUser } from '../../users/auth-user';

const ALLOW_UNVERIFIED_KEY = 'allowUnverified';

/** Marks the one route an unverified user may call: GET /auth/me. */
export const AllowUnverified = () => SetMetadata(ALLOW_UNVERIFIED_KEY, true);

/**
 * v1.0 Access rules: every route except GET /auth/me needs a verified email.
 *
 * A patient who signed in with a doctor-issued login code has no email to
 * verify: the correct code, which their own doctor handed them, is the proof
 * instead. That only counts for patients, the only role codes are made for.
 */
export function isVerified(user: Pick<AuthUser, 'emailVerified' | 'loginMethod' | 'role'>): boolean {
  return user.emailVerified || (user.loginMethod === LOGIN_METHODS.LOGIN_CODE && user.role === ROLES.PATIENT);
}

@Injectable()
export class EmailVerifiedGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;
    if (this.reflector.getAllAndOverride<boolean>(ALLOW_UNVERIFIED_KEY, targets)) return true;

    const user = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>().user;
    if (!user || !isVerified(user)) throw new EmailNotVerifiedException();
    return true;
  }
}
