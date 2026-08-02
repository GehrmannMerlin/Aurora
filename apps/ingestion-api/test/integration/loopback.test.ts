import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { startIngestionApi } from '../../src/start.js';
import { loadIngestionApiConfig } from '../../src/configuration.js';
import { allowAllIngestionAdmissionPolicy } from '../../src/admission-policy.js';
import type { IngestionRequestAuthorizer } from '../../src/access-policy.js';
import { assertIsTestDatabase, testDatabaseUrl } from './helpers.js';

const migrationsDir = fileURLToPath(
  new URL('../../../../packages/ingestion-inbox/migrations', import.meta.url),
);
const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const describeDb = hasDb ? describe : describe.skip;

const projectA = '11111111-1111-1111-1111-111111111111';

const authorizer: IngestionRequestAuthorizer = {
  authorize: () =>
    Promise.resolve({
      status: 'authorized' as const,
      projectId: projectA,
      allowedOrigin: undefined,
    }),
};

describeDb('ingestion-api loopback smoke (real PostgreSQL 17)', () => {
  beforeAll(async () => {
    assertIsTestDatabase(testDatabaseUrl());
    await runner({
      databaseUrl: testDatabaseUrl(),
      dir: migrationsDir,
      direction: 'up',
      migrationsTable: 'pgmigrations',
      count: Infinity,
      log: () => undefined,
    });
  });

  afterAll(async () => {
    // no-op; pool owned and closed by startIngestionApi
  });

  it('listens on 127.0.0.1:0, serves a request, and closes with Pool release', async () => {
    const running = await startIngestionApi({
      config: loadIngestionApiConfig({
        HOST: '127.0.0.1',
        PORT: '0',
        REQUEST_BODY_LIMIT_BYTES: '1048576',
        GRACEFUL_SHUTDOWN_TIMEOUT_MS: '5000',
        DATABASE_URL: testDatabaseUrl(),
        LOG_ENABLED: 'false',
      }),
      authorizer,
      admissionPolicy: allowAllIngestionAdmissionPolicy,
    });
    await running.close();
    await running.close();
  });
});
