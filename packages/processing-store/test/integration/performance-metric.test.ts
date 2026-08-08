import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  persistErrorEventOccurrence,
  persistRequestMetricContribution,
  persistRequestEventSample,
  persistPerformanceMetricContribution,
} from '../../src/index.js';
import {
  assertIsTestDatabase,
  createTestPool,
  queryRow,
  queryRows,
  testDatabaseUrl,
} from './helpers.js';

const migrationsDir = fileURLToPath(new URL('../../migrations', import.meta.url));
const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const describeDb = hasDb ? describe : describe.skip;

interface BucketRow {
  id: string;
  project_id: string;
  bucket_start: string;
  metric_name: string;
  unit: string;
  observed_count: string;
  value_sum: string;
  value_max: string;
}

interface ApplicationRow {
  project_id: string;
  event_id: string;
}

const projectA = '11111111-1111-1111-1111-111111111111';
const projectB = '22222222-2222-2222-2222-222222222222';

function contribution(overrides: Record<string, unknown> = {}) {
  return {
    projectId: projectA,
    eventId: 'evt-perf-default',
    occurredAt: 1_800_000_054_000,
    metricName: 'lcp',
    unit: 'millisecond',
    value: 2500,
    startedAt: 1_800_000_050_000,
    ...overrides,
  };
}

