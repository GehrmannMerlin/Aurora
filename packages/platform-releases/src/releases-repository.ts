import type { Pool, PoolClient } from 'pg';
import { toStableError } from './errors.js';

export interface ReleaseRow {
  readonly id: string;
  readonly projectId: string;
  readonly version: string;
  readonly source: string;
  readonly firstSeenAt: Date;
  readonly sourceMapFileCount: number;
}

interface ReleaseRowShape {
  id: string;
  project_id: string;
  version: string;
  source: string;
  created_at: Date;
  source_map_file_count: number;
}

function toReleaseRow(row: ReleaseRowShape): ReleaseRow {
  return {
    id: row.id,
    projectId: row.project_id,
    version: row.version,
    source: row.source,
    firstSeenAt: row.created_at,
    sourceMapFileCount: row.source_map_file_count,
  };
}

/**
 * Upsert a release identity by (project, version string) — PRD §8.1. v1 creates
 * releases through an authorized source-map upload; the SDK-first-appearance
 * path is deferred (no release field on events yet).
 */
export async function upsertRelease(
  pool: Pool | PoolClient,
  input: { readonly projectId: string; readonly version: string },
): Promise<{ readonly status: 'inserted' | 'existing'; readonly releaseId: string }> {
  try {
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO releases (project_id, version) VALUES ($1, $2)
       ON CONFLICT (project_id, version) DO NOTHING
       RETURNING id`,
      [input.projectId, input.version],
    );
    if (inserted.rows.length > 0) {
      return { status: 'inserted', releaseId: inserted.rows[0]?.id ?? '' };
    }
    const existing = await pool.query<{ id: string }>(
      `SELECT id FROM releases WHERE project_id = $1 AND version = $2`,
      [input.projectId, input.version],
    );
    return { status: 'existing', releaseId: existing.rows[0]?.id ?? '' };
  } catch (error) {
    throw toStableError(error);
  }
}

/** List releases for a project with their active source-map file count (C8). */
export async function listReleases(
  pool: Pool | PoolClient,
  input: { readonly projectId: string },
): Promise<ReleaseRow[]> {
  try {
    const result = await pool.query<ReleaseRowShape>(
      `SELECT r.id, r.project_id, r.version, r.source, r.created_at,
              count(f.id)::int AS source_map_file_count
       FROM releases r
       LEFT JOIN source_map_files f ON f.release_id = r.id AND f.status = 'active'
       WHERE r.project_id = $1
       GROUP BY r.id
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT 200`,
      [input.projectId],
    );
    return result.rows.map(toReleaseRow);
  } catch (error) {
    throw toStableError(error);
  }
}

/** Get one release by id within a project (null when not found / cross-project). */
export async function getReleaseById(
  pool: Pool | PoolClient,
  input: { readonly projectId: string; readonly releaseId: string },
): Promise<ReleaseRow | null> {
  try {
    const result = await pool.query<ReleaseRowShape>(
      `SELECT r.id, r.project_id, r.version, r.source, r.created_at,
              count(f.id)::int AS source_map_file_count
       FROM releases r
       LEFT JOIN source_map_files f ON f.release_id = r.id AND f.status = 'active'
       WHERE r.project_id = $1 AND r.id = $2
       GROUP BY r.id`,
      [input.projectId, input.releaseId],
    );
    const row = result.rows[0];
    return row === undefined ? null : toReleaseRow(row);
  } catch (error) {
    throw toStableError(error);
  }
}
