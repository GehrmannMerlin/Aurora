import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { FastifyInstance } from 'fastify';
import {
  createIntentToken,
  insertEmailVerificationIntent,
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
  outboxIntentToken,
  redisUrl,
  runIdentityMigrations,
  testDatabaseUrl,
  truncateIdentityTables,
} from './helpers.js';

const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const hasRedis = process.env.AURORA_TEST_REDIS_URL !== undefined;
const describeDb = hasDb && hasRedis ? describe : describe.skip;

const FIXED_NOW = new Date('2026-08-09T00:00:00.000Z');

interface IntentLinkBody {
  csrf?: string;
}

interface ConfirmEmailBody {
  verificationStatus?: { verified: boolean };
  account?: { verified: boolean; accountId: string };
}

interface SessionBody {
  authentication: string;
}

interface ProblemBody {
  code: string;
}

describeDb('email verification flow (real PostgreSQL 17 + Redis)', () => {
  let pool: Pool;
  let sessionStore: SessionStore;
  let keyPrefix: string;

  beforeAll(async () => {
    assertIsTestDatabase(testDatabaseUrl());
    pool = createTestPool();
    await runIdentityMigrations();
    await truncateIdentityTables(pool);
    keyPrefix = `test:email-verify-flow:${randomUUID()}`;
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

  async function establishVerifyIntent(app: FastifyInstance, token: string) {
    const link = await app.inject({ method: 'GET', url: `/api/platform/v1/auth/verify/${token}` });
    expect(link.statusCode).toBe(200);
    const body: IntentLinkBody = link.json();
    const setCookie = link.headers['set-cookie'];
    const cookieValue = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    const match = /^aurora_intent=([^;]+)/.exec(cookieValue ?? '');
    expect(match).not.toBeNull();
    return { cookie: match?.[1] ?? '', csrf: body.csrf ?? '' };
  }

  it('confirm-email sets verified_at and rotates the matching session to authenticated', async () => {
    const app = buildApp();
    const email = `verify-${randomUUID()}@example.com`;
    const oldCookie = await register(app, email);

    const token = await outboxIntentToken(pool, 'email.verification');
    const intent = await establishVerifyIntent(app, token);

    const confirm = await app.inject({
      method: 'POST',
      url: '/api/platform/v1/auth/email/confirm',
      headers: {
        cookie: `aurora_session=${oldCookie}; aurora_intent=${intent.cookie}`,
        'content-type': 'application/json',
        'x-aurora-csrf': intent.csrf,
      },
      payload: JSON.stringify({ idempotencyKey: randomUUID() }),
    });
    expect(confirm.statusCode).toBe(200);
    const body: ConfirmEmailBody = confirm.json();
    expect(body.verificationStatus?.verified).toBe(true);
    expect(body.account?.verified).toBe(true);
    expect(typeof body.account?.accountId).toBe('string');

    // verified_at is set.
    const account = await pool.query<{ verified_at: string | null }>(
      'SELECT verified_at FROM accounts WHERE account_id = $1',
      [body.account?.accountId],
    );
    expect(account.rows[0]?.verified_at).not.toBeNull();

    // The pending-verification session was rotated to a new authenticated session.
    const newCookie = extractSessionCookie(confirm.headers['set-cookie']);
    expect(newCookie.length).toBeGreaterThan(0);
    expect(newCookie).not.toBe(oldCookie);

    const rotated = await app.inject({
      method: 'GET',
      url: '/api/platform/v1/session',
      headers: { cookie: `aurora_session=${newCookie}` },
    });
    expect(rotated.statusCode).toBe(200);
    const rotatedBody: SessionBody = rotated.json();
    expect(rotatedBody.authentication).toBe('authenticated');

    // The old pending-verification session is gone.
    const stale = await app.inject({
      method: 'GET',
      url: '/api/platform/v1/session',
      headers: { cookie: `aurora_session=${oldCookie}` },
    });
    expect(stale.statusCode).toBe(401);
    await app.close();
  });

  it('rejects an expired verification intent link with 409', async () => {
    const app = buildApp();
    const email = `verify-expired-${randomUUID()}@example.com`;
    await register(app, email);
    const account = await pool.query<{ account_id: string }>(
      'SELECT account_id FROM accounts WHERE email_normalized = $1',
      [normalizeEmail(email)],
    );
    const accountId = account.rows[0]?.account_id;
    if (accountId === undefined) {
      throw new Error('expected a verification account row');
    }

    const { token, digest } = createIntentToken();
    await insertEmailVerificationIntent(pool, {
      accountId,
      tokenDigest: digest,
      expiresAt: new Date(FIXED_NOW.getTime() - 1000),
    });

    const link = await app.inject({ method: 'GET', url: `/api/platform/v1/auth/verify/${token}` });
    expect(link.statusCode).toBe(409);
    const problem: ProblemBody = link.json();
    expect(problem.code).toBe('business_validation');
    await app.close();
  });
});
