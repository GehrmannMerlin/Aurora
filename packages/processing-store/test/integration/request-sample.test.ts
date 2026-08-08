import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  persistErrorEventOccurrence,
  persistRequestEventSample,
} from '../../src/index.js';
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

interface RequestSampleRow {
  id: string;
  project_id: string;
  event_id: string;
  protocol_version: number;
  occurred_at: string;
  sample_body: unknown;
  created_at: string;
}

interface ErrorOccurrenceRow {
  id: string;
  project_id: string;
  event_id: string;
  protocol_version: number;
  error_category: string;
}

function requestEnvelope(eventId: string, body: unknown, occurredAt: number): unknown {
  return {
    protocolVersion: 1,
    eventId,
    eventType: 'request',
    occurredAt,
    body,
  };
}

const successBody = {
  method: 'GET',
  url: 'https://api.example.test/orders?token=private#frag',
  startedAt: 1_800_000_004_000,
  durationMs: 120,
  outcome: 'success',
  statusCode: 200,
};
const successBodyNormalized = {
  method: 'GET',
  url: 'https://api.example.test/orders',
  startedAt: 1_800_000_004_000,
  durationMs: 120,
  outcome: 'success',
  statusCode: 200,
};
const timeoutBody = {
  method: 'POST',
  url: 'https://api.example.test/payments',
  startedAt: 1_800_000_004_100,
  durationMs: 5000,
  outcome: 'timeout',
};
const networkErrorBody = {
  method: 'DELETE',
  url: 'https://api.example.test/items/42',
  startedAt: 1_800_000_004_200,
  durationMs: 300,
  outcome: 'network_error',
};

const errorEnvelope = {
  protocolVersion: 1,
  eventId: 'evt-error-cross-1',
  eventType: 'error',
  occurredAt: 1_800_000_005_000,
  body: { category: 'javascript', error: { message: 'Synthetic runtime failure' } },
};

