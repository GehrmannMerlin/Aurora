import Fastify, { type FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { SessionCookieOptions, SessionStore } from '@aurora/platform-session';
import { sessionCookieOptions } from '@aurora/platform-session';
import type { EmailDeliveryPort } from '@aurora/platform-email';
import type { PlatformApiConfig } from './config.js';
import {
  defaultRequestIdProvider,
  requestIdHook,
  type PlatformRequestIdProvider,
} from './request-id.js';
import { applyCookieSessionPlugin } from './plugins/cookie-session.js';
import { applyCsrfPlugin } from './plugins/csrf.js';
import { applyOriginPlugin } from './plugins/origin.js';
import { handleGetSession } from './routes/session.js';
import { handleRegister } from './routes/register.js';
import { SESSION_COOKIE_NAME } from './session-cookie.js';
import type { PlatformApiRouteDependencies } from './route-deps.js';

export interface PlatformApiDependencies {
  readonly config: PlatformApiConfig;
  readonly pool: Pool;
  readonly sessionStore: SessionStore;
  readonly emailPort: EmailDeliveryPort;
  readonly requestIdProvider?: PlatformRequestIdProvider;
  readonly now?: () => Date;
}

/**
 * Build the Fastify platform application. Accepts external dependencies and
 * never creates or closes the caller-provided Pool or Redis session store
 * (mirrors apps/ingestion-api buildIngestionApi).
 *
 * Plugin order is load-bearing: request-id stamps `platformRequestId` first,
 * then cookie-session resolves the session (401/503 for protected ops), then
 * csrf and origin guard state-changing requests.
 */
export function buildPlatformApi(deps: PlatformApiDependencies): FastifyInstance {
  const requestIdProvider = deps.requestIdProvider ?? defaultRequestIdProvider;
  const now = deps.now ?? (() => new Date());
  const cookieOptions: SessionCookieOptions = sessionCookieOptions(deps.config.cookieSecure);
  const routeContext: PlatformApiRouteDependencies = {
    config: deps.config,
    pool: deps.pool,
    sessionStore: deps.sessionStore,
    emailPort: deps.emailPort,
    requestIdProvider,
    now,
    cookieOptions,
  };

  const app = Fastify({
    logger: deps.config.logEnabled,
    bodyLimit: 256 * 1024,
  });

  app.decorateRequest('platformRequestId', '');
  app.addHook('onRequest', requestIdHook(requestIdProvider));

  // Plugins are applied directly on the root app so their request decorations
  // and onRequest hooks are visible to every route (Fastify register would
  // encapsulate them away from the root-registered routes).
  applyCookieSessionPlugin(app, {
    store: deps.sessionStore,
    cookieName: SESSION_COOKIE_NAME,
    now,
  });
  applyCsrfPlugin(app);
  applyOriginPlugin(app, { appOrigins: deps.config.appOrigins });

  app.get('/api/platform/v1/health', async (_request, reply) => {
    void reply.code(200).send({ status: 'ok' });
  });

  app.get('/api/platform/v1/session', async (request, reply) => {
    await handleGetSession(request, reply, routeContext);
  });

  app.post('/api/platform/v1/auth/register', async (request, reply) => {
    await handleRegister(request, reply, routeContext);
  });

  app.setNotFoundHandler(async (request, reply) => {
    const requestId = request.platformRequestId || defaultRequestIdProvider();
    void reply.header('x-aurora-request-id', requestId).code(404).send({
      type: 'about:blank',
      title: 'Not found',
      status: 404,
      detail: 'The requested resource was not found.',
      code: 'not_found',
      requestId,
    });
  });

  return app;
}
