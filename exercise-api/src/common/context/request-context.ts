import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  requestId: string;
  route?: string;
}

/**
 * Carries the request ID (optional X-Request-Id, created when missing,
 * returned on every response and stored in audit records) to services that are
 * too deep to be handed the request.
 */
export const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export function currentRequestId(): string | undefined {
  return requestContextStorage.getStore()?.requestId;
}

export function currentRoute(): string | undefined {
  return requestContextStorage.getStore()?.route;
}
