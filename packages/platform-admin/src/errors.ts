/** Stable internal failure kind for program-defect and mapping paths. */
export type PlatformAdminErrorKind = 'invalid_input' | 'database_unavailable' | 'statement_failed';

export class PlatformAdminError extends Error {
  readonly kind: PlatformAdminErrorKind;

  constructor(kind: PlatformAdminErrorKind, message: string) {
    super(message);
    this.name = 'PlatformAdminError';
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
 * Map an arbitrary thrown value to the stable PlatformAdminError surface.
 * PostgreSQL error details (SQLSTATE, constraint names, server messages) are
 * never surfaced to callers; only one of the stable kinds is exposed.
 */
export function toStableError(error: unknown): PlatformAdminError {
  if (error instanceof PlatformAdminError) return error;
  const code = errorCode(error);
  if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'ENOTFOUND') {
    return new PlatformAdminError('database_unavailable', 'database is unavailable');
  }
  return new PlatformAdminError('statement_failed', 'database statement failed');
}
