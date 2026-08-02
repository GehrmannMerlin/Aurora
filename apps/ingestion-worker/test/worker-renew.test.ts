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
        return new Promise<void>((resolve) => {
          if (signal?.aborted === true) {
            this.abortedSleeps += 1;
            resolve();
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
              resolve();
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

function baseConfig() {
  return {
    workerId: 'worker-1',
    claimBatchSize: 5,
    maxConcurrentHandlers: 2,
    leaseDurationMs: 1000,
    leaseRenewIntervalMs: 50,
    idlePollIntervalMs: 250,
    infrastructureFailureDelayMs: 500,
    shutdownGracePeriodMs: 2000,
    maxProcessingAttempts: 3,
    databaseUrl: 'postgresql://localhost/aurora_inbox_test',
    logEnabled: false,
  };
}

interface RenewRecord {
  renewCalls: number;
  processed: number;
  leaseLost: boolean;
}

function renewRepository(): { repository: IngestionInboxProcessingRepository; record: RenewRecord } {
  const record: RenewRecord = { renewCalls: 0, processed: 0, leaseLost: false };
  const repository: IngestionInboxProcessingRepository = {
    claimAvailable: () => Promise.resolve({ status: 'nothingToClaim' }),
    renewLease: () => {
      record.renewCalls += 1;
      if (record.leaseLost) return Promise.resolve({ status: 'lease_lost' });
      return Promise.resolve({ status: 'success' });
    },
    markProcessed: () => {
      record.processed += 1;
      return Promise.resolve({ status: 'success' });
    },
    scheduleRetry: () => Promise.resolve({ status: 'success' }),
    markDeadLettered: () => Promise.resolve({ status: 'success' }),
  };
  return { repository, record };
}

function deferredProcessor() {
  let resolveHold: (() => void) | undefined;
  const held = new Promise<void>((resolve) => {
    resolveHold = resolve;
  });
  const processor: IngestionEventProcessor = {
    process: async (_input, signal) => {
      const onAbort = (): void => resolveHold?.();
      signal.addEventListener('abort', onAbort, { once: true });
      // Hold until the caller releases or the signal aborts.
      await held;
      signal.removeEventListener('abort', onAbort);
      await Promise.resolve();
      return { outcome: 'processed' };
    },
  };
  return { processor, release: () => resolveHold?.() };
}

function runWorkerWith(
  events: ClaimedInboxEvent[],
  processor: IngestionEventProcessor,
  repository: IngestionInboxProcessingRepository,
  timers: TimingPorts,
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
    config: baseConfig(),
    repository: repo,
    processor,
    timers,
    ...(diagnostics === undefined ? {} : { diagnostics }),
  });
}

describe('worker lease renewal', () => {
  it('renews the lease while a long task is running', async () => {
    const { repository, record } = renewRepository();
    const { processor, release } = deferredProcessor();
    const timers = timing();
    const worker = runWorkerWith([claimedEvent(1)], processor, repository, timers);
    await worker.start();
    await Promise.resolve();
    // Give the renew loop a few iterations via microtask ticks.
    await new Promise<void>((resolve) => setTimeout(resolve, 120));
    expect(record.renewCalls).toBeGreaterThanOrEqual(1);
    release();
    await Promise.resolve();
    await Promise.resolve();
    await worker.stop();
    expect(record.processed).toBe(1);
    // No renews after completion.
    const after = record.renewCalls;
    await new Promise<void>((resolve) => setTimeout(resolve, 60));
    expect(record.renewCalls).toBe(after);
  });

  it('aborts the processor and skips write-back on lease_lost', async () => {
    const { repository, record } = renewRepository();
    record.leaseLost = true;
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
    const timers = timing();
    const worker = runWorkerWith([claimedEvent(2)], processor, repository, timers);
    await worker.start();
    await Promise.resolve();
    await new Promise<void>((resolve) => setTimeout(resolve, 120));
    expect(aborted).toBe(true);
    await worker.stop();
    // lease_lost -> no final write-back.
    expect(record.processed).toBe(0);
  });

  it('records a diagnostic when the lease is lost', async () => {
    const diagnostics = new WorkerDiagnostics('worker-1', 100);
    const { repository, record } = renewRepository();
    record.leaseLost = true;
    const processor: IngestionEventProcessor = {
      process: (_input, signal) =>
        new Promise((resolve) => {
          signal.addEventListener(
            'abort',
            () => {
              resolve({ outcome: 'processed' });
            },
            { once: true },
          );
          if (signal.aborted) resolve({ outcome: 'processed' });
        }),
    };
    const timers = timing();
    const worker = runWorkerWith([claimedEvent(3)], processor, repository, timers, diagnostics);
    await worker.start();
    await Promise.resolve();
    await new Promise<void>((resolve) => setTimeout(resolve, 120));
    await worker.stop();
    expect(diagnostics.snapshot().some((d) => d.leaseLost === true)).toBe(true);
  });

  it('conservatively stops write-back when renewal fails twice', async () => {
    const { repository, record } = renewRepository();
    record.leaseLost = false;
    let renewAttempts = 0;
    const failingRepo: IngestionInboxProcessingRepository = {
      ...repository,
      renewLease: async () => {
        renewAttempts += 1;
        await Promise.resolve();
        throw new Error('db unavailable');
      },
    };
    const { processor, release } = deferredProcessor();
    const timers = timing();
    const worker = runWorkerWith([claimedEvent(4)], processor, failingRepo, timers);
    await worker.start();
    await Promise.resolve();
    await new Promise<void>((resolve) => setTimeout(resolve, 150));
    release();
    await Promise.resolve();
    await worker.stop();
    // Renewal failed at least twice; no write-back happened (ownership unknown).
    expect(renewAttempts).toBeGreaterThanOrEqual(2);
    expect(record.processed).toBe(0);
  });

  it('treats a not_found renewal as lost ownership', async () => {
    const { repository, record } = renewRepository();
    record.leaseLost = false;
    const notFoundRepo: IngestionInboxProcessingRepository = {
      ...repository,
      renewLease: () => Promise.resolve({ status: 'not_found' }),
    };
    let aborted = false;
    const processor: IngestionEventProcessor = {
      process: (_input, signal) =>
        new Promise((resolve) => {
          signal.addEventListener(
            'abort',
            () => {
              aborted = true;
              resolve({ outcome: 'processed' });
            },
            { once: true },
          );
        }),
    };
    const timers = timing();
    const worker = runWorkerWith([claimedEvent(5)], processor, notFoundRepo, timers);
    await worker.start();
    await Promise.resolve();
    await new Promise<void>((resolve) => setTimeout(resolve, 150));
    expect(aborted).toBe(true);
    await worker.stop();
    expect(record.processed).toBe(0);
  });
});
