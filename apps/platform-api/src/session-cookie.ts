import type { FastifyReply } from 'fastify';
import type { SessionCookieOptions } from '@aurora/platform-session';

/**
 * Host-only HttpOnly session cookie (accepted ADR-030 决定细节 2): no `Domain`,
 * `Path=/`, `HttpOnly`, `Secure` per config and `SameSite=Lax`.
 */
export const SESSION_COOKIE_NAME = 'aurora_session' as const;

export function serializeSessionCookie(
  name: string,
  value: string,
  options: SessionCookieOptions,
): string {
  const parts = [`${name}=${value}`, 'HttpOnly'];
  if (options.secure) parts.push('Secure');
  const sameSite = options.sameSite.charAt(0).toUpperCase() + options.sameSite.slice(1);
  parts.push(`SameSite=${sameSite}`, `Path=${options.path}`);
  return parts.join('; ');
}

/** Set the session cookie on a reply via an explicit `Set-Cookie` header. */
export function setSessionCookie(
  reply: FastifyReply,
  value: string,
  options: SessionCookieOptions,
): void {
  void reply.header('set-cookie', serializeSessionCookie(SESSION_COOKIE_NAME, value, options));
}

/** Expire the session cookie immediately (logout / revocation). */
export function clearSessionCookie(
  reply: FastifyReply,
  options: SessionCookieOptions,
): void {
  const expired = `${serializeSessionCookie(SESSION_COOKIE_NAME, '', options)}; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  void reply.header('set-cookie', expired);
}

/**
 * Minimal cookie parser: return the named session cookie value, or undefined
 * when absent. The raw cookie value is a credential — it is never logged.
 */
export function readSessionCookie(
  header: string | undefined,
  name: string = SESSION_COOKIE_NAME,
): string | undefined {
  if (header === undefined) return undefined;
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    const equals = trimmed.indexOf('=');
    if (equals < 0) continue;
    const key = trimmed.slice(0, equals).trim();
    const value = trimmed.slice(equals + 1).trim();
    if (key === name && value.length > 0) return value;
  }
  return undefined;
}
