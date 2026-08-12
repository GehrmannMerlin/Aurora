import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { FastifyInstance } from 'fastify';
import { insertOrganizationMembership } from '@aurora/platform-identity';
import { createProject, insertProjectMember } from '@aurora/platform-project-governance';
import {
  createIssueNotificationSender,
  persistIssueContribution,
  updateIssueState,
} from '@aurora/processing-store';
import { createSessionStore, type SessionStore } from '@aurora/platform-session';
import { ConsoleEmailAdapter } from '@aurora/platform-email';
import { buildPlatformApi } from '../../src/app.js';
import { loadPlatformApiConfig } from '../../src/config.js';
import {
  assertIsTestDatabase,
  createTestPool,
  redisUrl,
  runAllMigrations,
  testDatabaseUrl,
  truncateIdentityTables,
} from './helpers.js';
import { registerVerifiedActor, type RegisteredActor } from './flow-helpers.js';

const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const hasRedis = process.env.AURORA_TEST_REDIS_URL !== undefined;
const describeDb = hasDb && hasRedis ? describe : describe.skip;

const FIXED_NOW = new Date('2026-08-10T12:00:00.000Z');

const SAMPLE_BODY = { category: 'javascript', error: { message: 'boom' } };

function contributionInput(projectId: string, eventId: string, occurredAtIso: string) {
  return {
    projectId,
    fingerprint: 'v1|javascript|TypeError|boom',
    fingerprintVersion: 1,
    category: 'javascript',
    normalizedTitle: 'boom',
    eventId,
    occurredAtIso,
    sampleBody: SAMPLE_BODY,
  };
}

async function createProjectFor(pool: Pool, owner: RegisteredActor): Promise<string> {
  const created = await createProject(pool, {
    orgId: owner.organizationId,
    name: `IssueNotif ${randomUUID().slice(0, 8)}`,
    frameworkType: 'react',
    createdBy: owner.accountId,
  });
  return created.projectId;
}

describeDb('PLT-09 issue trigger notifications (real PostgreSQL 17 + Redis)', () => {
  let pool: Pool;
  let sessionStore: SessionStore;
  let keyPrefix: string;

  beforeAll(async () => {
    assertIsTestDatabase(testDatabaseUrl());
    pool = createTestPool();
    await runAllMigrations();
    await truncateIdentityTables(pool);
    await pool.query(
      `TRUNCATE notifications, issue_notes, issue_activities, issue_samples,
        issue_event_applications, issues, error_event_occurrences,
        request_metric_buckets, request_metric_event_applications,
        request_event_samples, performance_metric_buckets,
        performance_metric_event_applications, performance_event_samples CASCADE`,
    );
    keyPrefix = `test:issue-notification:${randomUUID()}`;
    sessionStore = await createSessionStore({ url: redisUrl(), keyPrefix });
  });

  afterAll(async () => {
    await sessionStore.client.quit().catch(() => undefined);
    await pool.end();
  });

  function buildApp(): FastifyInstance {
    return buildPlatformApi({
      config: loadPlatformApiConfig({
        HOST: '127.0.0.1',
        PORT: '0',
        DATABASE_URL: testDatabaseUrl(),
        REDIS_URL: redisUrl(),
        SESSION_IDLE_MS: String(30 * 60 * 1000),
        SESSION_ABSOLUTE_MS: String(8 * 60 * 60 * 1000),
        COOKIE_SECURE: 'false',
        EMAIL_DELIVERY_MODE: 'console',
        APP_ORIGIN: '',
        LOG_ENABLED: 'false',
      }),
      pool,
      sessionStore,
      emailPort: new ConsoleEmailAdapter({ mode: 'console', log: () => undefined }),
      now: () => new Date(FIXED_NOW.getTime()),
    });
  }

  it('new issue and reappearance append notifications for project admins (deduped)', async () => {
    const app = buildApp();
    const owner = await registerVerifiedActor(app, pool, `owner-${randomUUID()}@example.com`);
    const member = await registerVerifiedActor(app, pool, `member-${randomUUID()}@example.com`);
    await insertOrganizationMembership(pool, {
      organizationId: owner.organizationId,
      accountId: member.accountId,
      role: 'member',
    });
    const projectId = await createProjectFor(pool, owner);
    // Recipients = org manager (owner, inherited) + explicit project_admin.
    await insertProjectMember(pool, {
      orgId: owner.organizationId,
      projectId,
      accountId: member.accountId,
      role: 'project_admin',
    });

    const notifyIssue = createIssueNotificationSender(pool);

    // New issue → inserted → both admins get a new_issue notification.
    const first = await persistIssueContribution(
      pool,
      contributionInput(projectId, `issue-a-${randomUUID()}`, '2026-08-10T10:00:00.000Z'),
    );
    expect(first.status).toBe('inserted');
    if (first.status !== 'inserted') return;
    const issueId = first.issueId;
    await notifyIssue({ projectId, issueId, kind: 'new_issue' });

    const rows = await pool.query<{ account_id: string; organization_id: string; project_id: string; target: { routeId: string } }>(
      `SELECT account_id, organization_id, project_id, target
         FROM notifications WHERE type = $1 AND business_key = $2`,
      ['new_issue', `issue:${issueId}`],
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows.map((r) => r.account_id).sort()).toEqual(
      [owner.accountId, member.accountId].sort(),
    );
    expect(
      rows.rows.every(
        (r) => r.organization_id === owner.organizationId && r.project_id === projectId,
      ),
    ).toBe(true);
    expect(rows.rows.every((r) => r.target.routeId === 'project.issue-detail')).toBe(true);

    // Re-running the same trigger never duplicates (business_key dedupe).
    await notifyIssue({ projectId, issueId, kind: 'new_issue' });
    const dedupe = await pool.query<{ n: string }>(
      `SELECT count(*)::bigint AS n FROM notifications WHERE type = $1 AND business_key = $2`,
      ['new_issue', `issue:${issueId}`],
    );
    expect(Number(dedupe.rows[0]?.n ?? 0)).toBe(2);

    // A repeated occurrence (not reopened) does not fire a notification.
    const repeat = await persistIssueContribution(
      pool,
      contributionInput(projectId, `issue-b-${randomUUID()}`, '2026-08-10T10:05:00.000Z'),
    );
    expect(repeat.status).toBe('applied');

    // Resolve, then a later occurrence reopens the issue → issue_reappeared.
    const resolveClient = await pool.connect();
    const resolved = await updateIssueState(resolveClient, {
      issueId,
      projectId,
      status: 'resolved',
      version: 1,
      actorAccountId: owner.accountId,
      resolution: { reason: 'by_time', resolvedAtIso: '2026-08-10T11:00:00.000Z' },
    });
    resolveClient.release();
    expect(resolved.status).toBe('succeeded');

    const reappear = await persistIssueContribution(
      pool,
      contributionInput(projectId, `issue-c-${randomUUID()}`, '2026-08-10T12:00:00.000Z'),
    );
    expect(reappear.status).toBe('reopened');
    if (reappear.status !== 'reopened') return;
    await notifyIssue({ projectId, issueId: reappear.issueId, kind: 'issue_reappeared' });

    const reappeared = await pool.query<{ n: string }>(
      `SELECT count(*)::bigint AS n FROM notifications WHERE type = $1 AND business_key = $2`,
      ['issue_reappeared', `issue:${issueId}`],
    );
    expect(Number(reappeared.rows[0]?.n ?? 0)).toBe(2);

    await app.close();
  });
});
