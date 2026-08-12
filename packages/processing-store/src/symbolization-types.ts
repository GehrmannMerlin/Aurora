export type SymbolizationStatus = 'symbolized' | 'not_found' | 'parse_failed';

export interface PersistSymbolizationInput {
  readonly occurrenceId: string;
  readonly projectId: string;
  readonly releaseId: string;
  readonly sourceMapFileId: string;
  readonly mapVersion: number;
  readonly originalPath: string;
  readonly resolvedFile?: string;
  readonly resolvedLine?: number;
  readonly resolvedColumn?: number;
  readonly functionName?: string;
  readonly status: SymbolizationStatus;
}

export interface ReparseCandidate {
  readonly occurrenceId: string;
  readonly normalizedBody: unknown;
}
