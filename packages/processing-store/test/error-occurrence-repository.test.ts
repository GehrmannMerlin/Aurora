import { describe, expect, it, vi } from 'vitest';
import { persistErrorEventOccurrence } from '../src/error-occurrence-repository.js';

interface InsertOutcome {
  rows: readonly { id: string }[];
  error?: Error;
}

/** Fake pg client/pool. BEGIN/COMMIT succeed; INSERT outcome is scriptable; ROLLBACK may fail. */
function makeClient() {
  const insertCalls: { sql: string; params: readonly unknown[] }[] = [];
  const rollbackCalls: string[] = [];
  const released = { count: 0 };
  const queue: InsertOutcome[] = [];
  let rollbackError: Error | undefined;

  const query = vi.fn(
    (sql: string, params?: readonly unknown[]): Promise<{ rows: readonly { id: string }[] }> => {
      if (sql.trimStart().startsWith('INSERT')) {
        insertCalls.push({ sql, params: params ?? [] });
        const outcome = queue.shift() ?? { rows: [] };
        if (outcome.error !== undefined) return Promise.reject(outcome.error);
        return Promise.resolve(outcome);
      }
      if (sql === 'ROLLBACK') {
        rollbackCalls.push(sql);
        if (rollbackError !== undefined) return Promise.reject(rollbackError);
        return Promise.resolve({ rows: [] });
      }
      // BEGIN and COMMIT always succeed.
      return Promise.resolve({ rows: [] });
    },
  );

  const client = {
    query,
    release: () => {
      released.count += 1;
    },
  };
  return {
    client,
    queue,
    insertCalls,
    rollbackCalls,
    released,
    setRollbackError: (error: Error) => {
      rollbackError = error;
    },
  };
}

const validInput = {
  projectId: 'p-repo',
  eventEnvelope: {
    protocolVersion: 1,
    eventId: 'evt-processing-repo-1',
    eventType: 'error',
    occurredAt: 1_800_000_003_001,
    body: { category: 'javascript', error: { message: 'Synthetic runtime failure' } },
  },
};

describe('persistErrorEventOccurrence', () => {
  it('returns invalid_input when the input does not parse', async () => {
    const { client, insertCalls } = makeClient();
    const pool = { connect: () => Promise.resolve(client) } as never;
    const result = await persistErrorEventOccurrence(pool, { projectId: 'p', eventEnvelope: {} });
    expect(result).toEqual({ status: 'invalid_input', code: 'invalid_envelope' });
    expect(insertCalls).toHaveLength(0);
  });

  it('maps a first insert to inserted with the occurrence id', async () => {
    const { client, queue, insertCalls, released } = makeClient();
    queue.push({ rows: [{ id: '7' }] });
    const pool = { connect: () => Promise.resolve(client) } as never;
    const result = await persistErrorEventOccurrence(pool, validInput);
    expect(result).toEqual({ status: 'inserted', occurrenceId: '7' });
    expect(released.count).toBe(1);
    expect(insertCalls).toHaveLength(1);
    const insert = insertCalls[0];
    if (insert === undefined) throw new Error('expected one insert call');
    expect(insert.params[0]).toBe('p-repo');
    expect(insert.params[1]).toBe('evt-processing-repo-1');
    expect(insert.params[2]).toBe(1);
    expect(insert.params[4]).toBe('javascript');
    expect(insert.params[5]).toContain('"category":"javascript"');
  });

  it('maps an ON CONFLICT hit to duplicate', async () => {
    const { client } = makeClient();
    const pool = { connect: () => Promise.resolve(client) } as never;
    const result = await persistErrorEventOccurrence(pool, validInput);
    expect(result).toEqual({ status: 'duplicate' });
  });

  it('maps a connection failure to temporarily_unavailable', async () => {
    const { client, queue } = makeClient();
    queue.push({ rows: [], error: new Error('ECONNREFUSED') });
    const pool = { connect: () => Promise.resolve(client) } as never;
    const result = await persistErrorEventOccurrence(pool, validInput);
    expect(result).toEqual({ status: 'temporarily_unavailable' });
  });

  it('maps a statement failure to temporarily_unavailable and rolls back', async () => {
    const { client, queue, rollbackCalls } = makeClient();
    queue.push({ rows: [], error: new Error('syntax error') });
    const pool = { connect: () => Promise.resolve(client) } as never;
    const result = await persistErrorEventOccurrence(pool, validInput);
    expect(result).toEqual({ status: 'temporarily_unavailable' });
    expect(rollbackCalls).toHaveLength(1);
  });

  it('tolerates a failing rollback after an insert failure', async () => {
    const { client, queue, setRollbackError } = makeClient();
    queue.push({ rows: [], error: new Error('syntax error') });
    setRollbackError(new Error('connection closed'));
    const pool = { connect: () => Promise.resolve(client) } as never;
    const result = await persistErrorEventOccurrence(pool, validInput);
    expect(result).toEqual({ status: 'temporarily_unavailable' });
  });

  it('never leaks SQL, SQLSTATE, or constraint text in results', async () => {
    const { client, queue } = makeClient();
    queue.push({
      rows: [],
      error: Object.assign(new Error('duplicate key value violates unique constraint'), {
        code: '23505',
      }),
    });
    const pool = { connect: () => Promise.resolve(client) } as never;
    const result = await persistErrorEventOccurrence(pool, validInput);
    expect(result).toEqual({ status: 'temporarily_unavailable' });
    expect(JSON.stringify(result)).not.toMatch(/23505|constraint|duplicate key/i);
  });

  it('does not mutate the input', async () => {
    const { client, queue } = makeClient();
    queue.push({ rows: [{ id: '9' }] });
    const pool = { connect: () => Promise.resolve(client) } as never;
    const input = structuredClone(validInput);
    await persistErrorEventOccurrence(pool, input);
    expect(input).toEqual(validInput);
  });
});
