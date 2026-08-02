/** Produces a server-side opaque request identifier. */
export type IngestionRequestIdProvider = () => string;

/**
 * Default provider using crypto.randomUUID. Never derives from project, user,
 * Origin, or time; never accepts a client-supplied value as authoritative.
 */
export function defaultRequestIdProvider(): string {
  return globalThis.crypto.randomUUID();
}
