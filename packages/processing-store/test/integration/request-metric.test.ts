import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  persistErrorEventOccurrence,
  persistRequestEventSample,
  persistRequestMetricContribution,
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
  method: string;
  outcome: string;
  status_code: number;
  observed_count: string;
  failure_count: string;
  slow_count: string;
  duration_sum_ms: string;
  duration_max_ms: string;
}

interface ApplicationRow {
  project_id: string;
  event_id: string;
  applied_at: string;
}

const projectA = '11111111-1111-1111-1111-111111111111';
const projectB = '22222222-2222-2222-2222-222222222222';

function contribution(
  overrides: Partial<{
    projectId: string;
    eventId: string;
    occurredAt: number;
    method: string;
    outcome: string;
    statusCode?: number;
    durationMs: number;
    isFailure: boolean;
    isSlow: boolean;
  }>,
): Record<string, unknown> {
  return {
    projectId: projectA,
    eventId: 'evt-metric-default',
    occurredAt: 1_800_000_054_000,
    method: 'GET',
    outcome: 'success',
    statusCode: 200,
    durationMs: 120,
    isFailure: false,
    isSlow: false,
    ...overrides,
  };
}

describeDb('processing-store request metric aggregation (real PostgreSQL 17)', () => {
  let pool: Pool;

  beforeAll(async () => {
    assertIsTestDatabase(testDatabaseUrl());
    pool = createTestPool();
    await pool.query('DROP TABLE IF EXISTS request_metric_event_applications CASCADE');
    await pool.query('DROP TABLE IF EXISTS request_metric_buckets CASCADE');
    await pool.query('DROP TABLE IF EXISTS request_event_samples CASCADE');
    await pool.query('DROP TABLE IF EXISTS error_event_occurrences CASCADE');
    await pool.query('DROP TABLE IF EXISTS issue_samples CASCADE');
    await pool.query('DROP TABLE IF EXISTS issue_activities CASCADE');
    await pool.query('DROP TABLE IF EXISTS issue_notes CASCADE');
    await pool.query('DROP TABLE IF EXISTS issue_event_applications CASCADE');
    await pool.query('DROP TABLE IF EXISTS issues CASCADE');
    await pool.query('DROP TABLE IF EXISTS performance_metric_event_applications CASCADE');
    await pool.query('DROP TABLE IF EXISTS performance_metric_buckets CASCADE');
    await pool.query('DROP TABLE IF EXISTS performance_event_samples CASCADE');
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

  it('applies a first contribution and increments observed_count', async () => {
    const result = await persistRequestMetricContribution(
      pool,
      contribution({ eventId: 'evt-metric-first' }),
    );
    expect(result).toEqual({ status: 'applied' });
    const row = await queryRow<BucketRow>(
      pool,
      `SELECT * FROM request_metric_buckets WHERE project_id = '${projectA}'`,
    );
    expect(row?.observed_count).toBe('1');
    expect(row?.failure_count).toBe('0');
    expect(row?.slow_count).toBe('0');
    expect(row?.duration_sum_ms).toBe('120');
    expect(row?.duration_max_ms).toBe('120');
    expect(row?.method).toBe('GET');
    expect(row?.outcome).toBe('success');
    expect(row?.status_code).toBe(200);
    expect(new Date(row?.bucket_start ?? 0).toISOString()).toBe('2027-01-15T08:00:00.000Z');
  });

  it('records a failure contribution separately', async () => {
    const { statusCode, ...withoutStatus } = contribution({
      eventId: 'evt-metric-fail',
      outcome: 'network_error',
      isFailure: true,
    });
    void statusCode;
    await persistRequestMetricContribution(pool, withoutStatus);
    const row = await queryRow<BucketRow>(
      pool,
      `SELECT * FROM request_metric_buckets
       WHERE project_id = '${projectA}' AND outcome = 'network_error'`,
    );
    expect(row?.observed_count).toBe('1');
    expect(row?.failure_count).toBe('1');
    // Missing statusCode maps to the 0 sentinel.
    expect(row?.status_code).toBe(0);
  });

  it('records a slow contribution separately', async () => {
    const { statusCode, ...withoutStatus } = contribution({
      eventId: 'evt-metric-slow',
      outcome: 'timeout',
      isSlow: true,
      durationMs: 5000,
    });
    void statusCode;
    await persistRequestMetricContribution(pool, withoutStatus);
    const row = await queryRow<BucketRow>(
      pool,
      `SELECT * FROM request_metric_buckets
       WHERE project_id = '${projectA}' AND outcome = 'timeout'`,
    );
    expect(row?.observed_count).toBe('1');
    expect(row?.slow_count).toBe('1');
    expect(row?.duration_max_ms).toBe('5000');
  });

  it('increments both failure and slow counts when both flags are set', async () => {
    await persistRequestMetricContribution(
      pool,
      contribution({ eventId: 'evt-metric-both', outcome: 'http_error', statusCode: 503, isFailure: true, isSlow: true, durationMs: 4000 }),
    );
    const row = await queryRow<BucketRow>(
      pool,
      `SELECT * FROM request_metric_buckets
       WHERE project_id = '${projectA}' AND outcome = 'http_error' AND status_code = 503`,
    );
    expect(row?.failure_count).toBe('1');
    expect(row?.slow_count).toBe('1');
  });

  it('accumulates duration_sum and takes the max duration', async () => {
    await persistRequestMetricContribution(
      pool,
      contribution({ eventId: 'evt-metric-dur-1', durationMs: 100 }),
    );
    await persistRequestMetricContribution(
      pool,
      contribution({ eventId: 'evt-metric-dur-2', durationMs: 250 }),
    );
    const row = await queryRow<BucketRow>(
      pool,
      `SELECT * FROM request_metric_buckets
       WHERE project_id = '${projectA}' AND outcome = 'success' AND status_code = 200`,
    );
    // First (120) + 100 + 250 = 470
    expect(row?.duration_sum_ms).toBe('470');
    expect(row?.duration_max_ms).toBe('250');
    expect(row?.observed_count).toBe('3');
  });

  it('returns duplicate and does not change the bucket when re-applied', async () => {
    const before = await queryRow<BucketRow>(
      pool,
      `SELECT * FROM request_metric_buckets WHERE project_id = '${projectA}' AND outcome = 'success' AND status_code = 200`,
    );
    const result = await persistRequestMetricContribution(
      pool,
      contribution({ eventId: 'evt-metric-dur-1', durationMs: 100 }),
    );
    expect(result).toEqual({ status: 'duplicate' });
    const after = await queryRow<BucketRow>(
      pool,
      `SELECT * FROM request_metric_buckets WHERE project_id = '${projectA}' AND outcome = 'success' AND status_code = 200`,
    );
    expect(after?.observed_count).toBe(before?.observed_count);
    expect(after?.duration_sum_ms).toBe(before?.duration_sum_ms);
    const apps = await queryRows<ApplicationRow>(
      pool,
      `SELECT * FROM request_metric_event_applications WHERE event_id = 'evt-metric-dur-1'`,
    );
    expect(apps).toHaveLength(1);
  });

  it('does not merge different projects into the same bucket', async () => {
    await persistRequestMetricContribution(
      pool,
      contribution({ projectId: projectB, eventId: 'evt-metric-proj-b', occurredAt: 1_800_000_054_000 }),
    );
    const rows = await queryRows<BucketRow>(
      pool,
      `SELECT * FROM request_metric_buckets WHERE bucket_start = '2027-01-15T08:00:00.000Z' AND method = 'GET' AND outcome = 'success'`,
    );
    // Two distinct projects => two distinct buckets.
    expect(rows.filter((r) => r.project_id === projectA)).toHaveLength(1);
    expect(rows.filter((r) => r.project_id === projectB)).toHaveLength(1);
  });

  it('does not merge different dimensions into the same bucket', async () => {
    await persistRequestMetricContribution(
      pool,
      contribution({ eventId: 'evt-metric-method-post', method: 'POST' }),
    );
    const rows = await queryRows<BucketRow>(
      pool,
      `SELECT * FROM request_metric_buckets WHERE project_id = '${projectA}' AND outcome = 'success'`,
    );
    expect(rows.filter((r) => r.method === 'GET')).toHaveLength(1);
    expect(rows.filter((r) => r.method === 'POST')).toHaveLength(1);
  });

  it('does not merge across UTC minutes', async () => {
    await persistRequestMetricContribution(
      pool,
      contribution({ eventId: 'evt-metric-min-2', occurredAt: 1_800_000_060_000 }),
    );
    const rows = await queryRows<BucketRow>(
      pool,
      `SELECT * FROM request_metric_buckets
       WHERE project_id = '${projectA}' AND outcome = 'success' AND status_code = 200 AND method = 'GET'`,
    );
    expect(
      rows.filter((r) => new Date(r.bucket_start).toISOString() === '2027-01-15T08:00:00.000Z'),
    ).toHaveLength(1);
    expect(
      rows.filter((r) => new Date(r.bucket_start).toISOString() === '2027-01-15T08:01:00.000Z'),
    ).toHaveLength(1);
  });

  it('rejects an invalid duration without registering or writing a bucket', async () => {
    const result = await persistRequestMetricContribution(
      pool,
      contribution({ eventId: 'evt-metric-bad-dur', durationMs: -1 }),
    );
    expect(result.status).toBe('invalid_input');
    const apps = await queryRows<ApplicationRow>(
      pool,
      `SELECT * FROM request_metric_event_applications WHERE event_id = 'evt-metric-bad-dur'`,
    );
    expect(apps).toHaveLength(0);
  });

  it('produces at most one application across concurrent duplicate calls', async () => {
    const input = contribution({ eventId: 'evt-metric-conc', durationMs: 100 });
    const results = await Promise.all([
      persistRequestMetricContribution(pool, input),
      persistRequestMetricContribution(pool, input),
    ]);
    const applied = results.filter((r) => r.status === 'applied');
    const duplicates = results.filter((r) => r.status === 'duplicate');
    expect(applied.length + duplicates.length).toBe(2);
    expect(applied.length).toBe(1);
    const apps = await queryRows<ApplicationRow>(
      pool,
      `SELECT * FROM request_metric_event_applications WHERE event_id = 'evt-metric-conc'`,
    );
    expect(apps).toHaveLength(1);
  });

  it('does not regress the error occurrence store', async () => {
    const result = await persistErrorEventOccurrence(pool, {
      projectId: projectA,
      eventEnvelope: {
        protocolVersion: 1,
        eventId: 'evt-error-metric-regress',
        eventType: 'error',
        occurredAt: 1_800_000_054_000,
        body: { category: 'javascript', error: { message: 'Synthetic runtime failure' } },
      },
    });
    expect(result.status).toBe('inserted');
  });

  it('does not regress the request sample store', async () => {
    const result = await persistRequestEventSample(pool, {
      projectId: projectA,
      eventEnvelope: {
        protocolVersion: 1,
        eventId: 'evt-sample-metric-regress',
        eventType: 'request',
        occurredAt: 1_800_000_054_000,
        body: {
          method: 'GET',
          url: 'https://api.example.test/orders',
          startedAt: 1_800_000_054_000,
          durationMs: 120,
          outcome: 'success',
          statusCode: 200,
        },
      },
    });
    expect(result.status).toBe('inserted');
  });
});
