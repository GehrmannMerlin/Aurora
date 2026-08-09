import { describe, expect, it } from 'vitest';
import {
  OPERATION_ID_CHANGE_ROLE,
  OPERATION_ID_LIST_MEMBERS,
  OPERATION_ID_REMOVE_MEMBER,
  OPERATION_ID_TRANSFER_OWNERSHIP,
  organizationChangeRoleRequest,
  organizationChangeRoleResponse,
  organizationListMembersRequest,
  organizationListMembersResponse,
  organizationRemoveMemberRequest,
  organizationRemoveMemberResponse,
  organizationTransferOwnershipRequest,
  organizationTransferOwnershipResponse,
} from '../../src/organization/members.js';

const listResponse = {
  members: [
    { accountId: 'acct_test_1', emailMasked: 'us**@example.invalid', orgRole: 'owner' },
    {
      accountId: 'acct_test_2',
      emailMasked: 'ne**@example.invalid',
      orgRole: 'member',
      joinedAt: '2026-08-09T01:00:00.000Z',
    },
  ],
  navigationTargets: [],
};

describe('organizationListMembers contract', () => {
  it('has the frozen operation id', () => {
    expect(OPERATION_ID_LIST_MEMBERS).toBe('organizationListMembers');
  });

  it('accepts a valid members request', () => {
    expect(organizationListMembersRequest.zod.safeParse({ organizationId: 'org_1' }).success).toBe(
      true,
    );
  });

  it('rejects a missing organizationId', () => {
    expect(organizationListMembersRequest.zod.safeParse({}).success).toBe(false);
  });

  it('accepts a valid members response', () => {
    expect(organizationListMembersResponse.zod.safeParse(listResponse).success).toBe(true);
  });

  it('rejects an unknown member field (closed object)', () => {
    const leaked = {
      members: [
        {
          accountId: 'acct_test_1',
          emailMasked: 'us**@example.invalid',
          orgRole: 'owner',
          email: 'user@example.invalid',
        },
      ],
      navigationTargets: [],
    };
    expect(organizationListMembersResponse.zod.safeParse(leaked).success).toBe(false);
  });
});

describe('organizationChangeRole contract', () => {
  it('has the frozen operation id', () => {
    expect(OPERATION_ID_CHANGE_ROLE).toBe('organizationChangeRole');
  });

  it('accepts a valid change-role request', () => {
    expect(
      organizationChangeRoleRequest.zod.safeParse({ orgRole: 'admin', resourceVersion: 'v1' })
        .success,
    ).toBe(true);
  });

  it('rejects owner as a target role', () => {
    expect(
      organizationChangeRoleRequest.zod.safeParse({ orgRole: 'owner', resourceVersion: 'v1' })
        .success,
    ).toBe(false);
  });

  it('rejects a missing resourceVersion', () => {
    expect(organizationChangeRoleRequest.zod.safeParse({ orgRole: 'admin' }).success).toBe(false);
  });

  it('rejects an unknown request field (closed object)', () => {
    expect(
      organizationChangeRoleRequest.zod.safeParse({
        orgRole: 'admin',
        resourceVersion: 'v1',
        accountId: 'acct_test_1',
      }).success,
    ).toBe(false);
  });

  it('accepts a valid change-role response', () => {
    expect(
      organizationChangeRoleResponse.zod.safeParse({
        accountId: 'acct_test_1',
        orgRole: 'admin',
        resourceVersion: 'v1',
      }).success,
    ).toBe(true);
  });
});

describe('organizationRemoveMember contract', () => {
  it('has the frozen operation id', () => {
    expect(OPERATION_ID_REMOVE_MEMBER).toBe('organizationRemoveMember');
  });

  it('accepts a valid remove request', () => {
    expect(organizationRemoveMemberRequest.zod.safeParse({ resourceVersion: 'v1' }).success).toBe(
      true,
    );
  });

  it('rejects a missing resourceVersion', () => {
    expect(organizationRemoveMemberRequest.zod.safeParse({}).success).toBe(false);
  });

  it('accepts a valid remove response', () => {
    expect(
      organizationRemoveMemberResponse.zod.safeParse({
        status: 'succeeded',
        accountId: 'acct_test_1',
      }).success,
    ).toBe(true);
  });
});

describe('organizationTransferOwnership contract', () => {
  it('has the frozen operation id', () => {
    expect(OPERATION_ID_TRANSFER_OWNERSHIP).toBe('organizationTransferOwnership');
  });

  it('accepts a valid transfer request', () => {
    expect(
      organizationTransferOwnershipRequest.zod.safeParse({
        newOwnerAccountId: 'acct_test_2',
        idempotencyKey: 'k'.repeat(36),
      }).success,
    ).toBe(true);
  });

  it('rejects a missing newOwnerAccountId', () => {
    expect(
      organizationTransferOwnershipRequest.zod.safeParse({ idempotencyKey: 'k'.repeat(36) })
        .success,
    ).toBe(false);
  });

  it('accepts a valid transfer response', () => {
    expect(
      organizationTransferOwnershipResponse.zod.safeParse({
        organizationId: 'org_1',
        ownerAccountId: 'acct_test_2',
        resourceVersion: 'v1',
        navigationTargets: [],
      }).success,
    ).toBe(true);
  });
});
