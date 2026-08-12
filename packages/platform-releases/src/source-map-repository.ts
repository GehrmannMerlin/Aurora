import type { Pool, PoolClient } from 'pg';
import { toStableError } from './errors.js';

export interface SourceMapFileRow {
  readonly id: string;
  readonly projectId: string;
  readonly releaseId: string;
  readonly buildPath: string;
  readonly objectKey: string;
  readonly digest: string;
  readonly buildId: string | null;
  readonly status: string;
  readonly version: number;
  readonly uploadedAt: Date;
  readonly replacedAt: Date | null;
  readonly reparse: {
    readonly state: string | null;
    readonly processedCount: number | null;
    readonly totalCount: number | null;
    readonly updatedAt: Date | null;
  };
}

export interface ReparseTaskRow {
  readonly id: string;
  readonly projectId: string;
  readonly releaseId: string;
  readonly sourceMapFileId: string;
  readonly status: string;
  readonly targetCount: number | null;
  readonly processedCount: number;
}

interface SourceMapFileRowShape {
  id: string;
  project_id: string;
  release_id: string;
  build_path: string;
  object_key: string;
  digest: string;
  build_id: string | null;
  status: string;
  version: number;
  created_at: Date;
  replaced_at: Date | null;
  reparse_state: string | null;
  processed_count: number | null;
  target_count: number | null;
  reparse_updated_at: Date | null;
}

function toFileRow(row: SourceMapFileRowShape): SourceMapFileRow {
  return {
    id: row.id,
    projectId: row.project_id,
    releaseId: row.release_id,
    buildPath: row.build_path,
    objectKey: row.object_key,
    digest: row.digest,
    buildId: row.build_id,
    status: row.status,
    version: row.version,
    uploadedAt: row.created_at,
    replacedAt: row.replaced_at,
    reparse: {
      state: row.reparse_state,
      processedCount: row.processed_count,
      totalCount: row.target_count,
      updatedAt: row.reparse_updated_at,
    },
  };
}

const FILE_COLUMNS = `
  f.id, f.project_id, f.release_id, f.build_path, f.object_key, f.digest,
  f.build_id, f.status, f.version, f.created_at, f.replaced_at,
  t.status AS reparse_state, t.processed_count, t.target_count,
  t.updated_at AS reparse_updated_at
`;

/**
 * Create a Source Map file for a strict (release, normalized build path) key.
 * Same digest → idempotent `duplicate`; different digest → `replace_conflict`
 * (never silently overwrite; the caller must issue an explicit replace).
 */
export async function createSourceMapFile(
  pool: Pool | PoolClient,
  input: {
    readonly projectId: string;
    readonly releaseId: string;
    readonly buildPath: string;
    readonly objectKey: string;
    readonly digest: string;
    readonly buildId?: string;
  },
): Promise<
  | { readonly status: 'created'; readonly sourceMapFileId: string; readonly version: number }
  | { readonly status: 'duplicate'; readonly sourceMapFileId: string; readonly version: number }
  | {
      readonly status: 'replace_conflict';
      readonly sourceMapFileId: string;
      readonly currentDigest: string;
      readonly version: number;
    }
> {
  try {
    const existing = await pool.query<{ id: string; digest: string; version: number }>(
      `SELECT id, digest, version FROM source_map_files
       WHERE release_id = $1 AND build_path = $2`,
      [input.releaseId, input.buildPath],
    );
    const row = existing.rows[0];
    if (row !== undefined) {
      if (row.digest === input.digest) {
        return { status: 'duplicate', sourceMapFileId: row.id, version: row.version };
      }
      return {
        status: 'replace_conflict',
        sourceMapFileId: row.id,
        currentDigest: row.digest,
        version: row.version,
      };
    }
    const inserted = await pool.query<{ id: string; version: number }>(
      `INSERT INTO source_map_files
         (project_id, release_id, build_path, object_key, digest, build_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, version`,
      [
        input.projectId,
        input.releaseId,
        input.buildPath,
        input.objectKey,
        input.digest,
        input.buildId ?? null,
      ],
    );
    return {
      status: 'created',
      sourceMapFileId: inserted.rows[0]?.id ?? '',
      version: inserted.rows[0]?.version ?? 1,
    };
  } catch (error) {
    throw toStableError(error);
  }
}

/**
 * Explicitly replace a Source Map after a digest conflict (PRD §8.3.7), with
 * optimistic versioning. The old object key is returned so the caller can
 * clean up object storage after commit.
 */
export async function replaceSourceMapFile(
  pool: Pool | PoolClient,
  input: {
    readonly projectId: string;
    readonly sourceMapFileId: string;
    readonly objectKey: string;
    readonly digest: string;
    readonly version: number;
  },
): Promise<
  | { readonly status: 'replaced'; readonly version: number; readonly oldObjectKey: string }
  | { readonly status: 'not_found' }
  | { readonly status: 'version_conflict' }
> {
  try {
    const current = await pool.query<{ object_key: string; version: number }>(
      `SELECT object_key, version FROM source_map_files
       WHERE id = $1 AND project_id = $2`,
      [input.sourceMapFileId, input.projectId],
    );
    const row = current.rows[0];
    if (row === undefined) return { status: 'not_found' };
    if (row.version !== input.version) return { status: 'version_conflict' };
    const updated = await pool.query<{ version: number }>(
      `UPDATE source_map_files SET
         object_key = $3, digest = $4, version = version + 1,
         status = 'active', replaced_at = now(), updated_at = now()
       WHERE id = $1 AND project_id = $2 AND version = $5
       RETURNING version`,
      [input.sourceMapFileId, input.projectId, input.objectKey, input.digest, input.version],
    );
    return {
      status: 'replaced',
      version: updated.rows[0]?.version ?? input.version + 1,
      oldObjectKey: row.object_key,
    };
  } catch (error) {
    throw toStableError(error);
  }
}

