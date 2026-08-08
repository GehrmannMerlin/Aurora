import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { persistErrorEventOccurrence } from '../../src/error-occurrence-repository.js';
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

interface OccurrenceRow {
  id: string;
  project_id: string;
  event_id: string;
  protocol_version: number;
  occurred_at: string;
  error_category: string;
  normalized_body: unknown;
  created_at: string;
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

const javascriptBody = { category: 'javascript', error: { message: 'Synthetic runtime failure' } };
const promiseBody = {
  category: 'unhandled_rejection',
  reason: { kind: 'string', value: 'Synthetic Promise rejection' },
};
const resourceBody = {
  category: 'resource',
  resource: { type: 'script', url: 'https://static.example.test/app.js?cache=1#frag' },
};
const resourceBodyNormalized = {
  category: 'resource',
  resource: { type: 'script', url: 'https://static.example.test/app.js' },
};

describeDb('processing-store error occurrence persistence (real PostgreSQL 17)', () => {
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

  it('writes a JavaScript error occurrence', async () => {
    const result = await persistErrorEventOccurrence(pool, {
      projectId: '11111111-1111-1111-1111-111111111111',
      eventEnvelope: envelope('evt-pg-js-1', javascriptBody, 1_800_000_003_001),
    });
    expect(result.status).toBe('inserted');
    if (result.status === 'inserted') {
      expect(result.occurrenceId.length).toBeGreaterThan(0);
    }
  });

  it('writes a Promise rejection occurrence', async () => {
    const result = await persistErrorEventOccurrence(pool, {
      projectId: '11111111-1111-1111-1111-111111111111',
      eventEnvelope: envelope('evt-pg-promise-1', promiseBody, 1_800_000_003_002),
    });
    expect(result.status).toBe('inserted');
  });

  it('writes a resource error occurrence with a normalized URL body', async () => {
    const result = await persistErrorEventOccurrence(pool, {
      projectId: '11111111-1111-1111-1111-111111111111',
      eventEnvelope: envelope('evt-pg-resource-1', resourceBody, 1_800_000_003_003),
    });
    expect(result.status).toBe('inserted');
    const row = await queryRow<OccurrenceRow>(
      pool,
      `SELECT * FROM error_event_occurrences WHERE event_id = 'evt-pg-resource-1'`,
    );
    // Protocol strips query and fragment; the stored body is the parsed result.
    expect(row?.normalized_body).toEqual(resourceBodyNormalized);
  });

  it('stores protocolVersion, occurredAt and database-created createdAt correctly', async () => {
    const row = await queryRow<OccurrenceRow>(
      pool,
      `SELECT * FROM error_event_occurrences WHERE event_id = 'evt-pg-js-1'`,
    );
    expect(row?.protocol_version).toBe(1);
    expect(new Date(row?.occurred_at ?? 0).getTime()).toBe(1_800_000_003_001);
    // created_at is populated by the database, not the caller.
    expect(row?.created_at).toBeDefined();
    expect(Number.isNaN(new Date(row?.created_at ?? 0).getTime())).toBe(false);
  });

  it('does not store the full EventEnvelope, HTTP headers, or credentials', async () => {
    const rows = await queryRows<OccurrenceRow>(
      pool,
      'SELECT normalized_body FROM error_event_occurrences',
    );
    for (const row of rows) {
      const text = JSON.stringify(row.normalized_body);
      expect(text).not.toContain('protocolVersion');
      expect(text).not.toContain('eventId');
      expect(text).not.toContain('eventType');
      expect(text).not.toContain('X-Aurora-Client-Key');
      expect(text).not.toContain('Authorization');
      expect(text).not.toContain('secret');
    }
  });

  it('returns duplicate for the same project/eventId and does not create a second row', async () => {
    const before = await queryRows<OccurrenceRow>(
      pool,
      `SELECT id FROM error_event_occurrences WHERE event_id = 'evt-pg-js-1'`,
    );
    const result = await persistErrorEventOccurrence(pool, {
      projectId: '11111111-1111-1111-1111-111111111111',
      eventEnvelope: envelope('evt-pg-js-1', javascriptBody, 1_800_000_003_001),
    });
    expect(result).toEqual({ status: 'duplicate' });
    const after = await queryRows<OccurrenceRow>(
      pool,
      `SELECT id FROM error_event_occurrences WHERE event_id = 'evt-pg-js-1'`,
    );
    expect(after).toHaveLength(before.length);
  });

  it('duplicate does not overwrite the original occurrence body', async () => {
    await persistErrorEventOccurrence(pool, {
      projectId: '22222222-2222-2222-2222-222222222222',
      eventEnvelope: envelope('evt-pg-dup-1', javascriptBody, 1_800_000_003_004),
    });
    await persistErrorEventOccurrence(pool, {
      projectId: '22222222-2222-2222-2222-222222222222',
      eventEnvelope: envelope('evt-pg-dup-1', resourceBody, 1_800_000_003_005),
    });
    const row = await queryRow<OccurrenceRow>(
      pool,
      `SELECT * FROM error_event_occurrences WHERE event_id = 'evt-pg-dup-1'
       AND project_id = '22222222-2222-2222-2222-222222222222'`,
    );
    expect(row?.error_category).toBe('javascript');
    expect(row?.normalized_body).toEqual(javascriptBody);
  });

  it('the same eventId under different projects can each be written', async () => {
    await persistErrorEventOccurrence(pool, {
      projectId: '33333333-3333-3333-3333-333333333333',
      eventEnvelope: envelope('evt-pg-cross-1', promiseBody, 1_800_000_003_006),
    });
    const result = await persistErrorEventOccurrence(pool, {
      projectId: '44444444-4444-4444-4444-444444444444',
      eventEnvelope: envelope('evt-pg-cross-1', promiseBody, 1_800_000_003_006),
    });
    expect(result.status).toBe('inserted');
  });

  it('returns invalid_input for a non-error event envelope', async () => {
    const result = await persistErrorEventOccurrence(pool, {
      projectId: '11111111-1111-1111-1111-111111111111',
      eventEnvelope: envelope('evt-pg-request-1', { method: 'GET' }, 1_800_000_003_007),
    });
    expect(result).toEqual({ status: 'invalid_input', code: 'invalid_envelope' });
  });

  it('enforces the category CHECK constraint', async () => {
    await expect(
      pool.query(
        `INSERT INTO error_event_occurrences
           (project_id, event_id, protocol_version, occurred_at, error_category, normalized_body)
         VALUES ('11111111-1111-1111-1111-111111111111', 'evt-pg-bad-category',
                 '1', now(), 'custom_category', '{}'::jsonb)`,
      ),
    ).rejects.toThrow();
  });

  it('enforces the normalized_body object CHECK constraint', async () => {
    await expect(
      pool.query(
        `INSERT INTO error_event_occurrences
           (project_id, event_id, protocol_version, occurred_at, error_category, normalized_body)
         VALUES ('11111111-1111-1111-1111-111111111111', 'evt-pg-bad-body',
                 '1', now(), 'javascript', '[]'::jsonb)`,
      ),
    ).rejects.toThrow();
  });

  it('enforces category matches body CHECK constraint', async () => {
    await expect(
      pool.query(
        `INSERT INTO error_event_occurrences
           (project_id, event_id, protocol_version, occurred_at, error_category, normalized_body)
         VALUES ('11111111-1111-1111-1111-111111111111', 'evt-pg-mismatch',
                 '1', now(), 'javascript', '{"category":"resource"}'::jsonb)`,
      ),
    ).rejects.toThrow();
  });

  it('enforces the (project_id, event_id) unique constraint', async () => {
    await pool.query(
      `INSERT INTO error_event_occurrences
         (project_id, event_id, protocol_version, occurred_at, error_category, normalized_body)
       VALUES ('55555555-5555-5555-5555-555555555555', 'evt-pg-unique',
               '1', now(), 'javascript', '{"category":"javascript"}'::jsonb)`,
    );
    await expect(
      pool.query(
        `INSERT INTO error_event_occurrences
           (project_id, event_id, protocol_version, occurred_at, error_category, normalized_body)
         VALUES ('55555555-5555-5555-5555-555555555555', 'evt-pg-unique',
                 '1', now(), 'javascript', '{"category":"javascript"}'::jsonb)`,
      ),
    ).rejects.toThrow();
  });
});
