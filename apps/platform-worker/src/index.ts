import type { Pool } from 'pg';
import {
  AliyunDirectMailAdapter,
  ConsoleEmailAdapter,
  createAliyunDirectMailClient,
  type AliyunDirectMailClientOptions,
  type DirectMailClientPort,
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

export interface PlatformEmailPortConfig {
  readonly mode: 'console' | 'aliyun';
  readonly accountName: string | null;
  readonly fromAlias: string;
  readonly regionId: string;
  readonly endpoint: string | null;
  readonly providerTimeoutMs: number;
}

export type DirectMailClientFactory = (
  options: AliyunDirectMailClientOptions,
) => DirectMailClientPort;

/** Build the env-selected delivery port exactly once at startup. */
export function createPlatformEmailPort(
  config: PlatformEmailPortConfig,
  clientFactory: DirectMailClientFactory = createAliyunDirectMailClient,
): EmailDeliveryPort {
  if (config.mode === 'console') return new ConsoleEmailAdapter({ mode: 'console' });
  if (config.accountName === null) {
    throw new Error('ALIYUN_DIRECT_MAIL_ACCOUNT_NAME is required in aliyun mode');
  }
  const client = clientFactory({
    regionId: config.regionId,
    ...(config.endpoint === null ? {} : { endpoint: config.endpoint }),
  });
  return new AliyunDirectMailAdapter({
    client,
    accountName: config.accountName,
    fromAlias: config.fromAlias,
    timeoutMs: config.providerTimeoutMs,
  });
}

export interface BuildPlatformWorkerCompositionInput {
  readonly pool: Pool;
  readonly emailDeliveryMode: 'console' | 'aliyun';
  readonly aliyunDirectMailAccountName: string | null;
  readonly aliyunDirectMailFromAlias: string;
  readonly aliyunDirectMailRegionId: string;
  readonly aliyunDirectMailEndpoint: string | null;
  readonly emailProviderTimeoutMs: number;
  readonly emailOutboxProcessingTimeoutMs: number;
  readonly emailOutboxRetryBaseDelayMs: number;
  readonly emailOutboxRetryMaxDelayMs: number;
  /** Injectable only for composition tests; production uses the official SDK factory. */
  readonly directMailClientFactory?: DirectMailClientFactory;
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
    port: createPlatformEmailPort(
      {
        mode: input.emailDeliveryMode,
        accountName: input.aliyunDirectMailAccountName,
        fromAlias: input.aliyunDirectMailFromAlias,
        regionId: input.aliyunDirectMailRegionId,
        endpoint: input.aliyunDirectMailEndpoint,
        providerTimeoutMs: input.emailProviderTimeoutMs,
      },
      input.directMailClientFactory,
    ),
    outboxRepo: createPlatformOutboxRepository(),
    pollIntervalMs: input.pollIntervalMs,
    batchLimit: input.batchLimit,
    maxAttempts: input.maxAttempts,
    processingTimeoutMs: input.emailOutboxProcessingTimeoutMs,
    retryBaseDelayMs: input.emailOutboxRetryBaseDelayMs,
    retryMaxDelayMs: input.emailOutboxRetryMaxDelayMs,
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
