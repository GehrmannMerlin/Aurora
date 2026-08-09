import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { extractSessionCookie, outboxIntentToken } from './helpers.js';

/** A freshly registered account plus its session and personal workspace. */
export interface RegisteredActor {
  readonly cookie: string;
  readonly csrf: string;
  readonly accountId: string;
  /** The account's personal workspace (owner). */
  readonly organizationId: string;
}

/** Resolve the CSRF token bound to the session cookie (GET /session). */
export async function csrfFor(app: FastifyInstance, cookie: string): Promise<string> {
  const session = await app.inject({
    method: 'GET',
    url: '/api/platform/v1/session',
    headers: { cookie: `aurora_session=${cookie}` },
  });
  if (session.statusCode !== 200) {
    throw new Error(`GET /session failed with ${session.statusCode}`);
  }
  const body = session.json() as { csrf?: string };
  const csrf = body.csrf;
  if (typeof csrf !== 'string' || csrf.length === 0) {
    throw new Error('no csrf token in session response');
  }
  return csrf;
}

/**
 * Register a fresh account through the public register route (which creates the
 * personal workspace and establishes a session) and return the session cookie,
 * bound CSRF token, accountId and personal-org organizationId.
 */
export async function registerActor(app: FastifyInstance, email: string): Promise<RegisteredActor> {
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
  if (response.statusCode !== 200) {
    throw new Error(`register failed with ${response.statusCode}`);
  }
  const cookie = extractSessionCookie(response.headers['set-cookie']);
  const body = response.json() as { accountId: string; workspaceId: { organizationId: string } };
  const csrf = await csrfFor(app, cookie);
  return {
    cookie,
    csrf,
    accountId: body.accountId,
    organizationId: body.workspaceId.organizationId,
  };
}

/**
 * Register a fresh account AND complete its email verification, returning the
 * ROTATED `authenticated` session (the confirm POST rotates the pending-
 * verification session and reissues the HttpOnly cookie, so the returned cookie
 * is the post-rotation one and the CSRF token is re-fetched against it).
 *
 * PRD §4.1 gates B3 invitations and B6 private-token creation on a verified
 * email, so the B3/B6 flow tests create their acting owner through this helper.
 * Requires the same `pool` used for the suite so it can read the verification
 * intent token out of the outbox (mirrors email-verification-flow.test.ts).
 */
export async function registerVerifiedActor(
  app: FastifyInstance,
  pool: Pool,
  email: string,
): Promise<RegisteredActor> {
  const pending = await registerActor(app, email);

  const token = await outboxIntentToken(pool, 'email.verification');
  const link = await app.inject({ method: 'GET', url: `/api/platform/v1/auth/verify/${token}` });
  if (link.statusCode !== 200) {
    throw new Error(`verify link failed with ${link.statusCode}`);
  }
  const linkBody = link.json() as { csrf?: string };
  const linkCsrf = linkBody.csrf;
  if (typeof linkCsrf !== 'string' || linkCsrf.length === 0) {
    throw new Error('no csrf in verify link response');
  }
  const setCookie = link.headers['set-cookie'];
  const cookieValue = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const intentMatch = /^aurora_intent=([^;]+)/.exec(cookieValue ?? '');
  const intentCookie = intentMatch?.[1];
  if (intentCookie === undefined) {
    throw new Error('no aurora_intent cookie in verify link response');
  }

  const confirm = await app.inject({
    method: 'POST',
    url: '/api/platform/v1/auth/email/confirm',
    headers: {
      cookie: `aurora_session=${pending.cookie}; aurora_intent=${intentCookie}`,
      'content-type': 'application/json',
      'x-aurora-csrf': linkCsrf,
    },
    payload: JSON.stringify({ idempotencyKey: randomUUID() }),
  });
  if (confirm.statusCode !== 200) {
    throw new Error(`email confirm failed with ${confirm.statusCode}`);
  }
  const rotatedCookie = extractSessionCookie(confirm.headers['set-cookie']);
  const csrf = await csrfFor(app, rotatedCookie);
  return {
    cookie: rotatedCookie,
    csrf,
    accountId: pending.accountId,
    organizationId: pending.organizationId,
  };
}
