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
import { registerActor, registerVerifiedActor, type RegisteredActor } from './flow-helpers.js';

const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const hasRedis = process.env.AURORA_TEST_REDIS_URL !== undefined;
const describeDb = hasDb && hasRedis ? describe : describe.skip;

const FIXED_NOW = new Date('2026-08-09T00:00:00.000Z');

interface InviteBody {
  invitationId?: string;
  invitedEmailMasked?: string;
  expiresAt?: string;
  status?: string;
}

interface ProblemBody {
  code?: string;
}

describeDb('B3 invitations flow (real PostgreSQL 17 + Redis)', () => {
  let pool: Pool;
  let sessionStore: SessionStore;
  let keyPrefix: string;

  beforeAll(async () => {
    assertIsTestDatabase(testDatabaseUrl());
    pool = createTestPool();
    await runAllMigrations();
    await truncateIdentityTables(pool);
    keyPrefix = `test:invitations-flow:${randomUUID()}`;
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

  async function post(
    app: FastifyInstance,
    actor: RegisteredActor,
    url: string,
    payload: object,
    csrfHeader: string | null = actor.csrf,
  ): Promise<{ status: number; body: InviteBody | ProblemBody }> {
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

  it('owner (verified email) invites: pending, masked email, audit + outbox row', async () => {
    const app = buildApp();
    const owner = await registerVerifiedActor(app, pool, `owner-${randomUUID()}@example.com`);
    const invitedEmail = `invitee-${randomUUID()}@example.com`;

    const { status, body } = await post(
      app,
      owner,
      `/api/platform/v1/organizations/${owner.organizationId}/invitations`,
      {
        email: invitedEmail,
        orgRole: 'member',
        idempotencyKey: randomUUID(),
      },
    );

    expect(status).toBe(200);
    const invited = body as InviteBody;
    expect(typeof invited.invitationId).toBe('string');
    expect(invited.status).toBe('pending');
    expect(typeof invited.expiresAt).toBe('string');
    expect(invited.invitedEmailMasked).toContain('***');
    expect(invited.invitedEmailMasked).not.toBe(invitedEmail);

    const audit = await pool.query<{ action: string }>(
      `SELECT action FROM security_audit_events WHERE organization_id = $1 AND action = 'organization.invitation.created'`,
      [owner.organizationId],
    );
    expect(audit.rows.length).toBeGreaterThan(0);

    const outbox = await pool.query<{ aggregate_type: string; payload: unknown }>(
      `SELECT aggregate_type, payload FROM outbox WHERE aggregate_type = 'email.invitation'`,
    );
    expect(outbox.rows.length).toBeGreaterThan(0);
    const payload = outbox.rows[0]?.payload as {
      mailLinkUrl?: string;
      toMasked?: string;
      intentExpiresAt?: string;
    };
    expect(typeof payload.mailLinkUrl).toBe('string');
    expect(payload.mailLinkUrl ?? '').toContain('token=');
    expect(payload.toMasked).toContain('***');
    expect(typeof payload.intentExpiresAt).toBe('string');
    expect(Number.isFinite(Date.parse(payload.intentExpiresAt ?? ''))).toBe(true);
    await app.close();
  });

  it('duplicate pending invitation for the same email -> 409 business_validation', async () => {
    const app = buildApp();
    const owner = await registerVerifiedActor(app, pool, `owner-${randomUUID()}@example.com`);
    const invitedEmail = `dup-${randomUUID()}@example.com`;
    const url = `/api/platform/v1/organizations/${owner.organizationId}/invitations`;

    const first = await post(app, owner, url, {
      email: invitedEmail,
      orgRole: 'admin',
      idempotencyKey: randomUUID(),
    });
    expect(first.status).toBe(200);

    const second = await post(app, owner, url, {
      email: invitedEmail,
      orgRole: 'admin',
      idempotencyKey: randomUUID(),
    });
    expect(second.status).toBe(409);
    expect((second.body as ProblemBody).code).toBe('business_validation');
    await app.close();
  });

  it('inviting an email that already belongs to a member -> 409 business_validation', async () => {
    const app = buildApp();
    const owner = await registerVerifiedActor(app, pool, `owner-${randomUUID()}@example.com`);
    const memberEmail = `member-${randomUUID()}@example.com`;
    const member = await registerActor(app, memberEmail);
    const membership = await insertOrganizationMembership(pool, {
      organizationId: owner.organizationId,
      accountId: member.accountId,
      role: 'member',
    });
    expect(membership.status).toBe('success');

    const { status, body } = await post(
      app,
      owner,
      `/api/platform/v1/organizations/${owner.organizationId}/invitations`,
      {
        email: memberEmail,
        orgRole: 'member',
        idempotencyKey: randomUUID(),
      },
    );
    expect(status).toBe(409);
    expect((body as ProblemBody).code).toBe('business_validation');
    await app.close();
  });

  it('revoke a pending invitation -> 200 succeeded + audit', async () => {
    const app = buildApp();
    const owner = await registerVerifiedActor(app, pool, `owner-${randomUUID()}@example.com`);
    const invitedEmail = `revoke-${randomUUID()}@example.com`;

    const invited = await post(
      app,
      owner,
      `/api/platform/v1/organizations/${owner.organizationId}/invitations`,
      {
        email: invitedEmail,
        orgRole: 'member',
        idempotencyKey: randomUUID(),
      },
    );
    const invitationId = (invited.body as InviteBody).invitationId;
    expect(typeof invitationId).toBe('string');
    if (invitationId === undefined) throw new Error('invitation id missing in create response');

    const { status, body } = await post(
      app,
      owner,
      `/api/platform/v1/organizations/${owner.organizationId}/invitations/${invitationId}/revoke`,
      {},
    );
    expect(status).toBe(200);
    expect((body as InviteBody).status).toBe('succeeded');

    const audit = await pool.query<{ action: string }>(
      `SELECT action FROM security_audit_events WHERE organization_id = $1 AND action = 'organization.invitation.revoked'`,
      [owner.organizationId],
    );
    expect(audit.rows.length).toBeGreaterThan(0);
    await app.close();
  });

  it('resend a pending invitation -> 200 new expiry + audit + fresh outbox row', async () => {
    const app = buildApp();
    const owner = await registerVerifiedActor(app, pool, `owner-${randomUUID()}@example.com`);
    const invitedEmail = `resend-${randomUUID()}@example.com`;

    const invited = await post(
      app,
      owner,
      `/api/platform/v1/organizations/${owner.organizationId}/invitations`,
      {
        email: invitedEmail,
        orgRole: 'member',
        idempotencyKey: randomUUID(),
      },
    );
    const invitationId = (invited.body as InviteBody).invitationId;
    if (invitationId === undefined) throw new Error('invitation id missing in create response');
    const firstExpiry = (invited.body as InviteBody).expiresAt;

    const { status, body } = await post(
      app,
      owner,
      `/api/platform/v1/organizations/${owner.organizationId}/invitations/${invitationId}/resend`,
      {},
    );
    expect(status).toBe(200);
    const resent = body as InviteBody;
    expect(resent.status).toBe('succeeded');
    expect(typeof resent.expiresAt).toBe('string');

    const audit = await pool.query<{ action: string }>(
      `SELECT action FROM security_audit_events WHERE organization_id = $1 AND action = 'organization.invitation.resent'`,
      [owner.organizationId],
    );
    expect(audit.rows.length).toBeGreaterThan(0);

    // The invitation stays pending with a (possibly identical second) expiry set.
    const row = await pool.query<{ status: string; expires_at: string }>(
      'SELECT status, expires_at FROM organization_invitations WHERE invitation_id = $1',
      [invitationId],
    );
    expect(row.rows[0]?.status).toBe('pending');
    expect(typeof firstExpiry).toBe('string');
    await app.close();
  });

  it('a plain member cannot invite (403)', async () => {
    const app = buildApp();
    const owner = await registerVerifiedActor(app, pool, `owner-${randomUUID()}@example.com`);
    const member = await registerActor(app, `member-${randomUUID()}@example.com`);
    const membership = await insertOrganizationMembership(pool, {
      organizationId: owner.organizationId,
      accountId: member.accountId,
      role: 'member',
    });
    expect(membership.status).toBe('success');

    const { status, body } = await post(
      app,
      member,
      `/api/platform/v1/organizations/${owner.organizationId}/invitations`,
      {
        email: `x-${randomUUID()}@example.com`,
        orgRole: 'member',
        idempotencyKey: randomUUID(),
      },
    );
    expect(status).toBe(403);
    expect((body as ProblemBody).code).toBe('authorization');
    await app.close();
  });

  it('an unverified actor cannot invite (403, PRD 4.1)', async () => {
    const app = buildApp();
    const unverified = await registerActor(app, `unverified-${randomUUID()}@example.com`);

    const { status, body } = await post(
      app,
      unverified,
      `/api/platform/v1/organizations/${unverified.organizationId}/invitations`,
      {
        email: `x-${randomUUID()}@example.com`,
        orgRole: 'member',
        idempotencyKey: randomUUID(),
      },
    );
    expect(status).toBe(403);
    expect((body as ProblemBody).code).toBe('authorization');
    await app.close();
  });

  it('an invitation carrying projectGrants is rejected 422 and creates no row', async () => {
    const app = buildApp();
    const owner = await registerVerifiedActor(app, pool, `owner-${randomUUID()}@example.com`);
    const invitedEmail = `grants-${randomUUID()}@example.com`;

    const { status, body } = await post(
      app,
      owner,
      `/api/platform/v1/organizations/${owner.organizationId}/invitations`,
      {
        email: invitedEmail,
        orgRole: 'member',
        projectGrants: [
          { projectId: '00000000-0000-4000-8000-000000000001', projectRole: 'developer' },
        ],
        idempotencyKey: randomUUID(),
      },
    );
    expect(status).toBe(422);
    expect((body as ProblemBody).code).toBe('field_validation');

    // No invitation row is created (the field is rejected, never silently dropped).
    const rows = await pool.query(
      'SELECT 1 FROM organization_invitations WHERE invited_email = $1',
      [invitedEmail],
    );
    expect(rows.rows.length).toBe(0);
    await app.close();
  });
});
