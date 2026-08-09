import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { extractSessionCookie } from './helpers.js';

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
export async function registerActor(
  app: FastifyInstance,
  email: string,
): Promise<RegisteredActor> {
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

/** Convenience POST with session cookie + CSRF header (for CSRF-protected ops). */
export async function postJson(
  app: FastifyInstance,
  url: string,
  cookie: string,
  csrf: string,
  payload: object,
): Promise<{ status: number; body: unknown }> {
  const response = await app.inject({
    method: 'POST',
    url,
    headers: {
      cookie: `aurora_session=${cookie}`,
      'content-type': 'application/json',
      'x-aurora-csrf': csrf,
    },
    payload: JSON.stringify(payload),
  });
  return { status: response.statusCode, body: response.json() };
}