describeDb('processing-store request sample persistence (real PostgreSQL 17)', () => {
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

  it('writes a success request sample with a normalized URL body', async () => {
    const result = await persistRequestEventSample(pool, {
      projectId: '11111111-1111-1111-1111-111111111111',
      eventEnvelope: requestEnvelope('evt-req-js-1', successBody, 1_800_000_005_000),
    });
    expect(result.status).toBe('inserted');
    if (result.status === 'inserted') {
      expect(result.sampleId.length).toBeGreaterThan(0);
    }
    const row = await queryRow<RequestSampleRow>(
      pool,
      `SELECT * FROM request_event_samples WHERE event_id = 'evt-req-js-1'`,
    );
    // Protocol strips query and fragment; the stored body is the parsed result.
    expect(row?.sample_body).toEqual(successBodyNormalized);
  });

  it('stores protocolVersion, occurredAt and database-created createdAt correctly', async () => {
    const row = await queryRow<RequestSampleRow>(
      pool,
      `SELECT * FROM request_event_samples WHERE event_id = 'evt-req-js-1'`,
    );
    expect(row?.protocol_version).toBe(1);
    expect(new Date(row?.occurred_at ?? 0).getTime()).toBe(1_800_000_005_000);
    expect(row?.created_at).toBeDefined();
    expect(Number.isNaN(new Date(row?.created_at ?? 0).getTime())).toBe(false);
  });

  it('does not store the full envelope, request body, headers, or credentials', async () => {
    const rows = await queryRows<RequestSampleRow>(
      pool,
      'SELECT sample_body FROM request_event_samples',
    );
    for (const row of rows) {
      const text = JSON.stringify(row.sample_body);
      expect(text).not.toContain('protocolVersion');
      expect(text).not.toContain('eventId');
      expect(text).not.toContain('eventType');
      expect(text).not.toContain('token');
      expect(text).not.toContain('X-Aurora-Client-Key');
      expect(text).not.toContain('Authorization');
    }
  });

  it('writes timeout and network-error samples', async () => {
    const timeout = await persistRequestEventSample(pool, {
      projectId: '11111111-1111-1111-1111-111111111111',
      eventEnvelope: requestEnvelope('evt-req-timeout-1', timeoutBody, 1_800_000_005_001),
    });
    const network = await persistRequestEventSample(pool, {
      projectId: '11111111-1111-1111-1111-111111111111',
      eventEnvelope: requestEnvelope('evt-req-net-1', networkErrorBody, 1_800_000_005_002),
    });
    expect(timeout.status).toBe('inserted');
    expect(network.status).toBe('inserted');
  });

  it('returns duplicate for the same project/eventId and does not create a second row', async () => {
    const before = await queryRows<RequestSampleRow>(
      pool,
      `SELECT id FROM request_event_samples WHERE event_id = 'evt-req-js-1'`,
    );
    const result = await persistRequestEventSample(pool, {
      projectId: '11111111-1111-1111-1111-111111111111',
      eventEnvelope: requestEnvelope('evt-req-js-1', successBody, 1_800_000_005_000),
    });
    expect(result).toEqual({ status: 'duplicate' });
    const after = await queryRows<RequestSampleRow>(
      pool,
      `SELECT id FROM request_event_samples WHERE event_id = 'evt-req-js-1'`,
    );
    expect(after).toHaveLength(before.length);
  });

  it('duplicate does not overwrite the original sample body', async () => {
    await persistRequestEventSample(pool, {
      projectId: '22222222-2222-2222-2222-222222222222',
      eventEnvelope: requestEnvelope('evt-req-dup-1', successBody, 1_800_000_005_003),
    });
    await persistRequestEventSample(pool, {
      projectId: '22222222-2222-2222-2222-222222222222',
      eventEnvelope: requestEnvelope('evt-req-dup-1', timeoutBody, 1_800_000_005_004),
    });
    const row = await queryRow<RequestSampleRow>(
      pool,
      `SELECT * FROM request_event_samples WHERE event_id = 'evt-req-dup-1'
       AND project_id = '22222222-2222-2222-2222-222222222222'`,
    );
    expect(row?.sample_body).toEqual(successBodyNormalized);
  });

  it('the same eventId under different projects can each be written', async () => {
    await persistRequestEventSample(pool, {
      projectId: '33333333-3333-3333-3333-333333333333',
      eventEnvelope: requestEnvelope('evt-req-cross-1', successBody, 1_800_000_005_005),
    });
    const result = await persistRequestEventSample(pool, {
      projectId: '44444444-4444-4444-4444-444444444444',
      eventEnvelope: requestEnvelope('evt-req-cross-1', successBody, 1_800_000_005_005),
    });
    expect(result.status).toBe('inserted');
  });

  it('rejects a non-request event without persisting', async () => {
    const result = await persistRequestEventSample(pool, {
      projectId: '11111111-1111-1111-1111-111111111111',
      eventEnvelope: errorEnvelope,
    });
    expect(result).toEqual({ status: 'invalid_input', code: 'invalid_envelope' });
    const rows = await queryRows<RequestSampleRow>(
      pool,
      `SELECT * FROM request_event_samples WHERE event_id = 'evt-error-cross-1'`,
    );
    expect(rows).toHaveLength(0);
  });

  it('enforces the sample_body object CHECK constraint', async () => {
    await expect(
      pool.query(
        `INSERT INTO request_event_samples
           (project_id, event_id, protocol_version, occurred_at, sample_body)
         VALUES ('11111111-1111-1111-1111-111111111111', 'evt-req-bad-body',
                 '1', now(), '[]'::jsonb)`,
      ),
    ).rejects.toThrow();
  });

  it('enforces the (project_id, event_id) unique constraint', async () => {
    await pool.query(
      `INSERT INTO request_event_samples
         (project_id, event_id, protocol_version, occurred_at, sample_body)
       VALUES ('55555555-5555-5555-5555-555555555555', 'evt-req-unique',
               '1', now(), '{"method":"GET"}'::jsonb)`,
    );
    await expect(
      pool.query(
        `INSERT INTO request_event_samples
           (project_id, event_id, protocol_version, occurred_at, sample_body)
         VALUES ('55555555-5555-5555-5555-555555555555', 'evt-req-unique',
                 '1', now(), '{"method":"GET"}'::jsonb)`,
      ),
    ).rejects.toThrow();
  });

  it('produces at most one sample across concurrent duplicate calls', async () => {
    const project = '66666666-6666-6666-6666-666666666666';
    const input = {
      projectId: project,
      eventEnvelope: requestEnvelope('evt-req-conc-1', successBody, 1_800_000_005_006),
    };
    const results = await Promise.all([
      persistRequestEventSample(pool, input),
      persistRequestEventSample(pool, input),
    ]);
    for (const result of results) {
      expect(result.status === 'inserted' || result.status === 'duplicate').toBe(true);
    }
    const rows = await queryRows<RequestSampleRow>(
      pool,
      `SELECT * FROM request_event_samples WHERE event_id = 'evt-req-conc-1' AND project_id = '${project}'`,
    );
    expect(rows).toHaveLength(1);
  });

  it('does not regress the error occurrence store', async () => {
    const errorResult = await persistErrorEventOccurrence(pool, {
      projectId: '77777777-7777-7777-7777-777777777777',
      eventEnvelope: {
        protocolVersion: 1,
        eventId: 'evt-error-regress-1',
        eventType: 'error',
        occurredAt: 1_800_000_005_007,
        body: { category: 'javascript', error: { message: 'Synthetic runtime failure' } },
      },
    });
    expect(errorResult.status).toBe('inserted');
    const dup = await persistErrorEventOccurrence(pool, {
      projectId: '77777777-7777-7777-7777-777777777777',
      eventEnvelope: {
        protocolVersion: 1,
        eventId: 'evt-error-regress-1',
        eventType: 'error',
        occurredAt: 1_800_000_005_007,
        body: { category: 'javascript', error: { message: 'Synthetic runtime failure' } },
      },
    });
    expect(dup).toEqual({ status: 'duplicate' });
    const rows = await queryRows<ErrorOccurrenceRow>(
      pool,
      `SELECT * FROM error_event_occurrences WHERE event_id = 'evt-error-regress-1'`,
    );
    expect(rows).toHaveLength(1);
  });
});
