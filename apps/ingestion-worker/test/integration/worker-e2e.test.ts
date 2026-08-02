import type { Pool } from 'pg';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { buildIngestionWorker } from '../../src/worker-runtime.js';
import type { IngestionEventProcessor } from '../../src/processor.js';
import type {
  IngestionInboxProcessingRepository,
} from '@aurora/ingestion-inbox';
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

function baseConfig() {
  return {
    workerId: 'worker-e2e',
    claimBatchSize: 5,
    maxConcurrentHandlers: 2,
    leaseDurationMs: 2000,
    leaseRenewIntervalMs: 200,
    idlePollIntervalMs: 50,
    infrastructureFailureDelayMs: 100,
    shutdownGracePeriodMs: 300,
        maxProcessingAttempts: 3,
    databaseUrl: 'postgresql://localhost/aurora_inbox_test',
    logEnabled: false,
  };
}

async function insertEvent(pool: Pool, eventId: string, state = 'pending') {
  const envelope = JSON.stringify({
    protocolVersion: 1,
    eventId,
    eventType: 'error',
  });
  await pool.query(
    `INSERT INTO event_inbox
       (project_id, event_id, event_type, protocol_version, envelope,
        received_at, available_at, created_at, updated_at, state)
     VALUES ($1, $2, 'error', 1, $4::jsonb,
             now(), now(), now(), now(), $3)`,
    [projectA, eventId, state, envelope],
  );
}

describeDb('ingestion-worker e2e (real PostgreSQL 17)', () => {
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

  async function runWorkerOnce(processor: IngestionEventProcessor) {
    const worker = buildIngestionWorker({
      config: baseConfig(),
      repository: createProcessingRepository(pool),
      processor,
    });
    await worker.start();
    // Give the claim loop a few rounds.
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
    await worker.stop();
    return worker;
  }

  it('claims and marks processed events processed', async () => {
    await insertEvent(pool, 'e2e-processed-1');
    await runWorkerOnce({ process: () => Promise.resolve({ outcome: 'processed' }) });
    const row = await queryRow<{ state: string }>(
      pool,
      `SELECT state FROM event_inbox WHERE event_id = 'e2e-processed-1'`,
    );
    expect(row?.state).toBe('processed');
  });

  it('writes retry_waiting when the processor returns retry', async () => {
    await insertEvent(pool, 'e2e-retry-1');
    await runWorkerOnce({
      process: () =>
        Promise.resolve({
          outcome: 'retry',
          availableAt: new Date(Date.now() + 60_000),
          errorCode: 'service_temporarily_unavailable',
        }),
    });
    const row = await queryRow<{ state: string }>(
      pool,
      `SELECT state FROM event_inbox WHERE event_id = 'e2e-retry-1'`,
    );
    expect(row?.state).toBe('retry_waiting');
  });

  it('writes dead_lettered when the processor returns dead-letter', async () => {
    await insertEvent(pool, 'e2e-deadletter-1');
    await runWorkerOnce({
      process: () => Promise.resolve({ outcome: 'dead-letter', errorCode: 'invalid_schema' }),
    });
    const row = await queryRow<{ state: string }>(
      pool,
      `SELECT state FROM event_inbox WHERE event_id = 'e2e-deadletter-1'`,
    );
    expect(row?.state).toBe('dead_lettered');
  });

  it('does not mark processed when the processor throws', async () => {
    await insertEvent(pool, 'e2e-throw-1');
    await runWorkerOnce({
      process: () => Promise.reject(new Error('processor boom')),
    });
    const row = await queryRow<{ state: string }>(
      pool,
      `SELECT state FROM event_inbox WHERE event_id = 'e2e-throw-1'`,
    );
    // The failed event is not processed; it may still be leased (reclaimable later).
    expect(row?.state).not.toBe('processed');
  });

  it('does not block other events when one processor throws', async () => {
    await insertEvent(pool, 'e2e-mixed-fail');
    await insertEvent(pool, 'e2e-mixed-ok');
    let calls = 0;
    await runWorkerOnce({
      process: () => {
        calls += 1;
        if (calls === 1) return Promise.reject(new Error('first fails'));
        return Promise.resolve({ outcome: 'processed' });
      },
    });
    const failed = await queryRow<{ state: string }>(
      pool,
      `SELECT state FROM event_inbox WHERE event_id = 'e2e-mixed-fail'`,
    );
    const ok = await queryRow<{ state: string }>(
      pool,
      `SELECT state FROM event_inbox WHERE event_id = 'e2e-mixed-ok'`,
    );
    expect(ok?.state).toBe('processed');
    expect(failed?.state).not.toBe('processed');
  });
});
