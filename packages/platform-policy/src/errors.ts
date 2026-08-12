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
