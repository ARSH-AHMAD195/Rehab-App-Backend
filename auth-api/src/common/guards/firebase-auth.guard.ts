import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { UnauthenticatedException } from '../api.exception';
import { IDENTITY_PROVIDER, IdentityProvider } from '../../identity/identity-provider';
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
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
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
