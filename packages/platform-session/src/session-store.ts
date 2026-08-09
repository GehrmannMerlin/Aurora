import { createHash, randomBytes } from 'node:crypto';
import { createClient } from 'redis';

/**
 * Authentication level bound to a session (accepted ADR-028 §决定细节 6 and
 * ADR-030 决定细节 3). `restricted` covers the unverified but usable workspace
 * state; the exact upgrade path lives in the platform-api layer.
 */
export type SessionAuthLevel = 'pending_verification' | 'authenticated' | 'restricted';

/** Server-authoritative session payload stored in Redis (never the raw session id). */
export interface SessionPayload {
  readonly accountId: string;
  readonly authLevel: SessionAuthLevel;
  readonly expiresAt: string;
  readonly rotationDueAt: string | null;
  readonly csrfSecret: string;
}

/** A connected Redis-backed session store. */
export interface SessionStore {
  readonly client: ReturnType<typeof createClient>;
  readonly keyPrefix: string;
}

export interface CreateSessionStoreOptions {
  readonly url: string;
  readonly keyPrefix?: string;
}

export interface CreateSessionInput {
  readonly accountId: string;
  readonly authLevel: SessionAuthLevel;
  readonly now: Date;
  /** Idle lifetime in milliseconds (Redis key TTL, PX). */
  readonly idleMs: number;
  /** Absolute lifetime in milliseconds (checked against `expiresAt` on read). */
  readonly absoluteMs: number;
}

/** Rotation re-creates a session from scratch and accepts the same inputs as create. */
export type RotateSessionInput = CreateSessionInput;

const DEFAULT_KEY_PREFIX = 'aurora:platform:session' as const;

/** SHA-256 digest of the raw session id — the only value ever stored in Redis (ADR-030 决定细节 9). */
function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sessionKey(store: SessionStore, cookieValue: string): string {
  return `${store.keyPrefix}:${digest(cookieValue)}`;
}

function accountKey(store: SessionStore, accountId: string): string {
  return `${store.keyPrefix}:account:${accountId}`;
}

/**
 * Create a connected Redis-backed session store.
 *
 * The caller owns the returned client and is responsible for `client.quit()`
 * when shutting down. `client.connect()` failures (Redis unreachable) reject —
 * fail-closed 503 mapping is the platform-api layer's concern (PLT-03 Task 6).
 */
export async function createSessionStore(
  options: CreateSessionStoreOptions,
): Promise<SessionStore> {
  const client = createClient({ url: options.url });
  client.on('error', () => undefined);
  await client.connect();
  return { client, keyPrefix: options.keyPrefix ?? DEFAULT_KEY_PREFIX };
}

/** Result of creating/rotating a session — the raw cookie value plus the CSRF secret bound to it. */
export interface SessionToken {
  /** Raw opaque session id presented via the HttpOnly cookie (never stored in Redis). */
  readonly cookieValue: string;
  /** Absolute session expiry (checked on read). */
  readonly expiresAt: string;
  /** The session-bound CSRF secret (returned to the client via identityGetSession/login). */
  readonly csrfSecret: string;
}

/**
 * Create a new session. Returns the raw opaque cookie value — the only caller
 * that ever sees it is the response cookie setter; it is never stored in Redis
 * (only its SHA-256 digest is) and never logged. Also returns the session-bound
 * CSRF secret so the login/session handlers can surface it in the closed
 * contract response.
 */
export async function createSession(
  store: SessionStore,
  input: CreateSessionInput,
): Promise<SessionToken> {
  const cookieValue = randomBytes(32).toString('base64url');
  const expiresAt = new Date(input.now.getTime() + input.absoluteMs);
  const csrfSecret = randomBytes(32).toString('base64url');
  const payload: SessionPayload = {
    accountId: input.accountId,
    authLevel: input.authLevel,
    expiresAt: expiresAt.toISOString(),
    rotationDueAt: null,
    csrfSecret,
  };
  await store.client.set(sessionKey(store, cookieValue), JSON.stringify(payload), {
    PX: input.idleMs,
  });
  await store.client.sAdd(accountKey(store, input.accountId), digest(cookieValue));
  return { cookieValue, expiresAt: expiresAt.toISOString(), csrfSecret };
}

/** Look up a session by its raw cookie value; returns null for missing/expired/revoked. */
export async function getSession(
  store: SessionStore,
  cookieValue: string,
  now: Date,
): Promise<SessionPayload | null> {
  const raw = await store.client.get(sessionKey(store, cookieValue));
  if (raw === null) return null;
  const payload = JSON.parse(raw) as SessionPayload;
  if (Date.parse(payload.expiresAt) <= now.getTime()) return null;
  return payload;
}

/**
 * Rotate a session on login (ADR-030 决定细节 3): invalidate the old digest and
 * create a fresh session id under the new input. Returns null when the old
 * session is missing/expired/revoked.
 */
export async function rotateSession(
  store: SessionStore,
  cookieValue: string,
  now: Date,
  input: RotateSessionInput,
): Promise<SessionToken | null> {
  const existing = await getSession(store, cookieValue, now);
  if (existing === null) return null;
  await store.client.del(sessionKey(store, cookieValue));
  await store.client.sRem(accountKey(store, existing.accountId), digest(cookieValue));
  return createSession(store, input);
}

/** Immediately revoke the session identified by the raw cookie value. */
export async function revokeSession(store: SessionStore, cookieValue: string): Promise<void> {
  const key = sessionKey(store, cookieValue);
  const raw = await store.client.get(key);
  if (raw !== null) {
    const payload = JSON.parse(raw) as SessionPayload;
    await store.client.sRem(accountKey(store, payload.accountId), digest(cookieValue));
  }
  await store.client.del(key);
}

/** Revoke every session for an account (password reset / change-password / A5). */
export async function revokeAllAccountSessions(
  store: SessionStore,
  accountId: string,
): Promise<void> {
  const members = await store.client.sMembers(accountKey(store, accountId));
  if (members.length > 0) {
    await store.client.del(members.map((member) => `${store.keyPrefix}:${member}`));
  }
  await store.client.del(accountKey(store, accountId));
}
