import type { FastifyReply, FastifyRequest } from 'fastify';
import { getAccountById, type AccountRow } from '@aurora/platform-identity';
import { OPERATION_ID_SESSION } from '@aurora/platform-contract';
import { serializeOutput, type OperationDef } from '@aurora/platform-contract/server';
import { operationById } from '../operations.js';
import { mapErrorToProblem, sendProblem } from '../error-mapper.js';
import type { PlatformApiRouteDependencies } from '../route-deps.js';

const SESSION_OPERATION: OperationDef = operationById(OPERATION_ID_SESSION);

/**
 * GET /api/platform/v1/session — resolve the current session projection
 * (accepted ADR-028 决定细节 4/7). Callable without a session (public query);
 * a missing/expired/revoked session returns a unified 401 with a safe login
 * target, and a Redis-unavailable authority fails closed with 503.
 */
export async function handleGetSession(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();

  if (request.sessionUnavailable) {
    await sendProblem(
      reply,
      requestId,
      503,
      'authority_unavailable',
      'Session authority is temporarily unavailable.',
    );
    return;
  }
  if (request.sessionPayload === null) {
    await sendProblem(reply, requestId, 401, 'authentication', 'Authentication is required.', {
      recoveryTarget: 'auth.login',
    });
    return;
  }

  const session = request.sessionPayload;
  let account: AccountRow | null;
  try {
    account = await getAccountById(deps.pool, session.accountId);
  } catch (error) {
    const mapped = mapErrorToProblem(requestId, error);
    await reply.code(mapped.status).send(mapped.problem);
    return;
  }
  if (account === null) {
    // Session references a deleted account — treat as unauthenticated.
    await sendProblem(reply, requestId, 401, 'authentication', 'Authentication is required.', {
      recoveryTarget: 'auth.login',
    });
    return;
  }

  const response = {
    account: {
      accountId: account.accountId,
      email: account.email,
      verified: account.verifiedAt !== null,
    },
    authentication: session.authLevel,
    session: {
      expiresAt: session.expiresAt,
      ...(session.rotationDueAt === null ? {} : { rotationDueAt: session.rotationDueAt }),
    },
    csrf: session.csrfSecret,
    navigation: buildNavigationTargets(account),
  };

  const serialized = serializeOutput(SESSION_OPERATION, 200, response);
  if (!serialized.ok) {
    await sendProblem(reply, requestId, 500, 'internal_error', 'An internal error occurred.');
    return;
  }
  void reply.header('x-aurora-request-id', requestId).code(200).send(serialized.body);
}

/**
 * Minimal navigation targets for the account's current lifecycle. Task 7 (and
 * `navigationGetContext`) replaces this with the real authorized workspace.
 */
function buildNavigationTargets(account: AccountRow): readonly unknown[] {
  if (account.verifiedAt === null) {
    return [{ routeId: 'auth.verify-email', pathParams: {}, query: {} }];
  }
  return [{ routeId: 'workspace.home', pathParams: {}, query: {} }];
}
