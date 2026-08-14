import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  consumeIntent,
  createIntentToken,
  findAccountByEmailNormalized,
  findPasswordResetIntentByDigest,
  getAccountById,
  hashPassword,
  incrementSecurityVersion,
  insertOutboxRow,
  insertPasswordResetIntent,
  normalizeEmail,
  upsertAccountCredential,
  verifyPassword,
} from '@aurora/platform-identity';
import { revokeAllAccountSessions } from '@aurora/platform-session';
import {
  OPERATION_ID_CHANGE_PASSWORD,
  OPERATION_ID_CONFIRM_PASSWORD_RESET,
  OPERATION_ID_REQUEST_PASSWORD_RESET,
} from '@aurora/platform-contract';
import { parseInput, serializeOutput, type OperationDef } from '@aurora/platform-contract/server';
import { operationById } from '../operations.js';
import { sendProblem } from '../error-mapper.js';
import { clearSessionCookie } from '../session-cookie.js';
import { clearIntentCookieOnReply } from '../intent-cookie.js';
import { maskEmail } from '../email-mask.js';
import {
  runIdempotentCommand,
  lookupIdempotency,
  requestDigest,
  type IdempotentCommandResult,
} from '../idempotency.js';
import { ServiceError, sendMappedError } from '../service-error.js';
import type { PlatformApiRouteDependencies } from '../route-deps.js';

const REQUEST_RESET_OPERATION: OperationDef = operationById(OPERATION_ID_REQUEST_PASSWORD_RESET);
const CONFIRM_RESET_OPERATION: OperationDef = operationById(OPERATION_ID_CONFIRM_PASSWORD_RESET);
const CHANGE_PASSWORD_OPERATION: OperationDef = operationById(OPERATION_ID_CHANGE_PASSWORD);

/** Password reset intent lifetime (minutes) — the value shown in the mail. */
const RESET_INTENT_MINUTES = 120;
const RESET_INTENT_TTL_MS = RESET_INTENT_MINUTES * 60 * 1000;

interface RequestResetBody {
  readonly email: string;
  readonly idempotencyKey: string;
}

interface ConfirmResetBody {
  readonly newPassword: string;
  readonly idempotencyKey: string;
}

interface ChangePasswordBody {
  readonly currentPassword: string;
  readonly newPassword: string;
  readonly idempotencyKey: string;
}

