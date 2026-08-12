import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { FastifyInstance } from 'fastify';
import { bootstrapPlatformAdmins } from '@aurora/platform-admin';
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

const FIXED_NOW = new Date('2026-08-12T12:00:00.000Z');

const FIVE_FIELDS = {
  defaultPeriodQuota: 1_000_000,
  warningRatio: 80,
  hardLimit: 100,
  degradationEnabled: true,
  highValueRetentionDays: 90,
} as const;

interface ProblemBody {
  code?: string;
  detail?: string;
}

interface PolicyFields {
  defaultPeriodQuota: number;
  warningRatio: number;
  hardLimit: number;
  degradationEnabled: boolean;
  highValueRetentionDays: number;
}

interface AuditRow {
  action: string;
  actor_account_id: string;
  target: unknown;
  result: string;
}

describeDb('PLT-10b platform resource-policy flow (real PostgreSQL 17 + Redis)', () => {
  let pool: Pool;
  let sessionStore: SessionStore;
  let keyPrefix: string;

  beforeAll(async () => {
    assertIsTestDatabase(testDatabaseUrl());
    pool = createTestPool();
    await runAllMigrations();
    await truncateIdentityTables(pool);
    keyPrefix = `test:resource-policy-flow:${randomUUID()}`;
    sessionStore = await createSessionStore({ url: redisUrl(), keyPrefix });
  });

  afterAll(async () => {
    await sessionStore.client.quit().catch(() => undefined);
    await pool.end();
  });

  beforeEach(async () => {
    // The three policy tables are shared across tests; reset them so every test
    // starts with a clean platform default / no org override / no project limit
    // (each test bootstraps the platform default fresh through its own GET).
    await pool.query(
      'TRUNCATE project_policy_limits, organization_policy_overrides, platform_resource_policies',
    );
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

  async function getDefault(
    app: FastifyInstance,
    actor: RegisteredActor,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await app.inject({
      method: 'GET',
      url: '/api/platform/v1/platform-admin/policy/default',
      headers: { cookie: `aurora_session=${actor.cookie}` },
    });
    return { status: res.statusCode, body: res.json() };
  }

  async function getOrgEffective(
    app: FastifyInstance,
    actor: RegisteredActor,
    organizationId: string,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await app.inject({
      method: 'GET',
      url: `/api/platform/v1/platform-admin/policy/organizations/${organizationId}/effective`,
      headers: { cookie: `aurora_session=${actor.cookie}` },
    });
    return { status: res.statusCode, body: res.json() };
  }

  async function getProjectEffective(
    app: FastifyInstance,
    actor: RegisteredActor,
    projectId: string,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await app.inject({
      method: 'GET',
      url: `/api/platform/v1/platform-admin/policy/projects/${projectId}/effective`,
      headers: { cookie: `aurora_session=${actor.cookie}` },
    });
    return { status: res.statusCode, body: res.json() };
  }

  async function getTargets(
    app: FastifyInstance,
    actor: RegisteredActor,
    q: string,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await app.inject({
      method: 'GET',
      url: `/api/platform/v1/platform-admin/policy/targets?q=${encodeURIComponent(q)}`,
      headers: { cookie: `aurora_session=${actor.cookie}` },
    });
    return { status: res.statusCode, body: res.json() };
  }

  async function postSetDefault(
    app: FastifyInstance,
    actor: RegisteredActor,
    body: object,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/platform/v1/platform-admin/policy/default',
      headers: {
        cookie: `aurora_session=${actor.cookie}`,
        'content-type': 'application/json',
        'x-aurora-csrf': actor.csrf,
      },
      payload: JSON.stringify(body),
    });
    return { status: res.statusCode, body: res.json() };
  }

  async function postSetOrganization(
    app: FastifyInstance,
    actor: RegisteredActor,
    organizationId: string,
    body: object,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await app.inject({
      method: 'POST',
      url: `/api/platform/v1/platform-admin/policy/organizations/${organizationId}`,
      headers: {
        cookie: `aurora_session=${actor.cookie}`,
        'content-type': 'application/json',
        'x-aurora-csrf': actor.csrf,
      },
      payload: JSON.stringify(body),
    });
    return { status: res.statusCode, body: res.json() };
  }

  async function postResetOrganization(
    app: FastifyInstance,
    actor: RegisteredActor,
    organizationId: string,
    body: object,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await app.inject({
      method: 'POST',
      url: `/api/platform/v1/platform-admin/policy/organizations/${organizationId}/reset`,
      headers: {
        cookie: `aurora_session=${actor.cookie}`,
        'content-type': 'application/json',
        'x-aurora-csrf': actor.csrf,
      },
      payload: JSON.stringify(body),
    });
    return { status: res.statusCode, body: res.json() };
  }

  async function postSetProjectLimit(
    app: FastifyInstance,
    actor: RegisteredActor,
    projectId: string,
    body: object,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await app.inject({
      method: 'POST',
      url: `/api/platform/v1/platform-admin/policy/projects/${projectId}/limit`,
      headers: {
        cookie: `aurora_session=${actor.cookie}`,
        'content-type': 'application/json',
        'x-aurora-csrf': actor.csrf,
      },
      payload: JSON.stringify(body),
    });
    return { status: res.statusCode, body: res.json() };
  }

  async function postClearProjectLimit(
    app: FastifyInstance,
    actor: RegisteredActor,
    projectId: string,
    body: object,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await app.inject({
      method: 'POST',
      url: `/api/platform/v1/platform-admin/policy/projects/${projectId}/limit/clear`,
      headers: {
        cookie: `aurora_session=${actor.cookie}`,
        'content-type': 'application/json',
        'x-aurora-csrf': actor.csrf,
      },
      payload: JSON.stringify(body),
    });
    return { status: res.statusCode, body: res.json() };
  }

  async function createProject(
    app: FastifyInstance,
    actor: RegisteredActor,
    name: string,
  ): Promise<{ projectId: string }> {
    const res = await app.inject({
      method: 'POST',
      url: `/api/platform/v1/organizations/${actor.organizationId}/projects`,
      headers: {
        cookie: `aurora_session=${actor.cookie}`,
        'content-type': 'application/json',
        'x-aurora-csrf': actor.csrf,
      },
      payload: JSON.stringify({
        name,
        frameworkType: 'vue',
        idempotencyKey: randomUUID(),
      }),
    });
    if (res.statusCode !== 200) {
      throw new Error(`create-project failed with ${String(res.statusCode)}: ${res.body}`);
    }
    const body: { projectId: string } = res.json();
    return { projectId: body.projectId };
  }

  async function auditEventsFor(action: string, accountId: string): Promise<AuditRow[]> {
    const res = await pool.query<AuditRow>(
      `SELECT action, actor_account_id, target, result FROM platform_audit_events
       WHERE action = $1 AND actor_account_id = $2 ORDER BY occurred_at ASC, event_id ASC`,
      [action, accountId],
    );
    return res.rows;
  }

  function projection(body: Record<string, unknown>): {
    configured: PolicyFields;
    source: string;
    effective: PolicyFields;
    version: number;
  } {
    const data = body.data as { data: { configured: PolicyFields; source: string; effective: PolicyFields; version: number } };
    return data.data;
  }

  it('non-admin alice is closed 403 on policyGetDefault with no data leaked', async () => {
    const app = buildApp();
    const alice = await registerVerifiedActor(app, pool, `alice-${randomUUID()}@example.com`);
    const bob = await registerVerifiedActor(app, pool, `bob-${randomUUID()}@example.com`);
    await bootstrapPlatformAdmins(pool, { accountIds: [bob.accountId], bootstrapBy: alice.accountId });

    const res = await getDefault(app, alice);
    expect(res.status).toBe(403);
    expect((res.body as ProblemBody).code).toBe('authorization');
    expect(res.body).not.toHaveProperty('data');

    await app.close();
  });

  it('bob (admin) resolves the bootstrapped platform default and target search is admin-gated', async () => {
    const app = buildApp();
    const alice = await registerVerifiedActor(app, pool, `alice-${randomUUID()}@example.com`);
    const bob = await registerVerifiedActor(app, pool, `bob-${randomUUID()}@example.com`);
    await bootstrapPlatformAdmins(pool, { accountIds: [bob.accountId], bootstrapBy: alice.accountId });

    // policyGetDefault triggers the controlled bootstrap: source system_default, version 1.
    const res = await getDefault(app, bob);
    expect(res.status).toBe(200);
    const p = projection(res.body);
    expect(p.source).toBe('system_default');
    expect(p.version).toBe(1);
    expect(p.configured).toEqual(FIVE_FIELDS);
    expect(p.effective).toEqual(FIVE_FIELDS);

    // Non-admin alice is closed 403 on the target search too (no data leaked).
    const forbiddenSearch = await getTargets(app, alice, 'anything');
    expect(forbiddenSearch.status).toBe(403);
    expect((forbiddenSearch.body as ProblemBody).code).toBe('authorization');
    expect(forbiddenSearch.body).not.toHaveProperty('data');

    await app.close();
  });

  it('policySetDefault sets + audits; a stale version is a closed 409 version_conflict', async () => {
    const app = buildApp();
    const alice = await registerVerifiedActor(app, pool, `alice-${randomUUID()}@example.com`);
    const bob = await registerVerifiedActor(app, pool, `bob-${randomUUID()}@example.com`);
    await bootstrapPlatformAdmins(pool, { accountIds: [bob.accountId], bootstrapBy: alice.accountId });

    await getDefault(app, bob); // bootstrap → version 1

    const set = await postSetDefault(app, bob, {
      defaultPeriodQuota: 2_000_000,
      warningRatio: 85,
      hardLimit: 100,
      degradationEnabled: true,
      highValueRetentionDays: 60,
      version: 1,
      idempotencyKey: randomUUID(),
    });
    expect(set.status).toBe(200);
    expect(set.body.data).toEqual({ status: 'set', version: 2 });

    const audits = await auditEventsFor('policy_set_default', bob.accountId);
    expect(audits).toHaveLength(1);
    expect(audits[0]?.result).toBe('succeeded');
    expect(audits[0]?.target).toEqual({ targetType: 'platform' });

    // Stale version → 409 version_conflict (no silent overwrite, no audit).
    const stale = await postSetDefault(app, bob, {
      defaultPeriodQuota: 3_000_000,
      warningRatio: 85,
      hardLimit: 100,
      degradationEnabled: true,
      highValueRetentionDays: 60,
      version: 1,
      idempotencyKey: randomUUID(),
    });
    expect(stale.status).toBe(409);
    expect((stale.body as ProblemBody).code).toBe('version_conflict');
    expect(await auditEventsFor('policy_set_default', bob.accountId)).toHaveLength(1);

    // Invalid ratio order (warningRatio >= hardLimit) → 422 field_validation.
    const bad = await postSetDefault(app, bob, {
      defaultPeriodQuota: 2_000_000,
      warningRatio: 90,
      hardLimit: 50,
      degradationEnabled: true,
      highValueRetentionDays: 60,
      version: 2,
      idempotencyKey: randomUUID(),
    });
    expect(bad.status).toBe(422);
    expect((bad.body as ProblemBody).code).toBe('field_validation');
    expect(await auditEventsFor('policy_set_default', bob.accountId)).toHaveLength(1);

    // The failed set did not advance the version.
    const after = await getDefault(app, bob);
    expect(projection(after.body).version).toBe(2);

    await app.close();
  });

  it('policySetOrganization sets + audits; effective org projection reflects the override', async () => {
    const app = buildApp();
    const alice = await registerVerifiedActor(app, pool, `alice-${randomUUID()}@example.com`);
    const bob = await registerVerifiedActor(app, pool, `bob-${randomUUID()}@example.com`);
    await bootstrapPlatformAdmins(pool, { accountIds: [bob.accountId], bootstrapBy: alice.accountId });
    await getDefault(app, bob);

    // Before override: org effective inherits the platform default.
    const before = await getOrgEffective(app, bob, bob.organizationId);
    expect(before.status).toBe(200);
    const beforeP = projection(before.body);
    expect(beforeP.source).toBe('inherited_from_platform');
    expect(beforeP.version).toBe(0);
    expect(beforeP.effective).toEqual(FIVE_FIELDS);

    const set = await postSetOrganization(app, bob, bob.organizationId, {
      defaultPeriodQuota: 500_000,
      warningRatio: 85,
      hardLimit: 100,
      degradationEnabled: true,
      highValueRetentionDays: 60,
      version: 0,
      idempotencyKey: randomUUID(),
    });
    expect(set.status).toBe(200);
    expect(set.body.data).toEqual({ status: 'set', version: 1 });

    const audits = await auditEventsFor('policy_set_organization', bob.accountId);
    expect(audits).toHaveLength(1);
    expect(audits[0]?.result).toBe('succeeded');
    expect(audits[0]?.target).toEqual({ targetType: 'organization', organizationId: bob.organizationId });

    const after = await getOrgEffective(app, bob, bob.organizationId);
    expect(after.status).toBe(200);
    const afterP = projection(after.body);
    expect(afterP.source).toBe('platform_admin');
    expect(afterP.version).toBe(1);
    expect(afterP.effective).toEqual({
      defaultPeriodQuota: 500_000,
      warningRatio: 85,
      hardLimit: 100,
      degradationEnabled: true,
      highValueRetentionDays: 60,
    });

    // Nonexistent organization → closed 404.
    const missing = await postSetOrganization(app, bob, randomUUID(), {
      defaultPeriodQuota: 500_000,
      warningRatio: 85,
      hardLimit: 100,
      degradationEnabled: true,
      highValueRetentionDays: 60,
      version: 0,
      idempotencyKey: randomUUID(),
    });
    expect(missing.status).toBe(404);
    expect((missing.body as ProblemBody).code).toBe('not_found');

    // Malformed organizationId → 400 structural_error.
    const malformed = await postSetOrganization(app, bob, 'not-a-uuid', {
      defaultPeriodQuota: 500_000,
      warningRatio: 85,
      hardLimit: 100,
      degradationEnabled: true,
      highValueRetentionDays: 60,
      version: 0,
      idempotencyKey: randomUUID(),
    });
    expect(malformed.status).toBe(400);
    expect((malformed.body as ProblemBody).code).toBe('structural_error');

    // Nonexistent organization on the effective GET → closed 404 (not a 200
    // inherited_from_platform projection for a phantom target).
    const missingOrgRead = await getOrgEffective(app, bob, randomUUID());
    expect(missingOrgRead.status).toBe(404);
    expect((missingOrgRead.body as ProblemBody).code).toBe('not_found');

    await app.close();
  });

  it('policySetProjectLimit sets + audits; project effective overlays resourceLimit and inherits the rest', async () => {
    const app = buildApp();
    const alice = await registerVerifiedActor(app, pool, `alice-${randomUUID()}@example.com`);
    const bob = await registerVerifiedActor(app, pool, `bob-${randomUUID()}@example.com`);
    await bootstrapPlatformAdmins(pool, { accountIds: [bob.accountId], bootstrapBy: alice.accountId });
    await getDefault(app, bob);
    // Org override so the five inherited fields differ from the platform default.
    await postSetOrganization(app, bob, bob.organizationId, {
      defaultPeriodQuota: 500_000,
      warningRatio: 85,
      hardLimit: 100,
      degradationEnabled: true,
      highValueRetentionDays: 60,
      version: 0,
      idempotencyKey: randomUUID(),
    });
    const { projectId } = await createProject(app, bob, `plt10b-flow-${randomUUID()}`);

    // Before the project limit: no explicit resourceLimit is reported (the
    // org override is present, so source is inherited_from_organization and the
    // five protective fields come from the override).
    const before = await getProjectEffective(app, bob, projectId);
    expect(before.status).toBe(200);
    const beforeData = (before.body.data as {
      data: {
        configured: Record<string, unknown>;
        source: string;
        effective: Record<string, unknown>;
        version: number;
      };
    }).data;
    expect(beforeData.source).toBe('inherited_from_organization');
    expect(beforeData.version).toBe(0);
    expect(beforeData.configured).not.toHaveProperty('resourceLimit');
    expect(beforeData.effective).not.toHaveProperty('resourceLimit');
    expect(beforeData.effective).toMatchObject({
      defaultPeriodQuota: 500_000,
      warningRatio: 85,
      hardLimit: 100,
      degradationEnabled: true,
      highValueRetentionDays: 60,
    });

    const set = await postSetProjectLimit(app, bob, projectId, {
      resourceLimit: 50_000,
      version: 0,
      idempotencyKey: randomUUID(),
    });
    expect(set.status).toBe(200);
    expect(set.body.data).toEqual({ status: 'set', version: 1 });

    const audits = await auditEventsFor('policy_set_project_limit', bob.accountId);
    expect(audits).toHaveLength(1);
    expect(audits[0]?.target).toEqual({ targetType: 'project', projectId });

    const after = await getProjectEffective(app, bob, projectId);
    expect(after.status).toBe(200);
    const data = (after.body.data as { data: { configured: { resourceLimit: number }; source: string; effective: PolicyFields & { resourceLimit: number }; version: number } }).data;
    expect(data.source).toBe('platform_admin');
    expect(data.version).toBe(1);
    expect(data.configured).toEqual({ resourceLimit: 50_000 });
    expect(data.effective).toEqual({
      defaultPeriodQuota: 500_000,
      warningRatio: 85,
      hardLimit: 100,
      degradationEnabled: true,
      highValueRetentionDays: 60,
      resourceLimit: 50_000,
    });

    // Nonexistent project → closed 404.
    const missing = await postSetProjectLimit(app, bob, randomUUID(), {
      resourceLimit: 50_000,
      version: 0,
      idempotencyKey: randomUUID(),
    });
    expect(missing.status).toBe(404);
    expect((missing.body as ProblemBody).code).toBe('not_found');

    await app.close();
  });

  it('policyResetOrganization / policyClearProjectLimit require confirm and write their audit', async () => {
    const app = buildApp();
    const alice = await registerVerifiedActor(app, pool, `alice-${randomUUID()}@example.com`);
    const bob = await registerVerifiedActor(app, pool, `bob-${randomUUID()}@example.com`);
    await bootstrapPlatformAdmins(pool, { accountIds: [bob.accountId], bootstrapBy: alice.accountId });
    await getDefault(app, bob);
    await postSetOrganization(app, bob, bob.organizationId, {
      defaultPeriodQuota: 500_000,
      warningRatio: 85,
      hardLimit: 100,
      degradationEnabled: true,
      highValueRetentionDays: 60,
      version: 0,
      idempotencyKey: randomUUID(),
    });
    const { projectId } = await createProject(app, bob, `plt10b-clear-${randomUUID()}`);
    await postSetProjectLimit(app, bob, projectId, {
      resourceLimit: 50_000,
      version: 0,
      idempotencyKey: randomUUID(),
    });

    // confirm:false is rejected 422 field_validation.
    const noConfirmReset = await postResetOrganization(app, bob, bob.organizationId, {
      version: 1,
      confirm: false,
      idempotencyKey: randomUUID(),
    });
    expect(noConfirmReset.status).toBe(422);
    expect((noConfirmReset.body as ProblemBody).code).toBe('field_validation');

    const noConfirmClear = await postClearProjectLimit(app, bob, projectId, {
      version: 1,
      confirm: false,
      idempotencyKey: randomUUID(),
    });
    expect(noConfirmClear.status).toBe(422);
    expect((noConfirmClear.body as ProblemBody).code).toBe('field_validation');

    // Confirm reset → 200 + audit; org effective source back to inherited.
    const reset = await postResetOrganization(app, bob, bob.organizationId, {
      version: 1,
      confirm: true,
      idempotencyKey: randomUUID(),
    });
    expect(reset.status).toBe(200);
    expect(reset.body.data).toEqual({ status: 'reset' });
    const resetAudits = await auditEventsFor('policy_reset_organization', bob.accountId);
    expect(resetAudits).toHaveLength(1);
    expect(resetAudits[0]?.target).toEqual({ targetType: 'organization', organizationId: bob.organizationId });

    const orgAfter = await getOrgEffective(app, bob, bob.organizationId);
    expect(projection(orgAfter.body).source).toBe('inherited_from_platform');

    // Confirm clear → 200 + audit; project effective source back to inherited.
    const clear = await postClearProjectLimit(app, bob, projectId, {
      version: 1,
      confirm: true,
      idempotencyKey: randomUUID(),
    });
    expect(clear.status).toBe(200);
    expect(clear.body.data).toEqual({ status: 'cleared' });
    const clearAudits = await auditEventsFor('policy_clear_project_limit', bob.accountId);
    expect(clearAudits).toHaveLength(1);
    expect(clearAudits[0]?.target).toEqual({ targetType: 'project', projectId });

    const projectAfter = await getProjectEffective(app, bob, projectId);
    expect(projectAfter.status).toBe(200);
    const projectData = (projectAfter.body.data as {
      data: {
        configured: Record<string, unknown>;
        source: string;
        effective: Record<string, unknown>;
        version: number;
      };
    }).data;
    expect(projectData.source).toBe('inherited_from_platform');
    expect(projectData.version).toBe(0);
    // After clear, NO project resourceLimit is reported in configured/effective.
    expect(projectData.configured).not.toHaveProperty('resourceLimit');
    expect(projectData.effective).not.toHaveProperty('resourceLimit');

    // A truly nonexistent target is a closed 404 (confirm is still validated).
    const missingReset = await postResetOrganization(app, bob, randomUUID(), {
      version: 0,
      confirm: true,
      idempotencyKey: randomUUID(),
    });
    expect(missingReset.status).toBe(404);
    expect((missingReset.body as ProblemBody).code).toBe('not_found');

    const missingClear = await postClearProjectLimit(app, bob, randomUUID(), {
      version: 0,
      confirm: true,
      idempotencyKey: randomUUID(),
    });
    expect(missingClear.status).toBe(404);
    expect((missingClear.body as ProblemBody).code).toBe('not_found');

    await app.close();
  });

  it('policyTargetSearch finds organizations and projects by name prefix', async () => {
    const app = buildApp();
    const alice = await registerVerifiedActor(app, pool, `alice-${randomUUID()}@example.com`);
    const bob = await registerVerifiedActor(app, pool, `bob-${randomUUID()}@example.com`);
    await bootstrapPlatformAdmins(pool, { accountIds: [bob.accountId], bootstrapBy: alice.accountId });

    const prefix = `p10-${randomUUID()}`;
    // A kind='organization' org (the search only returns organization-kind orgs).
    const orgRes = await pool.query<{ organization_id: string }>(
      `INSERT INTO organizations (name, kind) VALUES ($1, 'organization') RETURNING organization_id`,
      [`${prefix}-org`],
    );
    const orgId = orgRes.rows[0]?.organization_id;
    expect(typeof orgId).toBe('string');

    // A project (HTTP-created in bob's personal org) with the same prefix.
    const { projectId } = await createProject(app, bob, `${prefix}-proj`);

    const res = await getTargets(app, bob, prefix);
    expect(res.status).toBe(200);
    const data = res.body.data as {
      organizations: { organizationId: string; name: string }[];
      projects: { projectId: string; name: string }[];
      pagination: { totalCount: number; totalCountStatus: string };
    };
    expect(data.organizations.some((org) => org.organizationId === orgId)).toBe(true);
    expect(data.projects.some((project) => project.projectId === projectId)).toBe(true);
    expect(data.pagination.totalCount).toBe(
      data.organizations.length + data.projects.length,
    );
    expect(data.pagination.totalCountStatus).toBe('available');

    await app.close();
  });
});
