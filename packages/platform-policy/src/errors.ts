/** Stable internal failure kind for program-defect and mapping paths. */
export type PlatformPolicyErrorKind = 'invalid_input' | 'database_unavailable' | 'statement_failed';

export class PlatformPolicyError extends Error {
  readonly kind: PlatformPolicyErrorKind;

  constructor(kind: PlatformPolicyErrorKind, message: string) {
    super(message);
    this.name = 'PlatformPolicyError';
    this.kind = kind;
  }
}

function errorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const value = (error as { code?: unknown }).code;
    return typeof value === 'string' ? value : '';
  }
  return '';
}

/**
 * Map an arbitrary thrown value to the stable PlatformPolicyError surface.
 * PostgreSQL error details (SQLSTATE, constraint names, server messages) are
 * never surfaced to callers; only one of the stable kinds is exposed.
 */
export function toStableError(error: unknown): PlatformPolicyError {
  if (error instanceof PlatformPolicyError) return error;
  const code = errorCode(error);
  if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'ENOTFOUND') {
    return new PlatformPolicyError('database_unavailable', 'database is unavailable');
  }
  return new PlatformPolicyError('statement_failed', 'database statement failed');
}

/**
 * True when the thrown value is a PostgreSQL `check_violation` (SQLSTATE
 * 23514). The repository write paths use this to wrap the DB-enforced policy
 * field checks (`warning_ratio < hard_limit`, `resource_limit > 0`) as a
 * stable `invalid_input` error with a diagnostic message, instead of leaking
 * the raw constraint.
 */
export function isPostgresCheckViolation(error: unknown): boolean {
  return errorCode(error) === '23514';
}

/**
 * True when the thrown value is a PostgreSQL `unique_violation` (SQLSTATE
 * 23505). The platform-policy repositories use this to resolve the
 * concurrent-insert race on the single-row `platform_resource_policies` table
 * (the DB-level singleton partial unique index): a lost bootstrap race maps to
 * the idempotent `already_exists` result, and a lost set race maps to the
 * fail-closed `temporarily_unavailable` result.
 */
export function isPostgresUniqueViolation(error: unknown): boolean {
  return errorCode(error) === '23505';
}
