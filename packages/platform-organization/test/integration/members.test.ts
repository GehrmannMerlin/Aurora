import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  changeOrganizationRole,
  listMembers,
  removeMember,
  transferOwnership,
} from '../../src/index.js';
import {
  addTestMember,
  assertIsTestDatabase,
  createTestAccount,
  createTestOrganization,
  createTestPool,
  queryRows,
  resetOrganizationSchema,
  runMigrationsUp,
  testDatabaseUrl,
} from './helpers.js';

const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const describeDb = hasDb ? describe : describe.skip;

describeDb('platform-organization members repository (real PostgreSQL 17)', () => {
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

  async function createOrgWithMembers(): Promise<{
    orgId: string;
    ownerId: string;
    adminId: string;
    memberId: string;
  }> {
    const ownerId = await createTestAccount(pool, `owner-${crypto.randomUUID()}@example.com`);
    const adminId = await createTestAccount(pool, `admin-${crypto.randomUUID()}@example.com`);
    const memberId = await createTestAccount(pool, `member-${crypto.randomUUID()}@example.com`);
    const orgId = await createTestOrganization(pool, 'Acme', ownerId);
    await addTestMember(pool, orgId, adminId, 'admin');
    await addTestMember(pool, orgId, memberId, 'member');
    return { orgId, ownerId, adminId, memberId };
  }

  it('listMembers returns all members with their roles', async () => {
    const { orgId, ownerId, adminId, memberId } = await createOrgWithMembers();
    const members = await listMembers(pool, orgId);
    expect(members).toHaveLength(3);
    const roles = Object.fromEntries(members.map((m) => [m.accountId, m.role]));
    expect(roles[ownerId]).toBe('owner');
    expect(roles[adminId]).toBe('admin');
    expect(roles[memberId]).toBe('member');
    const ownerFirst = members[0];
    expect(ownerFirst?.role).toBe('owner');
  });

  it('listMembers returns the account email for each member', async () => {
    const { orgId, memberId } = await createOrgWithMembers();
    const members = await listMembers(pool, orgId);
    const member = members.find((m) => m.accountId === memberId);
    expect(member?.email).toMatch(/^member-.*@example\.com$/);
  });

  it('changeOrganizationRole promotes a member to admin', async () => {
    const { orgId, ownerId, memberId } = await createOrgWithMembers();
    const result = await changeOrganizationRole(pool, {
      orgId,
      accountId: memberId,
      newRole: 'admin',
      actorId: ownerId,
    });
    expect(result).toEqual({ status: 'success', fromRole: 'member', toRole: 'admin' });
    const members = await listMembers(pool, orgId);
    expect(members.find((m) => m.accountId === memberId)?.role).toBe('admin');
  });

  it('changeOrganizationRole demotes an admin back to member', async () => {
    const { orgId, ownerId, adminId } = await createOrgWithMembers();
    const result = await changeOrganizationRole(pool, {
      orgId,
      accountId: adminId,
      newRole: 'member',
      actorId: ownerId,
    });
    expect(result).toEqual({ status: 'success', fromRole: 'admin', toRole: 'member' });
  });

  it('changeOrganizationRole is a no-op when the role is unchanged', async () => {
    const { orgId, ownerId, memberId } = await createOrgWithMembers();
    const result = await changeOrganizationRole(pool, {
      orgId,
      accountId: memberId,
      newRole: 'member',
      actorId: ownerId,
    });
    expect(result).toEqual({ status: 'success', fromRole: 'member', toRole: 'member' });
  });

  it('changeOrganizationRole rejects demoting the owner', async () => {
    const { orgId, ownerId } = await createOrgWithMembers();
    const result = await changeOrganizationRole(pool, {
      orgId,
      accountId: ownerId,
      newRole: 'member',
      actorId: ownerId,
    });
    expect(result.status).toBe('owner_derote_not_allowed');
  });

  it('changeOrganizationRole rejects making another owner', async () => {
    const { orgId, ownerId, adminId } = await createOrgWithMembers();
    const result = await changeOrganizationRole(pool, {
      orgId,
      accountId: adminId,
      newRole: 'owner',
      actorId: ownerId,
    });
    expect(result.status).toBe('owner_change_not_allowed');
  });

  it('changeOrganizationRole returns not_found for a non-member', async () => {
    const { orgId, ownerId } = await createOrgWithMembers();
    const strangerId = await createTestAccount(pool, `stranger-${crypto.randomUUID()}@example.com`);
    const result = await changeOrganizationRole(pool, {
      orgId,
      accountId: strangerId,
      newRole: 'member',
      actorId: ownerId,
    });
    expect(result.status).toBe('not_found');
  });

  it('changeOrganizationRole returns not_found for an unknown org', async () => {
    const { ownerId, memberId } = await createOrgWithMembers();
    const result = await changeOrganizationRole(pool, {
      orgId: crypto.randomUUID(),
      accountId: memberId,
      newRole: 'member',
      actorId: ownerId,
    });
    expect(result.status).toBe('not_found');
  });

  it('removeMember removes a member', async () => {
    const { orgId, ownerId, memberId } = await createOrgWithMembers();
    const result = await removeMember(pool, { orgId, accountId: memberId, actorId: ownerId });
    expect(result.status).toBe('success');
    const members = await listMembers(pool, orgId);
    expect(members.find((m) => m.accountId === memberId)).toBeUndefined();
  });

  it('removeMember blocks removing the last owner', async () => {
    const { orgId, ownerId } = await createOrgWithMembers();
    const result = await removeMember(pool, { orgId, accountId: ownerId, actorId: ownerId });
    expect(result.status).toBe('last_owner_removal_blocked');
    const members = await listMembers(pool, orgId);
    expect(members.filter((m) => m.role === 'owner')).toHaveLength(1);
    expect(members.find((m) => m.accountId === ownerId)?.role).toBe('owner');
  });

  it('removeMember returns not_found for a non-member', async () => {
    const { orgId, ownerId } = await createOrgWithMembers();
    const strangerId = await createTestAccount(pool, `stranger-${crypto.randomUUID()}@example.com`);
    const result = await removeMember(pool, { orgId, accountId: strangerId, actorId: ownerId });
    expect(result.status).toBe('not_found');
  });

  it('removeMember allows removing an owner when another owner exists (degraded state)', async () => {
    const { orgId, ownerId, adminId } = await createOrgWithMembers();
    // Raw SQL creates a second owner (normally unreachable under the invariant);
    // exercising the ownerCount > 1 path of removeMember.
    await pool.query(
      `UPDATE organization_members SET role = 'owner'
       WHERE organization_id = $1 AND account_id = $2`,
      [orgId, adminId],
    );
    const result = await removeMember(pool, { orgId, accountId: adminId, actorId: ownerId });
    expect(result.status).toBe('success');
    const members = await listMembers(pool, orgId);
    expect(members.filter((m) => m.role === 'owner')).toHaveLength(1);
  });

  it('transferOwnership moves owner to the new owner and keeps exactly one owner', async () => {
    const { orgId, ownerId, adminId } = await createOrgWithMembers();
    const result = await transferOwnership(pool, {
      orgId,
      currentOwnerId: ownerId,
      newOwnerId: adminId,
      actorId: ownerId,
    });
    expect(result).toEqual({
      status: 'success',
      previousOwnerId: ownerId,
      newOwnerId: adminId,
    });
    const members = await listMembers(pool, orgId);
    const ownerMembers = members.filter((m) => m.role === 'owner');
    expect(ownerMembers).toHaveLength(1);
    expect(ownerMembers[0]?.accountId).toBe(adminId);
    expect(members.find((m) => m.accountId === ownerId)?.role).toBe('member');
  });

  it('transferOwnership to a non-member returns not_found', async () => {
    const { orgId, ownerId } = await createOrgWithMembers();
    const strangerId = await createTestAccount(pool, `stranger-${crypto.randomUUID()}@example.com`);
    const result = await transferOwnership(pool, {
      orgId,
      currentOwnerId: ownerId,
      newOwnerId: strangerId,
      actorId: ownerId,
    });
    expect(result.status).toBe('not_found');
  });

  it('transferOwnership returns not_found when currentOwnerId is not the owner', async () => {
    const { orgId, ownerId, adminId, memberId } = await createOrgWithMembers();
    const result = await transferOwnership(pool, {
      orgId,
      currentOwnerId: adminId,
      newOwnerId: memberId,
      actorId: ownerId,
    });
    expect(result.status).toBe('not_found');
  });

  it('transferOwnership to the current owner is a no-op (already_owner)', async () => {
    const { orgId, ownerId } = await createOrgWithMembers();
    const result = await transferOwnership(pool, {
      orgId,
      currentOwnerId: ownerId,
      newOwnerId: ownerId,
      actorId: ownerId,
    });
    expect(result.status).toBe('already_owner');
  });

  it('transferOwnership to an unknown org returns not_found', async () => {
    const { ownerId, adminId } = await createOrgWithMembers();
    const result = await transferOwnership(pool, {
      orgId: crypto.randomUUID(),
      currentOwnerId: ownerId,
      newOwnerId: adminId,
      actorId: ownerId,
    });
    expect(result.status).toBe('not_found');
  });

  it('member mutations write audit rows in the same transaction', async () => {
    const { orgId, ownerId, memberId } = await createOrgWithMembers();
    await changeOrganizationRole(pool, {
      orgId,
      accountId: memberId,
      newRole: 'admin',
      actorId: ownerId,
    });
    await removeMember(pool, { orgId, accountId: memberId, actorId: ownerId });
    const events = await queryRows<{ action: string; target_account_id: string | null }>(
      pool,
      'SELECT action, target_account_id FROM security_audit_events WHERE organization_id = $1 ORDER BY occurred_at ASC',
      [orgId],
    );
    const actions = events.map((e) => e.action);
    expect(actions).toContain('organization.member.role_changed');
    expect(actions).toContain('organization.member.removed');
  });

  it('transferOwnership writes an ownership audit event', async () => {
    const { orgId, ownerId, adminId } = await createOrgWithMembers();
    await transferOwnership(pool, {
      orgId,
      currentOwnerId: ownerId,
      newOwnerId: adminId,
      actorId: ownerId,
    });
    const events = await queryRows<{ action: string; target_account_id: string | null }>(
      pool,
      "SELECT action, target_account_id FROM security_audit_events WHERE organization_id = $1 AND action = 'organization.ownership_transferred'",
      [orgId],
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.target_account_id).toBe(adminId);
  });

  it('repository functions accept a leased PoolClient for composition', async () => {
    const { orgId, ownerId, memberId } = await createOrgWithMembers();
    const client = await pool.connect();
    try {
      const members = await listMembers(client, orgId);
      expect(members).toHaveLength(3);
      const result = await transferOwnership(client, {
        orgId,
        currentOwnerId: ownerId,
        newOwnerId: memberId,
        actorId: ownerId,
      });
      expect(result.status).toBe('success');
    } finally {
      client.release();
    }
  });
});
