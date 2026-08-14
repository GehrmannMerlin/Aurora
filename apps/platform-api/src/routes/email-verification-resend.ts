import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  createIntentToken,
  getAccountByIdForUpdate,
  getEmailVerificationResendState,
  insertEmailVerificationIntent,
  insertOutboxRow,
  supersedeEmailVerificationIntents,
  supersedePendingEmailVerificationOutbox,
} from '@aurora/platform-identity';
import { OPERATION_ID_RESEND_EMAIL_VERIFICATION } from '@aurora/platform-contract';
import { parseInput, serializeOutput, type OperationDef } from '@aurora/platform-contract/server';
import { operationById } from '../operations.js';
import { sendProblem } from '../error-mapper.js';
import { maskEmail } from '../email-mask.js';
import { runIdempotentCommand, requestDigest } from '../idempotency.js';
import { requireSession } from './_shared.js';
import { ServiceError, sendMappedError } from '../service-error.js';
import type { PlatformApiRouteDependencies } from '../route-deps.js';

const RESEND_OPERATION: OperationDef = operationById(OPERATION_ID_RESEND_EMAIL_VERIFICATION);
const VERIFY_INTENT_MINUTES = 120;
const VERIFY_INTENT_TTL_MS = VERIFY_INTENT_MINUTES * 60 * 1000;

interface ResendBody {
  readonly idempotencyKey: string;
}

function timingProblem(
  now: Date,
  availableAt: Date,
): {
  readonly retryAfter: number;
  readonly resendAvailableAt: string;
} {
  return {
    retryAfter: Math.max(1, Math.ceil((availableAt.getTime() - now.getTime()) / 1000)),
    resendAvailableAt: availableAt.toISOString(),
  };
}

/**
 * Session-bound email-verification resend. The recipient is always recovered
 * from the locked account row; no browser-provided email is accepted.
 */
export async function handleResendEmailVerification(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();
  const now = deps.now();
  const session = await requireSession(request, reply, requestId);
  if (session === null) return;

  const parsed = parseInput(RESEND_OPERATION, { body: request.body });
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
  const input = parsed.data.body as ResendBody;

  let command;
  try {
    command = await runIdempotentCommand({
      pool: deps.pool,
      key: input.idempotencyKey,
      operation: OPERATION_ID_RESEND_EMAIL_VERIFICATION,
      digest: requestDigest(input),
      execute: async (client) => {
        const rate = deps.rateLimiter.check(
          `${OPERATION_ID_RESEND_EMAIL_VERIFICATION}:${request.ip}:${session.accountId}`,
          now.getTime(),
        );
        if (!rate.allowed) {
          throw new ServiceError(429, 'rate_limited', 'Too many resend attempts.', {
            ...(rate.retryAfterSeconds === undefined ? {} : { retryAfter: rate.retryAfterSeconds }),
          });
        }

        const account = await getAccountByIdForUpdate(client, session.accountId);
        if (account?.status !== 'pending_verification' || account.verifiedAt !== null) {
          throw new ServiceError(
            409,
            'state_machine_conflict',
            'Email verification cannot be resent for the current account state.',
          );
        }

        const state = await getEmailVerificationResendState(client, {
          accountId: account.accountId,
          now,
          cooldownMs: deps.config.emailResendCooldownMs,
          rollingWindowMs: deps.config.emailResendRollingWindowMs,
        });
        if (state.lastAcceptedAt !== null) {
          const availableAt = new Date(
            new Date(state.lastAcceptedAt).getTime() + deps.config.emailResendCooldownMs,
          );
          if (now < availableAt) {
            throw new ServiceError(
              429,
              'rate_limited',
              'Please wait before requesting another verification email.',
              timingProblem(now, availableAt),
            );
          }
        }
        if (state.resendCount >= deps.config.emailResendMaxPerWindow) {
          if (state.oldestResendAt === null) {
            throw new ServiceError(
              503,
              'authority_unavailable',
              'Email resend quota state is temporarily unavailable.',
            );
          }
          const availableAt = new Date(
            new Date(state.oldestResendAt).getTime() + deps.config.emailResendRollingWindowMs,
          );
          throw new ServiceError(
            429,
            'rate_limited',
            'The rolling resend limit has been reached.',
            timingProblem(now, availableAt),
          );
        }

        await supersedeEmailVerificationIntents(client, { accountId: account.accountId, now });
        await supersedePendingEmailVerificationOutbox(client, {
          accountId: account.accountId,
          now,
        });

        const { token, digest } = createIntentToken();
        const expiresAt = new Date(now.getTime() + VERIFY_INTENT_TTL_MS);
        await insertEmailVerificationIntent(client, {
          accountId: account.accountId,
          tokenDigest: digest,
          expiresAt,
        });
        const base = deps.config.consoleOrigin.replace(/\/$/, '');
        const emailMasked = maskEmail(account.email);
        await insertOutboxRow(client, {
          aggregateType: 'email.verification.resend',
          aggregateId: account.accountId,
          createdAt: now,
          payload: {
            intentType: 'email_verification',
            toAddress: account.email,
            toMasked: emailMasked,
            mailLinkUrl: `${base}/verify-email/confirm?token=${token}`,
            expiresInMinutes: VERIFY_INTENT_MINUTES,
            intentExpiresAt: expiresAt.toISOString(),
          },
        });

        return {
          emailMasked,
          deliveryStatus: 'queued' as const,
          resendAvailableAt: new Date(
            now.getTime() + deps.config.emailResendCooldownMs,
          ).toISOString(),
          serverTime: now.toISOString(),
        };
      },
    });
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }

  if (command.outcome === 'conflict') {
    await sendProblem(reply, requestId, 409, 'idempotency_conflict', 'Idempotency key conflict.');
    return;
  }
  const serialized = serializeOutput(RESEND_OPERATION, 200, command.resultData);
  if (!serialized.ok) {
    await sendProblem(reply, requestId, 500, 'internal_error', 'An internal error occurred.');
    return;
  }
  void reply.header('x-aurora-request-id', requestId).code(200).send(serialized.body);
}
