import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import type { FastifyInstance } from 'fastify';
import {
  createSession,
  createSessionStore,
  type SessionStore,
} from '@aurora/platform-session';
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
} from './helpers.js';

const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const hasRedis = process.env.AURORA_TEST_REDIS_URL !== undefined;
const describeDb = hasDb && hasRedis ? describe : describe.skip;

const FIXED_NOW = new Date('2026-08-09T00:00:00.000Z');

describeDb('platform-api real PostgreSQL 17 + Redis integration', () => {
  let pool: Pool;
  let sessionStore: SessionStore;
  let keyPrefix: string;

  beforeAll(async () => {
    assertIsTestDatabase(testDatabaseUrl());
    pool = createTestPool();
    await runIdentityMigrations();
    await pool.query(
      `TRUNCATE outbox, idempotency_records, security_audit_events, project_members,
        organization_invitations, organization_members, organizations,
        password_reset_intents, email_verification_intents,
        account_credentials, accounts CASCADE`,
    );
    keyPrefix = `test:platform-api:${randomUUID()}`;
    sessionStore = await createSessionStore({ url: redisUrl(), keyPrefix });
  });

  afterAll(async () => {
    await sessionStore.client.quit().catch(() => undefined);
    await pool.end();
  });

  function buildApp(overrides?: { pool?: Pool; sessionStore?: SessionStore }): FastifyInstance {
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
      pool: overrides?.pool ?? pool,
      sessionStore: overrides?.sessionStore ?? sessionStore,
      emailPort: new ConsoleEmailAdapter({ mode: 'console', log: () => undefined }),
      now: () => new Date(FIXED_NOW.getTime()),
    });
  }

  function registerPayload(email = 'alice@example.com'): unknown {
    return {
      email,
      password: 's3cure-Passw0rd!',
      idempotencyKey: randomUUID(),
    };
  }

  it('GET /api/platform/v1/session with no cookie returns 401 authentication with a safe login target', async () => {
    const app = buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/platform/v1/session' });
    expect(response.statusCode).toBe(401);
    const body = response.json() as { code?: string; recoveryTarget?: string | null };
    expect(body.code).toBe('authentication');
    expect(body.recoveryTarget).toBe('auth.login');
    await app.close();
  });

  it('POST /api/platform/v1/auth/register (Task 6 stub) returns the contract shape and sets an HttpOnly SameSite=Lax cookie', async () => {
    const app = buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/platform/v1/auth/register',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify(registerPayload()),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      accountId?: string;
      workspaceId?: { organizationId?: string };
      emailMasked?: string;
      verificationStatus?: { verified?: boolean };
    };
    expect(typeof body.accountId).toBe('string');
    expect(typeof body.workspaceId?.organizationId).toBe('string');
    expect(body.emailMasked).toContain('@example.com');
    expect(body.verificationStatus?.verified).toBe(false);

    const setCookie = response.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : (setCookie as string | undefined);
    expect(cookieHeader).toContain('HttpOnly');
    expect(cookieHeader).toContain('SameSite=Lax');
    expect(cookieHeader).toContain('Path=/');
    await app.close();
  });

  it('GET /api/platform/v1/session with the register cookie returns 200 with the account summary and a CSRF token', async () => {
    const app = buildApp();
    const register = await app.inject({
      method: 'POST',
      url: '/api/platform/v1/auth/register',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify(registerPayload('bob@example.com')),
    });
    expect(register.statusCode).toBe(200);
    const cookieValue = extractSessionCookie(register.headers['set-cookie']);

    const session = await app.inject({
      method: 'GET',
      url: '/api/platform/v1/session',
      headers: { cookie: `aurora_session=${cookieValue}` },
    });
    expect(session.statusCode).toBe(200);
    const body = session.json() as {
      account?: { email?: string; verified?: boolean };
      csrf?: string;
      authentication?: string;
      navigation?: readonly unknown[];
    };
    expect(body.account?.email).toBe('bob@example.com');
    expect(body.account?.verified).toBe(false);
    expect(typeof body.csrf).toBe('string');
    expect(body.csrf?.length ?? 0).toBeGreaterThan(0);
    expect(body.authentication).toBe('pending_verification');
    expect(Array.isArray(body.navigation)).toBe(true);
    await app.close();
  });

  it('fails closed with 503 authority_unavailable on a protected op when Redis is down', async () => {
    const downStore = await createSessionStore({
      url: redisUrl(),
      keyPrefix: `test:platform-api-down:${randomUUID()}`,
    });
    await downStore.client.quit();

    const app = buildApp({ sessionStore: downStore });
    const response = await app.inject({
      method: 'GET',
      url: '/api/platform/v1/session',
      headers: { cookie: 'aurora_session=some-session-cookie-value' },
    });
    expect(response.statusCode).toBe(503);
    const body = response.json() as { code?: string };
    expect(body.code).toBe('authority_unavailable');
    await app.close();
  });

  it('fails closed with 503 authority_unavailable when the account store (PostgreSQL) is unreachable', async () => {
    const session = await createSession(sessionStore, {
      accountId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      authLevel: 'authenticated',
      now: new Date(FIXED_NOW.getTime()),
      idleMs: 30 * 60 * 1000,
      absoluteMs: 8 * 60 * 60 * 1000,
    });
    const badPool = new Pool({
      connectionString: testDatabaseUrl(),
      options: '-c search_path=aurora_does_not_exist',
    });
    const app = buildApp({ pool: badPool });
    const response = await app.inject({
      method: 'GET',
      url: '/api/platform/v1/session',
      headers: { cookie: `aurora_session=${session.cookieValue}` },
    });
    expect(response.statusCode).toBe(503);
    const body = response.json() as { code?: string };
    expect(body.code).toBe('authority_unavailable');
    await badPool.end();
    await app.close();
  });
});
