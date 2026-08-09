import type { FastifyInstance, FastifyRequest } from 'fastify';
import { sendProblem } from '../error-mapper.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export interface OriginPluginOptions {
  readonly appOrigins: readonly string[];
}

/**
 * Explicit Origin / Fetch-Metadata check on state-changing requests (accepted
 * ADR-026 决定细节 3, no `@fastify/cors`): when an Origin header is present it
 * must be in the explicit allow-list; best-effort `Sec-Fetch-Site: cross-site`
 * requests are rejected. Non-browser requests without an Origin header are
 * permitted (defense-in-depth behind the CSRF token). Applied directly on the
 * root app so the onRequest hook guards every route.
 */
export function applyOriginPlugin(app: FastifyInstance, options: OriginPluginOptions): void {
  const allowedOrigins = new Set(options.appOrigins);
  app.addHook('onRequest', async (request: FastifyRequest, reply) => {
    if (SAFE_METHODS.has(request.method)) return;

    const origin = request.headers.origin;
    if (
      typeof origin === 'string' &&
      origin.length > 0 &&
      origin !== 'null' &&
      !allowedOrigins.has(origin)
    ) {
      await sendProblem(
        reply,
        request.platformRequestId,
        403,
        'authorization',
        'Request origin is not allowed.',
      );
      return;
    }

    const fetchSite = request.headers['sec-fetch-site'];
    if (typeof fetchSite === 'string' && fetchSite === 'cross-site') {
      await sendProblem(
        reply,
        request.platformRequestId,
        403,
        'authorization',
        'Cross-site request is not allowed.',
      );
      return;
    }
  });
}
