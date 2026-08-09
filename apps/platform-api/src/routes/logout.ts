import type { FastifyReply, FastifyRequest } from 'fastify';
import { revokeSession } from '@aurora/platform-session';
import { OPERATION_ID_LOGOUT } from '@aurora/platform-contract';
import { serializeOutput, type OperationDef } from '@aurora/platform-contract/server';
import { operationById } from '../operations.js';
import { sendProblem } from '../error-mapper.js';
import { clearSessionCookie } from '../session-cookie.js';
import type { PlatformApiRouteDependencies } from '../route-deps.js';

const LOGOUT_OPERATION: OperationDef = operationById(OPERATION_ID_LOGOUT);

/**
 * POST /api/platform/v1/auth/logout — A2. Session-authLevel + CSRF (enforced by
 * the cookie-session/csrf plugins). Immediately revokes the current session and
 * clears the session cookie (ADR-030 决定细节 3). Idempotent by nature: revoking
 * an already-revoked session is a no-op.
 */
export async function handleLogout(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();

  const cookieValue = request.sessionCookieValue;
  if (cookieValue !== null) {
    try {
      await revokeSession(deps.sessionStore, cookieValue);
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
  }

  clearSessionCookie(reply, deps.cookieOptions);

  const response = {
    status: 'succeeded' as const,
    serverTime: deps.now().toISOString(),
  };

  const serialized = serializeOutput(LOGOUT_OPERATION, 200, response);
  if (!serialized.ok) {
    await sendProblem(reply, requestId, 500, 'internal_error', 'An internal error occurred.');
    return;
  }
  void reply.header('x-aurora-request-id', requestId).code(200).send(serialized.body);
}
