import { describe, expect, it, vi } from 'vitest';
import { persistRequestMetricContribution } from '../src/request-metric-repository.js';

/** Fake pg client/pool for the two-statement metric transaction. */
function makeClient() {
  const applicationCalls: { sql: string; params: readonly unknown[] }[] = [];
  const bucketCalls: { sql: string; params: readonly unknown[] }[] = [];
  const rollbackCalls: string[] = [];
  const released = { count: 0 };
  let applicationOutcome: { rows: readonly { project_id: string }[]; error?: Error } = {
    rows: [{ project_id: 'p' }],
  };
  let bucketOutcome: { rows: readonly { id: string }[]; error?: Error } = { rows: [{ id: '9' }] };

  const query = vi.fn(
    (sql: string, params?: readonly unknown[]): Promise<{ rows: readonly unknown[] }> => {
      if (sql.trimStart().startsWith('INSERT INTO request_metric_event_applications')) {
        applicationCalls.push({ sql, params: params ?? [] });
        if (applicationOutcome.error !== undefined) return Promise.reject(applicationOutcome.error);
        return Promise.resolve(applicationOutcome);
      }
      if (sql.trimStart().startsWith('INSERT INTO request_metric_buckets')) {
        bucketCalls.push({ sql, params: params ?? [] });
        if (bucketOutcome.error !== undefined) return Promise.reject(bucketOutcome.error);
        return Promise.resolve(bucketOutcome);
      }
      if (sql === 'ROLLBACK') {
        rollbackCalls.push(sql);
        return Promise.resolve({ rows: [] });
      }
      // BEGIN and COMMIT always succeed.
      return Promise.resolve({ rows: [] });
    },
  );

  const client = { query, release: () => { released.count += 1; } };
  return {
    client,
    applicationCalls,
    bucketCalls,
    rollbackCalls,
    released,
    setApplication: (rows: readonly { project_id: string }[], error?: Error) => {
      applicationOutcome = error === undefined ? { rows } : { rows, error };
    },
    setBucket: (rows: readonly { id: string }[], error?: Error) => {
      bucketOutcome = error === undefined ? { rows } : { rows, error };
    },
  };
}

const validInput = {
  projectId: 'p-metric',
  eventId: 'evt-metric-1',
  occurredAt: 1_800_000_054_000,
  method: 'GET',
  outcome: 'success',
  statusCode: 200,
  durationMs: 120,
  isFailure: false,
  isSlow: false,
};

describe('persistRequestMetricContribution', () => {
  it('returns invalid_input when the input does not parse', async () => {
    const { client, applicationCalls, bucketCalls } = makeClient();
    const pool = { connect: () => Promise.resolve(client) } as never;
    const result = await persistRequestMetricContribution(pool, { projectId: 'p' });
    expect(result.status).toBe('invalid_input');
    expect(applicationCalls).toHaveLength(0);
    expect(bucketCalls).toHaveLength(0);
  });

  it('applies a first contribution and updates the bucket', async () => {
    const { client, applicationCalls, bucketCalls, released } = makeClient();
    const pool = { connect: () => Promise.resolve(client) } as never;
    const result = await persistRequestMetricContribution(pool, validInput);
    expect(result).toEqual({ status: 'applied' });
    expect(released.count).toBe(1);
    expect(applicationCalls).toHaveLength(1);
    expect(bucketCalls).toHaveLength(1);
    const app = applicationCalls[0];
    if (app === undefined) throw new Error('expected application insert');
    expect(app.params[0]).toBe('p-metric');
    expect(app.params[1]).toBe('evt-metric-1');
    const bucket = bucketCalls[0];
    if (bucket === undefined) throw new Error('expected bucket upsert');
    expect(bucket.params[1]).toBe('2027-01-15T08:00:00.000Z');
    expect(bucket.params[2]).toBe('GET');
    expect(bucket.params[3]).toBe('success');
    expect(bucket.params[4]).toBe(200);
    expect(bucket.params[5]).toBe(false); // isFailure
    expect(bucket.params[6]).toBe(false); // isSlow
    expect(bucket.params[7]).toBe(120); // durationMs
  });

  it('returns duplicate and skips the bucket update when the event was already applied', async () => {
    const { client, setApplication, bucketCalls } = makeClient();
    setApplication([]);
    const pool = { connect: () => Promise.resolve(client) } as never;
    const result = await persistRequestMetricContribution(pool, validInput);
    expect(result).toEqual({ status: 'duplicate' });
    expect(bucketCalls).toHaveLength(0);
  });

  it('maps a bucket update failure to temporarily_unavailable and rolls back', async () => {
    const { client, setBucket, rollbackCalls } = makeClient();
    setBucket([], new Error('syntax error'));
    const pool = { connect: () => Promise.resolve(client) } as never;
    const result = await persistRequestMetricContribution(pool, validInput);
    expect(result).toEqual({ status: 'temporarily_unavailable' });
    expect(rollbackCalls).toHaveLength(1);
  });

  it('never leaks SQL, SQLSTATE, or constraint text in results', async () => {
    const { client, setBucket } = makeClient();
    setBucket([], Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' }));
    const pool = { connect: () => Promise.resolve(client) } as never;
    const result = await persistRequestMetricContribution(pool, validInput);
    expect(result).toEqual({ status: 'temporarily_unavailable' });
    expect(JSON.stringify(result)).not.toMatch(/23505|constraint|duplicate key/i);
  });

  it('does not mutate the input', async () => {
    const { client } = makeClient();
    const pool = { connect: () => Promise.resolve(client) } as never;
    const input = structuredClone(validInput);
    await persistRequestMetricContribution(pool, input);
    expect(input).toEqual(validInput);
  });
});
