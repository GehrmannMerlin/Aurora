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
import { createSyntheticProcessor } from '../../src/synthetic-processor.js';
import { assertIsTestDatabase, createTestPool, queryRow, testDatabaseUrl } from './helpers.js';

const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const describeDb = hasDb ? describe : describe.skip;

const BASE_SCENARIO = {
  name: 'retry-budget',
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

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describeDb('benchmark retry budget dead-letter (real PostgreSQL 17)', () => {
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

  it('dead-letters an event with retry_budget_exhausted once its budget is spent', async () => {
    const eventId = `${runId}-retry-00000001`;
    await insertEvent(eventId);
    const retryAt = new Date(Date.now() + 50);
    // The synthetic processor always returns retry for the target event.
    const processor = createSyntheticProcessor({
      retry: { eventIds: new Set([eventId]), availableAt: retryAt },
    });
    const worker = await startBenchmarkWorker({
      pool: workerPool,
      processor,
      config: BASE_SCENARIO,
      workerId: 'bench-retry-budget',
      maxProcessingAttempts: 3,
    });
    // Give the worker enough time to exhaust the budget (3 attempts) and dead-letter.
    await sleep(1500);
    await worker.stop();

    const row = await queryRow<{ state: string; last_error_code: string; attempt_count: number }>(
      workerPool,
      `SELECT state, last_error_code, attempt_count FROM event_inbox WHERE event_id = $1`,
      [eventId],
    );
    expect(row?.state).toBe('dead_lettered');
    expect(row?.last_error_code).toBe('retry_budget_exhausted');
    expect(row?.attempt_count).toBeGreaterThanOrEqual(3);
  });
});
