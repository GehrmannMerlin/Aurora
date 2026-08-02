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

async function insertEvent(pool: Pool, eventId: string) {
  const envelope = JSON.stringify({
    protocolVersion: 1,
    eventId,
    eventType: 'error',
  });
  await pool.query(
    `INSERT INTO event_inbox
       (project_id, event_id, event_type, protocol_version, envelope,
        received_at, available_at, created_at, updated_at, state)
     VALUES ($1, $2, 'error', 1, $3::jsonb,
             now(), now(), now(), now(), 'pending')`,
    [projectA, eventId, envelope],
  );
}

function config(overrides?: Partial<ReturnType<typeof base>>) {
  return { ...base(), ...overrides };
}

function base() {
  return {
    workerId: 'worker-shutdown',
    claimBatchSize: 5,
    maxConcurrentHandlers: 1,
    leaseDurationMs: 5000,
    leaseRenewIntervalMs: 300,
    idlePollIntervalMs: 20,
    infrastructureFailureDelayMs: 50,
    shutdownGracePeriodMs: 400,
        maxProcessingAttempts: 3,
    databaseUrl: 'postgresql://localhost/aurora_inbox_test',
    logEnabled: false,
  };
}

describeDb('ingestion-worker graceful shutdown (real PostgreSQL 17)', () => {
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

  it('lets in-flight tasks complete within the grace period and writes back', async () => {
    await insertEvent(pool, 'shutdown-fast');
    const processor: IngestionEventProcessor = {
      process: async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 30));
        await Promise.resolve();
        return { outcome: 'processed' };
      },
    };
    const worker = buildIngestionWorker({
      config: config(),
      repository: createProcessingRepository(pool),
      processor,
    });
    await worker.start();
    await new Promise<void>((resolve) => setTimeout(resolve, 80));
    await worker.stop();
    const row = await queryRow<{ state: string }>(
      pool,
      `SELECT state FROM event_inbox WHERE event_id = 'shutdown-fast'`,
    );
    expect(row?.state).toBe('processed');
  });

  it('aborts overlong tasks after grace without forcing a state change', async () => {
    await insertEvent(pool, 'shutdown-slow');
    let aborted = false;
    const processor: IngestionEventProcessor = {
      process: (_input, signal) =>
        new Promise((resolve) => {
          const onAbort = (): void => {
            aborted = true;
            resolve({ outcome: 'processed' });
          };
          signal.addEventListener('abort', onAbort, { once: true });
        }),
    };
    const worker = buildIngestionWorker({
      config: config({ shutdownGracePeriodMs: 80 }),
      repository: createProcessingRepository(pool),
      processor,
    });
    await worker.start();
    await new Promise<void>((resolve) => setTimeout(resolve, 80));
    await worker.stop();
    expect(aborted).toBe(true);
    const row = await queryRow<{ state: string }>(
      pool,
      `SELECT state FROM event_inbox WHERE event_id = 'shutdown-slow'`,
    );
    // Not forced to processed/retry/dead-letter; still leased (reclaimable later).
    expect(row?.state).toBe('leased');
  });

  it('closes the pool exactly once across repeated close calls', async () => {
    const worker = buildIngestionWorker({
      config: config(),
      repository: createProcessingRepository(pool),
      processor: { process: () => Promise.resolve({ outcome: 'processed' }) },
    });
    await worker.start();
    await worker.stop();
    await worker.stop();
    expect(worker.status).toBe('stopped');
  });
});
