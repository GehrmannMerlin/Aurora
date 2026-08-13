/**
 * C8 发布工作区（`project.releases`）view-model（PLT-07）。
 *
 * 把 `releasesListReleases`（DAT-18）的 section 规范化为统一渲染状态。部署
 * 记录维度在 v1 contract 中不存在（无 Deployment Query），因此部署区恒
 * `unavailable` 并给出原因，前端绝不伪造部署状态或参与再次出现判断。
 */
import type { ReleaseSummary } from '../../monitoring/queries.js';
import type { SectionResult, SectionView } from '../../monitoring/section.js';

export interface ReleasesViewState {
  /** 发布版本列表渲染状态。 */
  readonly list: SectionView<readonly ReleaseSummary[]>;
  /** 部署记录区：DAT-18 v1 无 Deployment Query，恒 unavailable。 */
  readonly deployments: SectionView<Record<string, never>>;
}

export interface ReleasesSource {
  readonly loading: boolean;
  readonly error: string | null;
  /** 服务端 `releases` section；null 表示尚未返回。 */
  readonly releases: SectionResult<{ readonly items: readonly ReleaseSummary[] }> | null;
}

/** 把服务端 releases section 展开为 items 渲染状态（缺失一律 empty/unavailable）。 */
export function releaseSectionToItems(
  section: SectionResult<{ readonly items: readonly ReleaseSummary[] }>,
): SectionView<readonly ReleaseSummary[]> {
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

export function buildReleasesView(source: ReleasesSource): ReleasesViewState {
  let list: SectionView<readonly ReleaseSummary[]>;
  if (source.loading) {
    list = { kind: 'loading' };
  } else if (source.error !== null) {
    list = { kind: 'error', message: source.error };
  } else if (source.releases === null) {
    list = { kind: 'unavailable', reason: '发布列表不可用' };
  } else {
    list = releaseSectionToItems(source.releases);
  }
  return {
    list,
    deployments: {
      kind: 'unavailable',
      reason:
        '部署记录契约未提供（DAT-18 v1 无 Deployment Query）；发布由 SDK 首次上报或获准令牌/CI 创建。',
    },
  };
}

/** Source 来源标签（发布身份由谁创建，PRD §8 区分 SDK 首次出现 vs 令牌/CI）。 */
export function releaseSourceLabel(source: string): string {
  switch (source) {
    case 'source_map_upload':
      return 'Source Map 上传';
    default:
      return source;
  }
}
