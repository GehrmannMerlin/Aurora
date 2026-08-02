import { describe, expect, it } from 'vitest';
import { buildIngestionWorker } from '../src/worker-runtime.js';
import type {
  ClaimedInboxEvent,
  IngestionInboxProcessingRepository,
} from '@aurora/ingestion-inbox';
import type { IngestionEventProcessor } from '../src/processor.js';
import type { WorkerTimingPorts } from '../src/timers.js';
import { WorkerDiagnostics } from '../src/diagnostics.js';

interface TimingPorts extends WorkerTimingPorts {
  sleeper: {
    sleep(ms: number, signal?: AbortSignal): Promise<void>;
    calls: { ms: number }[];
    abortedSleeps: number;
  };
  timer: {
    set(fn: () => void, ms: number): { clear: () => void };
    registrations: (() => void)[];
    cleared: (() => void)[];
  };
}

function timing(): TimingPorts {
  return {
    sleeper: {
      calls: [],
      abortedSleeps: 0,
      sleep(ms, signal) {
        this.calls.push({ ms });
        return new Promise<void>((resolve, reject) => {
          if (signal?.aborted === true) {
            this.abortedSleeps += 1;
            reject(new Error('aborted'));
            return;
          }
          const timer = setTimeout(() => {
            resolve();
          }, ms);
          signal?.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              this.abortedSleeps += 1;
              reject(new Error('aborted'));
            },
            { once: true },
          );
        });
      },
    },
    timer: {
      registrations: [],
      cleared: [],
      set(fn, ms) {
        void ms;
        this.registrations.push(fn);
        return { clear: () => this.cleared.push(fn) };
      },
    },
  };
}

function claimedEvent(id: number): ClaimedInboxEvent {
  return {
    id,
    projectId: '11111111-1111-1111-1111-111111111111',
    eventId: `evt-${String(id)}`,
    event: { protocolVersion: 1, eventType: 'error', eventId: `evt-${String(id)}` },
    attemptCount: 1,
    leaseId: `lease-${String(id)}`,
    leaseExpiresAt: new Date(Date.now() + 60_000),
  } as ClaimedInboxEvent;
}

interface WriteBacks {
  processed: number;
  retries: number;
  deadLettered: number;
}

function recordingRepository(overrides?: Partial<IngestionInboxProcessingRepository>): {
  repository: IngestionInboxProcessingRepository;
  writes: WriteBacks;
} {
  const writes: WriteBacks = { processed: 0, retries: 0, deadLettered: 0 };
  const repository: IngestionInboxProcessingRepository = {
    claimAvailable: () => Promise.resolve({ status: 'nothingToClaim' }),
    renewLease: () => Promise.resolve({ status: 'success' }),
    markProcessed: () => {
      writes.processed += 1;
      return Promise.resolve({ status: 'success' });
    },
    scheduleRetry: () => {
      writes.retries += 1;
      return Promise.resolve({ status: 'success' });
    },
    markDeadLettered: () => {
      writes.deadLettered += 1;
      return Promise.resolve({ status: 'success' });
    },
    ...overrides,
  };
  return { repository, writes };
}

function baseConfig(overrides?: Partial<ReturnType<typeof defaultConfig>>) {
  return { ...defaultConfig(), ...overrides };
}

function defaultConfig() {
  return {
    workerId: 'worker-1',
    claimBatchSize: 5,
    maxConcurrentHandlers: 2,
    leaseDurationMs: 1000,
    leaseRenewIntervalMs: 50,
    idlePollIntervalMs: 250,
    infrastructureFailureDelayMs: 500,
    shutdownGracePeriodMs: 300,
    maxProcessingAttempts: 3,
    databaseUrl: 'postgresql://localhost/aurora_inbox_test',
    logEnabled: false,
  };
}

