import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { UnauthenticatedException } from '../api.exception';
import { TOKEN_VERIFIER, TokenVerifier } from '../../auth/token-verifier';
import { AuthUser, UsersService } from '../../users/users.service';

/**
 * Every route needs `Authorization: Bearer <Firebase ID token>`.
 * 401 UNAUTHENTICATED when the token is missing, invalid or expired, or when
 * the token is valid but no active profile exists for that uid - without a
 * profile the caller has no role, so no route can be served.
 */
@Injectable()
export class FirebaseAuthGuard implements CanActivate {
  constructor(
    @Inject(TOKEN_VERIFIER) private readonly verifier: TokenVerifier,
    private readonly users: UsersService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const token = this.extractBearer(req.headers.authorization);

    const { uid } = await this.verifier.verify(token);
    const user = await this.users.findByFirebaseUid(uid);
    if (!user) throw new UnauthenticatedException('No active user profile for this token');

    req.user = user;
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
