import { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

/** The local Vite dev server, allowed when CORS_ORIGINS isn't set. */
export const DEFAULT_CORS_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173','https://rehab-app-frontend-navy.vercel.app'];

/**
 * Which websites may call this API from a browser. CORS_ORIGINS is a
 * comma-separated list, e.g. "https://ffs-app.vercel.app,http://localhost:5173".
 * The phone app isn't a website and doesn't need to be listed.
 */
export function parseCorsOrigins(value: string | undefined): string[] {
  const origins = (value ?? '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  return origins.length ? origins : DEFAULT_CORS_ORIGINS;
}

export function corsOptions(value: string | undefined): CorsOptions {
  return {
    origin: parseCorsOrigins(value),
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Idempotency-Key'],
    // So the web app can read them: the request id for bug reports, and how long to wait after a 429.
    exposedHeaders: ['X-Request-Id', 'Retry-After'],
    // Browsers may reuse a preflight answer for 10 minutes.
    maxAge: 600,
  };
}
