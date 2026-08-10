import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  persistPerformanceMetricContribution,
  queryPerformanceMetricSummary,
} from '../../src/index.js';
import {
  assertIsTestDatabase,
  createTestPool,
  testDatabaseUrl,
} from './helpers.js';

const migrationsDir = fileURLToPath(new URL('../../migrations', import.meta.url));
const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const describeDb = hasDb ? describe : describe.skip;

const projectA = '11111111-1111-1111-1111-111111111111';
const projectB = '22222222-2222-2222-2222-222222222222';

const WINDOW = {
  startIso: '2027-01-15T08:00:00.000Z',
  endIso: '2027-01-15T09:00:00.000Z',
};

/** RFC 3339 UTC with millisecond precision (Date.toISOString shape). */
const rfc3339Utc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function contribution(
  overrides: Partial<{
    projectId: string;
    eventId: string;
    occurredAt: number;
    metricName: string;
    unit: string;
    value: number;
    startedAt: number;
  }>,
): Record<string, unknown> {
  return {
    projectId: projectA,
    eventId: 'q-perf-default',
    occurredAt: 1_800_000_054_000,
    metricName: 'lcp',
    unit: 'millisecond',
    value: 2500,
    startedAt: 1_800_000_050_000,
    ...overrides,
  };
}

describeDb('processing-store performance metric query repository (real PostgreSQL 17)', () => {
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

  it('aggregates a single metric across multiple UTC buckets (count/sum/max/mean)', async () => {
    await persistPerformanceMetricContribution(
      pool,
      contribution({ eventId: 'q-lcp-1', value: 2500 }),
    );
    await persistPerformanceMetricContribution(
      pool,
      contribution({ eventId: 'q-lcp-2', value: 3200, occurredAt: 1_800_000_060_000 }),
    );

    const summary = await queryPerformanceMetricSummary(pool, { projectId: projectA, ...WINDOW });

    const lcp = summary.metrics.find((m) => m.metricName === 'lcp');
    expect(lcp).toBeDefined();
    expect(lcp?.unit).toBe('millisecond');
    expect(lcp?.observedCount).toBe(2);
    expect(lcp?.valueSum).toBe(5700);
    expect(lcp?.valueMax).toBe(3200);
    expect(lcp?.mean).toBe(2850);
    expect(summary.dataThrough).toMatch(rfc3339Utc);
  });

  it('groups multiple metrics and units as separate aggregates', async () => {
    await persistPerformanceMetricContribution(
      pool,
      contribution({ eventId: 'q-cls', metricName: 'cls', unit: 'ratio', value: 0.12 }),
    );
    await persistPerformanceMetricContribution(
      pool,
      contribution({ eventId: 'q-inp', metricName: 'inp', unit: 'millisecond', value: 100 }),
    );
    await persistPerformanceMetricContribution(
      pool,
      contribution({ eventId: 'q-page-load', metricName: 'page_load', unit: 'millisecond', value: 1500 }),
    );

    const summary = await queryPerformanceMetricSummary(pool, { projectId: projectA, ...WINDOW });
    const byName = new Map(summary.metrics.map((m) => [m.metricName, m]));

    const cls = byName.get('cls');
    expect(cls?.unit).toBe('ratio');
    expect(cls?.observedCount).toBe(1);
    expect(cls?.valueSum).toBeCloseTo(0.12);
    expect(cls?.valueMax).toBeCloseTo(0.12);
    expect(cls?.mean).toBeCloseTo(0.12);

    const inp = byName.get('inp');
    expect(inp?.unit).toBe('millisecond');
    expect(inp?.observedCount).toBe(1);
    expect(inp?.valueSum).toBe(100);
    expect(inp?.valueMax).toBe(100);
    expect(inp?.mean).toBe(100);

    const pageLoad = byName.get('page_load');
    expect(pageLoad?.unit).toBe('millisecond');
    expect(pageLoad?.observedCount).toBe(1);
    expect(pageLoad?.valueSum).toBe(1500);
    expect(pageLoad?.valueMax).toBe(1500);
    expect(pageLoad?.mean).toBe(1500);
  });

  it('reports dataThrough as the latest bucket updated_at in the window', async () => {
    const beforeMs = Date.now();
    await persistPerformanceMetricContribution(
      pool,
      contribution({ eventId: 'q-data-through', metricName: 'inp', unit: 'millisecond', value: 300 }),
    );

    const summary = await queryPerformanceMetricSummary(pool, { projectId: projectA, ...WINDOW });
    expect(summary.dataThrough).toMatch(rfc3339Utc);
    const dataThroughMs = summary.dataThrough === null ? 0 : new Date(summary.dataThrough).getTime();
    expect(dataThroughMs).toBeGreaterThanOrEqual(beforeMs - 1000);
  });

  it('returns an empty summary for a window with no buckets', async () => {
    const summary = await queryPerformanceMetricSummary(pool, {
      projectId: projectA,
      startIso: '2027-02-01T00:00:00.000Z',
      endIso: '2027-02-01T01:00:00.000Z',
    });
    expect(summary.metrics).toEqual([]);
    expect(summary.dataThrough).toBeNull();
  });

  it('does not leak another project buckets into the summary', async () => {
    await persistPerformanceMetricContribution(
      pool,
      contribution({ projectId: projectB, eventId: 'q-isolated', metricName: 'inp', unit: 'millisecond', value: 200 }),
    );

    // projectB's inp=200 bucket must not appear in projectA's summary.
    const summaryA = await queryPerformanceMetricSummary(pool, { projectId: projectA, ...WINDOW });
    expect(summaryA.metrics.some((m) => m.valueSum === 200)).toBe(false);

    // projectA's buckets must not leak into projectB either.
    const summaryB = await queryPerformanceMetricSummary(pool, { projectId: projectB, ...WINDOW });
    expect(summaryB.metrics).toEqual([
      {
        metricName: 'inp',
        unit: 'millisecond',
        observedCount: 1,
        valueSum: 200,
        valueMax: 200,
        mean: 200,
      },
    ]);
  });
});
