import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { ForbiddenRoleException } from '../api.exception';
import { Role } from '../constants';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AuthUser } from '../../users/auth-user';

/** 403 FORBIDDEN_ROLE: "The caller's role can't use this route" (v1.0 Errors). */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const allowed = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!allowed?.length) return true;

    const user = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>().user;
    if (!user || !allowed.includes(user.role)) throw new ForbiddenRoleException();
    return true;
  }
}
