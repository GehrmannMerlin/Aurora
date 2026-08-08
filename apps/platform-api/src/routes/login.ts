import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  findAccountByEmailNormalized,
  normalizeEmail,
  verifyPassword,
  type AccountRow,
} from '@aurora/platform-identity';
import { createSession, rotateSession, type SessionAuthLevel } from '@aurora/platform-session';
import { OPERATION_ID_LOGIN } from '@aurora/platform-contract';
import { parseInput, serializeOutput, type OperationDef } from '@aurora/platform-contract/server';
import { operationById } from '../operations.js';
import { sendProblem } from '../error-mapper.js';
import { setSessionCookie } from '../session-cookie.js';
import { runIdempotentCommand, requestDigest, type IdempotentCommandResult } from '../idempotency.js';
import { sendMappedError } from '../service-error.js';
import type { PlatformApiRouteDependencies } from '../route-deps.js';

const LOGIN_OPERATION: OperationDef = operationById(OPERATION_ID_LOGIN);

interface LoginBody {
  readonly email: string;
  readonly password: string;
  readonly idempotencyKey: string;
}

interface LoginCommandResult {
  readonly account: { accountId: string; email: string; verified: boolean };
  readonly authentication: 'pending_verification' | 'authenticated' | 'restricted';
  readonly navigation: { navigationTargets: { routeId: string; pathParams: Record<string, string>; query: Record<string, string> } };
  readonly continuation?: { target: { routeId: string; pathParams: Record<string, string>; query: Record<string, string> }; kind: 'invitation' | 'return_to' };
}

/** Uniform unauthenticated failure — identical for nonexistent and wrong-password (anti-enumeration). */
async function sendAuthenticationFailed(reply: FastifyReply, requestId: string): Promise<FastifyReply> {
  return sendProblem(reply, requestId, 401, 'authentication', 'Invalid email or password.', {
    recoveryTarget: 'auth.login',
  });
}

/**
 * POST /api/platform/v1/auth/login — A2. Finds the account by normalized email
 * and verifies the Argon2id password. Nonexistent account and wrong password
 * return the SAME 401 (uniform, anti-enumeration). On success a session is
 * created (or the pre-existing one is rotated — ADR-030 决定细节 3), the cookie
 * is set, and `identityLoginResponse` is returned with a safe continuation:
 * a this-visit invitation intent routes to `invitation.accept`, otherwise no
 * continuation (the client defaults to /workspace).
 */
export async function handleLogin(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();
  const now = deps.now();

  const parsed = parseInput(LOGIN_OPERATION, { body: request.body });
  if (!parsed.ok) {
    await sendProblem(reply, requestId, 400, 'structural_error', 'Request does not match the public contract.');
    return;
  }
  const input = parsed.data.body as LoginBody;
  const emailNormalized = normalizeEmail(input.email);

  const rate = deps.rateLimiter.check(
    `${OPERATION_ID_LOGIN}:${request.ip}:${emailNormalized}`,
    now.getTime(),
  );
  if (!rate.allowed) {
    await sendProblem(reply, requestId, 429, 'rate_limited', 'Too many login attempts.', {
      ...(rate.retryAfterSeconds === undefined ? {} : { retryAfter: rate.retryAfterSeconds }),
    });
    return;
  }

  let account: AccountRow | null;
  try {
    account = await findAccountByEmailNormalized(deps.pool, emailNormalized);
  } catch {
    await sendProblem(reply, requestId, 503, 'authority_unavailable', 'Account store is temporarily unavailable.');
    return;
  }

  if (account !== null) {
    const passwordOk = await verifyPassword(input.password, account.passwordHash ?? '');
    if (!passwordOk) {
      await sendAuthenticationFailed(reply, requestId);
      return;
    }
  } else {
    // Uniform timing/failure: still burn an Argon2id verify for a nonexistent
    // account so the response is indistinguishable from a wrong password.
    await verifyPassword(input.password, '$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    await sendAuthenticationFailed(reply, requestId);
    return;
  }

  const commandResult = buildLoginCommandResult(account, request);

  let idempotency: IdempotentCommandResult;
  try {
    idempotency = await runIdempotentCommand({
      pool: deps.pool,
      key: input.idempotencyKey,
      operation: OPERATION_ID_LOGIN,
      digest: requestDigest({ ...input, emailNormalized }),
      execute: async () => commandResult,
    });
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }

  if (idempotency.outcome === 'conflict') {
    await sendProblem(reply, requestId, 409, 'idempotency_conflict', 'Idempotency key conflict.');
    return;
  }

  const stored = idempotency.resultData as LoginCommandResult;
  const authLevel = stored.authentication as SessionAuthLevel;

  // Create a fresh session, or rotate the pre-existing one on login
  // (ADR-030 决定细节 3: login rotates the session id).
  let session: { cookieValue: string; expiresAt: string; csrfSecret: string };
  try {
    const sessionInput = {
      accountId: stored.account.accountId,
      authLevel,
      now,
      idleMs: deps.config.sessionIdleMs,
      absoluteMs: deps.config.sessionAbsoluteMs,
    };
    if (request.sessionCookieValue !== null && request.sessionPayload !== null) {
      const rotated = await rotateSession(deps.sessionStore, request.sessionCookieValue, now, sessionInput);
      if (rotated === null) {
        session = await createSession(deps.sessionStore, sessionInput);
      } else {
        session = rotated;
      }
    } else {
      session = await createSession(deps.sessionStore, sessionInput);
    }
  } catch {
    await sendProblem(reply, requestId, 503, 'authority_unavailable', 'Session authority is temporarily unavailable.');
    return;
  }

  setSessionCookie(reply, session.cookieValue, deps.cookieOptions);

  const response = {
    account: stored.account,
    authentication: stored.authentication,
    session: {
      expiresAt: session.expiresAt,
    },
    csrf: session.csrfSecret,
    navigation: stored.navigation,
    ...(stored.continuation === undefined ? {} : { continuation: stored.continuation }),
  };

  const serialized = serializeOutput(LOGIN_OPERATION, 200, response);
  if (!serialized.ok) {
    await sendProblem(reply, requestId, 500, 'internal_error', 'An internal error occurred.');
    return;
  }
  void reply.header('x-aurora-request-id', requestId).code(200).send(serialized.body);
}

/** Build the idempotent login command result (session-independent parts). */
function buildLoginCommandResult(account: AccountRow, request: FastifyRequest): LoginCommandResult {
  const verified = account.verifiedAt !== null;
  const authentication = verified ? 'authenticated' : 'pending_verification';
  const navigationTarget = verified
    ? { routeId: 'workspace.home', pathParams: {}, query: {} }
    : { routeId: 'auth.verify-email', pathParams: {}, query: {} };

  // A this-visit invitation intent routes the user to the invitation-accept page
  // after login; otherwise no continuation (the client defaults to /workspace).
  const continuation =
    request.intentPayload?.kind === 'organization_invitation'
      ? { target: { routeId: 'invitation.accept', pathParams: {}, query: {} }, kind: 'invitation' as const }
      : undefined;

  return {
    account: {
      accountId: account.accountId,
      email: account.email,
      verified,
    },
    authentication,
    navigation: { navigationTargets: navigationTarget },
    ...(continuation === undefined ? {} : { continuation }),
  };
}
