import { describe, expect, it } from 'vitest';
import {
  buildAccessView,
  canManageMember,
  effectiveRoleLabel,
  sourceLabel,
} from '../../../src/views/project/access-view-model.js';
import type { EffectiveMember } from '../../../src/monitoring/queries.js';

const inheritedMember: EffectiveMember = {
  accountId: 'acc_1',
  maskedEmail: 'a***@example.com',
  effectiveRole: 'project_admin',
  sources: ['org_inherited'],
  allowedActions: ['read'],
};

const explicitMember: EffectiveMember = {
  accountId: 'acc_2',
  maskedEmail: 'b***@example.com',
  effectiveRole: 'developer',
  sources: ['project_member'],
  projectRole: 'developer',
  allowedActions: ['read', 'manage'],
};

describe('buildAccessView', () => {
  it('unwraps available members and surfaces missing as unavailable', () => {
    const view = buildAccessView({
      loading: false,
      error: null,
      members: { status: 'available', data: { items: [inheritedMember, explicitMember] } },
    });
    expect(view.members.kind).toBe('available');
    if (view.members.kind === 'available') expect(view.members.data).toHaveLength(2);
  });

  it('never invents zero for empty/unavailable and prioritizes error', () => {
    const empty = buildAccessView({
      loading: false,
      error: null,
      members: { status: 'empty', reason: 'none' },
    });
    expect(empty.members.kind).toBe('empty');
    const errorView = buildAccessView({ loading: false, error: '加载失败', members: null });
    expect(errorView.members).toEqual({ kind: 'error', message: '加载失败' });
  });
});

describe('row capabilities', () => {
  it('org-inherited rows are read-only, explicit rows carry manage', () => {
    expect(canManageMember(inheritedMember)).toBe(false);
    expect(canManageMember(explicitMember)).toBe(true);
  });

  it('labels roles and sources', () => {
    expect(effectiveRoleLabel('project_admin')).toBe('项目管理员');
    expect(effectiveRoleLabel('read_only')).toBe('只读成员');
    expect(sourceLabel('org_inherited')).toBe('组织继承');
    expect(sourceLabel('project_member')).toBe('项目成员');
  });
});
