/**
 * Stable internal failure kinds for @aurora/platform-audit. PostgreSQL error
 * details (SQLSTATE, constraint names, server messages) are never surfaced to
 * callers; only one of the stable kinds below is exposed.
 */
export type PlatformAuditErrorKind = 'invalid_input' | 'database_unavailable' | 'statement_failed';

export class PlatformAuditError extends Error {
  readonly kind: PlatformAuditErrorKind;

  constructor(kind: PlatformAuditErrorKind, message: string) {
    super(message);
    this.name = 'PlatformAuditError';
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

/** Map an arbitrary thrown value to the stable PlatformAuditError surface. */
export function toStableError(error: unknown): PlatformAuditError {
  if (error instanceof PlatformAuditError) return error;
  const code = errorCode(error);
  if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'ENOTFOUND') {
    return new PlatformAuditError('database_unavailable', 'database is unavailable');
  }
  return new PlatformAuditError('statement_failed', 'database statement failed');
}

/** PostgreSQL unique_violation (23505). */
export function isUniqueViolation(error: unknown): boolean {
  return errorCode(error) === '23505';
}

/** PostgreSQL foreign_key_violation (23503). */
export function isForeignKeyViolation(error: unknown): boolean {
  return errorCode(error) === '23503';
}

/** PostgreSQL check_violation (23514) and not_null_violation (23502). */
export function isConstraintViolation(error: unknown): boolean {
  const code = errorCode(error);
  return code === '23514' || code === '23502';
}
