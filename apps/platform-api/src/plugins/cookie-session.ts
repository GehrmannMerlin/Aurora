import type { FastifyInstance, FastifyRequest } from 'fastify';
import { getSession, type SessionPayload, type SessionStore } from '@aurora/platform-session';
import { readSessionCookie, SESSION_COOKIE_NAME } from '../session-cookie.js';
import { parseIntentCookie, type IntentCookiePayload } from '../intent-cookie.js';
import { sendProblem } from '../error-mapper.js';
import { requestRouteInfo } from '../operations.js';

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
    /**
     * Parsed intent cookie (kind + transient token + CSRF secret) for `intent`
     * authLevel operations, or null when absent/malformed. Intent operations
     * authenticate via this cookie, not the session cookie (spec §7.1).
     */
    intentPayload: IntentCookiePayload | null;
  }
}

/**
 * Parse the `aurora_session` cookie and resolve the authoritative session
 * (accepted ADR-030 / ADR-028 决定细节 2/7), and parse the `aurora_intent`
 * cookie for intent-authLevel operations. Applied directly on the root app so
 * the request decorations and onRequest hook are visible to every route.
 *
 * Per-route auth:
 * - `session` operations require a valid session (unified 401 with a safe login
 *   target); Redis unavailability maps to 503 (fail closed) — never a spoofed
 *   401 and never a bypass of session checks.
 * - `intent` operations require a valid intent cookie (unified 401).
 * - `public` operations are not gated here.
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
  app.decorateRequest('intentPayload', null);

  app.addHook('onRequest', async (request: FastifyRequest, reply) => {
    const info = requestRouteInfo(request);

    const cookieValue = readSessionCookie(request.headers.cookie, cookieName);
    if (cookieValue === undefined) {
      request.sessionCookieValue = null;
      request.sessionPayload = null;
      request.sessionUnavailable = false;
    } else {
      try {
        const payload = await getSession(options.store, cookieValue, now());
        request.sessionCookieValue = cookieValue;
        request.sessionPayload = payload;
        request.sessionUnavailable = false;
      } catch {
        // Redis unreachable — fail closed (ADR-028 决定细节 7).
        request.sessionCookieValue = cookieValue;
        request.sessionPayload = null;
        request.sessionUnavailable = true;
      }
    }

    request.intentPayload = parseIntentCookie(request.headers.cookie);

    if (info === undefined) return;

    if (info.authLevel === 'session') {
      if (request.sessionUnavailable) {
        await sendProblem(
          reply,
          request.platformRequestId,
          503,
          'authority_unavailable',
          'Session authority is temporarily unavailable.',
        );
        return;
      }
      if (request.sessionPayload === null) {
        await sendProblem(
          reply,
          request.platformRequestId,
          401,
          'authentication',
          'Authentication is required.',
          {
            recoveryTarget: 'auth.login',
          },
        );
      }
      return;
    }

    if (info.authLevel === 'intent') {
      if (request.intentPayload === null) {
        await sendProblem(
          reply,
          request.platformRequestId,
          401,
          'authentication',
          'A valid verification intent is required.',
          {
            recoveryTarget: 'auth.login',
          },
        );
      }
    }
  });
}
