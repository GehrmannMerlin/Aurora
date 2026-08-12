import { Pool } from 'pg';
import { buildPlatformWorkerComposition } from './index.js';
import type { PlatformWorkerConfig } from './config.js';
import { PostgresCleanupAdapter } from './retention/postgres-cleanup-adapter.js';
import { RedisSessionCleanupAdapter } from './retention/redis-session-cleanup-adapter.js';
import { ObjectStorageCleanupAdapter } from './retention/object-storage-cleanup-adapter.js';
import { BackupLifecycleCleanupAdapter } from './retention/backup-lifecycle-cleanup-adapter.js';
import { AuditCleanupAdapter } from './retention/audit-cleanup-adapter.js';

export interface StartPlatformWorkerOptions {
  readonly config: PlatformWorkerConfig;
}

export interface RunningPlatformWorker {
  readonly close: () => Promise<void>;
}

/**
 * Start the outbox email consumer: create the PostgreSQL Pool it owns, wire the
 * real outbox repository + env-selected email port, build the worker, start it,
 * and register graceful shutdown (SIGTERM/SIGINT) so the poll loop stops and the
 * Pool is ended exactly once. On startup failure the created Pool is rolled back.
 */
export async function startPlatformWorker(
  options: StartPlatformWorkerOptions,
): Promise<RunningPlatformWorker> {
  const pool = new Pool({ connectionString: options.config.databaseUrl });
  let closed = false;
  const closePoolOnce = async (): Promise<void> => {
    if (!closed) {
      closed = true;
      await pool.end();
    }
  };
  try {
    const worker = buildPlatformWorkerComposition({
      pool,
      emailDeliveryMode: options.config.emailDeliveryMode,
      pollIntervalMs: options.config.outboxPollIntervalMs,
      batchLimit: options.config.outboxBatchLimit,
      maxAttempts: options.config.outboxMaxAttempts,
      cleanupMaxAttempts: options.config.cleanupMaxAttempts,
      cleanupAdapters: [
        new PostgresCleanupAdapter(pool),
        new RedisSessionCleanupAdapter(),
        new ObjectStorageCleanupAdapter(),
        new BackupLifecycleCleanupAdapter(),
        new AuditCleanupAdapter(pool),
      ],
      alertsEnabled: options.config.alertsEnabled,
      alertMaxRules: options.config.alertMaxRules,
    });
    await worker.start();

    const signalHandlers = new Map<string, () => void>();
    const close = async (): Promise<void> => {
      for (const [name, handler] of signalHandlers) {
        process.removeListener(name, handler);
      }
      signalHandlers.clear();
      await worker.stop();
      await closePoolOnce();
    };
    const onSignal = (): void => {
      void close().catch(() => undefined);
    };
    signalHandlers.set('SIGTERM', onSignal);
    signalHandlers.set('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
    process.on('SIGINT', onSignal);

    return { close };
  } catch (error) {
    await closePoolOnce().catch(() => undefined);
    throw error;
  }
}
