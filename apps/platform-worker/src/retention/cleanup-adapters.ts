/**
 * SEC-02 cross-store cleanup adapter port (account-deletion-and-data-lifecycle §6/§8).
 *
 * A `CleanupAdapter` performs one store's deletion/anonymization for a single
 * account deletion intent. `CleanupResult` distinguishes success from a stable
 * failure code so the orchestrator can retry partial failures and never report
 * a partially-cleaned intent as complete.
 */

import type { CleanupStoreId } from './cleanup-state-machine.js';

export interface CleanupInput {
  readonly accountId: string;
  readonly accountEmail: string;
  readonly requiredLifecycle: unknown;
}

export type CleanupResult =
  { readonly ok: true } | { readonly ok: false; readonly errorCode: string };

export interface CleanupAdapter {
  readonly store: CleanupStoreId;
  cleanup(input: CleanupInput): Promise<CleanupResult>;
}
