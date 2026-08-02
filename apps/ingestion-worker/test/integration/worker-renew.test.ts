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

describeDb('ingestion-worker lease renewal (real PostgreSQL 17)', () => {
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

  it('renews a long-running task and stops renewing after completion', async () => {
    await insertEvent(pool, 'renew-long-1');
    let renews = 0;
    const repo = createProcessingRepository(pool);
    const renewingRepo: IngestionInboxProcessingRepository = {
      ...repo,
      renewLease: async (input) => {
        renews += 1;
        return renewLease(pool, input);
      },
    };
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const processor: IngestionEventProcessor = {
      process: async () => {
        await held;
        await Promise.resolve();
        return { outcome: 'processed' };
      },
    };
    const worker = buildIngestionWorker({
      config: {
        workerId: 'worker-renew',
        claimBatchSize: 5,
        maxConcurrentHandlers: 1,
        leaseDurationMs: 5000,
        leaseRenewIntervalMs: 150,
        idlePollIntervalMs: 20,
        infrastructureFailureDelayMs: 50,
        shutdownGracePeriodMs: 500,
        maxProcessingAttempts: 3,
        databaseUrl: 'postgresql://localhost/aurora_inbox_test',
        logEnabled: false,
      },
      repository: renewingRepo,
      processor,
    });
    await worker.start();
    await new Promise<void>((resolve) => setTimeout(resolve, 450));
    expect(renews).toBeGreaterThanOrEqual(1);
    release?.();
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    const afterCompletion = renews;
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
    await worker.stop();
    expect(renews).toBe(afterCompletion);
    const row = await queryRow<{ state: string }>(
      pool,
      `SELECT state FROM event_inbox WHERE event_id = 'renew-long-1'`,
    );
    expect(row?.state).toBe('processed');
  });

  it('aborts the processor and skips write-back when the lease is lost', async () => {
    await insertEvent(pool, 'renew-lost-1');
    let aborted = false;
    const repo = createProcessingRepository(pool);
    const losingRepo: IngestionInboxProcessingRepository = {
      ...repo,
      renewLease: async (input) => {
        // After the first renewal, steal the lease externally so renewLease loses.
        await pool.query(
          `UPDATE event_inbox SET lease_id = gen_random_uuid() WHERE id = $1`,
          [input.id],
        );
        return renewLease(pool, input);
      },
    };
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
      config: {
        workerId: 'worker-lost',
        claimBatchSize: 5,
        maxConcurrentHandlers: 1,
        leaseDurationMs: 5000,
        leaseRenewIntervalMs: 100,
        idlePollIntervalMs: 20,
        infrastructureFailureDelayMs: 50,
        shutdownGracePeriodMs: 300,
        maxProcessingAttempts: 3,
        databaseUrl: 'postgresql://localhost/aurora_inbox_test',
        logEnabled: false,
      },
      repository: losingRepo,
      processor,
    });
    await worker.start();
    await new Promise<void>((resolve) => setTimeout(resolve, 400));
    expect(aborted).toBe(true);
    await worker.stop();
    const row = await queryRow<{ state: string }>(
      pool,
      `SELECT state FROM event_inbox WHERE event_id = 'renew-lost-1'`,
    );
    // lease lost -> no final write-back; the record stays leased (reclaimable later).
    expect(row?.state).toBe('leased');
  });
});
