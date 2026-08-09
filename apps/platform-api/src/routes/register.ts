import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  createAccount,
  createIntentToken,
  createPersonalOrganization,
  hashPassword,
  insertEmailVerificationIntent,
  insertOutboxRow,
  normalizeEmail,
} from '@aurora/platform-identity';
import { createSession } from '@aurora/platform-session';
import { OPERATION_ID_REGISTER } from '@aurora/platform-contract';
import { parseInput, serializeOutput, type OperationDef } from '@aurora/platform-contract/server';
import { operationById } from '../operations.js';
import { sendProblem } from '../error-mapper.js';
import { setSessionCookie } from '../session-cookie.js';
import { maskEmail } from '../email-mask.js';
import {
  runIdempotentCommand,
  requestDigest,
  type IdempotentCommandResult,
} from '../idempotency.js';
import { ServiceError, sendMappedError } from '../service-error.js';
import type { PlatformApiRouteDependencies } from '../route-deps.js';

const REGISTER_OPERATION: OperationDef = operationById(OPERATION_ID_REGISTER);

/** Email verification intent lifetime (minutes) — the value shown in the mail. */
const VERIFY_INTENT_MINUTES = 120;
const VERIFY_INTENT_TTL_MS = VERIFY_INTENT_MINUTES * 60 * 1000;

interface RegisterBody {
  readonly email: string;
  readonly password: string;
  readonly idempotencyKey: string;
}

/**
 * POST /api/platform/v1/auth/register — full A1 flow:
 *
 * Argon2id hash -> ONE atomic transaction { createAccount + credential +
 * createPersonalOrganization(owner) + insertEmailVerificationIntent +
 * insertOutboxRow(verification mail, mailLinkUrl embedding the transient
 * token) + idempotency record } -> Redis session -> HttpOnly cookie ->
 * `identityRegisterResponse`.
 *
 * - Idempotency: same key + same request replays the first result (and
 *   re-establishes a session so a lost response converges); same key + a
 *   different request -> 409 idempotency_conflict.
 * - Redis down after the transaction commits -> consistent 503
 *   authority_unavailable; a same-key retry replays and creates the session.
 * - Duplicate email -> 409 business_validation (spec §9).
 * - In-memory rate limit per (operation, IP, email-normalized) -> 429.
 */
export async function handleRegister(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();
  const now = deps.now();

  const parsed = parseInput(REGISTER_OPERATION, { body: request.body });
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
  const input = parsed.data.body as RegisterBody;
  const emailNormalized = normalizeEmail(input.email);

  const rate = deps.rateLimiter.check(
    `${OPERATION_ID_REGISTER}:${request.ip}:${emailNormalized}`,
    now.getTime(),
  );
  if (!rate.allowed) {
    await sendProblem(reply, requestId, 429, 'rate_limited', 'Too many registration attempts.', {
      ...(rate.retryAfterSeconds === undefined ? {} : { retryAfter: rate.retryAfterSeconds }),
    });
    return;
  }

  let passwordHash: string;
  try {
    passwordHash = await hashPassword(input.password);
  } catch {
    await sendProblem(reply, requestId, 500, 'internal_error', 'An internal error occurred.');
    return;
  }

  let idempotency: IdempotentCommandResult;
  try {
    idempotency = await runIdempotentCommand({
      pool: deps.pool,
      key: input.idempotencyKey,
      operation: OPERATION_ID_REGISTER,
      digest: requestDigest({ ...input, emailNormalized }),
      execute: async (client) => {
        const account = await createAccount(client, {
          email: input.email,
          emailNormalized,
          passwordHash,
          status: 'pending_verification',
        });
        if (account.status === 'conflict') {
          throw new ServiceError(
            409,
            'business_validation',
            'An account with this email already exists.',
          );
        }
        const workspace = await createPersonalOrganization(client, {
          name: 'My Workspace',
          accountId: account.account.accountId,
        });
        if (workspace.status === 'conflict') {
          throw new ServiceError(409, 'business_validation', 'Workspace creation failed.');
        }

        const { token, digest } = createIntentToken();
        const expiresAt = new Date(now.getTime() + VERIFY_INTENT_TTL_MS);
        await insertEmailVerificationIntent(client, {
          accountId: account.account.accountId,
          tokenDigest: digest,
          expiresAt,
        });

        const masked = maskEmail(emailNormalized);
        const base = deps.config.consoleOrigin.replace(/\/$/, '');
        await insertOutboxRow(client, {
          aggregateType: 'email.verification',
          aggregateId: account.account.accountId,
          payload: {
            intentType: 'email_verification',
            toAddress: emailNormalized,
            toMasked: masked,
            mailLinkUrl: `${base}/verify-email/confirm?token=${token}`,
            expiresInMinutes: VERIFY_INTENT_MINUTES,
          },
        });

        return {
          accountId: account.account.accountId,
          workspaceId: { organizationId: workspace.organizationId },
          emailMasked: masked,
          verificationStatus: { verified: false, reason: 'email_verification_pending' },
          serverTime: now.toISOString(),
        };
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

  const response = idempotency.resultData as {
    accountId: string;
    workspaceId: { organizationId: string };
    emailMasked: string;
    verificationStatus: { verified: false; reason: string };
    serverTime: string;
  };

  // Establish the session (Redis). Both a fresh run and a replay create a fresh
  // session so a lost-response retry ends up authenticated.
  let session;
  try {
    session = await createSession(deps.sessionStore, {
      accountId: response.accountId,
      authLevel: 'pending_verification',
      now,
      idleMs: deps.config.sessionIdleMs,
      absoluteMs: deps.config.sessionAbsoluteMs,
    });
  } catch {
    // Redis is the session authority; fail closed with a consistent 503
    // (ADR-028 决定细节 7, PLT-03 Task 7 carry-forward).
    await sendProblem(
      reply,
      requestId,
      503,
      'authority_unavailable',
      'Session authority is temporarily unavailable.',
    );
    return;
  }

  setSessionCookie(reply, session.cookieValue, deps.cookieOptions);

  const serialized = serializeOutput(REGISTER_OPERATION, 200, response);
  if (!serialized.ok) {
    await sendProblem(reply, requestId, 500, 'internal_error', 'An internal error occurred.');
    return;
  }
  void reply.header('x-aurora-request-id', requestId).code(200).send(serialized.body);
}

// Re-exported for the existing unit test (kept importable from routes/register.js).
export { maskEmail } from '../email-mask.js';