/** List the current effective Source Map files for a release (C9). */
export async function listSourceMapFiles(
  pool: Pool | PoolClient,
  input: { readonly projectId: string; readonly releaseId: string },
): Promise<SourceMapFileRow[]> {
  try {
    const result = await pool.query<SourceMapFileRowShape>(
      `SELECT ${FILE_COLUMNS}
       FROM source_map_files f
       LEFT JOIN LATERAL (
         SELECT status, processed_count, target_count, updated_at
         FROM source_map_reparse_tasks
         WHERE source_map_file_id = f.id
         ORDER BY id DESC
         LIMIT 1
       ) t ON true
       WHERE f.project_id = $1 AND f.release_id = $2 AND f.status = 'active'
       ORDER BY f.created_at DESC, f.id DESC`,
      [input.projectId, input.releaseId],
    );
    return result.rows.map(toFileRow);
  } catch (error) {
    throw toStableError(error);
  }
}

/** Get one Source Map file by id within a project (null when not found). */
export async function getSourceMapFileById(
  pool: Pool | PoolClient,
  input: { readonly projectId: string; readonly sourceMapFileId: string },
): Promise<SourceMapFileRow | null> {
  try {
    const result = await pool.query<SourceMapFileRowShape>(
      `SELECT ${FILE_COLUMNS}
       FROM source_map_files f
       LEFT JOIN LATERAL (
         SELECT status, processed_count, target_count, updated_at
         FROM source_map_reparse_tasks
         WHERE source_map_file_id = f.id
         ORDER BY id DESC
         LIMIT 1
       ) t ON true
       WHERE f.id = $1 AND f.project_id = $2`,
      [input.sourceMapFileId, input.projectId],
    );
    const row = result.rows[0];
    return row === undefined ? null : toFileRow(row);
  } catch (error) {
    throw toStableError(error);
  }
}

/**
 * Queue a bounded reparse task for a (release, source map file). The partial
 * unique index guarantees at most one active (queued/processing) task per file;
 * a completed/failed task frees the slot so a retry can queue again.
 */
export async function createReparseTask(
  pool: Pool | PoolClient,
  input: {
    readonly projectId: string;
    readonly releaseId: string;
    readonly sourceMapFileId: string;
  },
): Promise<{ readonly status: 'queued' | 'already_pending' }> {
  try {
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO source_map_reparse_tasks (project_id, release_id, source_map_file_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (release_id, source_map_file_id)
         WHERE status IN ('queued', 'processing')
         DO NOTHING
       RETURNING id`,
      [input.projectId, input.releaseId, input.sourceMapFileId],
    );
    return inserted.rows.length > 0 ? { status: 'queued' } : { status: 'already_pending' };
  } catch (error) {
    throw toStableError(error);
  }
}

/** Atomically claim the oldest pending reparse tasks (bounded, SKIP LOCKED). */
export async function claimPendingReparseTasks(
  pool: Pool | PoolClient,
  input: { readonly limit: number },
): Promise<ReparseTaskRow[]> {
  try {
    const result = await pool.query<{
      id: string;
      project_id: string;
      release_id: string;
      source_map_file_id: string;
      status: string;
      target_count: number | null;
      processed_count: number;
    }>(
      `UPDATE source_map_reparse_tasks SET status = 'processing', updated_at = now()
       WHERE id IN (
         SELECT id FROM source_map_reparse_tasks
         WHERE status = 'queued'
         ORDER BY created_at ASC, id ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING id, project_id, release_id, source_map_file_id, status, target_count, processed_count`,
      [input.limit],
    );
    return result.rows.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      releaseId: row.release_id,
      sourceMapFileId: row.source_map_file_id,
      status: row.status,
      targetCount: row.target_count,
      processedCount: row.processed_count,
    }));
  } catch (error) {
    throw toStableError(error);
  }
}

export async function updateReparseTaskProgress(
  pool: Pool | PoolClient,
  input: { readonly taskId: string; readonly processedCount: number; readonly targetCount: number },
): Promise<void> {
  try {
    await pool.query(
      `UPDATE source_map_reparse_tasks
       SET processed_count = $2, target_count = $3, updated_at = now()
       WHERE id = $1`,
      [input.taskId, input.processedCount, input.targetCount],
    );
  } catch (error) {
    throw toStableError(error);
  }
}

export async function completeReparseTask(
  pool: Pool | PoolClient,
  input: { readonly taskId: string },
): Promise<void> {
  try {
    await pool.query(
      `UPDATE source_map_reparse_tasks
       SET status = 'completed', completed_at = now(), updated_at = now()
       WHERE id = $1`,
      [input.taskId],
    );
  } catch (error) {
    throw toStableError(error);
  }
}

export async function failReparseTask(
  pool: Pool | PoolClient,
  input: { readonly taskId: string },
): Promise<void> {
  try {
    await pool.query(
      `UPDATE source_map_reparse_tasks
       SET status = 'failed', completed_at = now(), updated_at = now()
       WHERE id = $1`,
      [input.taskId],
    );
  } catch (error) {
    throw toStableError(error);
  }
}
