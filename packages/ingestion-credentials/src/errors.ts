/** Stable internal failure kinds; never leak PostgreSQL details to callers. */
export type IngestionCredentialsErrorKind =
  | 'invalid_input'
  | 'database_unavailable'
  | 'statement_failed';

export class IngestionCredentialsError extends Error {
  readonly kind: IngestionCredentialsErrorKind;

  constructor(kind: IngestionCredentialsErrorKind, message: string) {
    super(message);
    this.name = 'IngestionCredentialsError';
    this.kind = kind;
  }
}
