import type { Pool, PoolClient } from 'pg';
import { PlatformOrganizationError, toStableError } from '../errors.js';
import { insertAuditEvent } from './audit.js';
import { isoTimestamp } from './timestamp.js';
import { isPoolClient, withTransaction } from './transaction.js';
import type { OrganizationRole } from './organizations.js';

/** camelCase projection of an organization_members row joined with the account email. */
export interface MemberRow {
  readonly organizationId: string;
  readonly accountId: string;
  readonly email: string;
  readonly role: OrganizationRole;
  readonly createdAt: string;
}

export interface ChangeRoleInput {
  readonly orgId: string;
  readonly accountId: string;
  readonly newRole: OrganizationRole;
  readonly actorId: string;
}

export type ChangeRoleResult =
  | {
      readonly status: 'success';
      readonly fromRole: OrganizationRole;
      readonly toRole: OrganizationRole;
    }
  | { readonly status: 'not_found' }
  | { readonly status: 'owner_derote_not_allowed' }
  | { readonly status: 'owner_change_not_allowed' };

export interface RemoveMemberInput {
  readonly orgId: string;
  readonly accountId: string;
  readonly actorId: string;
}

export type RemoveMemberResult =
  | { readonly status: 'success' }
  | { readonly status: 'not_found' }
  | { readonly status: 'last_owner_removal_blocked' };

export interface TransferOwnershipInput {
  readonly orgId: string;
  readonly currentOwnerId: string;
  readonly newOwnerId: string;
  readonly actorId: string;
}

export type TransferOwnershipResult =
  | {
      readonly status: 'success';
      readonly previousOwnerId: string;
      readonly newOwnerId: string;
    }
  | { readonly status: 'not_found' }
  | { readonly status: 'already_owner' }
  | { readonly status: 'owner_invariant_violation' };

interface MemberRowShape {
  organization_id: string;
  account_id: string;
  email: string;
  role: OrganizationRole;
  created_at: string;
}

interface RoleRowShape {
  role: OrganizationRole;
}

function toMemberRow(row: MemberRowShape): MemberRow {
  return {
    organizationId: row.organization_id,
    accountId: row.account_id,
    email: row.email,
    role: row.role,
    createdAt: isoTimestamp(row.created_at),
  };
}

/**
 * Serialize every owner-invariant membership mutation for an organization by
 * taking a row lock on the organization itself. All of changeOrganizationRole,
 * removeMember and transferOwnership take this lock first, so the owner-count
 * reads below are stable for the duration of each transaction.
 */
const LOCK_ORG_SQL = `SELECT organization_id FROM organizations WHERE organization_id = $1 FOR UPDATE`;

const LOCK_MEMBER_ROLE_SQL = `
  SELECT role FROM organization_members
  WHERE organization_id = $1 AND account_id = $2
  FOR UPDATE
`;

const OWNER_COUNT_SQL = `
  SELECT count(*)::int AS owner_count
  FROM organization_members
  WHERE organization_id = $1 AND role = 'owner'
`;

/** List the members of an organization (owner first, then oldest). */
export async function listMembers(pool: Pool | PoolClient, orgId: string): Promise<MemberRow[]> {
  try {
    const result = await pool.query<MemberRowShape>(
      `SELECT m.organization_id, m.account_id, a.email, m.role, m.created_at
       FROM organization_members m
       JOIN accounts a ON a.account_id = m.account_id
       WHERE m.organization_id = $1
       ORDER BY (m.role = 'owner') DESC, m.created_at ASC, m.account_id ASC`,
      [orgId],
    );
    return result.rows.map(toMemberRow);
  } catch (error) {
    throw toStableError(error);
  }
}

async function runChangeOrganizationRole(
  client: PoolClient,
  input: ChangeRoleInput,
): Promise<ChangeRoleResult> {
  const orgLock = await client.query(LOCK_ORG_SQL, [input.orgId]);
  if (orgLock.rows.length === 0) return { status: 'not_found' };
  const member = await client.query<RoleRowShape>(LOCK_MEMBER_ROLE_SQL, [
    input.orgId,
    input.accountId,
  ]);
  const row = member.rows[0];
  if (row === undefined) return { status: 'not_found' };
  if (input.newRole === 'owner') return { status: 'owner_change_not_allowed' };
  if (row.role === 'owner') return { status: 'owner_derote_not_allowed' };
  if (row.role === input.newRole) {
    return { status: 'success', fromRole: row.role, toRole: input.newRole };
  }
  await client.query(
    `UPDATE organization_members SET role = $3
     WHERE organization_id = $1 AND account_id = $2`,
    [input.orgId, input.accountId, input.newRole],
  );
  await insertAuditEvent(client, {
    organizationId: input.orgId,
    actorAccountId: input.actorId,
    action: 'organization.member.role_changed',
    targetAccountId: input.accountId,
    details: { fromRole: row.role, toRole: input.newRole, changedByAccountId: input.actorId },
  });
  return { status: 'success', fromRole: row.role, toRole: input.newRole };
}

/**
 * Change a member's organization role. The owner role is never reachable
 * through this command: demoting an owner (owner → non-owner) and promoting a
 * member to owner are both rejected; ownership changes must go through
 * `transferOwnership`. The owner invariant is enforced transactionally via the
 * organization row lock.
 */
