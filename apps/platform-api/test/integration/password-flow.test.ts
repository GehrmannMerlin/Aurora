import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { FastifyInstance } from 'fastify';
import {
  createIntentToken,
  insertPasswordResetIntent,
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
const PASSWORD = 's3cure-Passw0rd!';

interface ResetLinkBody {
  csrf?: string;
}

interface ConfirmResetBody {
  status: string;
}

interface ChangePasswordBody {
  status: string;
  sessionImpact: string;
}

interface SessionBody {
  csrf?: string;
}

interface ProblemBody {
  code: string;
}

describeDb('password flow (real PostgreSQL 17 + Redis)', () => {
  let pool: Pool;
  let sessionStore: SessionStore;
  let keyPrefix: string;

  beforeAll(async () => {
    assertIsTestDatabase(testDatabaseUrl());
    pool = createTestPool();
    await runIdentityMigrations();
    await truncateIdentityTables(pool);
    keyPrefix = `test:password-flow:${randomUUID()}`;
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
      payload: JSON.stringify({ email, password: PASSWORD, idempotencyKey: randomUUID() }),
    });
    expect(response.statusCode).toBe(200);
    return extractSessionCookie(response.headers['set-cookie']);
  }

  async function requestReset(app: FastifyInstance, email: string) {
    return app.inject({
      method: 'POST',
      url: '/api/platform/v1/auth/password/request',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ email, idempotencyKey: randomUUID() }),
    });
  }

  async function establishResetIntent(app: FastifyInstance, token: string) {
    const link = await app.inject({ method: 'GET', url: `/api/platform/v1/auth/reset/${token}` });
    expect(link.statusCode).toBe(200);
    const body: ResetLinkBody = link.json();
    const setCookie = link.headers['set-cookie'];
    const cookieValue = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    const match = /^aurora_intent=([^;]+)/.exec(cookieValue ?? '');
    expect(match).not.toBeNull();
    return { cookie: match?.[1] ?? '', csrf: body.csrf ?? '' };
  }

  function intentCookie(cookie: string): string {
    return `aurora_intent=${cookie}`;
  }

  it('request-reset returns a uniform response whether or not the account exists', async () => {
    const app = buildApp();
    const existing = `existing-${randomUUID()}@example.com`;
    await register(app, existing);

    const forExisting = await requestReset(app, existing);
    const forMissing = await requestReset(app, `missing-${randomUUID()}@example.com`);

    expect(forExisting.statusCode).toBe(200);
    expect(forMissing.statusCode).toBe(200);
    expect(forExisting.json()).toEqual(forMissing.json());
    expect(forMissing.json()).toHaveProperty('serverTime');

    // Only the existing account wrote a reset outbox row.
    const outbox = await pool.query(
      `SELECT payload FROM outbox WHERE aggregate_type = 'email.password_reset'`,
    );
    expect(outbox.rows.length).toBe(1);
    await app.close();
  });

  it('confirm-reset updates the password, revokes ALL sessions, and does not auto-login', async () => {
    const app = buildApp();
    const email = `confirm-${randomUUID()}@example.com`;
    const oldCookie = await register(app, email);

    await requestReset(app, email);
    const token = await outboxIntentToken(pool, 'email.password_reset');
    const intent = await establishResetIntent(app, token);

    const confirm = await app.inject({
      method: 'POST',
      url: '/api/platform/v1/auth/password/confirm',
      headers: {
        cookie: intentCookie(intent.cookie),
        'content-type': 'application/json',
        'x-aurora-csrf': intent.csrf,
      },
      payload: JSON.stringify({
        newPassword: 'new-s3cure-Passw0rd!',
        idempotencyKey: randomUUID(),
      }),
    });
    expect(confirm.statusCode).toBe(200);
    const body: ConfirmResetBody = confirm.json();
    expect(body.status).toBe('succeeded');

    // The previous session (from register) is revoked.
    const oldSession = await app.inject({
      method: 'GET',
      url: '/api/platform/v1/session',
      headers: { cookie: `aurora_session=${oldCookie}` },
    });
    expect(oldSession.statusCode).toBe(401);

    // No auto-login: the confirm response must not establish a session cookie.
    const setCookie = confirm.headers['set-cookie'];
    const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    expect(cookieHeader ?? '').not.toContain('aurora_session=');

    // The new password works; the old one does not.
    const loginNew = await app.inject({
      method: 'POST',
      url: '/api/platform/v1/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        email,
        password: 'new-s3cure-Passw0rd!',
        idempotencyKey: randomUUID(),
      }),
    });
    expect(loginNew.statusCode).toBe(200);
    const loginOld = await app.inject({
      method: 'POST',
      url: '/api/platform/v1/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ email, password: PASSWORD, idempotencyKey: randomUUID() }),
    });
    expect(loginOld.statusCode).toBe(401);
    await app.close();
  });

  it('confirm-reset rejects an already-consumed intent with 409', async () => {
    const app = buildApp();
    const email = `consumed-${randomUUID()}@example.com`;
    await register(app, email);
    await requestReset(app, email);
    const token = await outboxIntentToken(pool, 'email.password_reset');
    const intent = await establishResetIntent(app, token);

    const first = await app.inject({
      method: 'POST',
      url: '/api/platform/v1/auth/password/confirm',
      headers: {
        cookie: intentCookie(intent.cookie),
        'content-type': 'application/json',
        'x-aurora-csrf': intent.csrf,
      },
      payload: JSON.stringify({
        newPassword: 'new-s3cure-Passw0rd!',
        idempotencyKey: randomUUID(),
      }),
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'POST',
      url: '/api/platform/v1/auth/password/confirm',
      headers: {
        cookie: intentCookie(intent.cookie),
        'content-type': 'application/json',
        'x-aurora-csrf': intent.csrf,
      },
      payload: JSON.stringify({
        newPassword: 'another-new-Passw0rd!',
        idempotencyKey: randomUUID(),
      }),
    });
    expect(second.statusCode).toBe(409);
    const problem: ProblemBody = second.json();
    expect(problem.code).toBe('business_validation');
    await app.close();
  });

  it('rejects an expired reset intent link with 409', async () => {
    const app = buildApp();
    const email = `expired-${randomUUID()}@example.com`;
    await register(app, email);
    const account = await pool.query<{ account_id: string }>(
      'SELECT account_id FROM accounts WHERE email_normalized = $1',
      [normalizeEmail(email)],
    );
    const accountId = account.rows[0]?.account_id;
    if (accountId === undefined) {
      throw new Error('expected a reset account row');
    }

    const { token, digest } = createIntentToken();
    await insertPasswordResetIntent(pool, {
      accountId,
      tokenDigest: digest,
      expiresAt: new Date(FIXED_NOW.getTime() - 1000),
    });

    const link = await app.inject({ method: 'GET', url: `/api/platform/v1/auth/reset/${token}` });
    expect(link.statusCode).toBe(409);
    const problem: ProblemBody = link.json();
    expect(problem.code).toBe('business_validation');
    await app.close();
  });

  it('change-password verifies the current password, revokes all sessions, and reports revoked_all', async () => {
    const app = buildApp();
    const email = `change-${randomUUID()}@example.com`;
    const cookie = await register(app, email);

    const session = await app.inject({
      method: 'GET',
      url: '/api/platform/v1/session',
      headers: { cookie: `aurora_session=${cookie}` },
    });
    expect(session.statusCode).toBe(200);
    const sessionBody: SessionBody = session.json();
    const csrf = sessionBody.csrf;
    expect(typeof csrf).toBe('string');

    const change = await app.inject({
      method: 'POST',
      url: '/api/platform/v1/auth/password/change',
      headers: {
        cookie: `aurora_session=${cookie}`,
        'content-type': 'application/json',
        'x-aurora-csrf': csrf ?? '',
      },
      payload: JSON.stringify({
        currentPassword: PASSWORD,
        newPassword: 'changed-s3cure-Passw0rd!',
        idempotencyKey: randomUUID(),
      }),
    });
    expect(change.statusCode).toBe(200);
    const body: ChangePasswordBody = change.json();
    expect(body.status).toBe('succeeded');
    expect(body.sessionImpact).toBe('revoked_all');

    // Current session revoked -> subsequent protected call 401.
    const after = await app.inject({
      method: 'GET',
      url: '/api/platform/v1/session',
      headers: { cookie: `aurora_session=${cookie}` },
    });
    expect(after.statusCode).toBe(401);

    // New password works; old password does not.
    const loginNew = await app.inject({
      method: 'POST',
      url: '/api/platform/v1/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        email,
        password: 'changed-s3cure-Passw0rd!',
        idempotencyKey: randomUUID(),
      }),
    });
    expect(loginNew.statusCode).toBe(200);
    await app.close();
  });

  it('change-password rejects a wrong current password with 403', async () => {
    const app = buildApp();
    const email = `changebad-${randomUUID()}@example.com`;
    const cookie = await register(app, email);
    const session = await app.inject({
      method: 'GET',
      url: '/api/platform/v1/session',
      headers: { cookie: `aurora_session=${cookie}` },
    });
    const sessionBody: SessionBody = session.json();
    const csrf = sessionBody.csrf ?? '';

    const change = await app.inject({
      method: 'POST',
      url: '/api/platform/v1/auth/password/change',
      headers: {
        cookie: `aurora_session=${cookie}`,
        'content-type': 'application/json',
        'x-aurora-csrf': csrf,
      },
      payload: JSON.stringify({
        currentPassword: 'wrong-password!',
        newPassword: 'changed-s3cure-Passw0rd!',
        idempotencyKey: randomUUID(),
      }),
    });
    expect(change.statusCode).toBe(403);
    const problem: ProblemBody = change.json();
    expect(problem.code).toBe('authorization');
    await app.close();
  });
});
