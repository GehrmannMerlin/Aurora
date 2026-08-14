import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { FastifyInstance } from 'fastify';
import { createIntentToken, insertDeletionIntent } from '@aurora/platform-identity';
import { createSession, createSessionStore, type SessionStore } from '@aurora/platform-session';
import { ConsoleEmailAdapter } from '@aurora/platform-email';
import { buildPlatformApi } from '../../src/app.js';
import { loadPlatformApiConfig } from '../../src/config.js';
import {
  assertIsTestDatabase,
  createTestPool,
  redisUrl,
  runIdentityMigrations,
  testDatabaseUrl,
  truncateIdentityTables,
} from './helpers.js';
import { registerVerifiedActor, type RegisteredActor } from './flow-helpers.js';

const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const hasRedis = process.env.AURORA_TEST_REDIS_URL !== undefined;
const describeDb = hasDb && hasRedis ? describe : describe.skip;

const FIXED_NOW = new Date('2026-08-09T00:00:00.000Z');
const PASSWORD = 's3cure-Passw0rd!';
const COOLING_MS = 168 * 60 * 60 * 1000;

interface PreflightBody {
  status?: string;
  blockingOrganizations?: readonly {
    organizationId?: string;
    organizationName?: string;
    organizationKind?: string;
  }[];
  requiredLifecycle?: { coolingHours?: number; onlineCleanupDays?: number };
  serverTime?: string;
}

interface DeleteResponse {
  status?: string;
  accountStatus?: string;
  deletionRequestedAt?: string;
  deletionCoolingEndsAt?: string;
  sessionImpact?: string;
}

interface ProblemBody {
  code?: string;
}

interface LinkBody {
  csrf?: string;
  intentKind?: string;
}

interface RequestEmailBody {
  status?: string;
  maskedEmail?: string;
  resendAvailableAt?: string;
}

interface IntentHandle {
  cookie: string;
  csrf: string;
}

interface RequestIntentHandle extends IntentHandle {
  token: string;
}

/**
 * Typed views over an injected response body. `inject().json()` is `any`, so
 * these narrow it through a `unknown` parameter where the `as T` cast is a
 * necessary assertion (the injected response type is unknown to the helper) —
 * this keeps both `no-unnecessary-type-assertion` and `no-unsafe-member-access`
 * satisfied at every call site.
 */
function problemBodyOf(response: { json: () => unknown }): ProblemBody {
  return response.json() as ProblemBody;
}

function preflightBodyOf(response: { json: () => unknown }): PreflightBody {
  return response.json() as PreflightBody;
}

function deleteResponseOf(response: { json: () => unknown }): DeleteResponse {
  return response.json() as DeleteResponse;
}

/** Establish the short-lived `aurora_intent` cookie from an email-link GET. */
async function establishIntentLink(
  app: FastifyInstance,
  path: string,
  token: string,
): Promise<IntentHandle> {
  const link = await app.inject({ method: 'GET', url: `${path}/${token}` });
  expect(link.statusCode).toBe(200);
  const body: LinkBody = link.json();
  const setCookie = link.headers['set-cookie'];
  const cookieValue = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const match = /^aurora_intent=([^;]+)/.exec(cookieValue ?? '');
  expect(match).not.toBeNull();
  return { cookie: match?.[1] ?? '', csrf: body.csrf ?? '' };
}

/** Extract the raw cancel token from the account's deletion_cancel outbox row. */
async function cancelIntentToken(pool: Pool, accountId: string): Promise<string> {
  const result = await pool.query<{ payload: unknown }>(
    `SELECT payload FROM outbox
     WHERE aggregate_type = 'email.deletion_cancel' AND aggregate_id = $1
     ORDER BY created_at DESC, outbox_id DESC LIMIT 1`,
    [accountId],
  );
  const row = result.rows[0];
  const payload = row?.payload as { mailLinkUrl?: string; intentExpiresAt?: string } | undefined;
  expect(typeof payload?.intentExpiresAt).toBe('string');
  expect(Number.isFinite(Date.parse(payload?.intentExpiresAt ?? ''))).toBe(true);
  const url = typeof payload?.mailLinkUrl === 'string' ? payload.mailLinkUrl : '';
  const tokenMatch = /\btoken=([^&]+)/.exec(url);
  if (tokenMatch === null) {
    throw new Error('no token in deletion_cancel outbox mailLinkUrl');
  }
  return decodeURIComponent(tokenMatch[1] ?? '');
}

/** Extract the raw request-confirm token from the deletion_request outbox row. */
async function requestIntentToken(pool: Pool, accountId: string): Promise<string> {
  const result = await pool.query<{ payload: unknown }>(
    `SELECT payload FROM outbox
     WHERE aggregate_type = 'email.deletion_request' AND aggregate_id = $1
     ORDER BY created_at DESC, outbox_id DESC LIMIT 1`,
    [accountId],
  );
  const row = result.rows[0];
  const payload = row?.payload as { mailLinkUrl?: string; intentExpiresAt?: string } | undefined;
  expect(typeof payload?.intentExpiresAt).toBe('string');
  expect(Number.isFinite(Date.parse(payload?.intentExpiresAt ?? ''))).toBe(true);
  const url = typeof payload?.mailLinkUrl === 'string' ? payload.mailLinkUrl : '';
  const tokenMatch = /\btoken=([^&]+)/.exec(url);
  if (tokenMatch === null) {
    throw new Error('no token in deletion_request outbox mailLinkUrl');
  }
  return decodeURIComponent(tokenMatch[1] ?? '');
}

/**
 * The REAL A5 request step (production path, SEC-01 Task 5 fix): POST
 * identityRequestAccountDeletion with the session cookie + session CSRF. The
 * handler creates the deletion_request intent and the confirmation email; the
 * emailed link then establishes the intent cookie for the delete command.
 */
async function requestDeletionEmail(
  app: FastifyInstance,
  actor: RegisteredActor,
  idempotencyKey?: string,
): Promise<{ status: number; body: RequestEmailBody | ProblemBody }> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/platform/v1/account/deletion/request',
    headers: {
      cookie: `aurora_session=${actor.cookie}`,
      'content-type': 'application/json',
      'x-aurora-csrf': actor.csrf,
    },
    payload: JSON.stringify({ idempotencyKey: idempotencyKey ?? randomUUID() }),
  });
  return { status: response.statusCode, body: response.json() };
}

/** Create a real `kind='organization'` org with the account as its sole owner. */
async function createOrganization(
  pool: Pool,
  ownerAccountId: string,
  name: string,
): Promise<string> {
  const org = await pool.query<{ organization_id: string }>(
    `INSERT INTO organizations (name, kind, timezone)
     VALUES ($1, 'organization', 'UTC') RETURNING organization_id`,
    [name],
  );
  const organizationId = org.rows[0]?.organization_id;
  if (organizationId === undefined) throw new Error('no organization row created');
  await pool.query(
    `INSERT INTO organization_members (organization_id, account_id, role)
     VALUES ($1, $2, 'owner')`,
    [organizationId, ownerAccountId],
  );
  return organizationId;
}

/** Insert a fresh deletion_request intent for the account and GET its link. */
async function establishRequestIntent(
  app: FastifyInstance,
  pool: Pool,
  accountId: string,
): Promise<RequestIntentHandle> {
  const { token, digest } = createIntentToken();
  await insertDeletionIntent(pool, {
    accountId,
    intentKind: 'deletion_request',
    tokenDigest: digest,
    expiresAt: new Date(FIXED_NOW.getTime() + 2 * 60 * 60 * 1000),
  });
  const handle = await establishIntentLink(app, '/api/platform/v1/account/deletion/intent', token);
  return { ...handle, token };
}

