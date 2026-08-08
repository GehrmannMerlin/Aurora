import { createHash } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  consumeIntent,
  findEmailVerificationIntentByDigest,
  getAccountById,
  updateAccountVerifiedAt,
} from '@aurora/platform-identity';
import { createSession, rotateSession } from '@aurora/platform-session';
import { OPERATION_ID_CONFIRM_EMAIL_VERIFICATION } from '@aurora/platform-contract';
import { parseInput, serializeOutput, type OperationDef } from '@aurora/platform-contract/server';
import { operationById } from '../operations.js';
import { sendProblem } from '../error-mapper.js';
import { setSessionCookie } from '../session-cookie.js';
import { clearIntentCookieOnReply } from '../intent-cookie.js';
import { runIdempotentCommand, requestDigest, type IdempotentCommandResult } from '../idempotency.js';
import { ServiceError, sendMappedError } from '../service-error.js';
import type { PlatformApiRouteDependencies } from '../route-deps.js';

const CONFIRM_EMAIL_OPERATION: OperationDef = operationById(OPERATION_ID_CONFIRM_EMAIL_VERIFICATION);

interface ConfirmEmailBody {
  readonly idempotencyKey: string;
}

/** SHA-256 hex digest of a transient intent token (matches platform-identity). */
function digestOf(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * POST /api/platform/v1/auth/email/confirm — A1. Intent-authLevel + CSRF
 * (enforced by the plugins). Validates the email-verification intent and
 * atomically { consumeIntent + updateAccountVerifiedAt + idempotency }. When a
 * session for the same account is present it is rotated to `authenticated`
 * (upgrading the pending-verification session); with no matching session the
 * verification completes and the client is sent to login.
 */
export async function handleConfirmEmailVerification(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();
  const now = deps.now();

  const parsed = parseInput(CONFIRM_EMAIL_OPERATION, { body: request.body });
  if (!parsed.ok) {
    await sendProblem(reply, requestId, 400, 'structural_error', 'Request does not match the public contract.');
    return;
  }
  const input = parsed.data.body as ConfirmEmailBody;

  const intentPayload = request.intentPayload;
  if (intentPayload === null || intentPayload.kind !== 'email_verification') {
    await sendProblem(reply, requestId, 404, 'not_found', 'The verification intent was not found.');
    return;
  }

  let intent;
  try {
    intent = await findEmailVerificationIntentByDigest(deps.pool, digestOf(intentPayload.token));
  } catch {
    await sendProblem(reply, requestId, 503, 'authority_unavailable', 'Account store is temporarily unavailable.');
    return;
  }
  if (intent === null) {
    await sendProblem(reply, requestId, 404, 'not_found', 'The verification intent was not found.');
    return;
  }

  let idempotency: IdempotentCommandResult;
  try {
    idempotency = await runIdempotentCommand({
      pool: deps.pool,
      key: input.idempotencyKey,
      operation: OPERATION_ID_CONFIRM_EMAIL_VERIFICATION,
      digest: requestDigest(input),
      execute: async (client) => {
        const consumed = await consumeIntent(client, {
          kind: 'email_verification',
          intentId: intent.intentId,
          now,
        });
        if (consumed.status === 'already_consumed' || consumed.status === 'expired') {
          throw new ServiceError(409, 'business_validation', 'The verification intent is no longer valid.');
        }
        if (consumed.status === 'not_found') {
          throw new ServiceError(404, 'not_found', 'The verification intent was not found.');
        }

        const account = await getAccountById(client, intent.accountId);
        if (account === null) {
          throw new ServiceError(404, 'not_found', 'The account was not found.');
        }

        const verified = await updateAccountVerifiedAt(client, account.accountId, now);
        if (verified.status === 'not_found') {
          throw new ServiceError(404, 'not_found', 'The account was not found.');
        }

        return {
          verificationStatus: { verified: true },
          account: { accountId: account.accountId, email: account.email, verified: true },
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
    verificationStatus: { verified: true };
    account: { accountId: string; email: string; verified: true };
  };

  // When a session exists for the same account, rotate it to `authenticated`
  // (both fresh and replay converge). With no matching session the client
  // completes verification and is sent to login.
  if (request.sessionCookieValue !== null && request.sessionPayload !== null) {
    const sessionMatches = request.sessionPayload.accountId === response.account.accountId;
    if (sessionMatches) {
      try {
        const sessionInput = {
          accountId: response.account.accountId,
          authLevel: 'authenticated' as const,
          now,
          idleMs: deps.config.sessionIdleMs,
          absoluteMs: deps.config.sessionAbsoluteMs,
        };
        const rotated = await rotateSession(
          deps.sessionStore,
          request.sessionCookieValue,
          now,
          sessionInput,
        );
        if (rotated === null) {
          const fresh = await createSession(deps.sessionStore, sessionInput);
          setSessionCookie(reply, fresh.cookieValue, deps.cookieOptions);
        } else {
          setSessionCookie(reply, rotated.cookieValue, deps.cookieOptions);
        }
      } catch {
        await sendProblem(reply, requestId, 503, 'authority_unavailable', 'Session authority is temporarily unavailable.');
        return;
      }
    }
  }

  clearIntentCookieOnReply(reply, deps.cookieOptions);

  const serialized = serializeOutput(CONFIRM_EMAIL_OPERATION, 200, response);
  if (!serialized.ok) {
    await sendProblem(reply, requestId, 500, 'internal_error', 'An internal error occurred.');
    return;
  }
  void reply.header('x-aurora-request-id', requestId).code(200).send(serialized.body);
}
