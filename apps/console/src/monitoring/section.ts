/**
 * Monitoring section adapter (PLT-05/PLT-06 shared).
 *
 * Maps the public Platform `sectionResult` shape (available/empty/partial/
 * stale/unavailable/forbidden — see `packages/platform-contract/common/section.ts`)
 * plus the page's own loading/error state into one closed union the views render
 * against. Pure functions only: no fetch, no store, no DOM. Missing data is
 * honestly surfaced (`empty`/`unavailable`/`partial`/`stale`), never invented
 * as zero or "normal".
 */

export type SectionStatus =
  'available' | 'empty' | 'partial' | 'stale' | 'unavailable' | 'forbidden';

export interface AvailableSection<T> {
  readonly status: 'available';
  readonly data: T;
}
export interface EmptySection {
  readonly status: 'empty';
  readonly reason: string;
}
export interface PartialSection<T> {
  readonly status: 'partial';
  readonly data: T;
  readonly missing: string;
}
export interface StaleSection<T> {
  readonly status: 'stale';
  readonly data: T;
  readonly freshAt: string;
  readonly staleReason: string;
}
export interface UnavailableSection {
  readonly status: 'unavailable';
  readonly reason: string;
}
export interface ForbiddenSection {
  readonly status: 'forbidden';
}

export type SectionResult<T> =
  | AvailableSection<T>
  | EmptySection
  | PartialSection<T>
  | StaleSection<T>
  | UnavailableSection
  | ForbiddenSection;

/** The closed state a view renders from — the page's own fetch state plus the server section. */
export type SectionView<T> =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'empty'; readonly reason: string }
  | { readonly kind: 'available'; readonly data: T }
  | { readonly kind: 'partial'; readonly data: T; readonly missing: string }
  | {
      readonly kind: 'stale';
      readonly data: T;
      readonly freshAt: string;
      readonly staleReason: string;
    }
  | { readonly kind: 'unavailable'; readonly reason: string }
  | { readonly kind: 'forbidden' };

export interface SectionSource<T> {
  readonly loading: boolean;
  readonly error: string | null;
  readonly section: SectionResult<T> | null;
}

/**
 * Combine fetch state and the server section into one render state.
 * Priority: loading → error → section (server authority). A missing section
 * without error is surfaced as `unavailable` (never "normal"/zero).
 */
export function toSectionView<T>(source: SectionSource<T>): SectionView<T> {
  if (source.loading) return { kind: 'loading' };
  if (source.error !== null) return { kind: 'error', message: source.error };
  if (source.section === null) return { kind: 'unavailable', reason: '数据源未返回结果' };
  return sectionToView(source.section);
}

export function sectionToView<T>(
  section: SectionResult<T>,
): Exclude<SectionView<T>, { kind: 'loading' } | { kind: 'error' }> {
  switch (section.status) {
    case 'available':
      return { kind: 'available', data: section.data };
    case 'empty':
      return { kind: 'empty', reason: section.reason };
    case 'partial':
      return { kind: 'partial', data: section.data, missing: section.missing };
    case 'stale':
      return {
        kind: 'stale',
        data: section.data,
        freshAt: section.freshAt,
        staleReason: section.staleReason,
      };
    case 'unavailable':
      return { kind: 'unavailable', reason: section.reason };
    case 'forbidden':
      return { kind: 'forbidden' };
  }
}

/** Human label for a render state (used for status badges / aria). */
export function sectionViewLabel(view: SectionView<unknown>): string {
  switch (view.kind) {
    case 'loading':
      return '正在加载';
    case 'error':
      return '加载失败';
    case 'empty':
      return '无数据';
    case 'partial':
      return '部分数据';
    case 'stale':
      return '数据已过期';
    case 'unavailable':
      return '不可用';
    case 'forbidden':
      return '无权限';
    case 'available':
      return '正常';
  }
}