describeDb('processing-store performance metric aggregation (real PostgreSQL 17)', () => {
  let pool: Pool;

  beforeAll(async () => {
    assertIsTestDatabase(testDatabaseUrl());
    pool = createTestPool();
    await pool.query('DROP TABLE IF EXISTS performance_metric_event_applications CASCADE');
    await pool.query('DROP TABLE IF EXISTS performance_metric_buckets CASCADE');
    await pool.query('DROP TABLE IF EXISTS performance_event_samples CASCADE');
    await pool.query('DROP TABLE IF EXISTS request_metric_event_applications CASCADE');
    await pool.query('DROP TABLE IF EXISTS request_metric_buckets CASCADE');
    await pool.query('DROP TABLE IF EXISTS request_event_samples CASCADE');
    await pool.query('DROP TABLE IF EXISTS error_event_occurrences CASCADE');
    await pool.query('DROP TABLE IF EXISTS pgmigrations CASCADE');
    await runner({
      databaseUrl: testDatabaseUrl(),
      dir: migrationsDir,
      direction: 'up',
      migrationsTable: 'pgmigrations',
      count: Infinity,
      log: () => undefined,
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('applies a first contribution and increments observed_count/sum/max', async () => {
    const result = await persistPerformanceMetricContribution(pool, contribution({ eventId: 'evt-perf-first' }));
    expect(result).toEqual({ status: 'applied' });
    const row = await queryRow<BucketRow>(
      pool,
      `SELECT * FROM performance_metric_buckets WHERE project_id = '${projectA}'`,
    );
    expect(row?.observed_count).toBe('1');
    expect(row?.value_sum).toBe('2500');
    expect(row?.value_max).toBe('2500');
    expect(row?.metric_name).toBe('lcp');
    expect(row?.unit).toBe('millisecond');
    expect(new Date(row?.bucket_start ?? 0).toISOString()).toBe('2027-01-15T08:00:00.000Z');
  });

  it('accumulates value_sum and takes value_max across events', async () => {
    await persistPerformanceMetricContribution(pool, contribution({ eventId: 'evt-perf-v1', value: 1000 }));
    await persistPerformanceMetricContribution(pool, contribution({ eventId: 'evt-perf-v2', value: 3200 }));
    const row = await queryRow<BucketRow>(
      pool,
      `SELECT * FROM performance_metric_buckets WHERE project_id = '${projectA}' AND metric_name = 'lcp' AND unit = 'millisecond'`,
    );
    // 2500 (first) + 1000 + 3200 = 6700
    expect(row?.observed_count).toBe('3');
    expect(row?.value_sum).toBe('6700');
    expect(row?.value_max).toBe('3200');
  });

  it('returns duplicate and does not change the bucket when re-applied', async () => {
    const before = await queryRow<BucketRow>(
      pool,
      `SELECT * FROM performance_metric_buckets WHERE project_id = '${projectA}' AND metric_name = 'lcp' AND unit = 'millisecond'`,
    );
    const result = await persistPerformanceMetricContribution(pool, contribution({ eventId: 'evt-perf-v1', value: 1000 }));
    expect(result).toEqual({ status: 'duplicate' });
    const after = await queryRow<BucketRow>(
      pool,
      `SELECT * FROM performance_metric_buckets WHERE project_id = '${projectA}' AND metric_name = 'lcp' AND unit = 'millisecond'`,
    );
    expect(after?.observed_count).toBe(before?.observed_count);
    expect(after?.value_sum).toBe(before?.value_sum);
    const apps = await queryRows<ApplicationRow>(
      pool,
      `SELECT * FROM performance_metric_event_applications WHERE event_id = 'evt-perf-v1'`,
    );
    expect(apps).toHaveLength(1);
  });

  it('keeps cls ratio and millisecond metrics in separate buckets', async () => {
    await persistPerformanceMetricContribution(
      pool,
      contribution({ eventId: 'evt-perf-cls', metricName: 'cls', unit: 'ratio', value: 0.12 }),
    );
    const rows = await queryRows<BucketRow>(
      pool,
      `SELECT * FROM performance_metric_buckets WHERE project_id = '${projectA}' AND metric_name = 'cls'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.unit).toBe('ratio');
    expect(rows[0]?.value_sum).toBe('0.12');
  });

  it('does not merge different projects into the same bucket', async () => {
    await persistPerformanceMetricContribution(
      pool,
      contribution({ projectId: projectB, eventId: 'evt-perf-proj-b', metricName: 'inp', unit: 'millisecond', value: 100 }),
    );
    const rows = await queryRows<BucketRow>(
      pool,
      `SELECT * FROM performance_metric_buckets WHERE metric_name = 'inp' AND unit = 'millisecond'`,
    );
    expect(rows.filter((r) => r.project_id === projectA)).toHaveLength(0);
    expect(rows.filter((r) => r.project_id === projectB)).toHaveLength(1);
  });

  it('does not merge across UTC minutes', async () => {
    await persistPerformanceMetricContribution(
      pool,
      contribution({ projectId: projectB, eventId: 'evt-perf-min2', occurredAt: 1_800_000_060_000, metricName: 'inp', unit: 'millisecond', value: 200 }),
    );
    const rows = await queryRows<BucketRow>(
      pool,
      `SELECT * FROM performance_metric_buckets WHERE project_id = '${projectB}' AND metric_name = 'inp' AND unit = 'millisecond'`,
    );
    expect(
      rows.filter((r) => new Date(r.bucket_start).toISOString() === '2027-01-15T08:00:00.000Z'),
    ).toHaveLength(1);
    expect(
      rows.filter((r) => new Date(r.bucket_start).toISOString() === '2027-01-15T08:01:00.000Z'),
    ).toHaveLength(1);
  });

  it('rejects an invalid value without registering or writing a bucket', async () => {
    const result = await persistPerformanceMetricContribution(pool, contribution({ eventId: 'evt-perf-bad', value: -5 }));
    expect(result.status).toBe('invalid_input');
    const apps = await queryRows<ApplicationRow>(
      pool,
      `SELECT * FROM performance_metric_event_applications WHERE event_id = 'evt-perf-bad'`,
    );
    expect(apps).toHaveLength(0);
  });

  it('produces at most one application across concurrent duplicate calls', async () => {
    const input = contribution({ eventId: 'evt-perf-conc', value: 100 });
    const results = await Promise.all([
      persistPerformanceMetricContribution(pool, input),
      persistPerformanceMetricContribution(pool, input),
    ]);
    const applied = results.filter((r) => r.status === 'applied');
    const duplicates = results.filter((r) => r.status === 'duplicate');
    expect(applied.length + duplicates.length).toBe(2);
    expect(applied.length).toBe(1);
    const apps = await queryRows<ApplicationRow>(
      pool,
      `SELECT * FROM performance_metric_event_applications WHERE event_id = 'evt-perf-conc'`,
    );
    expect(apps).toHaveLength(1);
  });

  it('does not regress the error occurrence store', async () => {
    const result = await persistErrorEventOccurrence(pool, {
      projectId: projectA,
      eventEnvelope: {
        protocolVersion: 1,
        eventId: 'evt-error-perf-regress',
        eventType: 'error',
        occurredAt: 1_800_000_054_000,
        body: { category: 'javascript', error: { message: 'Synthetic runtime failure' } },
      },
    });
    expect(result.status).toBe('inserted');
  });

  it('does not regress the request stores', async () => {
    const sampleResult = await persistRequestEventSample(pool, {
      projectId: projectA,
      eventEnvelope: {
        protocolVersion: 1,
        eventId: 'evt-sample-perf-regress',
        eventType: 'request',
        occurredAt: 1_800_000_054_000,
        body: { method: 'GET', url: 'https://api.example.test/orders', startedAt: 1_800_000_054_000, durationMs: 120, outcome: 'success', statusCode: 200 },
      },
    });
    expect(sampleResult.status).toBe('inserted');
    const metricResult = await persistRequestMetricContribution(pool, {
      projectId: projectA,
      eventId: 'evt-metric-perf-regress',
      occurredAt: 1_800_000_054_000,
      method: 'GET',
      outcome: 'success',
      statusCode: 200,
      durationMs: 120,
      isFailure: false,
      isSlow: false,
    });
    expect(metricResult.status).toBe('applied');
  });
});
