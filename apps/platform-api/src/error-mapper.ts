import type { FastifyReply } from 'fastify';
import { IngestionInboxError } from '@aurora/ingestion-inbox';
import { IngestionCredentialsError } from '@aurora/ingestion-credentials';
import { PlatformIdentityError } from '@aurora/platform-identity';
import { PlatformOrganizationError } from '@aurora/platform-organization';
import { PlatformProjectGovernanceError } from '@aurora/platform-project-governance';
import { PlatformCredentialsError } from '@aurora/platform-credentials';
import { PlatformAuditError } from '@aurora/platform-audit';
import { ProcessingStoreError } from '@aurora/processing-store';

/** A single field-level validation error (RFC 9457 `fieldErrors`). */
export interface AuroraProblemFieldError {
  readonly field: string;
  readonly reason: string;
}

/**
 * RFC 9457 problem detail shape consumed by the platform-api layer. Never
 * carries SQL, stack traces, constraint names, passwords, tokens, session ids,
 * CSRF secrets or full email addresses.
 */
export interface AuroraProblem {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  readonly code: string;
  readonly requestId: string;
  readonly instance?: string;
  readonly recoveryTarget?: string | null;
  readonly retryAfter?: number;
  readonly fieldErrors?: readonly AuroraProblemFieldError[];
}

const PROBLEM_TITLES: Readonly<Record<string, string>> = {
  structural_error: 'Invalid request',
  authentication: 'Authentication required',
  authorization: 'Forbidden',
  not_found: 'Not found',
  business_validation: 'Business rule violation',
  field_validation: 'Field validation failed',
  idempotency_conflict: 'Idempotency conflict',
  version_conflict: 'Version conflict',
  rate_limited: 'Rate limited',
  authority_unavailable: 'Authority unavailable',
  internal_error: 'Internal error',
};

export interface ProblemExtras {
  readonly recoveryTarget?: string | null;
  readonly retryAfter?: number;
  readonly fieldErrors?: readonly AuroraProblemFieldError[];
}

/** Build a closed RFC 9457 problem; optional fields are omitted when unset. */
export function problem(
  requestId: string,
  status: number,
  code: string,
  detail: string,
  extras?: ProblemExtras,
): AuroraProblem {
  return {
    type: 'about:blank',
    title: PROBLEM_TITLES[code] ?? code,
    status,
    detail,
    code,
    requestId,
    ...(extras?.recoveryTarget === undefined ? {} : { recoveryTarget: extras.recoveryTarget }),
    ...(extras?.retryAfter === undefined ? {} : { retryAfter: extras.retryAfter }),
    ...(extras?.fieldErrors === undefined ? {} : { fieldErrors: extras.fieldErrors }),
  };
}

/** Send a problem, echoing the opaque request id in a response header. */
export function sendProblem(
  reply: FastifyReply,
  requestId: string,
  status: number,
  code: string,
  detail: string,
  extras?: ProblemExtras,
): FastifyReply {
  return reply
    .header('x-aurora-request-id', requestId)
    .code(status)
    .send(problem(requestId, status, code, detail, extras));
}

/** The stable `kind` union shared by every platform data-layer error class. */
type StableErrorKind = 'invalid_input' | 'database_unavailable' | 'statement_failed';

/**
 * Map a stable data-layer failure kind to an HTTP status and a non-leaking
 * problem. Never exposes SQL, stack, constraint names or internal details.
 */
function mapStableErrorKind(
  requestId: string,
  kind: StableErrorKind,
): { status: number; problem: AuroraProblem } {
  switch (kind) {
    case 'database_unavailable':
    case 'statement_failed':
      return {
        status: 503,
        problem: problem(
          requestId,
          503,
          'authority_unavailable',
          'Authority is temporarily unavailable.',
        ),
      };
    case 'invalid_input':
      return {
        status: 400,
        problem: problem(
          requestId,
          400,
          'structural_error',
          'Request does not match the public contract.',
        ),
      };
  }
}

/** True when the thrown value is one of the platform data-layer stable errors. */
export function isStableDataError(
  error: unknown,
): error is
  | PlatformIdentityError
  | PlatformOrganizationError
  | PlatformProjectGovernanceError
  | PlatformCredentialsError
  | PlatformAuditError
  | ProcessingStoreError
  | IngestionInboxError
  | IngestionCredentialsError {
  return (
    error instanceof PlatformIdentityError ||
    error instanceof PlatformOrganizationError ||
    error instanceof PlatformProjectGovernanceError ||
    error instanceof PlatformCredentialsError ||
    error instanceof PlatformAuditError ||
    error instanceof ProcessingStoreError ||
    error instanceof IngestionInboxError ||
    error instanceof IngestionCredentialsError
  );
}

/**
 * Map a stable internal failure to an HTTP status and a non-leaking problem.
 * Never exposes SQL, stack, constraint names or internal details.
 */
export function mapErrorToProblem(
  requestId: string,
  error: unknown,
): { status: number; problem: AuroraProblem } {
  if (isStableDataError(error)) {
    return mapStableErrorKind(requestId, error.kind);
  }
  return {
    status: 500,
    problem: problem(requestId, 500, 'internal_error', 'An internal error occurred.'),
  };
}
