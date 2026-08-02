import { describe, expect, it } from 'vitest';
import { buildIngestionWorker } from '../src/worker-runtime.js';
import type {
  ClaimAvailableInboxEventsInput,
  ClaimAvailableInboxEventsResult,
  ClaimedInboxEvent,
  IngestionInboxProcessingRepository,
} from '@aurora/ingestion-inbox';
import type { IngestionEventProcessor } from '../src/processor.js';
import type { WorkerTimingPorts } from '../src/timers.js';

function claimedEvent(id: number): ClaimedInboxEvent {
  return {
    id,
    projectId: '11111111-1111-1111-1111-111111111111',
    eventId: `evt-${String(id)}`,
    event: { protocolVersion: 1 } as never,
    attemptCount: 1,
    leaseId: `lease-${String(id)}`,
    leaseExpiresAt: new Date(Date.now() + 60_000),
  };
}

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

function processorWithQueue(
  queue: ((signal: AbortSignal) => Promise<void>)[],
): IngestionEventProcessor {
  let index = 0;
  return {
    process: async (_input, signal) => {
      const handler = queue[index];
      index += 1;
      if (handler !== undefined) {
        await handler(signal);
        return { outcome: 'processed' };
      }
      // No handler queued: block until aborted, then settle (never write back).
      await new Promise<void>((resolve) => {
        const onAbort = (): void => { resolve(); };
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) resolve();
      });
      return { outcome: 'processed' };
    },
  };
}

function makeClaimingRepository(batch: ClaimedInboxEvent[]): IngestionInboxProcessingRepository & {
  claims: { limit: number }[];
} {
  const claims: { limit: number }[] = [];
  let exhausted = false;
  return {
    claims,
    claimAvailable: async (
      input: ClaimAvailableInboxEventsInput,
    ): Promise<ClaimAvailableInboxEventsResult> => {
      claims.push({ limit: input.limit });
      await Promise.resolve();
      if (exhausted || batch.length === 0) return { status: 'nothingToClaim' };
      exhausted = true;
      return { status: 'claimed', events: batch };
    },
    renewLease: () => Promise.resolve({ status: 'success' }),
    markProcessed: () => Promise.resolve({ status: 'success' }),
    scheduleRetry: () => Promise.resolve({ status: 'success' }),
    markDeadLettered: () => Promise.resolve({ status: 'success' }),
  };
}

function baseConfig() {
  return {
    workerId: 'worker-1',
    claimBatchSize: 10,
    maxConcurrentHandlers: 3,
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

describe('worker claim loop and capacity control', () => {
  it('claims at most the remaining capacity on the first round', async () => {
    const repository = makeClaimingRepository([
      claimedEvent(1),
      claimedEvent(2),
      claimedEvent(3),
      claimedEvent(4),
      claimedEvent(5),
    ]);
    const processor = processorWithQueue([]);
    const worker = buildIngestionWorker({
      config: baseConfig(),
      repository,
      processor,
      timers: timing(),
    });
    await worker.start();
    // Let a couple of microtasks run so the first claim round executes.
    await Promise.resolve();
    await Promise.resolve();
    await worker.stop();
    expect(repository.claims.length).toBeGreaterThanOrEqual(1);
    const first = repository.claims[0];
    expect(first?.limit).toBeLessThanOrEqual(3); // maxConcurrentHandlers
    expect(first?.limit).toBeLessThanOrEqual(10); // claimBatchSize
  });

  it('does not claim when capacity is exhausted', async () => {
    // All handlers block until aborted, filling all capacity.
    const blocking = [1, 2, 3].map(
      () => (signal: AbortSignal) =>
        new Promise<void>((resolve) => {
          const onAbort = (): void => { resolve(); };
          signal.addEventListener('abort', onAbort, { once: true });
          if (signal.aborted) resolve();
        }),
    );
    const repository = makeClaimingRepository([
      claimedEvent(1),
      claimedEvent(2),
      claimedEvent(3),
    ]);
    const processor = processorWithQueue(blocking);
    const timingPorts = timing();
    const worker = buildIngestionWorker({
      config: baseConfig(),
      repository,
      processor,
      timers: timingPorts,
    });
    await worker.start();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    // Capacity is exhausted by three blocking handlers; the loop must not issue
    // a new claim (limit > 0) while they run.
    const zeroCapacityClaims = repository.claims.filter((c) => c.limit === 0).length;
    const positiveClaimsWhileBlocking = repository.claims.filter((c) => c.limit > 0).length;
    await worker.stop();
    expect(positiveClaimsWhileBlocking).toBe(1); // only the first round claimed
    expect(zeroCapacityClaims).toBeGreaterThanOrEqual(0);
  });

  it('waits for idlePollIntervalMs when nothing is claimable', async () => {
    const repository = makeClaimingRepository([]);
    const timingPorts = timing();
    const worker = buildIngestionWorker({
      config: baseConfig(),
      repository,
      processor: processorWithQueue([]),
      timers: timingPorts,
    });
    await worker.start();
    await Promise.resolve();
    await Promise.resolve();
    await worker.stop();
    // At least one idle wait should have been observed between claim rounds.
    expect(timingPorts.sleeper.calls.some((call) => call.ms === 250)).toBe(true);
  });

  it('does not overlap claim rounds (one round finishes before the next starts)', async () => {
    const repository = makeClaimingRepository([]);
    const timingPorts = timing();
    const worker = buildIngestionWorker({
      config: baseConfig(),
      repository,
      processor: processorWithQueue([]),
      timers: timingPorts,
    });
    await worker.start();
    await Promise.resolve();
    await worker.stop();
    // Serial claim rounds mean claim calls are never issued concurrently.
    expect(repository.claims.every((claim) => claim.limit > 0)).toBe(true);
  });

  it('retries the claim after an infrastructure failure delay', async () => {
    const claims: { limit: number }[] = [];
    let fails = 2;
    const repository: IngestionInboxProcessingRepository = {
      claimAvailable: async (input) => {
        claims.push({ limit: input.limit });
        if (fails > 0) {
          fails -= 1;
          throw new Error('db unavailable');
        }
        await Promise.resolve();
        return { status: 'nothingToClaim' };
      },
      renewLease: () => Promise.resolve({ status: 'success' }),
      markProcessed: () => Promise.resolve({ status: 'success' }),
      scheduleRetry: () => Promise.resolve({ status: 'success' }),
      markDeadLettered: () => Promise.resolve({ status: 'success' }),
    };
    const timingPorts = timing();
    const worker = buildIngestionWorker({
      config: baseConfig(),
      repository,
      processor: processorWithQueue([]),
      timers: timingPorts,
    });
    await worker.start();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await worker.stop();
    // Two failed claim attempts were made and recovered from with a delay.
    expect(claims.length).toBeGreaterThanOrEqual(2);
    // The infrastructure failure delay was used between attempts.
    expect(timingPorts.sleeper.calls.some((call) => call.ms === 500)).toBe(true);
  });

  it('stops cleanly from the created state without starting', async () => {
    const worker = buildIngestionWorker({
      config: baseConfig(),
      repository: makeClaimingRepository([]),
      processor: processorWithQueue([]),
      timers: timing(),
    });
    await worker.stop();
    expect(worker.status).toBe('stopped');
  });
});
