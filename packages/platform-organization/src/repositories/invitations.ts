import type { Pool, PoolClient } from 'pg';
import { isUniqueViolation, PlatformOrganizationError, toStableError } from '../errors.js';
import { createIntentToken, maskEmail, normalizeEmail } from '../intent-token.js';
import { insertAuditEvent } from './audit.js';
import { isoTimestamp } from './timestamp.js';
import { isPoolClient, withTransaction } from './transaction.js';
import type { OrganizationRole } from './organizations.js';

const DEFAULT_INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** camelCase projection of an organization_invitations row (no token digest). */
export interface InvitationRow {
  readonly invitationId: string;
  readonly organizationId: string;
  readonly invitedEmail: string;
  readonly orgRole: OrganizationRole;
  readonly expiresAt: string;
  readonly status: 'pending' | 'accepted' | 'revoked' | 'expired';
  readonly createdAt: string;
}

export interface InviteMemberInput {
  readonly orgId: string;
  readonly invitedEmail: string;
  readonly orgRole: OrganizationRole;
  /** SHA-256 digest of the one-time invitation token; the raw token never reaches the DB. */
  readonly tokenDigest: string;
  readonly expiresAt: Date;
  readonly actorId: string;
}

export type InviteMemberResult =
  | {
      readonly status: 'success';
      readonly invitationId: string;
      readonly expiresAt: string;
    }
  | { readonly status: 'pending_conflict' }
  | { readonly status: 'already_member' };

export interface RevokeInvitationInput {
  readonly invitationId: string;
  readonly actorId: string;
}

export type RevokeInvitationResult =
  { readonly status: 'success' } | { readonly status: 'not_found' };

export interface ResendInvitationInput {
  readonly invitationId: string;
  readonly actorId: string;
  readonly expiresAt?: Date;
}

export type ResendInvitationResult =
  | {
      readonly status: 'success';
      readonly invitationId: string;
      readonly token: string;
      readonly tokenDigest: string;
      readonly expiresAt: string;
    }
  | { readonly status: 'not_found' };

interface InvitationRowShape {
  invitation_id: string;
  organization_id: string;
  invited_email: string;
  org_role: OrganizationRole;
  expires_at: string;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  created_at: string;
}

function toInvitationRow(row: InvitationRowShape): InvitationRow {
  return {
    invitationId: row.invitation_id,
    organizationId: row.organization_id,
    invitedEmail: row.invited_email,
    orgRole: row.org_role,
    expiresAt: isoTimestamp(row.expires_at),
    status: row.status,
    createdAt: isoTimestamp(row.created_at),
  };
}

async function runInviteMember(
  client: PoolClient,
  input: InviteMemberInput,
): Promise<InviteMemberResult> {
  const normalizedEmail = normalizeEmail(input.invitedEmail);
  // An email that already belongs to a member of this org cannot be re-invited.
  const existing = await client.query<{ account_id: string }>(
    `SELECT account_id FROM accounts WHERE email_normalized = $1`,
    [normalizedEmail],
  );
  const existingAccount = existing.rows[0];
  if (existingAccount !== undefined) {
    const member = await client.query(
      `SELECT 1 FROM organization_members WHERE organization_id = $1 AND account_id = $2`,
      [input.orgId, existingAccount.account_id],
    );
    if (member.rows.length > 0) return { status: 'already_member' };
  }
  try {
    const inserted = await client.query<{ invitation_id: string }>(
      `INSERT INTO organization_invitations
         (organization_id, invited_email, org_role, token_digest, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING invitation_id`,
      [
        input.orgId,
        normalizedEmail,
        input.orgRole,
        input.tokenDigest,
        input.expiresAt.toISOString(),
      ],
    );
    const row = inserted.rows[0];
    if (row === undefined) {
      throw new PlatformOrganizationError('statement_failed', 'invitation insert returned no row');
    }
    await insertAuditEvent(client, {
      organizationId: input.orgId,
      actorAccountId: input.actorId,
      action: 'organization.invitation.created',
      details: { invitedEmailMasked: maskEmail(normalizedEmail) },
    });
    return {
      status: 'success',
      invitationId: row.invitation_id,
      expiresAt: input.expiresAt.toISOString(),
    };
  } catch (error) {
    if (isUniqueViolation(error)) return { status: 'pending_conflict' };
    throw error;
  }
}

