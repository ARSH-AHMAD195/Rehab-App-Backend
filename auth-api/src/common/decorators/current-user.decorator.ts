import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { Request } from 'express';
import { AuthUser } from '../../users/auth-user';
import { UnauthenticatedException } from '../api.exception';

/**
 * The caller, as resolved from the verified token. `/me` routes take the user
 * from here only, never from the request (v1.0 Access rules).
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    // Only reachable on a route missing FirebaseAuthGuard; still answer 401, never 500.
    if (!req.user) throw new UnauthenticatedException();
    return req.user;
  },
);
