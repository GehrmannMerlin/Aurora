import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { persistPerformanceEventSample } from '../../src/index.js';
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

interface SampleRow {
  id: string;
  project_id: string;
  event_id: string;
  occurred_at: string;
  sample_body: Record<string, unknown>;
}

const projectA = '11111111-1111-1111-1111-111111111111';

function envelope(eventId: string, bodyOverrides: Record<string, unknown> = {}) {
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

describeDb('processing-store performance event sample (real PostgreSQL 17)', () => {
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
    await pool.query('DROP TABLE IF EXISTS issue_samples CASCADE');
    await pool.query('DROP TABLE IF EXISTS issue_event_applications CASCADE');
    await pool.query('DROP TABLE IF EXISTS issues CASCADE');
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

  it('inserts one safe sample with a whitelist projection body', async () => {
    const result = await persistPerformanceEventSample(pool, {
      projectId: projectA,
      eventEnvelope: envelope('evt-perf-sample-1'),
    });
    expect(result.status).toBe('inserted');
    if (result.status !== 'inserted') return;
    expect(result.sampleId).toBeTruthy();
    const row = await queryRow<SampleRow>(
      pool,
      `SELECT * FROM performance_event_samples WHERE event_id = 'evt-perf-sample-1'`,
    );
    expect(row?.project_id).toBe(projectA);
    expect(row?.sample_body).toEqual({
      metricName: 'lcp',
      value: 2500,
      unit: 'millisecond',
      startedAt: 1_800_000_050_000,
    });
  });

  it('includes durationMs in the projection when present', async () => {
    await persistPerformanceEventSample(pool, {
      projectId: projectA,
      eventEnvelope: envelope('evt-perf-sample-dur', { durationMs: 300 }),
    });
    const row = await queryRow<SampleRow>(
      pool,
      `SELECT * FROM performance_event_samples WHERE event_id = 'evt-perf-sample-dur'`,
    );
    expect(row?.sample_body).toMatchObject({ durationMs: 300 });
  });

  it('treats a replay as idempotent: one row only', async () => {
    const first = await persistPerformanceEventSample(pool, {
      projectId: projectA,
      eventEnvelope: envelope('evt-perf-sample-dup'),
    });
    const second = await persistPerformanceEventSample(pool, {
      projectId: projectA,
      eventEnvelope: envelope('evt-perf-sample-dup'),
    });
    expect(first.status).toBe('inserted');
    expect(second.status).toBe('duplicate');
    const rows = await queryRows<SampleRow>(
      pool,
      `SELECT * FROM performance_event_samples WHERE event_id = 'evt-perf-sample-dup'`,
    );
    expect(rows).toHaveLength(1);
  });

  it('rejects a non-performance envelope without inserting', async () => {
    const result = await persistPerformanceEventSample(pool, {
      projectId: projectA,
      eventEnvelope: {
        protocolVersion: 1,
        eventId: 'evt-perf-sample-bad',
        eventType: 'error',
        occurredAt: 1_800_000_054_000,
        body: { category: 'javascript', error: { message: 'x' } },
      },
    });
    expect(result.status).toBe('invalid_input');
    const rows = await queryRows<SampleRow>(
      pool,
      `SELECT * FROM performance_event_samples WHERE event_id = 'evt-perf-sample-bad'`,
    );
    expect(rows).toHaveLength(0);
  });

  it('rejects an unapproved metric name', async () => {
    const result = await persistPerformanceEventSample(pool, {
      projectId: projectA,
      eventEnvelope: envelope('evt-perf-sample-fcp', { metricName: 'fcp' }),
    });
    expect(result.status).toBe('invalid_input');
  });
});
