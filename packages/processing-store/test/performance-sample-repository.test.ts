import { describe, expect, it, vi } from 'vitest';
import { persistPerformanceEventSample } from '../src/performance-sample-repository.js';
import type { Pool, PoolClient } from 'pg';

function performanceEnvelope(eventId: string) {
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
    },
  };
}

function fakePool(insertRows: unknown[]): { pool: Pool; sqls: string[] } {
  const sqls: string[] = [];
  const client = {
    query: vi.fn((sql: string, params?: unknown[]) => {
      sqls.push(sql);
      void params;
      if (typeof sql === 'string' && sql.includes('INSERT INTO performance_event_samples')) {
        return { rows: insertRows };
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  const pool = { connect: vi.fn(() => client as unknown as PoolClient) } as unknown as Pool;
  return { pool, sqls };
}

describe('persistPerformanceEventSample', () => {
  it('inserts a first sample and returns the sample id', async () => {
    const { pool, sqls } = fakePool([{ id: '7' }]);
    const result = await persistPerformanceEventSample(pool, {
      projectId: '11111111-1111-1111-1111-111111111111',
      eventEnvelope: performanceEnvelope('evt-perf-sample-1'),
    });
    expect(result).toEqual({ status: 'inserted', sampleId: '7' });
    expect(sqls[0]).toContain('BEGIN');
    expect(sqls[1]).toContain('INSERT INTO performance_event_samples');
    expect(sqls[2]).toContain('COMMIT');
  });

  it('returns duplicate when the sample already exists', async () => {
    const { pool } = fakePool([]);
    const result = await persistPerformanceEventSample(pool, {
      projectId: '11111111-1111-1111-1111-111111111111',
      eventEnvelope: performanceEnvelope('evt-perf-sample-dup'),
    });
    expect(result).toEqual({ status: 'duplicate' });
  });

  it('returns invalid_input without touching the database for an invalid envelope', async () => {
    const { pool, sqls } = fakePool([]);
    const result = await persistPerformanceEventSample(pool, {
      projectId: '11111111-1111-1111-1111-111111111111',
      eventEnvelope: { protocolVersion: 1, eventId: 'evt-bad', eventType: 'error', occurredAt: 1, body: {} },
    });
    expect(result.status).toBe('invalid_input');
    expect(sqls).toHaveLength(0);
  });

  it('returns temporarily_unavailable and rolls back on a database failure', async () => {
    const client = {
      query: vi.fn(() => Promise.reject(new Error('db boom'))),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn(() => client as unknown as PoolClient) } as unknown as Pool;
    const result = await persistPerformanceEventSample(pool, {
      projectId: '11111111-1111-1111-1111-111111111111',
      eventEnvelope: performanceEnvelope('evt-perf-sample-fail'),
    });
    expect(result).toEqual({ status: 'temporarily_unavailable' });
  });
});
