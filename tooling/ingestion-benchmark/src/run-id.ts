import { randomUUID } from 'node:crypto';

/** Generate a unique run identifier. Never derived from time or Math.random. */
export function generateRunId(): string {
  return randomUUID();
}

/** Derive an isolated PostgreSQL schema name from a run id (no hyphens). */
export function schemaNameForRunId(runId: string): string {
  const suffix = runId.replaceAll('-', '');
  return `aurora_bench_${suffix}`;
}
