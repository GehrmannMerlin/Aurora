import type { Pool } from 'pg';
import {
  buildIngestionWorker,
  type IngestionEventProcessor,
  type WorkerRuntime,
} from '@aurora/ingestion-worker';
import {
  claimAvailable,
  markDeadLettered,
  markProcessed,
  renewLease,
  scheduleRetry,
  type IngestionInboxProcessingRepository,
} from '@aurora/ingestion-inbox';
import type { BenchmarkScenarioConfig } from './types.js';

/** Compose the processing repository over a schema Pool using package-root API. */
export function createProcessingRepository(pool: Pool): IngestionInboxProcessingRepository {
  return {
    claimAvailable: (input) => claimAvailable(pool, input),
    renewLease: (input) => renewLease(pool, input),
    markProcessed: (input) => markProcessed(pool, input),
    scheduleRetry: (input) => scheduleRetry(pool, input),
    markDeadLettered: (input) => markDeadLettered(pool, input),
  };
}

export interface StartWorkerOptions {
  readonly pool: Pool;
  readonly processor: IngestionEventProcessor;
  readonly config: BenchmarkScenarioConfig;
  readonly workerId: string;
  readonly maxProcessingAttempts: number;
  readonly leaseDurationMs?: number;
}

/** Start a Worker runtime over the schema Pool. Returns the runtime to stop later. */
export async function startBenchmarkWorker(options: StartWorkerOptions): Promise<WorkerRuntime> {
  const worker = buildIngestionWorker({
    config: {
      workerId: options.workerId,
      claimBatchSize: options.config.claimBatchSize,
      maxConcurrentHandlers: options.config.workerConcurrency,
      leaseDurationMs: options.leaseDurationMs ?? 2000,
      leaseRenewIntervalMs: 200,
      idlePollIntervalMs: 25,
      infrastructureFailureDelayMs: 50,
      shutdownGracePeriodMs: 500,
      maxProcessingAttempts: options.maxProcessingAttempts,
      databaseUrl: 'redacted', // composition root owns the real Pool; never printed
      logEnabled: false,
    },
    repository: createProcessingRepository(options.pool),
    processor: options.processor,
  });
  await worker.start();
  return worker;
}
