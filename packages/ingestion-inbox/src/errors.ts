/** Stable internal failure kinds; never leak PostgreSQL details to callers. */
export type IngestionInboxErrorKind = 'invalid_input' | 'database_unavailable' | 'statement_failed';

export class IngestionInboxError extends Error {
  readonly kind: IngestionInboxErrorKind;

  constructor(kind: IngestionInboxErrorKind, message: string) {
    super(message);
    this.name = 'IngestionInboxError';
    this.kind = kind;
  }
}
