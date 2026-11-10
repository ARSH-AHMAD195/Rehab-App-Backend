import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { UnauthenticatedException } from '../api.exception';
import { LOGIN_METHODS } from '../constants';
import { PUBLIC_KEY } from '../decorators/public.decorator';
import { CUSTOM_SIGN_IN, IDENTITY_PROVIDER, IdentityProvider } from '../../identity/identity-provider';
import { AuthUser } from '../../users/auth-user';
import { UsersService } from '../../users/users.service';

/**
 * v1.0 Access rules, Identity: every route needs a Firebase ID token. The
 * caller is the active `users` profile with that token's uid; a valid token
 * with no active profile gets 401, because without a profile there is no role.
 */
@Injectable()
export class FirebaseAuthGuard implements CanActivate {
  constructor(
    @Inject(IDENTITY_PROVIDER) private readonly identity: IdentityProvider,
    private readonly users: UsersService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()])) return true;

    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const token = this.extractBearer(req.headers.authorization);

    const verified = await this.identity.verifyToken(token);
    const user = await this.users.findActiveByFirebaseUid(verified.uid);
    if (!user) throw new UnauthenticatedException('No active user profile for this token');

    // Keep the stored copy in step with Firebase, for the lists that show it.
    if (user.emailVerified !== verified.emailVerified) {
      await this.users.model.updateOne({ _id: user._id }, { $set: { emailVerified: verified.emailVerified } });
    }

    req.user = {
      id: String(user._id),
      firebaseUid: user.firebaseUid,
      role: user.role,
      name: user.name,
      email: user.email ?? verified.email,
      emailVerified: verified.emailVerified,
      loginMethod: verified.signInProvider === CUSTOM_SIGN_IN ? LOGIN_METHODS.LOGIN_CODE : LOGIN_METHODS.PASSWORD,
      timeZone: user.timeZone ?? null,
      doctorIds: user.doctorIds.map(String),
    };
    return true;
  }

  private extractBearer(header?: string): string {
    const [scheme, value] = (header ?? '').split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !value) {
      throw new UnauthenticatedException('Authorization: Bearer <Firebase ID token> required');
    }
    return value.trim();
  }
}
