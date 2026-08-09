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

interface AuditEvent {
  eventId?: string;
  action?: string;
  occurredAt?: string;
  result?: string;
  actorMasked?: string;
}

interface AuditBody {
  events?: readonly AuditEvent[];
  pagination?: { totalCountStatus?: string };
}

interface ProblemBody {
  code?: string;
}

/** Secret-like tokens (base64url/hex runs of 40+ chars) never reach a B7 page. */
const SECRET_LIKE = /[A-Za-z0-9_-]{40,}/;

describeDb('B7 security-audit flow (real PostgreSQL 17 + Redis)', () => {
  let pool: Pool;
  let sessionStore: SessionStore;
  let keyPrefix: string;

  beforeAll(async () => {
    assertIsTestDatabase(testDatabaseUrl());
    pool = createTestPool();
    await runAllMigrations();
    await truncateIdentityTables(pool);
    keyPrefix = `test:audit-flow:${randomUUID()}`;
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

  async function getAudit(
    app: FastifyInstance,
    actor: RegisteredActor,
    organizationId: string,
    query = 'limit=20',
  ): Promise<{ status: number; body: AuditBody | ProblemBody }> {
    const response = await app.inject({
      method: 'GET',
      url: `/api/platform/v1/organizations/${organizationId}/audit?${query}`,
      headers: { cookie: `aurora_session=${actor.cookie}` },
    });
    return { status: response.statusCode, body: response.json() };
  }

  it('owner sees a redacted timeline after org actions (no full email/secret)', async () => {
    const app = buildApp();
    const ownerEmail = `owner-${randomUUID()}@example.com`;
    const owner = await registerActor(app, ownerEmail);

    // Generate an audit row via a B2 create-project (writes `project.created`).
    const created = await app.inject({
      method: 'POST',
      url: `/api/platform/v1/organizations/${owner.organizationId}/projects`,
      headers: {
        cookie: `aurora_session=${owner.cookie}`,
        'content-type': 'application/json',
        'x-aurora-csrf': owner.csrf,
      },
      payload: JSON.stringify({
        name: 'Audited Project',
        frameworkType: 'vue',
        idempotencyKey: randomUUID(),
      }),
    });
    expect(created.statusCode).toBe(200);

    const { status, body } = await getAudit(app, owner, owner.organizationId);
    expect(status).toBe(200);
    const audit = body as AuditBody;
    const events = audit.events ?? [];
    expect(events.length).toBeGreaterThan(0);
    expect(events.some((e) => e.action === 'project.created')).toBe(true);

    for (const event of events) {
      expect(typeof event.eventId).toBe('string');
      expect(typeof event.action).toBe('string');
      expect(typeof event.occurredAt).toBe('string');
      expect(['succeeded', 'failed', 'blocked']).toContain(event.result);
      // actorMasked is a masked identifier (8 hex + ellipsis) or the stable label.
      expect(typeof event.actorMasked).toBe('string');
      expect(event.actorMasked ?? '').not.toBe(ownerEmail);
    }

    const raw = JSON.stringify(body);
    expect(raw).not.toContain(ownerEmail);
    expect(raw.match(SECRET_LIKE) ?? []).toEqual([]);
    await app.close();
  });

  it('a plain member is forbidden and nothing about the audit is leaked', async () => {
    const app = buildApp();
    const owner = await registerActor(app, `owner-${randomUUID()}@example.com`);
    const member = await registerActor(app, `member-${randomUUID()}@example.com`);
    const membership = await insertOrganizationMembership(pool, {
      organizationId: owner.organizationId,
      accountId: member.accountId,
      role: 'member',
    });
    expect(membership.status).toBe('success');

    const { status, body } = await getAudit(app, member, owner.organizationId);
    expect(status).toBe(403);
    expect((body as ProblemBody).code).toBe('authorization');
    // The problem body carries only the closed error fields — no events/pagination.
    const raw = JSON.stringify(body);
    expect(raw).not.toContain('events');
    expect(raw).not.toContain('actorMasked');
    await app.close();
  });

  it('missing limit in the query maps to 400 structural_error', async () => {
    const app = buildApp();
    const owner = await registerActor(app, `owner-${randomUUID()}@example.com`);

    const { status, body } = await getAudit(app, owner, owner.organizationId, '');
    expect(status).toBe(400);
    expect((body as ProblemBody).code).toBe('structural_error');
    await app.close();
  });
});
