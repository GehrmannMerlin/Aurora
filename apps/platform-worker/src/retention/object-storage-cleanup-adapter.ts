/**
 * SEC-02 object-storage cleanup adapter — CONTRACT implementation.
 *
 * Production private object storage (Source Maps, exports) is deferred by
 * ADR-032. This adapter pins the contract: on cleanup, all private objects for
 * the deleted subject must be deleted (versioned buckets, no public access,
 * no resurrection through restore). The concrete S3/object commands are wired
 * when object storage exists; the contract test enforces the interface.
 */

import type { CleanupAdapter, CleanupResult } from './cleanup-adapters.js';

export class ObjectStorageCleanupAdapter implements CleanupAdapter {
  readonly store = 'object-storage' as const;

  cleanup(): Promise<CleanupResult> {
    // Contract-only: private object storage is deferred (ADR-032).
    return Promise.resolve({ ok: true });
  }
}
