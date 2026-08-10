import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { computeErrorFingerprint } from '../../src/error-fingerprint.js';
import { persistErrorEventOccurrence } from '../../src/error-occurrence-repository.js';
import {
  assertIsTestDatabase,
  createTestPool,
  queryRow,
  testDatabaseUrl,
} from './helpers.js';

const migrationsDir = fileURLToPath(new URL('../../migrations', import.meta.url));
const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const describeDb = hasDb ? describe : describe.skip;

interface OccurrenceRow {
  id: string;
  project_id: string;
  event_id: string;
  fingerprint: string;
  fingerprint_version: number;
}

function envelope(eventId: string, body: unknown, occurredAt: number): unknown {
  return {
    protocolVersion: 1,
    eventId,
    eventType: 'error',
    occurredAt,
    body,
  };
}

const PROJECT_A = '11111111-1111-4111-8111-111111111111';
const PROJECT_B = '22222222-2222-4222-8222-222222222222';

describeDb('processing-store error fingerprint persistence (real PostgreSQL 17)', () => {
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

  it('stores a fingerprint computed from the validated body when none is passed', async () => {
    const eventId = 'evt-fp-0001';
    const body = { category: 'javascript', error: { message: 'order 202607250001 failed' } };
    const result = await persistErrorEventOccurrence(pool, {
      projectId: PROJECT_A,
      eventEnvelope: envelope(eventId, body, 1800000004101),
    });
    expect(result.status).toBe('inserted');

    const row = await queryRow<OccurrenceRow>(
      pool,
      'SELECT id, project_id, event_id, fingerprint, fingerprint_version FROM error_event_occurrences WHERE project_id = $1 AND event_id = $2',
      [PROJECT_A, eventId],
    );
    expect(row).toBeDefined();
    const expected = computeErrorFingerprint({
      projectId: PROJECT_A,
      body: body as Parameters<typeof computeErrorFingerprint>[0]['body'],
    });
    expect(row?.fingerprint).toBe(expected.fingerprint);
    expect(row?.fingerprint_version).toBe(1);
  });

  it('stores the processor-passed fingerprint verbatim when provided', async () => {
    const eventId = 'evt-fp-0002';
    const body = { category: 'javascript', error: { message: 'boom', stack: 'at f (https://cdn.test/app.js:7:3)' } };
    const passed = computeErrorFingerprint({
      projectId: PROJECT_A,
      body: body as Parameters<typeof computeErrorFingerprint>[0]['body'],
    });
    const result = await persistErrorEventOccurrence(pool, {
      projectId: PROJECT_A,
      eventEnvelope: envelope(eventId, body, 1800000004201),
      fingerprint: passed.fingerprint,
      fingerprintVersion: passed.fingerprintVersion,
    });
    expect(result.status).toBe('inserted');

    const row = await queryRow<OccurrenceRow>(
      pool,
      'SELECT fingerprint, fingerprint_version FROM error_event_occurrences WHERE project_id = $1 AND event_id = $2',
      [PROJECT_A, eventId],
    );
    expect(row?.fingerprint).toBe(passed.fingerprint);
    expect(row?.fingerprint_version).toBe(1);
  });

  it('rejects an invalid passed fingerprint as invalid_input', async () => {
    const result = await persistErrorEventOccurrence(pool, {
      projectId: PROJECT_A,
      eventEnvelope: envelope('evt-fp-0003', { category: 'javascript', error: { message: 'x' } }, 1800000004301),
      fingerprint: '',
    });
    expect(result.status).toBe('invalid_input');
    expect(result.status === 'invalid_input' ? result.code : '').toBe('invalid_fingerprint');
  });

  it('keeps (project_id, event_id) idempotency across projects', async () => {
    const eventId = 'evt-fp-0004';
    const body = { category: 'javascript', error: { message: 'shared message' } };
    const firstA = await persistErrorEventOccurrence(pool, {
      projectId: PROJECT_A,
      eventEnvelope: envelope(eventId, body, 1800000004401),
    });
    const secondA = await persistErrorEventOccurrence(pool, {
      projectId: PROJECT_A,
      eventEnvelope: envelope(eventId, body, 1800000004401),
    });
    const firstB = await persistErrorEventOccurrence(pool, {
      projectId: PROJECT_B,
      eventEnvelope: envelope(eventId, body, 1800000004401),
    });
    expect(firstA.status).toBe('inserted');
    expect(secondA.status).toBe('duplicate');
    expect(firstB.status).toBe('inserted');

    const count = await queryRow<{ count: string }>(
      pool,
      'SELECT count(*)::text AS count FROM error_event_occurrences WHERE event_id = $1',
      [eventId],
    );
    expect(count?.count).toBe('2');
  });
});