describeDb('A5 account deletion flow (real PostgreSQL 17 + Redis)', () => {
  let pool: Pool;
  let sessionStore: SessionStore;
  let keyPrefix: string;

  beforeAll(async () => {
    assertIsTestDatabase(testDatabaseUrl());
    pool = createTestPool();
    await runIdentityMigrations();
    await truncateIdentityTables(pool);
    keyPrefix = `test:deletion-flow:${randomUUID()}`;
    sessionStore = await createSessionStore({ url: redisUrl(), keyPrefix });
  });

  afterAll(async () => {
    await sessionStore.client.quit().catch(() => undefined);
    await pool.end();
  });

  function buildApp(overrides?: {
    now?: Date;
    pool?: Pool;
    sessionStore?: SessionStore;
  }): FastifyInstance {
    const now = overrides?.now ?? FIXED_NOW;
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
      now: () => new Date(now.getTime()),
    });
  }

  async function requestDelete(
    app: FastifyInstance,
    actor: RegisteredActor,
    intent: IntentHandle,
  ): Promise<{ status: number; body: DeleteResponse | ProblemBody }> {
    // `identityDeleteAccount` is a session-authLevel operation, so its CSRF is
    // bound to the SESSION (actor.csrf), not the intent cookie. The intent
    // cookie carries the `deletion_request` kind as the second-factor proof.
    const response = await app.inject({
      method: 'POST',
      url: '/api/platform/v1/account/deletion',
      headers: {
        cookie: `aurora_session=${actor.cookie}; aurora_intent=${intent.cookie}`,
        'content-type': 'application/json',
        'x-aurora-csrf': actor.csrf,
      },
      payload: JSON.stringify({ currentPassword: PASSWORD, idempotencyKey: randomUUID() }),
    });
    return { status: response.statusCode, body: response.json() };
  }

  async function login(app: FastifyInstance, email: string, password: string): Promise<number> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/platform/v1/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ email, password, idempotencyKey: randomUUID() }),
    });
    return response.statusCode;
  }

  it('E2E-1: request deletion revokes sessions, emails the cancel link, and lazy-finalizes after 168h', async () => {
    const app = buildApp();
    const email = `e2e1-${randomUUID()}@example.com`;
    const actor = await registerVerifiedActor(app, pool, email);

    // Preflight is ready: only the personal workspace exists and it never blocks
    // (spec §6.2).
    const preflight = await app.inject({
      method: 'GET',
      url: '/api/platform/v1/account/deletion/preflight',
      headers: { cookie: `aurora_session=${actor.cookie}` },
    });
    expect(preflight.statusCode).toBe(200);
    const preflightBody: PreflightBody = preflight.json();
    expect(preflightBody.status).toBe('ready');
    expect(preflightBody.blockingOrganizations).toBeUndefined();
    expect(preflightBody.requiredLifecycle?.coolingHours).toBe(168);
    expect(preflightBody.requiredLifecycle?.onlineCleanupDays).toBe(7);

    // The REAL request step (SEC-01 Task 5 fix): identityRequestAccountDeletion
    // creates the deletion_request intent and sends the confirmation email; the
    // emailed link then establishes the intent cookie for the delete command.
    // No direct intent insertion here — E2E-1 must prove the full production path.
    const requestEmail = await requestDeletionEmail(app, actor);
    expect(requestEmail.status).toBe(200);
    const requestEmailBody = requestEmail.body as RequestEmailBody;
    expect(requestEmailBody.status).toBe('succeeded');
    expect(requestEmailBody.maskedEmail).toMatch(/\*\*\*/);
    expect(typeof requestEmailBody.resendAvailableAt).toBe('string');

    const requestToken = await requestIntentToken(pool, actor.accountId);
    const intent = await establishIntentLink(
      app,
      '/api/platform/v1/account/deletion/intent',
      requestToken,
    );

    const del = await requestDelete(app, actor, intent);
    expect(del.status).toBe(200);
    const delBody = del.body as DeleteResponse;
    expect(delBody.status).toBe('succeeded');
    expect(delBody.accountStatus).toBe('deletion_cooling');
    expect(delBody.sessionImpact).toBe('revoked_all');

    // The account is now in the cooling state.
    const accountRow = await pool.query<{ status: string }>(
      'SELECT status FROM accounts WHERE account_id = $1',
      [actor.accountId],
    );
    expect(accountRow.rows[0]?.status).toBe('deletion_cooling');

    // Every prior session is revoked.
    const oldSession = await app.inject({
      method: 'GET',
      url: '/api/platform/v1/session',
      headers: { cookie: `aurora_session=${actor.cookie}` },
    });
    expect(oldSession.statusCode).toBe(401);

    // A deletion_cancel intent and its confirm email (intentType deletion_confirmation) exist.
    const cancelIntents = await pool.query<{ intent_kind: string }>(
      'SELECT intent_kind FROM account_deletion_intents WHERE account_id = $1',
      [actor.accountId],
    );
    expect(cancelIntents.rows.some((row) => row.intent_kind === 'deletion_cancel')).toBe(true);
    const outbox = await pool.query<{ payload: unknown }>(
      `SELECT payload FROM outbox WHERE aggregate_type = 'email.deletion_cancel' AND aggregate_id = $1`,
      [actor.accountId],
    );
    expect(outbox.rows.length).toBe(1);
    const outboxPayload = outbox.rows[0]?.payload as { intentType?: string };
    expect(outboxPayload.intentType).toBe('deletion_confirmation');

    // The request was audited.
    const audits = await pool.query<{ action: string }>(
      'SELECT action FROM security_audit_events WHERE target_account_id = $1',
      [actor.accountId],
    );
    expect(audits.rows.map((row) => row.action)).toContain('account.deletion.requested');

    // A cooling account cannot sign in.
    expect(await login(app, email, PASSWORD)).toBe(409);

    // Advance past the 168h deadline. Sessions were revoked at request time, so a
    // real login is impossible; create a session directly and drive the preflight
    // lazy-finalization guard (spec §4.2).
    const lateNow = new Date(FIXED_NOW.getTime() + COOLING_MS + 60_000);
    const lateSession = await createSession(sessionStore, {
      accountId: actor.accountId,
      authLevel: 'authenticated',
      now: lateNow,
      idleMs: 30 * 60 * 1000,
      absoluteMs: 8 * 60 * 60 * 1000,
    });
    const lateApp = buildApp({ now: lateNow });
    const latePreflight = await lateApp.inject({
      method: 'GET',
      url: '/api/platform/v1/account/deletion/preflight',
      headers: { cookie: `aurora_session=${lateSession.cookieValue}` },
    });
    expect(latePreflight.statusCode).toBe(200);
    const lateBody: PreflightBody = latePreflight.json();
    expect(lateBody.status).toBe('unavailable');
    await lateApp.close();

    // The account is terminated with the durable cleanup handoff persisted.
    const term = await pool.query<{ status: string; deletion_terminated_at: string | null }>(
      'SELECT status, deletion_terminated_at FROM accounts WHERE account_id = $1',
      [actor.accountId],
    );
    expect(term.rows[0]?.status).toBe('terminated');
    expect(term.rows[0]?.deletion_terminated_at).not.toBeNull();

    const handoff = await pool.query<{
      status: string;
      required_lifecycle: {
        onlineCleanupDays?: number;
        auditRetentionYears?: number;
        backupRetentionDays?: number;
      };
    }>('SELECT status, required_lifecycle FROM account_cleanup_handoffs WHERE account_id = $1', [
      actor.accountId,
    ]);
    expect(handoff.rows.length).toBe(1);
    expect(handoff.rows[0]?.status).toBe('pending');
    expect(handoff.rows[0]?.required_lifecycle).toMatchObject({
      onlineCleanupDays: 7,
      auditRetentionYears: 1,
      backupRetentionDays: 35,
    });

    const lateAudits = await pool.query<{ action: string }>(
      'SELECT action FROM security_audit_events WHERE target_account_id = $1',
      [actor.accountId],
    );
    const actions = lateAudits.rows.map((row) => row.action);
    expect(actions).toContain('account.deletion.terminated');
    expect(actions).toContain('account.deletion.handoff_created');

    // A terminated account cannot sign in.
    expect(await login(app, email, PASSWORD)).toBe(409);
    await app.close();
  });

  it('E2E-1b: identityRequestAccountDeletion is idempotent and rejects re-entry in cooling', async () => {
    const app = buildApp();
    const email = `e2e1b-${randomUUID()}@example.com`;
    const actor = await registerVerifiedActor(app, pool, email);

    // Same idempotency key replays the first result: the same maskedEmail and
    // exactly ONE outbox row / ONE request intent (the command committed once).
    const idempotencyKey = randomUUID();
    const first = await requestDeletionEmail(app, actor, idempotencyKey);
    expect(first.status).toBe(200);
    const firstBody = first.body as RequestEmailBody;
    expect(firstBody.status).toBe('succeeded');
    expect(firstBody.maskedEmail).toMatch(/\*\*\*/);
    expect(typeof firstBody.resendAvailableAt).toBe('string');

    const second = await requestDeletionEmail(app, actor, idempotencyKey);
    expect(second.status).toBe(200);
    expect((second.body as RequestEmailBody).maskedEmail).toBe(firstBody.maskedEmail);

    const outbox = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM outbox
       WHERE aggregate_type = 'email.deletion_request' AND aggregate_id = $1`,
      [actor.accountId],
    );
    expect(outbox.rows[0]?.n).toBe(1);
    const intents = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM account_deletion_intents
       WHERE account_id = $1 AND intent_kind = 'deletion_request'`,
      [actor.accountId],
    );
    expect(intents.rows[0]?.n).toBe(1);

    // Complete the real flow so the account enters the cooling window.
    const requestToken = await requestIntentToken(pool, actor.accountId);
    const intent = await establishIntentLink(
      app,
      '/api/platform/v1/account/deletion/intent',
      requestToken,
    );
    const del = await requestDelete(app, actor, intent);
    expect(del.status).toBe(200);

    // A cooling account cannot request a new confirmation email. All sessions
    // were revoked, so mint a fresh session and drive the request op with the
    // new session's bound CSRF.
    const coolingSession = await createSession(sessionStore, {
      accountId: actor.accountId,
      authLevel: 'authenticated',
      now: FIXED_NOW,
      idleMs: 30 * 60 * 1000,
      absoluteMs: 8 * 60 * 60 * 1000,
    });
    const coolingResp = await app.inject({
      method: 'POST',
      url: '/api/platform/v1/account/deletion/request',
      headers: {
        cookie: `aurora_session=${coolingSession.cookieValue}`,
        'content-type': 'application/json',
        'x-aurora-csrf': coolingSession.csrfSecret,
      },
      payload: JSON.stringify({ idempotencyKey: randomUUID() }),
    });
    expect(coolingResp.statusCode).toBe(409);
    expect(problemBodyOf(coolingResp).code).toBe('state_machine_conflict');
    await app.close();
  });

  it('E2E-2: a unique-owner organization blocks preflight and the delete command', async () => {
    const app = buildApp();
    const email = `e2e2-${randomUUID()}@example.com`;
    const actor = await registerVerifiedActor(app, pool, email);
    const orgId = await createOrganization(pool, actor.accountId, 'Blocking Org');

    // Preflight reports the org as the blocker (minimum identifying info).
    const preflight = await app.inject({
      method: 'GET',
      url: '/api/platform/v1/account/deletion/preflight',
      headers: { cookie: `aurora_session=${actor.cookie}` },
    });
    expect(preflight.statusCode).toBe(200);
    const body: PreflightBody = preflight.json();
    expect(body.status).toBe('blocked');
    expect(body.blockingOrganizations).toHaveLength(1);
    expect(body.blockingOrganizations?.[0]).toMatchObject({
      organizationId: orgId,
      organizationName: 'Blocking Org',
      organizationKind: 'organization',
    });

    // The blocked preflight is audited.
    const blockedAudits = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM security_audit_events
       WHERE target_account_id = $1 AND action = 'account.deletion.preflight_blocked'`,
      [actor.accountId],
    );
    expect(blockedAudits.rows[0]?.n).toBe(1);

    // The delete command's in-transaction final re-check rejects closed.
    const intent = await establishRequestIntent(app, pool, actor.accountId);
    const del = await requestDelete(app, actor, intent);
    expect(del.status).toBe(409);
    expect((del.body as ProblemBody).code).toBe('state_machine_conflict');

    // No handoff, and the account did not transition into cooling (its base
    // status after register+verify remains `pending_verification`; email
    // verification sets `verified_at`, not the status column).
    const accountRow = await pool.query<{ status: string }>(
      'SELECT status FROM accounts WHERE account_id = $1',
      [actor.accountId],
    );
    expect(accountRow.rows[0]?.status).not.toBe('deletion_cooling');
    expect(accountRow.rows[0]?.status).not.toBe('terminated');
    const handoff = await pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM account_cleanup_handoffs WHERE account_id = $1',
      [actor.accountId],
    );
    expect(handoff.rows[0]?.n).toBe(0);
    await app.close();
  });

  it('E2E-3: cancel within the cooling window returns the account to active', async () => {
    const app = buildApp();
    const email = `e2e3-${randomUUID()}@example.com`;
    const actor = await registerVerifiedActor(app, pool, email);

    // Request deletion.
    const intent = await establishRequestIntent(app, pool, actor.accountId);
    const del = await requestDelete(app, actor, intent);
    expect(del.status).toBe(200);

    // The emailed cancel link establishes the deletion_cancel intent cookie.
    const cancelToken = await cancelIntentToken(pool, actor.accountId);
    const cancelLink = await establishIntentLink(
      app,
      '/api/platform/v1/account/deletion/cancel/intent',
      cancelToken,
    );
    expect(cancelLink.csrf.length).toBeGreaterThan(0);

    // Cancel with the current password + intent cookie + CSRF.
    const cancel = await app.inject({
      method: 'POST',
      url: '/api/platform/v1/account/deletion/cancel',
      headers: {
        cookie: `aurora_intent=${cancelLink.cookie}`,
        'content-type': 'application/json',
        'x-aurora-csrf': cancelLink.csrf,
      },
      payload: JSON.stringify({ currentPassword: PASSWORD, idempotencyKey: randomUUID() }),
    });
    expect(cancel.statusCode).toBe(200);
    const cancelBody: DeleteResponse = cancel.json();
    expect(cancelBody.status).toBe('succeeded');
    expect(cancelBody.accountStatus).toBe('active');
    expect(cancelBody.sessionImpact).toBe('revoked_all');

    // The account is active again and the user can sign in.
    const accountRow = await pool.query<{ status: string }>(
      'SELECT status FROM accounts WHERE account_id = $1',
      [actor.accountId],
    );
    expect(accountRow.rows[0]?.status).toBe('active');
    expect(await login(app, email, PASSWORD)).toBe(200);

    // The cancellation was audited.
    const audits = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM security_audit_events
       WHERE target_account_id = $1 AND action = 'account.deletion.cancelled'`,
      [actor.accountId],
    );
    expect(audits.rows[0]?.n).toBe(1);
    await app.close();
  });

  it('security negatives: CSRF, wrong password, consumed intent, cancel-outside-cooling', async () => {
    const app = buildApp();
    const email = `neg-${randomUUID()}@example.com`;
    const actor = await registerVerifiedActor(app, pool, email);
    const intent = await establishRequestIntent(app, pool, actor.accountId);

    // Wrong current password -> uniform 403 authorization (anti-enumeration).
    const wrongPass = await app.inject({
      method: 'POST',
      url: '/api/platform/v1/account/deletion',
      headers: {
        cookie: `aurora_session=${actor.cookie}; aurora_intent=${intent.cookie}`,
        'content-type': 'application/json',
        'x-aurora-csrf': actor.csrf,
      },
      payload: JSON.stringify({ currentPassword: 'wrong-password!', idempotencyKey: randomUUID() }),
    });
    expect(wrongPass.statusCode).toBe(403);
    const wrongPassProblem: ProblemBody = wrongPass.json();
    expect(wrongPassProblem.code).toBe('authorization');

    // Missing/bad CSRF token -> 403 authorization (plugin-level).
    const csrfBad = await app.inject({
      method: 'POST',
      url: '/api/platform/v1/account/deletion',
      headers: {
        cookie: `aurora_session=${actor.cookie}; aurora_intent=${intent.cookie}`,
        'content-type': 'application/json',
        'x-aurora-csrf': 'not-the-bound-secret',
      },
      payload: JSON.stringify({ currentPassword: PASSWORD, idempotencyKey: randomUUID() }),
    });
    expect(csrfBad.statusCode).toBe(403);

    // A valid delete succeeds; the request intent is consumed once.
    const ok = await requestDelete(app, actor, intent);
    expect(ok.status).toBe(200);

    // The consumed request intent cannot be used again: the intent link GET for
    // the same token maps to 409 business_validation, and the old session was
    // revoked so a second POST is rejected with 401 authentication.
    const relink = await app.inject({
      method: 'GET',
      url: `/api/platform/v1/account/deletion/intent/${intent.token}`,
    });
    expect(relink.statusCode).toBe(409);
    const relinkProblem: ProblemBody = relink.json();
    expect(relinkProblem.code).toBe('business_validation');
    const second = await app.inject({
      method: 'POST',
      url: '/api/platform/v1/account/deletion',
      headers: {
        cookie: `aurora_session=${actor.cookie}; aurora_intent=${intent.cookie}`,
        'content-type': 'application/json',
        'x-aurora-csrf': actor.csrf,
      },
      payload: JSON.stringify({ currentPassword: PASSWORD, idempotencyKey: randomUUID() }),
    });
    expect(second.statusCode).toBe(401);

    // A cancel outside the cooling window (an ACTIVE account that never requested
    // deletion) -> 409 state_machine_conflict.
    const activeEmail = `neg-active-${randomUUID()}@example.com`;
    const activeActor = await registerVerifiedActor(app, pool, activeEmail);
    const { token: cancelToken2, digest: cancelDigest2 } = createIntentToken();
    await insertDeletionIntent(pool, {
      accountId: activeActor.accountId,
      intentKind: 'deletion_cancel',
      tokenDigest: cancelDigest2,
      expiresAt: new Date(FIXED_NOW.getTime() + 2 * 60 * 60 * 1000),
    });
    const cancelLink = await establishIntentLink(
      app,
      '/api/platform/v1/account/deletion/cancel/intent',
      cancelToken2,
    );
    const cancel = await app.inject({
      method: 'POST',
      url: '/api/platform/v1/account/deletion/cancel',
      headers: {
        cookie: `aurora_intent=${cancelLink.cookie}`,
        'content-type': 'application/json',
        'x-aurora-csrf': cancelLink.csrf,
      },
      payload: JSON.stringify({ currentPassword: PASSWORD, idempotencyKey: randomUUID() }),
    });
    expect(cancel.statusCode).toBe(409);
    const cancelProblem: ProblemBody = cancel.json();
    expect(cancelProblem.code).toBe('state_machine_conflict');
    await app.close();
  });

  it('security negative: a deletion_request intent for a DIFFERENT account cannot authorize deleting this account (intent binding)', async () => {
    // Account A creates a deletion_request intent for itself; account V holds a
    // valid session + password. V must NOT be deletable using A's mailbox proof
    // — the email confirmation must be bound to the deleted account (spec §7).
    const app = buildApp();
    const emailA = `intent-a-${randomUUID()}@example.com`;
    const emailV = `intent-v-${randomUUID()}@example.com`;
    const actorA = await registerVerifiedActor(app, pool, emailA);
    const actorV = await registerVerifiedActor(app, pool, emailV);

    // A's deletion_request intent (inserted directly, mirroring the flow helpers).
    const { token: aToken, digest: aDigest } = createIntentToken();
    await insertDeletionIntent(pool, {
      accountId: actorA.accountId,
      intentKind: 'deletion_request',
      tokenDigest: aDigest,
      expiresAt: new Date(FIXED_NOW.getTime() + 2 * 60 * 60 * 1000),
    });
    const aIntent = await establishIntentLink(
      app,
      '/api/platform/v1/account/deletion/intent',
      aToken,
    );

    // V posts the delete with V's session + V's password but A's mailbox intent.
    const crossAccount = await app.inject({
      method: 'POST',
      url: '/api/platform/v1/account/deletion',
      headers: {
        cookie: `aurora_session=${actorV.cookie}; aurora_intent=${aIntent.cookie}`,
        'content-type': 'application/json',
        'x-aurora-csrf': actorV.csrf,
      },
      payload: JSON.stringify({ currentPassword: PASSWORD, idempotencyKey: randomUUID() }),
    });
    expect(crossAccount.statusCode).toBe(409);
    const crossProblem: ProblemBody = crossAccount.json();
    expect(crossProblem.code).toBe('business_validation');

    // V did not enter the deletion lifecycle (status untouched — it stays
    // pending_verification, NOT deletion_cooling/terminated); A's intent remains
    // unconsumed.
    const vRow = await pool.query<{ status: string }>(
      `SELECT status FROM accounts WHERE account_id = $1`,
      [actorV.accountId],
    );
    const vStatus = vRow.rows[0]?.status;
    expect(vStatus).not.toBe('deletion_cooling');
    expect(vStatus).not.toBe('terminated');
    const aIntentRow = await pool.query<{ consumed_at: string | null }>(
      `SELECT consumed_at FROM account_deletion_intents WHERE token_digest = $1`,
      [aDigest],
    );
    expect(aIntentRow.rows[0]?.consumed_at).toBeNull();
    await app.close();
  });

  it('fails closed with 503 authority_unavailable when the session authority is down', async () => {
    const downStore = await createSessionStore({
      url: redisUrl(),
      keyPrefix: `test:deletion-down:${randomUUID()}`,
    });
    await downStore.client.quit();
    const downApp = buildApp({ sessionStore: downStore });
    const response = await downApp.inject({
      method: 'GET',
      url: '/api/platform/v1/account/deletion/preflight',
      headers: { cookie: 'aurora_session=some-session-cookie-value' },
    });
    expect(response.statusCode).toBe(503);
    const downProblem: ProblemBody = response.json();
    expect(downProblem.code).toBe('authority_unavailable');
    await downApp.close();
  });

  it('rejects malformed deletion request bodies with 400 structural_error (contract validation)', async () => {
    const app = buildApp();
    const email = `struct-${randomUUID()}@example.com`;
    const actor = await registerVerifiedActor(app, pool, email);

    // Request body must be { idempotencyKey }.
    const badRequest = await app.inject({
      method: 'POST',
      url: '/api/platform/v1/account/deletion/request',
      headers: {
        cookie: `aurora_session=${actor.cookie}`,
        'content-type': 'application/json',
        'x-aurora-csrf': actor.csrf,
      },
      payload: JSON.stringify({}),
    });
    expect(badRequest.statusCode).toBe(400);
    expect(problemBodyOf(badRequest).code).toBe('structural_error');

    // Delete body must be { currentPassword, idempotencyKey }.
    const badDelete = await app.inject({
      method: 'POST',
      url: '/api/platform/v1/account/deletion',
      headers: {
        cookie: `aurora_session=${actor.cookie}`,
        'content-type': 'application/json',
        'x-aurora-csrf': actor.csrf,
      },
      payload: JSON.stringify({}),
    });
    expect(badDelete.statusCode).toBe(400);
    expect(problemBodyOf(badDelete).code).toBe('structural_error');

    // Cancel body must be { currentPassword, idempotencyKey } — the intent cookie
    // still needs to be present so the CSRF plugin lets the handler run.
    const { token, digest } = createIntentToken();
    await insertDeletionIntent(pool, {
      accountId: actor.accountId,
      intentKind: 'deletion_cancel',
      tokenDigest: digest,
      expiresAt: new Date(FIXED_NOW.getTime() + 2 * 60 * 60 * 1000),
    });
    const cancelLink = await establishIntentLink(
      app,
      '/api/platform/v1/account/deletion/cancel/intent',
      token,
    );
    const badCancel = await app.inject({
      method: 'POST',
      url: '/api/platform/v1/account/deletion/cancel',
      headers: {
        cookie: `aurora_intent=${cancelLink.cookie}`,
        'content-type': 'application/json',
        'x-aurora-csrf': cancelLink.csrf,
      },
      payload: JSON.stringify({}),
    });
    expect(badCancel.statusCode).toBe(400);
    expect(problemBodyOf(badCancel).code).toBe('structural_error');
    await app.close();
  });

  it('maps a session referencing a missing account to 404 not_found (preflight/request/delete)', async () => {
    const app = buildApp();
    const missingAccountId = randomUUID();
    const session = await createSession(sessionStore, {
      accountId: missingAccountId,
      authLevel: 'authenticated',
      now: FIXED_NOW,
      idleMs: 30 * 60 * 1000,
      absoluteMs: 8 * 60 * 60 * 1000,
    });

    const preflight = await app.inject({
      method: 'GET',
      url: '/api/platform/v1/account/deletion/preflight',
      headers: { cookie: `aurora_session=${session.cookieValue}` },
    });
    expect(preflight.statusCode).toBe(404);
    expect(problemBodyOf(preflight).code).toBe('not_found');

    const request = await app.inject({
      method: 'POST',
      url: '/api/platform/v1/account/deletion/request',
      headers: {
        cookie: `aurora_session=${session.cookieValue}`,
        'content-type': 'application/json',
        'x-aurora-csrf': session.csrfSecret,
      },
      payload: JSON.stringify({ idempotencyKey: randomUUID() }),
    });
    expect(request.statusCode).toBe(404);
    expect(problemBodyOf(request).code).toBe('not_found');

    const del = await app.inject({
      method: 'POST',
      url: '/api/platform/v1/account/deletion',
      headers: {
        cookie: `aurora_session=${session.cookieValue}`,
        'content-type': 'application/json',
        'x-aurora-csrf': session.csrfSecret,
      },
      payload: JSON.stringify({ currentPassword: PASSWORD, idempotencyKey: randomUUID() }),
    });
    expect(del.statusCode).toBe(404);
    expect(problemBodyOf(del).code).toBe('not_found');
    await app.close();
  });

  it('requires the deletion_request intent cookie on the delete command (404 when absent)', async () => {
    const app = buildApp();
    const email = `nointent-${randomUUID()}@example.com`;
    const actor = await registerVerifiedActor(app, pool, email);

    const del = await app.inject({
      method: 'POST',
      url: '/api/platform/v1/account/deletion',
      headers: {
        cookie: `aurora_session=${actor.cookie}`,
        'content-type': 'application/json',
        'x-aurora-csrf': actor.csrf,
      },
      payload: JSON.stringify({ currentPassword: PASSWORD, idempotencyKey: randomUUID() }),
    });
    expect(del.statusCode).toBe(404);
    expect(problemBodyOf(del).code).toBe('not_found');
    await app.close();
  });

  it('rejects expired deletion intents on the delete and cancel commands (409 business_validation)', async () => {
    const app = buildApp();
    const email = `expired-${randomUUID()}@example.com`;
    const actor = await registerVerifiedActor(app, pool, email);

    // Delete with an expired deletion_request intent. The link GET refuses to set
    // a cookie for an expired token, so the cookie is crafted manually.
    const { token: reqToken, digest: reqDigest } = createIntentToken();
    await insertDeletionIntent(pool, {
      accountId: actor.accountId,
      intentKind: 'deletion_request',
      tokenDigest: reqDigest,
      expiresAt: new Date(FIXED_NOW.getTime() - 1000),
    });
    const session = await createSession(sessionStore, {
      accountId: actor.accountId,
      authLevel: 'authenticated',
      now: FIXED_NOW,
      idleMs: 30 * 60 * 1000,
      absoluteMs: 8 * 60 * 60 * 1000,
    });
    const expiredReq = await app.inject({
      method: 'POST',
      url: '/api/platform/v1/account/deletion',
      headers: {
        cookie: `aurora_session=${session.cookieValue}; aurora_intent=deletion_request:${reqToken}:${session.csrfSecret}`,
        'content-type': 'application/json',
        'x-aurora-csrf': session.csrfSecret,
      },
      payload: JSON.stringify({ currentPassword: PASSWORD, idempotencyKey: randomUUID() }),
    });
    expect(expiredReq.statusCode).toBe(409);
    expect(problemBodyOf(expiredReq).code).toBe('business_validation');

    // The same expired intent on the link GET also maps to 409.
    const expiredLink = await app.inject({
      method: 'GET',
      url: `/api/platform/v1/account/deletion/intent/${reqToken}`,
    });
    expect(expiredLink.statusCode).toBe(409);
    expect(problemBodyOf(expiredLink).code).toBe('business_validation');

    // Cancel with an expired deletion_cancel intent.
    const { token: canToken, digest: canDigest } = createIntentToken();
    await insertDeletionIntent(pool, {
      accountId: actor.accountId,
      intentKind: 'deletion_cancel',
      tokenDigest: canDigest,
      expiresAt: new Date(FIXED_NOW.getTime() - 1000),
    });
    const expiredCancel = await app.inject({
      method: 'POST',
      url: '/api/platform/v1/account/deletion/cancel',
      headers: {
        cookie: `aurora_intent=deletion_cancel:${canToken}:${session.csrfSecret}`,
        'content-type': 'application/json',
        'x-aurora-csrf': session.csrfSecret,
      },
      payload: JSON.stringify({ currentPassword: PASSWORD, idempotencyKey: randomUUID() }),
    });
    expect(expiredCancel.statusCode).toBe(409);
    expect(problemBodyOf(expiredCancel).code).toBe('business_validation');

    // The same expired cancel intent on the link GET also maps to 409.
    const expiredCancelLink = await app.inject({
      method: 'GET',
      url: `/api/platform/v1/account/deletion/cancel/intent/${canToken}`,
    });
    expect(expiredCancelLink.statusCode).toBe(409);
    expect(problemBodyOf(expiredCancelLink).code).toBe('business_validation');
    await app.close();
  });

  it('rejects request and delete on a terminated account (409 state_machine_conflict)', async () => {
    const app = buildApp();
    const email = `terminated-${randomUUID()}@example.com`;
    const actor = await registerVerifiedActor(app, pool, email);
    await pool.query(`UPDATE accounts SET status = 'terminated' WHERE account_id = $1`, [
      actor.accountId,
    ]);
    const session = await createSession(sessionStore, {
      accountId: actor.accountId,
      authLevel: 'authenticated',
      now: FIXED_NOW,
      idleMs: 30 * 60 * 1000,
      absoluteMs: 8 * 60 * 60 * 1000,
    });

    const request = await app.inject({
      method: 'POST',
      url: '/api/platform/v1/account/deletion/request',
      headers: {
        cookie: `aurora_session=${session.cookieValue}`,
        'content-type': 'application/json',
        'x-aurora-csrf': session.csrfSecret,
      },
      payload: JSON.stringify({ idempotencyKey: randomUUID() }),
    });
    expect(request.statusCode).toBe(409);
    expect(problemBodyOf(request).code).toBe('state_machine_conflict');

    const del = await app.inject({
      method: 'POST',
      url: '/api/platform/v1/account/deletion',
      headers: {
        cookie: `aurora_session=${session.cookieValue}`,
        'content-type': 'application/json',
        'x-aurora-csrf': session.csrfSecret,
      },
      payload: JSON.stringify({ currentPassword: PASSWORD, idempotencyKey: randomUUID() }),
    });
    expect(del.statusCode).toBe(409);
    expect(problemBodyOf(del).code).toBe('state_machine_conflict');
    await app.close();
  });

  it('returns 404 for an empty intent-link token on both deletion link endpoints', async () => {
    const app = buildApp();
    const deleteLink = await app.inject({
      method: 'GET',
      url: '/api/platform/v1/account/deletion/intent/',
    });
    expect(deleteLink.statusCode).toBe(404);
    expect(problemBodyOf(deleteLink).code).toBe('not_found');

    const cancelLink = await app.inject({
      method: 'GET',
      url: '/api/platform/v1/account/deletion/cancel/intent/',
    });
    expect(cancelLink.statusCode).toBe(404);
    expect(problemBodyOf(cancelLink).code).toBe('not_found');
    await app.close();
  });

  it('session gate: a deletion_cooling account never receives a business session (401)', async () => {
    const app = buildApp();
    const email = `sessgate-${randomUUID()}@example.com`;
    const actor = await registerVerifiedActor(app, pool, email);
    const intent = await establishRequestIntent(app, pool, actor.accountId);
    const del = await requestDelete(app, actor, intent);
    expect(del.status).toBe(200);

    // A freshly minted session still resolves in Redis, but the status gate in
    // GET /session must reject the cooling account with the uniform 401.
    const minted = await createSession(sessionStore, {
      accountId: actor.accountId,
      authLevel: 'authenticated',
      now: FIXED_NOW,
      idleMs: 30 * 60 * 1000,
      absoluteMs: 8 * 60 * 60 * 1000,
    });
    const sessionResp = await app.inject({
      method: 'GET',
      url: '/api/platform/v1/session',
      headers: { cookie: `aurora_session=${minted.cookieValue}` },
    });
    expect(sessionResp.statusCode).toBe(401);
    await app.close();
  });

  it('preflight is ready for a non-unique-owner organization membership', async () => {
    const app = buildApp();
    const emailA = `ready-a-${randomUUID()}@example.com`;
    const emailB = `ready-b-${randomUUID()}@example.com`;
    const actorA = await registerVerifiedActor(app, pool, emailA);
    const actorB = await registerVerifiedActor(app, pool, emailB);
    const orgId = await createOrganization(pool, actorA.accountId, 'Co-Owned Ready');
    await pool.query(
      `INSERT INTO organization_members (organization_id, account_id, role)
       VALUES ($1, $2, 'owner')`,
      [orgId, actorB.accountId],
    );

    const preflight = await app.inject({
      method: 'GET',
      url: '/api/platform/v1/account/deletion/preflight',
      headers: { cookie: `aurora_session=${actorA.cookie}` },
    });
    expect(preflight.statusCode).toBe(200);
    expect(preflightBodyOf(preflight).status).toBe('ready');

    // A non-unique-owner org does not block the delete command's in-transaction
    // owner re-check either: the delete succeeds into the cooling window.
    const intent = await establishRequestIntent(app, pool, actorA.accountId);
    const del = await requestDelete(app, actorA, intent);
    expect(del.status).toBe(200);
    expect((del.body as DeleteResponse).accountStatus).toBe('deletion_cooling');
    await app.close();
  });

  it('cancel at the deadline is rejected once the owner re-check passes (point of no return)', async () => {
    const app = buildApp();
    const emailA = `pnr-a-${randomUUID()}@example.com`;
    const emailB = `pnr-b-${randomUUID()}@example.com`;
    const actorA = await registerVerifiedActor(app, pool, emailA);
    const actorB = await registerVerifiedActor(app, pool, emailB);

    // Real flow into cooling.
    const intent = await establishRequestIntent(app, pool, actorA.accountId);
    const del = await requestDelete(app, actorA, intent);
    expect(del.status).toBe(200);

    // Unique owner of an organization.
    const orgId = await createOrganization(pool, actorA.accountId, 'Point-Of-No-Return Org');

    // Advance past the 168h deadline.
    const lateNow = new Date(FIXED_NOW.getTime() + COOLING_MS + 60_000);
    const lateApp = buildApp({ now: lateNow });
    const lateSession = await createSession(sessionStore, {
      accountId: actorA.accountId,
      authLevel: 'authenticated',
      now: lateNow,
      idleMs: 30 * 60 * 1000,
      absoluteMs: 8 * 60 * 60 * 1000,
    });

    // A finalization attempt is kept cooling (unique owner) and records the
    // deterministic `finalize` idempotency result.
    const p1 = await lateApp.inject({
      method: 'GET',
      url: '/api/platform/v1/account/deletion/preflight',
      headers: { cookie: `aurora_session=${lateSession.cookieValue}` },
    });
    expect(p1.statusCode).toBe(200);
    expect(preflightBodyOf(p1).status).toBe('blocked');

    // Ownership is transferred: actorB joins as an owner, so actorA is no longer
    // the unique owner. The cancel command's authoritative in-transaction re-check
    // now sees the owner re-check pass and rejects the cancel (point of no return).
    await pool.query(
      `INSERT INTO organization_members (organization_id, account_id, role)
       VALUES ($1, $2, 'owner')`,
      [orgId, actorB.accountId],
    );

    const { token, digest: cancelDigest } = createIntentToken();
    await insertDeletionIntent(pool, {
      accountId: actorA.accountId,
      intentKind: 'deletion_cancel',
      tokenDigest: cancelDigest,
      expiresAt: new Date(lateNow.getTime() + 2 * 60 * 60 * 1000),
    });
    const cancelLink = await establishIntentLink(
      lateApp,
      '/api/platform/v1/account/deletion/cancel/intent',
      token,
    );
    const cancel = await lateApp.inject({
      method: 'POST',
      url: '/api/platform/v1/account/deletion/cancel',
      headers: {
        cookie: `aurora_intent=${cancelLink.cookie}`,
        'content-type': 'application/json',
        'x-aurora-csrf': cancelLink.csrf,
      },
      payload: JSON.stringify({ currentPassword: PASSWORD, idempotencyKey: randomUUID() }),
    });
    expect(cancel.statusCode).toBe(409);
    expect(problemBodyOf(cancel).code).toBe('state_machine_conflict');

    // The finalization guard inside the cancel path runs first: the account is
    // past the deadline and no longer owner-blocked, so it advances to
    // `terminated` (the point of no return), and the cancel is rejected 409.
    const accountRow = await pool.query<{ status: string }>(
      'SELECT status FROM accounts WHERE account_id = $1',
      [actorA.accountId],
    );
    expect(accountRow.rows[0]?.status).toBe('terminated');
    const terminatedHandoff = await pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM account_cleanup_handoffs WHERE account_id = $1',
      [actorA.accountId],
    );
    expect(terminatedHandoff.rows[0]?.n).toBe(1);
    await lateApp.close();
    await app.close();
  });

  it('cancel with the wrong current password returns 403 authorization', async () => {
    const app = buildApp();
    const email = `cancelwp-${randomUUID()}@example.com`;
    const actor = await registerVerifiedActor(app, pool, email);

    const intent = await establishRequestIntent(app, pool, actor.accountId);
    const del = await requestDelete(app, actor, intent);
    expect(del.status).toBe(200);

    const cancelToken = await cancelIntentToken(pool, actor.accountId);
    const cancelLink = await establishIntentLink(
      app,
      '/api/platform/v1/account/deletion/cancel/intent',
      cancelToken,
    );
    const cancel = await app.inject({
      method: 'POST',
      url: '/api/platform/v1/account/deletion/cancel',
      headers: {
        cookie: `aurora_intent=${cancelLink.cookie}`,
        'content-type': 'application/json',
        'x-aurora-csrf': cancelLink.csrf,
      },
      payload: JSON.stringify({ currentPassword: 'wrong-password!', idempotencyKey: randomUUID() }),
    });
    expect(cancel.statusCode).toBe(403);
    expect(problemBodyOf(cancel).code).toBe('authorization');
    await app.close();
  });

  it('kept_cooling at deadline: a unique-owner org freezes finalization and cancel stays usable', async () => {
    const app = buildApp();
    const email = `keepcool-${randomUUID()}@example.com`;
    const actor = await registerVerifiedActor(app, pool, email);

    // Real flow into cooling (no org yet, so the delete command owner re-check passes).
    const intent = await establishRequestIntent(app, pool, actor.accountId);
    const del = await requestDelete(app, actor, intent);
    expect(del.status).toBe(200);

    // Make the account the unique owner of an organization AFTER entering cooling.
    await createOrganization(pool, actor.accountId, 'Owner-Blocking Org');

    // Advance past the 168h deadline.
    const lateNow = new Date(FIXED_NOW.getTime() + COOLING_MS + 60_000);
    const lateApp = buildApp({ now: lateNow });
    const lateSession = await createSession(sessionStore, {
      accountId: actor.accountId,
      authLevel: 'authenticated',
      now: lateNow,
      idleMs: 30 * 60 * 1000,
      absoluteMs: 8 * 60 * 60 * 1000,
    });

    // Attempt 1 (preflight): the finalization re-check keeps the account cooling
    // because it is still the unique owner; the preflight still reports the blocker.
    const p1 = await lateApp.inject({
      method: 'GET',
      url: '/api/platform/v1/account/deletion/preflight',
      headers: { cookie: `aurora_session=${lateSession.cookieValue}` },
    });
    expect(p1.statusCode).toBe(200);
    expect(preflightBodyOf(p1).status).toBe('blocked');

    // Attempt 2 (re-trigger): the kept_cooling no-op rolled back (nothing was
    // cached), so the finalization re-evaluates and stays blocked — the account
    // is still the unique owner (spec §4.2 re-evaluate-on-each-trigger).
    const p2 = await lateApp.inject({
      method: 'GET',
      url: '/api/platform/v1/account/deletion/preflight',
      headers: { cookie: `aurora_session=${lateSession.cookieValue}` },
    });
    expect(p2.statusCode).toBe(200);
    expect(preflightBodyOf(p2).status).toBe('blocked');

    // A delete attempt at the deadline stays blocked: still in progress, not terminated.
    const delAgain = await lateApp.inject({
      method: 'POST',
      url: '/api/platform/v1/account/deletion',
      headers: {
        cookie: `aurora_session=${lateSession.cookieValue}`,
        'content-type': 'application/json',
        'x-aurora-csrf': lateSession.csrfSecret,
      },
      payload: JSON.stringify({ currentPassword: PASSWORD, idempotencyKey: randomUUID() }),
    });
    expect(delAgain.statusCode).toBe(409);
    expect(problemBodyOf(delAgain).code).toBe('state_machine_conflict');

    // No handoff was created — the account was never terminated.
    const handoffBefore = await pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM account_cleanup_handoffs WHERE account_id = $1',
      [actor.accountId],
    );
    expect(handoffBefore.rows[0]?.n).toBe(0);

    // Cancel at the deadline still works: an overdue + owner-blocked account stays
    // cancellable (spec §3/§4.2). The original 72h cancel intent has expired by the
    // deadline, so a fresh one is inserted directly.
    const { token, digest: cancelDigest } = createIntentToken();
    await insertDeletionIntent(pool, {
      accountId: actor.accountId,
      intentKind: 'deletion_cancel',
      tokenDigest: cancelDigest,
      expiresAt: new Date(lateNow.getTime() + 2 * 60 * 60 * 1000),
    });
    const cancelLink = await establishIntentLink(
      lateApp,
      '/api/platform/v1/account/deletion/cancel/intent',
      token,
    );
    const cancel = await lateApp.inject({
      method: 'POST',
      url: '/api/platform/v1/account/deletion/cancel',
      headers: {
        cookie: `aurora_intent=${cancelLink.cookie}`,
        'content-type': 'application/json',
        'x-aurora-csrf': cancelLink.csrf,
      },
      payload: JSON.stringify({ currentPassword: PASSWORD, idempotencyKey: randomUUID() }),
    });
    expect(cancel.statusCode).toBe(200);
    expect(deleteResponseOf(cancel).accountStatus).toBe('active');

    const accountRow = await pool.query<{ status: string }>(
      'SELECT status FROM accounts WHERE account_id = $1',
      [actor.accountId],
    );
    expect(accountRow.rows[0]?.status).toBe('active');
    const handoffAfter = await pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM account_cleanup_handoffs WHERE account_id = $1',
      [actor.accountId],
    );
    expect(handoffAfter.rows[0]?.n).toBe(0);
    await lateApp.close();
    await app.close();
  });

  it('kept_cooling at deadline re-evaluates after the owner block clears and finalizes (no stale cache)', async () => {
    const app = buildApp();
    const email = `unblock-${randomUUID()}@example.com`;
    const actor = await registerVerifiedActor(app, pool, email);

    // Real flow into cooling.
    const intent = await establishRequestIntent(app, pool, actor.accountId);
    const del = await requestDelete(app, actor, intent);
    expect(del.status).toBe(200);

    // Make the account the unique owner of an organization AFTER entering cooling,
    // then advance past the 168h deadline.
    const orgId = await createOrganization(pool, actor.accountId, 'Blocking Org');
    const lateNow = new Date(FIXED_NOW.getTime() + COOLING_MS + 60_000);
    const lateApp = buildApp({ now: lateNow });
    const lateSession = await createSession(sessionStore, {
      accountId: actor.accountId,
      authLevel: 'authenticated',
      now: lateNow,
      idleMs: 30 * 60 * 1000,
      absoluteMs: 8 * 60 * 60 * 1000,
    });

    // At the deadline the account is still the unique owner -> kept_cooling, no
    // handoff, and the idempotency record was rolled back (nothing cached).
    const p1 = await lateApp.inject({
      method: 'GET',
      url: '/api/platform/v1/account/deletion/preflight',
      headers: { cookie: `aurora_session=${lateSession.cookieValue}` },
    });
    expect(p1.statusCode).toBe(200);
    expect(preflightBodyOf(p1).status).toBe('blocked');
    const handoffBefore = await pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM account_cleanup_handoffs WHERE account_id = $1',
      [actor.accountId],
    );
    expect(handoffBefore.rows[0]?.n).toBe(0);

    // The block clears: a co-owner is added to the organization (B3 flow), so the
    // account is no longer the unique owner.
    const coOwner = await registerVerifiedActor(app, pool, `coowner-${randomUUID()}@example.com`);
    await pool.query(
      `INSERT INTO organization_members (organization_id, account_id, role)
       VALUES ($1, $2, 'owner')`,
      [orgId, coOwner.accountId],
    );

    // Re-trigger the preflight: the kept_cooling no-op was NOT replayed (it was
    // rolled back), so the finalization re-evaluates, the owner check now passes,
    // and the account advances to terminated with a durable handoff.
    const p2 = await lateApp.inject({
      method: 'GET',
      url: '/api/platform/v1/account/deletion/preflight',
      headers: { cookie: `aurora_session=${lateSession.cookieValue}` },
    });
    expect(p2.statusCode).toBe(200);
    expect(preflightBodyOf(p2).status).toBe('unavailable');

    const accountRow = await pool.query<{ status: string }>(
      'SELECT status FROM accounts WHERE account_id = $1',
      [actor.accountId],
    );
    expect(accountRow.rows[0]?.status).toBe('terminated');
    const handoffAfter = await pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM account_cleanup_handoffs WHERE account_id = $1',
      [actor.accountId],
    );
    expect(handoffAfter.rows[0]?.n).toBe(1);
    await lateApp.close();
    await app.close();
  });

  it('finalizes at the deadline when the owner re-check passes and the cancel is rejected (409)', async () => {
    const app = buildApp();
    const emailA = `final-a-${randomUUID()}@example.com`;
    const emailB = `final-b-${randomUUID()}@example.com`;
    const actorA = await registerVerifiedActor(app, pool, emailA);
    const actorB = await registerVerifiedActor(app, pool, emailB);

    // Real flow into cooling.
    const intent = await establishRequestIntent(app, pool, actorA.accountId);
    const del = await requestDelete(app, actorA, intent);
    expect(del.status).toBe(200);

    // A co-owned organization: actorA is an owner but NOT the unique owner, so the
    // final owner re-check passes and the account may be finalized.
    const orgId = await createOrganization(pool, actorA.accountId, 'Co-Owned Finalize');
    await pool.query(
      `INSERT INTO organization_members (organization_id, account_id, role)
       VALUES ($1, $2, 'owner')`,
      [orgId, actorB.accountId],
    );

    const lateNow = new Date(FIXED_NOW.getTime() + COOLING_MS + 60_000);
    const lateApp = buildApp({ now: lateNow });
    const { token, digest: cancelDigest } = createIntentToken();
    await insertDeletionIntent(pool, {
      accountId: actorA.accountId,
      intentKind: 'deletion_cancel',
      tokenDigest: cancelDigest,
      expiresAt: new Date(lateNow.getTime() + 2 * 60 * 60 * 1000),
    });
    const cancelLink = await establishIntentLink(
      lateApp,
      '/api/platform/v1/account/deletion/cancel/intent',
      token,
    );
    const cancel = await lateApp.inject({
      method: 'POST',
      url: '/api/platform/v1/account/deletion/cancel',
      headers: {
        cookie: `aurora_intent=${cancelLink.cookie}`,
        'content-type': 'application/json',
        'x-aurora-csrf': cancelLink.csrf,
      },
      payload: JSON.stringify({ currentPassword: PASSWORD, idempotencyKey: randomUUID() }),
    });
    expect(cancel.statusCode).toBe(409);
    expect(problemBodyOf(cancel).code).toBe('state_machine_conflict');

    // The account was terminated with the durable handoff persisted.
    const accountRow = await pool.query<{ status: string }>(
      'SELECT status FROM accounts WHERE account_id = $1',
      [actorA.accountId],
    );
    expect(accountRow.rows[0]?.status).toBe('terminated');
    const handoff = await pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM account_cleanup_handoffs WHERE account_id = $1',
      [actorA.accountId],
    );
    expect(handoff.rows[0]?.n).toBe(1);
    await lateApp.close();
    await app.close();
  });

  it('a request at the deadline finalizes the account and is rejected as already deleted (409)', async () => {
    const app = buildApp();
    const emailA = `reqfinal-a-${randomUUID()}@example.com`;
    const emailB = `reqfinal-b-${randomUUID()}@example.com`;
    const actorA = await registerVerifiedActor(app, pool, emailA);
    const actorB = await registerVerifiedActor(app, pool, emailB);

    const intent = await establishRequestIntent(app, pool, actorA.accountId);
    const del = await requestDelete(app, actorA, intent);
    expect(del.status).toBe(200);

    const orgId = await createOrganization(pool, actorA.accountId, 'Req Co-Owned');
    await pool.query(
      `INSERT INTO organization_members (organization_id, account_id, role)
       VALUES ($1, $2, 'owner')`,
      [orgId, actorB.accountId],
    );

    const lateNow = new Date(FIXED_NOW.getTime() + COOLING_MS + 60_000);
    const lateApp = buildApp({ now: lateNow });
    const lateSession = await createSession(sessionStore, {
      accountId: actorA.accountId,
      authLevel: 'authenticated',
      now: lateNow,
      idleMs: 30 * 60 * 1000,
      absoluteMs: 8 * 60 * 60 * 1000,
    });
    const request = await lateApp.inject({
      method: 'POST',
      url: '/api/platform/v1/account/deletion/request',
      headers: {
        cookie: `aurora_session=${lateSession.cookieValue}`,
        'content-type': 'application/json',
        'x-aurora-csrf': lateSession.csrfSecret,
      },
      payload: JSON.stringify({ idempotencyKey: randomUUID() }),
    });
    expect(request.statusCode).toBe(409);
    expect(problemBodyOf(request).code).toBe('state_machine_conflict');
    await lateApp.close();
    await app.close();
  });

  it('a delete at the deadline finalizes the account and is rejected as already deleted (409)', async () => {
    const app = buildApp();
    const emailA = `delfinal-a-${randomUUID()}@example.com`;
    const emailB = `delfinal-b-${randomUUID()}@example.com`;
    const actorA = await registerVerifiedActor(app, pool, emailA);
    const actorB = await registerVerifiedActor(app, pool, emailB);

    const intent = await establishRequestIntent(app, pool, actorA.accountId);
    const del = await requestDelete(app, actorA, intent);
    expect(del.status).toBe(200);

    // Co-owned org: actorA is not the unique owner, so finalization may advance.
    const orgId = await createOrganization(pool, actorA.accountId, 'Del Co-Owned');
    await pool.query(
      `INSERT INTO organization_members (organization_id, account_id, role)
       VALUES ($1, $2, 'owner')`,
      [orgId, actorB.accountId],
    );

    const lateNow = new Date(FIXED_NOW.getTime() + COOLING_MS + 60_000);
    const lateApp = buildApp({ now: lateNow });
    const lateSession = await createSession(sessionStore, {
      accountId: actorA.accountId,
      authLevel: 'authenticated',
      now: lateNow,
      idleMs: 30 * 60 * 1000,
      absoluteMs: 8 * 60 * 60 * 1000,
    });
    const delAgain = await lateApp.inject({
      method: 'POST',
      url: '/api/platform/v1/account/deletion',
      headers: {
        cookie: `aurora_session=${lateSession.cookieValue}`,
        'content-type': 'application/json',
        'x-aurora-csrf': lateSession.csrfSecret,
      },
      payload: JSON.stringify({ currentPassword: PASSWORD, idempotencyKey: randomUUID() }),
    });
    expect(delAgain.statusCode).toBe(409);
    expect(problemBodyOf(delAgain).code).toBe('state_machine_conflict');

    // The finalization guard advanced the account to terminated before rejecting.
    const accountRow = await pool.query<{ status: string }>(
      'SELECT status FROM accounts WHERE account_id = $1',
      [actorA.accountId],
    );
    expect(accountRow.rows[0]?.status).toBe('terminated');
    await lateApp.close();
    await app.close();
  });

  it('fails closed with 503 when a cancel post-commit session revoke hits a down authority', async () => {
    const app = buildApp();
    const email = `cancel503-${randomUUID()}@example.com`;
    const actor = await registerVerifiedActor(app, pool, email);
    const intent = await establishRequestIntent(app, pool, actor.accountId);
    const del = await requestDelete(app, actor, intent);
    expect(del.status).toBe(200);

    const downStore = await createSessionStore({
      url: redisUrl(),
      keyPrefix: `test:del-cancel503:${randomUUID()}`,
    });
    await downStore.client.quit();
    const downApp = buildApp({ sessionStore: downStore, now: FIXED_NOW });

    // The original 72h cancel intent is still valid within the cooling window.
    const cancelToken = await cancelIntentToken(pool, actor.accountId);
    const cancelLink = await establishIntentLink(
      downApp,
      '/api/platform/v1/account/deletion/cancel/intent',
      cancelToken,
    );
    const cancel = await downApp.inject({
      method: 'POST',
      url: '/api/platform/v1/account/deletion/cancel',
      headers: {
        cookie: `aurora_intent=${cancelLink.cookie}`,
        'content-type': 'application/json',
        'x-aurora-csrf': cancelLink.csrf,
      },
      payload: JSON.stringify({ currentPassword: PASSWORD, idempotencyKey: randomUUID() }),
    });
    expect(cancel.statusCode).toBe(503);
    expect(problemBodyOf(cancel).code).toBe('authority_unavailable');

    // The cancel transaction committed: the account is active again despite the 503.
    const accountRow = await pool.query<{ status: string }>(
      'SELECT status FROM accounts WHERE account_id = $1',
      [actor.accountId],
    );
    expect(accountRow.rows[0]?.status).toBe('active');
    await downApp.close();
    await app.close();
  });

  it('fails closed with 503 when a finalization revoke hits a down authority', async () => {
    const app = buildApp();
    const email = `final503-${randomUUID()}@example.com`;
    const actor = await registerVerifiedActor(app, pool, email);
    const intent = await establishRequestIntent(app, pool, actor.accountId);
    const del = await requestDelete(app, actor, intent);
    expect(del.status).toBe(200);

    const downStore = await createSessionStore({
      url: redisUrl(),
      keyPrefix: `test:del-final503:${randomUUID()}`,
    });
    await downStore.client.quit();
    const lateNow = new Date(FIXED_NOW.getTime() + COOLING_MS + 60_000);
    const downApp = buildApp({ sessionStore: downStore, now: lateNow });

    // A fresh cancel intent valid at the deadline (the original 72h one is expired).
    const { token, digest: cancelDigest } = createIntentToken();
    await insertDeletionIntent(pool, {
      accountId: actor.accountId,
      intentKind: 'deletion_cancel',
      tokenDigest: cancelDigest,
      expiresAt: new Date(lateNow.getTime() + 2 * 60 * 60 * 1000),
    });
    const cancelLink = await establishIntentLink(
      downApp,
      '/api/platform/v1/account/deletion/cancel/intent',
      token,
    );
    const cancel = await downApp.inject({
      method: 'POST',
      url: '/api/platform/v1/account/deletion/cancel',
      headers: {
        cookie: `aurora_intent=${cancelLink.cookie}`,
        'content-type': 'application/json',
        'x-aurora-csrf': cancelLink.csrf,
      },
      payload: JSON.stringify({ currentPassword: PASSWORD, idempotencyKey: randomUUID() }),
    });
    expect(cancel.statusCode).toBe(503);
    expect(problemBodyOf(cancel).code).toBe('authority_unavailable');

    // The finalization transaction committed (terminated + handoff) before the 503.
    const accountRow = await pool.query<{ status: string }>(
      'SELECT status FROM accounts WHERE account_id = $1',
      [actor.accountId],
    );
    expect(accountRow.rows[0]?.status).toBe('terminated');
    const handoff = await pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM account_cleanup_handoffs WHERE account_id = $1',
      [actor.accountId],
    );
    expect(handoff.rows[0]?.n).toBe(1);
    await downApp.close();
    await app.close();
  });

  it('fails closed with 503 when a delete post-commit session revoke hits a down authority', async () => {
    const app = buildApp();
    const email = `del503-${randomUUID()}@example.com`;
    const actor = await registerVerifiedActor(app, pool, email);
    const intent = await establishRequestIntent(app, pool, actor.accountId);

    // A store that resolves the session (so requireSession + CSRF pass) but fails
    // the revoke step — the delete command reaches its post-commit revoke.
    const csrfSecret = randomUUID();
    const stubStore = {
      keyPrefix: `test:del-revoke503:${randomUUID()}`,
      client: {
        // Deliberately synchronous so no `await` is required: `getSession` /
        // `revokeAllAccountSessions` await the results, so a sync value and a
        // sync throw behave identically (the throw propagates as a rejection).
        get: () =>
          JSON.stringify({
            accountId: actor.accountId,
            authLevel: 'authenticated',
            expiresAt: new Date(FIXED_NOW.getTime() + 8 * 60 * 60 * 1000).toISOString(),
            rotationDueAt: null,
            csrfSecret,
          }),
        sMembers: () => {
          throw new Error('session authority down');
        },
        del: () => {
          throw new Error('session authority down');
        },
        set: () => undefined,
        sAdd: () => undefined,
        quit: () => undefined,
        connect: () => undefined,
      },
    } as unknown as SessionStore;
    const stubApp = buildApp({ sessionStore: stubStore });

    const del = await stubApp.inject({
      method: 'POST',
      url: '/api/platform/v1/account/deletion',
      headers: {
        cookie: `aurora_session=stub-cookie; aurora_intent=${intent.cookie}`,
        'content-type': 'application/json',
        'x-aurora-csrf': csrfSecret,
      },
      payload: JSON.stringify({ currentPassword: PASSWORD, idempotencyKey: randomUUID() }),
    });
    expect(del.statusCode).toBe(503);
    expect(problemBodyOf(del).code).toBe('authority_unavailable');

    // The delete transaction committed: the account is in cooling despite the 503.
    const accountRow = await pool.query<{ status: string }>(
      'SELECT status FROM accounts WHERE account_id = $1',
      [actor.accountId],
    );
    expect(accountRow.rows[0]?.status).toBe('deletion_cooling');
    await stubApp.close();
    await app.close();
  });
});
