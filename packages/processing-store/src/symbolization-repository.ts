import type { Pool } from 'pg';
import { ProcessingStoreError } from './errors.js';
import type { PersistSymbolizationInput, ReparseCandidate } from './symbolization-types.js';

const UPSERT_SQL = `
  INSERT INTO error_occurrence_symbolizations
    (occurrence_id, project_id, release_id, source_map_file_id, map_version,
     original_path, resolved_file, resolved_line, resolved_column, function_name, status)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
  ON CONFLICT (occurrence_id) DO UPDATE SET
    release_id = EXCLUDED.release_id,
    source_map_file_id = EXCLUDED.source_map_file_id,
    map_version = EXCLUDED.map_version,
    original_path = EXCLUDED.original_path,
    resolved_file = EXCLUDED.resolved_file,
    resolved_line = EXCLUDED.resolved_line,
    resolved_column = EXCLUDED.resolved_column,
    function_name = EXCLUDED.function_name,
    status = EXCLUDED.status,
    updated_at = now()
`;

/**
 * Upsert the current symbolization for an occurrence (one per occurrence).
 * Idempotent: re-running the same (occurrence, map, version) replaces the row
 * with the same result. `map_version` distinguishes old-map symbolizations so
 * a map replacement can re-process them (PRD §8.3.8).
 */
export async function persistSymbolization(
  pool: Pool,
  input: PersistSymbolizationInput,
): Promise<void> {
  try {
    await pool.query(UPSERT_SQL, [
      input.occurrenceId,
      input.projectId,
      input.releaseId,
      input.sourceMapFileId,
      input.mapVersion,
      input.originalPath,
      input.resolvedFile ?? null,
      input.resolvedLine ?? null,
      input.resolvedColumn ?? null,
      input.functionName ?? null,
      input.status,
    ]);
  } catch {
    throw new ProcessingStoreError('statement_failed', 'symbolization persistence failed');
  }
}

const CANDIDATES_SQL = `
  SELECT o.id, o.normalized_body
  FROM error_event_occurrences o
  LEFT JOIN error_occurrence_symbolizations s ON s.occurrence_id = o.id
  WHERE o.project_id = $1
    AND (s.id IS NULL OR s.source_map_file_id <> $2 OR s.map_version <> $3)
  ORDER BY o.occurred_at ASC, o.id ASC
  LIMIT $4
`;

/**
 * Bounded reparse candidates for a (project, source map file, map version):
 * occurrences that are not yet symbolized, or whose symbolization came from a
 * different file or an older map version (a replace-triggered reparse reworks
 * them). Deterministic order (oldest first).
 */
export async function queryReparseCandidates(
  pool: Pool,
  input: {
    readonly projectId: string;
    readonly sourceMapFileId: string;
    readonly mapVersion: number;
    readonly limit: number;
  },
): Promise<ReparseCandidate[]> {
  try {
    const result = await pool.query<{ id: string; normalized_body: unknown }>(CANDIDATES_SQL, [
      input.projectId,
      input.sourceMapFileId,
      input.mapVersion,
      input.limit,
    ]);
    return result.rows.map((row) => ({
      occurrenceId: row.id,
      normalizedBody: row.normalized_body,
    }));
  } catch {
    throw new ProcessingStoreError('statement_failed', 'reparse candidate query failed');
  }
}
