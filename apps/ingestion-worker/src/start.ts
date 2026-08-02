import { Pool } from 'pg';
import type {
  IngestionInboxProcessingRepository,
} from '@aurora/ingestion-inbox';
import { claimAvailable, markDeadLettered, markProcessed, renewLease, scheduleRetry } from '@aurora/ingestion-inbox';
import type { IngestionEventProcessor } from './processor.js';
import { buildIngestionWorker } from './worker-runtime.js';
import type { IngestionWorkerConfig } from './configuration.js';

export interface StartIngestionWorkerOptions {
  readonly config: IngestionWorkerConfig;
  readonly processor: IngestionEventProcessor;
  /** Injectable Pool factory for tests; defaults to a real pg Pool. */
  readonly poolFactory?: () => Pool;
}

export interface RunningIngestionWorker {
  readonly close: () => Promise<void>;
}

/** Compose the processing repository over a pg Pool using the package-root API. */
function createProcessingRepository(pool: Pool): IngestionInboxProcessingRepository {
  return {
    claimAvailable: (input) => claimAvailable(pool, input),
    renewLease: (input) => renewLease(pool, input),
    markProcessed: (input) => markProcessed(pool, input),
    scheduleRetry: (input) => scheduleRetry(pool, input),
    markDeadLettered: (input) => markDeadLettered(pool, input),
  };
}

/**
 * Composition root: creates the PostgreSQL Pool it owns, builds the Worker,
 * starts it, and registers shutdown so the Pool is closed exactly once after
 * the Worker stops. On startup failure it rolls back by closing the created Pool.
 * Production must always supply an explicit processor composition.
 */
export async function startIngestionWorker(
  options: StartIngestionWorkerOptions,
): Promise<RunningIngestionWorker> {
  const pool = options.poolFactory !== undefined ? options.poolFactory() : new Pool({ connectionString: options.config.databaseUrl });
  let closed = false;
  const closePoolOnce = async (): Promise<void> => {
    if (!closed) {
      closed = true;
      await pool.end();
    }
  };
  try {
    const repository = createProcessingRepository(pool);
    const worker = buildIngestionWorker({
      config: options.config,
      repository,
      processor: options.processor,
    });
    await worker.start();
    const signalHandlers = new Map<string, () => void>();
    const registerSignals = (): void => {
      const onSignal = (): void => {
        void close().catch(() => undefined);
      };
      signalHandlers.set('SIGTERM', onSignal);
      signalHandlers.set('SIGINT', onSignal);
      process.on('SIGTERM', onSignal);
      process.on('SIGINT', onSignal);
    };
    const close = async (): Promise<void> => {
      for (const [name, handler] of signalHandlers) {
        process.removeListener(name, handler);
      }
      signalHandlers.clear();
      await worker.stop();
      await closePoolOnce();
    };
    registerSignals();
    return { close };
  } catch (error) {
    await closePoolOnce().catch(() => undefined);
    throw error;
  }
}
