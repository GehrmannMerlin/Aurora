import { describe, expect, it } from 'vitest';
import {
  OPERATION_ID_ACCESS_CHANGE_ROLE,
  OPERATION_ID_ACCESS_GRANT,
  OPERATION_ID_ACCESS_LIST,
  OPERATION_ID_ACCESS_REMOVE,
  accessChangeProjectRoleBody,
  accessGrantProjectMembershipBody,
  accessListEffectiveMembersResponse,
  accessRemoveProjectMembershipBody,
} from '../../src/project-governance/access.js';

describe('C13 access contract', () => {
  it('freezes the operation ids', () => {
    expect(OPERATION_ID_ACCESS_LIST).toBe('accessListEffectiveMembers');
    expect(OPERATION_ID_ACCESS_GRANT).toBe('accessGrantProjectMembership');
    expect(OPERATION_ID_ACCESS_CHANGE_ROLE).toBe('accessChangeProjectRole');
    expect(OPERATION_ID_ACCESS_REMOVE).toBe('accessRemoveProjectMembership');
  });

  it('accepts an effective-member response with org-inherited + project-member sources', () => {
    const result = accessListEffectiveMembersResponse.zod.safeParse({
      data: {
        status: 'available',
        data: {
          items: [
            {
              accountId: 'acc_1',
              maskedEmail: 'a***@example.com',
              effectiveRole: 'project_admin',
              sources: ['org_inherited', 'project_member'],
              projectRole: 'project_admin',
              allowedActions: ['read', 'manage'],
            },
            {
              accountId: 'acc_2',
              maskedEmail: 'b***@example.com',
              effectiveRole: 'read_only',
              sources: ['project_member'],
              projectRole: 'read_only',
              allowedActions: ['read'],
            },
          ],
        },
      },
      meta: { requestId: 'req_1', readAt: '2026-08-12T00:00:00.000Z', normalizedQuery: {} },
      allowedActions: ['read'],
      navigationTargets: [],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an empty sources list (a person must have a source)', () => {
    const result = accessListEffectiveMembersResponse.zod.safeParse({
      data: {
        status: 'available',
        data: { items: [{ accountId: 'acc_1', maskedEmail: 'a***@example.com', effectiveRole: 'developer', sources: [], allowedActions: ['read'] }] },
      },
      meta: { requestId: 'req_1', readAt: '2026-08-12T00:00:00.000Z', normalizedQuery: {} },
      allowedActions: ['read'],
      navigationTargets: [],
    });
    expect(result.success).toBe(false);
  });

  it('grant body requires a frozen project role and an idempotency key', () => {
    expect(
      accessGrantProjectMembershipBody.zod.safeParse({
        accountId: 'acc_1',
        role: 'developer',
        idempotencyKey: 'k'.repeat(36),
      }).success,
    ).toBe(true);
    expect(
      accessGrantProjectMembershipBody.zod.safeParse({
        accountId: 'acc_1',
        role: 'owner',
        idempotencyKey: 'k'.repeat(36),
      }).success,
    ).toBe(false);
    expect(
      accessGrantProjectMembershipBody.zod.safeParse({
        accountId: 'acc_1',
        role: 'developer',
      }).success,
    ).toBe(false);
  });

  it('change-role and remove bodies are contract-valid', () => {
    expect(
      accessChangeProjectRoleBody.zod.safeParse({ role: 'project_admin', idempotencyKey: 'k'.repeat(36) }).success,
    ).toBe(true);
    expect(
      accessRemoveProjectMembershipBody.zod.safeParse({ idempotencyKey: 'k'.repeat(36) }).success,
    ).toBe(true);
  });
});
