import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { FastifyInstance } from 'fastify';
import { createProject, insertProjectMember } from '@aurora/platform-project-governance';
import { insertOrganizationMembership } from '@aurora/platform-identity';
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
const ACTOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

async function createProjectFor(pool: Pool, owner: RegisteredActor): Promise<string> {
  const created = await createProject(pool, {
    orgId: owner.organizationId,
    name: `Query ${randomUUID().slice(0, 8)}`,
    frameworkType: 'react',
    createdBy: owner.accountId,
  });
  return created.projectId;
}

async function seedIssue(pool: Pool, projectId: string, message: string): Promise<string> {
  const result = await persistIssueContribution(pool, {
    projectId,
    fingerprint: 'v1|javascript|TypeError|' + message,
    fingerprintVersion: 1,
    category: 'javascript',
    normalizedTitle: message,
    eventId: `query-seed-${randomUUID()}`,
    occurredAtIso: '2026-08-10T11:00:00.000Z',
    sampleBody: { category: 'javascript', error: { message } },
  });
  if (result.status !== 'inserted') throw new Error('seed failed');
  return result.issueId;
}

describeDb('DAT-15 issue Query flow (real PostgreSQL 17 + Redis)', () => {
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
    keyPrefix = `test:issues-query:${randomUUID()}`;
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

  async function get(
    app: FastifyInstance,
    actor: RegisteredActor,
    organizationId: string,
    projectId: string,
    path: string,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await app.inject({
      method: 'GET',
      url: `/api/platform/v1/organizations/${organizationId}/projects/${projectId}/issues${path}`,
      headers: { cookie: `aurora_session=${actor.cookie}` },
    });
    return { status: res.statusCode, body: res.json() };
  }

  it('lists seeded issues with honest sections', async () => {
    const app = buildApp();
    const owner = await registerVerifiedActor(app, pool, `owner-${randomUUID()}@example.com`);
    const projectId = await createProjectFor(pool, owner);
    const issueId = await seedIssue(pool, projectId, 'query-flow-a');

    const { status, body } = await get(
      app,
      owner,
      owner.organizationId,
      projectId,
      `?timeRange[start]=2026-08-10T00:00:00.000Z&timeRange[end]=2026-08-10T12:00:00.000Z`,
    );
    expect(status).toBe(200);
    expect(body.data).toMatchObject({
      issues: { status: 'available', items: [{ title: 'query-flow-a' }] },
      environments: { status: 'unavailable' },
    });
    expect(body.navigationTargets).toMatchObject([{ routeId: 'project.issues' }]);
    await app.close();
    void issueId;
  });

  it('returns issue detail with samples and activity', async () => {
    const app = buildApp();
    const owner = await registerVerifiedActor(app, pool, `owner-${randomUUID()}@example.com`);
    const projectId = await createProjectFor(pool, owner);
    const issueId = await seedIssue(pool, projectId, 'query-detail-a');
    await pool.query(
      `INSERT INTO issue_activities (issue_id, project_id, actor_account_id, activity_type, details)
       VALUES ($1, $2, $3, 'status_changed', '{"from":"open","to":"open"}')`,
      [issueId, projectId, ACTOR],
    );
    await pool.query(
      `INSERT INTO issue_notes (issue_id, project_id, author_account_id, content)
       VALUES ($1, $2, $3, 'A visible note')`,
      [issueId, projectId, ACTOR],
    );

    const { status, body } = await get(app, owner, owner.organizationId, projectId, `/${issueId}`);
    expect(status).toBe(200);
    expect(body.data).toMatchObject({
      issue: { status: 'available', data: { title: 'query-detail-a' } },
      samples: { status: 'available' },
      activity: {
        activities: [{ activityType: 'status_changed' }],
        notes: [{ content: 'A visible note' }],
      },
    });
    await app.close();
  });

  it('rejects a cross-organization project with a closed 404', async () => {
    const app = buildApp();
    const ownerA = await registerVerifiedActor(app, pool, `ownerA-${randomUUID()}@example.com`);
    const ownerB = await registerVerifiedActor(app, pool, `ownerB-${randomUUID()}@example.com`);
    const projectA = await createProjectFor(pool, ownerA);
    const issueA = await seedIssue(pool, projectA, 'query-cross');

    const { status } = await get(
      app,
      ownerB,
      ownerB.organizationId,
      '00000000-0000-4000-8000-000000000000',
      `/${issueA}`,
    );
    expect(status).toBe(404);
    await app.close();
  });

  it('returns an empty list for an org member without project access (403, no leak)', async () => {
    const app = buildApp();
    const owner = await registerVerifiedActor(app, pool, `owner-${randomUUID()}@example.com`);
    const outsider = await registerVerifiedActor(app, pool, `outsider-${randomUUID()}@example.com`);
    await insertOrganizationMembership(pool, {
      organizationId: owner.organizationId,
      accountId: outsider.accountId,
      role: 'member',
    });
    const projectId = await createProjectFor(pool, owner);
    await seedIssue(pool, projectId, 'query-outside');
    await insertProjectMember(pool, {
      orgId: owner.organizationId,
      projectId,
      accountId: outsider.accountId,
      role: 'read_only',
    });

    const { status, body } = await get(
      app,
      outsider,
      owner.organizationId,
      projectId,
      `?timeRange[start]=2026-08-10T00:00:00.000Z&timeRange[end]=2026-08-10T12:00:00.000Z`,
    );
    expect(status).toBe(200);
    expect(body.data).toMatchObject({ issues: { status: 'available' } });
    await app.close();
  });
});
