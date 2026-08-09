import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  inviteMember,
  listPendingInvitations,
  resendInvitation,
  revokeInvitation,
  type InviteMemberInput,
} from '../../src/index.js';
import {
  assertIsTestDatabase,
  addTestMember,
  createTestAccount,
  createTestOrganization,
  createTestPool,
  queryRow,
  queryRows,
  resetOrganizationSchema,
  runMigrationsUp,
  testDatabaseUrl,
} from './helpers.js';

const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const describeDb = hasDb ? describe : describe.skip;

describeDb('platform-organization invitations repository (real PostgreSQL 17)', () => {
  let pool: Pool;

  beforeAll(async () => {
    assertIsTestDatabase(testDatabaseUrl());
    pool = createTestPool();
    await resetOrganizationSchema(pool);
    await runMigrationsUp();
  });

  afterAll(async () => {
    await pool.end();
  });

  async function createOrgWithOwner(): Promise<{ orgId: string; ownerId: string }> {
    const ownerId = await createTestAccount(pool, `owner-${crypto.randomUUID()}@example.com`);
    const orgId = await createTestOrganization(pool, 'Acme', ownerId);
    return { orgId, ownerId };
  }

  function futureExpiry(hours = 7 * 24): Date {
    return new Date(Date.now() + hours * 60 * 60 * 1000);
  }

  it('inviteMember creates a pending invitation and writes audit', async () => {
    const { orgId, ownerId } = await createOrgWithOwner();
    const invitedEmail = `invitee-${crypto.randomUUID()}@example.com`;
    const result = await inviteMember(pool, {
      orgId,
      invitedEmail,
      orgRole: 'member',
      tokenDigest: 'a'.repeat(64),
      expiresAt: futureExpiry(),
      actorId: ownerId,
    });
    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    const row = await queryRow<{ status: string; invited_email: string; org_role: string }>(
      pool,
      'SELECT status, invited_email, org_role FROM organization_invitations WHERE invitation_id = $1',
      [result.invitationId],
    );
    expect(row?.status).toBe('pending');
    expect(row?.invited_email).toBe(invitedEmail.trim().toLowerCase());
    expect(row?.org_role).toBe('member');
    const audit = await queryRows<{ action: string; details: unknown }>(
      pool,
      "SELECT action, details FROM security_audit_events WHERE organization_id = $1 AND action = 'organization.invitation.created'",
      [orgId],
    );
    expect(audit).toHaveLength(1);
    const details = audit[0]?.details as { invitedEmailMasked?: string } | undefined;
    expect(details?.invitedEmailMasked).toBe(`${invitedEmail.charAt(0)}***@example.com`);
  });

  it('inviteMember returns pending_conflict for a duplicate pending invitation', async () => {
    const { orgId, ownerId } = await createOrgWithOwner();
    const invitedEmail = `dup-${crypto.randomUUID()}@example.com`;
    const first = await inviteMember(pool, {
      orgId,
      invitedEmail,
      orgRole: 'member',
      tokenDigest: 'b'.repeat(64),
      expiresAt: futureExpiry(),
      actorId: ownerId,
    });
    expect(first.status).toBe('success');
    const second = await inviteMember(pool, {
      orgId,
      invitedEmail,
      orgRole: 'admin',
      tokenDigest: 'c'.repeat(64),
      expiresAt: futureExpiry(),
      actorId: ownerId,
    });
    expect(second.status).toBe('pending_conflict');
  });

  it('inviteMember returns already_member when the email belongs to a current member', async () => {
    const { orgId, ownerId } = await createOrgWithOwner();
    const memberEmail = `member-${crypto.randomUUID()}@example.com`;
    const memberId = await createTestAccount(pool, memberEmail);
    await addTestMember(pool, orgId, memberId, 'member');
    const result = await inviteMember(pool, {
      orgId,
      invitedEmail: memberEmail,
      orgRole: 'member',
      tokenDigest: 'd'.repeat(64),
      expiresAt: futureExpiry(),
      actorId: ownerId,
    });
    expect(result.status).toBe('already_member');
  });

  it('inviteMember allows inviting an existing account that is not a member', async () => {
    const { orgId, ownerId } = await createOrgWithOwner();
    const outsiderEmail = `outsider-${crypto.randomUUID()}@example.com`;
    const outsiderId = await createTestAccount(pool, outsiderEmail);
    void outsiderId;
    const result = await inviteMember(pool, {
      orgId,
      invitedEmail: outsiderEmail,
      orgRole: 'admin',
      tokenDigest: 'z'.repeat(64),
      expiresAt: futureExpiry(),
      actorId: ownerId,
    });
    expect(result.status).toBe('success');
  });

  it('inviteMember rejects for an unknown organization', async () => {
    const { ownerId } = await createOrgWithOwner();
    await expect(
      inviteMember(pool, {
        orgId: crypto.randomUUID(),
        invitedEmail: `nobody-${crypto.randomUUID()}@example.com`,
        orgRole: 'member',
        tokenDigest: 'y'.repeat(64),
        expiresAt: futureExpiry(),
        actorId: ownerId,
      }),
    ).rejects.toMatchObject({ kind: 'statement_failed' });
  });

  it('inviteMember allows a new invitation after the previous one is revoked', async () => {
    const { orgId, ownerId } = await createOrgWithOwner();
    const invitedEmail = `revoke-reinvite-${crypto.randomUUID()}@example.com`;
    const first = await inviteMember(pool, {
      orgId,
      invitedEmail,
      orgRole: 'member',
      tokenDigest: 'e'.repeat(64),
      expiresAt: futureExpiry(),
      actorId: ownerId,
    });
    if (first.status !== 'success') throw new Error('expected invite insert');
    const revoked = await revokeInvitation(pool, {
      invitationId: first.invitationId,
      actorId: ownerId,
    });
    expect(revoked.status).toBe('success');
    const second = await inviteMember(pool, {
      orgId,
      invitedEmail,
      orgRole: 'member',
      tokenDigest: 'f'.repeat(64),
      expiresAt: futureExpiry(),
      actorId: ownerId,
    });
    expect(second.status).toBe('success');
  });

  it('revokeInvitation transitions a pending invitation to revoked', async () => {
    const { orgId, ownerId } = await createOrgWithOwner();
    const created = await inviteMember(pool, {
      orgId,
      invitedEmail: `revoke-${crypto.randomUUID()}@example.com`,
      orgRole: 'member',
      tokenDigest: 'g'.repeat(64),
      expiresAt: futureExpiry(),
      actorId: ownerId,
    });
    if (created.status !== 'success') throw new Error('expected invite');
    const revoked = await revokeInvitation(pool, {
      invitationId: created.invitationId,
      actorId: ownerId,
    });
    expect(revoked.status).toBe('success');
    const row = await queryRow<{ status: string }>(
      pool,
      'SELECT status FROM organization_invitations WHERE invitation_id = $1',
      [created.invitationId],
    );
    expect(row?.status).toBe('revoked');
  });

  it('revokeInvitation returns not_found for a non-pending invitation', async () => {
    const { orgId, ownerId } = await createOrgWithOwner();
    const created = await inviteMember(pool, {
      orgId,
      invitedEmail: `revoked-${crypto.randomUUID()}@example.com`,
      orgRole: 'member',
      tokenDigest: 'h'.repeat(64),
      expiresAt: futureExpiry(),
      actorId: ownerId,
    });
    if (created.status !== 'success') throw new Error('expected invite');
    await revokeInvitation(pool, { invitationId: created.invitationId, actorId: ownerId });
    const again = await revokeInvitation(pool, {
      invitationId: created.invitationId,
      actorId: ownerId,
    });
    expect(again.status).toBe('not_found');
  });

  it('resendInvitation replaces the token digest and expiry while keeping pending', async () => {
    const { orgId, ownerId } = await createOrgWithOwner();
    const created = await inviteMember(pool, {
      orgId,
      invitedEmail: `resend-${crypto.randomUUID()}@example.com`,
      orgRole: 'member',
      tokenDigest: 'i'.repeat(64),
      expiresAt: futureExpiry(),
      actorId: ownerId,
    });
    if (created.status !== 'success') throw new Error('expected invite');
    const resent = await resendInvitation(pool, {
      invitationId: created.invitationId,
      actorId: ownerId,
    });
    expect(resent.status).toBe('success');
    if (resent.status !== 'success') return;
    expect(resent.invitationId).toBe(created.invitationId);
    expect(resent.tokenDigest).not.toBe('i'.repeat(64));
    expect(resent.token).toHaveLength(43);
    const row = await queryRow<{ status: string; token_digest: string }>(
      pool,
      'SELECT status, token_digest FROM organization_invitations WHERE invitation_id = $1',
      [created.invitationId],
    );
    expect(row?.status).toBe('pending');
    expect(row?.token_digest).toBe(resent.tokenDigest);
  });

  it('resendInvitation returns not_found for a non-pending invitation', async () => {
    const { orgId, ownerId } = await createOrgWithOwner();
    const created = await inviteMember(pool, {
      orgId,
      invitedEmail: `resend-missing-${crypto.randomUUID()}@example.com`,
      orgRole: 'member',
      tokenDigest: 'j'.repeat(64),
      expiresAt: futureExpiry(),
      actorId: ownerId,
    });
    if (created.status !== 'success') throw new Error('expected invite');
    await revokeInvitation(pool, { invitationId: created.invitationId, actorId: ownerId });
    const resent = await resendInvitation(pool, {
      invitationId: created.invitationId,
      actorId: ownerId,
    });
    expect(resent.status).toBe('not_found');
  });

  it('listPendingInvitations returns only pending invitations', async () => {
    const { orgId, ownerId } = await createOrgWithOwner();
    const email1 = `p1-${crypto.randomUUID()}@example.com`;
    const email2 = `p2-${crypto.randomUUID()}@example.com`;
    const c1 = await inviteMember(pool, {
      orgId,
      invitedEmail: email1,
      orgRole: 'admin',
      tokenDigest: 'k'.repeat(64),
      expiresAt: futureExpiry(),
      actorId: ownerId,
    });
    const c2 = await inviteMember(pool, {
      orgId,
      invitedEmail: email2,
      orgRole: 'member',
      tokenDigest: 'l'.repeat(64),
      expiresAt: futureExpiry(),
      actorId: ownerId,
    });
    if (c1.status !== 'success' || c2.status !== 'success') throw new Error('expected invites');
    await revokeInvitation(pool, { invitationId: c1.invitationId, actorId: ownerId });
    const pending = await listPendingInvitations(pool, orgId);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.invitationId).toBe(c2.invitationId);
    expect(pending[0]?.invitedEmail).toBe(email2);
    expect(pending[0]?.status).toBe('pending');
  });

  it('inviteMember rejects an owner-role invitation (owner-unique invariant)', async () => {
    const { orgId, ownerId } = await createOrgWithOwner();
    const ownerEmail = `owner-invite-${crypto.randomUUID()}@example.com`;
    // `orgRole: 'owner'` is not expressible in the narrowed public input type
    // (InviteMemberInput.orgRole = 'admin' | 'member'); cast through unknown to
    // exercise the runtime defense-in-depth guard.
    const input = {
      orgId,
      invitedEmail: ownerEmail,
      orgRole: 'owner',
      tokenDigest: 'w'.repeat(64),
      expiresAt: futureExpiry(),
      actorId: ownerId,
    } as unknown;
    await expect(inviteMember(pool, input as InviteMemberInput)).rejects.toMatchObject({
      kind: 'invalid_input',
    });
    // No invitation row (of any status) was created.
    const rows = await queryRows<{ count: string }>(
      pool,
      'SELECT count(*)::int AS count FROM organization_invitations WHERE invited_email = $1',
      [ownerEmail],
    );
    expect(rows[0]?.count).toBe(0);
  });
});
