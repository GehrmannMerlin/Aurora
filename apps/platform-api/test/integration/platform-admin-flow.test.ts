import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

interface AuditEventItem {
  eventId: string;
  action: string;
  actorAccountId: string;
  target: { targetType?: string; accountId?: string; scope?: string };
  result: string;
  occurredAt: string;
}

describeDb('PLT-10a platform admin/audit flow (real PostgreSQL 17 + Redis)', () => {
  let pool: Pool;
  let sessionStore: SessionStore;
  let keyPrefix: string;

  beforeAll(async () => {
    assertIsTestDatabase(testDatabaseUrl());
    pool = createTestPool();
    await runAllMigrations();
    await truncateIdentityTables(pool);
    keyPrefix = `test:platform-admin-flow:${randomUUID()}`;
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

  async function getCapability(
    app: FastifyInstance,
    actor: RegisteredActor,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await app.inject({
      method: 'GET',
      url: '/api/platform/v1/platform-admin/capability',
      headers: { cookie: `aurora_session=${actor.cookie}` },
    });
    return { status: res.statusCode, body: res.json() };
  }

  async function listAdmins(
    app: FastifyInstance,
    actor: RegisteredActor,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await app.inject({
      method: 'GET',
      url: '/api/platform/v1/platform-admin/admins',
      headers: { cookie: `aurora_session=${actor.cookie}` },
    });
    return { status: res.statusCode, body: res.json() };
  }

  async function listAudit(
    app: FastifyInstance,
    actor: RegisteredActor,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await app.inject({
      method: 'GET',
      url: '/api/platform/v1/platform-admin/audit',
      headers: { cookie: `aurora_session=${actor.cookie}` },
    });
    return { status: res.statusCode, body: res.json() };
  }

  async function postGrant(
    app: FastifyInstance,
    actor: RegisteredActor,
    accountId: string,
    idempotencyKey: string,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await app.inject({
      method: 'POST',
      url: `/api/platform/v1/platform-admin/admins/${accountId}/grant`,
      headers: {
        cookie: `aurora_session=${actor.cookie}`,
        'content-type': 'application/json',
        'x-aurora-csrf': actor.csrf,
      },
      payload: JSON.stringify({ idempotencyKey }),
    });
    return { status: res.statusCode, body: res.json() };
  }

  async function postRevoke(
    app: FastifyInstance,
    actor: RegisteredActor,
    accountId: string,
    idempotencyKey: string,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await app.inject({
      method: 'POST',
      url: `/api/platform/v1/platform-admin/admins/${accountId}/revoke`,
      headers: {
        cookie: `aurora_session=${actor.cookie}`,
        'content-type': 'application/json',
        'x-aurora-csrf': actor.csrf,
      },
      payload: JSON.stringify({ idempotencyKey }),
    });
    return { status: res.statusCode, body: res.json() };
  }

  it('platform admin lifecycle: capability, list, grant (idempotent), audit, revoke, last-admin, 403', async () => {
    const app = buildApp();
    const alice = await registerVerifiedActor(app, pool, `alice-${randomUUID()}@example.com`);
    const bob = await registerVerifiedActor(app, pool, `bob-${randomUUID()}@example.com`);

    // Bootstrap bob as the only platform admin (direct repository bootstrap).
    const bootstrap = await bootstrapPlatformAdmins(pool, {
      accountIds: [bob.accountId],
      bootstrapBy: alice.accountId,
    });
    expect(bootstrap.seeded).toBe(1);

    // Capability: alice (non-admin) false; bob (admin) true. No audit_write.
    const aliceCap = await getCapability(app, alice);
    expect(aliceCap.status).toBe(200);
    expect((aliceCap.body.data as { hasCapability: boolean }).hasCapability).toBe(false);

    const bobCap = await getCapability(app, bob);
    expect(bobCap.status).toBe(200);
    expect((bobCap.body.data as { hasCapability: boolean }).hasCapability).toBe(true);

    // Admins list (admin-only): bob sees bob (+ no alice yet). Writes audit_read.
    const adminsBefore = await listAdmins(app, bob);
    expect(adminsBefore.status).toBe(200);
    const adminsBeforeData = adminsBefore.body.data as {
      admins: { items: { accountId: string }[] };
    };
    expect(adminsBeforeData.admins.items.map((a) => a.accountId)).toEqual([bob.accountId]);

    // Grant alice (idempotent key K) → alice becomes admin.
    const grantKey = `grant-${randomUUID()}`;
    const granted = await postGrant(app, bob, alice.accountId, grantKey);
    expect(granted.status).toBe(200);
    expect(granted.body.data).toEqual({ status: 'granted', accountId: alice.accountId });

    const aliceCapAfterGrant = await getCapability(app, alice);
    expect((aliceCapAfterGrant.body.data as { hasCapability: boolean }).hasCapability).toBe(true);

    // Idempotent replay of the same grant key: same result, no duplicate audit.
    const replay = await postGrant(app, bob, alice.accountId, grantKey);
    expect(replay.status).toBe(200);
    expect(replay.body.data).toEqual({ status: 'granted', accountId: alice.accountId });

    // Audit list (admin-only): contains admin_granted + audit_read; exactly ONE
    // admin_granted for alice (the replay did not re-write).
    const audit = await listAudit(app, bob);
    expect(audit.status).toBe(200);
    const auditEvents = (audit.body.data as { events: { items: AuditEventItem[] } }).events.items;
    expect(auditEvents.some((e) => e.action === 'audit_read')).toBe(true);
    const aliceGrants = auditEvents.filter(
      (e) => e.action === 'admin_granted' && e.target.accountId === alice.accountId,
    );
    expect(aliceGrants).toHaveLength(1);
    expect(aliceGrants[0]?.result).toBe('succeeded');

    // Revoke alice → capability false.
    const revoked = await postRevoke(app, bob, alice.accountId, `revoke-${randomUUID()}`);
    expect(revoked.status).toBe(200);
    expect(revoked.body.data).toEqual({ status: 'revoked', accountId: alice.accountId });

    const aliceCapAfterRevoke = await getCapability(app, alice);
    expect((aliceCapAfterRevoke.body.data as { hasCapability: boolean }).hasCapability).toBe(false);

    // Non-admin alice cannot grant → 403 authorization, no platform data leaked.
    const forbidden = await postGrant(app, alice, bob.accountId, `forbidden-${randomUUID()}`);
    expect(forbidden.status).toBe(403);
    expect(forbidden.body).not.toHaveProperty('data');
    expect((forbidden.body as { code?: string }).code).toBe('authorization');

    // Last-admin guard: revoking the sole remaining admin (bob) → 409
    // state_machine_conflict, rolls back with no audit write for admin_revoked.
    const lastAdmin = await postRevoke(app, bob, bob.accountId, `last-${randomUUID()}`);
    expect(lastAdmin.status).toBe(409);
    expect((lastAdmin.body as { code?: string }).code).toBe('state_machine_conflict');

    const bobStillAdmin = await getCapability(app, bob);
    expect((bobStillAdmin.body.data as { hasCapability: boolean }).hasCapability).toBe(true);

    await app.close();
  });
});
