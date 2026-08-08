import type { FastifyInstance, FastifyRequest } from 'fastify';
import { verifyCsrf } from '@aurora/platform-session';
import { sendProblem } from '../error-mapper.js';
import { routeInfo } from '../operations.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Synchronous CSRF verification (accepted ADR-030 决定细节 5 / ADR-028 决定细节
 * 5): on CSRF-protected state-changing operations, the `X-Aurora-CSRF` header
 * must match the bound secret in constant time.
 * - `session` operations bind the secret to the session (Redis).
 * - `intent` operations bind the secret to the short-lived intent cookie.
 * Public operations with no session (e.g. register/login/request-reset) skip.
 * Failure → 403. Applied directly on the root app so the onRequest hook guards
 * every route.
 */
export function applyCsrfPlugin(app: FastifyInstance): void {
  app.addHook('onRequest', async (request: FastifyRequest, reply) => {
    if (SAFE_METHODS.has(request.method)) return;
    const info = routeInfo(request.method, request.url);
    if (info === undefined || !info.csrf) return;

    let secret: string;
    if (info.authLevel === 'intent') {
      if (request.intentPayload === null) {
        await sendProblem(reply, request.platformRequestId, 401, 'authentication', 'Authentication is required.', {
          recoveryTarget: 'auth.login',
        });
        return;
      }
      secret = request.intentPayload.csrfSecret;
    } else if (info.authLevel === 'session') {
      if (request.sessionUnavailable) {
        await sendProblem(reply, request.platformRequestId, 503, 'authority_unavailable', 'Session authority is temporarily unavailable.');
        return;
      }
      if (request.sessionPayload === null) {
        await sendProblem(reply, request.platformRequestId, 401, 'authentication', 'Authentication is required.', {
          recoveryTarget: 'auth.login',
        });
        return;
      }
      secret = request.sessionPayload.csrfSecret;
    } else {
      // Public operations are not CSRF-bound (no session material to bind).
      return;
    }

    const token = request.headers['x-aurora-csrf'];
    if (typeof token !== 'string' || !verifyCsrf(secret, token)) {
      await sendProblem(reply, request.platformRequestId, 403, 'authorization', 'CSRF token verification failed.');
    }
  });
}
