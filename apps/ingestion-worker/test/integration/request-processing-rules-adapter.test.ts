import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  persistRequestEventSample,
  persistRequestMetricContribution,
} from '@aurora/processing-store';
import {
  createRequestEventProcessor,
  createRequestProcessingRulesAdapter,
  DEFAULT_REQUEST_PROCESSING_RULES,
  type RequestProcessingRules,
} from '../../src/index.js';
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

function processorWithRules(pool: Pool, rules: RequestProcessingRules) {
  const adapter = createRequestProcessingRulesAdapter({ rules });
  return createRequestEventProcessor({
    persistMetric: (contribution) => persistRequestMetricContribution(pool, contribution),
    persistSample: (sample) => persistRequestEventSample(pool, sample),
    classify: (input) => adapter.classify(input),
    backoff: { initialDelayMs: 100, maxDelayMs: 1000 },
    entropyProvider: { next: () => 0 },
    now: () => new Date('2026-08-03T00:00:00.000Z'),
  });
}

describeDb('request processing rules adapter with real processor (PostgreSQL 17)', () => {
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

  it('default rules classify a fast success as non-failure non-slow and skip the sample', async () => {
    const processor = processorWithRules(pool, DEFAULT_REQUEST_PROCESSING_RULES);
    const result = await processor.process(
      processorInput(1, projectA, 'adp-ok-1', requestEnvelope('adp-ok-1', { durationMs: 200 })),
      new AbortController().signal,
    );
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
      `SELECT event_id FROM request_event_samples WHERE project_id = $1 AND event_id = 'adp-ok-1'`,
      [projectA],
    );
    expect(samples).toHaveLength(0);
  });

  it('default rules classify a 3200ms success as slow and store a bounded sample', async () => {
    const processor = processorWithRules(pool, DEFAULT_REQUEST_PROCESSING_RULES);
    const result = await processor.process(
      processorInput(2, projectA, 'adp-slow-1', requestEnvelope('adp-slow-1', { durationMs: 3200, method: 'POST' })),
      new AbortController().signal,
    );
    expect(result).toEqual({ outcome: 'processed' });
    const bucket = await queryRow<MetricBucketRow>(
      pool,
      `SELECT observed_count, failure_count, slow_count FROM request_metric_buckets
       WHERE project_id = $1 AND method = 'POST' AND outcome = 'success' AND status_code = 0`,
      [projectA],
    );
    expect(bucket?.observed_count).toBe('1');
    expect(bucket?.slow_count).toBe('1');
    const samples = await queryRows<SampleRow>(
      pool,
      `SELECT event_id FROM request_event_samples WHERE project_id = $1 AND event_id = 'adp-slow-1'`,
      [projectA],
    );
    expect(samples).toHaveLength(1);
  });

  it('default rules classify http_error 503 as failure and store a sample', async () => {
    const processor = processorWithRules(pool, DEFAULT_REQUEST_PROCESSING_RULES);
    const result = await processor.process(
      processorInput(3, projectA, 'adp-503-1', requestEnvelope('adp-503-1', { outcome: 'http_error', statusCode: 503, method: 'PUT' })),
      new AbortController().signal,
    );
    expect(result).toEqual({ outcome: 'processed' });
    const bucket = await queryRow<MetricBucketRow>(
      pool,
      `SELECT observed_count, failure_count FROM request_metric_buckets
       WHERE project_id = $1 AND method = 'PUT' AND outcome = 'http_error' AND status_code = 503`,
      [projectA],
    );
    expect(bucket?.observed_count).toBe('1');
    expect(bucket?.failure_count).toBe('1');
    const samples = await queryRows<SampleRow>(
      pool,
      `SELECT event_id FROM request_event_samples WHERE project_id = $1 AND event_id = 'adp-503-1'`,
      [projectA],
    );
    expect(samples).toHaveLength(1);
  });

  it('project override marks 404 as additional-monitored status and stores a configured_status sample', async () => {
    const rules: RequestProcessingRules = {
      ...DEFAULT_REQUEST_PROCESSING_RULES,
      additionalMonitoredStatusCodes: new Set([404]),
    };
    const processor = processorWithRules(pool, rules);
    const result = await processor.process(
      processorInput(4, projectA, 'adp-404-1', requestEnvelope('adp-404-1', { outcome: 'http_error', statusCode: 404, method: 'DELETE' })),
      new AbortController().signal,
    );
    expect(result).toEqual({ outcome: 'processed' });
    const bucket = await queryRow<MetricBucketRow>(
      pool,
      `SELECT observed_count, failure_count FROM request_metric_buckets
       WHERE project_id = $1 AND method = 'DELETE' AND outcome = 'http_error' AND status_code = 404`,
      [projectA],
    );
    // 404 is additional-monitored but NOT a failure under this rule set.
    expect(bucket?.observed_count).toBe('1');
    expect(bucket?.failure_count).toBe('0');
    const samples = await queryRows<SampleRow>(
      pool,
      `SELECT event_id FROM request_event_samples WHERE project_id = $1 AND event_id = 'adp-404-1'`,
      [projectA],
    );
    expect(samples).toHaveLength(1);
  });

  it('replay with the same adapter is idempotent for a slow request', async () => {
    const processor = processorWithRules(pool, DEFAULT_REQUEST_PROCESSING_RULES);
    const input = processorInput(5, projectA, 'adp-replay-1', requestEnvelope('adp-replay-1', { durationMs: 3400, method: 'PATCH' }));
    const first = await processor.process(input, new AbortController().signal);
    const second = await processor.process(input, new AbortController().signal);
    expect(first).toEqual({ outcome: 'processed' });
    expect(second).toEqual({ outcome: 'processed' });
    const bucket = await queryRow<MetricBucketRow>(
      pool,
      `SELECT observed_count, slow_count FROM request_metric_buckets
       WHERE project_id = $1 AND method = 'PATCH' AND outcome = 'success' AND status_code = 0`,
      [projectA],
    );
    expect(bucket?.observed_count).toBe('1');
    expect(bucket?.slow_count).toBe('1');
    const samples = await queryRows<SampleRow>(
      pool,
      `SELECT event_id FROM request_event_samples WHERE project_id = $1 AND event_id = 'adp-replay-1'`,
      [projectA],
    );
    expect(samples).toHaveLength(1);
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
