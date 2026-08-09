import { afterEach, describe, expect, it, vi } from 'vitest';
import { effectivePermissions, MEMBER_ACTIONS, ORG_MANAGER_ACTIONS } from '../src/authorization.js';

const findMembershipMock = vi.hoisted(() => ({ findMembership: vi.fn() }));

vi.mock('@aurora/platform-organization', () => ({
  findMembership: findMembershipMock.findMembership,
}));

/**
 * Unit surface of the effective-permission projection (spec §6). The data-layer
 * read is mocked; the projection rules (role -> isOrgManager/isOwner/
 * allowedActions) are pure and asserted here without a database.
 */
describe('effectivePermissions', () => {
  const deps = { pool: {} as never };

  afterEach(() => {
    findMembershipMock.findMembership.mockReset();
  });

  it('returns an empty projection for a non-member', async () => {
    findMembershipMock.findMembership.mockResolvedValue(null);

    const permissions = await effectivePermissions('account-1', 'org-1', deps);

    expect(permissions.orgRole).toBeNull();
    expect(permissions.isOrgManager).toBe(false);
    expect(permissions.isOwner).toBe(false);
    expect(permissions.allowedActions).toEqual([]);
  });

  it('returns the full manager action set for an owner', async () => {
    findMembershipMock.findMembership.mockResolvedValue({
      organizationId: 'org-1',
      accountId: 'account-1',
      role: 'owner',
      createdAt: '2026-08-09T00:00:00.000Z',
    });

    const permissions = await effectivePermissions('account-1', 'org-1', deps);

    expect(permissions.orgRole).toBe('owner');
    expect(permissions.isOrgManager).toBe(true);
    expect(permissions.isOwner).toBe(true);
    expect(permissions.allowedActions).toEqual(ORG_MANAGER_ACTIONS);
  });

  it('returns the full manager action set for an admin (but not owner)', async () => {
    findMembershipMock.findMembership.mockResolvedValue({
      organizationId: 'org-1',
      accountId: 'account-1',
      role: 'admin',
      createdAt: '2026-08-09T00:00:00.000Z',
    });

    const permissions = await effectivePermissions('account-1', 'org-1', deps);

    expect(permissions.orgRole).toBe('admin');
    expect(permissions.isOrgManager).toBe(true);
    expect(permissions.isOwner).toBe(false);
    expect(permissions.allowedActions).toEqual(ORG_MANAGER_ACTIONS);
  });

  it('returns no manager actions for a plain member', async () => {
    findMembershipMock.findMembership.mockResolvedValue({
      organizationId: 'org-1',
      accountId: 'account-1',
      role: 'member',
      createdAt: '2026-08-09T00:00:00.000Z',
    });

    const permissions = await effectivePermissions('account-1', 'org-1', deps);

    expect(permissions.orgRole).toBe('member');
    expect(permissions.isOrgManager).toBe(false);
    expect(permissions.isOwner).toBe(false);
    expect(permissions.allowedActions).toEqual(MEMBER_ACTIONS);
  });

  it('re-reads the membership row on every call (no cached roles)', async () => {
    findMembershipMock.findMembership
      .mockResolvedValueOnce({
        organizationId: 'org-1',
        accountId: 'account-1',
        role: 'admin',
        createdAt: '2026-08-09T00:00:00.000Z',
      })
      .mockResolvedValueOnce(null);

    const first = await effectivePermissions('account-1', 'org-1', deps);
    const second = await effectivePermissions('account-1', 'org-1', deps);

    expect(first.orgRole).toBe('admin');
    expect(first.allowedActions).toEqual(ORG_MANAGER_ACTIONS);
    expect(second.orgRole).toBeNull();
    expect(second.allowedActions).toEqual([]);
    expect(findMembershipMock.findMembership).toHaveBeenCalledTimes(2);
    expect(findMembershipMock.findMembership).toHaveBeenCalledWith(deps.pool, {
      orgId: 'org-1',
      accountId: 'account-1',
    });
  });
});
