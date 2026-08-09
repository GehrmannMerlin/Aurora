import type { FastifyReply } from 'fastify';
import type { SessionCookieOptions } from '@aurora/platform-session';
import { appendSetCookie, readSessionCookie } from './session-cookie.js';

/**
 * Short-lived host-only HttpOnly intent cookie (accepted ADR-028 决定细节 6 /
 * ADR-030 决定细节 2). Email-verification / password-reset / invitation links
 * establish it on the GET and the CSRF-protected confirm commands authenticate
 * via it instead of the session cookie (spec §7.1 `intent` authLevel).
 *
 * Cookie value: `<kind>:<token>:<csrfSecret>` — the transient one-time token
 * (the only place the raw token lives after the mail link) plus the intent-bound
 * CSRF secret. Neither the token nor the secret ever enters logs, URLs (after
 * the GET redirect), the frontend Store or the error surface.
 */
export const INTENT_COOKIE_NAME = 'aurora_intent' as const;

export type IntentKind =
  | 'email_verification'
  | 'password_reset'
  | 'organization_invitation'
  | 'deletion_request'
  | 'deletion_cancel';

export interface IntentCookiePayload {
  readonly kind: IntentKind;
  /** Transient one-time intent token (a credential — never logged). */
  readonly token: string;
  /** Intent-bound CSRF secret returned once by the GET link response. */
  readonly csrfSecret: string;
}

/** Set the intent cookie with a short Max-Age (e.g. 2h). */
export function serializeIntentCookie(
  kind: IntentKind,
  token: string,
  csrfSecret: string,
  options: SessionCookieOptions,
  maxAgeMs: number,
): string {
  const parts = [`${INTENT_COOKIE_NAME}=${kind}:${token}:${csrfSecret}`, 'HttpOnly'];
  if (options.secure) parts.push('Secure');
  const sameSite = options.sameSite.charAt(0).toUpperCase() + options.sameSite.slice(1);
  parts.push(
    `SameSite=${sameSite}`,
    `Path=${options.path}`,
    `Max-Age=${String(Math.max(0, Math.floor(maxAgeMs / 1000)))}`,
  );
  return parts.join('; ');
}

/** Expire the intent cookie immediately. */
export function clearIntentCookie(options: SessionCookieOptions): string {
  return `${serializeIntentCookie('email_verification', '', '', options, 0)}; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

const INTENT_KINDS: readonly IntentKind[] = [
  'email_verification',
  'password_reset',
  'organization_invitation',
  'deletion_request',
  'deletion_cancel',
];

/**
 * Parse the `aurora_intent` cookie into a typed payload, or null when absent /
 * malformed. Tokens and CSRF secrets are base64url and never contain a colon,
 * so `kind:token:csrfSecret` is unambiguous.
 */
export function parseIntentCookie(header: string | undefined): IntentCookiePayload | null {
  const value = readSessionCookie(header, INTENT_COOKIE_NAME);
  if (value === undefined) return null;
  const parts = value.split(':');
  if (parts.length !== 3) return null;
  const [kind, token, csrfSecret] = parts as [string, string, string];
  if (!INTENT_KINDS.includes(kind as IntentKind)) return null;
  if (token.length === 0 || csrfSecret.length === 0) return null;
  return { kind: kind as IntentKind, token, csrfSecret };
}

/** Set the intent cookie on a reply via an explicit `Set-Cookie` header. */
export function setIntentCookie(
  reply: FastifyReply,
  kind: IntentKind,
  token: string,
  csrfSecret: string,
  options: SessionCookieOptions,
  maxAgeMs: number,
): void {
  appendSetCookie(reply, serializeIntentCookie(kind, token, csrfSecret, options, maxAgeMs));
}

/** Expire the intent cookie on a reply. */
export function clearIntentCookieOnReply(reply: FastifyReply, options: SessionCookieOptions): void {
  appendSetCookie(reply, clearIntentCookie(options));
}
