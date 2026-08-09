import type { FastifyReply } from 'fastify';
import { mapErrorToProblem, sendProblem, isStableDataError } from './error-mapper.js';
import type { ProblemExtras } from './error-mapper.js';

/**
 * A stable service-layer failure that maps to a single RFC 9457 `auroraProblem`.
 * Throwing a `ServiceError` inside a transaction forces a rollback (the caller
 * maps it via `sendMappedError`). It never carries SQL, stacks, constraint
 * names, passwords, tokens, session ids or CSRF secrets.
 *
 * `extras` carries closed problem details (e.g. `fieldErrors` with the server's
 * current authoritative version/status) that are safe to surface — never SQL,
 * secrets or full emails.
 */
export class ServiceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly detail: string,
    readonly extras?: ProblemExtras,
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
 * - any platform data-layer stable error (PlatformIdentityError,
 *   PlatformOrganizationError, PlatformProjectGovernanceError,
 *   PlatformCredentialsError, PlatformAuditError) -> the stable authority
 *   mapping (503 authority_unavailable for database_unavailable /
 *   statement_failed, 400 structural_error for invalid_input);
 * - anything else -> false, so the caller rethrows and the global error handler
 *   returns a closed 500 internal_error.
 */
export async function sendMappedError(
  reply: FastifyReply,
  requestId: string,
  error: unknown,
): Promise<boolean> {
  if (isServiceError(error)) {
    await sendProblem(reply, requestId, error.status, error.code, error.detail, error.extras);
    return true;
  }
  if (isStableDataError(error)) {
    const mapped = mapErrorToProblem(requestId, error);
    await reply.code(mapped.status).send(mapped.problem);
    return true;
  }
  return false;
}
