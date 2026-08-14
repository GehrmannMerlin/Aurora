import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ConsoleEmailAdapter } from '@aurora/platform-email';
import { createSessionStore, type SessionStore } from '@aurora/platform-session';
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
const BASE_NOW = new Date('2026-08-14T00:00:00.000Z');

interface Actor {
  readonly accountId: string;
  readonly cookie: string;
  readonly csrf: string;
  readonly emailMasked: string;
}

interface ResendResponse {
  readonly emailMasked: string;
  readonly deliveryStatus: 'queued';
  readonly resendAvailableAt: string;
  readonly serverTime: string;
}

interface ProblemBody {
  readonly code: string;
  readonly retryAfter?: number;
  readonly resendAvailableAt?: string;
}

describeDb('email verification resend flow (real PostgreSQL 17 + Redis)', () => {
  let pool: Pool;
  let sessionStore: SessionStore;
  let currentNow = new Date(BASE_NOW);

  beforeAll(async () => {
    assertIsTestDatabase(testDatabaseUrl());
    pool = createTestPool();
    await runIdentityMigrations();
    sessionStore = await createSessionStore({
      url: redisUrl(),
      keyPrefix: `test:email-resend:${randomUUID()}`,
    });
  });

  beforeEach(async () => {
    currentNow = new Date(BASE_NOW);
    await truncateIdentityTables(pool);
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
        COOKIE_SECURE: 'false',
        EMAIL_DELIVERY_MODE: 'console',
        APP_ORIGIN: '',
        LOG_ENABLED: 'false',
      }),
      pool,
      sessionStore,
      emailPort: new ConsoleEmailAdapter({ mode: 'console', log: () => undefined }),
      now: () => new Date(currentNow),
    });
  }

  async function register(app: FastifyInstance, label: string): Promise<Actor> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/platform/v1/auth/register',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        email: `${label}-${randomUUID()}@example.invalid`,
        password: 's3cure-Passw0rd!',
        idempotencyKey: randomUUID(),
      }),
    });
    expect(response.statusCode).toBe(200);
    const body: { accountId: string; emailMasked: string } = response.json();
    const cookie = extractSessionCookie(response.headers['set-cookie']);
    const session = await app.inject({
      method: 'GET',
      url: '/api/platform/v1/session',
      headers: { cookie: `aurora_session=${cookie}` },
    });
    expect(session.statusCode).toBe(200);
    const sessionBody: { csrf: string; account: { emailMasked: string } } = session.json();
    expect(sessionBody.account.emailMasked).toBe(body.emailMasked);
    return {
      accountId: body.accountId,
      cookie,
      csrf: sessionBody.csrf,
      emailMasked: body.emailMasked,
    };
  }

  async function resend(
    app: FastifyInstance,
    actor: Actor,
    idempotencyKey = randomUUID(),
    body: Record<string, unknown> = {},
  ) {
    return app.inject({
      method: 'POST',
      url: '/api/platform/v1/auth/email/resend',
      headers: {
        cookie: `aurora_session=${actor.cookie}`,
        'content-type': 'application/json',
        'x-aurora-csrf': actor.csrf,
      },
      payload: JSON.stringify({ idempotencyKey, ...body }),
    });
  }

  async function tokenFor(
    accountId: string,
    aggregateType: 'email.verification' | 'email.verification.resend',
  ): Promise<string> {
    const result = await pool.query<{ payload: { mailLinkUrl?: unknown } }>(
      `SELECT payload FROM outbox
       WHERE aggregate_id = $1 AND aggregate_type = $2
       ORDER BY created_at DESC, outbox_id DESC LIMIT 1`,
      [accountId, aggregateType],
    );
    const url = result.rows[0]?.payload.mailLinkUrl;
    if (typeof url !== 'string') throw new Error('expected verification mail link');
    const token = new URL(url, 'https://console.example.invalid').searchParams.get('token');
    if (token === null) throw new Error('expected verification token');
    return token;
  }

  it('requires Session and CSRF and rejects a browser-supplied recipient', async () => {
    const app = buildApp();
    const unauthenticated = await app.inject({
      method: 'POST',
      url: '/api/platform/v1/auth/email/resend',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ idempotencyKey: randomUUID() }),
    });
    expect(unauthenticated.statusCode).toBe(401);

    const actor = await register(app, 'security');
    currentNow = new Date(BASE_NOW.getTime() + 61_000);
    const missingCsrf = await app.inject({
      method: 'POST',
      url: '/api/platform/v1/auth/email/resend',
      headers: {
        cookie: `aurora_session=${actor.cookie}`,
        'content-type': 'application/json',
      },
      payload: JSON.stringify({ idempotencyKey: randomUUID() }),
    });
    expect(missingCsrf.statusCode).toBe(403);

    const suppliedEmail = await resend(app, actor, randomUUID(), {
      email: 'attacker@example.invalid',
    });
    expect(suppliedEmail.statusCode).toBe(400);
    expect(suppliedEmail.json<ProblemBody>().code).toBe('structural_error');
    await app.close();
  });

  it('atomically replaces unused intent/outbox state and replays the same idempotency key', async () => {
    const app = buildApp();
    const actor = await register(app, 'atomic');
    const oldIntent = await pool.query<{ intent_id: string }>(
      'SELECT intent_id FROM email_verification_intents WHERE account_id = $1',
      [actor.accountId],
    );
    currentNow = new Date(BASE_NOW.getTime() + 61_000);
    const key = randomUUID();
    const first = await resend(app, actor, key);
    expect(first.statusCode).toBe(200);
    const body: ResendResponse = first.json();
    expect(body).toEqual({
      emailMasked: actor.emailMasked,
      deliveryStatus: 'queued',
      serverTime: currentNow.toISOString(),
      resendAvailableAt: new Date(currentNow.getTime() + 60_000).toISOString(),
    });

    for (let replayIndex = 0; replayIndex < 12; replayIndex += 1) {
      const replay = await resend(app, actor, key);
      expect(replay.statusCode, `stable replay ${String(replayIndex + 1)}`).toBe(200);
      expect(replay.json()).toEqual(body);
    }

    const intents = await pool.query<{ intent_id: string; consumed_at: string | null }>(
      `SELECT intent_id, consumed_at FROM email_verification_intents
       WHERE account_id = $1 ORDER BY created_at, intent_id`,
      [actor.accountId],
    );
    expect(intents.rows).toHaveLength(2);
    expect(
      intents.rows.find((row) => row.intent_id === oldIntent.rows[0]?.intent_id)?.consumed_at,
    ).not.toBeNull();
    expect(intents.rows.filter((row) => row.consumed_at === null)).toHaveLength(1);

    const outbox = await pool.query<{ aggregate_type: string; status: string; payload: unknown }>(
      `SELECT aggregate_type, status, payload FROM outbox
       WHERE aggregate_id = $1 ORDER BY created_at, outbox_id`,
      [actor.accountId],
    );
    expect(outbox.rows).toHaveLength(2);
    expect(outbox.rows).toEqual(
      expect.arrayContaining([
        { aggregate_type: 'email.verification', status: 'superseded', payload: {} },
        expect.objectContaining({ aggregate_type: 'email.verification.resend', status: 'pending' }),
      ]),
    );
    await app.close();
  });

  it('serializes different concurrent keys so only one request passes cooldown', async () => {
    const app = buildApp();
    const actor = await register(app, 'concurrent');
    currentNow = new Date(BASE_NOW.getTime() + 61_000);
    const responses = await Promise.all([
      resend(app, actor, randomUUID()),
      resend(app, actor, randomUUID()),
    ]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 429]);
    const count = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM outbox
       WHERE aggregate_id = $1 AND aggregate_type = 'email.verification.resend'`,
      [actor.accountId],
    );
    expect(count.rows[0]?.n).toBe(1);
    await app.close();
  });

  it('returns synchronized HTTP and problem cooldown timing', async () => {
    const app = buildApp();
    const actor = await register(app, 'cooldown');
    currentNow = new Date(BASE_NOW.getTime() + 30_000);
    const response = await resend(app, actor);
    expect(response.statusCode).toBe(429);
    expect(response.headers['retry-after']).toBe('30');
    const body: ProblemBody = response.json();
    expect(body).toMatchObject({
      code: 'rate_limited',
      retryAfter: 30,
      resendAvailableAt: new Date(BASE_NOW.getTime() + 60_000).toISOString(),
    });
    await app.close();
  });

  it('allows five rolling-day resends while excluding the registration email, then rejects the sixth', async () => {
    const app = buildApp();
    const actor = await register(app, 'quota');
    for (let index = 1; index <= 5; index += 1) {
      currentNow = new Date(BASE_NOW.getTime() + index * 61_000);
      const response = await resend(app, actor);
      expect(response.statusCode, `accepted resend ${String(index)}`).toBe(200);
    }
    currentNow = new Date(BASE_NOW.getTime() + 6 * 61_000);
    const sixth = await resend(app, actor);
    expect(sixth.statusCode).toBe(429);
    expect(sixth.json<ProblemBody>()).toMatchObject({
      code: 'rate_limited',
      resendAvailableAt: new Date(BASE_NOW.getTime() + 61_000 + 86_400_000).toISOString(),
    });
    const counts = await pool.query<{ aggregate_type: string; n: number }>(
      `SELECT aggregate_type, count(*)::int AS n FROM outbox
       WHERE aggregate_id = $1 GROUP BY aggregate_type ORDER BY aggregate_type`,
      [actor.accountId],
    );
    expect(counts.rows).toEqual([
      { aggregate_type: 'email.verification', n: 1 },
      { aggregate_type: 'email.verification.resend', n: 5 },
    ]);
    await app.close();
  });

  it.each([
    ['active', true],
    ['deletion_cooling', false],
  ] as const)('rejects account state %s without creating mail', async (status, verified) => {
    const app = buildApp();
    const actor = await register(app, `state-${status}`);
    await pool.query(
      `UPDATE accounts SET status = $2,
                           verified_at = CASE WHEN $3 THEN $4::timestamptz ELSE NULL END
       WHERE account_id = $1`,
      [actor.accountId, status, verified, BASE_NOW.toISOString()],
    );
    currentNow = new Date(BASE_NOW.getTime() + 61_000);
    const response = await resend(app, actor);
    expect(response.statusCode).toBe(409);
    expect(response.json<ProblemBody>().code).toBe('state_machine_conflict');
    const count = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM outbox
       WHERE aggregate_id = $1 AND aggregate_type = 'email.verification.resend'`,
      [actor.accountId],
    );
    expect(count.rows[0]?.n).toBe(0);
    await app.close();
  });

  it('makes the old link invalid, activates with the latest link, then prevents another resend', async () => {
    const app = buildApp();
    const actor = await register(app, 'latest');
    const oldToken = await tokenFor(actor.accountId, 'email.verification');
    currentNow = new Date(BASE_NOW.getTime() + 61_000);
    expect((await resend(app, actor)).statusCode).toBe(200);
    const latestToken = await tokenFor(actor.accountId, 'email.verification.resend');

    const oldLink = await app.inject({
      method: 'GET',
      url: `/api/platform/v1/auth/verify/${oldToken}`,
    });
    expect(oldLink.statusCode).toBe(409);

    const latestLink = await app.inject({
      method: 'GET',
      url: `/api/platform/v1/auth/verify/${latestToken}`,
    });
    expect(latestLink.statusCode).toBe(200);
    const linkBody: { csrf: string } = latestLink.json();
    const setCookie = latestLink.headers['set-cookie'];
    const cookieValue = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    const intentCookie = /^aurora_intent=([^;]+)/.exec(cookieValue ?? '')?.[1];
    expect(intentCookie).toBeDefined();

    const confirm = await app.inject({
      method: 'POST',
      url: '/api/platform/v1/auth/email/confirm',
      headers: {
        cookie: `aurora_session=${actor.cookie}; aurora_intent=${intentCookie ?? ''}`,
        'content-type': 'application/json',
        'x-aurora-csrf': linkBody.csrf,
      },
      payload: JSON.stringify({ idempotencyKey: randomUUID() }),
    });
    expect(confirm.statusCode).toBe(200);
    const rotatedCookie = extractSessionCookie(confirm.headers['set-cookie']);
    const activated = await pool.query<{ status: string; verified_at: string | null }>(
      'SELECT status, verified_at FROM accounts WHERE account_id = $1',
      [actor.accountId],
    );
    expect(activated.rows[0]?.status).toBe('active');
    expect(activated.rows[0]?.verified_at).not.toBeNull();

    const session = await app.inject({
      method: 'GET',
      url: '/api/platform/v1/session',
      headers: { cookie: `aurora_session=${rotatedCookie}` },
    });
    const sessionBody: { csrf: string } = session.json();
    currentNow = new Date(currentNow.getTime() + 61_000);
    const afterConfirm = await app.inject({
      method: 'POST',
      url: '/api/platform/v1/auth/email/resend',
      headers: {
        cookie: `aurora_session=${rotatedCookie}`,
        'content-type': 'application/json',
        'x-aurora-csrf': sessionBody.csrf,
      },
      payload: JSON.stringify({ idempotencyKey: randomUUID() }),
    });
    expect(afterConfirm.statusCode).toBe(409);
    expect(afterConfirm.json<ProblemBody>().code).toBe('state_machine_conflict');
    await app.close();
  });
});
