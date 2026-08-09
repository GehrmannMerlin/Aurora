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

interface UpdateTimezoneBody {
  organizationId?: string;
  timezone?: string;
  resourceVersion?: string;
}

interface ProblemBody {
  code?: string;
  detail?: string;
  fieldErrors?: readonly { field?: string; reason?: string }[];
}

interface SettingsRow {
  timezone: string;
  settings_version: number;
}

describeDb('B4 update-timezone flow (real PostgreSQL 17 + Redis)', () => {
  let pool: Pool;
  let sessionStore: SessionStore;
  let keyPrefix: string;

  beforeAll(async () => {
    assertIsTestDatabase(testDatabaseUrl());
    pool = createTestPool();
    await runAllMigrations();
    await truncateIdentityTables(pool);
    keyPrefix = `test:settings-flow:${randomUUID()}`;
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

  async function readSettings(organizationId: string): Promise<SettingsRow> {
    const result = await pool.query<SettingsRow>(
      'SELECT timezone, settings_version FROM organizations WHERE organization_id = $1',
      [organizationId],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('no org row');
    return row;
  }

  async function updateTimezone(
    app: FastifyInstance,
    actor: RegisteredActor,
    organizationId: string,
    payload: object,
    csrfHeader: string | null = actor.csrf,
  ): Promise<{ status: number; body: UpdateTimezoneBody | ProblemBody }> {
    const headers: Record<string, string> = {
      cookie: `aurora_session=${actor.cookie}`,
      'content-type': 'application/json',
    };
    if (csrfHeader !== null) headers['x-aurora-csrf'] = csrfHeader;
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/platform/v1/organizations/${organizationId}/settings/timezone`,
      headers,
      payload: JSON.stringify(payload),
    });
    return { status: response.statusCode, body: response.json() };
  }

  it('owner updates the org timezone: 200 with the new resourceVersion', async () => {
    const app = buildApp();
    const owner = await registerActor(app, `owner-${randomUUID()}@example.com`);
    const before = await readSettings(owner.organizationId);
    expect(before.settings_version).toBe(0);

    const { status, body } = await updateTimezone(app, owner, owner.organizationId, {
      timezone: 'Asia/Tokyo',
      resourceVersion: String(before.settings_version),
    });

    expect(status).toBe(200);
    const updated = body as UpdateTimezoneBody;
    expect(updated.organizationId).toBe(owner.organizationId);
    expect(updated.timezone).toBe('Asia/Tokyo');
    expect(updated.resourceVersion).toBe(String(before.settings_version + 1));

    const after = await readSettings(owner.organizationId);
    expect(after.timezone).toBe('Asia/Tokyo');
    expect(after.settings_version).toBe(before.settings_version + 1);
    await app.close();
  });

  it('stale resourceVersion maps to 412 version_conflict with the server current version', async () => {
    const app = buildApp();
    const owner = await registerActor(app, `owner-${randomUUID()}@example.com`);

    // Bump to version 1.
    const first = await updateTimezone(app, owner, owner.organizationId, {
      timezone: 'America/New_York',
      resourceVersion: '0',
    });
    expect(first.status).toBe(200);
    expect((first.body as UpdateTimezoneBody).resourceVersion).toBe('1');

    // Retry with the stale version 0.
    const stale = await updateTimezone(app, owner, owner.organizationId, {
      timezone: 'Asia/Shanghai',
      resourceVersion: '0',
    });
    expect(stale.status).toBe(412);
    const problem = stale.body as ProblemBody;
    expect(problem.code).toBe('version_conflict');
    expect(problem.fieldErrors?.some((e) => e.field === 'resourceVersion')).toBe(true);
    expect(problem.fieldErrors?.[0]?.reason).toContain('1');

    // The timezone is unchanged.
    const after = await readSettings(owner.organizationId);
    expect(after.timezone).toBe('America/New_York');
    await app.close();
  });

  it('rejects a plain member with 403 (no settings-write leak)', async () => {
    const app = buildApp();
    const owner = await registerActor(app, `owner-${randomUUID()}@example.com`);
    const member = await registerActor(app, `member-${randomUUID()}@example.com`);

    const membership = await insertOrganizationMembership(pool, {
      organizationId: owner.organizationId,
      accountId: member.accountId,
      role: 'member',
    });
    expect(membership.status).toBe('success');

    const { status, body } = await updateTimezone(app, member, owner.organizationId, {
      timezone: 'Europe/Berlin',
      resourceVersion: '0',
    });
    expect(status).toBe(403);
    expect((body as ProblemBody).code).toBe('authorization');
    await app.close();
  });

  it('rejects B4 update-timezone with a valid session but NO CSRF token (403)', async () => {
    const app = buildApp();
    const owner = await registerActor(app, `owner-${randomUUID()}@example.com`);

    const { status, body } = await updateTimezone(
      app,
      owner,
      owner.organizationId,
      {
        timezone: 'Asia/Tokyo',
        resourceVersion: '0',
      },
      null,
    );

    expect(status).toBe(403);
    expect((body as ProblemBody).code).toBe('authorization');
    const after = await readSettings(owner.organizationId);
    expect(after.timezone).not.toBe('Asia/Tokyo');
    await app.close();
  });

  it('rejects a non-numeric resourceVersion with 400 structural_error', async () => {
    const app = buildApp();
    const owner = await registerActor(app, `owner-${randomUUID()}@example.com`);

    const { status, body } = await updateTimezone(app, owner, owner.organizationId, {
      timezone: 'Asia/Tokyo',
      resourceVersion: 'not-a-number',
    });

    expect(status).toBe(400);
    expect((body as ProblemBody).code).toBe('structural_error');
    const after = await readSettings(owner.organizationId);
    expect(after.timezone).not.toBe('Asia/Tokyo');
    await app.close();
  });
});
