import Fastify, { type FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { IngestionApiConfig } from './configuration.js';
import type { IngestionRequestAuthorizer } from './access-policy.js';
import type { IngestionAdmissionPolicy } from './admission-policy.js';
import { defaultRequestIdProvider, type IngestionRequestIdProvider } from './request-id.js';
import {
  handlePostBatches,
  validateOptionsRequest,
  type PersistIngestionBatchPort,
} from './routes/ingestion-batches.js';
import { persistBatch as defaultPersist } from '@aurora/ingestion-inbox';

export interface IngestionApiDependencies {
  readonly config: IngestionApiConfig;
  readonly pool: Pool;
  readonly authorizer: IngestionRequestAuthorizer;
  readonly admissionPolicy: IngestionAdmissionPolicy;
  readonly requestIdProvider?: IngestionRequestIdProvider;
  readonly persist?: PersistIngestionBatchPort;
}

/**
 * Build the Fastify ingestion application. Accepts external dependencies and
 * never creates or closes the caller-provided Pool.
 */
export function buildIngestionApi(deps: IngestionApiDependencies): FastifyInstance {
  const requestIdProvider = deps.requestIdProvider ?? defaultRequestIdProvider;
  const persist = deps.persist ?? {
    persistBatch: (pool, input) => defaultPersist(pool, input),
  };
  const routeDeps = {
    pool: deps.pool,
    requestIdProvider,
    authorizer: deps.authorizer,
    admissionPolicy: deps.admissionPolicy,
    persist,
  };

  const app = Fastify({
    logger: deps.config.logEnabled,
    bodyLimit: deps.config.requestBodyLimitBytes,
  });

  app.options('/v1/batches', async (request, reply) => {
    const { origin, allowed } = validateOptionsRequest(request);
    if (!allowed || origin === null) {
      await reply.code(400).send();
      return;
    }
    void reply
      .code(204)
      .header('Access-Control-Allow-Origin', origin)
      .header('Vary', 'Origin')
      .header('Access-Control-Allow-Methods', 'POST, OPTIONS')
      .header(
        'Access-Control-Allow-Headers',
        'Content-Type, X-Aurora-Client-Key, X-Aurora-Environment',
      )
      .header('Access-Control-Expose-Headers', 'X-Aurora-Request-Id, Retry-After')
      .send();
  });

  app.post('/v1/batches', async (request, reply) => {
    await handlePostBatches(request, reply, routeDeps);
  });

  app.setNotFoundHandler((_request, reply) => {
    void reply.code(404).send({ message: 'not found' });
  });

  return app;
}
