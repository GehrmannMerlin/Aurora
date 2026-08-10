import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { persistIssueContribution } from '../../src/issue-contribution-repository.js';
import {
  queryIssueActivity,
  queryIssueDetail,
  queryIssueListPage,
  queryIssueSamples,
} from '../../src/issue-query-repository.js';
import {
  assertIsTestDatabase,
  createTestPool,
  testDatabaseUrl,
} from './helpers.js';

const migrationsDir = fileURLToPath(new URL('../../migrations', import.meta.url));
const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const describeDb = hasDb ? describe : describe.skip;

const PROJECT = '11111111-1111-4111-8111-111111111111';
const OTHER_PROJECT = '22222222-2222-4222-8222-222222222222';
const ACTOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

async function seedIssue(pool: Pool, projectId: string, message: string, occurredAt: string): Promise<string> {
  const result = await persistIssueContribution(pool, {
    projectId,
    fingerprint: 'v1|javascript|TypeError|' + message,
    fingerprintVersion: 1,
    category: 'javascript',
    normalizedTitle: message,
    eventId: 'query-seed-' + message,
    occurredAtIso: occurredAt,
    sampleBody: { category: 'javascript', error: { message } },
  });
  if (result.status !== 'inserted') throw new Error('seed failed');
  return result.issueId;
}

describeDb('processing-store issue query repositories (real PostgreSQL 17)', () => {
  let pool: Pool;

  beforeAll(async () => {
    assertIsTestDatabase(testDatabaseUrl());
    pool = createTestPool();
    await pool.query('DROP TABLE IF EXISTS issue_notes CASCADE');
    await pool.query('DROP TABLE IF EXISTS issue_activities CASCADE');
    await pool.query('DROP TABLE IF EXISTS issue_samples CASCADE');
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

  it('lists issues with status filtering and keyset pagination', async () => {
    await seedIssue(pool, PROJECT, 'query-list-a', '2026-08-10T00:00:00.000Z');
    await seedIssue(pool, PROJECT, 'query-list-b', '2026-08-10T01:00:00.000Z');
    await seedIssue(pool, PROJECT, 'query-list-c', '2026-08-10T02:00:00.000Z');
    await pool.query(
      `UPDATE issues SET status = 'resolved', resolved_reason = 'by_time' WHERE normalized_title = 'query-list-b'`,
    );

    const open = await queryIssueListPage(pool, { projectId: PROJECT, status: 'open' });
    expect(open.items.length).toBe(2);
    expect(open.totalCount).toBe('2');
    const resolved = await queryIssueListPage(pool, { projectId: PROJECT, status: 'resolved' });
    expect(resolved.items.length).toBe(1);
    expect(resolved.items[0]?.title).toBe('query-list-b');
  });

  it('filters the list by the half-open last_seen window', async () => {
    await seedIssue(pool, PROJECT, 'query-window-a', '2026-08-10T08:00:00.000Z');
    await seedIssue(pool, PROJECT, 'query-window-b', '2026-08-10T09:00:00.000Z');
    const inWindow = await queryIssueListPage(pool, {
      projectId: PROJECT,
      startIso: '2026-08-10T08:30:00.000Z',
      endIso: '2026-08-10T09:30:00.000Z',
    });
    expect(inWindow.items.length).toBe(1);
    expect(inWindow.items[0]?.title).toBe('query-window-b');
    expect(inWindow.totalCount).toBe('1');
  });

  it('returns an empty page for a project with no issues', async () => {
    const page = await queryIssueListPage(pool, { projectId: OTHER_PROJECT });
    expect(page.items).toHaveLength(0);
    expect(page.totalCount).toBe('0');
  });

  it('returns the Issue detail aggregate', async () => {
    const detail = await queryIssueDetail(pool, PROJECT, '1');
    expect(detail?.title).toBe('query-list-a');
    expect(detail?.occurrenceCount).toBe('1');
    expect(detail?.status).toBe('open');
  });

  it('returns null for an unknown issue', async () => {
    expect(await queryIssueDetail(pool, PROJECT, '999999')).toBeNull();
  });

  it('projects bounded safe samples', async () => {
    const samples = await queryIssueSamples(pool, PROJECT, '1');
    expect(samples.length).toBe(1);
    expect(samples[0]?.sampleKind).toBe('first');
    expect(samples[0]?.sampleBody).toEqual({
      category: 'javascript',
      error: { message: 'query-list-a' },
    });
  });

  it('returns activity + notes, hiding content of deleted notes', async () => {
    const issueId = await seedIssue(pool, PROJECT, 'query-activity', '2026-08-10T03:00:00.000Z');
    const id = await queryIssueDetail(pool, PROJECT, issueId);
    const detailId = id?.issueId ?? issueId;

    await pool.query(
      `INSERT INTO issue_activities (issue_id, project_id, actor_account_id, activity_type, details)
       VALUES ($1, $2, $3, 'status_changed', '{"from":"open","to":"resolved"}')`,
      [detailId, PROJECT, ACTOR],
    );
    await pool.query(
      `INSERT INTO issue_notes (issue_id, project_id, author_account_id, content)
       VALUES ($1, $2, $3, 'Visible note')`,
      [detailId, PROJECT, ACTOR],
    );
    await pool.query(
      `INSERT INTO issue_notes (issue_id, project_id, author_account_id, content, deleted_at)
       VALUES ($1, $2, $3, 'Sensitive note', now())`,
      [detailId, PROJECT, ACTOR],
    );

    const timeline = await queryIssueActivity(pool, PROJECT, detailId);
    expect(timeline.activities.length).toBe(1);
    expect(timeline.activities[0]?.activityType).toBe('status_changed');
    const visible = timeline.notes.find((n) => n.content === 'Visible note');
    const deleted = timeline.notes.find((n) => n.deletedAt !== undefined);
    expect(visible).toBeDefined();
    expect(deleted?.content).toBeUndefined();
  });

  it('isolates queries across projects', async () => {
    await seedIssue(pool, OTHER_PROJECT, 'query-other', '2026-08-10T04:00:00.000Z');
    const page = await queryIssueListPage(pool, { projectId: OTHER_PROJECT });
    expect(page.items.length).toBe(1);
    const projectDetail = await queryIssueDetail(pool, PROJECT, page.items[0]?.issueId ?? '');
    expect(projectDetail).toBeNull();
  });
});
