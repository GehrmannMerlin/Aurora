/**
 * @aurora/platform-session — Aurora platform session data layer.
 *
 * Redis-authoritative sessions (accepted ADR-030): an opaque 32-byte session id
 * is presented to the browser via a host-only `HttpOnly` cookie; Redis stores
 * ONLY the SHA-256 digest of that id (决定细节 9), never the raw value. The raw
 * cookie value is returned only by `createSession`/`rotateSession` to the
 * response cookie setter and is never logged or persisted in plain form.
 *
 * Also provides the session-bound CSRF secret helpers and the cookie attribute
 * builder consumed by the platform-api layer (PLT-03 Task 6).
 *
 * This is a data-layer package: it depends only on the external `redis`
 * package and `node:crypto`. It never imports or declares
 * `@aurora/platform-contract` (contract layer) per Workspace Policy
 * (`data → {protocol}` only).
 */
export const PLATFORM_SESSION_PACKAGE = '@aurora/platform-session' as const;

export const PLATFORM_SESSION_VERSION = '0.0.0' as const;

export {
  createSession,
  createSessionStore,
  getSession,
  revokeAllAccountSessions,
  revokeSession,
  rotateSession,
  type CreateSessionInput,
  type CreateSessionStoreOptions,
  type RotateSessionInput,
  type SessionAuthLevel,
  type SessionPayload,
  type SessionStore,
  type SessionToken,
} from './session-store.js';

export { createCsrfSecret, verifyCsrf } from './csrf.js';

export { sessionCookieOptions, type SessionCookieOptions } from './cookie.js';
