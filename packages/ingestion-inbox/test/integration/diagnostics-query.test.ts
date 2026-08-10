import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EventEnvelope } from '@aurora/event-schema';
import { persistBatch, queryProjectInboxDiagnostics } from '../../src/index.js';
import { assertIsTestDatabase, createTestPool, testDatabaseUrl } from './helpers.js';

const migrationsDir = fileURLToPath(new URL('../../migrations', import.meta.url));
const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const describeDb = hasDb ? describe : describe.skip;

const projectA = '11111111-1111-1111-1111-111111111111';
const projectB = '22222222-2222-2222-2222-222222222222';
const projectEmpty = '99999999-9999-9999-9999-999999999999';

const WINDOW = {
  startIso: '2027-03-01T00:00:00.000Z',
  endIso: '2027-03-01T01:00:00.000Z',
};

function envelope(eventId: string): EventEnvelope {
  return {
    protocolVersion: 1,
    eventId,
    eventType: 'error',
    occurredAt: 1_800_000_000_000,
    body: { category: 'javascript', error: { message: 'Synthetic runtime failure' } },
  };
}

/** Insert one row via the real persistBatch write path at a controlled receivedAt. */
async function insertAt(
  pool: Pool,
  projectId: string,
  eventId: string,
  receivedAtIso: string,
): Promise<void> {
  await persistBatch(pool, {
    projectId,
    events: [{ batchIndex: 0, event: envelope(eventId) }],
    receivedAt: new Date(receivedAtIso).getTime(),
  });
}

/** Directly set the state and diagnostic timestamps (dead-letter is not reachable via persistBatch alone). */
async function setState(
  pool: Pool,
  projectId: string,
  eventId: string,
  state: string,
  opts: { processedAt?: string; deadLetteredAt?: string; lastErrorCode?: string | null } = {},
): Promise<void> {
  await pool.query(
    `UPDATE event_inbox
     SET state = $1,
         processed_at = $2,
         dead_lettered_at = $3,
         last_error_code = $4
     WHERE project_id = $5 AND event_id = $6`,
    [
      state,
      opts.processedAt ?? null,
      opts.deadLetteredAt ?? null,
      opts.lastErrorCode ?? null,
      projectId,
      eventId,
    ],
  );
}

