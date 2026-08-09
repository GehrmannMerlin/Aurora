import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { FastifyInstance } from 'fastify';
import {
  createAccount,
  createInvitation,
  createIntentToken,
  createPersonalOrganization,
  normalizeEmail,
} from '@aurora/platform-identity';
import { createSessionStore, type SessionStore } from '@aurora/platform-session';
import { ConsoleEmailAdapter } from '@aurora/platform-email';
import { buildPlatformApi } from '../../src/app.js';
import { loadPlatformApiConfig } from '../../src/config.js';
import {
  assertIsTestDatabase,
  createTestPool,
  extractSessionCookie,
  redisUrl,
  runIdentityMigrations,
  testDatabaseUrl,
  truncateIdentityTables,
} from './helpers.js';

const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const hasRedis = process.env.AURORA_TEST_REDIS_URL !== undefined;
const describeDb = hasDb && hasRedis ? describe : describe.skip;

const FIXED_NOW = new Date('2026-08-09T00:00:00.000Z');

interface SessionBody {
  csrf?: string;
}

interface AcceptInvitationBody {
  organization?: { name: string; role: string; organizationId: string };
  navigationTargets?: readonly { routeId: string }[];
}

interface ProblemBody {
  code: string;
  detail: string;
}

describeDb('invitation accept flow (real PostgreSQL 17 + Redis)', () => {
  let pool: Pool;
  let sessionStore: SessionStore;
  let keyPrefix: string;

  beforeAll(async () => {
    assertIsTestDatabase(testDatabaseUrl());
    pool = createTestPool();
    await runIdentityMigrations();
    await truncateIdentityTables(pool);
    keyPrefix = `test:invitation-flow:${randomUUID()}`;
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

  async function register(app: FastifyInstance, email: string): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/platform/v1/auth/register',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        email,
        password: 's3cure-Passw0rd!',
        idempotencyKey: randomUUID(),
      }),
    });
    expect(response.statusCode).toBe(200);
    return extractSessionCookie(response.headers['set-cookie']);
  }

  async function csrfFor(app: FastifyInstance, cookie: string): Promise<string> {
    const session = await app.inject({
      method: 'GET',
      url: '/api/platform/v1/session',
      headers: { cookie: `aurora_session=${cookie}` },
    });
    expect(session.statusCode).toBe(200);
    const sessionBody: SessionBody = session.json();
    const csrf = sessionBody.csrf;
    expect(typeof csrf).toBe('string');
    return csrf ?? '';
  }

  async function createInvitationFor(app: FastifyInstance, invitedEmail: string): Promise<string> {
    // Inviter account + personal org via the data layer.
    const inviterEmail = `inviter-${randomUUID()}@example.com`;
    const inviter = await createAccount(pool, {
      email: inviterEmail,
      emailNormalized: normalizeEmail(inviterEmail),
      passwordHash: 'hash',
      status: 'active',
    });
    if (inviter.status !== 'success') throw new Error('expected inviter account');
    const org = await createPersonalOrganization(pool, {
      name: 'Acme Org',
      accountId: inviter.account.accountId,
    });
    if (org.status !== 'success') throw new Error('expected org');

    const { token, digest } = createIntentToken();
    const created = await createInvitation(pool, {
      organizationId: org.organizationId,
      invitedEmail: normalizeEmail(invitedEmail),
      orgRole: 'member',
      tokenDigest: digest,
      expiresAt: new Date(FIXED_NOW.getTime() + 7 * 24 * 60 * 60 * 1000),
    });
    if (created.status !== 'success') throw new Error('expected invitation');
    void app;
    return token;
  }

  async function establishInvitationIntent(app: FastifyInstance, token: string): Promise<string> {
    const link = await app.inject({
      method: 'GET',
      url: `/api/platform/v1/auth/invitations/${token}`,
    });
    expect(link.statusCode).toBe(200);
    const setCookie = link.headers['set-cookie'];
    const cookieValue = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    const match = /^aurora_intent=([^;]+)/.exec(cookieValue ?? '');
    expect(match).not.toBeNull();
    return match?.[1] ?? '';
  }

  it('accepts an invitation with a matching account: membership created + invitation accepted', async () => {
    const app = buildApp();
    const inviteeEmail = `invitee-${randomUUID()}@example.com`;
    const token = await createInvitationFor(app, inviteeEmail);

    const cookie = await register(app, inviteeEmail);
    const csrf = await csrfFor(app, cookie);
    const intentCookie = await establishInvitationIntent(app, token);

    const accept = await app.inject({
      method: 'POST',
      url: '/api/platform/v1/invitations/accept',
      headers: {
        cookie: `aurora_session=${cookie}; aurora_intent=${intentCookie}`,
        'content-type': 'application/json',
        'x-aurora-csrf': csrf,
      },
      payload: JSON.stringify({ idempotencyKey: randomUUID() }),
    });
    expect(accept.statusCode).toBe(200);
    const body: AcceptInvitationBody = accept.json();
    expect(body.organization?.name).toBe('Acme Org');
    expect(body.organization?.role).toBe('member');
    expect(typeof body.organization?.organizationId).toBe('string');
    // N1: navigationTargets is now the array shape (matching identityGetSession).
    expect(body.navigationTargets?.some((t) => t.routeId === 'workspace.home')).toBe(true);

    // DB: membership + invitation accepted + audit.
    const member = await pool.query<{ role: string }>(
      'SELECT role FROM organization_members WHERE organization_id = $1',
      [body.organization?.organizationId],
    );
    expect(member.rows.some((r) => r.role === 'member')).toBe(true);

    const invitation = await pool.query<{ status: string }>(
      'SELECT status FROM organization_invitations WHERE organization_id = $1',
      [body.organization?.organizationId],
    );
    expect(invitation.rows[0]?.status).toBe('accepted');

    const audit = await pool.query(
      "SELECT event_id FROM security_audit_events WHERE action = 'invitation.accepted'",
    );
    expect(audit.rows.length).toBe(1);
    await app.close();
  });

  it('email mismatch returns 404 with only the masked invited email (no org details)', async () => {
    const app = buildApp();
    const invitedEmail = `mismatch-invited-${randomUUID()}@example.com`;
    const token = await createInvitationFor(app, invitedEmail);

    // Logged in as a DIFFERENT account.
    const otherEmail = `mismatch-other-${randomUUID()}@example.com`;
    const cookie = await register(app, otherEmail);
    const csrf = await csrfFor(app, cookie);
    const intentCookie = await establishInvitationIntent(app, token);

    const accept = await app.inject({
      method: 'POST',
      url: '/api/platform/v1/invitations/accept',
      headers: {
        cookie: `aurora_session=${cookie}; aurora_intent=${intentCookie}`,
        'content-type': 'application/json',
        'x-aurora-csrf': csrf,
      },
      payload: JSON.stringify({ idempotencyKey: randomUUID() }),
    });
    expect(accept.statusCode).toBe(404);
    const body: ProblemBody = accept.json();
    expect(body.code).toBe('not_found');
    // Only the masked invited email appears — never the org name or full email.
    expect(body.detail).toContain('@example.com');
    expect(body.detail).not.toContain('Acme Org');
    expect(body.detail).not.toContain(invitedEmail);
    await app.close();
  });

  it('rejects accept without a this-visit invitation intent (404)', async () => {
    const app = buildApp();
    const inviteeEmail = `no-intent-${randomUUID()}@example.com`;
    await createInvitationFor(app, inviteeEmail);

    const cookie = await register(app, inviteeEmail);
    const csrf = await csrfFor(app, cookie);

    const accept = await app.inject({
      method: 'POST',
      url: '/api/platform/v1/invitations/accept',
      headers: {
        cookie: `aurora_session=${cookie}`,
        'content-type': 'application/json',
        'x-aurora-csrf': csrf,
      },
      payload: JSON.stringify({ idempotencyKey: randomUUID() }),
    });
    expect(accept.statusCode).toBe(404);
    const problem: ProblemBody = accept.json();
    expect(problem.code).toBe('not_found');
    await app.close();
  });
});
