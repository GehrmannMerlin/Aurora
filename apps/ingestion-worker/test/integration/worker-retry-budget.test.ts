import type { Pool } from 'pg';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { buildIngestionWorker } from '../../src/worker-runtime.js';
import type { IngestionEventProcessor } from '../../src/processor.js';
import type { IngestionInboxProcessingRepository } from '@aurora/ingestion-inbox';
import { claimAvailable, markDeadLettered, markProcessed, renewLease, scheduleRetry } from '@aurora/ingestion-inbox';
import { assertIsTestDatabase, clearEventInbox, createTestPool, migrateUp, queryRow } from './helpers.js';

const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const describeDb = hasDb ? describe : describe.skip;

const projectA = '11111111-1111-1111-1111-111111111111';

function createProcessingRepository(pool: Pool): IngestionInboxProcessingRepository {
  return {
    claimAvailable: (input) => claimAvailable(pool, input),
    renewLease: (input) => renewLease(pool, input),
    markProcessed: (input) => markProcessed(pool, input),
    scheduleRetry: (input) => scheduleRetry(pool, input),
    markDeadLettered: (input) => markDeadLettered(pool, input),
  };
}

async function insertEvent(pool: Pool, eventId: string, attemptCount = 0) {
  const envelope = JSON.stringify({ protocolVersion: 1, eventId, eventType: 'error' });
  await pool.query(
    `INSERT INTO event_inbox
       (project_id, event_id, event_type, protocol_version, envelope,
        received_at, available_at, created_at, updated_at, state, attempt_count)
     VALUES ($1, $2, 'error', 1, $4::jsonb,
             now(), now(), now(), now(), 'pending', $3)`,
    [projectA, eventId, attemptCount, envelope],
  );
}

function config(maxProcessingAttempts: number) {
  return {
    workerId: 'worker-retry-budget',
    claimBatchSize: 5,
    maxConcurrentHandlers: 1,
    leaseDurationMs: 5000,
    leaseRenewIntervalMs: 300,
    idlePollIntervalMs: 20,
    infrastructureFailureDelayMs: 50,
    shutdownGracePeriodMs: 500,
    maxProcessingAttempts,
    databaseUrl: 'postgresql://localhost/aurora_inbox_test',
    logEnabled: false,
  };
}

async function runWorkerOnce(
  pool: Pool,
  processor: IngestionEventProcessor,
  maxAttempts: number,
) {
  const worker = buildIngestionWorker({
    config: config(maxAttempts),
    repository: createProcessingRepository(pool),
    processor,
  });
  await worker.start();
  await new Promise<void>((resolve) => setTimeout(resolve, 250));
  await worker.stop();
}

