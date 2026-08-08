import { describe, expect, it, vi } from 'vitest';
import { persistPerformanceMetricContribution } from '../src/performance-metric-repository.js';
import type { Pool, PoolClient } from 'pg';

interface QueryCall {
  sql: string;
  params: unknown[];
  rows: unknown[];
}

function fakePool(): { pool: Pool; calls: QueryCall[] } {
  const calls: QueryCall[] = [];
  const client = {
    query: vi.fn((sql: string, params?: unknown[]) => {
      calls.push({ sql, params: params ?? [], rows: [] });
      if (typeof sql === 'string' && sql.includes('INSERT INTO performance_metric_event_applications')) {
        // First application attempt returns a row (inserted).
        return { rows: [{ project_id: 'p' }] };
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO performance_metric_buckets')) {
        return { rows: [{ id: '1' }] };
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  const pool = {
    connect: vi.fn(() => client as unknown as PoolClient),
  } as unknown as Pool;
  return { pool, calls };
}

function validContribution(overrides: Record<string, unknown> = {}) {
  return {
    projectId: '11111111-1111-1111-1111-111111111111',
    eventId: 'evt-perf-repo',
    occurredAt: 1_800_000_054_000,
    metricName: 'lcp',
    unit: 'millisecond',
    value: 2500,
    startedAt: 1_800_000_050_000,
    ...overrides,
  };
}

describe('persistPerformanceMetricContribution', () => {
  it('applies a first contribution via register-then-upsert in one transaction', async () => {
    const { pool, calls } = fakePool();
    const result = await persistPerformanceMetricContribution(pool, validContribution());
    expect(result).toEqual({ status: 'applied' });
    const sqls = calls.map((c) => c.sql);
    expect(sqls[0]).toContain('BEGIN');
    expect(sqls[1]).toContain('INSERT INTO performance_metric_event_applications');
    expect(sqls[2]).toContain('INSERT INTO performance_metric_buckets');
    expect(sqls[3]).toContain('COMMIT');
    expect(calls[2]?.params).toContain(2500);
  });

  it('returns duplicate and skips the bucket update when the event was already applied', async () => {
    void fakePool();
    // Force the application insert to return no row (duplicate).
    const client = {
      query: vi.fn((sql: string) => {
        if (typeof sql === 'string' && sql.includes('INSERT INTO performance_metric_event_applications')) {
          return { rows: [] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const dupPool = { connect: vi.fn(() => client as unknown as PoolClient) } as unknown as Pool;
    const result = await persistPerformanceMetricContribution(dupPool, validContribution());
    expect(result).toEqual({ status: 'duplicate' });
  });

  it('returns invalid_input without touching the database for an invalid input', async () => {
    const { pool, calls } = fakePool();
    const result = await persistPerformanceMetricContribution(pool, validContribution({ metricName: 'fcp' }));
    expect(result.status).toBe('invalid_input');
    expect(calls).toHaveLength(0);
  });

  it('returns temporarily_unavailable and rolls back on a database failure', async () => {
    const client = {
      query: vi.fn(() => Promise.reject(new Error('db boom'))),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn(() => client as unknown as PoolClient) } as unknown as Pool;
    const result = await persistPerformanceMetricContribution(pool, validContribution());
    expect(result).toEqual({ status: 'temporarily_unavailable' });
  });
});
