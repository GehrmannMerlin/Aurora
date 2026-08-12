import type { Pool } from 'pg';
import { consumeOutboxEmails, type OutboxRepository } from '@aurora/platform-email';
import type { EmailDeliveryPort } from '@aurora/platform-email';
import { runAlertEvaluationRound } from '@aurora/processing-store';
import { defaultSleeper, type SleeperPort } from './timers.js';
import type { CleanupAdapter } from './retention/cleanup-adapters.js';
import { runCleanupRound } from './retention/cleanup-orchestrator.js';

export type PlatformWorkerStatus = 'created' | 'running' | 'stopping' | 'stopped';

export interface CleanupWorkerSettings {
  readonly adapters: readonly CleanupAdapter[];
  readonly maxAttempts: number;
}

/** DAT-19 alert evaluation worker section (bounded rules per poll). */
export interface AlertWorkerSettings {
  readonly maxRules: number;
}

export interface PlatformWorker {
  readonly status: PlatformWorkerStatus;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface BuildPlatformWorkerInput {
  readonly pool: Pool;
  readonly port: EmailDeliveryPort;
  readonly outboxRepo: OutboxRepository;
  readonly pollIntervalMs: number;
  readonly batchLimit: number;
  readonly maxAttempts: number;
  /** Optional SEC-02 cross-store cleanup loop (retention worker). */
  readonly cleanup?: CleanupWorkerSettings;
  /** Optional DAT-19 product-alert evaluation loop. */
  readonly alerts?: AlertWorkerSettings;
  /** Injectable sleeper for tests; production uses the real setTimeout sleeper. */
  readonly sleeper?: SleeperPort;
}

/**
 * Build the platform outbox email consumer worker (PLT-03 Task 8).
 *
 * A simple poll loop (accepted ADR-032 YAGNI: no BullMQ/S3/Redis-for-email):
 * every `pollIntervalMs` it claims pending + available outbox rows and settles
 * them through `@aurora/platform-email` `consumeOutboxEmails` (deliver →
 * succeeded/failed/dead_lettered). The worker owns no PostgreSQL Pool — the
 * composition root (`src/start.ts`) creates and ends it. A single instance is
 * stop-once and cannot be restarted (mirrors apps/ingestion-worker).
 */
export function buildPlatformWorker(input: BuildPlatformWorkerInput): PlatformWorker {
  const sleeper = input.sleeper ?? defaultSleeper;
  const stopSignal = new AbortController();
  let status: PlatformWorkerStatus = 'created';
  let loopFinished: Promise<void> | undefined;

  /** Read an AbortSignal's aborted state through a call so narrowing is not assumed false. */
  const isAborted = (signal: AbortSignal): boolean => signal.aborted;

  /** Sleep for a duration, tolerating abort rejection (returns immediately on abort). */
  const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
    sleeper.sleep(ms, signal).catch(() => undefined);

  const pollOnce = async (): Promise<void> => {
    await consumeOutboxEmails({
      pool: input.pool,
      port: input.port,
      outboxRepo: input.outboxRepo,
      now: new Date(),
      limit: input.batchLimit,
      maxAttempts: input.maxAttempts,
    });
    if (input.cleanup !== undefined) {
      await runCleanupRound({
        pool: input.pool,
        adapters: input.cleanup.adapters,
        maxAttempts: input.cleanup.maxAttempts,
      });
    }
    if (input.alerts !== undefined) {
      // Product alert evaluation (PRD §11). Bounded per poll; a single rule
      // failure never blocks the round or the rest of the worker.
      await runAlertEvaluationRound({
        pool: input.pool,
        now: new Date(),
        maxRules: input.alerts.maxRules,
      });
    }
  };

  const runLoop = async (): Promise<void> => {
    while (status === 'running' && !isAborted(stopSignal.signal)) {
      try {
        await pollOnce();
      } catch (error) {
        // Infrastructure failure (e.g. DB unreachable): log a bounded message and
        // keep polling. Never log payloads/tokens/addresses here.
        const message = error instanceof Error ? error.message.slice(0, 200) : 'outbox poll failed';
        console.error(`[platform-worker] outbox poll failed: ${message}`);
      }
      if (isAborted(stopSignal.signal)) break;
      await sleep(input.pollIntervalMs, stopSignal.signal);
    }
  };

  const start = async (): Promise<void> => {
    if (status !== 'created') {
      throw new Error(`cannot start worker in state ${status}`);
    }
    status = 'running';
    loopFinished = runLoop();
    await Promise.resolve();
  };

  const stop = async (): Promise<void> => {
    if (status === 'stopped') return;
    if (status === 'created') {
      status = 'stopped';
      return;
    }
    status = 'stopping';
    stopSignal.abort();
    // Wait for the in-flight poll to settle so claim→deliver→settle is never
    // interrupted mid-write (no in-flight row lost). The loop exits promptly
    // because the aborted sleeper returns immediately.
    await loopFinished?.catch(() => undefined);
    status = 'stopped';
  };

  return {
    get status(): PlatformWorkerStatus {
      return status;
    },
    start,
    stop,
  };
}
