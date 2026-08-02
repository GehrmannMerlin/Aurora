import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { runner } from 'node-pg-migrate';
import type { FastifyInstance } from 'fastify';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { buildIngestionApi } from '../../src/app.js';
import { loadIngestionApiConfig } from '../../src/configuration.js';
import { allowAllIngestionAdmissionPolicy } from '../../src/admission-policy.js';
import type { IngestionRequestAuthorizer } from '../../src/access-policy.js';
import { assertIsTestDatabase, createTestPool, queryRows, testDatabaseUrl } from './helpers.js';

const migrationsDir = fileURLToPath(
  new URL('../../../../packages/ingestion-inbox/migrations', import.meta.url),
);
const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const describeDb = hasDb ? describe : describe.skip;

const projectA = '11111111-1111-1111-1111-111111111111';
const projectB = '22222222-2222-2222-2222-222222222222';

interface CountRow {
  n: number;
}

function makeAuthorizer(projectId: string): IngestionRequestAuthorizer {
  return {
    authorize: () =>
      Promise.resolve({ status: 'authorized' as const, projectId, allowedOrigin: undefined }),
  };
}

function validBatch(eventId: string): unknown {
  return {
    protocolVersion: 1,
    events: [
      {
        protocolVersion: 1,
        eventId,
        eventType: 'error',
        occurredAt: 1_800_000_000_000,
        body: {},
      },
    ],
  };
}

describeDb('ingestion-api real PostgreSQL 17 integration', () => {
  let pool: Awaited<ReturnType<typeof createTestPool>>;

  beforeAll(async () => {
    assertIsTestDatabase(testDatabaseUrl());
    pool = createTestPool();
    await runner({
      databaseUrl: testDatabaseUrl(),
      dir: migrationsDir,
      direction: 'up',
      migrationsTable: 'pgmigrations',
      count: Infinity,
      log: () => undefined,
    });
    await pool.query('DELETE FROM event_inbox');
  });

  afterAll(async () => {
    await pool.end();
  });

  function buildApp(projectId: string): FastifyInstance {
    return buildIngestionApi({
      config: loadIngestionApiConfig({
        HOST: '127.0.0.1',
        PORT: '0',
        REQUEST_BODY_LIMIT_BYTES: '1048576',
        GRACEFUL_SHUTDOWN_TIMEOUT_MS: '5000',
        DATABASE_URL: testDatabaseUrl(),
        LOG_ENABLED: 'false',
      }),
      pool,
      authorizer: makeAuthorizer(projectId),
      admissionPolicy: allowAllIngestionAdmissionPolicy,
    });
  }

  function post(app: FastifyInstance, payload: unknown) {
    return app.inject({
      method: 'POST',
      url: '/v1/batches',
      headers: {
        'content-type': 'application/json',
        'x-aurora-client-key': 'test-key',
        'x-aurora-environment': 'production',
      },
      payload: JSON.stringify(payload),
    });
  }

  it('persists an accepted event into the Inbox after an HTTP 200', async () => {
    const app = buildApp(projectA);
    const response = await post(app, validBatch('evt-pg-http-001'));
    expect(response.statusCode).toBe(200);
    const rows = await queryRows<CountRow>(
      pool,
      'SELECT count(*)::int AS n FROM event_inbox WHERE project_id = $1 AND event_id = $2',
      [projectA, 'evt-pg-http-001'],
    );
    expect(rows[0]?.n).toBe(1);
    await app.close();
  });

  it('returns duplicate_accepted without adding a row for a repeated event', async () => {
    const app = buildApp(projectA);
    await post(app, validBatch('evt-pg-http-002'));
    const response = await post(app, validBatch('evt-pg-http-002'));
    expect(response.statusCode).toBe(200);
    const body: { perEventResults?: readonly { state?: string }[] } = response.json();
    expect(body.perEventResults?.[0]?.state).toBe('duplicate_accepted');
    const rows = await queryRows<CountRow>(
      pool,
      'SELECT count(*)::int AS n FROM event_inbox WHERE project_id = $1 AND event_id = $2',
      [projectA, 'evt-pg-http-002'],
    );
    expect(rows[0]?.n).toBe(1);
    await app.close();
  });

  it('accepts the same eventId under different projects', async () => {
    const appA = buildApp(projectA);
    const appB = buildApp(projectB);
    await post(appA, validBatch('evt-pg-http-003'));
    const responseB = await post(appB, validBatch('evt-pg-http-003'));
    expect(responseB.statusCode).toBe(200);
    const rows = await queryRows<CountRow>(
      pool,
      'SELECT count(*)::int AS n FROM event_inbox WHERE event_id = $1',
      ['evt-pg-http-003'],
    );
    expect(rows[0]?.n).toBe(2);
    await appA.close();
    await appB.close();
  });

  it('returns 503 without accepted when the database is unreachable', async () => {
    // Use a pool whose search_path points at a non-existent schema so the
    // INSERT statement fails without destroying the shared test schema.
    const badPool = new Pool({
      connectionString: testDatabaseUrl(),
      options: '-c search_path=aurora_does_not_exist',
    });
    const app = buildIngestionApi({
      config: loadIngestionApiConfig({
        HOST: '127.0.0.1',
        PORT: '0',
        REQUEST_BODY_LIMIT_BYTES: '1048576',
        GRACEFUL_SHUTDOWN_TIMEOUT_MS: '5000',
        DATABASE_URL: testDatabaseUrl(),
        LOG_ENABLED: 'false',
      }),
      pool: badPool,
      authorizer: makeAuthorizer(projectA),
      admissionPolicy: allowAllIngestionAdmissionPolicy,
    });
    const response = await post(app, validBatch('evt-pg-http-004'));
    expect(response.statusCode).toBe(503);
    expect(JSON.stringify(response.json())).not.toContain('accepted');
    await badPool.end();
    await app.close();
  });
});
