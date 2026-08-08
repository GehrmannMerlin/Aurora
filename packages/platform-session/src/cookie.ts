/**
 * Session cookie attributes (accepted ADR-030 决定细节 2): `HttpOnly` +
 * `Secure` + `SameSite=Lax`, host-only (no `Domain`), `Path=/`. The raw cookie
 * value is a credential — it must never enter JS, localStorage, logs or URLs.
 */
export interface SessionCookieOptions {
  readonly httpOnly: true;
  readonly secure: boolean;
  readonly sameSite: 'lax';
  readonly path: '/';
}

export function sessionCookieOptions(secure: boolean): SessionCookieOptions {
  return { httpOnly: true, secure, sameSite: 'lax', path: '/' };
}