/** SHA-256 hex digest of a transient intent token (matches platform-identity). */
function digestOf(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Shared outbox row for a reset email (payload shape matches platform-email). */
async function insertResetOutboxRow(
  client: PoolClient,
  input: {
    accountId: string;
    toAddress: string;
    token: string;
    expiresInMinutes: number;
    intentExpiresAt: Date;
    /** Public console origin; emailed links land on the SPA confirm page. */
    consoleOrigin: string;
  },
): Promise<void> {
  const base = input.consoleOrigin.replace(/\/$/, '');
  await insertOutboxRow(client, {
    aggregateType: 'email.password_reset',
    aggregateId: input.accountId,
    payload: {
      intentType: 'password_reset',
      toAddress: input.toAddress,
      toMasked: maskEmail(input.toAddress),
      mailLinkUrl: `${base}/reset-password?token=${input.token}`,
      expiresInMinutes: input.expiresInMinutes,
      intentExpiresAt: input.intentExpiresAt.toISOString(),
    },
  });
}

/**
 * POST /api/platform/v1/auth/password/request — A3. Enumeration-safe: returns
 * the SAME uniform response whether or not the account exists. When the account
 * exists, a password_reset_intent + outbox row (mailLinkUrl with the transient
 * token) are written atomically with the idempotency record.
 */
export async function handleRequestPasswordReset(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();
  const now = deps.now();

  const parsed = parseInput(REQUEST_RESET_OPERATION, { body: request.body });
  if (!parsed.ok) {
    await sendProblem(
      reply,
      requestId,
      400,
      'structural_error',
      'Request does not match the public contract.',
    );
    return;
  }
  const input = parsed.data.body as RequestResetBody;
  const emailNormalized = normalizeEmail(input.email);

  const rate = deps.rateLimiter.check(
    `${OPERATION_ID_REQUEST_PASSWORD_RESET}:${request.ip}:${emailNormalized}`,
    now.getTime(),
  );
  if (!rate.allowed) {
    await sendProblem(reply, requestId, 429, 'rate_limited', 'Too many reset requests.', {
      ...(rate.retryAfterSeconds === undefined ? {} : { retryAfter: rate.retryAfterSeconds }),
    });
    return;
  }

  let account;
  try {
    account = await findAccountByEmailNormalized(deps.pool, emailNormalized);
  } catch {
    await sendProblem(
      reply,
      requestId,
      503,
      'authority_unavailable',
      'Account store is temporarily unavailable.',
    );
    return;
  }

  let idempotency: IdempotentCommandResult;
  try {
    idempotency = await runIdempotentCommand({
      pool: deps.pool,
      key: input.idempotencyKey,
      operation: OPERATION_ID_REQUEST_PASSWORD_RESET,
      digest: requestDigest({ ...input, emailNormalized }),
      execute: async (client) => {
        if (account !== null) {
          const { token, digest } = createIntentToken();
          const expiresAt = new Date(now.getTime() + RESET_INTENT_TTL_MS);
          await insertPasswordResetIntent(client, {
            accountId: account.accountId,
            tokenDigest: digest,
            expiresAt,
          });
          await insertResetOutboxRow(client, {
            accountId: account.accountId,
            toAddress: emailNormalized,
            token,
            expiresInMinutes: RESET_INTENT_MINUTES,
            intentExpiresAt: expiresAt,
            consoleOrigin: deps.config.consoleOrigin,
          });
        }
        // Uniform response — never reveals account existence (anti-enumeration).
        return { serverTime: now.toISOString() };
      },
    });
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }

  if (idempotency.outcome === 'conflict') {
    await sendProblem(reply, requestId, 409, 'idempotency_conflict', 'Idempotency key conflict.');
    return;
  }

  const serialized = serializeOutput(REQUEST_RESET_OPERATION, 200, idempotency.resultData);
  if (!serialized.ok) {
    await sendProblem(reply, requestId, 500, 'internal_error', 'An internal error occurred.');
    return;
  }
  void reply.header('x-aurora-request-id', requestId).code(200).send(serialized.body);
}

/**
 * POST /api/platform/v1/auth/password/confirm — A3. Intent-authLevel + CSRF
 * (enforced by the plugins). Validates the password-reset intent (present,
 * unexpired, unconsumed) and atomically { consumeIntent +
 * upsertAccountCredential(new hash) + incrementSecurityVersion + idempotency }.
 * Then revokes ALL of the account's sessions (ADR-030 决定细节 3). Never
 * auto-logs-in — the client is sent to /login.
 */
export async function handleConfirmPasswordReset(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();
  const now = deps.now();

  const parsed = parseInput(CONFIRM_RESET_OPERATION, { body: request.body });
  if (!parsed.ok) {
    await sendProblem(
      reply,
      requestId,
      400,
      'structural_error',
      'Request does not match the public contract.',
    );
    return;
  }
  const input = parsed.data.body as ConfirmResetBody;

  const intentPayload = request.intentPayload;
  if (intentPayload?.kind !== 'password_reset') {
    await sendProblem(reply, requestId, 404, 'not_found', 'The reset intent was not found.');
    return;
  }

  let intent;
  try {
    intent = await findPasswordResetIntentByDigest(deps.pool, digestOf(intentPayload.token));
  } catch {
    await sendProblem(
      reply,
      requestId,
      503,
      'authority_unavailable',
      'Account store is temporarily unavailable.',
    );
    return;
  }
  if (intent === null) {
    await sendProblem(reply, requestId, 404, 'not_found', 'The reset intent was not found.');
    return;
  }

  let newHash: string;
  try {
    newHash = await hashPassword(input.newPassword);
  } catch {
    await sendProblem(reply, requestId, 500, 'internal_error', 'An internal error occurred.');
    return;
  }

  let accountId = intent.accountId;
  let idempotency: IdempotentCommandResult;
  try {
    idempotency = await runIdempotentCommand({
      pool: deps.pool,
      key: input.idempotencyKey,
      operation: OPERATION_ID_CONFIRM_PASSWORD_RESET,
      digest: requestDigest(input),
      execute: async (client) => {
        const consumed = await consumeIntent(client, {
          kind: 'password_reset',
          intentId: intent.intentId,
          now,
        });
        if (consumed.status === 'already_consumed' || consumed.status === 'expired') {
          throw new ServiceError(
            409,
            'business_validation',
            'The reset intent is no longer valid.',
          );
        }
        if (consumed.status === 'not_found') {
          throw new ServiceError(404, 'not_found', 'The reset intent was not found.');
        }

        const account = await getAccountById(client, accountId);
        if (account === null) {
          throw new ServiceError(404, 'not_found', 'The account was not found.');
        }
        accountId = account.accountId;

        await upsertAccountCredential(client, {
          accountId,
          passwordHash: newHash,
          passwordVersion: (account.passwordVersion ?? 1) + 1,
        });
        await incrementSecurityVersion(client, accountId);

        return { status: 'succeeded' as const, serverTime: now.toISOString() };
      },
    });
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }

  if (idempotency.outcome === 'conflict') {
    await sendProblem(reply, requestId, 409, 'idempotency_conflict', 'Idempotency key conflict.');
    return;
  }

  // Revoke all of the account's sessions (both fresh and replay converge).
  try {
    await revokeAllAccountSessions(deps.sessionStore, accountId);
  } catch {
    await sendProblem(
      reply,
      requestId,
      503,
      'authority_unavailable',
      'Session authority is temporarily unavailable.',
    );
    return;
  }

  clearIntentCookieOnReply(reply, deps.cookieOptions);

  const serialized = serializeOutput(CONFIRM_RESET_OPERATION, 200, idempotency.resultData);
  if (!serialized.ok) {
    await sendProblem(reply, requestId, 500, 'internal_error', 'An internal error occurred.');
    return;
  }
  void reply.header('x-aurora-request-id', requestId).code(200).send(serialized.body);
}

/**
 * POST /api/platform/v1/auth/password/change — A5. Session-authLevel + CSRF
 * (enforced by the plugins). Verifies the current password, then atomically
 * { upsertAccountCredential(new hash) + incrementSecurityVersion + idempotency }
 * and revokes ALL of the account's sessions. The user must re-login
 * (`sessionImpact: 'revoked_all'`).
 */
export async function handleChangePassword(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();

  const parsed = parseInput(CHANGE_PASSWORD_OPERATION, { body: request.body });
  if (!parsed.ok) {
    await sendProblem(
      reply,
      requestId,
      400,
      'structural_error',
      'Request does not match the public contract.',
    );
    return;
  }
  const input = parsed.data.body as ChangePasswordBody;
  const session = request.sessionPayload;
  if (session === null) {
    await sendProblem(reply, requestId, 401, 'authentication', 'Authentication is required.', {
      recoveryTarget: 'auth.login',
    });
    return;
  }

  let account;
  try {
    account = await getAccountById(deps.pool, session.accountId);
  } catch {
    await sendProblem(
      reply,
      requestId,
      503,
      'authority_unavailable',
      'Account store is temporarily unavailable.',
    );
    return;
  }
  if (account === null) {
    await sendProblem(reply, requestId, 401, 'authentication', 'Authentication is required.', {
      recoveryTarget: 'auth.login',
    });
    return;
  }

  const currentOk = await verifyPassword(input.currentPassword, account.passwordHash ?? '');
  if (!currentOk) {
    await sendProblem(
      reply,
      requestId,
      403,
      'authorization',
      'Current password verification failed.',
    );
    return;
  }

  // Idempotency convergence: probe BEFORE hashing/verifying again so a same-key
  // retry after a committed change returns the replayed first result instead of
  // a misleading 403 (the old password no longer matches). Run the probe on the
  // read pool; runIdempotentCommand re-probes atomically inside the txn.
  const accountId = account.accountId;
  const probeDigest = requestDigest(input);
  const probe = await lookupIdempotency(deps.pool, input.idempotencyKey, probeDigest);
  if (probe.outcome === 'replay') {
    await revokeAllAccountSessions(deps.sessionStore, accountId);
    clearSessionCookie(reply, deps.cookieOptions);
    const serialized = serializeOutput(CHANGE_PASSWORD_OPERATION, 200, probe.resultData);
    if (!serialized.ok) {
      await sendProblem(reply, requestId, 500, 'internal_error', 'An internal error occurred.');
      return;
    }
    void reply.header('x-aurora-request-id', requestId).code(200).send(serialized.body);
    return;
  }
  if (probe.outcome === 'conflict') {
    await sendProblem(
      reply,
      requestId,
      409,
      'idempotency_conflict',
      'Idempotency key was used with a different request.',
    );
    return;
  }

  let newHash: string;
  try {
    newHash = await hashPassword(input.newPassword);
  } catch {
    await sendProblem(reply, requestId, 500, 'internal_error', 'An internal error occurred.');
    return;
  }

  let idempotency: IdempotentCommandResult;
  try {
    idempotency = await runIdempotentCommand({
      pool: deps.pool,
      key: input.idempotencyKey,
      operation: OPERATION_ID_CHANGE_PASSWORD,
      digest: probeDigest,
      execute: async (client) => {
        await upsertAccountCredential(client, {
          accountId,
          passwordHash: newHash,
          passwordVersion: (account.passwordVersion ?? 1) + 1,
        });
        await incrementSecurityVersion(client, accountId);
        return { status: 'succeeded' as const, sessionImpact: 'revoked_all' as const };
      },
    });
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }

  if (idempotency.outcome === 'conflict') {
    await sendProblem(reply, requestId, 409, 'idempotency_conflict', 'Idempotency key conflict.');
    return;
  }

  try {
    await revokeAllAccountSessions(deps.sessionStore, accountId);
  } catch {
    await sendProblem(
      reply,
      requestId,
      503,
      'authority_unavailable',
      'Session authority is temporarily unavailable.',
    );
    return;
  }

  // The current session was just revoked; clear the cookie so the client does
  // not keep presenting an invalid credential.
  clearSessionCookie(reply, deps.cookieOptions);

  const serialized = serializeOutput(CHANGE_PASSWORD_OPERATION, 200, idempotency.resultData);
  if (!serialized.ok) {
    await sendProblem(reply, requestId, 500, 'internal_error', 'An internal error occurred.');
    return;
  }
  void reply.header('x-aurora-request-id', requestId).code(200).send(serialized.body);
}
