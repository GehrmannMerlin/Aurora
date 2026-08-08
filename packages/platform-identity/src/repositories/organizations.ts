import type { Pool, PoolClient } from 'pg';
import { isUniqueViolation, PlatformIdentityError, toStableError } from '../errors.js';
import { isoTimestamp } from './timestamp.js';
import { isPoolClient, withTransaction } from './transaction.js';

export type OrganizationRole = 'owner' | 'admin' | 'member';
export type ProjectRole = 'project_admin' | 'developer' | 'read_only';

/** camelCase projection of the organizations table. */
export interface OrganizationRow {
  readonly organizationId: string;
  readonly name: string;
  readonly kind: 'personal' | 'organization';
  readonly timezone: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreatePersonalOrganizationInput {
  readonly name: string;
  readonly accountId: string;
}

export type CreatePersonalOrganizationResult =
  | { readonly status: 'success'; readonly organizationId: string }
  | { readonly status: 'conflict' };

export interface InsertMembershipInput {
  readonly organizationId: string;
  readonly accountId: string;
  readonly role: OrganizationRole;
}

export interface InsertProjectMembershipInput {
  readonly projectId: string;
  readonly accountId: string;
  readonly role: ProjectRole;
}

export type MembershipMutationResult =
  | { readonly status: 'success' }
  | { readonly status: 'already_member' };

/** camelCase projection of the organization_invitations table. */
export interface InvitationRow {
  readonly invitationId: string;
  readonly organizationId: string;
  readonly invitedEmail: string;
  readonly orgRole: string;
  readonly tokenDigest: string;
  readonly expiresAt: string;
  readonly status: 'pending' | 'accepted' | 'revoked' | 'expired';
  readonly acceptedAt: string | null;
  readonly createdAt: string;
}

export interface CreateInvitationInput {
  readonly organizationId: string;
  readonly invitedEmail: string;
  readonly orgRole: OrganizationRole;
  readonly tokenDigest: string;
  readonly expiresAt: Date;
}

export type CreateInvitationResult =
  | { readonly status: 'success'; readonly invitationId: string }
  | { readonly status: 'conflict' };

export type InvitationMutationResult = { readonly status: 'success' } | { readonly status: 'not_found' };

interface OrganizationRowShape {
  organization_id: string;
  name: string;
  kind: 'personal' | 'organization';
  timezone: string;
  created_at: string;
  updated_at: string;
}

interface InvitationRowShape {
  invitation_id: string;
  organization_id: string;
  invited_email: string;
  org_role: string;
  token_digest: string;
  expires_at: string;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  accepted_at: string | null;
  created_at: string;
}

function toOrganizationRow(row: OrganizationRowShape): OrganizationRow {
  return {
    organizationId: row.organization_id,
    name: row.name,
    kind: row.kind,
    timezone: row.timezone,
    createdAt: isoTimestamp(row.created_at) as string,
    updatedAt: isoTimestamp(row.updated_at) as string,
  };
}

function toInvitationRow(row: InvitationRowShape): InvitationRow {
  return {
    invitationId: row.invitation_id,
    organizationId: row.organization_id,
    invitedEmail: row.invited_email,
    orgRole: row.org_role,
    tokenDigest: row.token_digest,
    expiresAt: isoTimestamp(row.expires_at) as string,
    status: row.status,
    acceptedAt: isoTimestamp(row.accepted_at),
    createdAt: isoTimestamp(row.created_at) as string,
  };
}

const INSERT_ORGANIZATION_SQL = `
  INSERT INTO organizations (name, kind)
  VALUES ($1, 'personal')
  RETURNING organization_id, created_at, updated_at
`;

const INSERT_OWNER_MEMBERSHIP_SQL = `
  INSERT INTO organization_members (organization_id, account_id, role)
  VALUES ($1, $2, 'owner')
`;

/** The personal workspace org + single owner membership write (composable). */
async function runCreatePersonalOrganization(
  client: PoolClient,
  input: CreatePersonalOrganizationInput,
): Promise<{ organizationId: string }> {
  const inserted = await client.query<{
    organization_id: string;
    created_at: string;
    updated_at: string;
  }>(INSERT_ORGANIZATION_SQL, [input.name]);
  const row = inserted.rows[0];
  if (row === undefined) {
    throw new PlatformIdentityError('statement_failed', 'organization insert returned no row');
  }
  await client.query(INSERT_OWNER_MEMBERSHIP_SQL, [row.organization_id, input.accountId]);
  return { organizationId: row.organization_id };
}

/**
 * Atomically create a personal workspace organization plus its single owner
 * membership (spec §4.6 owner invariant). When given a `Pool` this opens a
 * transaction; when given an already-leased `PoolClient` it runs directly on
 * the caller's transaction (so the platform-api layer can compose it with the
 * account / intent / outbox / idempotency writes atomically). `conflict` on a
 * unique violation (e.g. an owner membership already occupying the composite
 * key path).
 */
export async function createPersonalOrganization(
  pool: Pool | PoolClient,
  input: CreatePersonalOrganizationInput,
): Promise<CreatePersonalOrganizationResult> {
  try {
    const { organizationId } = isPoolClient(pool)
      ? await runCreatePersonalOrganization(pool, input)
      : await withTransaction(pool, (client) => runCreatePersonalOrganization(client, input));
    return { status: 'success', organizationId };
  } catch (error) {
    if (isUniqueViolation(error)) return { status: 'conflict' };
    throw toStableError(error);
  }
}

/** Add an organization membership; `already_member` when the pair exists. */
export async function insertOrganizationMembership(
  pool: Pool | PoolClient,
  input: InsertMembershipInput,
): Promise<MembershipMutationResult> {
  try {
    const result = await pool.query(
      `INSERT INTO organization_members (organization_id, account_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (organization_id, account_id) DO NOTHING
       RETURNING account_id`,
      [input.organizationId, input.accountId, input.role],
    );
    return result.rows.length === 0 ? { status: 'already_member' } : { status: 'success' };
  } catch (error) {
    throw toStableError(error);
  }
}

/** Add a project membership (invitation-accept write target). */
export async function insertProjectMembership(
  pool: Pool | PoolClient,
  input: InsertProjectMembershipInput,
): Promise<MembershipMutationResult> {
  try {
    const result = await pool.query(
      `INSERT INTO project_members (project_id, account_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (project_id, account_id) DO NOTHING
       RETURNING account_id`,
      [input.projectId, input.accountId, input.role],
    );
    return result.rows.length === 0 ? { status: 'already_member' } : { status: 'success' };
  } catch (error) {
    throw toStableError(error);
  }
}

/**
 * Create an organization invitation. `conflict` when a pending invitation for
 * the same (organization_id, invited_email) already exists (partial unique
 * index) or the token digest collides.
 */
export async function createInvitation(
  pool: Pool | PoolClient,
  input: CreateInvitationInput,
): Promise<CreateInvitationResult> {
  try {
    const result = await pool.query<{ invitation_id: string }>(
      `INSERT INTO organization_invitations
         (organization_id, invited_email, org_role, token_digest, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING invitation_id`,
      [
        input.organizationId,
        input.invitedEmail,
        input.orgRole,
        input.tokenDigest,
        input.expiresAt.toISOString(),
      ],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new PlatformIdentityError('statement_failed', 'invitation insert returned no row');
    }
    return { status: 'success', invitationId: row.invitation_id };
  } catch (error) {
    if (isUniqueViolation(error)) return { status: 'conflict' };
    throw toStableError(error);
  }
}

/** Find an invitation by its token digest; null when absent. */
export async function findInvitationByDigest(
  pool: Pool | PoolClient,
  digest: string,
): Promise<InvitationRow | null> {
  try {
    const result = await pool.query<InvitationRowShape>(
      `SELECT invitation_id, organization_id, invited_email, org_role, token_digest,
              expires_at, status, accepted_at, created_at
       FROM organization_invitations
       WHERE token_digest = $1`,
      [digest],
    );
    const row = result.rows[0];
    return row === undefined ? null : toInvitationRow(row);
  } catch (error) {
    throw toStableError(error);
  }
}

/** Transition an invitation status; accepted_at is set only on acceptance. */
export async function updateInvitationStatus(
  pool: Pool | PoolClient,
  invitationId: string,
  status: 'pending' | 'accepted' | 'revoked' | 'expired',
  now: Date,
): Promise<InvitationMutationResult> {
  try {
    const result = await pool.query(
      `UPDATE organization_invitations
       SET status = $2,
           accepted_at = CASE WHEN $2 = 'accepted' THEN $3 ELSE accepted_at END
       WHERE invitation_id = $1
       RETURNING invitation_id`,
      [invitationId, status, now.toISOString()],
    );
    return result.rows.length === 0 ? { status: 'not_found' } : { status: 'success' };
  } catch (error) {
    throw toStableError(error);
  }
}

/** Get an organization by primary key; null when absent. */
export async function findOrganizationById(
  pool: Pool | PoolClient,
  organizationId: string,
): Promise<OrganizationRow | null> {
  try {
    const result = await pool.query<OrganizationRowShape>(
      `SELECT organization_id, name, kind, timezone, created_at, updated_at
       FROM organizations
       WHERE organization_id = $1`,
      [organizationId],
    );
    const row = result.rows[0];
    return row === undefined ? null : toOrganizationRow(row);
  } catch (error) {
    throw toStableError(error);
  }
}
