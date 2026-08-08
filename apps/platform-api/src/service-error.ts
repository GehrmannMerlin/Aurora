import type { FastifyReply } from 'fastify';
import { PlatformIdentityError } from '@aurora/platform-identity';
import { mapErrorToProblem, sendProblem } from './error-mapper.js';

/**
 * A stable service-layer failure that maps to a single RFC 9457 `auroraProblem`.
 * Throwing a `ServiceError` inside a transaction forces a rollback (the caller
 * maps it via `sendMappedError`). It never carries SQL, stacks, constraint
 * names, passwords, tokens, session ids or CSRF secrets.
 */
export class ServiceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly detail: string,
  ) {
    super(detail);
    this.name = 'ServiceError';
  }
}

/** True when the thrown value is a ServiceError with a mapped response. */
export function isServiceError(error: unknown): error is ServiceError {
  return error instanceof ServiceError;
}

/**
 * Map a thrown value to a problem response. Returns true when a response was
 * sent:
 * - ServiceError -> its explicit status/code/detail (business conflicts, 404s);
 * - PlatformIdentityError -> the stable authority mapping (503 for
 *   database_unavailable / statement_failed);
 * - anything else -> false, so the caller rethrows and the global error handler
 *   returns a closed 500 internal_error.
 */
export async function sendMappedError(
  reply: FastifyReply,
  requestId: string,
  error: unknown,
): Promise<boolean> {
  if (isServiceError(error)) {
    await sendProblem(reply, requestId, error.status, error.code, error.detail);
    return true;
  }
  if (error instanceof PlatformIdentityError) {
    const mapped = mapErrorToProblem(requestId, error);
    await reply.code(mapped.status).send(mapped.problem);
    return true;
  }
  return false;
}
