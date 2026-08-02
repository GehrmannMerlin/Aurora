import { Pool } from 'pg';
import { buildIngestionApi } from './app.js';
import type { IngestionApiConfig } from './configuration.js';
import type { IngestionRequestAuthorizer } from './access-policy.js';
import type { IngestionAdmissionPolicy } from './admission-policy.js';
import { defaultRequestIdProvider } from './request-id.js';
import { createPostgresRequestAuthorizer } from './postgres-request-authorizer.js';

export interface StartIngestionApiOptions {
  readonly config: IngestionApiConfig;
  /** Optional for tests; when omitted the composition root builds the real credential-backed authorizer over the owned Pool. */
  readonly authorizer?: IngestionRequestAuthorizer;
  readonly admissionPolicy: IngestionAdmissionPolicy;
}

export interface RunningIngestionApi {
  readonly close: () => Promise<void>;
}

/**
 * Composition root: creates the PostgreSQL Pool it owns, builds the app, starts
 * listening, and registers shutdown so the Pool is closed exactly once after
 * Fastify stops accepting and drains in-flight requests. On startup failure it
 * rolls back by closing the created Pool. Production omits `authorizer` so the
 * real credential-backed authorizer is constructed over the owned Pool.
 */
export async function startIngestionApi(
  options: StartIngestionApiOptions,
): Promise<RunningIngestionApi> {
  const pool = new Pool({ connectionString: options.config.databaseUrl });
  let closed = false;
  try {
    const authorizer =
      options.authorizer ?? createPostgresRequestAuthorizer(pool);
    const app = buildIngestionApi({
      config: options.config,
      pool,
      authorizer,
      admissionPolicy: options.admissionPolicy,
      requestIdProvider: defaultRequestIdProvider,
    });
    app.addHook('onClose', async () => {
      if (!closed) {
        closed = true;
        await pool.end();
      }
    });
    await app.listen({ host: options.config.host, port: options.config.port });
    return {
      close: async () => {
        await app.close();
      },
    };
  } catch (error) {
    await pool.end().catch(() => undefined);
    throw error;
  }
}
