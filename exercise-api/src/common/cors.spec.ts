import { DEFAULT_CORS_ORIGINS, corsOptions, parseCorsOrigins } from './cors';

describe('parseCorsOrigins', () => {
  it('allows only the local dev server when nothing is set', () => {
    expect(parseCorsOrigins(undefined)).toEqual(DEFAULT_CORS_ORIGINS);
    expect(parseCorsOrigins('  ,  ')).toEqual(DEFAULT_CORS_ORIGINS);
  });

  it('reads a comma-separated list, ignoring spaces and trailing slashes', () => {
    expect(parseCorsOrigins(' https://ffs-app.vercel.app/ , http://localhost:5173')).toEqual([
      'https://ffs-app.vercel.app',
      'http://localhost:5173',
    ]);
  });
});

describe('corsOptions', () => {
  it('lets the browser send the login token and an Idempotency-Key', () => {
    const options = corsOptions(undefined);
    expect(options.allowedHeaders).toEqual(expect.arrayContaining(['Authorization', 'Idempotency-Key']));
    expect(options.exposedHeaders).toContain('X-Request-Id');
  });
});
