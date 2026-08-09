import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { FastifyInstance } from 'fastify';
import { insertOrganizationMembership } from '@aurora/platform-identity';
import { trashProject } from '@aurora/platform-project-governance';
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

interface TrashItem {
  projectId?: string;
  name?: string;
  lifecycle?: string;
  trashedAt?: string;
  recoverableUntil?: string;
}

interface TrashBody {
  projects?: readonly TrashItem[];
}

interface ProblemBody {
  code?: string;
  fieldErrors?: readonly { field?: string; reason?: string }[];
}

describeDb('B8 trash/restore flow (real PostgreSQL 17 + Redis)', () => {
  let pool: Pool;
  let sessionStore: SessionStore;
  let keyPrefix: string;

  beforeAll(async () => {
    assertIsTestDatabase(testDatabaseUrl());
    pool = createTestPool();
    await runAllMigrations();
    await truncateIdentityTables(pool);
    keyPrefix = `test:trash-flow:${randomUUID()}`;
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

  async function createProject(
    app: FastifyInstance,
    actor: RegisteredActor,
    name: string,
  ): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: `/api/platform/v1/organizations/${actor.organizationId}/projects`,
      headers: {
        cookie: `aurora_session=${actor.cookie}`,
        'content-type': 'application/json',
        'x-aurora-csrf': actor.csrf,
      },
      payload: JSON.stringify({ name, frameworkType: 'javascript', idempotencyKey: randomUUID() }),
    });
    expect(response.statusCode).toBe(200);
    const body: { projectId?: string } = response.json();
    if (typeof body.projectId !== 'string') throw new Error('no projectId in create response');
    return body.projectId;
  }

  async function post(
    app: FastifyInstance,
    actor: RegisteredActor,
    url: string,
    payload: object,
    csrfHeader: string | null = actor.csrf,
  ): Promise<{ status: number; body: Record<string, unknown> | ProblemBody }> {
    const headers: Record<string, string> = {
      cookie: `aurora_session=${actor.cookie}`,
      'content-type': 'application/json',
    };
    if (csrfHeader !== null) headers['x-aurora-csrf'] = csrfHeader;
    const response = await app.inject({
      method: 'POST',
      url,
      headers,
      payload: JSON.stringify(payload),
    });
    return { status: response.statusCode, body: response.json() };
  }

  async function getTrash(
    app: FastifyInstance,
    actor: RegisteredActor,
    organizationId: string,
  ): Promise<{ status: number; body: TrashBody | ProblemBody }> {
    const response = await app.inject({
      method: 'GET',
      url: `/api/platform/v1/organizations/${organizationId}/trash`,
      headers: { cookie: `aurora_session=${actor.cookie}` },
    });
    return { status: response.statusCode, body: response.json() };
  }

  async function projectVersion(projectId: string): Promise<string> {
    const result = await pool.query<{ updated_at: string }>(
      'SELECT updated_at FROM projects WHERE project_id = $1',
      [projectId],
    );
    const updatedAt = result.rows[0]?.updated_at;
    if (updatedAt === undefined) throw new Error('no project row');
    return new Date(updatedAt).toISOString();
  }

  it('owner lists trash and restores within the recovery window', async () => {
    const app = buildApp();
    const owner = await registerActor(app, `owner-${randomUUID()}@example.com`);
    const projectId = await createProject(app, owner, 'Recover Me');

    const trashed = await trashProject(pool, {
      orgId: owner.organizationId,
      projectId,
      actorId: owner.accountId,
    });
    expect(trashed.status).toBe('success');

    const { status, body } = await getTrash(app, owner, owner.organizationId);
    expect(status).toBe(200);
    const projects = (body as TrashBody).projects ?? [];
    const item = projects.find((p) => p.projectId === projectId);
    expect(item?.lifecycle).toBe('trash');
    expect(typeof item?.trashedAt).toBe('string');
    expect(typeof item?.recoverableUntil).toBe('string');

    const resourceVersion = await projectVersion(projectId);
    const restored = await post(
      app,
      owner,
      `/api/platform/v1/organizations/${owner.organizationId}/trash/${projectId}/restore`,
      { resourceVersion, idempotencyKey: randomUUID() },
    );
    expect(restored.status).toBe(200);
    expect((restored.body as { status?: string }).status).toBe('active');

    const row = await pool.query<{ status: string; trashed_at: string | null }>(
      'SELECT status, trashed_at FROM projects WHERE project_id = $1',
      [projectId],
    );
    expect(row.rows[0]?.status).toBe('active');
    expect(row.rows[0]?.trashed_at).toBeNull();

    // The trashed project is no longer listed.
    const after = await getTrash(app, owner, owner.organizationId);
    const afterProjects = (after.body as TrashBody).projects ?? [];
    expect(afterProjects.every((p) => p.projectId !== projectId)).toBe(true);
    await app.close();
  });

  it('an expired recovery window maps to 409 state_machine_conflict', async () => {
    const app = buildApp();
    const owner = await registerActor(app, `owner-${randomUUID()}@example.com`);
    const projectId = await createProject(app, owner, 'Expired');

    const trashed = await trashProject(pool, {
      orgId: owner.organizationId,
      projectId,
      actorId: owner.accountId,
    });
    expect(trashed.status).toBe('success');

    // Force the recovery window into the past (status stays trash).
    const resourceVersion = await projectVersion(projectId);
    await pool.query(
      `UPDATE projects SET recoverable_until = now() - interval '1 day'
       WHERE project_id = $1`,
      [projectId],
    );

    const restored = await post(
      app,
      owner,
      `/api/platform/v1/organizations/${owner.organizationId}/trash/${projectId}/restore`,
      { resourceVersion, idempotencyKey: randomUUID() },
    );
    expect(restored.status).toBe(409);
    const problem = restored.body as ProblemBody;
    expect(problem.code).toBe('state_machine_conflict');
    expect(problem.fieldErrors?.some((e) => e.field === 'status')).toBe(true);

    const row = await pool.query<{ status: string }>(
      'SELECT status FROM projects WHERE project_id = $1',
      [projectId],
    );
    expect(row.rows[0]?.status).toBe('trash');
    await app.close();
  });

  it('a stale resourceVersion maps to 412 version_conflict', async () => {
    const app = buildApp();
    const owner = await registerActor(app, `owner-${randomUUID()}@example.com`);
    const projectId = await createProject(app, owner, 'Stale Version');

    await trashProject(pool, { orgId: owner.organizationId, projectId, actorId: owner.accountId });
    const staleVersion = '2020-01-01T00:00:00.000Z';

    const restored = await post(
      app,
      owner,
      `/api/platform/v1/organizations/${owner.organizationId}/trash/${projectId}/restore`,
      { resourceVersion: staleVersion, idempotencyKey: randomUUID() },
    );
    expect(restored.status).toBe(412);
    expect((restored.body as ProblemBody).code).toBe('version_conflict');
    await app.close();
  });

  it('a plain member cannot list or restore trash (403)', async () => {
    const app = buildApp();
    const owner = await registerActor(app, `owner-${randomUUID()}@example.com`);
    const member = await registerActor(app, `member-${randomUUID()}@example.com`);
    const membership = await insertOrganizationMembership(pool, {
      organizationId: owner.organizationId,
      accountId: member.accountId,
      role: 'member',
    });
    expect(membership.status).toBe('success');

    const projectId = await createProject(app, owner, 'No Peek');
    await trashProject(pool, { orgId: owner.organizationId, projectId, actorId: owner.accountId });

    const list = await getTrash(app, member, owner.organizationId);
    expect(list.status).toBe(403);
    expect((list.body as ProblemBody).code).toBe('authorization');

    const resourceVersion = await projectVersion(projectId);
    const restore = await post(
      app,
      member,
      `/api/platform/v1/organizations/${owner.organizationId}/trash/${projectId}/restore`,
      { resourceVersion, idempotencyKey: randomUUID() },
    );
    expect(restore.status).toBe(403);
    expect((restore.body as ProblemBody).code).toBe('authorization');
    await app.close();
  });
});
