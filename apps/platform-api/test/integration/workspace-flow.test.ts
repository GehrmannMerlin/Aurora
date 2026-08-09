import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { FastifyInstance } from 'fastify';
import { insertOrganizationMembership } from '@aurora/platform-identity';
import { insertProjectMember } from '@aurora/platform-project-governance';
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
import { registerActor, type RegisteredActor } from './flow-helpers.js';

const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const hasRedis = process.env.AURORA_TEST_REDIS_URL !== undefined;
const describeDb = hasDb && hasRedis ? describe : describe.skip;

const FIXED_NOW = new Date('2026-08-09T00:00:00.000Z');

/** The closed contract `allowedActions` verb enum. */
const CONTRACT_ALLOWED_ACTIONS = [
  'create',
  'read',
  'update',
  'delete',
  'manage',
  'restore',
  'transfer',
  'revoke',
] as const;

/** The contract `projectSummary` status/lifecycle enum (no `deleting`). */
const CONTRACT_STATUSES = ['active', 'archived', 'trash'] as const;

interface ListProjectsBody {
  projects?: readonly {
    projectId: string;
    name: string;
    frameworkType: string;
    status: string;
    lifecycle: string;
  }[];
  allowedActions?: readonly string[];
  navigationTargets?: readonly { routeId: string }[];
}

describeDb('B1 workspace list flow (real PostgreSQL 17 + Redis)', () => {
  let pool: Pool;
  let sessionStore: SessionStore;
  let keyPrefix: string;

  beforeAll(async () => {
    assertIsTestDatabase(testDatabaseUrl());
    pool = createTestPool();
    await runAllMigrations();
    await truncateIdentityTables(pool);
    keyPrefix = `test:workspace-flow:${randomUUID()}`;
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

  /** Create a project through the B2 route as the org owner. */
  async function createProject(
    app: FastifyInstance,
    owner: RegisteredActor,
  ): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: `/api/platform/v1/organizations/${owner.organizationId}/projects`,
      headers: {
        cookie: `aurora_session=${owner.cookie}`,
        'content-type': 'application/json',
        'x-aurora-csrf': owner.csrf,
      },
      payload: JSON.stringify({
        name: 'Acme Web',
        frameworkType: 'react',
        websiteUrl: 'https://acme.example.com',
        idempotencyKey: randomUUID(),
      }),
    });
    expect(response.statusCode).toBe(200);
    const body: { projectId: string } = response.json();
    return body.projectId;
  }

  async function listProjects(
    app: FastifyInstance,
    actor: RegisteredActor,
    organizationId: string,
  ): Promise<{ status: number; body: ListProjectsBody }> {
    const response = await app.inject({
      method: 'GET',
      url: `/api/platform/v1/organizations/${organizationId}/projects`,
      headers: { cookie: `aurora_session=${actor.cookie}` },
    });
    return { status: response.statusCode, body: response.json() };
  }

  it('owner lists the org projects with full allowedActions and contract-valid shapes', async () => {
    const app = buildApp();
    const owner = await registerActor(app, `owner-${randomUUID()}@example.com`);
    const projectId = await createProject(app, owner);

    const { status, body } = await listProjects(app, owner, owner.organizationId);

    expect(status).toBe(200);
    expect(body.projects).toHaveLength(1);
    expect(body.projects?.[0]?.projectId).toBe(projectId);
    expect(body.projects?.[0]?.name).toBe('Acme Web');
    expect(body.projects?.[0]?.frameworkType).toBe('react');
    for (const project of body.projects ?? []) {
      expect(CONTRACT_STATUSES).toContain(project.status);
      expect(CONTRACT_STATUSES).toContain(project.lifecycle);
    }
    // allowedActions bridge: owner/admin -> the full closed verb enum.
    expect(body.allowedActions).toEqual([...CONTRACT_ALLOWED_ACTIONS]);
    for (const action of body.allowedActions ?? []) {
      expect(CONTRACT_ALLOWED_ACTIONS).toContain(action);
    }
    expect(body.navigationTargets?.some((t) => t.routeId === 'workspace.home')).toBe(true);
    await app.close();
  });

  it('member sees only assigned projects; unassigned member sees an empty list', async () => {
    const app = buildApp();
    const owner = await registerActor(app, `owner-${randomUUID()}@example.com`);
    const member = await registerActor(app, `member-${randomUUID()}@example.com`);

    const membership = await insertOrganizationMembership(pool, {
      organizationId: owner.organizationId,
      accountId: member.accountId,
      role: 'member',
    });
    expect(membership.status).toBe('success');

    // Unassigned member -> empty projection (still 200, not forbidden).
    const empty = await listProjects(app, member, owner.organizationId);
    expect(empty.status).toBe(200);
    expect(empty.body.projects).toEqual([]);
    expect(empty.body.allowedActions).toEqual(['read']);

    // Owner creates a project and assigns the member.
    const projectId = await createProject(app, owner);
    const assigned = await insertProjectMember(pool, {
      orgId: owner.organizationId,
      projectId,
      accountId: member.accountId,
      role: 'developer',
    });
    expect(assigned.status).toBe('success');

    const visible = await listProjects(app, member, owner.organizationId);
    expect(visible.status).toBe(200);
    expect(visible.body.projects?.map((p) => p.projectId)).toEqual([projectId]);
    expect(visible.body.allowedActions).toEqual(['read']);
    await app.close();
  });

  it('non-member receives a closed 403 with no org-existence leak', async () => {
    const app = buildApp();
    const owner = await registerActor(app, `owner-${randomUUID()}@example.com`);
    const outsider = await registerActor(app, `outsider-${randomUUID()}@example.com`);

    const { status, body } = await listProjects(app, outsider, owner.organizationId);

    expect(status).toBe(403);
    const problem = body as unknown as { code?: string; detail?: string };
    expect(problem.code).toBe('authorization');
    expect(problem.detail).not.toContain(owner.organizationId);
    await app.close();
  });

  it('drops transient `deleting` projects from the projection', async () => {
    const app = buildApp();
    const owner = await registerActor(app, `owner-${randomUUID()}@example.com`);
    const projectId = await createProject(app, owner);

    await pool.query(
      `UPDATE projects SET status = 'deleting', updated_at = now() WHERE project_id = $1`,
      [projectId],
    );

    const { status, body } = await listProjects(app, owner, owner.organizationId);
    expect(status).toBe(200);
    expect(body.projects).toEqual([]);
    await app.close();
  });
});
