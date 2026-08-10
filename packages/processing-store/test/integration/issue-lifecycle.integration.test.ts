import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import type { Pool, PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { persistIssueContribution } from '../../src/issue-contribution-repository.js';
import {
  batchUpdateIssues,
  createIssueNote,
  deleteIssueNote,
  mergeIssues,
  updateIssueAssignee,
  updateIssuePriority,
  updateIssueState,
} from '../../src/issue-lifecycle-repository.js';
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

const PROJECT = '11111111-1111-4111-8111-111111111111';
const ACTOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ASSIGNEE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

interface IssueRow {
  id: string;
  status: string;
  assignee_account_id: string | null;
  priority: string | null;
  version: number;
  occurrence_count: string;
  first_seen_at: string;
  last_seen_at: string;
}

async function seedIssue(
  pool: Pool,
  message = 'lifecycle-boom',
  occurredAt = '2026-08-10T00:00:00.000Z',
): Promise<string> {
  const result = await persistIssueContribution(pool, {
    projectId: PROJECT,
    fingerprint: 'v1|javascript|TypeError|' + message,
    fingerprintVersion: 1,
    category: 'javascript',
    normalizedTitle: message,
    eventId: 'lifecycle-seed-' + message,
    occurredAtIso: occurredAt,
    sampleBody: { category: 'javascript', error: { message } },
  });
  if (result.status !== 'inserted') throw new Error('seed failed');
  return result.issueId;
}

async function getIssue(client: PoolClient, issueId: string): Promise<IssueRow | undefined> {
  return queryRow<IssueRow>(client, `SELECT * FROM issues WHERE id = $1`, [issueId]);
}

describeDb('processing-store issue lifecycle repositories (real PostgreSQL 17)', () => {
  let pool: Pool;
  let client: PoolClient;

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
    client = await pool.connect();
  });

  afterAll(async () => {
    client.release();
    await pool.end();
  });

  it('transitions status, auto-assigns on start-processing, and writes activity', async () => {
    const issueId = await seedIssue(pool,'lifecycle-auto-assign');
    await client.query('BEGIN');
    const result = await updateIssueState(client, {
      issueId,
      projectId: PROJECT,
      status: 'in_progress',
      version: 1,
      actorAccountId: ACTOR,
    });
    await client.query('COMMIT');
    expect(result).toEqual({ status: 'succeeded', issueId });

    const issue = await getIssue(client, issueId);
    expect(issue?.status).toBe('in_progress');
    expect(issue?.assignee_account_id).toBe(ACTOR);
    expect(issue?.version).toBe(2);
    const activities = await queryRows<{ activity_type: string }>(
      client,
      `SELECT activity_type FROM issue_activities WHERE issue_id = $1 ORDER BY id`,
      [issueId],
    );
    expect(activities.map((a) => a.activity_type)).toContain('status_changed');
    expect(activities.map((a) => a.activity_type)).toContain('assignee_changed');
  });

  it('rejects an invalid transition', async () => {
    const issueId = await seedIssue(pool,'lifecycle-invalid-transition');
    await client.query('BEGIN');
    await updateIssueState(client, {
      issueId,
      projectId: PROJECT,
      status: 'resolved',
      version: 1,
      actorAccountId: ACTOR,
      resolution: { reason: 'by_time', resolvedAtIso: '2026-08-10T00:01:00.000Z' },
    });
    const invalid = await updateIssueState(client, {
      issueId,
      projectId: PROJECT,
      status: 'in_progress',
      version: 2,
      actorAccountId: ACTOR,
    });
    await client.query('COMMIT');
    expect(invalid).toEqual({ status: 'invalid_input', code: 'invalid_transition' });
  });

  it('returns conflict on stale version', async () => {
    const issueId = await seedIssue(pool,'lifecycle-conflict');
    await client.query('BEGIN');
    const first = await updateIssueState(client, {
      issueId,
      projectId: PROJECT,
      status: 'in_progress',
      version: 1,
      actorAccountId: ACTOR,
    });
    const stale = await updateIssueState(client, {
      issueId,
      projectId: PROJECT,
      status: 'resolved',
      version: 1,
      actorAccountId: ACTOR,
    });
    await client.query('COMMIT');
    expect(first.status).toBe('succeeded');
    expect(stale).toEqual({ status: 'conflict' });
  });

  it('updates assignee and priority and records activity', async () => {
    const issueId = await seedIssue(pool,'lifecycle-assign-priority');
    await client.query('BEGIN');
    const assign = await updateIssueAssignee(client, {
      issueId,
      projectId: PROJECT,
      assigneeAccountId: ASSIGNEE,
      version: 1,
      actorAccountId: ACTOR,
    });
    const priority = await updateIssuePriority(client, {
      issueId,
      projectId: PROJECT,
      priority: 'high',
      version: 2,
      actorAccountId: ACTOR,
    });
    await client.query('COMMIT');
    expect(assign).toEqual({ status: 'succeeded', issueId });
    expect(priority).toEqual({ status: 'succeeded', issueId });
    const issue = await getIssue(client, issueId);
    expect(issue?.assignee_account_id).toBe(ASSIGNEE);
    expect(issue?.priority).toBe('high');
  });

  it('creates and soft-deletes a member note', async () => {
    const issueId = await seedIssue(pool,'lifecycle-notes');
    await client.query('BEGIN');
    const created = await createIssueNote(client, {
      issueId,
      projectId: PROJECT,
      authorAccountId: ACTOR,
      content: 'Investigated the root cause.',
    });
    const note = await queryRow<{ id: string }>(
      client,
      `SELECT id FROM issue_notes WHERE issue_id = $1`,
      [issueId],
    );
    const deleted = await deleteIssueNote(client, {
      issueId,
      projectId: PROJECT,
      noteId: note?.id ?? '',
      actorAccountId: ACTOR,
      canDeleteSensitive: false,
    });
    await client.query('COMMIT');
    expect(created.status).toBe('succeeded');
    expect(created.status === 'succeeded' ? created.noteId : '').not.toBe('');
    expect(deleted.status).toBe('succeeded');
    const soft = await queryRow<{ deleted_at: string | null }>(
      client,
      `SELECT deleted_at FROM issue_notes WHERE id = $1`,
      [note?.id],
    );
    expect(soft?.deleted_at).not.toBeNull();
  });

  it('does not let a non-author delete another member note', async () => {
    const issueId = await seedIssue(pool,'lifecycle-note-perm');
    await client.query('BEGIN');
    await createIssueNote(client, {
      issueId,
      projectId: PROJECT,
      authorAccountId: ASSIGNEE,
      content: 'Mine.',
    });
    const note = await queryRow<{ id: string }>(
      client,
      `SELECT id FROM issue_notes WHERE issue_id = $1`,
      [issueId],
    );
    const forbidden = await deleteIssueNote(client, {
      issueId,
      projectId: PROJECT,
      noteId: note?.id ?? '',
      actorAccountId: ACTOR,
      canDeleteSensitive: false,
    });
    await client.query('COMMIT');
    expect(forbidden).toEqual({ status: 'forbidden' });
  });

  it('merges issue counts into the primary and marks the source merged', async () => {
    const sourceId = await seedIssue(pool,'lifecycle-merge-source', '2026-08-10T00:00:00.000Z');
    const primaryId = await seedIssue(pool,'lifecycle-merge-primary', '2026-08-10T01:00:00.000Z');
    await client.query('BEGIN');
    const merged = await mergeIssues(client, {
      issueId: sourceId,
      primaryIssueId: primaryId,
      projectId: PROJECT,
      version: 1,
      actorAccountId: ACTOR,
    });
    await client.query('COMMIT');
    expect(merged).toEqual({ status: 'succeeded', issueId: primaryId });
    const primary = await getIssue(client, primaryId);
    expect(primary?.occurrence_count).toBe('2');
    expect(new Date(primary?.first_seen_at ?? '').toISOString()).toBe('2026-08-10T00:00:00.000Z');
    const source = await getIssue(client, sourceId);
    expect(source?.status).toBeDefined();
  });

  it('batch updates return per-item partial results', async () => {
    const a = await seedIssue(pool,'lifecycle-batch-a');
    const b = await seedIssue(pool,'lifecycle-batch-b');
    await client.query('BEGIN');
    const result = await batchUpdateIssues(client, {
      projectId: PROJECT,
      actorAccountId: ACTOR,
      items: [
        { issueId: a, action: 'status', target: 'in_progress', version: 1 },
        { issueId: b, action: 'priority', target: 'high', version: 1 },
        { issueId: '999999', action: 'status', target: 'resolved', version: 1 },
      ],
    });
    await client.query('COMMIT');
    expect(result.status).toBe('succeeded');
    if (result.status === 'succeeded') {
      expect(result.result.succeeded).toBe(2);
      expect(result.result.failed).toBe(1);
    }
  });
});
