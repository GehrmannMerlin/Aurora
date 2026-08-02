import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EventEnvelope } from '@aurora/event-schema';
import { persistBatch } from '../../src/index.js';
import { createTestPool, queryRows, testDatabaseUrl } from './helpers.js';

const migrationsDir = fileURLToPath(new URL('../../migrations', import.meta.url));
const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const describeDb = hasDb ? describe : describe.skip;

const projectA = '11111111-1111-1111-1111-111111111111';
const projectB = '22222222-2222-2222-2222-222222222222';

interface CountRow {
  n: number;
}
interface EnvelopeRow {
  envelope: unknown;
}
interface ColumnRow {
  column_name: string;
}

describeDb('ingestion-inbox persistBatch (real PostgreSQL 17)', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = createTestPool();
    // Guarantee the event_inbox schema exists regardless of test-file ordering.
    await runner({
      databaseUrl: testDatabaseUrl(),
      dir: migrationsDir,
      direction: 'up',
      migrationsTable: 'pgmigrations',
      count: Infinity,
      log: () => undefined,
    });
    await pool.query('DELETE FROM event_inbox');
  });

  afterAll(async () => {
    await pool.end();
  });

  function envelope(eventId: string, eventType: 'error' | 'performance' = 'error') {
    const envelope: EventEnvelope = {
      protocolVersion: 1,
      eventId,
      eventType,
      occurredAt: 1_800_000_000_000,
      body: {},
    };
    return envelope;
  }

  it('inserts a single new event and reports inserted', async () => {
    const result = await persistBatch(pool, {
      projectId: projectA,
      events: [{ batchIndex: 0, event: envelope('evt-inbox-a-1') }],
    });
    expect(result.perEventResults).toEqual([{ eventId: 'evt-inbox-a-1', outcome: 'inserted' }]);
    const rows = await queryRows<CountRow>(
      pool,
      'SELECT count(*)::int AS n FROM event_inbox WHERE project_id = $1 AND event_id = $2',
      [projectA, 'evt-inbox-a-1'],
    );
    expect(rows[0]?.n).toBe(1);
  });

  it('reports duplicate for the same (project_id, event_id) and keeps one row', async () => {
    const result = await persistBatch(pool, {
      projectId: projectA,
      events: [{ batchIndex: 0, event: envelope('evt-inbox-a-1') }],
    });
    expect(result.perEventResults).toEqual([{ eventId: 'evt-inbox-a-1', outcome: 'duplicate' }]);
    const rows = await queryRows<CountRow>(
      pool,
      'SELECT count(*)::int AS n FROM event_inbox WHERE project_id = $1 AND event_id = $2',
      [projectA, 'evt-inbox-a-1'],
    );
    expect(rows[0]?.n).toBe(1);
  });

  it('allows the same eventId in different projects', async () => {
    await persistBatch(pool, {
      projectId: projectB,
      events: [{ batchIndex: 0, event: envelope('evt-inbox-a-1') }],
    });
    const rows = await queryRows<CountRow>(
      pool,
      'SELECT count(*)::int AS n FROM event_inbox WHERE event_id = $1',
      ['evt-inbox-a-1'],
    );
    expect(rows[0]?.n).toBe(2);
  });

  it('handles a mixed batch: new + duplicate events all committed', async () => {
    const result = await persistBatch(pool, {
      projectId: projectA,
      events: [
        { batchIndex: 0, event: envelope('evt-inbox-mix-new') },
        { batchIndex: 1, event: envelope('evt-inbox-a-1') },
      ],
    });
    expect(result.perEventResults).toEqual([
      { eventId: 'evt-inbox-mix-new', outcome: 'inserted' },
      { eventId: 'evt-inbox-a-1', outcome: 'duplicate' },
    ]);
    const rows = await queryRows<CountRow>(
      pool,
      'SELECT count(*)::int AS n FROM event_inbox WHERE event_id = $1',
      ['evt-inbox-mix-new'],
    );
    expect(rows[0]?.n).toBe(1);
  });

  it('rolls back the whole batch on a statement failure and leaves no accepted record', async () => {
    const before = await queryRows<CountRow>(pool, 'SELECT count(*)::int AS n FROM event_inbox');
    await expect(
      persistBatch(pool, {
        projectId: 'not-a-uuid', // violates uuid column type -> statement failure
        events: [{ batchIndex: 0, event: envelope('evt-inbox-fail-1') }],
      }),
    ).rejects.toMatchObject({ kind: 'statement_failed' });
    const after = await queryRows<CountRow>(pool, 'SELECT count(*)::int AS n FROM event_inbox');
    expect(after[0]?.n).toBe(before[0]?.n);
    const failed = await queryRows<CountRow>(
      pool,
      'SELECT count(*)::int AS n FROM event_inbox WHERE event_id = $1',
      ['evt-inbox-fail-1'],
    );
    expect(failed[0]?.n).toBe(0);
  });

  it('preserves the EventEnvelope exactly through JSONB round-trip', async () => {
    const event = envelope('evt-inbox-env-1', 'performance');
    const body = { metricName: 'lcp', value: 1234 };
    const withBody = { ...event, body };
    await persistBatch(pool, {
      projectId: projectA,
      events: [{ batchIndex: 0, event: withBody }],
    });
    const rows = await queryRows<EnvelopeRow>(
      pool,
      'SELECT envelope FROM event_inbox WHERE project_id = $1 AND event_id = $2',
      [projectA, 'evt-inbox-env-1'],
    );
    expect(rows[0]?.envelope).toEqual(withBody);
  });

  it('stores no client key, secret, or authorization columns', async () => {
    const columns = await queryRows<ColumnRow>(
      pool,
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'event_inbox'`,
    );
    const names = columns.map((row) => row.column_name);
    for (const forbidden of ['client_key', 'secret', 'authorization', 'cookie']) {
      expect(names).not.toContain(forbidden);
    }
  });
});
