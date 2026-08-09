import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { FastifyInstance } from 'fastify';
import { insertOrganizationMembership } from '@aurora/platform-identity';
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

interface CreateProjectBody {
  projectId?: string;
  clientKeyPublicIdentifier?: string;
  defaultEnvironment?: string;
  onboardingStatus?: string;
  navigationTargets?: readonly { routeId: string }[];
}

interface ProblemBody {
  code?: string;
  detail?: string;
}

/** A base64url/hex run of 40+ chars: only a secret (43), digest (64) or public
 *  identifier would reach this length — UUIDs (36) and route ids never do. */
const SECRET_LIKE = /[A-Za-z0-9_-]{40,}/;

describeDb('B2 create-project flow (real PostgreSQL 17 + Redis)', () => {
  let pool: Pool;
  let sessionStore: SessionStore;
  let keyPrefix: string;

  beforeAll(async () => {
    assertIsTestDatabase(testDatabaseUrl());
    pool = createTestPool();
    await runAllMigrations();
    await truncateIdentityTables(pool);
    keyPrefix = `test:projects-flow:${randomUUID()}`;
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
    organizationId: string,
    payload: object,
    csrfHeader: string | null = actor.csrf,
  ): Promise<{ status: number; body: CreateProjectBody | ProblemBody }> {
    const headers: Record<string, string> = {
      cookie: `aurora_session=${actor.cookie}`,
      'content-type': 'application/json',
    };
    if (csrfHeader !== null) headers['x-aurora-csrf'] = csrfHeader;
    const response = await app.inject({
      method: 'POST',
      url: `/api/platform/v1/organizations/${organizationId}/projects`,
      headers,
      payload: JSON.stringify(payload),
    });
    return { status: response.statusCode, body: response.json() };
  }

  it('owner creates a project atomically: project + env + client key + onboarding, no secret returned', async () => {
    const app = buildApp();
    const owner = await registerActor(app, `owner-${randomUUID()}@example.com`);

    const { status, body } = await createProject(app, owner, owner.organizationId, {
      name: 'Acme Web',
      frameworkType: 'vue',
      websiteUrl: 'https://acme.example.com',
      idempotencyKey: randomUUID(),
    });

    expect(status).toBe(200);
    const created = body as CreateProjectBody;
    expect(typeof created.projectId).toBe('string');
    expect(created.defaultEnvironment).toBe('production');
    expect(created.onboardingStatus).toBe('not_started');
    expect(created.clientKeyPublicIdentifier).toMatch(/^aurora_key_/);
    expect(
      created.navigationTargets?.some((t) => t.routeId === 'organization.project-create'),
    ).toBe(true);

    // The client-key secret is never returned: the response must not contain any
    // secret-like base64url token beyond the public identifier itself.
    const raw = JSON.stringify(created);
    const digestColumns = await pool.query<{ key_digest: string }>(
      'SELECT key_digest FROM client_keys WHERE project_id = $1',
      [created.projectId],
    );
    expect(digestColumns.rows).toHaveLength(1);
    const digest = digestColumns.rows[0]?.key_digest;
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(raw).not.toContain(digest ?? '');
    // No secret-like token (43-char base64url secret / 64-char digest) may appear
    // in the response; the public identifier is far shorter and starts with its
    // fixed prefix.
    expect(raw.match(SECRET_LIKE) ?? []).toEqual([]);

    // DB rows: project + default production env + client key + onboarding.
    const project = await pool.query<{ name: string; framework_type: string; status: string }>(
      'SELECT name, framework_type, status FROM projects WHERE project_id = $1',
      [created.projectId],
    );
    expect(project.rows[0]?.name).toBe('Acme Web');
    expect(project.rows[0]?.framework_type).toBe('vue');
    expect(project.rows[0]?.status).toBe('active');

    const env = await pool.query<{ name: string; is_default: boolean }>(
      'SELECT name, is_default FROM project_environments WHERE project_id = $1',
      [created.projectId],
    );
    expect(env.rows).toHaveLength(1);
    expect(env.rows[0]?.name).toBe('production');
    expect(env.rows[0]?.is_default).toBe(true);

    const key = await pool.query<{ public_identifier: string; enabled: boolean }>(
      'SELECT public_identifier, enabled FROM client_keys WHERE project_id = $1',
      [created.projectId],
    );
    expect(key.rows[0]?.public_identifier).toBe(created.clientKeyPublicIdentifier);
    expect(key.rows[0]?.enabled).toBe(true);

    const onboarding = await pool.query<{ status: string; current_step: number }>(
      'SELECT status, current_step FROM project_onboarding WHERE project_id = $1',
      [created.projectId],
    );
    expect(onboarding.rows[0]?.status).toBe('not_started');
    expect(onboarding.rows[0]?.current_step).toBe(0);
    await app.close();
  });

  it('rejects a plain member with 403 (no creatability leak)', async () => {
    const app = buildApp();
    const owner = await registerActor(app, `owner-${randomUUID()}@example.com`);
    const member = await registerActor(app, `member-${randomUUID()}@example.com`);

    const membership = await insertOrganizationMembership(pool, {
      organizationId: owner.organizationId,
      accountId: member.accountId,
      role: 'member',
    });
    expect(membership.status).toBe('success');

    const { status, body } = await createProject(app, member, owner.organizationId, {
      name: 'Sneaky',
      frameworkType: 'javascript',
      idempotencyKey: randomUUID(),
    });

    expect(status).toBe(403);
    expect((body as ProblemBody).code).toBe('authorization');
    await app.close();
  });

  it('rejects B2 create-project with a valid session but NO CSRF token (403)', async () => {
    const app = buildApp();
    const owner = await registerActor(app, `owner-${randomUUID()}@example.com`);

    const { status, body } = await createProject(
      app,
      owner,
      owner.organizationId,
      {
        name: 'No CSRF',
        frameworkType: 'javascript',
        idempotencyKey: randomUUID(),
      },
      null,
    );

    expect(status).toBe(403);
    expect((body as ProblemBody).code).toBe('authorization');
    const count = await pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM projects WHERE organization_id = $1',
      [owner.organizationId],
    );
    expect(Number(count.rows[0]?.n ?? '0')).toBe(0);
    await app.close();
  });

  it('rejects B2 create-project with a wrong CSRF token (403)', async () => {
    const app = buildApp();
    const owner = await registerActor(app, `owner-${randomUUID()}@example.com`);

    const { status, body } = await createProject(
      app,
      owner,
      owner.organizationId,
      {
        name: 'Wrong CSRF',
        frameworkType: 'javascript',
        idempotencyKey: randomUUID(),
      },
      'definitely-not-the-bound-secret',
    );

    expect(status).toBe(403);
    expect((body as ProblemBody).code).toBe('authorization');
    await app.close();
  });

  it('replays the same idempotency key with the same request (no duplicate project)', async () => {
    const app = buildApp();
    const owner = await registerActor(app, `owner-${randomUUID()}@example.com`);
    const key = randomUUID();
    const payload = {
      name: 'Idem Project',
      frameworkType: 'other',
      idempotencyKey: key,
    };

    const first = await createProject(app, owner, owner.organizationId, payload);
    const second = await createProject(app, owner, owner.organizationId, payload);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const firstBody = first.body as CreateProjectBody;
    const secondBody = second.body as CreateProjectBody;
    expect(secondBody.projectId).toBe(firstBody.projectId);
    expect(secondBody.clientKeyPublicIdentifier).toBe(firstBody.clientKeyPublicIdentifier);

    const count = await pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM projects WHERE organization_id = $1',
      [owner.organizationId],
    );
    expect(Number(count.rows[0]?.n ?? '0')).toBe(1);
    await app.close();
  });

  it('rejects the same idempotency key with a different request (409 idempotency_conflict)', async () => {
    const app = buildApp();
    const owner = await registerActor(app, `owner-${randomUUID()}@example.com`);
    const key = randomUUID();

    const first = await createProject(app, owner, owner.organizationId, {
      name: 'First Project',
      frameworkType: 'react',
      idempotencyKey: key,
    });
    expect(first.status).toBe(200);

    const second = await createProject(app, owner, owner.organizationId, {
      name: 'Different Project',
      frameworkType: 'react',
      idempotencyKey: key,
    });
    expect(second.status).toBe(409);
    expect((second.body as ProblemBody).code).toBe('idempotency_conflict');

    const count = await pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM projects WHERE organization_id = $1',
      [owner.organizationId],
    );
    expect(Number(count.rows[0]?.n ?? '0')).toBe(1);
    await app.close();
  });
});
