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

describeDb('logout flow (real PostgreSQL 17 + Redis)', () => {
  let pool: Pool;
  let sessionStore: SessionStore;
  let keyPrefix: string;

  beforeAll(async () => {
    assertIsTestDatabase(testDatabaseUrl());
    pool = createTestPool();
    await runIdentityMigrations();
    await truncateIdentityTables(pool);
    keyPrefix = `test:logout-flow:${randomUUID()}`;
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

  async function registerAndGetSession(app: FastifyInstance): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/platform/v1/auth/register',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        email: `logout-${randomUUID()}@example.com`,
        password: 's3cure-Passw0rd!',
        idempotencyKey: randomUUID(),
      }),
    });
    expect(response.statusCode).toBe(200);
    return extractSessionCookie(response.headers['set-cookie']);
  }

  async function getSession(app: FastifyInstance, cookie: string) {
    return app.inject({
      method: 'GET',
      url: '/api/platform/v1/session',
      headers: { cookie: `aurora_session=${cookie}` },
    });
  }

  it('logout revokes the session; a subsequent protected call returns 401', async () => {
    const app = buildApp();
    const cookie = await registerAndGetSession(app);

    const session = await getSession(app, cookie);
    expect(session.statusCode).toBe(200);
    const csrf = (session.json() as { csrf?: string }).csrf;
    expect(typeof csrf).toBe('string');

    const logout = await app.inject({
      method: 'POST',
      url: '/api/platform/v1/auth/logout',
      headers: {
        cookie: `aurora_session=${cookie}`,
        'content-type': 'application/json',
        'x-aurora-csrf': csrf ?? '',
      },
      payload: JSON.stringify({}),
    });
    expect(logout.statusCode).toBe(200);
    const body = logout.json() as { status?: string };
    expect(body.status).toBe('succeeded');

    // The revoked cookie is now unauthenticated (no session in Redis).
    const after = await getSession(app, cookie);
    expect(after.statusCode).toBe(401);
    expect((after.json() as { code?: string }).code).toBe('authentication');
    await app.close();
  });

  it('logout requires CSRF (403 without the X-Aurora-CSRF header)', async () => {
    const app = buildApp();
    const cookie = await registerAndGetSession(app);
    const logout = await app.inject({
      method: 'POST',
      url: '/api/platform/v1/auth/logout',
      headers: { cookie: `aurora_session=${cookie}`, 'content-type': 'application/json' },
      payload: JSON.stringify({}),
    });
    expect(logout.statusCode).toBe(403);
    expect((logout.json() as { code?: string }).code).toBe('authorization');
    await app.close();
  });
});
