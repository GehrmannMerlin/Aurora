import { describe, expect, it } from 'vitest';
import { buildIngestionWorker, type WorkerRuntime } from '../src/worker-runtime.js';
import type { IngestionInboxProcessingRepository } from '@aurora/ingestion-inbox';
import type { IngestionEventProcessor } from '../src/processor.js';
import type { WorkerTimingPorts } from '../src/timers.js';
import type { WorkerDiagnostics } from '../src/diagnostics.js';

interface FakeTimingPorts extends WorkerTimingPorts {
  sleeper: {
    sleep(ms: number, signal?: AbortSignal): Promise<void>;
    calls: { ms: number; signal?: AbortSignal }[];
  };
  timer: {
    set(fn: () => void, ms: number): { clear: () => void };
    registrations: (() => void)[];
    cleared: (() => void)[];
  };
}

function fakeTiming(): FakeTimingPorts {
  return {
    sleeper: {
      calls: [],
      sleep(ms, signal) {
        const call: { ms: number; signal?: AbortSignal } = { ms };
        if (signal !== undefined) call.signal = signal;
        this.calls.push(call);
        return new Promise<void>((resolve) => {
          if (signal?.aborted === true) {
            resolve();
            return;
          }
          // Resolve immediately unless aborted; claim loop tests advance by stop().
          resolve();
        });
      },
    },
    timer: {
      registrations: [],
      cleared: [],
      set(fn, ms) {
        void ms;
        this.registrations.push(fn);
        return {
          clear: () => {
            this.cleared.push(fn);
          },
        };
      },
    },
  };
}

function fakeRepository(): IngestionInboxProcessingRepository {
  return {
    claimAvailable: () => Promise.resolve({ status: 'nothingToClaim' }),
    renewLease: () => Promise.resolve({ status: 'success' }),
    markProcessed: () => Promise.resolve({ status: 'success' }),
    scheduleRetry: () => Promise.resolve({ status: 'success' }),
    markDeadLettered: () => Promise.resolve({ status: 'success' }),
  };
}

function fakeProcessor(process?: IngestionEventProcessor['process']): IngestionEventProcessor {
  return {
    process: process ?? (() => Promise.resolve({ outcome: 'processed' })),
  };
}

function baseConfig() {
  return {
    workerId: 'worker-1',
    claimBatchSize: 5,
    maxConcurrentHandlers: 2,
    leaseDurationMs: 1000,
    leaseRenewIntervalMs: 200,
    idlePollIntervalMs: 250,
    infrastructureFailureDelayMs: 500,
    shutdownGracePeriodMs: 2000,
    maxProcessingAttempts: 3,
    databaseUrl: 'postgresql://localhost/aurora_inbox_test',
    logEnabled: false,
  };
}

function buildWorker(overrides: {
  repository?: IngestionInboxProcessingRepository;
  processor?: IngestionEventProcessor;
  timing?: FakeTimingPorts;
  config?: ReturnType<typeof baseConfig>;
  diagnostics?: WorkerDiagnostics;
}): WorkerRuntime {
  const input: {
    config: ReturnType<typeof baseConfig>;
    repository: IngestionInboxProcessingRepository;
    processor: IngestionEventProcessor;
    timers: FakeTimingPorts;
    diagnostics?: WorkerDiagnostics;
  } = {
    config: overrides.config ?? baseConfig(),
    repository: overrides.repository ?? fakeRepository(),
    processor: overrides.processor ?? fakeProcessor(),
    timers: overrides.timing ?? fakeTiming(),
  };
  if (overrides.diagnostics !== undefined) input.diagnostics = overrides.diagnostics;
  return buildIngestionWorker(input);
}

describe('worker lifecycle', () => {
  it('moves created -> running -> stopped and rejects repeated start', async () => {
    const timing = fakeTiming();
    const worker = buildWorker({ timing });
    expect(worker.status).toBe('created');
    await worker.start();
    expect(worker.status).toBe('running');
    await expect(worker.start()).rejects.toThrow(/running/);
    await worker.stop();
    expect(worker.status).toBe('stopped');
    await expect(worker.start()).rejects.toThrow(/stopped/);
  });

  it('rejects repeated stop idempotently', async () => {
    const worker = buildWorker({});
    await worker.start();
    await worker.stop();
    await expect(worker.stop()).resolves.toBeUndefined();
    expect(worker.status).toBe('stopped');
  });

  it('supports stop while start is in progress', async () => {
    const timing = fakeTiming();
    const worker = buildWorker({ timing });
    const startPromise = worker.start();
    await Promise.resolve();
    await worker.stop();
    await startPromise;
    expect(worker.status).toBe('stopped');
  });

  it('does not claim after stop', async () => {
    let claimCalls = 0;
    const repository: IngestionInboxProcessingRepository = {
      ...fakeRepository(),
      claimAvailable: async () => {
        claimCalls += 1;
        await Promise.resolve();
        return { status: 'nothingToClaim' };
      },
    };
    const worker = buildWorker({ repository });
    await worker.start();
    await worker.stop();
    const before = claimCalls;
    await Promise.resolve();
    expect(claimCalls).toBe(before);
  });
});
