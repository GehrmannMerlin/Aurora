import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  persistRequestEventSample,
  persistRequestMetricContribution,
} from '@aurora/processing-store';
import { createRequestEventProcessor } from '../../src/request-event-processor.js';
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
  observed_count: string;
  failure_count: string;
  slow_count: string;
}

interface SampleRow {
  event_id: string;
  project_id: string;
}

function requestEnvelope(eventId: string, bodyOverrides?: Record<string, unknown>): unknown {
  return {
    protocolVersion: 1,
    eventId,
    eventType: 'request',
    occurredAt: 1_800_000_000_000,
    body: {
      method: 'GET',
      url: 'https://api.example.test/items',
      startedAt: 1_800_000_000_000,
      durationMs: 120,
      outcome: 'success',
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
    leaseExpiresAt: new Date('2026-08-03T00:01:00.000Z'),
  };
}

describeDb('request event processor (real PostgreSQL 17)', () => {
  let pool: Pool;

  beforeAll(async () => {
    assertIsTestDatabase(process.env.AURORA_TEST_DATABASE_URL ?? '');
    pool = createTestPool();
    await migrateUp();
    await ensureRequestProcessingTables();
    await pool.query('DELETE FROM request_event_samples');
    await pool.query('DELETE FROM request_metric_event_applications');
    await pool.query('DELETE FROM request_metric_buckets');
    await pool.query('DELETE FROM error_event_occurrences');
    await clearEventInbox(pool);
  });

  afterAll(async () => {
    await pool.query('DELETE FROM request_event_samples').catch(() => undefined);
    await pool.query('DELETE FROM request_metric_event_applications').catch(() => undefined);
    await pool.query('DELETE FROM request_metric_buckets').catch(() => undefined);
    await pool.query('DELETE FROM error_event_occurrences').catch(() => undefined);
    await clearEventInbox(pool).catch(() => undefined);
    await pool.end();
  });

  function defaultProcessor() {
    return createRequestEventProcessor({
      persistMetric: (input) => persistRequestMetricContribution(pool, input),
      persistSample: (input) => persistRequestEventSample(pool, input),
      classify: () => Promise.resolve({ isFailure: false, isSlow: false, isAdditionalMonitoredStatus: false }),
      backoff: { initialDelayMs: 100, maxDelayMs: 1000 },
      entropyProvider: { next: () => 0 },
      now: () => new Date('2026-08-03T00:00:00.000Z'),
    });
  }

  it('applies the metric and skips the sample for an unmonitored success request', async () => {
    const processor = defaultProcessor();
    const input = processorInput(1, projectA, 'rq-ok-1', requestEnvelope('rq-ok-1'));
    const result = await processor.process(input, new AbortController().signal);
    expect(result).toEqual({ outcome: 'processed' });

    const bucket = await queryRow<MetricBucketRow>(
      pool,
      `SELECT observed_count, failure_count, slow_count FROM request_metric_buckets
       WHERE project_id = $1 AND method = 'GET' AND outcome = 'success' AND status_code = 0`,
      [projectA],
    );
    expect(bucket?.observed_count).toBe('1');
    expect(bucket?.failure_count).toBe('0');
    expect(bucket?.slow_count).toBe('0');

    const samples = await queryRows<SampleRow>(
      pool,
      `SELECT event_id FROM request_event_samples WHERE project_id = $1`,
      [projectA],
    );
    expect(samples).toHaveLength(0);
  });

  it('applies the metric and inserts a sample for a network failure', async () => {
    const processor = createRequestEventProcessor({
      persistMetric: (input) => persistRequestMetricContribution(pool, input),
      persistSample: (input) => persistRequestEventSample(pool, input),
      classify: () => Promise.resolve({ isFailure: true, isSlow: false, isAdditionalMonitoredStatus: false }),
      backoff: { initialDelayMs: 100, maxDelayMs: 1000 },
      entropyProvider: { next: () => 0 },
      now: () => new Date('2026-08-03T00:00:00.000Z'),
    });
    const input = processorInput(
      2,
      projectA,
      'rq-net-1',
      requestEnvelope('rq-net-1', { outcome: 'network_error' }),
    );
    const result = await processor.process(input, new AbortController().signal);
    expect(result).toEqual({ outcome: 'processed' });

    const bucket = await queryRow<MetricBucketRow>(
      pool,
      `SELECT observed_count, failure_count, slow_count FROM request_metric_buckets
       WHERE project_id = $1 AND method = 'GET' AND outcome = 'network_error' AND status_code = 0`,
      [projectA],
    );
    expect(bucket?.observed_count).toBe('1');
    expect(bucket?.failure_count).toBe('1');

    const samples = await queryRows<SampleRow>(
      pool,
      `SELECT event_id, project_id FROM request_event_samples WHERE project_id = $1 AND event_id = 'rq-net-1'`,
      [projectA],
    );
    expect(samples).toHaveLength(1);
    expect(samples[0]?.project_id).toBe(projectA);
  });

  it('treats a replay as idempotent: metric duplicate and sample duplicate, no double counting', async () => {
    // Network failure + failure classification drives selection to store, so the
    // replay exercises both metric and sample idempotency.
    const processor = createRequestEventProcessor({
      persistMetric: (input) => persistRequestMetricContribution(pool, input),
      persistSample: (input) => persistRequestEventSample(pool, input),
      classify: () => Promise.resolve({ isFailure: true, isSlow: false, isAdditionalMonitoredStatus: false }),
      backoff: { initialDelayMs: 100, maxDelayMs: 1000 },
      entropyProvider: { next: () => 0 },
      now: () => new Date('2026-08-03T00:00:00.000Z'),
    });
    // Distinct method so this event owns a unique metric bucket (ADR-020:
    // different eventIds in the same minute/dimensions accumulate separately).
    const input = processorInput(
      3,
      projectA,
      'rq-replay-1',
      requestEnvelope('rq-replay-1', { outcome: 'network_error', method: 'POST' }),
    );
    const first = await processor.process(input, new AbortController().signal);
    const second = await processor.process(input, new AbortController().signal);
    expect(first).toEqual({ outcome: 'processed' });
    expect(second).toEqual({ outcome: 'processed' });

    const bucket = await queryRow<MetricBucketRow>(
      pool,
      `SELECT observed_count, failure_count, slow_count FROM request_metric_buckets
       WHERE project_id = $1 AND method = 'POST' AND outcome = 'network_error' AND status_code = 0`,
      [projectA],
    );
    expect(bucket?.observed_count).toBe('1');
    expect(bucket?.failure_count).toBe('1');

    const samples = await queryRows<SampleRow>(
      pool,
      `SELECT event_id FROM request_event_samples WHERE project_id = $1 AND event_id = 'rq-replay-1'`,
      [projectA],
    );
    expect(samples).toHaveLength(1);
  });

  it('converges after a sample temporary failure: metric duplicate then sample inserted', async () => {
    let sampleCalls = 0;
    const processor = createRequestEventProcessor({
      persistMetric: (input) => persistRequestMetricContribution(pool, input),
      persistSample: async (input) => {
        sampleCalls += 1;
        if (sampleCalls === 1) {
          return { status: 'temporarily_unavailable' as const };
        }
        return persistRequestEventSample(pool, input);
      },
      classify: () => Promise.resolve({ isFailure: true, isSlow: false, isAdditionalMonitoredStatus: false }),
      backoff: { initialDelayMs: 100, maxDelayMs: 1000 },
      entropyProvider: { next: () => 0 },
      now: () => new Date('2026-08-03T00:00:00.000Z'),
    });
    // Distinct method so this event owns a unique metric bucket.
    const input = processorInput(
      4,
      projectA,
      'rq-conv-1',
      requestEnvelope('rq-conv-1', { outcome: 'network_error', method: 'PUT' }),
    );

    const first = await processor.process(input, new AbortController().signal);
    expect(first.outcome).toBe('retry');
    if (first.outcome === 'retry') {
      expect(first.errorCode).toBe('service_temporarily_unavailable');
    }

    const second = await processor.process(input, new AbortController().signal);
    expect(second).toEqual({ outcome: 'processed' });

    const bucket = await queryRow<MetricBucketRow>(
      pool,
      `SELECT observed_count, failure_count FROM request_metric_buckets
       WHERE project_id = $1 AND method = 'PUT' AND outcome = 'network_error' AND status_code = 0`,
      [projectA],
    );
    expect(bucket?.observed_count).toBe('1');
    expect(bucket?.failure_count).toBe('1');

    const samples = await queryRows<SampleRow>(
      pool,
      `SELECT event_id FROM request_event_samples WHERE project_id = $1 AND event_id = 'rq-conv-1'`,
      [projectA],
    );
    expect(samples).toHaveLength(1);
  });

  it('rejects a non-request event as a local precondition without touching either store', async () => {
    const processor = defaultProcessor();
    const input = processorInput(
      5,
      projectA,
      'rq-nonreq-1',
      { protocolVersion: 1, eventId: 'rq-nonreq-1', eventType: 'error', occurredAt: 1_800_000_000_000 },
    );
    const result = await processor.process(input, new AbortController().signal);
    expect(result).toEqual({ outcome: 'dead-letter', errorCode: 'invalid_event_type' });

    const samples = await queryRows<SampleRow>(
      pool,
      `SELECT event_id FROM request_event_samples WHERE project_id = $1 AND event_id = 'rq-nonreq-1'`,
      [projectA],
    );
    expect(samples).toHaveLength(0);
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