export async function changeOrganizationRole(
  pool: Pool | PoolClient,
  input: ChangeRoleInput,
): Promise<ChangeRoleResult> {
  try {
    return isPoolClient(pool)
      ? await runChangeOrganizationRole(pool, input)
      : await withTransaction(pool, (client) => runChangeOrganizationRole(client, input));
  } catch (error) {
    throw toStableError(error);
  }
}

async function runRemoveMember(
  client: PoolClient,
  input: RemoveMemberInput,
): Promise<RemoveMemberResult> {
  const orgLock = await client.query(LOCK_ORG_SQL, [input.orgId]);
  if (orgLock.rows.length === 0) return { status: 'not_found' };
  const member = await client.query<RoleRowShape>(LOCK_MEMBER_ROLE_SQL, [
    input.orgId,
    input.accountId,
  ]);
  const row = member.rows[0];
  if (row === undefined) return { status: 'not_found' };
  if (row.role === 'owner') {
    const owners = await client.query<{ owner_count: number }>(OWNER_COUNT_SQL, [input.orgId]);
    const ownerCount = owners.rows[0]?.owner_count ?? 0;
    if (ownerCount <= 1) return { status: 'last_owner_removal_blocked' };
  }
  await client.query(
    `DELETE FROM organization_members WHERE organization_id = $1 AND account_id = $2`,
    [input.orgId, input.accountId],
  );
  await insertAuditEvent(client, {
    organizationId: input.orgId,
    actorAccountId: input.actorId,
    action: 'organization.member.removed',
    targetAccountId: input.accountId,
    details: { removedByAccountId: input.actorId },
  });
  return { status: 'success' };
}

/**
 * Remove a member. Removing the last (only) owner is blocked so the
 * exactly-one-owner invariant can never be broken. Transactional.
 */
export async function removeMember(
  pool: Pool | PoolClient,
  input: RemoveMemberInput,
): Promise<RemoveMemberResult> {
  try {
    return isPoolClient(pool)
      ? await runRemoveMember(pool, input)
      : await withTransaction(pool, (client) => runRemoveMember(client, input));
  } catch (error) {
    throw toStableError(error);
  }
}

async function runTransferOwnership(
  client: PoolClient,
  input: TransferOwnershipInput,
): Promise<TransferOwnershipResult> {
  const orgLock = await client.query(LOCK_ORG_SQL, [input.orgId]);
  if (orgLock.rows.length === 0) return { status: 'not_found' };
  const current = await client.query<RoleRowShape>(LOCK_MEMBER_ROLE_SQL, [
    input.orgId,
    input.currentOwnerId,
  ]);
  const currentRow = current.rows[0];
  if (currentRow?.role !== 'owner') return { status: 'not_found' };
  const next = await client.query<RoleRowShape>(LOCK_MEMBER_ROLE_SQL, [
    input.orgId,
    input.newOwnerId,
  ]);
  const nextRow = next.rows[0];
  if (nextRow === undefined) return { status: 'not_found' };
  if (nextRow.role === 'owner') return { status: 'already_owner' };
  const owners = await client.query<{ owner_count: number }>(OWNER_COUNT_SQL, [input.orgId]);
  if ((owners.rows[0]?.owner_count ?? 0) !== 1) return { status: 'owner_invariant_violation' };

  await client.query(
    `UPDATE organization_members SET role = 'member'
     WHERE organization_id = $1 AND account_id = $2`,
    [input.orgId, input.currentOwnerId],
  );
  await client.query(
    `UPDATE organization_members SET role = 'owner'
     WHERE organization_id = $1 AND account_id = $2`,
    [input.orgId, input.newOwnerId],
  );

  // Defense-in-depth: with the org row locked, the swap is serialized and the
  // count below must be exactly one. If it is not, throw so the transaction
  // rolls back (never commit a broken owner state).
  const after = await client.query<{ owner_count: number }>(OWNER_COUNT_SQL, [input.orgId]);
  if ((after.rows[0]?.owner_count ?? 0) !== 1) {
    throw new PlatformOrganizationError(
      'statement_failed',
      'owner invariant violated after transfer',
    );
  }

  await insertAuditEvent(client, {
    organizationId: input.orgId,
    actorAccountId: input.actorId,
    action: 'organization.ownership_transferred',
    targetAccountId: input.newOwnerId,
    details: {
      previousOwnerAccountId: input.currentOwnerId,
      newOwnerAccountId: input.newOwnerId,
      transferredByAccountId: input.actorId,
    },
  });
  return {
    status: 'success',
    previousOwnerId: input.currentOwnerId,
    newOwnerId: input.newOwnerId,
  };
}

/**
 * Transfer the single owner role from the current owner to another member.
 * Transactional: locks the organization row plus both member rows, verifies
 * exactly one owner post-commit, and never commits a zero- or two-owner state.
 */
export async function transferOwnership(
  pool: Pool | PoolClient,
  input: TransferOwnershipInput,
): Promise<TransferOwnershipResult> {
  try {
    return isPoolClient(pool)
      ? await runTransferOwnership(pool, input)
      : await withTransaction(pool, (client) => runTransferOwnership(client, input));
  } catch (error) {
    throw toStableError(error);
  }
}
