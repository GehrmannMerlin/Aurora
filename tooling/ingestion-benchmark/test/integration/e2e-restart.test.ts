import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createIsolatedSchema,
  applyMigrations,
  dropIsolatedSchema,
  schemaPool,
} from '../../src/schema.js';
import { createBenchmarkCredential, revokeBenchmarkCredential } from '../../src/credentials.js';
import { generateRunId } from '../../src/run-id.js';
import { benchmarkEventFor } from '../../src/event-factory.js';
import { startBenchmarkWorker } from '../../src/worker-harness.js';
import type { IngestionEventProcessor } from '@aurora/ingestion-worker';
import { assertIsTestDatabase, createTestPool, queryRow, testDatabaseUrl } from './helpers.js';

const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const describeDb = hasDb ? describe : describe.skip;

const BASE_SCENARIO = {
  name: 'restart',
  warmupEvents: 0,
  measuredEvents: 5,
  batchSize: 1,
  httpConcurrency: 1,
  workerConcurrency: 1,
  claimBatchSize: 5,
  processorDelayMs: 0,
  maxRunDurationMs: 120000,
  apiPoolMax: 2,
  workerPoolMax: 2,
} as const;

/** A processor that never settles; used to hold a lease past its expiry. */
const blockingProcessor: IngestionEventProcessor = {
  process: () => new Promise(() => undefined),
};

const processedProcessor: IngestionEventProcessor = {
  process: () => Promise.resolve({ outcome: 'processed' }),
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describeDb('benchmark worker restart / lease recovery (real PostgreSQL 17)', () => {
  let adminPool: Pool;
  let runId: string;
  let workerPool: Pool;
  let credential: Awaited<ReturnType<typeof createBenchmarkCredential>>;

  beforeAll(async () => {
    assertIsTestDatabase(testDatabaseUrl());
    adminPool = createTestPool();
    runId = generateRunId();
    await createIsolatedSchema(adminPool, runId);
    await applyMigrations(testDatabaseUrl(), runId);
    workerPool = schemaPool(testDatabaseUrl(), runId);
    credential = await createBenchmarkCredential(workerPool, runId);
  });

  afterAll(async () => {
    await revokeBenchmarkCredential(workerPool, credential).catch(() => undefined);
    await workerPool.end().catch(() => undefined);
    await dropIsolatedSchema(adminPool, runId).catch(() => undefined);
    await adminPool.end().catch(() => undefined);
  });

  async function insertEvent(eventId: string): Promise<void> {
    const base = benchmarkEventFor(runId, 1, Date.now());
    const event = { ...base, eventId };
    await workerPool.query(
      `INSERT INTO event_inbox
        (project_id, event_id, event_type, protocol_version, envelope,
         received_at, available_at, created_at, updated_at)
       VALUES ($1, $2, $3, 1, $4::jsonb, now(), now(), now(), now())`,
      [credential.projectId, event.eventId, event.eventType, JSON.stringify(event)],
    );
  }

  it('recovers an event after the first worker is stopped and its lease expires', async () => {
    await insertEvent('restart-1');
    // First worker claims the event and holds the lease (blocking processor),
    // then is stopped abruptly. The lease expires naturally.
    const first = await startBenchmarkWorker({
      pool: workerPool,
      processor: blockingProcessor,
      config: BASE_SCENARIO,
      workerId: 'bench-restart-first',
      maxProcessingAttempts: 3,
      leaseDurationMs: 400,
    });
    await sleep(150); // let it claim and hold the lease
    await first.stop();
    await sleep(500); // lease expires

    const before = await queryRow<{ state: string; attempt_count: number }>(
      workerPool,
      `SELECT state, attempt_count FROM event_inbox WHERE event_id = $1`,
      ['restart-1'],
    );
    expect(before?.state).toBe('leased');

    // Second worker recovers the expired lease and processes it exactly once.
    const second = await startBenchmarkWorker({
      pool: workerPool,
      processor: processedProcessor,
      config: BASE_SCENARIO,
      workerId: 'bench-restart-second',
      maxProcessingAttempts: 3,
      leaseDurationMs: 2000,
    });
    await sleep(600);
    await second.stop();

    const after = await queryRow<{ state: string; attempt_count: number }>(
      workerPool,
      `SELECT state, attempt_count FROM event_inbox WHERE event_id = $1`,
      ['restart-1'],
    );
    expect(after?.state).toBe('processed');
    expect(after?.attempt_count).toBe(2);
  });
});
