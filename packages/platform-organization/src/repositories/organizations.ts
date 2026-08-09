import type { Pool, PoolClient } from 'pg';
import { toStableError } from '../errors.js';
import { isoTimestamp } from './timestamp.js';

export type OrganizationRole = 'owner' | 'admin' | 'member';

/** camelCase projection of the organizations table (PLT-04 settings version). */
export interface OrganizationRow {
  readonly organizationId: string;
  readonly name: string;
  readonly kind: 'personal' | 'organization';
  readonly timezone: string;
  /** Optimistic concurrency version for B4 timezone updates. */
  readonly settingsVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** camelCase projection of an organization_members row. */
export interface MembershipRow {
  readonly organizationId: string;
  readonly accountId: string;
  readonly role: OrganizationRole;
  readonly createdAt: string;
}

export interface FindMembershipInput {
  readonly orgId: string;
  readonly accountId: string;
}

interface OrganizationRowShape {
  organization_id: string;
  name: string;
  kind: 'personal' | 'organization';
  timezone: string;
  settings_version: number;
  created_at: string;
  updated_at: string;
}

interface MembershipRowShape {
  organization_id: string;
  account_id: string;
  role: OrganizationRole;
  created_at: string;
}

function toOrganizationRow(row: OrganizationRowShape): OrganizationRow {
  return {
    organizationId: row.organization_id,
    name: row.name,
    kind: row.kind,
    timezone: row.timezone,
    settingsVersion: row.settings_version,
    createdAt: isoTimestamp(row.created_at),
    updatedAt: isoTimestamp(row.updated_at),
  };
}

function toMembershipRow(row: MembershipRowShape): MembershipRow {
  return {
    organizationId: row.organization_id,
    accountId: row.account_id,
    role: row.role,
    createdAt: isoTimestamp(row.created_at),
  };
}

const ORGANIZATION_SELECT = `
  SELECT organization_id, name, kind, timezone, settings_version, created_at, updated_at
  FROM organizations
`;

/** Get an organization by primary key; null when absent. */
export async function getOrganizationById(
  pool: Pool | PoolClient,
  organizationId: string,
): Promise<OrganizationRow | null> {
  try {
    const result = await pool.query<OrganizationRowShape>(
      `${ORGANIZATION_SELECT} WHERE organization_id = $1`,
      [organizationId],
    );
    const row = result.rows[0];
    return row === undefined ? null : toOrganizationRow(row);
  } catch (error) {
    throw toStableError(error);
  }
}

/** Get a single membership row; null when the pair is absent. */
export async function findMembership(
  pool: Pool | PoolClient,
  input: FindMembershipInput,
): Promise<MembershipRow | null> {
  try {
    const result = await pool.query<MembershipRowShape>(
      `SELECT organization_id, account_id, role, created_at
       FROM organization_members
       WHERE organization_id = $1 AND account_id = $2`,
      [input.orgId, input.accountId],
    );
    const row = result.rows[0];
    return row === undefined ? null : toMembershipRow(row);
  } catch (error) {
    throw toStableError(error);
  }
}