function workerWith(
  events: ClaimedInboxEvent[],
  processor: IngestionEventProcessor,
  repository: IngestionInboxProcessingRepository,
  timers: TimingPorts,
  config?: ReturnType<typeof baseConfig>,
  diagnostics?: WorkerDiagnostics,
) {
  let handed = false;
  const repo: IngestionInboxProcessingRepository = {
    ...repository,
    claimAvailable: () =>
      Promise.resolve(
        handed ? { status: 'nothingToClaim' } : ((handed = true), { status: 'claimed', events }),
      ),
  };
  return buildIngestionWorker({
    config: config ?? baseConfig(),
    repository: repo,
    processor,
    timers,
    ...(diagnostics === undefined ? {} : { diagnostics }),
  });
}

/** A processor that holds until aborted, then resolves with processed (write-back still skipped on abort). */
function abortableProcessor() {
  let aborted = false;
  const processor: IngestionEventProcessor = {
    process: (_input, signal) =>
      new Promise((resolve) => {
        const onAbort = (): void => {
          aborted = true;
          resolve({ outcome: 'processed' });
        };
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) onAbort();
      }),
  };
  return { processor, isAborted: () => aborted };
}

describe('worker graceful shutdown', () => {
  it('lets in-flight tasks finish within the grace period and writes back', async () => {
    const { repository, writes } = recordingRepository();
    const processor: IngestionEventProcessor = {
      process: async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 20));
        await Promise.resolve();
        return { outcome: 'processed' };
      },
    };
    const timers = timing();
    const worker = workerWith([claimedEvent(1)], processor, repository, timers);
    await worker.start();
    await Promise.resolve();
    await worker.stop();
    expect(writes.processed).toBe(1);
  });

  it('aborts overlong tasks after the grace period and does not force a state change', async () => {
    const { repository, writes } = recordingRepository();
    const { processor, isAborted } = abortableProcessor();
    const timers = timing();
    const worker = workerWith(
      [claimedEvent(2)],
      processor,
      repository,
      timers,
      baseConfig({ shutdownGracePeriodMs: 50 }),
    );
    await worker.start();
    await Promise.resolve();
    await worker.stop();
    expect(isAborted()).toBe(true);
    // No final write-back for the aborted task (no forced retry/dead-letter either).
    expect(writes.processed).toBe(0);
    expect(writes.retries).toBe(0);
    expect(writes.deadLettered).toBe(0);
  });

  it('records a diagnostic when a task is aborted by shutdown', async () => {
    const diagnostics = new WorkerDiagnostics('worker-1', 100);
    const { repository } = recordingRepository();
    const { processor } = abortableProcessor();
    const timers = timing();
    const worker = workerWith(
      [claimedEvent(3)],
      processor,
      repository,
      timers,
      baseConfig({ shutdownGracePeriodMs: 50 }),
      diagnostics,
    );
    await worker.start();
    await Promise.resolve();
    await worker.stop();
    expect(diagnostics.snapshot().some((d) => d.code === 'lease_not_owned')).toBe(true);
  });

  it('is idempotent across repeated stop calls', async () => {
    const { repository, writes } = recordingRepository();
    const processor: IngestionEventProcessor = {
      process: () => Promise.resolve({ outcome: 'processed' }),
    };
    const timers = timing();
    const worker = workerWith([claimedEvent(4)], processor, repository, timers);
    await worker.start();
    await Promise.resolve();
    await worker.stop();
    await worker.stop();
    expect(worker.status).toBe('stopped');
    expect(writes.processed).toBe(1);
  });

  it('stops cleanly without timer leakage after shutdown', async () => {
    const { repository } = recordingRepository();
    const processor: IngestionEventProcessor = {
      process: () => Promise.resolve({ outcome: 'processed' }),
    };
    const timers = timing();
    const worker = workerWith([claimedEvent(5)], processor, repository, timers);
    await worker.start();
    await Promise.resolve();
    await worker.stop();
    // After stop, no further claim cycles or timers should fire.
    const callsAfterStop = timers.sleeper.calls.length;
    await new Promise<void>((resolve) => setTimeout(resolve, 60));
    expect(timers.sleeper.calls.length).toBe(callsAfterStop);
  });
});
