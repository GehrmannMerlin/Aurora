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

describeDb('register flow (real PostgreSQL 17 + Redis)', () => {
  let pool: Pool;
  let sessionStore: SessionStore;
  let keyPrefix: string;

  beforeAll(async () => {
    assertIsTestDatabase(testDatabaseUrl());
    pool = createTestPool();
    await runIdentityMigrations();
    await truncateIdentityTables(pool);
    keyPrefix = `test:register-flow:${randomUUID()}`;
    sessionStore = await createSessionStore({ url: redisUrl(), keyPrefix });
  });

  afterAll(async () => {
    await sessionStore.client.quit().catch(() => undefined);
    await pool.end();
  });

  function buildApp(overrides?: { sessionStore?: SessionStore }): FastifyInstance {
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
      sessionStore: overrides?.sessionStore ?? sessionStore,
      emailPort: new ConsoleEmailAdapter({ mode: 'console', log: () => undefined }),
      now: () => new Date(FIXED_NOW.getTime()),
    });
  }

  function registerPayload(email = `reg-${randomUUID()}@example.com`, key = randomUUID()): unknown {
    return { email, password: 's3cure-Passw0rd!', idempotencyKey: key };
  }

  async function postRegister(app: FastifyInstance, payload: unknown) {
    return app.inject({
      method: 'POST',
      url: '/api/platform/v1/auth/register',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify(payload),
    });
  }

  it('registers atomically: account pending_verification + personal org owner + verification outbox row', async () => {
    const app = buildApp();
    const email = `happy-${randomUUID()}@example.com`;
    const response = await postRegister(app, registerPayload(email));
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      accountId?: string;
      workspaceId?: { organizationId?: string };
      emailMasked?: string;
      verificationStatus?: { verified?: boolean; reason?: string };
      serverTime?: string;
    };
    expect(typeof body.accountId).toBe('string');
    expect(typeof body.workspaceId?.organizationId).toBe('string');
    expect(body.verificationStatus?.verified).toBe(false);
    expect(body.verificationStatus?.reason).toBe('email_verification_pending');
    expect(typeof body.serverTime).toBe('string');

    const account = await pool.query<{ status: string }>(
      'SELECT status FROM accounts WHERE account_id = $1',
      [body.accountId],
    );
    expect(account.rows[0]?.status).toBe('pending_verification');

    const orgMember = await pool.query<{ role: string }>(
      `SELECT om.role FROM organization_members om
       WHERE om.organization_id = $1 AND om.account_id = $2`,
      [body.workspaceId?.organizationId, body.accountId],
    );
    expect(orgMember.rows[0]?.role).toBe('owner');

    const outbox = await pool.query(
      `SELECT payload FROM outbox WHERE aggregate_type = 'email.verification'`,
    );
    expect(outbox.rows.length).toBe(1);
    const payload = outbox.rows[0]?.payload as { intentType?: string; toMasked?: string };
    expect(payload.intentType).toBe('email_verification');
    expect(payload.toMasked).toBe(body.emailMasked);

    const cookie = extractSessionCookie(response.headers['set-cookie']);
    expect(cookie.length).toBeGreaterThan(0);
    await app.close();
  });

  it('rejects a duplicate email with 409 business_validation', async () => {
    const app = buildApp();
    const email = `dup-${randomUUID()}@example.com`;
    const first = await postRegister(app, registerPayload(email));
    expect(first.statusCode).toBe(200);
    const second = await postRegister(app, registerPayload(email));
    expect(second.statusCode).toBe(409);
    const body = second.json() as { code?: string };
    expect(body.code).toBe('business_validation');
    await app.close();
  });

  it('idempotency: same key + same request replays the first result (200, identical body)', async () => {
    const app = buildApp();
    const key = randomUUID();
    const payload = registerPayload(`idem-${randomUUID()}@example.com`, key);
    const first = await postRegister(app, payload);
    expect(first.statusCode).toBe(200);
    const firstBody = first.json();

    const second = await postRegister(app, payload);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual(firstBody);

    const third = await postRegister(app, payload);
    expect(third.statusCode).toBe(200);
    expect(third.json()).toEqual(firstBody);
    await app.close();
  });

  it('idempotency: same key + a different request -> 409 idempotency_conflict', async () => {
    const app = buildApp();
    const key = randomUUID();
    const first = await postRegister(app, registerPayload(`idem-a-${randomUUID()}@example.com`, key));
    expect(first.statusCode).toBe(200);
    const second = await postRegister(app, registerPayload(`idem-b-${randomUUID()}@example.com`, key));
    expect(second.statusCode).toBe(409);
    const body = second.json() as { code?: string };
    expect(body.code).toBe('idempotency_conflict');
    await app.close();
  });

  it('fails closed with 503 authority_unavailable when Redis is down (after atomic commit)', async () => {
    const downStore = await createSessionStore({
      url: redisUrl(),
      keyPrefix: `test:register-down:${randomUUID()}`,
    });
    await downStore.client.quit();

    const app = buildApp({ sessionStore: downStore });
    const email = `redisdown-${randomUUID()}@example.com`;
    const key = randomUUID();
    const response = await postRegister(app, registerPayload(email, key));
    expect(response.statusCode).toBe(503);
    const body = response.json() as { code?: string };
    expect(body.code).toBe('authority_unavailable');

    // The account was committed atomically; a same-key retry against a healthy
    // store replays the result and establishes a session.
    const recovered = buildApp();
    const retry = await postRegister(recovered, registerPayload(email, key));
    expect(retry.statusCode).toBe(200);
    const retryBody = retry.json() as {
      accountId?: string;
      emailMasked?: string;
      verificationStatus?: { verified?: boolean };
    };
    expect(typeof retryBody.accountId).toBe('string');
    expect(retryBody.emailMasked).toContain('@example.com');
    expect(retryBody.verificationStatus?.verified).toBe(false);
    const retryCookie = extractSessionCookie(retry.headers['set-cookie']);
    expect(retryCookie.length).toBeGreaterThan(0);
    await recovered.close();
    await app.close();
  });

  it('outbox verification mail carries a working intent token (GET verify link)', async () => {    const app = buildApp();
    const email = `link-${randomUUID()}@example.com`;
    const register = await postRegister(app, registerPayload(email));
    expect(register.statusCode).toBe(200);

    const token = await outboxIntentToken(pool, 'email.verification');
    const link = await app.inject({ method: 'GET', url: `/api/platform/v1/auth/verify/${token}` });
    expect(link.statusCode).toBe(200);
    const linkBody = link.json() as { status?: string; csrf?: string; maskedEmail?: string };
    expect(linkBody.status).toBe('valid');
    expect(typeof linkBody.csrf).toBe('string');
    expect(linkBody.maskedEmail).toContain('@example.com');

    const intentCookie = extractSessionCookieForIntent(link.headers['set-cookie']);
    expect(intentCookie).toContain('email_verification:');
    await app.close();
  });

  it('maps malformed JSON to a 400 structural_error via the global error handler', async () => {
    const app = buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/platform/v1/auth/register',
      headers: { 'content-type': 'application/json' },
      payload: '{not-valid-json',
    });
    expect(response.statusCode).toBe(400);
    const body = response.json() as { code?: string; title?: string };
    expect(body.code).toBe('structural_error');
    expect(body.title).toBe('Invalid request');
    await app.close();
  });
});

/** The intent cookie name is `aurora_intent`; parse it from a set-cookie header. */
function extractSessionCookieForIntent(setCookie: unknown): string {
  const value = Array.isArray(setCookie) ? setCookie[0] : (setCookie as string | undefined);
  if (typeof value !== 'string') throw new Error('no intent set-cookie');
  const match = /^aurora_intent=([^;]+)/.exec(value);
  if (match === null) throw new Error('no aurora_intent cookie');
  return match[1] ?? '';
}
