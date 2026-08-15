import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  claimAvailable,
  markDeadLettered,
  markProcessed,
  renewLease,
  scheduleRetry,
  type IngestionInboxProcessingRepository,
} from '@aurora/ingestion-inbox';
import { createProductionIngestionWorker } from '../../src/production-composition.js';
import { buildIngestionWorker } from '../../src/worker-runtime.js';
import {
  assertIsTestDatabase,
  clearEventInbox,
  createTestPool,
  migrateUp,
  ensureRequestProcessingTables,
  queryRow,
  queryRows,
} from './helpers.js';

const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const describeDb = hasDb ? describe : describe.skip;

const projectA = '11111111-1111-1111-1111-111111111111';

interface OccurrenceRow {
  event_id: string;
  error_category: string;
}
interface MetricBucketRow {
  metric_name: string;
  observed_count: string;
}
interface SampleRow {
  event_id: string;
}

describeDb('production worker composition (real PostgreSQL 17)', () => {
  let pool: Pool;

  beforeAll(async () => {
    assertIsTestDatabase(process.env.AURORA_TEST_DATABASE_URL ?? '');
    pool = createTestPool();
    await migrateUp();
    await ensureRequestProcessingTables();
    await pool.query('DELETE FROM error_event_occurrences');
    await pool.query('DELETE FROM request_metric_event_applications');
    await pool.query('DELETE FROM request_metric_buckets');
    await pool.query('DELETE FROM request_event_samples');
    await pool.query('DELETE FROM performance_metric_event_applications');
    await pool.query('DELETE FROM performance_metric_buckets');
    await pool.query('DELETE FROM performance_event_samples');
    await clearEventInbox(pool);
  });

  afterAll(async () => {
    await pool.query('DELETE FROM error_event_occurrences').catch(() => undefined);
    await pool.query('DELETE FROM request_metric_event_applications').catch(() => undefined);
    await pool.query('DELETE FROM request_metric_buckets').catch(() => undefined);
    await pool.query('DELETE FROM request_event_samples').catch(() => undefined);
    await pool.query('DELETE FROM performance_metric_event_applications').catch(() => undefined);
    await pool.query('DELETE FROM performance_metric_buckets').catch(() => undefined);
    await pool.query('DELETE FROM performance_event_samples').catch(() => undefined);
    await clearEventInbox(pool).catch(() => undefined);
    await pool.end();
  });

  function makeWorker() {
    const { processor, close } = createProductionIngestionWorker({
      config: {
        workerId: 'prod-test',
        claimBatchSize: 5,
        maxConcurrentHandlers: 2,
        leaseDurationMs: 30_000,
        leaseRenewIntervalMs: 10_000,
        idlePollIntervalMs: 1000,
        infrastructureFailureDelayMs: 500,
        shutdownGracePeriodMs: 5000,
        maxProcessingAttempts: 3,
        databaseUrl: process.env.AURORA_TEST_DATABASE_URL ?? '',
        logEnabled: false,
      },
      pool,
      backoff: { initialDelayMs: 100, maxDelayMs: 1000 },
      entropyProvider: { next: () => 0 },
      now: () => new Date('2026-08-07T00:00:00.000Z'),
    });
    // Mirror start.ts's private createProcessingRepository over the real Pool.
    const repository: IngestionInboxProcessingRepository = {
      claimAvailable: (input) => claimAvailable(pool, input),
      renewLease: (input) => renewLease(pool, input),
      markProcessed: (input) => markProcessed(pool, input),
      scheduleRetry: (input) => scheduleRetry(pool, input),
      markDeadLettered: (input) => markDeadLettered(pool, input),
    };
    const worker = buildIngestionWorker({
      config: {
        workerId: 'prod-test',
        claimBatchSize: 5,
        maxConcurrentHandlers: 2,
        leaseDurationMs: 30_000,
        leaseRenewIntervalMs: 10_000,
        idlePollIntervalMs: 1000,
        infrastructureFailureDelayMs: 500,
        shutdownGracePeriodMs: 5000,
        maxProcessingAttempts: 3,
        databaseUrl: process.env.AURORA_TEST_DATABASE_URL ?? '',
        logEnabled: false,
      },
      repository,
      processor,
    });
    return { worker, close };
  }

  /** Insert one event into event_inbox so the worker's real claim loop picks it up. */
  async function insertIntoInbox(
    eventId: string,
    eventType: string,
    body: Record<string, unknown>,
  ): Promise<void> {
    const envelope = JSON.stringify({
      protocolVersion: 1,
      eventId,
      eventType,
      occurredAt: 1_800_000_054_000,
      body,
    });
    await pool.query(
      `INSERT INTO event_inbox
         (project_id, event_id, event_type, protocol_version, envelope,
          received_at, available_at, created_at, updated_at, state)
       VALUES ($1, $2, $3, 1, $4::jsonb,
               now(), now(), now(), now(), 'pending')`,
      [projectA, eventId, eventType, envelope],
    );
  }

  /** Run the worker long enough to claim and process the inserted event, then stop. */
  async function runOnce(
    eventId: string,
    eventType: string,
    body: Record<string, unknown>,
  ): Promise<void> {
    await insertIntoInbox(eventId, eventType, body);
    const { worker, close } = makeWorker();
    await worker.start();
    // Poll until the event leaves the pending state (processed, retried, or dead-lettered).
    for (let i = 0; i < 50; i += 1) {
      const row = await queryRow<{ state: string }>(
        pool,
        `SELECT state FROM event_inbox WHERE event_id = $1`,
        [eventId],
      );
      if (row?.state !== 'pending') break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await worker.stop();
    await close();
  }

  it('processes an error event end-to-end into error_event_occurrences', async () => {
    await runOnce('prod-err-1', 'error', {
      category: 'javascript',
      error: { message: 'Synthetic runtime failure' },
    });
    const rows = await queryRows<OccurrenceRow>(
      pool,
      `SELECT event_id, error_category FROM error_event_occurrences WHERE event_id = 'prod-err-1'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.error_category).toBe('javascript');
  });

  it('processes a request event end-to-end into request_metric_buckets', async () => {
    await runOnce('prod-req-1', 'request', {
      method: 'GET',
      url: 'https://api.example.test/orders',
      startedAt: 1_800_000_054_000,
      durationMs: 120,
      outcome: 'success',
      statusCode: 200,
    });
    const rows = await queryRows<MetricBucketRow>(
      pool,
      `SELECT method, observed_count FROM request_metric_buckets WHERE project_id = $1 AND method = 'GET'`,
      [projectA],
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  it('processes a performance event end-to-end into performance_metric_buckets with no sample', async () => {
    await runOnce('prod-perf-1', 'performance', {
      metricCategory: 'page',
      metricName: 'lcp',
      value: 2500,
      unit: 'millisecond',
      startedAt: 1_800_000_050_000,
    });
    const buckets = await queryRows<MetricBucketRow>(
      pool,
      `SELECT metric_name, observed_count FROM performance_metric_buckets WHERE project_id = $1 AND metric_name = 'lcp'`,
      [projectA],
    );
    expect(buckets.length).toBeGreaterThan(0);
    const samples = await queryRows<SampleRow>(
      pool,
      `SELECT event_id FROM performance_event_samples WHERE project_id = $1`,
      [projectA],
    );
    expect(samples).toHaveLength(0);
  });
});
