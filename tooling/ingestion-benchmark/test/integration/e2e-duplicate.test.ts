import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createIsolatedSchema,
  applyMigrations,
  dropIsolatedSchema,
  schemaPool,
} from '../../src/schema.js';
import {
  createBenchmarkCredential,
  revokeBenchmarkCredential,
  createBenchmarkAuthorizer,
} from '../../src/credentials.js';
import { generateRunId } from '../../src/run-id.js';
import { benchmarkEventFor } from '../../src/event-factory.js';
import { assertIsTestDatabase, createTestPool, queryRow, testDatabaseUrl } from './helpers.js';
import {
  buildIngestionApi,
  allowAllIngestionAdmissionPolicy,
  loadIngestionApiConfig,
} from '@aurora/ingestion-api';
import type { FastifyInstance } from 'fastify';
import { CURRENT_PROTOCOL_VERSION } from '@aurora/event-schema';

const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const describeDb = hasDb ? describe : describe.skip;

describeDb('benchmark full-chain duplicate semantics (real PostgreSQL 17)', () => {
  let adminPool: Pool;
  let runId: string;
  let apiPool: Pool;
  let app: FastifyInstance;
  let credential: ReturnType<typeof createBenchmarkCredential> extends Promise<infer T> ? T : never;

  beforeAll(async () => {
    assertIsTestDatabase(testDatabaseUrl());
    adminPool = createTestPool();
    runId = generateRunId();
    await createIsolatedSchema(adminPool, runId);
    await applyMigrations(testDatabaseUrl(), runId);
    apiPool = schemaPool(testDatabaseUrl(), runId);
    credential = await createBenchmarkCredential(apiPool, runId);
    app = buildIngestionApi({
      config: loadIngestionApiConfig({
        HOST: '127.0.0.1',
        PORT: '0',
        REQUEST_BODY_LIMIT_BYTES: '1048576',
        GRACEFUL_SHUTDOWN_TIMEOUT_MS: '5000',
        DATABASE_URL: testDatabaseUrl(),
        LOG_ENABLED: 'false',
      }),
      pool: apiPool,
      authorizer: createBenchmarkAuthorizer(apiPool),
      admissionPolicy: allowAllIngestionAdmissionPolicy,
    });
    await app.listen({ host: '127.0.0.1', port: 0 });
  });

  afterAll(async () => {
    await app.close().catch(() => undefined);
    await revokeBenchmarkCredential(apiPool, credential).catch(() => undefined);
    await apiPool.end().catch(() => undefined);
    await dropIsolatedSchema(adminPool, runId).catch(() => undefined);
    await adminPool.end().catch(() => undefined);
  });

  async function postBatch(events: readonly unknown[]): Promise<{
    status: number;
    requestId: string | null;
    states: string[];
  }> {
    const body = { protocolVersion: CURRENT_PROTOCOL_VERSION, events };
    const address = app.server.address();
    const port =
      typeof address === 'object' && address !== null && 'port' in address ? address.port : 0;
    const response = await fetch(`http://127.0.0.1:${String(port)}/v1/batches`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-aurora-client-key': credential.clientKey,
        'x-aurora-environment': credential.environment,
        origin: credential.origin,
      },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    let states: string[];
    try {
      const parsed = JSON.parse(text) as { perEventResults?: readonly { state?: string }[] };
      states = (parsed.perEventResults ?? []).map((e) => e.state ?? 'unknown');
    } catch {
      states = [];
    }
    return {
      status: response.status,
      requestId: response.headers.get('x-aurora-request-id'),
      states,
    };
  }

  it('re-sending the same projectId/eventId yields duplicate_accepted without new Inbox rows', async () => {
    const event = benchmarkEventFor(runId, 1, Date.now());
    const first = await postBatch([event]);
    expect(first.status).toBe(200);
    expect(first.requestId).toBeTruthy();
    expect(first.states).toEqual(['accepted']);

    const second = await postBatch([event]);
    expect(second.status).toBe(200);
    expect(second.requestId).toBeTruthy();
    expect(second.states).toEqual(['duplicate_accepted']);

    const row = await queryRow<{ n: number }>(
      apiPool,
      'SELECT count(*)::int AS n FROM event_inbox WHERE project_id = $1 AND event_id = $2',
      [credential.projectId, event.eventId],
    );
    expect(row?.n).toBe(1);
  });

  it('every HTTP response carries a request id and no unexpected 4xx/5xx', async () => {
    const event = benchmarkEventFor(runId, 2, Date.now());
    const response = await postBatch([event]);
    expect(response.status).toBe(200);
    expect(response.requestId).toBeTruthy();
  });
});
