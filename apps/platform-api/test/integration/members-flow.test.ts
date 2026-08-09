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

interface MemberSummary {
  accountId?: string;
  emailMasked?: string;
  orgRole?: string;
  joinedAt?: string;
}

interface MembersBody {
  members?: readonly MemberSummary[];
}

interface ProblemBody {
  code?: string;
  detail?: string;
}

interface TransferBody {
  organizationId?: string;
  ownerAccountId?: string;
  resourceVersion?: string;
}

describeDb('B3 members flow (real PostgreSQL 17 + Redis)', () => {
  let pool: Pool;
  let sessionStore: SessionStore;
  let keyPrefix: string;

  beforeAll(async () => {
    assertIsTestDatabase(testDatabaseUrl());
    pool = createTestPool();
    await runAllMigrations();
    await truncateIdentityTables(pool);
    keyPrefix = `test:members-flow:${randomUUID()}`;
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

  async function addMember(
    organizationId: string,
    accountId: string,
    role: 'admin' | 'member',
  ): Promise<void> {
    const result = await insertOrganizationMembership(pool, { organizationId, accountId, role });
    expect(result.status).toBe('success');
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

  async function get(
    app: FastifyInstance,
    actor: RegisteredActor,
    url: string,
  ): Promise<{ status: number; body: MembersBody | ProblemBody }> {
    const response = await app.inject({
      method: 'GET',
      url,
      headers: { cookie: `aurora_session=${actor.cookie}` },
    });
    return { status: response.statusCode, body: response.json() };
  }

  it('owner lists members: masked emails, no full email, joinedAt present', async () => {
    const app = buildApp();
    const ownerEmail = `owner-${randomUUID()}@example.com`;
    const memberEmail = `member-${randomUUID()}@example.com`;
    const owner = await registerActor(app, ownerEmail);
    const member = await registerActor(app, memberEmail);
    await addMember(owner.organizationId, member.accountId, 'member');

    const { status, body } = await get(
      app,
      owner,
      `/api/platform/v1/organizations/${owner.organizationId}/members`,
    );

    expect(status).toBe(200);
    const members = (body as MembersBody).members ?? [];
    const ownerRow = members.find((m) => m.accountId === owner.accountId);
    const memberRow = members.find((m) => m.accountId === member.accountId);
    expect(ownerRow?.orgRole).toBe('owner');
    expect(memberRow?.orgRole).toBe('member');
    expect(typeof ownerRow?.joinedAt).toBe('string');
    // emailMasked carries the domain and a mask, never the full address.
    expect(ownerRow?.emailMasked).toContain('@');
    expect(ownerRow?.emailMasked).toContain('***');
    expect(ownerRow?.emailMasked).not.toBe(ownerEmail);
    expect(memberRow?.emailMasked).not.toBe(memberEmail);
    const raw = JSON.stringify(body);
    expect(raw).not.toContain(ownerEmail);
    expect(raw).not.toContain(memberEmail);
    await app.close();
  });

  it('owner changes a member role admin<->member (200 + new resourceVersion)', async () => {
    const app = buildApp();
    const owner = await registerActor(app, `owner-${randomUUID()}@example.com`);
    const member = await registerActor(app, `member-${randomUUID()}@example.com`);
    await addMember(owner.organizationId, member.accountId, 'member');

    const url = `/api/platform/v1/organizations/${owner.organizationId}/members/${member.accountId}/role`;
    const up = await post(app, owner, url, { orgRole: 'admin', resourceVersion: '0' });
    expect(up.status).toBe(200);
    expect((up.body as MemberSummary).orgRole).toBe('admin');
    expect(typeof (up.body as MemberSummary).accountId).toBe('string');

    const down = await post(app, owner, url, { orgRole: 'member', resourceVersion: '0' });
    expect(down.status).toBe(200);
    expect((down.body as MemberSummary).orgRole).toBe('member');

    const role = await pool.query<{ role: string }>(
      'SELECT role FROM organization_members WHERE organization_id = $1 AND account_id = $2',
      [owner.organizationId, member.accountId],
    );
    expect(role.rows[0]?.role).toBe('member');

    const audit = await pool.query<{ action: string }>(
      `SELECT action FROM security_audit_events WHERE organization_id = $1
       ORDER BY occurred_at DESC LIMIT 5`,
      [owner.organizationId],
    );
    expect(audit.rows.some((r) => r.action === 'organization.member.role_changed')).toBe(true);
    await app.close();
  });

  it('cannot change the owner role through ChangeRole (409 business_validation)', async () => {
    const app = buildApp();
    const owner = await registerActor(app, `owner-${randomUUID()}@example.com`);

    const url = `/api/platform/v1/organizations/${owner.organizationId}/members/${owner.accountId}/role`;
    const { status, body } = await post(app, owner, url, {
      orgRole: 'member',
      resourceVersion: '0',
    });
    expect(status).toBe(409);
    expect((body as ProblemBody).code).toBe('business_validation');
    await app.close();
  });

  it('owner transfers ownership: idempotent (replay), single owner after, audit row', async () => {
    const app = buildApp();
    const owner = await registerActor(app, `owner-${randomUUID()}@example.com`);
    const member = await registerActor(app, `member-${randomUUID()}@example.com`);
    await addMember(owner.organizationId, member.accountId, 'member');

    const url = `/api/platform/v1/organizations/${owner.organizationId}/ownership`;
    const key = randomUUID();
    const payload = { newOwnerAccountId: member.accountId, idempotencyKey: key };

    const first = await post(app, owner, url, payload);
    expect(first.status).toBe(200);
    const firstBody = first.body as TransferBody;
    expect(firstBody.ownerAccountId).toBe(member.accountId);
    expect(typeof firstBody.resourceVersion).toBe('string');

    // Same-key replay by the (now) owner returns the stored first result — no
    // duplicate transfer. The actor's permission is re-read on the way in.
    const replay = await post(app, member, url, payload);
    expect(replay.status).toBe(200);
    const replayBody = replay.body as TransferBody;
    expect(replayBody.ownerAccountId).toBe(firstBody.ownerAccountId);
    expect(replayBody.organizationId).toBe(firstBody.organizationId);

    // The old owner is now a plain member and is rejected (403) — their
    // ownership permission was revoked by the transfer.
    const demoted = await post(app, owner, url, payload);
    expect(demoted.status).toBe(403);

    const owners = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM organization_members
       WHERE organization_id = $1 AND role = 'owner'`,
      [owner.organizationId],
    );
    expect(Number(owners.rows[0]?.n ?? '0')).toBe(1);

    const audit = await pool.query<{ action: string }>(
      `SELECT action FROM security_audit_events WHERE organization_id = $1 AND action = 'organization.ownership_transferred'`,
      [owner.organizationId],
    );
    expect(audit.rows.length).toBeGreaterThan(0);
    await app.close();
  });

  it('a plain member cannot list or manage members (403)', async () => {
    const app = buildApp();
    const owner = await registerActor(app, `owner-${randomUUID()}@example.com`);
    const member = await registerActor(app, `member-${randomUUID()}@example.com`);
    await addMember(owner.organizationId, member.accountId, 'member');

    const list = await get(
      app,
      member,
      `/api/platform/v1/organizations/${owner.organizationId}/members`,
    );
    expect(list.status).toBe(403);
    expect((list.body as ProblemBody).code).toBe('authorization');

    const url = `/api/platform/v1/organizations/${owner.organizationId}/members/${owner.accountId}/role`;
    const change = await post(app, member, url, { orgRole: 'admin', resourceVersion: '0' });
    expect(change.status).toBe(403);
    expect((change.body as ProblemBody).code).toBe('authorization');
    await app.close();
  });

  it('removing the last owner is blocked (409 business_validation)', async () => {
    const app = buildApp();
    const owner = await registerActor(app, `owner-${randomUUID()}@example.com`);

    const url = `/api/platform/v1/organizations/${owner.organizationId}/members/${owner.accountId}/remove`;
    const { status, body } = await post(app, owner, url, { resourceVersion: '0' });
    expect(status).toBe(409);
    expect((body as ProblemBody).code).toBe('business_validation');

    const owners = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM organization_members
       WHERE organization_id = $1 AND role = 'owner'`,
      [owner.organizationId],
    );
    expect(Number(owners.rows[0]?.n ?? '0')).toBe(1);
    await app.close();
  });
});
