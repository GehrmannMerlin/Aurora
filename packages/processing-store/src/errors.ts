/** Stable internal failure kind for program-defect and mapping paths. */
export type ProcessingStoreErrorKind = 'invalid_input' | 'database_unavailable' | 'statement_failed';

export class ProcessingStoreError extends Error {
  readonly kind: ProcessingStoreErrorKind;

  constructor(kind: ProcessingStoreErrorKind, message: string) {
    super(message);
    this.name = 'ProcessingStoreError';
    this.kind = kind;
  }
}
