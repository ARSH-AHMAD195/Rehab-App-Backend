import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { Request } from 'express';
import { AuthUser } from '../../users/auth-user';

/**
 * The caller, as resolved from the verified token. `/me` routes take the user
 * from here only, never from the request (v1.0 Access rules).
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    if (!req.user) throw new Error('CurrentUser used on a route without FirebaseAuthGuard');
    return req.user;
  },
);
