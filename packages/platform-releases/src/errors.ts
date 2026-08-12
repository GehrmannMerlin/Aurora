/**
 * Stable internal failure kinds for @aurora/platform-releases. PostgreSQL
 * error details (SQLSTATE, constraint names, server messages) are never
 * surfaced to callers; only one of the stable kinds below is exposed.
 */
export type PlatformReleasesErrorKind =
  'invalid_input' | 'database_unavailable' | 'statement_failed';

export class PlatformReleasesError extends Error {
  readonly kind: PlatformReleasesErrorKind;

  constructor(kind: PlatformReleasesErrorKind, message: string) {
    super(message);
    this.name = 'PlatformReleasesError';
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

/** Map an arbitrary thrown value to the stable PlatformReleasesError surface. */
export function toStableError(error: unknown): PlatformReleasesError {
  if (error instanceof PlatformReleasesError) return error;
  const code = errorCode(error);
  if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'ENOTFOUND') {
    return new PlatformReleasesError('database_unavailable', 'database is unavailable');
  }
  return new PlatformReleasesError('statement_failed', 'database statement failed');
}