describeDb('ingestion-worker retry budget (real PostgreSQL 17)', () => {
  let pool: Pool;

  beforeAll(async () => {
    assertIsTestDatabase(process.env.AURORA_TEST_DATABASE_URL ?? '');
    pool = createTestPool();
    await migrateUp();
    await clearEventInbox(pool);
  });

  afterAll(async () => {
    await clearEventInbox(pool).catch(() => undefined);
    await pool.end();
  });

  it('schedules a retry while attempts remain below the max', async () => {
    // attempt_count 1 with max 3 -> retry_waiting.
    await insertEvent(pool, 'rb-budget-ok', 1);
    await runWorkerOnce(
      pool,
      {
        process: () =>
          Promise.resolve({
            outcome: 'retry',
            availableAt: new Date(Date.now() + 60_000),
            errorCode: 'service_temporarily_unavailable',
          }),
      },
      3,
    );
    const row = await queryRow<{ state: string; last_error_code: string | null }>(
      pool,
      `SELECT state, last_error_code FROM event_inbox WHERE event_id = 'rb-budget-ok'`,
    );
    expect(row?.state).toBe('retry_waiting');
    expect(row?.last_error_code).toBe('service_temporarily_unavailable');
  });

  it('dead-letters with retry_budget_exhausted when attempts reach the max', async () => {
    // attempt_count 3 with max 3 -> budget exhausted.
    await insertEvent(pool, 'rb-budget-exhausted', 3);
    await runWorkerOnce(
      pool,
      {
        process: () =>
          Promise.resolve({
            outcome: 'retry',
            availableAt: new Date(Date.now() + 60_000),
            errorCode: 'service_temporarily_unavailable',
          }),
      },
      3,
    );
    const row = await queryRow<{ state: string; last_error_code: string | null }>(
      pool,
      `SELECT state, last_error_code FROM event_inbox WHERE event_id = 'rb-budget-exhausted'`,
    );
    expect(row?.state).toBe('dead_lettered');
    expect(row?.last_error_code).toBe('retry_budget_exhausted');
  });

  it('does not call scheduleRetry when the budget is exhausted', async () => {
    let scheduleRetryCalls = 0;
    const repo = createProcessingRepository(pool);
    const countingRepo: IngestionInboxProcessingRepository = {
      ...repo,
      scheduleRetry: async (input) => {
        scheduleRetryCalls += 1;
        return scheduleRetry(pool, input);
      },
    };
    await insertEvent(pool, 'rb-no-schedule', 5);
    const worker = buildIngestionWorker({
      config: config(3),
      repository: countingRepo,
      processor: {
        process: () =>
          Promise.resolve({
            outcome: 'retry',
            availableAt: new Date(Date.now() + 60_000),
            errorCode: 'service_temporarily_unavailable',
          }),
      },
    });
    await worker.start();
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
    await worker.stop();
    expect(scheduleRetryCalls).toBe(0);
    const row = await queryRow<{ state: string }>(
      pool,
      `SELECT state FROM event_inbox WHERE event_id = 'rb-no-schedule'`,
    );
    expect(row?.state).toBe('dead_lettered');
  });

  it('does not increment attemptCount through the Worker decision', async () => {
    // A pending event with attempt_count 1 is claimed (claimAvailable increments
    // to 2), then scheduleRetry preserves it. The Worker must NOT add another
    // increment for its own budget decision.
    await insertEvent(pool, 'rb-attempt-count', 1);
    await runWorkerOnce(
      pool,
      {
        process: () =>
          Promise.resolve({
            outcome: 'retry',
            availableAt: new Date(Date.now() + 60_000),
            errorCode: 'service_temporarily_unavailable',
          }),
      },
      3,
    );
    const row = await queryRow<{ attempt_count: number }>(
      pool,
      `SELECT attempt_count FROM event_inbox WHERE event_id = 'rb-attempt-count'`,
    );
    // Claim increments 1 -> 2; scheduleRetry keeps it at 2 (no Worker-side +1).
    expect(row?.attempt_count).toBe(2);
  });

  it('explicit dead-letter is not affected by the retry budget', async () => {
    await insertEvent(pool, 'rb-explicit-dl', 7);
    await runWorkerOnce(
      pool,
      {
        process: () => Promise.resolve({ outcome: 'dead-letter', errorCode: 'invalid_schema' }),
      },
      3,
    );
    const row = await queryRow<{ state: string; last_error_code: string | null }>(
      pool,
      `SELECT state, last_error_code FROM event_inbox WHERE event_id = 'rb-explicit-dl'`,
    );
    expect(row?.state).toBe('dead_lettered');
    expect(row?.last_error_code).toBe('invalid_schema');
  });

  it('processed is not affected by the retry budget', async () => {
    await insertEvent(pool, 'rb-processed', 7);
    await runWorkerOnce(
      pool,
      { process: () => Promise.resolve({ outcome: 'processed' }) },
      3,
    );
    const row = await queryRow<{ state: string }>(
      pool,
      `SELECT state FROM event_inbox WHERE event_id = 'rb-processed'`,
    );
    expect(row?.state).toBe('processed');
  });

  it('keeps the event leased when the processor throws (not auto-retried or dead-lettered)', async () => {
    await insertEvent(pool, 'rb-throw', 2);
    await runWorkerOnce(
      pool,
      { process: () => Promise.reject(new Error('processor boom')) },
      3,
    );
    const row = await queryRow<{ state: string }>(
      pool,
      `SELECT state FROM event_inbox WHERE event_id = 'rb-throw'`,
    );
    // Not auto-retried, not dead-lettered, not processed; still leased.
    expect(row?.state).toBe('leased');
  });

  it('invalid retry results do not write retry or dead-letter', async () => {
    await insertEvent(pool, 'rb-invalid', 1);
    await runWorkerOnce(
      pool,
      {
        process: () =>
          Promise.resolve({
            outcome: 'retry',
            availableAt: new Date(NaN),
            errorCode: 'service_temporarily_unavailable',
          }),
      },
      3,
    );
    const row = await queryRow<{ state: string }>(
      pool,
      `SELECT state FROM event_inbox WHERE event_id = 'rb-invalid'`,
    );
    expect(row?.state).not.toBe('retry_waiting');
    expect(row?.state).not.toBe('dead_lettered');
  });
});
