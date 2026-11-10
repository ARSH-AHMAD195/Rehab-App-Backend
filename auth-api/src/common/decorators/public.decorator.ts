import { SetMetadata } from '@nestjs/common';

export const PUBLIC_KEY = 'isPublic';

/**
 * A route anyone may call without signing in: only the two login-code routes,
 * which is how a patient gets signed in in the first place. The per-IP rate
 * limit still applies, plus a tighter limit on the route itself.
 */
export const Public = () => SetMetadata(PUBLIC_KEY, true);
