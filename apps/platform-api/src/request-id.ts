import type { FastifyRequest } from 'fastify';

/** Produces a server-side opaque request identifier. */
export type PlatformRequestIdProvider = () => string;

/**
 * Default provider using crypto.randomUUID. Never derives from project, user,
 * Origin or time; never accepts a client-supplied value as authoritative.
 */
export function defaultRequestIdProvider(): string {
  return globalThis.crypto.randomUUID();
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Per-request opaque id established before any other onRequest hook. */
    platformRequestId: string;
  }
}

/**
 * onRequest hook that stamps `request.platformRequestId`. Registered first so
 * later hooks (session/csrf/origin) can use the id in their problems.
 */
export function requestIdHook(
  provider: PlatformRequestIdProvider,
): (request: FastifyRequest) => Promise<void> {
  return (request: FastifyRequest): Promise<void> => {
    request.platformRequestId = provider();
    return Promise.resolve();
  };
}