/**
 * Create an organization invitation atomically with its audit row.
 * `pending_conflict` when a pending invitation for the same
 * (organization_id, invited_email) already exists (partial unique index);
 * `already_member` when the email belongs to a current member.
 */
export async function inviteMember(
  pool: Pool | PoolClient,
  input: InviteMemberInput,
): Promise<InviteMemberResult> {
  try {
    return isPoolClient(pool)
      ? await runInviteMember(pool, input)
      : await withTransaction(pool, (client) => runInviteMember(client, input));
  } catch (error) {
    throw toStableError(error);
  }
}

async function runRevokeInvitation(
  client: PoolClient,
  input: RevokeInvitationInput,
): Promise<RevokeInvitationResult> {
  const updated = await client.query<{ organization_id: string }>(
    `UPDATE organization_invitations
     SET status = 'revoked'
     WHERE invitation_id = $1 AND status = 'pending'
     RETURNING organization_id`,
    [input.invitationId],
  );
  const row = updated.rows[0];
  if (row === undefined) return { status: 'not_found' };
  await insertAuditEvent(client, {
    organizationId: row.organization_id,
    actorAccountId: input.actorId,
    action: 'organization.invitation.revoked',
    details: { invitationId: input.invitationId },
  });
  return { status: 'success' };
}

/**
 * Revoke a pending invitation (pending → revoked). Accepted/expired/revoked
 * invitations return `not_found` (a revoked invitation cannot be revoked again).
 */
export async function revokeInvitation(
  pool: Pool | PoolClient,
  input: RevokeInvitationInput,
): Promise<RevokeInvitationResult> {
  try {
    return isPoolClient(pool)
      ? await runRevokeInvitation(pool, input)
      : await withTransaction(pool, (client) => runRevokeInvitation(client, input));
  } catch (error) {
    throw toStableError(error);
  }
}

async function runResendInvitation(
  client: PoolClient,
  input: ResendInvitationInput,
): Promise<ResendInvitationResult> {
  const { token, digest } = createIntentToken();
  const expiresAt = input.expiresAt ?? new Date(Date.now() + DEFAULT_INVITATION_TTL_MS);
  const updated = await client.query<{ organization_id: string }>(
    `UPDATE organization_invitations
     SET token_digest = $2, expires_at = $3
     WHERE invitation_id = $1 AND status = 'pending'
     RETURNING organization_id`,
    [input.invitationId, digest, expiresAt.toISOString()],
  );
  const row = updated.rows[0];
  if (row === undefined) return { status: 'not_found' };
  await insertAuditEvent(client, {
    organizationId: row.organization_id,
    actorAccountId: input.actorId,
    action: 'organization.invitation.resent',
    details: { invitationId: input.invitationId },
  });
  return {
    status: 'success',
    invitationId: input.invitationId,
    token,
    tokenDigest: digest,
    expiresAt: expiresAt.toISOString(),
  };
}

/**
 * Re-send a pending invitation: replaces the token digest with a freshly
 * generated one and resets the expiry while keeping status `pending`. The raw
 * token is returned once so the service can enqueue the email (only the digest
 * is persisted).
 */
export async function resendInvitation(
  pool: Pool | PoolClient,
  input: ResendInvitationInput,
): Promise<ResendInvitationResult> {
  try {
    return isPoolClient(pool)
      ? await runResendInvitation(pool, input)
      : await withTransaction(pool, (client) => runResendInvitation(client, input));
  } catch (error) {
    throw toStableError(error);
  }
}

/** List the pending invitations of an organization (oldest first). */
export async function listPendingInvitations(
  pool: Pool | PoolClient,
  orgId: string,
): Promise<InvitationRow[]> {
  try {
    const result = await pool.query<InvitationRowShape>(
      `SELECT invitation_id, organization_id, invited_email, org_role, expires_at, status, created_at
       FROM organization_invitations
       WHERE organization_id = $1 AND status = 'pending'
       ORDER BY created_at ASC, invitation_id ASC`,
      [orgId],
    );
    return result.rows.map(toInvitationRow);
  } catch (error) {
    throw toStableError(error);
  }
}
