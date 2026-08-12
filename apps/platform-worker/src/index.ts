import type { Pool } from 'pg';
import {
  ConsoleEmailAdapter,
  type EmailDeliveryPort,
  type OutboxRepository,
} from '@aurora/platform-email';
import { claimOutboxRows, insertOutboxRow, markOutboxResult } from '@aurora/platform-identity';
import type { SourceMapObjectStoragePort } from '@aurora/platform-releases';
import type { CleanupAdapter } from './retention/cleanup-adapters.js';
import { buildPlatformWorker, type PlatformWorker } from './worker.js';

export { loadPlatformWorkerConfig, type PlatformWorkerConfig } from './config.js';
export { defaultSleeper, type SleeperPort } from './timers.js';
export {
  buildPlatformWorker,
  type BuildPlatformWorkerInput,
  type PlatformWorker,
  type PlatformWorkerStatus,
} from './worker.js';

/**
 * Compose the real outbox repository from `@aurora/platform-identity` (data).
 * Each method receives the `pg` Pool/PoolClient at call time from the consumer,
 * so no Pool is captured here. The worker is a service layer
 * (`service → {protocol, data, tooling, contract}` per Workspace Policy
 * `graph.ts`), so this data→data wiring is allowed and is the intended
 * PLT-03 Task 8 composition.
 */
export function createPlatformOutboxRepository(): OutboxRepository {
  return {
    insertOutboxRow: (p, input) => insertOutboxRow(p, input),
    claimOutboxRows: (p, input) => claimOutboxRows(p, input),
    markOutboxResult: (p, input) => markOutboxResult(p, input),
  };
}

/** Build the env-selected email delivery port (local/Preview console adapter). */
export function createPlatformEmailPort(mode: string): EmailDeliveryPort {
  return new ConsoleEmailAdapter({ mode });
}

export interface BuildPlatformWorkerCompositionInput {
  readonly pool: Pool;
  readonly emailDeliveryMode: string;
  readonly pollIntervalMs: number;
  readonly batchLimit: number;
  readonly maxAttempts: number;
  readonly cleanupMaxAttempts: number;
  readonly cleanupAdapters: readonly CleanupAdapter[];
  /** DAT-19 product-alert evaluation: enable the per-poll round. */
  readonly alertsEnabled: boolean;
  /** DAT-19 product-alert evaluation: max rules per round. */
  readonly alertMaxRules: number;
  /** DAT-18 Source Map reparse: enable the per-poll round. */
  readonly sourceMapsReparseEnabled: boolean;
  /** DAT-18 Source Map reparse: max occurrences re-symbolized per task. */
  readonly sourceMapsReparseMaxOccurrences: number;
  /** DAT-18 Source Map reparse: max tasks claimed per round. */
  readonly sourceMapsReparseMaxTasks: number;
  /** DAT-18 Source Map private object storage (disposable in-memory in tests/dev). */
  readonly sourceMapsObjectStorage: SourceMapObjectStoragePort;
}

/**
 * Composition root: wire the real outbox repository + the env-selected email
 * port into the worker. Owns no Pool; `src/start.ts` creates and closes it.
 */
export function buildPlatformWorkerComposition(
  input: BuildPlatformWorkerCompositionInput,
): PlatformWorker {
  return buildPlatformWorker({
    pool: input.pool,
    port: createPlatformEmailPort(input.emailDeliveryMode),
    outboxRepo: createPlatformOutboxRepository(),
    pollIntervalMs: input.pollIntervalMs,
    batchLimit: input.batchLimit,
    maxAttempts: input.maxAttempts,
    cleanup: {
      adapters: input.cleanupAdapters,
      maxAttempts: input.cleanupMaxAttempts,
    },
    ...(input.alertsEnabled ? { alerts: { maxRules: input.alertMaxRules } } : {}),
    ...(input.sourceMapsReparseEnabled
      ? {
          sourceMaps: {
            objectStorage: input.sourceMapsObjectStorage,
            maxOccurrences: input.sourceMapsReparseMaxOccurrences,
            maxTasks: input.sourceMapsReparseMaxTasks,
          },
        }
      : {}),
  });
}
