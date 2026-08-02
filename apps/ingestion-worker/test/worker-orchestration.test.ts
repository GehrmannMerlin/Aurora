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
      sleep(ms, signal) {
        this.calls.push({ ms });
        void signal;
        return Promise.resolve();
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

function claimedEvent(id: number, eventId?: string, attemptCount = 1): ClaimedInboxEvent {
  return {
    id,
    projectId: '11111111-1111-1111-1111-111111111111',
    eventId: eventId ?? `evt-${String(id)}`,
    event: { protocolVersion: 1, eventType: 'error', eventId: eventId ?? `evt-${String(id)}` },
    attemptCount,
    leaseId: `lease-${String(id)}`,
    leaseExpiresAt: new Date(Date.now() + 60_000),
  } as ClaimedInboxEvent;
}

interface RecordedWriteBacks {
  processed: { id: number; leaseId: string }[];
  retries: { id: number; leaseId: string; errorCode: string }[];
  deadLettered: { id: number; leaseId: string; errorCode: string }[];
  leaseLost: boolean;
}

function recordingRepository(overrides?: Partial<IngestionInboxProcessingRepository>): {
  repository: IngestionInboxProcessingRepository;
  writes: RecordedWriteBacks;
} {
  const writes: RecordedWriteBacks = {
    processed: [],
    retries: [],
    deadLettered: [],
    leaseLost: false,
  };
  const repository: IngestionInboxProcessingRepository = {
    claimAvailable: () => Promise.resolve({ status: 'nothingToClaim' }),
    renewLease: () => {
      writes.leaseLost = true;
      return Promise.resolve({ status: 'lease_lost' });
    },
    markProcessed: (input) => {
      writes.processed.push(input);
      return Promise.resolve({ status: 'success' });
    },
    scheduleRetry: (input) => {
      writes.retries.push({
        id: input.id,
        leaseId: input.leaseId,
        errorCode: input.errorCode ?? 'unspecified',
      });
      return Promise.resolve({ status: 'success' });
    },
    markDeadLettered: (input) => {
      writes.deadLettered.push({
        id: input.id,
        leaseId: input.leaseId,
        errorCode: input.errorCode ?? 'unspecified',
      });
      return Promise.resolve({ status: 'success' });
    },
    ...overrides,
  };
  return { repository, writes };
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

function runSingleEventWorker(
  events: ClaimedInboxEvent[],
  processor: IngestionEventProcessor,
  repository: IngestionInboxProcessingRepository,
  diagnostics?: WorkerDiagnostics,
) {
  const repo: IngestionInboxProcessingRepository = {
    ...repository,
    claimAvailable: () =>
      Promise.resolve(
        events.length === 0
          ? { status: 'nothingToClaim' }
          : { status: 'claimed', events: events.splice(0) },
      ),
  };
  const worker = buildIngestionWorker({
    config: baseConfig(),
    repository: repo,
    processor,
    timers: timing(),
    ...(diagnostics === undefined ? {} : { diagnostics }),
  });
  return worker;
}

describe('worker processor orchestration', () => {
  it('writes processed for a processor that returns processed', async () => {
    const { repository, writes } = recordingRepository();
    const worker = runSingleEventWorker(
      [claimedEvent(1)],
      { process: () => Promise.resolve({ outcome: 'processed' }) },
      repository,
    );
    await worker.start();
    await Promise.resolve();
    await Promise.resolve();
    await worker.stop();
    expect(writes.processed).toHaveLength(1);
    expect(writes.processed[0]).toMatchObject({ id: 1, leaseId: 'lease-1' });
    expect(writes.retries).toHaveLength(0);
    expect(writes.deadLettered).toHaveLength(0);
  });

  it('writes retry with the processor-provided availableAt and errorCode', async () => {
    const { repository, writes } = recordingRepository();
    const worker = runSingleEventWorker(
      [claimedEvent(2)],
      {
        process: () =>
          Promise.resolve({
            outcome: 'retry' as const,
            availableAt: new Date('2026-08-01T00:00:30Z'),
            errorCode: 'service_temporarily_unavailable' as const,
          }),
      },
      repository,
    );
    await worker.start();
    await Promise.resolve();
    await Promise.resolve();
    await worker.stop();
    expect(writes.retries).toHaveLength(1);
    expect(writes.retries[0]).toMatchObject({
      id: 2,
      leaseId: 'lease-2',
      errorCode: 'service_temporarily_unavailable',
    });
  });

  it('writes dead-letter with the processor-provided errorCode', async () => {
    const { repository, writes } = recordingRepository();
    const worker = runSingleEventWorker(
      [claimedEvent(3)],
      { process: () => Promise.resolve({ outcome: 'dead-letter', errorCode: 'invalid_schema' }) },
      repository,
    );
    await worker.start();
    await Promise.resolve();
    await Promise.resolve();
    await worker.stop();
    expect(writes.deadLettered).toHaveLength(1);
    expect(writes.deadLettered[0]).toMatchObject({
      id: 3,
      leaseId: 'lease-3',
      errorCode: 'invalid_schema',
    });
  });

  it('does not write back when the processor throws and records a diagnostic', async () => {
    const diagnostics = new WorkerDiagnostics('worker-1', 100);
    const { repository, writes } = recordingRepository();
    const worker = runSingleEventWorker(
      [claimedEvent(4)],
      {
        process: () => Promise.reject(new Error('processor boom')),
      },
      repository,
      diagnostics,
    );
    await worker.start();
    await Promise.resolve();
    await Promise.resolve();
    await worker.stop();
    expect(writes.processed).toHaveLength(0);
    expect(writes.retries).toHaveLength(0);
    expect(writes.deadLettered).toHaveLength(0);
    expect(diagnostics.snapshot().some((d) => d.code === 'processor_failed')).toBe(true);
  });

  it('continues processing other events when one processor throws', async () => {
    let callCount = 0;
    const { repository, writes } = recordingRepository();
    const processor: IngestionEventProcessor = {
      process: async () => {
        callCount += 1;
        if (callCount === 1) throw new Error('first event boom');
        await Promise.resolve();
        return { outcome: 'processed' };
      },
    };
    let handedOut = false;
    const repo: IngestionInboxProcessingRepository = {
      ...repository,
      claimAvailable: async () => {
        if (handedOut) return { status: 'nothingToClaim' };
        handedOut = true;
        await Promise.resolve();
        return {
          status: 'claimed',
          events: [claimedEvent(1), claimedEvent(2)],
        };
      },
    };
    const worker = buildIngestionWorker({
      config: baseConfig(),
      repository: repo,
      processor,
      timers: timing(),
    });
    await worker.start();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await worker.stop();
    // The first event failed without a write-back; the second was processed.
    expect(writes.processed).toHaveLength(1);
    expect(writes.processed[0]).toMatchObject({ id: 2 });
  });

  it('does not retry the write-back when it returns lease_lost', async () => {
    let processedCalls = 0;
    let handedOut = false;
    const { repository } = recordingRepository();
    const repo: IngestionInboxProcessingRepository = {
      ...repository,
      claimAvailable: async () => {
        if (handedOut) return { status: 'nothingToClaim' };
        handedOut = true;
        await Promise.resolve();
        return { status: 'claimed', events: [claimedEvent(7)] };
      },
      markProcessed: async () => {
        processedCalls += 1;
        await Promise.resolve();
        return { status: 'lease_lost' };
      },
    };
    const worker = buildIngestionWorker({
      config: baseConfig(),
      repository: repo,
      processor: { process: () => Promise.resolve({ outcome: 'processed' }) },
      timers: timing(),
    });
    await worker.start();
    await Promise.resolve();
    await Promise.resolve();
    await worker.stop();
    // The write-back returned lease_lost; it is not retried.
    expect(processedCalls).toBe(1);
  });
});

describe('worker retry budget disposition', () => {
  it('schedules a retry while attempts remain below the max', async () => {
    const { repository, writes } = recordingRepository();
    const worker = runSingleEventWorker(
      [claimedEvent(10, undefined, 1)],
      {
        process: () =>
          Promise.resolve({
            outcome: 'retry' as const,
            availableAt: new Date('2026-08-02T00:00:30Z'),
            errorCode: 'service_temporarily_unavailable' as const,
          }),
      },
      repository,
    );
    await worker.start();
    await Promise.resolve();
    await Promise.resolve();
    await worker.stop();
    expect(writes.retries).toHaveLength(1);
    expect(writes.retries[0]).toMatchObject({
      id: 10,
      leaseId: 'lease-10',
      errorCode: 'service_temporarily_unavailable',
    });
    expect(writes.deadLettered).toHaveLength(0);
  });

  it('dead-letters with retry_budget_exhausted when attempts reach the max', async () => {
    const { repository, writes } = recordingRepository();
    const worker = runSingleEventWorker(
      [claimedEvent(11, undefined, 3)],
      {
        process: () =>
          Promise.resolve({
            outcome: 'retry' as const,
            availableAt: new Date('2026-08-02T00:00:30Z'),
            errorCode: 'service_temporarily_unavailable' as const,
          }),
      },
      repository,
    );
    await worker.start();
    await Promise.resolve();
    await Promise.resolve();
    await worker.stop();
    expect(writes.retries).toHaveLength(0);
    expect(writes.deadLettered).toHaveLength(1);
    expect(writes.deadLettered[0]).toMatchObject({
      id: 11,
      leaseId: 'lease-11',
      errorCode: 'retry_budget_exhausted',
    });
  });

  it('does not modify attemptCount through the disposition', async () => {
    const { repository, writes } = recordingRepository();
    const worker = runSingleEventWorker(
      [claimedEvent(12, undefined, 3)],
      {
        process: () =>
          Promise.resolve({
            outcome: 'retry' as const,
            availableAt: new Date(),
            errorCode: 'service_temporarily_unavailable' as const,
          }),
      },
      repository,
    );
    await worker.start();
    await Promise.resolve();
    await Promise.resolve();
    await worker.stop();
    // Exactly one dead-letter write-back; the Worker never increments attemptCount itself.
    expect(writes.deadLettered).toHaveLength(1);
    expect(writes.retries).toHaveLength(0);
  });

  it('invalid retry results do not write back and record a diagnostic', async () => {
    const diagnostics = new WorkerDiagnostics('worker-1', 100);
    const { repository, writes } = recordingRepository();
    const worker = runSingleEventWorker(
      [claimedEvent(13, undefined, 1)],
      {
        process: () =>
          Promise.resolve({
            outcome: 'retry' as const,
            availableAt: new Date(NaN),
            errorCode: 'service_temporarily_unavailable' as const,
          }),
      },
      repository,
      diagnostics,
    );
    await worker.start();
    await Promise.resolve();
    await Promise.resolve();
    await worker.stop();
    expect(writes.retries).toHaveLength(0);
    expect(writes.deadLettered).toHaveLength(0);
    expect(diagnostics.snapshot().some((d) => d.code === 'processor_retry_result_invalid')).toBe(
      true,
    );
  });

  it('explicit dead-letter is not affected by the retry budget', async () => {
    const { repository, writes } = recordingRepository();
    const worker = runSingleEventWorker(
      [claimedEvent(14, undefined, 5)],
      { process: () => Promise.resolve({ outcome: 'dead-letter', errorCode: 'invalid_schema' }) },
      repository,
    );
    await worker.start();
    await Promise.resolve();
    await Promise.resolve();
    await worker.stop();
    expect(writes.deadLettered).toHaveLength(1);
    expect(writes.deadLettered[0]).toMatchObject({
      id: 14,
      errorCode: 'invalid_schema',
    });
  });
});
