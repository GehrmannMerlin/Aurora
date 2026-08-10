import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { FastifyInstance } from 'fastify';
import { insertOrganizationMembership } from '@aurora/platform-identity';
import { createProject, insertProjectMember } from '@aurora/platform-project-governance';
import { persistIssueContribution } from '@aurora/processing-store';
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

interface ProblemBody {
  code?: string;
  detail?: string;
}

async function createProjectFor(pool: Pool, owner: RegisteredActor): Promise<string> {
  const created = await createProject(pool, {
    orgId: owner.organizationId,
    name: `Issues ${randomUUID().slice(0, 8)}`,
    frameworkType: 'react',
    createdBy: owner.accountId,
  });
  return created.projectId;
}

async function seedIssue(pool: Pool, projectId: string): Promise<string> {
  const result = await persistIssueContribution(pool, {
    projectId,
    fingerprint: 'v1|javascript|TypeError|boom',
    fingerprintVersion: 1,
    category: 'javascript',
    normalizedTitle: 'boom',
    eventId: `issue-seed-${randomUUID()}`,
    occurredAtIso: '2026-08-10T11:00:00.000Z',
    sampleBody: { category: 'javascript', error: { message: 'boom' } },
  });
  if (result.status !== 'inserted') throw new Error('issue seed failed');
  return result.issueId;
}

