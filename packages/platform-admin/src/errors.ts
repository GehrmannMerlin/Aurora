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
