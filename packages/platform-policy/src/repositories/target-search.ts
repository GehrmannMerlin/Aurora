import type { Pool, PoolClient } from 'pg';
import { PlatformPolicyError, toStableError } from '../errors.js';

/**
 * @aurora/platform-policy — resource-policy target search repository (PLT-10b,
 * ADR-035). Read-only prefix search over the identity/governance target tables
 * consumed by the D2 resource-policy target picker: organizations of
 * `kind = 'organization'` and projects with `status IN ('active','archived')`.
 *
 * Name matching is a case-insensitive ILIKE prefix (`name ILIKE $1 || '%'`)
 * with `%`/`_`/`\` escaped so user input is matched literally. Results are
 * bounded per target kind (default 25, capped at 50) and sorted by name ASC with
 * an id tiebreaker (`organization_id`/`project_id`) so the order is a total
 * order (deterministic even with duplicate names). An empty (or whitespace-only)
 * query applies no name filter and returns the first `limit` targets of each
 * kind. DB failures are wrapped as the stable `PlatformPolicyError` surface;
 * invalid limit input throws `invalid_input` synchronously.
 */

export interface PolicyTargetSearchInput {
  readonly query?: string;
  readonly limit?: number;
}

export interface PolicyTargetOrganization {
  readonly organizationId: string;
  readonly name: string;
}

export interface PolicyTargetProject {
  readonly projectId: string;
  readonly organizationId: string;
  readonly name: string;
}

export interface PolicyTargetSearchResult {
  readonly organizations: readonly PolicyTargetOrganization[];
  readonly projects: readonly PolicyTargetProject[];
}

interface OrganizationTargetRow {
  organization_id: string;
  name: string;
}

interface ProjectTargetRow {
  project_id: string;
  organization_id: string;
  name: string;
}

const DEFAULT_TARGET_SEARCH_LIMIT = 25;
const MAX_TARGET_SEARCH_LIMIT = 50;

/** Escape LIKE metacharacters (`\`, `%`, `_`) so user input is matched literally. */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function requireLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_TARGET_SEARCH_LIMIT;
  if (!Number.isInteger(value) || value < 1) {
    throw new PlatformPolicyError('invalid_input', 'limit must be a positive integer');
  }
  return Math.min(value, MAX_TARGET_SEARCH_LIMIT);
}

/**
 * Search resource-policy targets by name prefix. Returns two bounded lists
 * (organizations then projects), each sorted by name ASC. `query` is trimmed and
 * matched with a case-insensitive prefix; `%`/`_` in the query are literal. A
 * blank query returns the first `limit` targets of each kind.
 */
export async function searchPolicyTargets(
  pool: Pool | PoolClient,
  input: PolicyTargetSearchInput = {},
): Promise<PolicyTargetSearchResult> {
  try {
    const limit = requireLimit(input.limit);
    const query = input.query?.trim() ?? '';
    const pattern = query.length === 0 ? undefined : escapeLikePattern(query);
    const hasFilter = pattern !== undefined;

    const organizations = await pool.query<OrganizationTargetRow>(
      `SELECT organization_id, name
         FROM organizations
        WHERE kind = 'organization'
          ${hasFilter ? `AND name ILIKE $1 || '%' ESCAPE '\\'` : ''}
        ORDER BY name ASC, organization_id ASC
        LIMIT ${hasFilter ? '$2' : '$1'}`,
      hasFilter ? [pattern, limit] : [limit],
    );

    const projects = await pool.query<ProjectTargetRow>(
      `SELECT project_id, organization_id, name
         FROM projects
        WHERE status IN ('active', 'archived')
          ${hasFilter ? `AND name ILIKE $1 || '%' ESCAPE '\\'` : ''}
        ORDER BY name ASC, project_id ASC
        LIMIT ${hasFilter ? '$2' : '$1'}`,
      hasFilter ? [pattern, limit] : [limit],
    );

    return {
      organizations: organizations.rows.map((row) => ({
        organizationId: row.organization_id,
        name: row.name,
      })),
      projects: projects.rows.map((row) => ({
        projectId: row.project_id,
        organizationId: row.organization_id,
        name: row.name,
      })),
    };
  } catch (error) {
    if (error instanceof PlatformPolicyError && error.kind === 'invalid_input') throw error;
    throw toStableError(error);
  }
}
