import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import type { FastifyInstance } from 'fastify';
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

describeDb('login flow (real PostgreSQL 17 + Redis)', () => {
  let pool: Pool;
  let sessionStore: SessionStore;
  let keyPrefix: string;

  beforeAll(async () => {
    assertIsTestDatabase(testDatabaseUrl());
    pool = createTestPool();
    await runIdentityMigrations();
    await truncateIdentityTables(pool);
    keyPrefix = `test:login-flow:${randomUUID()}`;
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

  async function login(app: FastifyInstance, email: string, password: string) {
    return app.inject({
      method: 'POST',
      url: '/api/platform/v1/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ email, password, idempotencyKey: randomUUID() }),
    });
  }

  it('logs in with correct credentials and returns cookie + csrf + safe continuation defaults', async () => {
    const app = buildApp();
    const email = `login-${randomUUID()}@example.com`;
    await register(app, email);

    const response = await login(app, email, 's3cure-Passw0rd!');
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      account?: { email?: string; verified?: boolean };
      authentication?: string;
      csrf?: string;
      session?: { expiresAt?: string };
      navigation?: Array<{ routeId?: string }>;
      continuation?: unknown;
    };
    expect(body.account?.email).toBe(email);
    expect(body.account?.verified).toBe(false);
    expect(body.authentication).toBe('pending_verification');
    expect(typeof body.csrf).toBe('string');
    expect(body.csrf?.length ?? 0).toBeGreaterThan(0);
    expect(typeof body.session?.expiresAt).toBe('string');
    // N1: login `navigation` is now the array shape (matching identityGetSession).
    expect(body.navigation?.some((t) => t.routeId === 'auth.verify-email')).toBe(true);
    expect('continuation' in body).toBe(false);

    const cookie = extractSessionCookie(response.headers['set-cookie']);
    expect(cookie.length).toBeGreaterThan(0);
    await app.close();
  });

  it('wrong password and nonexistent account return the SAME 401 shape', async () => {
    const app = buildApp();
    const email = `enum-${randomUUID()}@example.com`;
    await register(app, email);

    const wrongPassword = await login(app, email, 'wrong-password!');
    const nonexistent = await login(app, `nobody-${randomUUID()}@example.com`, 's3cure-Passw0rd!');

    expect(wrongPassword.statusCode).toBe(401);
    expect(nonexistent.statusCode).toBe(401);
    const a = wrongPassword.json() as { code?: string; detail?: string; recoveryTarget?: string | null };
    const b = nonexistent.json() as { code?: string; detail?: string; recoveryTarget?: string | null };
    expect(a.code).toBe('authentication');
    expect(b.code).toBe('authentication');
    expect(a.detail).toBe(b.detail);
    expect(a.recoveryTarget).toBe(b.recoveryTarget);
    await app.close();
  });

  it('rotates the session id on login (new cookie differs from the register cookie)', async () => {
    const app = buildApp();
    const email = `rotate-${randomUUID()}@example.com`;
    const registerCookie = await register(app, email);

    const loginResponse = await login(app, email, 's3cure-Passw0rd!');
    expect(loginResponse.statusCode).toBe(200);
    const loginCookie = extractSessionCookie(loginResponse.headers['set-cookie']);
    expect(loginCookie.length).toBeGreaterThan(0);
    expect(loginCookie).not.toBe(registerCookie);
    await app.close();
  });

  it('rate-limits repeated login attempts for the same email (429 rate_limited)', async () => {
    const app = buildApp();
    const email = `ratelimit-${randomUUID()}@example.com`;
    await register(app, email);

    let status = 200;
    for (let i = 0; i < 15; i += 1) {
      const response = await login(app, email, 's3cure-Passw0rd!');
      status = response.statusCode;
      if (status === 429) break;
    }
    expect(status).toBe(429);
    const last = await login(app, email, 's3cure-Passw0rd!');
    expect(last.statusCode).toBe(429);
    const body = last.json() as { code?: string; retryAfter?: number };
    expect(body.code).toBe('rate_limited');
    expect(typeof body.retryAfter).toBe('number');
    await app.close();
  });
});
