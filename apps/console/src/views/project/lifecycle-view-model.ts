/**
 * C16 项目生命周期 view-model（PLT-08）。
 *
 * 只消费 `settingsGetProject`（C16 复用其 lifecycle 摘要）与 lifecycle 三个
 * 独立 Command（archive / restore-from-archive / move-to-trash）。移入回收站是
 * 独立高风险动作：精确输入当前权威项目名称确认 + `resourceVersion` 乐观并发，
 * 不与 settings save / archive 共用提交按钮。
 */
import type { ProjectSettings } from '../../monitoring/queries.js';
import type { SectionView } from '../../monitoring/section.js';

export interface LifecycleViewState {
  readonly project: SectionView<ProjectSettings>;
}

export interface LifecycleSource {
  readonly loading: boolean;
  readonly error: string | null;
  readonly project: ProjectSettings | null;
}

export function buildLifecycleView(source: LifecycleSource): LifecycleViewState {
  let project: SectionView<ProjectSettings>;
  if (source.loading) {
    project = { kind: 'loading' };
  } else if (source.error !== null) {
    project = { kind: 'error', message: source.error };
  } else if (source.project === null) {
    project = { kind: 'unavailable', reason: '项目生命周期不可用' };
  } else {
    project = { kind: 'available', data: source.project };
  }
  return { project };
}

/** 生命周期状态中文标签（PRD §17.1）。 */
export function lifecycleStatusLabel(status: string): string {
  switch (status) {
    case 'active':
      return '正常使用';
    case 'archived':
      return '已归档';
    case 'trash':
      return '回收站';
    case 'deleting':
      return '正在删除';
    default:
      return status;
  }
}

/**
 * 移入回收站确认：精确输入当前权威项目名称才允许提交（UX/UI §8.29 / §10.23）。
 */
export function trashNameMatches(input: string, authoritativeName: string): boolean {
  return input.trim() === authoritativeName;
}

/** 是否可归档（仅 active）。 */
export function canArchive(status: string): boolean {
  return status === 'active';
}

/** 是否可从归档恢复（仅 archived）。 */
export function canRestoreFromArchive(status: string): boolean {
  return status === 'archived';
}

/** 是否可移入回收站（active 或 archived）。 */
export function canMoveToTrash(status: string): boolean {
  return status === 'active' || status === 'archived';
}
