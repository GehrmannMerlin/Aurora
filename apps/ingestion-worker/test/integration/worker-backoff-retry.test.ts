import type { Pool } from 'pg';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { buildIngestionWorker } from '../../src/worker-runtime.js';
import { calculateRetryBackoffSchedule } from '../../src/retry-backoff-policy.js';
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
    workerId: 'worker-backoff-retry',
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

/**
 * A processor that explicitly consults the backoff policy to build its retry
 * availableAt. This is exactly the intended consumer pattern: the processor
 * owns availableAt and uses the backoff helper to compute it.
 */
function backoffRetryProcessor(eventId: string): IngestionEventProcessor {
  return {
    process(input) {
      if (input.eventId !== eventId) return Promise.resolve({ outcome: 'processed' });
      const now = new Date();
      const result = calculateRetryBackoffSchedule({
        // A window long enough that the short worker run below ends before the
        // event becomes claimable again, so the row stays retry_waiting.
        config: { initialDelayMs: 2000, maxDelayMs: 4000 },
        attemptCount: input.attemptCount,
        now,
        entropy: 0, // deterministic lower bound
      });
      if (result.status !== 'success') {
        return Promise.resolve({ outcome: 'dead-letter', errorCode: 'invalid_schema' });
      }
      return Promise.resolve({
        outcome: 'retry',
        availableAt: result.availableAt,
        errorCode: 'service_temporarily_unavailable',
      });
    },
  };
}

describeDb('ingestion-worker retry backoff schedule (real PostgreSQL 17)', () => {
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

  it('a processor that calls the backoff policy schedules retry_waiting within the computed window', async () => {
    await insertEvent(pool, 'bo-ok', 1);
    const worker = buildIngestionWorker({
      config: config(3),
      repository: createProcessingRepository(pool),
      processor: backoffRetryProcessor('bo-ok'),
    });
    await worker.start();
    await new Promise<void>((resolve) => setTimeout(resolve, 300));
    await worker.stop();

    const row = await queryRow<{
      state: string;
      available_at: string;
      received_at: string;
      last_error_code: string | null;
    }>(
      pool,
      `SELECT state, available_at, received_at, last_error_code FROM event_inbox WHERE event_id = 'bo-ok'`,
    );
    expect(row?.state).toBe('retry_waiting');
    expect(row?.last_error_code).toBe('service_temporarily_unavailable');

    // attempt 2 -> capped = min(2000*2, 4000) = 4000, lowerBound = 2000, entropy 0 -> delay 2000.
    const receivedMs = new Date(row?.received_at ?? '').getTime();
    const availableMs = new Date(row?.available_at ?? '').getTime();
    const delta = availableMs - receivedMs;
    expect(delta).toBeGreaterThanOrEqual(2000);
    expect(delta).toBeLessThanOrEqual(4000);
  });

  it('cannot re-claim the event before available_at and can after it', async () => {
    await insertEvent(pool, 'bo-claim', 1);
    // Insert directly with a very short available window: available_at = now.
    await pool.query(
      `UPDATE event_inbox SET state = 'retry_waiting', available_at = now(), last_error_code = 'service_temporarily_unavailable'
       WHERE event_id = 'bo-claim'`,
    );
    // First worker run: claims and processes it.
    const first = buildIngestionWorker({
      config: config(3),
      repository: createProcessingRepository(pool),
      processor: { process: () => Promise.resolve({ outcome: 'processed' }) },
    });
    await first.start();
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
    await first.stop();

    const after = await queryRow<{ state: string }>(
      pool,
      `SELECT state FROM event_inbox WHERE event_id = 'bo-claim'`,
    );
    expect(after?.state).toBe('processed');
  });

  it('respects notBefore by raising availableAt above the computed retry time', async () => {
    await insertEvent(pool, 'bo-notbefore', 1);
    const late = new Date(Date.now() + 30_000);
    const processor: IngestionEventProcessor = {
      process(input) {
        if (input.eventId !== 'bo-notbefore') return Promise.resolve({ outcome: 'processed' });
        const result = calculateRetryBackoffSchedule({
          config: { initialDelayMs: 2000, maxDelayMs: 4000 },
          attemptCount: input.attemptCount,
          now: new Date(),
          entropy: 0,
          notBefore: late,
        });
        if (result.status !== 'success') {
          return Promise.resolve({ outcome: 'dead-letter', errorCode: 'invalid_schema' });
        }
        return Promise.resolve({
          outcome: 'retry',
          availableAt: result.availableAt,
          errorCode: 'service_temporarily_unavailable',
        });
      },
    };
    const worker = buildIngestionWorker({
      config: config(3),
      repository: createProcessingRepository(pool),
      processor,
    });
    await worker.start();
    await new Promise<void>((resolve) => setTimeout(resolve, 300));
    await worker.stop();
    const row = await queryRow<{ available_at: string }>(
      pool,
      `SELECT available_at FROM event_inbox WHERE event_id = 'bo-notbefore'`,
    );
    expect(new Date(row?.available_at ?? '').getTime()).toBeGreaterThanOrEqual(late.getTime());
  });

  it('budget exhaustion still dead-letters via ADR-015 even with a backoff-using processor', async () => {
    // attempt_count already at max (3 with max 3): processor returns retry with a
    // backoff-derived availableAt, but the Worker budget decision dead-letters.
    await insertEvent(pool, 'bo-exhausted', 3);
    const worker = buildIngestionWorker({
      config: config(3),
      repository: createProcessingRepository(pool),
      processor: backoffRetryProcessor('bo-exhausted'),
    });
    await worker.start();
    await new Promise<void>((resolve) => setTimeout(resolve, 300));
    await worker.stop();
    const row = await queryRow<{ state: string; last_error_code: string | null }>(
      pool,
      `SELECT state, last_error_code FROM event_inbox WHERE event_id = 'bo-exhausted'`,
    );
    expect(row?.state).toBe('dead_lettered');
    expect(row?.last_error_code).toBe('retry_budget_exhausted');
  });

  it('leaves no residual leased rows after all worker runs', async () => {
    const residual = await queryRow<{ leased: number }>(
      pool,
      `SELECT count(*) FILTER (WHERE state = 'leased')::int AS leased FROM event_inbox`,
    );
    expect(residual?.leased).toBe(0);
  });

  it('cleans up all rows so a later run starts empty', async () => {
    await clearEventInbox(pool);
    const count = await queryRow<{ n: number }>(pool, 'SELECT count(*)::int AS n FROM event_inbox');
    expect(count?.n).toBe(0);
  });
});
