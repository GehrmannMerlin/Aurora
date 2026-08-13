/**
 * C15 项目设置 view-model（PLT-08）。
 *
 * 只消费 `settingsGetProject` / `settingsListEnvironments` / `settingsUpdateProject`
 * / `settingsCreateEnvironment`（C15）。框架/接入类型只读；名称与可选生产网站
 * 地址可编辑；环境创建后不可改名/停用/删除。
 */
import type { ProjectEnvironment, ProjectSettings } from '../../monitoring/queries.js';
import type { SectionResult, SectionView } from '../../monitoring/section.js';

export interface SettingsViewState {
  readonly project: SectionView<ProjectSettings>;
  readonly environments: SectionView<readonly ProjectEnvironment[]>;
}

export interface SettingsSource {
  readonly loading: boolean;
  readonly error: string | null;
  readonly project: ProjectSettings | null;
  readonly environments: SectionResult<{ readonly items: readonly ProjectEnvironment[] }> | null;
}

export function environmentSectionToItems(
  section: SectionResult<{ readonly items: readonly ProjectEnvironment[] }>,
): SectionView<readonly ProjectEnvironment[]> {
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

export function buildSettingsView(source: SettingsSource): SettingsViewState {
  let project: SectionView<ProjectSettings>;
  if (source.loading) {
    project = { kind: 'loading' };
  } else if (source.error !== null) {
    project = { kind: 'error', message: source.error };
  } else if (source.project === null) {
    project = { kind: 'unavailable', reason: '项目设置不可用' };
  } else {
    project = { kind: 'available', data: source.project };
  }
  const environments =
    source.environments === null
      ? { kind: 'unavailable' as const, reason: '环境目录不可用' }
      : environmentSectionToItems(source.environments);
  return { project, environments };
}

/** 框架/接入类型中文标签（只读）。 */
export function frameworkLabel(frameworkType: string): string {
  switch (frameworkType) {
    case 'javascript':
      return 'JavaScript';
    case 'react':
      return 'React';
    case 'vue':
      return 'Vue';
    default:
      return frameworkType;
  }
}
