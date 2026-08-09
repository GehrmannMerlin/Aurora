import { Pool } from 'pg';
import { createSessionStore } from '@aurora/platform-session';
import { ConsoleEmailAdapter } from '@aurora/platform-email';
import type { EmailDeliveryPort } from '@aurora/platform-email';
import { buildPlatformApi, type PlatformApiDependencies } from './app.js';
import type { PlatformApiConfig } from './config.js';

export { buildPlatformApi, type PlatformApiDependencies } from './app.js';
export { loadPlatformApiConfig, type PlatformApiConfig } from './config.js';
export { defaultRequestIdProvider, type PlatformRequestIdProvider } from './request-id.js';
export {
  mapErrorToProblem,
  problem,
  sendProblem,
  type AuroraProblem,
  type AuroraProblemFieldError,
  type ProblemExtras,
} from './error-mapper.js';
export { SESSION_COOKIE_NAME, serializeSessionCookie } from './session-cookie.js';

export interface BuildPlatformServerOptions {
  readonly config: PlatformApiConfig;
}

export interface PlatformServerHandle {
  readonly app: ReturnType<typeof buildPlatformApi>;
  readonly pool: Pool;
  /** Close the Fastify app, then the owned Pool and Redis session store exactly once. */
  readonly close: () => Promise<void>;
}

/**
 * Composition root: create the PostgreSQL Pool it owns, connect the Redis
 * session store, build the email port and the Fastify app. On startup failure
 * the created Pool is rolled back. Production omits injected request/now
 * providers so real defaults are used.
 */
export async function buildPlatformServer(
  options: BuildPlatformServerOptions,
): Promise<PlatformServerHandle> {
  const pool = new Pool({ connectionString: options.config.databaseUrl });
  try {
    const sessionStore = await createSessionStore({ url: options.config.redisUrl });
    const emailPort: EmailDeliveryPort = new ConsoleEmailAdapter({
      mode: options.config.emailDeliveryMode,
    });
    const deps: PlatformApiDependencies = {
      config: options.config,
      pool,
      sessionStore,
      emailPort,
    };
    const app = buildPlatformApi(deps);
    let closed = false;
    app.addHook('onClose', async () => {
      if (closed) return;
      closed = true;
      await sessionStore.client.quit().catch(() => undefined);
      await pool.end().catch(() => undefined);
    });
    return {
      app,
      pool,
      close: async () => {
        await app.close();
      },
    };
  } catch (error) {
    await pool.end().catch(() => undefined);
    throw error;
  }
}
