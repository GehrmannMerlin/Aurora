import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import type { EmailDeliveryPort, OutboxRepository } from '@aurora/platform-email';
import { buildPlatformWorker } from '../src/worker.js';
import type { SleeperPort } from '../src/timers.js';

const fakePool = {} as Pool;

const enqueuePort: EmailDeliveryPort = {
  deliver: () => Promise.resolve({ status: 'enqueued' as const }),
};

interface NothingToClaimRepo {
  repo: OutboxRepository;
  claimCount: () => number;
}

function createNothingToClaimRepo(): NothingToClaimRepo {
  let claims = 0;
  const repo: OutboxRepository = {
    insertOutboxRow: () => Promise.resolve({ status: 'success' as const, outboxId: 'outbox-1' }),
    claimOutboxRows: () => {
      claims += 1;
      return Promise.resolve({ status: 'nothingToClaim' as const });
    },
    markOutboxResult: () => Promise.resolve({ status: 'success' as const }),
  };
  return { repo, claimCount: () => claims };
}

function tickSleeper(): { sleeper: SleeperPort; sleepMs: number[] } {
  const sleepMs: number[] = [];
  const sleeper: SleeperPort = {
    sleep: async (ms) => {
      sleepMs.push(ms);
      await new Promise<void>((resolve) => setTimeout(resolve, 1));
    },
  };
  return { sleeper, sleepMs };
}

async function waitUntil(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('waitUntil timed out');
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
}

describe('platform-worker poll loop', () => {
  it('polls consumeOutboxEmails on the configured interval', async () => {
    const { repo, claimCount } = createNothingToClaimRepo();
    const { sleeper, sleepMs } = tickSleeper();
    const worker = buildPlatformWorker({
      pool: fakePool,
      port: enqueuePort,
      outboxRepo: repo,
      pollIntervalMs: 30,
      batchLimit: 20,
      maxAttempts: 5,
      sleeper,
    });

    await worker.start();
    await waitUntil(() => claimCount() >= 1);

    expect(claimCount()).toBeGreaterThanOrEqual(1);
    expect(sleepMs).toContain(30);

    await worker.stop();
    expect(worker.status).toBe('stopped');
  });

  it('uses the injected sleeper to control cadence', async () => {
    const { repo } = createNothingToClaimRepo();
    const { sleeper, sleepMs } = tickSleeper();
    const worker = buildPlatformWorker({
      pool: fakePool,
      port: enqueuePort,
      outboxRepo: repo,
      pollIntervalMs: 75,
      batchLimit: 20,
      maxAttempts: 5,
      sleeper,
    });

    await worker.start();
    await waitUntil(() => sleepMs.length >= 1);
    expect(sleepMs[0]).toBe(75);

    await worker.stop();
  });

  it('stops polling after stop() aborts the loop', async () => {
    const { repo, claimCount } = createNothingToClaimRepo();
    const { sleeper } = tickSleeper();
    const worker = buildPlatformWorker({
      pool: fakePool,
      port: enqueuePort,
      outboxRepo: repo,
      pollIntervalMs: 5,
      batchLimit: 20,
      maxAttempts: 5,
      sleeper,
    });

    await worker.start();
    await waitUntil(() => claimCount() >= 2);
    await worker.stop();
    const afterStop = claimCount();

    await new Promise<void>((resolve) => setTimeout(resolve, 30));
    expect(claimCount()).toBe(afterStop);
    expect(worker.status).toBe('stopped');
  });

  it('cannot start twice and stop is idempotent', async () => {
    const { repo } = createNothingToClaimRepo();
    const { sleeper } = tickSleeper();
    const worker = buildPlatformWorker({
      pool: fakePool,
      port: enqueuePort,
      outboxRepo: repo,
      pollIntervalMs: 60_000,
      batchLimit: 20,
      maxAttempts: 5,
      sleeper,
    });

    await worker.start();
    await expect(worker.start()).rejects.toThrow('cannot start');

    await worker.stop();
    await worker.stop();
    await expect(worker.start()).rejects.toThrow('cannot start');
    expect(worker.status).toBe('stopped');
  });

  it('survives a poll error and keeps polling', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      let shouldFail = true;
      let claims = 0;
      const repo: OutboxRepository = {
        insertOutboxRow: () =>
          Promise.resolve({ status: 'success' as const, outboxId: 'outbox-1' }),
        claimOutboxRows: () => {
          claims += 1;
          if (shouldFail) return Promise.reject(new Error('database unreachable'));
          return Promise.resolve({ status: 'nothingToClaim' as const });
        },
        markOutboxResult: () => Promise.resolve({ status: 'success' as const }),
      };
      const { sleeper } = tickSleeper();
      const worker = buildPlatformWorker({
        pool: fakePool,
        port: enqueuePort,
        outboxRepo: repo,
        pollIntervalMs: 5,
        batchLimit: 20,
        maxAttempts: 5,
        sleeper,
      });

      await worker.start();
      await waitUntil(() => claims >= 1);
      expect(errorSpy).toHaveBeenCalled();

      shouldFail = false;
      await waitUntil(() => claims >= 2);

      await worker.stop();
      expect(worker.status).toBe('stopped');
    } finally {
      errorSpy.mockRestore();
    }
  });
});
