/**
 * C13 项目访问 view-model（PLT-08）。
 *
 * 只消费 `accessListEffectiveMembers`（C13）服务端权威投影：每人一行、来源分离
 * （组织继承只读 / 项目显式可操作）、`allowedActions` 行级操作提示。前端不合并
 * 组织成员表与项目成员表，不推断角色并集。
 */
import type { EffectiveMember } from '../../monitoring/queries.js';
import type { SectionResult, SectionView } from '../../monitoring/section.js';

export interface AccessViewState {
  readonly members: SectionView<readonly EffectiveMember[]>;
}

export interface AccessSource {
  readonly loading: boolean;
  readonly error: string | null;
  readonly members: SectionResult<{ readonly items: readonly EffectiveMember[] }> | null;
}

export function memberSectionToItems(
  section: SectionResult<{ readonly items: readonly EffectiveMember[] }>,
): SectionView<readonly EffectiveMember[]> {
  switch (section.status) {
    case 'available':
      return { kind: 'available', data: section.data.items };
    case 'empty':
      return { kind: 'empty', reason: section.reason };
    case 'partial':
      return { kind: 'partial', data: section.data.items, missing: section.missing };
    case 'stale':
      return {
        kind: 'stale',
        data: section.data.items,
        freshAt: section.freshAt,
        staleReason: section.staleReason,
      };
    case 'forbidden':
      return { kind: 'forbidden' };
    case 'unavailable':
      return { kind: 'unavailable', reason: section.reason };
  }
}

export function buildAccessView(source: AccessSource): AccessViewState {
  let members: SectionView<readonly EffectiveMember[]>;
  if (source.loading) {
    members = { kind: 'loading' };
  } else if (source.error !== null) {
    members = { kind: 'error', message: source.error };
  } else if (source.members === null) {
    members = { kind: 'unavailable', reason: '有效访问清单不可用' };
  } else {
    members = memberSectionToItems(source.members);
  }
  return { members };
}

/** 有效角色中文标签（PRD §13.1 固定项目角色）。 */
export function effectiveRoleLabel(role: string): string {
  switch (role) {
    case 'project_admin':
      return '项目管理员';
    case 'developer':
      return '开发成员';
    case 'read_only':
      return '只读成员';
    default:
      return role;
  }
}

/** 访问来源中文标签（UX/UI §7.28：来源分离展示）。 */
export function sourceLabel(source: string): string {
  switch (source) {
    case 'org_inherited':
      return '组织继承';
    case 'project_member':
      return '项目成员';
    default:
      return source;
  }
}

/** 该行是否可操作（服务端 `allowedActions` 投影；`manage` 才显示写操作）。 */
export function canManageMember(member: EffectiveMember): boolean {
  return member.allowedActions.includes('manage');
}
