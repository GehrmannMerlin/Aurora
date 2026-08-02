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

async function insertEvents(pool: Pool, count: number, prefix: string) {
  for (let i = 0; i < count; i += 1) {
    const eventId = `${prefix}-${String(i).padStart(2, '0')}`;
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
}

describeDb('ingestion-worker concurrency (real PostgreSQL 17)', () => {
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

  it('does not exceed the configured concurrency while draining a batch', async () => {
    await insertEvents(pool, 12, 'conc');
    let active = 0;
    let peak = 0;
    const processor: IngestionEventProcessor = {
      process: async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise<void>((resolve) => setTimeout(resolve, 30));
        active -= 1;
        await Promise.resolve();
        return { outcome: 'processed' };
      },
    };
    const worker = buildIngestionWorker({
      config: {
        workerId: 'worker-conc',
        claimBatchSize: 4,
        maxConcurrentHandlers: 2,
        leaseDurationMs: 5000,
        leaseRenewIntervalMs: 300,
        idlePollIntervalMs: 20,
        infrastructureFailureDelayMs: 50,
        shutdownGracePeriodMs: 500,
        maxProcessingAttempts: 3,
        databaseUrl: 'postgresql://localhost/aurora_inbox_test',
        logEnabled: false,
      },
      repository: createProcessingRepository(pool),
      processor,
    });
    await worker.start();
    await new Promise<void>((resolve) => setTimeout(resolve, 1200));
    await worker.stop();
    expect(peak).toBeLessThanOrEqual(2);
    const remaining = await queryRow<{ n: number }>(
      pool,
      `SELECT count(*)::int AS n FROM event_inbox WHERE event_id LIKE 'conc-%' AND state <> 'processed'`,
    );
    expect(remaining?.n ?? 0).toBe(0);
  });

  it('waits for the idle interval and stops claiming after stop', async () => {
    const start = Date.now();
    const processor: IngestionEventProcessor = {
      process: () => Promise.resolve({ outcome: 'processed' }),
    };
    const worker = buildIngestionWorker({
      config: {
        workerId: 'worker-idle',
        claimBatchSize: 5,
        maxConcurrentHandlers: 2,
        leaseDurationMs: 5000,
        leaseRenewIntervalMs: 300,
        idlePollIntervalMs: 60,
        infrastructureFailureDelayMs: 50,
        shutdownGracePeriodMs: 500,
        maxProcessingAttempts: 3,
        databaseUrl: 'postgresql://localhost/aurora_inbox_test',
        logEnabled: false,
      },
      repository: createProcessingRepository(pool),
      processor,
    });
    await worker.start();
    // Empty inbox: the worker should idle-wait rather than busy-loop.
    await new Promise<void>((resolve) => setTimeout(resolve, 400));
    await worker.stop();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(200);
  });
});
