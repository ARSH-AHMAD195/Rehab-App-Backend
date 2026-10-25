import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { Request } from 'express';
import { UnauthenticatedException } from '../api.exception';
import { AuthUser } from '../../users/users.service';

/**
 * The caller, as resolved from the verified token. The patient id always comes
 * from here, never from the request.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    // Only reachable if a route is ever excluded from the global auth guard;
    // a 401 in the usual error shape beats a bare 500.
    if (!req.user) throw new UnauthenticatedException();
    return req.user;
  },
);