describeDb('DAT-14 issue lifecycle Commands (real PostgreSQL 17 + Redis)', () => {
  let pool: Pool;
  let sessionStore: SessionStore;
  let keyPrefix: string;

  beforeAll(async () => {
    assertIsTestDatabase(testDatabaseUrl());
    pool = createTestPool();
    await runAllMigrations();
    await truncateIdentityTables(pool);
    await pool.query(
      `TRUNCATE issue_notes, issue_activities, issue_samples, issue_event_applications,
        issues, request_metric_buckets, request_metric_event_applications,
        request_event_samples, error_event_occurrences,
        performance_metric_buckets, performance_metric_event_applications,
        performance_event_samples CASCADE`,
    );
    keyPrefix = `test:issues-command:${randomUUID()}`;
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
        LOG_ENABLED: 'true',
      }),
      pool,
      sessionStore,
      emailPort: new ConsoleEmailAdapter({ mode: 'console', log: () => undefined }),
      now: () => new Date(FIXED_NOW.getTime()),
    });
  }

  async function postIssue(
    app: FastifyInstance,
    actor: RegisteredActor,
    organizationId: string,
    projectId: string,
    path: string,
    body: Record<string, unknown>,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await app.inject({
      method: 'POST',
      url: `/api/platform/v1/organizations/${organizationId}/projects/${projectId}/issues/${path}`,
      headers: {
        cookie: `aurora_session=${actor.cookie}`,
        'content-type': 'application/json',
        'x-aurora-csrf': actor.csrf,
      },
      payload: JSON.stringify(body),
    });
    return { status: res.statusCode, body: res.json() };
  }

  it('an org manager transitions state with auto-assign and writes an audit row', async () => {
    const app = buildApp();
    const owner = await registerVerifiedActor(app, pool, `owner-${randomUUID()}@example.com`);
    const projectId = await createProjectFor(pool, owner);
    const issueId = await seedIssue(pool, projectId);

    const { status, body } = await postIssue(
      app,
      owner,
      owner.organizationId,
      projectId,
      `${issueId}/state`,
      {
        status: 'in_progress',
        version: 1,
        idempotencyKey: `idem-${randomUUID()}`,
      },
    );
    expect(status).toBe(200);
    const data = body.data as { version?: number; activity?: { type?: string } };
    expect(data.version).toBe(2);
    expect(data.activity?.type).toBe('status_changed');

    const row = await pool.query<{ assignee_account_id: string | null }>(
      `SELECT assignee_account_id FROM issues WHERE id = $1`,
      [issueId],
    );
    expect(row.rows[0]?.assignee_account_id).toBe(owner.accountId);

    const audit = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM security_audit_events WHERE action = 'issue_status_changed'`,
    );
    expect(audit.rows[0]?.count).toBe('1');
    await app.close();
  });

  it('a developer project member may transition state (not org-manager-only)', async () => {
    const app = buildApp();
    const owner = await registerVerifiedActor(app, pool, `owner-${randomUUID()}@example.com`);
    const developer = await registerVerifiedActor(app, pool, `dev-${randomUUID()}@example.com`);
    await insertOrganizationMembership(pool, {
      organizationId: owner.organizationId,
      accountId: developer.accountId,
      role: 'member',
    });
    const projectId = await createProjectFor(pool, owner);
    const issueId = await seedIssue(pool, projectId);
    await insertProjectMember(pool, {
      orgId: owner.organizationId,
      projectId,
      accountId: developer.accountId,
      role: 'developer',
    });

    const { status } = await postIssue(
      app,
      developer,
      owner.organizationId,
      projectId,
      `${issueId}/state`,
      {
        status: 'in_progress',
        version: 1,
        idempotencyKey: `idem-${randomUUID()}`,
      },
    );
    expect(status).toBe(200);
    await app.close();
  });

  it('a read_only project member is forbidden from a Command', async () => {
    const app = buildApp();
    const owner = await registerVerifiedActor(app, pool, `owner-${randomUUID()}@example.com`);
    const member = await registerVerifiedActor(app, pool, `member-${randomUUID()}@example.com`);
    await insertOrganizationMembership(pool, {
      organizationId: owner.organizationId,
      accountId: member.accountId,
      role: 'member',
    });
    const projectId = await createProjectFor(pool, owner);
    const issueId = await seedIssue(pool, projectId);
    await insertProjectMember(pool, {
      orgId: owner.organizationId,
      projectId,
      accountId: member.accountId,
      role: 'read_only',
    });

    const { status, body } = await postIssue(
      app,
      member,
      owner.organizationId,
      projectId,
      `${issueId}/state`,
      {
        status: 'in_progress',
        version: 1,
        idempotencyKey: `idem-${randomUUID()}`,
      },
    );
    expect(status).toBe(403);
    expect((body as ProblemBody).code).toBe('authorization');
    await app.close();
  });

  it('a cross-project issue is a closed 404', async () => {
    const app = buildApp();
    const ownerA = await registerVerifiedActor(app, pool, `ownerA-${randomUUID()}@example.com`);
    const ownerB = await registerVerifiedActor(app, pool, `ownerB-${randomUUID()}@example.com`);
    const projectA = await createProjectFor(pool, ownerA);
    const issueA = await seedIssue(pool, projectA);

    const { status } = await postIssue(
      app,
      ownerB,
      ownerB.organizationId,
      '00000000-0000-4000-8000-000000000000',
      `${issueA}/state`,
      {
        status: 'in_progress',
        version: 1,
        idempotencyKey: `idem-${randomUUID()}`,
      },
    );
    expect(status).toBe(404);
    await app.close();
  });

  it('a stale version is a 409 conflict', async () => {
    const app = buildApp();
    const owner = await registerVerifiedActor(app, pool, `owner-${randomUUID()}@example.com`);
    const projectId = await createProjectFor(pool, owner);
    const issueId = await seedIssue(pool, projectId);

    const first = await postIssue(app, owner, owner.organizationId, projectId, `${issueId}/state`, {
      status: 'in_progress',
      version: 1,
      idempotencyKey: `idem-${randomUUID()}`,
    });
    expect(first.status).toBe(200);
    const stale = await postIssue(app, owner, owner.organizationId, projectId, `${issueId}/state`, {
      status: 'resolved',
      version: 1,
      idempotencyKey: `idem-${randomUUID()}`,
      resolution: { reason: 'by_time', resolvedAtIso: '2026-08-10T12:00:00.000Z' },
    });
    expect(stale.status).toBe(409);
    expect((stale.body as ProblemBody).code).toBe('conflict');
    await app.close();
  });

  it('creates and deletes a member note', async () => {
    const app = buildApp();
    const owner = await registerVerifiedActor(app, pool, `owner-${randomUUID()}@example.com`);
    const projectId = await createProjectFor(pool, owner);
    const issueId = await seedIssue(pool, projectId);

    const created = await postIssue(
      app,
      owner,
      owner.organizationId,
      projectId,
      `${issueId}/notes`,
      {
        content: 'Root cause identified.',
        idempotencyKey: `idem-${randomUUID()}`,
      },
    );
    expect(created.status).toBe(200);

    const note = await pool.query<{ id: string }>(
      `SELECT id FROM issue_notes WHERE issue_id = $1`,
      [issueId],
    );
    const noteId = note.rows[0]?.id ?? '';
    expect(noteId).not.toBe('');
    const deleted = await postIssue(
      app,
      owner,
      owner.organizationId,
      projectId,
      `${issueId}/notes/${noteId}/delete`,
      {
        idempotencyKey: `idem-${randomUUID()}`,
      },
    );
    expect(deleted.status).toBe(200);
    await app.close();
  });
});
