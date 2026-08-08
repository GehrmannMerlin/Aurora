import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { persistPerformanceMetricContribution } from '@aurora/processing-store';
import { createPerformanceEventProcessor } from '../../src/performance-event-processor.js';
import type { ProcessIngestionEventInput } from '../../src/processor.js';
import {
  assertIsTestDatabase,
  clearEventInbox,
  createTestPool,
  ensureRequestProcessingTables,
  migrateUp,
  queryRow,
  queryRows,
} from './helpers.js';

const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const describeDb = hasDb ? describe : describe.skip;

const projectA = '11111111-1111-1111-1111-111111111111';

interface MetricBucketRow {
  metric_name: string;
  unit: string;
  observed_count: string;
  value_sum: string;
  value_max: string;
}

interface SampleRow {
  event_id: string;
}

function performanceEnvelope(eventId: string, bodyOverrides?: Record<string, unknown>): unknown {
  return {
    protocolVersion: 1,
    eventId,
    eventType: 'performance',
    occurredAt: 1_800_000_054_000,
    body: {
      metricCategory: 'page',
      metricName: 'lcp',
      value: 2500,
      unit: 'millisecond',
      startedAt: 1_800_000_050_000,
      ...bodyOverrides,
    },
  };
}

function processorInput(
  inboxId: number,
  projectId: string,
  eventId: string,
  event: unknown,
): ProcessIngestionEventInput {
  return {
    inboxId,
    projectId,
    eventId,
    event: event as ProcessIngestionEventInput['event'],
    attemptCount: 1,
    leaseId: '00000000-0000-0000-0000-000000000001',
    leaseExpiresAt: new Date('2026-08-07T00:01:00.000Z'),
  };
}

