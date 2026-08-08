import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  createAccount,
  createPersonalOrganization,
  hashPassword,
  normalizeEmail,
} from '@aurora/platform-identity';
import { createSession } from '@aurora/platform-session';
import { OPERATION_ID_REGISTER } from '@aurora/platform-contract';
import { parseInput, serializeOutput, type OperationDef } from '@aurora/platform-contract/server';
import { operationById } from '../operations.js';
import { mapErrorToProblem, sendProblem } from '../error-mapper.js';
import { setSessionCookie } from '../session-cookie.js';
import type { PlatformApiRouteDependencies } from '../route-deps.js';

const REGISTER_OPERATION: OperationDef = operationById(OPERATION_ID_REGISTER);

interface RegisterBody {
  readonly email: string;
  readonly password: string;
  readonly idempotencyKey: string;
}

/**
 * Task 6 stub for POST /api/platform/v1/auth/register. It performs the real
 * account + personal-workspace creation and establishes a session (so the
 * following session query can resolve it), then returns the closed
 * `identityRegisterResponse` contract shape. Idempotency, email verification
 * outbox rows, rate limiting and the full A1 flow land in Task 7.
 */
export async function handleRegister(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();

  const parsed = parseInput(REGISTER_OPERATION, { body: request.body });
  if (!parsed.ok) {
    await sendProblem(reply, requestId, 400, 'structural_error', 'Request does not match the public contract.');
    return;
  }
  const input = parsed.data.body as RegisterBody;

  let passwordHash: string;
  try {
    passwordHash = await hashPassword(input.password);
  } catch {
    await sendProblem(reply, requestId, 500, 'internal_error', 'An internal error occurred.');
    return;
  }

  const emailNormalized = normalizeEmail(input.email);
  let accountResult;
  try {
    accountResult = await createAccount(deps.pool, {
      email: input.email,
      emailNormalized,
      passwordHash,
      status: 'pending_verification',
    });
  } catch (error) {
    const mapped = mapErrorToProblem(requestId, error);
    await reply.code(mapped.status).send(mapped.problem);
    return;
  }
  if (accountResult.status === 'conflict') {
    await sendProblem(reply, requestId, 409, 'business_validation', 'An account with this email already exists.');
    return;
  }

  let workspaceResult;
  try {
    workspaceResult = await createPersonalOrganization(deps.pool, {
      name: 'My Workspace',
      accountId: accountResult.account.accountId,
    });
  } catch (error) {
    const mapped = mapErrorToProblem(requestId, error);
    await reply.code(mapped.status).send(mapped.problem);
    return;
  }
  if (workspaceResult.status === 'conflict') {
    await sendProblem(reply, requestId, 409, 'business_validation', 'Workspace creation failed.');
    return;
  }

  const now = deps.now();
  let session;
  try {
    session = await createSession(deps.sessionStore, {
      accountId: accountResult.account.accountId,
      authLevel: 'pending_verification',
      now,
      idleMs: deps.config.sessionIdleMs,
      absoluteMs: deps.config.sessionAbsoluteMs,
    });
  } catch (error) {
    const mapped = mapErrorToProblem(requestId, error);
    await reply.code(mapped.status).send(mapped.problem);
    return;
  }

  setSessionCookie(reply, session.cookieValue, deps.cookieOptions);

  const response = {
    accountId: accountResult.account.accountId,
    workspaceId: { organizationId: workspaceResult.organizationId },
    emailMasked: maskEmail(emailNormalized),
    verificationStatus: { verified: false, reason: 'email_verification_pending' },
    serverTime: now.toISOString(),
  };

  const serialized = serializeOutput(REGISTER_OPERATION, 200, response);
  if (!serialized.ok) {
    await sendProblem(reply, requestId, 500, 'internal_error', 'An internal error occurred.');
    return;
  }
  void reply.header('x-aurora-request-id', requestId).code(200).send(serialized.body);
}

/** Server-side email mask for display/logging — never the full address. */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  const domain = at < 0 ? '' : email.slice(at);
  const local = at < 0 ? email : email.slice(0, at);
  if (local.length <= 2) return `${local[0] ?? ''}***${domain}`;
  return `${local.slice(0, 2)}***${domain}`;
}
