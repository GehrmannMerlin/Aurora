import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createAccount,
  createInvitation,
  createPersonalOrganization,
  findInvitationByDigest,
  findOrganizationById,
  insertOrganizationMembership,
  insertProjectMembership,
  updateInvitationStatus,
} from '../../src/index.js';
import {
  assertIsTestDatabase,
  createTestPool,
  queryRow,
  resetIdentitySchema,
  runMigrationsUp,
  testDatabaseUrl,
  toIso,
} from './helpers.js';

const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const describeDb = hasDb ? describe : describe.skip;

describeDb('platform-identity organizations repository (real PostgreSQL 17)', () => {
  let pool: Pool;

  beforeAll(async () => {
    assertIsTestDatabase(testDatabaseUrl());
    pool = createTestPool();
    await resetIdentitySchema(pool);
    await runMigrationsUp();
  });

  afterAll(async () => {
    await pool.end();
  });

  async function createFreshAccountId(): Promise<string> {
    const suffix = crypto.randomUUID();
    const email = `org-${suffix}@example.com`;
    const result = await createAccount(pool, {
      email,
      emailNormalized: email.toLowerCase(),
      passwordHash: 'hash',
      status: 'active',
    });
    if (result.status !== 'success') throw new Error('expected account creation');
    return result.account.accountId;
  }

  it('createPersonalOrganization creates the org and a single owner membership', async () => {
    const accountId = await createFreshAccountId();
    const result = await createPersonalOrganization(pool, {
      name: 'Personal Workspace',
      accountId,
    });
    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    const org = await queryRow<{ kind: string; name: string }>(
      pool,
      'SELECT kind, name FROM organizations WHERE organization_id = $1',
      [result.organizationId],
    );
    expect(org?.kind).toBe('personal');
    expect(org?.name).toBe('Personal Workspace');
    const member = await queryRow<{ role: string }>(
      pool,
      'SELECT role FROM organization_members WHERE organization_id = $1 AND account_id = $2',
      [result.organizationId, accountId],
    );
    expect(member?.role).toBe('owner');
  });

  it('insertOrganizationMembership adds a member; duplicate returns already_member', async () => {
    const accountId = await createFreshAccountId();
    const org = await createPersonalOrganization(pool, { name: 'W', accountId });
    if (org.status !== 'success') throw new Error('expected org creation');
    const memberId = await createFreshAccountId();
    const added = await insertOrganizationMembership(pool, {
      organizationId: org.organizationId,
      accountId: memberId,
      role: 'member',
    });
    expect(added).toEqual({ status: 'success' });
    const again = await insertOrganizationMembership(pool, {
      organizationId: org.organizationId,
      accountId: memberId,
      role: 'member',
    });
    expect(again).toEqual({ status: 'already_member' });
  });

  it('insertProjectMembership adds a project member; duplicate returns already_member', async () => {
    const accountId = await createFreshAccountId();
    const projectId = crypto.randomUUID();
    const added = await insertProjectMembership(pool, {
      projectId,
      accountId,
      role: 'developer',
    });
    expect(added).toEqual({ status: 'success' });
    const again = await insertProjectMembership(pool, {
      projectId,
      accountId,
      role: 'developer',
    });
    expect(again).toEqual({ status: 'already_member' });
  });

  it('createInvitation returns conflict for a duplicate pending invitation', async () => {
    const accountId = await createFreshAccountId();
    const org = await createPersonalOrganization(pool, { name: 'W', accountId });
    if (org.status !== 'success') throw new Error('expected org creation');
    const invitedEmail = 'invitee@example.com';
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const first = await createInvitation(pool, {
      organizationId: org.organizationId,
      invitedEmail,
      orgRole: 'member',
      tokenDigest: 'x'.repeat(64),
      expiresAt,
    });
    expect(first.status).toBe('success');
    const second = await createInvitation(pool, {
      organizationId: org.organizationId,
      invitedEmail,
      orgRole: 'member',
      tokenDigest: 'y'.repeat(64),
      expiresAt,
    });
    expect(second.status).toBe('conflict');
  });

  it('createInvitation allows a new invitation after the previous one is revoked', async () => {
    const accountId = await createFreshAccountId();
    const org = await createPersonalOrganization(pool, { name: 'W', accountId });
    if (org.status !== 'success') throw new Error('expected org creation');
    const invitedEmail = 'revoke-reinvite@example.com';
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const first = await createInvitation(pool, {
      organizationId: org.organizationId,
      invitedEmail,
      orgRole: 'member',
      tokenDigest: 'p'.repeat(64),
      expiresAt,
    });
    if (first.status !== 'success') throw new Error('expected invitation insert');
    await updateInvitationStatus(pool, first.invitationId, 'revoked', new Date());
    const second = await createInvitation(pool, {
      organizationId: org.organizationId,
      invitedEmail,
      orgRole: 'member',
      tokenDigest: 'q'.repeat(64),
      expiresAt,
    });
    expect(second.status).toBe('success');
  });

  it('findInvitationByDigest finds by digest; null for unknown', async () => {
    const accountId = await createFreshAccountId();
    const org = await createPersonalOrganization(pool, { name: 'W', accountId });
    if (org.status !== 'success') throw new Error('expected org creation');
    const created = await createInvitation(pool, {
      organizationId: org.organizationId,
      invitedEmail: 'findme@example.com',
      orgRole: 'admin',
      tokenDigest: 'r'.repeat(64),
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    if (created.status !== 'success') throw new Error('expected invitation insert');
    const found = await findInvitationByDigest(pool, 'r'.repeat(64));
    expect(found?.invitedEmail).toBe('findme@example.com');
    expect(found?.orgRole).toBe('admin');
    expect(found?.organizationId).toBe(org.organizationId);
    const missing = await findInvitationByDigest(pool, 's'.repeat(64));
    expect(missing).toBeNull();
  });

  it('updateInvitationStatus sets status and accepted_at only on acceptance', async () => {
    const accountId = await createFreshAccountId();
    const org = await createPersonalOrganization(pool, { name: 'W', accountId });
    if (org.status !== 'success') throw new Error('expected org creation');
    const created = await createInvitation(pool, {
      organizationId: org.organizationId,
      invitedEmail: 'accept@example.com',
      orgRole: 'member',
      tokenDigest: 't'.repeat(64),
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    if (created.status !== 'success') throw new Error('expected invitation insert');
    const now = new Date('2026-08-09T12:00:00.000Z');
    const revoked = await updateInvitationStatus(pool, created.invitationId, 'revoked', now);
    expect(revoked).toEqual({ status: 'success' });
    let row = await queryRow<{ status: string; accepted_at: string | null }>(
      pool,
      'SELECT status, accepted_at FROM organization_invitations WHERE invitation_id = $1',
      [created.invitationId],
    );
    expect(row?.status).toBe('revoked');
    expect(row?.accepted_at).toBeNull();

    await updateInvitationStatus(pool, created.invitationId, 'accepted', now);
    row = await queryRow<{ status: string; accepted_at: string | null }>(
      pool,
      'SELECT status, accepted_at FROM organization_invitations WHERE invitation_id = $1',
      [created.invitationId],
    );
    expect(row?.status).toBe('accepted');
    expect(row?.accepted_at).not.toBeNull();
    expect(toIso(row?.accepted_at)).toBe(now.toISOString());

    const missing = await updateInvitationStatus(pool, crypto.randomUUID(), 'expired', now);
    expect(missing).toEqual({ status: 'not_found' });
  });

  it('findOrganizationById returns the org; null for unknown', async () => {
    const accountId = await createFreshAccountId();
    const org = await createPersonalOrganization(pool, { name: 'Lookup', accountId });
    if (org.status !== 'success') throw new Error('expected org creation');
    const found = await findOrganizationById(pool, org.organizationId);
    expect(found?.name).toBe('Lookup');
    expect(found?.kind).toBe('personal');
    const missing = await findOrganizationById(pool, crypto.randomUUID());
    expect(missing).toBeNull();
  });
});
