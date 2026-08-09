/**
 * Stable internal failure kinds for @aurora/platform-credentials. PostgreSQL
 * error details (SQLSTATE, constraint names, server messages) are never
 * surfaced to callers; only one of the stable kinds below is exposed.
 */
export type PlatformCredentialsErrorKind =
  'invalid_input' | 'database_unavailable' | 'statement_failed';

export class PlatformCredentialsError extends Error {
  readonly kind: PlatformCredentialsErrorKind;

  constructor(kind: PlatformCredentialsErrorKind, message: string) {
    super(message);
    this.name = 'PlatformCredentialsError';
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

/** Map an arbitrary thrown value to the stable PlatformCredentialsError surface. */
export function toStableError(error: unknown): PlatformCredentialsError {
  if (error instanceof PlatformCredentialsError) return error;
  const code = errorCode(error);
  if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'ENOTFOUND') {
    return new PlatformCredentialsError('database_unavailable', 'database is unavailable');
  }
  return new PlatformCredentialsError('statement_failed', 'database statement failed');
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