describeDb('ingestion-inbox project diagnostics query (real PostgreSQL 17)', () => {
  let pool: Pool;

  beforeAll(async () => {
    assertIsTestDatabase(testDatabaseUrl());
    pool = createTestPool();
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

  it('counts each state and reports latest timestamps + last error code in the window', async () => {
    await pool.query('DELETE FROM event_inbox WHERE project_id = $1', [projectA]);
    // 2 processed, 1 pending, 1 retry_waiting, 1 dead_lettered (5 rows).
    await insertAt(pool, projectA, 'diag-p-1', '2027-03-01T00:05:00.000Z'); // pending
    await insertAt(pool, projectA, 'diag-r-1', '2027-03-01T00:06:00.000Z'); // retry_waiting
    await insertAt(pool, projectA, 'diag-d-1', '2027-03-01T00:07:00.000Z'); // dead_lettered
    await insertAt(pool, projectA, 'diag-o-1', '2027-03-01T00:08:00.000Z'); // processed
    await insertAt(pool, projectA, 'diag-o-2', '2027-03-01T00:09:00.000Z'); // processed
    await setState(pool, projectA, 'diag-r-1', 'retry_waiting');
    await setState(pool, projectA, 'diag-d-1', 'dead_lettered', {
      deadLetteredAt: '2027-03-01T00:12:00.000Z',
      lastErrorCode: 'capacity_protected',
    });
    await setState(pool, projectA, 'diag-o-1', 'processed', {
      processedAt: '2027-03-01T00:08:30.000Z',
    });
    await setState(pool, projectA, 'diag-o-2', 'processed', {
      processedAt: '2027-03-01T00:10:00.000Z',
    });

    const result = await queryProjectInboxDiagnostics(pool, { projectId: projectA, ...WINDOW });
    expect(result.byState).toEqual({
      pending: 1,
      leased: 0,
      retry_waiting: 1,
      processed: 2,
      dead_lettered: 1,
    });
    expect(result.latestReceivedAt).toBe('2027-03-01T00:09:00.000Z');
    expect(result.latestProcessedAt).toBe('2027-03-01T00:10:00.000Z');
    expect(result.latestDeadLetteredAt).toBe('2027-03-01T00:12:00.000Z');
    expect(result.lastErrorCode).toBe('capacity_protected');
  });

  it('takes lastErrorCode from the newest dead-lettered row by dead_lettered_at', async () => {
    await pool.query('DELETE FROM event_inbox WHERE project_id = $1', [projectA]);
    await insertAt(pool, projectA, 'diag-dl-1', '2027-03-01T00:01:00.000Z');
    await insertAt(pool, projectA, 'diag-dl-2', '2027-03-01T00:02:00.000Z');
    await setState(pool, projectA, 'diag-dl-1', 'dead_lettered', {
      deadLetteredAt: '2027-03-01T00:03:00.000Z',
      lastErrorCode: 'retry_budget_exhausted',
    });
    await setState(pool, projectA, 'diag-dl-2', 'dead_lettered', {
      deadLetteredAt: '2027-03-01T00:04:00.000Z',
      lastErrorCode: 'capacity_protected',
    });

    const result = await queryProjectInboxDiagnostics(pool, { projectId: projectA, ...WINDOW });
    expect(result.byState.dead_lettered).toBe(2);
    expect(result.lastErrorCode).toBe('capacity_protected');
  });

  it('enforces the half-open [start, end) received_at window', async () => {
    await pool.query('DELETE FROM event_inbox WHERE project_id = $1', [projectA]);
    // A row at exactly startIso is included; a row at exactly endIso is excluded.
    await insertAt(pool, projectA, 'diag-w-start', WINDOW.startIso);
    await insertAt(pool, projectA, 'diag-w-end', WINDOW.endIso);
    await insertAt(pool, projectA, 'diag-w-before', '2027-02-28T23:59:59.000Z');

    const result = await queryProjectInboxDiagnostics(pool, { projectId: projectA, ...WINDOW });
    expect(result.byState.pending).toBe(1);
    expect(result.latestReceivedAt).toBe(WINDOW.startIso);
  });

  it('isolates projects from each other', async () => {
    await pool.query('DELETE FROM event_inbox WHERE project_id = $1', [projectA]);
    await pool.query('DELETE FROM event_inbox WHERE project_id = $1', [projectB]);
    await insertAt(pool, projectA, 'diag-iso-a', '2027-03-01T00:05:00.000Z');
    await insertAt(pool, projectB, 'diag-iso-b', '2027-03-01T00:05:00.000Z');
    await setState(pool, projectB, 'diag-iso-b', 'processed', {
      processedAt: '2027-03-01T00:06:00.000Z',
    });

    const a = await queryProjectInboxDiagnostics(pool, { projectId: projectA, ...WINDOW });
    const b = await queryProjectInboxDiagnostics(pool, { projectId: projectB, ...WINDOW });
    expect(a.byState).toEqual({
      pending: 1,
      leased: 0,
      retry_waiting: 0,
      processed: 0,
      dead_lettered: 0,
    });
    expect(b.byState).toEqual({
      pending: 0,
      leased: 0,
      retry_waiting: 0,
      processed: 1,
      dead_lettered: 0,
    });
    expect(b.latestProcessedAt).toBe('2027-03-01T00:06:00.000Z');
    expect(a.lastErrorCode).toBeNull();
  });

  it('returns zero counts and null latests for an empty project and an empty window', async () => {
    const emptyProject = await queryProjectInboxDiagnostics(pool, {
      projectId: projectEmpty,
      ...WINDOW,
    });
    expect(emptyProject.byState).toEqual({
      pending: 0,
      leased: 0,
      retry_waiting: 0,
      processed: 0,
      dead_lettered: 0,
    });
    expect(emptyProject.latestReceivedAt).toBeNull();
    expect(emptyProject.latestProcessedAt).toBeNull();
    expect(emptyProject.latestDeadLetteredAt).toBeNull();
    expect(emptyProject.lastErrorCode).toBeNull();

    // A project that has data elsewhere still reports an empty window.
    await pool.query('DELETE FROM event_inbox WHERE project_id = $1', [projectA]);
    await insertAt(pool, projectA, 'diag-empty-window', '2027-03-01T00:05:00.000Z');
    const emptyWindow = await queryProjectInboxDiagnostics(pool, {
      projectId: projectA,
      startIso: '2027-04-01T00:00:00.000Z',
      endIso: '2027-04-01T01:00:00.000Z',
    });
    expect(emptyWindow.byState).toEqual({
      pending: 0,
      leased: 0,
      retry_waiting: 0,
      processed: 0,
      dead_lettered: 0,
    });
    expect(emptyWindow.latestReceivedAt).toBeNull();
    expect(emptyWindow.latestDeadLetteredAt).toBeNull();
    expect(emptyWindow.lastErrorCode).toBeNull();
  });
});
