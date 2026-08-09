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

interface CreateTokenBody {
  tokenId?: string;
  tokenPlaintext?: string;
  scopes?: readonly string[];
  expiresAt?: string;
}

interface TokenSummary {
  tokenId?: string;
  name?: string;
  scopes?: readonly string[];
  revokedAt?: string | null;
  lastUsedAt?: string | null;
}

interface ListTokensBody {
  tokens?: readonly TokenSummary[];
}

interface ProblemBody {
  code?: string;
}

describeDb('B6 private-tokens flow (real PostgreSQL 17 + Redis)', () => {
  let pool: Pool;
  let sessionStore: SessionStore;
  let keyPrefix: string;

  beforeAll(async () => {
    assertIsTestDatabase(testDatabaseUrl());
    pool = createTestPool();
    await runAllMigrations();
    await truncateIdentityTables(pool);
    keyPrefix = `test:private-tokens-flow:${randomUUID()}`;
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
  ): Promise<{
    status: number;
    body: CreateTokenBody | ListTokensBody | ProblemBody;
    cacheControl: string | undefined;
  }> {
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
    const cacheControl = response.headers['cache-control'];
    return { status: response.statusCode, body: response.json(), cacheControl };
  }

  async function get(
    app: FastifyInstance,
    actor: RegisteredActor,
    url: string,
  ): Promise<{ status: number; body: ListTokensBody | ProblemBody }> {
    const response = await app.inject({
      method: 'GET',
      url,
      headers: { cookie: `aurora_session=${actor.cookie}` },
    });
    return { status: response.statusCode, body: response.json() };
  }

  it('owner creates a token: one-time plaintext + no-store header, DB stores only the digest', async () => {
    const app = buildApp();
    const owner = await registerVerifiedActor(app, pool, `owner-${randomUUID()}@example.com`);
    const url = `/api/platform/v1/organizations/${owner.organizationId}/private-tokens`;

    const { status, body, cacheControl } = await post(app, owner, url, {
      name: 'CI Deploy',
      scopes: ['releases.write'],
      idempotencyKey: randomUUID(),
    });
    expect(status).toBe(200);
    expect(cacheControl).toContain('no-store');

    const created = body as CreateTokenBody;
    expect(typeof created.tokenId).toBe('string');
    expect(typeof created.tokenPlaintext).toBe('string');
    expect(created.tokenPlaintext ?? '').toMatch(/^aurora_pt_/);
    expect(created.scopes).toEqual(['releases.write']);

    const row = await pool.query<{ token_digest: string; name: string }>(
      'SELECT token_digest, name FROM private_tokens WHERE token_id = $1',
      [created.tokenId],
    );
    expect(row.rows[0]?.name).toBe('CI Deploy');
    const digest = row.rows[0]?.token_digest;
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    // The plaintext never reaches the DB and never equals the digest.
    expect(digest).not.toBe(created.tokenPlaintext);
    expect(created.tokenPlaintext ?? '').not.toContain(digest ?? '');
    await app.close();
  });

  it('list returns metadata only: never the digest or the plaintext', async () => {
    const app = buildApp();
    const owner = await registerVerifiedActor(app, pool, `owner-${randomUUID()}@example.com`);
    const url = `/api/platform/v1/organizations/${owner.organizationId}/private-tokens`;

    const first = await post(app, owner, url, {
      name: 'Read Only',
      scopes: ['source_maps.upload'],
      idempotencyKey: randomUUID(),
    });
    const created = first.body as CreateTokenBody;

    const { status, body } = await get(app, owner, url);
    expect(status).toBe(200);
    const tokens = (body as ListTokensBody).tokens ?? [];
    expect(tokens.length).toBeGreaterThan(0);
    const token = tokens.find((t) => t.tokenId === created.tokenId);
    expect(token?.name).toBe('Read Only');
    expect(token?.scopes).toEqual(['source_maps.upload']);

    const raw = JSON.stringify(body);
    expect(raw).not.toContain('aurora_pt_');
    expect(raw).not.toContain(created.tokenPlaintext ?? '');
    await app.close();
  });

  it('same-key retry returns the same tokenId with NO plaintext (idempotent, no duplicate)', async () => {
    const app = buildApp();
    const owner = await registerVerifiedActor(app, pool, `owner-${randomUUID()}@example.com`);
    const url = `/api/platform/v1/organizations/${owner.organizationId}/private-tokens`;
    const key = randomUUID();
    const payload = { name: 'Idem Token', scopes: ['releases.write'], idempotencyKey: key };

    const first = await post(app, owner, url, payload);
    const firstBody = first.body as CreateTokenBody;
    expect(first.status).toBe(200);
    expect(firstBody.tokenPlaintext ?? '').toMatch(/^aurora_pt_/);

    const second = await post(app, owner, url, payload);
    const secondBody = second.body as CreateTokenBody;
    expect(second.status).toBe(200);
    expect(secondBody.tokenId).toBe(firstBody.tokenId);
    // The retry body carries a NON-secret placeholder, never the real plaintext.
    expect(secondBody.tokenPlaintext).not.toBe(firstBody.tokenPlaintext);
    expect(secondBody.tokenPlaintext ?? '').not.toMatch(/^aurora_pt_/);

    const count = await pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM private_tokens WHERE token_id = $1',
      [firstBody.tokenId],
    );
    expect(Number(count.rows[0]?.n ?? '0')).toBe(1);

    // The stored idempotency payload must NOT contain the real plaintext.
    const idem = await pool.query<{ result_data: unknown }>(
      'SELECT result_data FROM idempotency_records WHERE idempotency_key = $1',
      [key],
    );
    const stored = JSON.stringify(idem.rows[0]?.result_data ?? {});
    expect(stored).not.toContain(firstBody.tokenPlaintext ?? '');
    await app.close();
  });

  it('revoke is irreversible: list shows revokedAt, re-revoke stays idempotent', async () => {
    const app = buildApp();
    const owner = await registerVerifiedActor(app, pool, `owner-${randomUUID()}@example.com`);
    const url = `/api/platform/v1/organizations/${owner.organizationId}/private-tokens`;

    const created = await post(app, owner, url, {
      name: 'To Revoke',
      scopes: ['releases.write'],
      idempotencyKey: randomUUID(),
    });
    const tokenId = (created.body as CreateTokenBody).tokenId;
    expect(typeof tokenId).toBe('string');

    const revokeUrl = `${url}/${tokenId}/revoke`;
    const revoke = await post(app, owner, revokeUrl, {});
    expect(revoke.status).toBe(200);
    expect((revoke.body as { status?: string }).status).toBe('succeeded');

    // Re-revoke an already-revoked token is idempotent (success).
    const again = await post(app, owner, revokeUrl, {});
    expect(again.status).toBe(200);

    const { body } = await get(app, owner, url);
    const token = (body as ListTokensBody).tokens?.find((t) => t.tokenId === tokenId);
    expect(typeof token?.revokedAt).toBe('string');
    await app.close();
  });

  it('an unverified actor cannot create a token (403, PRD 4.1)', async () => {
    const app = buildApp();
    const unverified = await registerActor(app, `unverified-${randomUUID()}@example.com`);

    const { status, body } = await post(
      app,
      unverified,
      `/api/platform/v1/organizations/${unverified.organizationId}/private-tokens`,
      {
        name: 'Nope',
        scopes: ['releases.write'],
        idempotencyKey: randomUUID(),
      },
    );
    expect(status).toBe(403);
    expect((body as ProblemBody).code).toBe('authorization');
    await app.close();
  });

  it('a plain member cannot create a token (403)', async () => {
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
      `/api/platform/v1/organizations/${owner.organizationId}/private-tokens`,
      {
        name: 'Sneaky',
        scopes: ['releases.write'],
        idempotencyKey: randomUUID(),
      },
    );
    expect(status).toBe(403);
    expect((body as ProblemBody).code).toBe('authorization');
    await app.close();
  });

  it('an off-allowlist scope maps to 422 field_validation', async () => {
    const app = buildApp();
    const owner = await registerVerifiedActor(app, pool, `owner-${randomUUID()}@example.com`);

    const { status, body } = await post(
      app,
      owner,
      `/api/platform/v1/organizations/${owner.organizationId}/private-tokens`,
      {
        name: 'Bad Scope',
        scopes: ['not.a.real.scope'],
        idempotencyKey: randomUUID(),
      },
    );
    expect(status).toBe(422);
    expect((body as ProblemBody).code).toBe('field_validation');
    await app.close();
  });
});
