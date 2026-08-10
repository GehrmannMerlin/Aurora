import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assertIsTestDatabase,
  createTestPool,
  queryRow,
  testDatabaseUrl,
} from './helpers.js';

const migrationsDir = fileURLToPath(new URL('../../migrations', import.meta.url));
const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const describeDb = hasDb ? describe : describe.skip;

interface ColumnRow {
  column_name: string;
}

describeDb('issue aggregate migrations (real PostgreSQL 17)', () => {
  let pool: Pool;

  beforeAll(async () => {
    assertIsTestDatabase(testDatabaseUrl());
    pool = createTestPool();
    await pool.query('DROP TABLE IF EXISTS issue_samples CASCADE');
    await pool.query('DROP TABLE IF EXISTS issue_activities CASCADE');
    await pool.query('DROP TABLE IF EXISTS issue_notes CASCADE');
    await pool.query('DROP TABLE IF EXISTS issue_event_applications CASCADE');
    await pool.query('DROP TABLE IF EXISTS issues CASCADE');
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

  it('creates the three issue tables with the frozen columns', async () => {
    for (const [table, expected] of [
      ['issues', ['project_id', 'fingerprint', 'fingerprint_version', 'occurrence_count', 'version', 'status']],
      ['issue_event_applications', ['project_id', 'event_id', 'issue_id']],
      ['issue_samples', ['issue_id', 'project_id', 'event_id', 'sample_body', 'sample_kind']],
    ] as const) {
      const cols = await pool.query<ColumnRow>(
        `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
        [table],
      );
      const names = cols.rows.map((r) => r.column_name);
      for (const column of expected) {
        expect(names, `${table}.${column}`).toContain(column);
      }
    }
  });

  it('enforces the issues unique aggregate key and closed-enum/COUNT CHECKs', async () => {
    const project = '11111111-1111-4111-8111-111111111111';
    await pool.query(
      `INSERT INTO issues (project_id, fingerprint, fingerprint_version, category, normalized_title, first_seen_at, last_seen_at)
       VALUES ($1, 'v1|x|y', 1, 'javascript', 't', now(), now())`,
      [project],
    );
    await expect(
      pool.query(
        `INSERT INTO issues (project_id, fingerprint, fingerprint_version, category, normalized_title, first_seen_at, last_seen_at)
         VALUES ($1, 'v1|x|y', 1, 'javascript', 't', now(), now())`,
        [project],
      ),
    ).rejects.toThrow();
    await expect(
      pool.query(
        `INSERT INTO issues (project_id, fingerprint, fingerprint_version, category, normalized_title, first_seen_at, last_seen_at, status)
         VALUES ($1, 'v1|x|z', 1, 'javascript', 't', now(), now(), 'bogus')`,
        [project],
      ),
    ).rejects.toThrow();
  });

  it('enforces issue_event_applications (project_id, event_id) primary key', async () => {
    const project = '11111111-1111-4111-8111-111111111111';
    const issue = await queryRow<{ id: string }>(pool, `SELECT id FROM issues LIMIT 1`);
    const issueId = issue?.id;
    expect(issueId).toBeDefined();
    await pool.query(
      `INSERT INTO issue_event_applications (project_id, event_id, issue_id) VALUES ($1, 'evt-1', $2)`,
      [project, issueId],
    );
    await expect(
      pool.query(
        `INSERT INTO issue_event_applications (project_id, event_id, issue_id) VALUES ($1, 'evt-1', $2)`,
        [project, issueId],
      ),
    ).rejects.toThrow();
  });

  it('runs down then up safely', async () => {
    await runner({
      databaseUrl: testDatabaseUrl(),
      dir: migrationsDir,
      direction: 'down',
      migrationsTable: 'pgmigrations',
      count: 1,
      log: () => undefined,
    });
    // The down dropped migration 1722500000009 (issue_activities/issue_notes).
    const cols = await pool.query<ColumnRow>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'issue_activities'`,
    );
    expect(cols.rows).toHaveLength(0);
    await runner({
      databaseUrl: testDatabaseUrl(),
      dir: migrationsDir,
      direction: 'up',
      migrationsTable: 'pgmigrations',
      count: 1,
      log: () => undefined,
    });
  });
});
