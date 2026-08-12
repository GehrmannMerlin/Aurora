/**
 * C14 客户端上报密钥 view-model（PLT-08）。
 *
 * 只消费 `credentialsListClientKeys`（C14，metadata-only）与服务端 lifecycle
 * 命令。创建成功返回的一次性 `clientKey` 只存在于当前组件内存，离开即清空；
 * 前端不缓存、不再次请求、不写日志/URL/localStorage。
 */
import type { ClientKeyMetadata } from '../../monitoring/queries.js';
import type { SectionResult, SectionView } from '../../monitoring/section.js';

export type CreateKeyPhase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'submitting' }
  /** One-time delivery: the raw client key is shown exactly once, then cleared. */
  | { readonly kind: 'revealed'; readonly clientKey: string; readonly keyId: string }
  | { readonly kind: 'error'; readonly message: string };

export interface ClientKeysViewState {
  readonly keys: SectionView<readonly ClientKeyMetadata[]>;
  readonly create: CreateKeyPhase;
}

export interface ClientKeysSource {
  readonly loading: boolean;
  readonly error: string | null;
  readonly keys: SectionResult<{ readonly items: readonly ClientKeyMetadata[] }> | null;
  readonly create: CreateKeyPhase;
}

export function keySectionToItems(
  section: SectionResult<{ readonly items: readonly ClientKeyMetadata[] }>,
): SectionView<readonly ClientKeyMetadata[]> {
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

export function buildClientKeysView(source: ClientKeysSource): ClientKeysViewState {
  let keys: SectionView<readonly ClientKeyMetadata[]>;
  if (source.loading) {
    keys = { kind: 'loading' };
  } else if (source.error !== null) {
    keys = { kind: 'error', message: source.error };
  } else if (source.keys === null) {
    keys = { kind: 'unavailable', reason: '客户端上报密钥列表不可用' };
  } else {
    keys = keySectionToItems(source.keys);
  }
  return { keys, create: source.create };
}

/** 密钥状态中文标签（ADR-013/014 状态机）。 */
export function clientKeyStatusLabel(status: string): string {
  switch (status) {
    case 'active':
      return '启用';
    case 'disabled':
      return '已停用';
    case 'revoked':
      return '已撤销';
    default:
      return status;
  }
}

/** `revoked` 为终态（ADR-014 §12）：不可重新启用。 */
export function isRevoked(key: ClientKeyMetadata): boolean {
  return key.status === 'revoked';
}
