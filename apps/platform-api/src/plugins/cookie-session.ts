import type { FastifyInstance, FastifyRequest } from 'fastify';
import { getSession, type SessionPayload, type SessionStore } from '@aurora/platform-session';
import { readSessionCookie, SESSION_COOKIE_NAME } from '../session-cookie.js';
import { sendProblem } from '../error-mapper.js';
import { routeInfo } from '../operations.js';

export interface CookieSessionPluginOptions {
  readonly store: SessionStore;
  readonly cookieName?: string;
  readonly now?: () => Date;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Raw session cookie value (a credential) — only set when a cookie was sent. */
    sessionCookieValue: string | null;
    /** Resolved session payload, or null when missing/expired/revoked. */
    sessionPayload: SessionPayload | null;
    /** True when the session authority (Redis) was unreachable — fail closed. */
    sessionUnavailable: boolean;
  }
}

/**
 * Parse the `aurora_session` cookie and resolve the authoritative session
 * (accepted ADR-030 / ADR-028 决定细节 2/7). Applied directly on the root app so
 * the request decoration and onRequest hook are visible to every route. On
 * protected operations a missing/expired/revoked session maps to a unified 401
 * with a safe login target; Redis unavailability maps to 503 (fail closed) —
 * never a spoofed 401 and never a bypass of session checks.
 */
export function applyCookieSessionPlugin(
  app: FastifyInstance,
  options: CookieSessionPluginOptions,
): void {
  const cookieName = options.cookieName ?? SESSION_COOKIE_NAME;
  const now = options.now ?? (() => new Date());

  app.decorateRequest('sessionCookieValue', null);
  app.decorateRequest('sessionPayload', null);
  app.decorateRequest('sessionUnavailable', false);

  app.addHook('onRequest', async (request: FastifyRequest, reply) => {
    const info = routeInfo(request.method, request.url);
    const protectedRoute = info !== undefined && info.authLevel !== 'public';

    const cookieValue = readSessionCookie(request.headers.cookie, cookieName);
    if (cookieValue === undefined) {
      request.sessionCookieValue = null;
      request.sessionPayload = null;
      request.sessionUnavailable = false;
      if (protectedRoute) {
        await sendProblem(reply, request.platformRequestId, 401, 'authentication', 'Authentication is required.', {
          recoveryTarget: 'auth.login',
        });
      }
      return;
    }

    try {
      const payload = await getSession(options.store, cookieValue, now());
      request.sessionCookieValue = cookieValue;
      request.sessionPayload = payload;
      request.sessionUnavailable = false;
      if (protectedRoute && payload === null) {
        await sendProblem(reply, request.platformRequestId, 401, 'authentication', 'Authentication is required.', {
          recoveryTarget: 'auth.login',
        });
      }
    } catch {
      // Redis unreachable — fail closed (ADR-028 决定细节 7).
      request.sessionCookieValue = cookieValue;
      request.sessionPayload = null;
      request.sessionUnavailable = true;
      if (protectedRoute) {
        await sendProblem(reply, request.platformRequestId, 503, 'authority_unavailable', 'Session authority is temporarily unavailable.');
      }
    }
  });
}