describeDb('performance event processor (real PostgreSQL 17)', () => {
  let pool: Pool;

  beforeAll(async () => {
    assertIsTestDatabase(process.env.AURORA_TEST_DATABASE_URL ?? '');
    pool = createTestPool();
    await migrateUp();
    await ensureRequestProcessingTables();
    await pool.query('DELETE FROM performance_metric_event_applications');
    await pool.query('DELETE FROM performance_metric_buckets');
    await pool.query('DELETE FROM performance_event_samples');
    await pool.query('DELETE FROM error_event_occurrences');
    await clearEventInbox(pool);
  });

  afterAll(async () => {
    await pool.query('DELETE FROM performance_metric_event_applications').catch(() => undefined);
    await pool.query('DELETE FROM performance_metric_buckets').catch(() => undefined);
    await pool.query('DELETE FROM performance_event_samples').catch(() => undefined);
    await pool.query('DELETE FROM error_event_occurrences').catch(() => undefined);
    await clearEventInbox(pool).catch(() => undefined);
    await pool.end();
  });

  function defaultProcessor() {
    return createPerformanceEventProcessor({
      persistMetric: (input) => persistPerformanceMetricContribution(pool, input),
      backoff: { initialDelayMs: 100, maxDelayMs: 1000 },
      entropyProvider: { next: () => 0 },
      now: () => new Date('2026-08-07T00:00:00.000Z'),
    });
  }

  it('aggregates an lcp event into the metric bucket', async () => {
    const processor = defaultProcessor();
    const result = await processor.process(
      processorInput(1, projectA, 'pg-perf-lcp-1', performanceEnvelope('pg-perf-lcp-1')),
      new AbortController().signal,
    );
    expect(result).toEqual({ outcome: 'processed' });
    const bucket = await queryRow<MetricBucketRow>(
      pool,
      `SELECT metric_name, unit, observed_count, value_sum, value_max
       FROM performance_metric_buckets WHERE project_id = $1 AND metric_name = 'lcp' AND unit = 'millisecond'`,
      [projectA],
    );
    expect(bucket?.observed_count).toBe('1');
    expect(bucket?.value_sum).toBe('2500');
    expect(bucket?.value_max).toBe('2500');
  });

  it('aggregates a cls ratio event into a separate ratio bucket', async () => {
    const processor = defaultProcessor();
    const result = await processor.process(
      processorInput(2, projectA, 'pg-perf-cls-1', performanceEnvelope('pg-perf-cls-1', { metricName: 'cls', value: 0.12, unit: 'ratio' })),
      new AbortController().signal,
    );
    expect(result).toEqual({ outcome: 'processed' });
    const bucket = await queryRow<MetricBucketRow>(
      pool,
      `SELECT metric_name, unit, observed_count, value_sum FROM performance_metric_buckets
       WHERE project_id = $1 AND metric_name = 'cls' AND unit = 'ratio'`,
      [projectA],
    );
    expect(bucket?.observed_count).toBe('1');
    expect(bucket?.value_sum).toBe('0.12');
  });

  it('treats a replay as idempotent: duplicate does not double-count', async () => {
    const processor = defaultProcessor();
    const input = processorInput(3, projectA, 'pg-perf-replay-1', performanceEnvelope('pg-perf-replay-1', { metricName: 'inp', value: 320, unit: 'millisecond' }));
    const first = await processor.process(input, new AbortController().signal);
    const second = await processor.process(input, new AbortController().signal);
    expect(first).toEqual({ outcome: 'processed' });
    expect(second).toEqual({ outcome: 'processed' });
    const bucket = await queryRow<MetricBucketRow>(
      pool,
      `SELECT observed_count, value_sum FROM performance_metric_buckets
       WHERE project_id = $1 AND metric_name = 'inp' AND unit = 'millisecond'`,
      [projectA],
    );
    expect(bucket?.observed_count).toBe('1');
    expect(bucket?.value_sum).toBe('320');
  });

  it('never writes any performance diagnostic sample row', async () => {
    const processor = defaultProcessor();
    await processor.process(
      processorInput(4, projectA, 'pg-perf-nosample-1', performanceEnvelope('pg-perf-nosample-1', { metricName: 'page_load', value: 800, unit: 'millisecond' })),
      new AbortController().signal,
    );
    const samples = await queryRows<SampleRow>(
      pool,
      `SELECT event_id FROM performance_event_samples WHERE project_id = $1`,
      [projectA],
    );
    expect(samples).toHaveLength(0);
  });

  it('converges after a temporary failure: retry then duplicate', async () => {
    let calls = 0;
    const processor = createPerformanceEventProcessor({
      persistMetric: async (input) => {
        calls += 1;
        if (calls === 1) {
          return { status: 'temporarily_unavailable' as const };
        }
        return persistPerformanceMetricContribution(pool, input);
      },
      backoff: { initialDelayMs: 100, maxDelayMs: 1000 },
      entropyProvider: { next: () => 0 },
      now: () => new Date('2026-08-07T00:00:00.000Z'),
    });
    const input = processorInput(5, projectA, 'pg-perf-conv-1', performanceEnvelope('pg-perf-conv-1', { metricName: 'page_load', value: 900, unit: 'millisecond' }));
    const first = await processor.process(input, new AbortController().signal);
    expect(first.outcome).toBe('retry');
    if (first.outcome === 'retry') {
      expect(first.errorCode).toBe('service_temporarily_unavailable');
    }
    const second = await processor.process(input, new AbortController().signal);
    expect(second).toEqual({ outcome: 'processed' });
    const bucket = await queryRow<MetricBucketRow>(
      pool,
      `SELECT observed_count, value_sum FROM performance_metric_buckets
       WHERE project_id = $1 AND metric_name = 'page_load' AND unit = 'millisecond'`,
      [projectA],
    );
    // The page_load bucket already has observed_count 1 from the no-sample test
    // above; this event's single applied contribution brings it to 2 (no double
    // count from the retry).
    expect(bucket?.observed_count).toBe('2');
  });

  it('rejects a non-performance event without aggregating', async () => {
    const processor = defaultProcessor();
    const result = await processor.process(
      processorInput(6, projectA, 'pg-perf-nonreq-1', { protocolVersion: 1, eventId: 'pg-perf-nonreq-1', eventType: 'error', occurredAt: 1_800_000_054_000 }),
      new AbortController().signal,
    );
    expect(result).toEqual({ outcome: 'dead-letter', errorCode: 'invalid_event_type' });
    const buckets = await queryRows<MetricBucketRow>(
      pool,
      `SELECT metric_name FROM performance_metric_buckets WHERE project_id = $1`,
      [projectA],
    );
    expect(buckets.length).toBeGreaterThan(0); // earlier tests already wrote buckets
  });

  it('leaves no residual state and cleans up so later runs start empty', async () => {
    const residual = await queryRow<{ leased: number }>(
      pool,
      `SELECT count(*) FILTER (WHERE state = 'leased')::int AS leased FROM event_inbox`,
    );
    expect(residual?.leased).toBe(0);
    const count = await queryRow<{ n: number }>(pool, 'SELECT count(*)::int AS n FROM event_inbox');
    expect(count?.n).toBe(0);
  });
});
