/**
 * C9 Source Map 工作区（`project.source-maps` / `project.release-detail`）
 * view-model（PLT-07）。
 *
 * 只消费 `sourceMapsListFiles`（DAT-18）真实投影；上传/替换/重解析为
 * view 维护的交互 phase，view-model 负责把列表 section 规范化为渲染状态并
 * 提供稳定的状态标签。替换冲突必须显式确认后才可替换，绝不静默覆盖。
 */
import type { SourceMapFileSummary } from '../../monitoring/queries.js';
import type { SectionResult, SectionView } from '../../monitoring/section.js';

export type UploadPhase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'submitting' }
  | { readonly kind: 'duplicate'; readonly message: string }
  | { readonly kind: 'succeeded'; readonly sourceMapFileId: string }
  | { readonly kind: 'error'; readonly message: string };

export type ReplacePhase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'confirm'; readonly sourceMapFileId: string; readonly version: number }
  | { readonly kind: 'submitting' }
  | { readonly kind: 'succeeded'; readonly sourceMapFileId: string; readonly version: number }
  | { readonly kind: 'error'; readonly message: string };

export type ReparsePhase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'submitting' }
  | { readonly kind: 'succeeded'; readonly taskCount: number }
  | { readonly kind: 'error'; readonly message: string };

export interface SourceMapsViewState {
  /** 当前发布有效 Source Map 文件列表。 */
  readonly files: SectionView<readonly SourceMapFileSummary[]>;
  /** 上传交互 phase。 */
  readonly upload: UploadPhase;
  /** 替换交互 phase（仅 replace_conflict 后进入 confirm）。 */
  readonly replace: ReplacePhase;
  /** 重解析交互 phase。 */
  readonly reparse: ReparsePhase;
}

export interface SourceMapsSource {
  readonly loading: boolean;
  readonly error: string | null;
  /** 服务端 `files` section；null 表示尚未返回。 */
  readonly files: SectionResult<{ readonly items: readonly SourceMapFileSummary[] }> | null;
  readonly upload: UploadPhase;
  readonly replace: ReplacePhase;
  readonly reparse: ReparsePhase;
}

/** 把服务端 files section 展开为 items 渲染状态（缺失一律 empty/unavailable）。 */
export function fileSectionToItems(
  section: SectionResult<{ readonly items: readonly SourceMapFileSummary[] }>,
): SectionView<readonly SourceMapFileSummary[]> {
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

export function buildSourceMapsView(source: SourceMapsSource): SourceMapsViewState {
  let files: SectionView<readonly SourceMapFileSummary[]>;
  if (source.loading) {
    files = { kind: 'loading' };
  } else if (source.error !== null) {
    files = { kind: 'error', message: source.error };
  } else if (source.files === null) {
    files = { kind: 'unavailable', reason: 'Source Map 文件列表不可用' };
  } else {
    files = fileSectionToItems(source.files);
  }
  return { files, upload: source.upload, replace: source.replace, reparse: source.reparse };
}

/** PRD §8.3.8 有限重解析状态标签。 */
export function reparseStateLabel(state: string): string {
  switch (state) {
    case 'queued':
      return '等待处理';
    case 'processing':
      return '处理中';
    case 'completed':
      return '已完成';
    case 'failed':
      return '处理失败';
    default:
      return state;
  }
}

/** 当前有效文件状态标签（DAT-18：active / replaced）。 */
export function sourceMapStatusLabel(status: string): string {
  switch (status) {
    case 'active':
      return '当前有效';
    case 'replaced':
      return '已替换';
    default:
      return status;
  }
}
