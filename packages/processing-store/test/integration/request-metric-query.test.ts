import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  persistRequestEventSample,
  persistRequestMetricContribution,
  queryRequestEndpointPage,
  queryRequestMetricSummary,
} from '../../src/index.js';
import { decodeEndpointCursor, endpointIdOf } from '../../src/request-metric-query-repository.js';
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

const ORDERS_URL = 'https://api.example.test/orders';
const PAYMENTS_URL = 'https://api.example.test/payments';

/** RFC 3339 UTC with millisecond precision (Date.toISOString shape). */
const rfc3339Utc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

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
    eventId: 'q-metric-default',
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

function requestSample(
  projectId: string,
  eventId: string,
  body: Record<string, unknown>,
  occurredAt: number,
): unknown {
  return {
    projectId,
    eventEnvelope: {
      protocolVersion: 1,
      eventId,
      eventType: 'request',
      occurredAt,
      body,
    },
  };
}

function sortOutcomes(
  outcomes: ReadonlyArray<{ readonly outcome: string; readonly count: number }>,
): Array<{ outcome: string; count: number }> {
  return [...outcomes]
    .map((o) => ({ outcome: o.outcome, count: o.count }))
    .sort((a, b) => a.outcome.localeCompare(b.outcome));
}

describeDb('processing-store request metric query repositories (real PostgreSQL 17)', () => {
  let pool: Pool;

  beforeAll(async () => {
    assertIsTestDatabase(testDatabaseUrl());
    pool = createTestPool();
    await pool.query('DROP TABLE IF EXISTS request_metric_event_applications CASCADE');
    await pool.query('DROP TABLE IF EXISTS request_metric_buckets CASCADE');
    await pool.query('DROP TABLE IF EXISTS request_event_samples CASCADE');
    await pool.query('DROP TABLE IF EXISTS error_event_occurrences CASCADE');
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

  it('aggregates the request metric summary by method over the window', async () => {
    // GET observed=2 across two UTC buckets; POST observed=1.
    await persistRequestMetricContribution(
      pool,
      contribution({ eventId: 'q-get-1', durationMs: 120, occurredAt: 1_800_000_054_000 }),
    );
    await persistRequestMetricContribution(
      pool,
      contribution({ eventId: 'q-get-2', durationMs: 250, occurredAt: 1_800_000_060_000 }),
    );
    await persistRequestMetricContribution(
      pool,
      contribution({ eventId: 'q-post-1', method: 'POST', statusCode: 201, durationMs: 300 }),
    );

    const summary = await queryRequestMetricSummary(pool, { projectId: projectA, ...WINDOW });

    const get = summary.methods.find((m) => m.method === 'GET');
    const post = summary.methods.find((m) => m.method === 'POST');
    expect(get).toBeDefined();
    expect(post).toBeDefined();
    expect(get?.observedCount).toBe(2);
    expect(get?.failureCount).toBe(0);
    expect(get?.slowCount).toBe(0);
    expect(get?.durationSumMs).toBe(370);
    expect(get?.durationMaxMs).toBe(250);
    expect(sortOutcomes(get?.outcomes ?? [])).toEqual([{ outcome: 'success', count: 2 }]);
    expect(post?.observedCount).toBe(1);
    expect(post?.durationSumMs).toBe(300);
    expect(post?.durationMaxMs).toBe(300);
    expect(summary.dataThrough).toMatch(rfc3339Utc);
  });

  it('aggregates failure and slow counts and their durations', async () => {
    await persistRequestMetricContribution(
      pool,
      contribution({ eventId: 'q-get-fail', outcome: 'network_error', durationMs: 500, isFailure: true }),
    );
    await persistRequestMetricContribution(
      pool,
      contribution({ eventId: 'q-post-slow', method: 'POST', outcome: 'timeout', durationMs: 5000, isSlow: true }),
    );

    const summary = await queryRequestMetricSummary(pool, { projectId: projectA, ...WINDOW });
    const get = summary.methods.find((m) => m.method === 'GET');
    const post = summary.methods.find((m) => m.method === 'POST');

    expect(get?.observedCount).toBe(3);
    expect(get?.failureCount).toBe(1);
    expect(get?.slowCount).toBe(0);
    expect(get?.durationSumMs).toBe(870);
    expect(get?.durationMaxMs).toBe(500);
    expect(sortOutcomes(get?.outcomes ?? [])).toEqual([
      { outcome: 'network_error', count: 1 },
      { outcome: 'success', count: 2 },
    ]);

    expect(post?.observedCount).toBe(2);
    expect(post?.slowCount).toBe(1);
    expect(post?.durationSumMs).toBe(5300);
    expect(post?.durationMaxMs).toBe(5000);
    expect(sortOutcomes(post?.outcomes ?? [])).toEqual([
      { outcome: 'success', count: 1 },
      { outcome: 'timeout', count: 1 },
    ]);
  });

  it('returns an empty summary for a window with no buckets', async () => {
    const summary = await queryRequestMetricSummary(pool, {
      projectId: projectA,
      startIso: '2027-02-01T00:00:00.000Z',
      endIso: '2027-02-01T01:00:00.000Z',
    });
    expect(summary.methods).toEqual([]);
    expect(summary.dataThrough).toBeNull();
  });

  it('does not leak another project buckets into the summary', async () => {
    const summary = await queryRequestMetricSummary(pool, { projectId: projectB, ...WINDOW });
    expect(summary.methods).toEqual([]);
    expect(summary.dataThrough).toBeNull();
  });

  it('lists endpoints derived from bounded diagnostic samples', async () => {
    await persistRequestEventSample(
      pool,
      requestSample(
        projectA,
        'q-smp-1',
        { method: 'GET', url: ORDERS_URL, startedAt: 1_800_000_054_000, durationMs: 120, outcome: 'success', statusCode: 200 },
        1_800_000_054_000,
      ),
    );
    await persistRequestEventSample(
      pool,
      requestSample(
        projectA,
        'q-smp-2',
        { method: 'GET', url: ORDERS_URL, startedAt: 1_800_000_054_500, durationMs: 130, outcome: 'success', statusCode: 200 },
        1_800_000_054_500,
      ),
    );
    await persistRequestEventSample(
      pool,
      requestSample(
        projectA,
        'q-smp-3',
        { method: 'POST', url: PAYMENTS_URL, startedAt: 1_800_000_054_100, durationMs: 5000, outcome: 'timeout' },
        1_800_000_054_100,
      ),
    );

    const page = await queryRequestEndpointPage(pool, { projectId: projectA, ...WINDOW, limit: 50 });
    expect(page.totalCount).toBe(2);
    expect(page.nextCursor).toBeNull();
    expect(page.items).toHaveLength(2);

    const [orders, payments] = page.items;
    expect(orders?.method).toBe('GET');
    expect(orders?.url).toBe(ORDERS_URL);
    expect(orders?.endpointId).toMatch(/^[0-9a-f]{64}$/);
    expect(orders?.endpointId).toBe(endpointIdOf('GET', ORDERS_URL));
    expect(orders?.sampleCount).toBe(2);
    expect(orders?.outcomeCounts).toEqual([{ outcome: 'success', count: 2 }]);
    expect(orders?.dataThrough).toMatch(rfc3339Utc);
    expect(orders?.isPartial).toBe(true);
    expect(orders?.completeness).toEqual({ source: 'diagnostic_samples', bounded: true });

    expect(payments?.method).toBe('POST');
    expect(payments?.url).toBe(PAYMENTS_URL);
    expect(payments?.sampleCount).toBe(1);
    expect(payments?.outcomeCounts).toEqual([{ outcome: 'timeout', count: 1 }]);
    expect(payments?.isPartial).toBe(true);
    expect(payments?.completeness).toEqual({ source: 'diagnostic_samples', bounded: true });
  });

  it('paginates endpoints via a (method, url) keyset cursor', async () => {
    const first = await queryRequestEndpointPage(pool, { projectId: projectA, ...WINDOW, limit: 1 });
    expect(first.items).toHaveLength(1);
    expect(first.items[0]?.url).toBe(ORDERS_URL);
    expect(first.totalCount).toBe(2);
    expect(first.nextCursor).not.toBeNull();
    expect(decodeEndpointCursor(first.nextCursor as string)).toEqual({
      method: 'GET',
      url: ORDERS_URL,
    });

    const second = await queryRequestEndpointPage(pool, {
      projectId: projectA,
      ...WINDOW,
      cursor: first.nextCursor as string,
      limit: 1,
    });
    expect(second.items).toHaveLength(1);
    expect(second.items[0]?.url).toBe(PAYMENTS_URL);
    expect(second.totalCount).toBe(2);
    expect(second.nextCursor).toBeNull();
  });

  it('aggregates multiple outcome counts per endpoint', async () => {
    await persistRequestEventSample(
      pool,
      requestSample(
        projectA,
        'q-smp-4',
        { method: 'GET', url: ORDERS_URL, startedAt: 1_800_000_055_000, durationMs: 90, outcome: 'http_error', statusCode: 500 },
        1_800_000_055_000,
      ),
    );

    const page = await queryRequestEndpointPage(pool, { projectId: projectA, ...WINDOW, limit: 50 });
    const orders = page.items.find((i) => i.url === ORDERS_URL);
    expect(orders?.sampleCount).toBe(3);
    // Ordered by outcome inside the aggregate: http_error < success.
    expect(orders?.outcomeCounts).toEqual([
      { outcome: 'http_error', count: 1 },
      { outcome: 'success', count: 2 },
    ]);
    expect(page.totalCount).toBe(2);
  });

  it('returns an empty endpoint page for a window with no samples and for another project', async () => {
    const empty = await queryRequestEndpointPage(pool, {
      projectId: projectA,
      startIso: '2027-02-01T00:00:00.000Z',
      endIso: '2027-02-01T01:00:00.000Z',
      limit: 50,
    });
    expect(empty.items).toEqual([]);
    expect(empty.nextCursor).toBeNull();
    expect(empty.totalCount).toBe(0);

    const isolated = await queryRequestEndpointPage(pool, { projectId: projectB, ...WINDOW, limit: 50 });
    expect(isolated.items).toEqual([]);
    expect(isolated.totalCount).toBe(0);
  });
});
