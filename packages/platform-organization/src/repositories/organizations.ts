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

/** camelCase projection of an account's membership joined with its org identity. */
export interface AccountOrganizationMembership {
  readonly organizationId: string;
  readonly name: string;
  readonly kind: 'personal' | 'organization';
  readonly role: OrganizationRole;
}

export interface FindMembershipInput {
  readonly orgId: string;
  readonly accountId: string;
}

export interface IsUniqueOrganizationOwnerInput {
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

interface AccountOrganizationMembershipRowShape {
  organization_id: string;
  name: string;
  kind: 'personal' | 'organization';
  role: OrganizationRole;
}

interface OwnerCountRowShape {
  owner_count: number;
}

interface IsUniqueOwnerRowShape {
  is_unique: boolean;
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

function toAccountOrganizationMembership(
  row: AccountOrganizationMembershipRowShape,
): AccountOrganizationMembership {
  return {
    organizationId: row.organization_id,
    name: row.name,
    kind: row.kind,
    role: row.role,
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

/**
 * Count the owners of an organization (same SQL shape as the owner-count read
 * in `members.ts`; read-only). Returns 0 when the organization is absent.
 */
const OWNER_COUNT_SQL = `
  SELECT count(*)::int AS owner_count
  FROM organization_members
  WHERE organization_id = $1 AND role = 'owner'
`;

/**
 * List every organization the account belongs to, joined with the org identity,
 * oldest membership-org first (created_at ASC, then organization_id). Returns an
 * empty array for an account with no memberships. Read-only.
 */
export async function listAccountOrganizations(
  pool: Pool | PoolClient,
  accountId: string,
): Promise<AccountOrganizationMembership[]> {
  try {
    const result = await pool.query<AccountOrganizationMembershipRowShape>(
      `SELECT o.organization_id, o.name, o.kind, m.role
       FROM organization_members m
       JOIN organizations o ON o.organization_id = m.organization_id
       WHERE m.account_id = $1
       ORDER BY o.created_at ASC, o.organization_id ASC`,
      [accountId],
    );
    return result.rows.map(toAccountOrganizationMembership);
  } catch (error) {
    throw toStableError(error);
  }
}

/** Count the owners of an organization; 0 when the organization is absent. */
export async function countOrganizationOwners(
  pool: Pool | PoolClient,
  orgId: string,
): Promise<number> {
  try {
    const result = await pool.query<OwnerCountRowShape>(OWNER_COUNT_SQL, [orgId]);
    return result.rows[0]?.owner_count ?? 0;
  } catch (error) {
    throw toStableError(error);
  }
}

/**
 * True iff the account is an owner of the organization and the organization has
 * exactly one owner. Read-only. A single round-trip: the EXISTS membership
 * predicate short-circuits so the owner-count subquery only runs against the
 * account's own organization. Returns false for a non-member, a non-owner member,
 * a second owner in a multi-owner (degraded) org, or an unknown org.
 */
export async function isUniqueOrganizationOwner(
  pool: Pool | PoolClient,
  input: IsUniqueOrganizationOwnerInput,
): Promise<boolean> {
  try {
    const result = await pool.query<IsUniqueOwnerRowShape>(
      `SELECT EXISTS (
         SELECT 1 FROM organization_members
         WHERE organization_id = $1 AND account_id = $2 AND role = 'owner'
       )
       AND (
         SELECT count(*) FROM organization_members
         WHERE organization_id = $1 AND role = 'owner'
       ) = 1 AS is_unique`,
      [input.orgId, input.accountId],
    );
    return result.rows[0]?.is_unique ?? false;
  } catch (error) {
    throw toStableError(error);
  }
}
