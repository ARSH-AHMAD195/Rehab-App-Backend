import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { Request } from 'express';
import { AuthUser } from '../../users/users.service';

/**
 * The caller, as resolved from the verified token.
 *
 * v1.1 Save flow step 2: "Take the patient ID from the token, never from the
 * request." Controllers get the patient id from here only.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    if (!req.user) throw new Error('CurrentUser used on a route without FirebaseAuthGuard');
    return req.user;
  },
);
