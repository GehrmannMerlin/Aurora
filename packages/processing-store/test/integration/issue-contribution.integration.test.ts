import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { persistIssueContribution } from '../../src/issue-contribution-repository.js';
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

const PROJECT_A = '11111111-1111-4111-8111-111111111111';
const PROJECT_B = '22222222-2222-4222-8222-222222222222';

interface IssueRow {
  id: string;
  occurrence_count: string;
  sample_count: number;
  first_seen_at: string;
  last_seen_at: string;
  status: string;
  version: number;
}

function contribution(
  eventId: string,
  occurredAtIso: string,
  message = 'boom',
): Record<string, unknown> {
  // In reality the fingerprint is derived from the message via
  // computeErrorFingerprint; here we mirror that so different messages produce
  // different Issues (project-scoped aggregation by fingerprint).
  return {
    projectId: PROJECT_A,
    fingerprint: 'v1|javascript|TypeError|' + message,
    fingerprintVersion: 1,
    category: 'javascript',
    normalizedTitle: message,
    eventId,
    occurredAtIso,
    sampleBody: { category: 'javascript', error: { message } },
  };
}

describeDb('processing-store issue aggregate contribution (real PostgreSQL 17)', () => {
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
    await pool.query('DROP TABLE IF EXISTS alert_instance_transitions CASCADE');
    await pool.query('DROP TABLE IF EXISTS alert_instance_evidence CASCADE');
    await pool.query('DROP TABLE IF EXISTS alert_instances CASCADE');
    await pool.query('DROP TABLE IF EXISTS alert_rules CASCADE');
    await pool.query('DROP TABLE IF EXISTS error_occurrence_symbolizations CASCADE');
    await pool.query('DROP TABLE IF EXISTS notifications CASCADE');
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

  it('first occurrence creates the Issue with count 1 and a first sample', async () => {
    const result = await persistIssueContribution(pool, contribution('evt-issue-1', '2026-08-10T00:00:00.000Z'));
    expect(result.status).toBe('inserted');

    const issue = await queryRow<IssueRow>(pool, `SELECT * FROM issues WHERE project_id = $1`, [PROJECT_A]);
    expect(issue?.occurrence_count).toBe('1');
    expect(issue?.sample_count).toBe(1);
    expect(new Date(issue?.first_seen_at ?? '').getTime()).toBe(
      new Date(issue?.last_seen_at ?? '').getTime(),
    );
    expect(issue?.status).toBe('open');

    const sample = await queryRow<{ sample_kind: string }>(
      pool,
      `SELECT sample_kind FROM issue_samples WHERE project_id = $1`,
      [PROJECT_A],
    );
    expect(sample?.sample_kind).toBe('first');
  });

  it('repeated distinct occurrences aggregate and keep first_seen stable', async () => {
    await persistIssueContribution(pool, contribution('evt-issue-2a', '2026-08-10T00:00:00.000Z', 'boom'));
    const applied = await persistIssueContribution(
      pool,
      contribution('evt-issue-2b', '2026-08-10T00:01:00.000Z', 'boom'),
    );
    expect(applied).toEqual({ status: 'applied' });

    const issue = await queryRow<IssueRow>(pool, `SELECT * FROM issues WHERE project_id = $1`, [PROJECT_A]);
    expect(issue?.occurrence_count).toBe('3');
    expect(new Date(issue?.first_seen_at ?? '').toISOString()).toBe('2026-08-10T00:00:00.000Z');
  });

  it('a replayed event is idempotent (duplicate, no double count)', async () => {
    const before = await queryRow<{ occurrence_count: string }>(
      pool,
      `SELECT occurrence_count FROM issues WHERE project_id = $1`,
      [PROJECT_A],
    );
    const replay = await persistIssueContribution(
      pool,
      contribution('evt-issue-2a', '2026-08-10T00:00:00.000Z', 'boom'),
    );
    expect(replay).toEqual({ status: 'duplicate' });
    const after = await queryRow<{ occurrence_count: string }>(
      pool,
      `SELECT occurrence_count FROM issues WHERE project_id = $1`,
      [PROJECT_A],
    );
    expect(after?.occurrence_count).toBe(before?.occurrence_count);
  });

  it('keeps last_seen monotonic under out-of-order processing', async () => {
    await persistIssueContribution(pool, contribution('evt-issue-3a', '2026-08-10T00:10:00.000Z', 'boom'));
    // An older occurredAt processed later must not regress last_seen_at.
    await persistIssueContribution(pool, contribution('evt-issue-3b', '2026-08-10T00:05:00.000Z', 'boom'));
    const issue = await queryRow<IssueRow>(pool, `SELECT * FROM issues WHERE project_id = $1`, [PROJECT_A]);
    expect(new Date(issue?.last_seen_at ?? '').toISOString()).toBe('2026-08-10T00:10:00.000Z');
  });

  it('keeps samples bounded and never evicts the first sample', async () => {
    // 200 distinct regular events of the same fingerprint.
    for (let i = 0; i < 200; i += 1) {
      const padded = String(i).padStart(3, '0');
      await persistIssueContribution(
        pool,
        contribution(`evt-issue-b-${padded}`, `2026-08-10T01:00:${padded}.000Z`, 'boom'),
      );
    }
    const issue = await queryRow<IssueRow>(pool, `SELECT * FROM issues WHERE project_id = $1`, [PROJECT_A]);
    expect(Number(issue?.sample_count)).toBeLessThanOrEqual(100);
    const firstStillThere = await queryRow<{ count: string }>(
      pool,
      `SELECT count(*)::text AS count FROM issue_samples WHERE issue_id = $1 AND sample_kind = 'first'`,
      [issue?.id],
    );
    expect(firstStillThere?.count).toBe('1');
  });

  it('isolates issues across projects', async () => {
    await persistIssueContribution(pool, {
      ...contribution('evt-issue-proj-a', '2026-08-10T02:00:00.000Z'),
      projectId: PROJECT_B,
    });
    const projectB = await queryRow<{ occurrence_count: string }>(
      pool,
      `SELECT occurrence_count FROM issues WHERE project_id = $1`,
      [PROJECT_B],
    );
    expect(projectB?.occurrence_count).toBe('1');
    const projectAIssues = await queryRows<{ count: string }>(
      pool,
      `SELECT count(*)::text AS count FROM issues WHERE project_id = $1`,
      [PROJECT_A],
    );
    expect(projectAIssues[0]?.count).toBe('1');
  });

  it('reopens a resolved issue on a later by_time event and bumps version', async () => {
    await persistIssueContribution(pool, contribution('evt-issue-r1', '2026-08-10T03:00:00.000Z', 'reopen-me'));
    await pool.query(
      `UPDATE issues SET status = 'resolved', resolved_at = '2026-08-10T03:01:00.000Z', resolved_reason = 'by_time'
        WHERE project_id = $1 AND fingerprint = 'v1|javascript|TypeError|reopen-me'`,
      [PROJECT_A],
    );
    const reopened = await persistIssueContribution(
      pool,
      contribution('evt-issue-r2', '2026-08-10T04:00:00.000Z', 'reopen-me'),
    );
    // PLT-09: a `by_time` reopen is surfaced as a distinct `reopened` outcome.
    expect(reopened.status).toBe('reopened');
    if (reopened.status === 'reopened') {
      expect(typeof reopened.issueId).toBe('string');
      expect(reopened.issueId.length).toBeGreaterThan(0);
    }
    const issueRow = await queryRow<{ status: string; version: number }>(
      pool,
      `SELECT status, version FROM issues WHERE project_id = $1 AND fingerprint = 'v1|javascript|TypeError|reopen-me'`,
      [PROJECT_A],
    );
    expect(issueRow?.status).toBe('open');
    expect(issueRow?.version).toBe(2);
  });

  it('evicts kind-matched samples at capacity and never crosses latest/reappeared', async () => {
    // Create an issue, then fill it to the cap with 99 'latest' + 1 'reappeared'
    // (no 'regular' remains). A new later 'latest' must evict the oldest
    // 'latest' and never the 'reappeared' (ADR-033 decision detail 8).
    await persistIssueContribution(
      pool,
      contribution('evt-kind-match-0', '2026-08-10T10:00:00.000Z', 'kind-match'),
    );
    const issue = await queryRow<{ id: string }>(
      pool,
      `SELECT id FROM issues WHERE project_id = $1 AND fingerprint = 'v1|javascript|TypeError|kind-match'`,
      [PROJECT_A],
    );
    const issueId = issue?.id;
    expect(issueId).toBeDefined();
    for (let i = 1; i <= 99; i += 1) {
      const padded = String(i).padStart(3, '0');
      await pool.query(
        `INSERT INTO issue_samples (issue_id, project_id, event_id, occurred_at, sample_body, sample_kind)
         VALUES ($1, $2, 'kind-latest-' || $3, $4::timestamptz, '{"category":"javascript","error":{"message":"kind-match"}}'::jsonb, 'latest')`,
        [issueId, PROJECT_A, padded, `2026-08-10T10:00:00.${padded}Z`],
      );
    }
    await pool.query(
      `INSERT INTO issue_samples (issue_id, project_id, event_id, occurred_at, sample_body, sample_kind)
       VALUES ($1, $2, 'kind-reappeared', '2026-08-10T10:00:00.500Z'::timestamptz, '{"category":"javascript","error":{"message":"kind-match"}}'::jsonb, 'reappeared')`,
      [issueId, PROJECT_A],
    );
    await pool.query(`UPDATE issues SET sample_count = 100, occurrence_count = 100 WHERE id = $1`, [issueId]);

    await persistIssueContribution(
      pool,
      contribution('evt-kind-match-new', '2026-08-10T11:00:00.000Z', 'kind-match'),
    );

    const reappearedStillThere = await queryRow<{ count: string }>(
      pool,
      `SELECT count(*)::text AS count FROM issue_samples WHERE issue_id = $1 AND sample_kind = 'reappeared'`,
      [issueId],
    );
    expect(reappearedStillThere?.count).toBe('1');
    const latestCount = await queryRow<{ count: string }>(
      pool,
      `SELECT count(*)::text AS count FROM issue_samples WHERE issue_id = $1 AND sample_kind = 'latest'`,
      [issueId],
    );
    expect(latestCount?.count).toBe('99');
    const sampleCount = await queryRow<{ sample_count: number }>(
      pool,
      `SELECT sample_count FROM issues WHERE id = $1`,
      [issueId],
    );
    expect(sampleCount?.sample_count).toBe(100);
  });

  it('does not reopen when a resolved by_time event arrives before resolved_at', async () => {
    await persistIssueContribution(pool, contribution('evt-issue-r3', '2026-08-10T05:00:00.000Z', 'reopen-late'));
    await pool.query(
      `UPDATE issues SET status = 'resolved', resolved_at = '2026-08-10T05:00:30.000Z', resolved_reason = 'by_time'
        WHERE project_id = $1 AND fingerprint = 'v1|javascript|TypeError|reopen-late'`,
      [PROJECT_A],
    );
    await persistIssueContribution(
      pool,
      contribution('evt-issue-r4', '2026-08-10T05:00:10.000Z', 'reopen-late'),
    );
    const issue = await queryRow<{ status: string }>(
      pool,
      `SELECT status FROM issues WHERE project_id = $1 AND fingerprint = 'v1|javascript|TypeError|reopen-late'`,
      [PROJECT_A],
    );
    expect(issue?.status).toBe('resolved');
  });
});
