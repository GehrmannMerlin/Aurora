import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import type {
  ClaimOutboxRowsInput,
  DirectMailClientPort,
  EmailDeliveryPort,
  OutboxRepository,
} from '@aurora/platform-email';
import { createPlatformEmailPort } from '../src/index.js';
import { buildPlatformWorker } from '../src/worker.js';
import type { SleeperPort } from '../src/timers.js';

const fakePool = {} as Pool;

const enqueuePort: EmailDeliveryPort = {
  deliver: () => Promise.resolve({ status: 'accepted' as const }),
};

const emailReliabilitySettings = {
  processingTimeoutMs: 120_000,
  retryBaseDelayMs: 2_000,
  retryMaxDelayMs: 90_000,
} as const;

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
  it('passes the configured processing lease and retry policy to the consumer', async () => {
    let claimInput: ClaimOutboxRowsInput | undefined;
    const repo: OutboxRepository = {
      insertOutboxRow: () => Promise.resolve({ status: 'success', outboxId: 'outbox-1' }),
      claimOutboxRows: (_pool, input) => {
        claimInput = input;
        return Promise.resolve({ status: 'nothingToClaim' });
      },
      markOutboxResult: () => Promise.resolve({ status: 'success' }),
    };
    const { sleeper } = tickSleeper();
    const worker = buildPlatformWorker({
      pool: fakePool,
      port: enqueuePort,
      outboxRepo: repo,
      pollIntervalMs: 60_000,
      batchLimit: 20,
      maxAttempts: 5,
      ...emailReliabilitySettings,
      sleeper,
    });

    await worker.start();
    await waitUntil(() => claimInput !== undefined);
    await worker.stop();

    expect(claimInput?.processingTimeoutMs).toBe(120_000);
  });

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
      ...emailReliabilitySettings,
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
      ...emailReliabilitySettings,
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
      ...emailReliabilitySettings,
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
      ...emailReliabilitySettings,
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
        ...emailReliabilitySettings,
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

describe('platform-worker email delivery composition', () => {
  it('does not construct an Aliyun client in console mode', async () => {
    let factoryCalls = 0;
    const port = createPlatformEmailPort(
      {
        mode: 'console',
        accountName: null,
        fromAlias: 'Aurora',
        regionId: 'cn-hangzhou',
        endpoint: null,
        providerTimeoutMs: 10_000,
      },
      () => {
        factoryCalls += 1;
        throw new Error('Aliyun client must not be constructed in console mode');
      },
    );

    expect(factoryCalls).toBe(0);
    await expect(
      port.deliver({
        intentType: 'email_verification',
        toAddress: 'user@example.invalid',
        toAddressMasked: 'u***@example.invalid',
        mailLinkUrl: 'https://console.invalid/verify-email?token=not-a-real-token',
        expiresInMinutes: 120,
      }),
    ).resolves.toEqual({ status: 'accepted' });
  });

  it('constructs the Aliyun adapter once with public settings and an injected client factory', async () => {
    const factoryOptions: unknown[] = [];
    const requests: unknown[] = [];
    const fakeClient: DirectMailClientPort = {
      singleSendMail: (request) => {
        requests.push(request);
        return Promise.resolve({ requestId: 'provider-request-1' });
      },
    };
    const port = createPlatformEmailPort(
      {
        mode: 'aliyun',
        accountName: 'no-reply@example.invalid',
        fromAlias: 'Aurora',
        regionId: 'cn-shanghai',
        endpoint: 'dm.cn-shanghai.aliyuncs.com',
        providerTimeoutMs: 8_000,
      },
      (options) => {
        factoryOptions.push(options);
        return fakeClient;
      },
    );

    const result = await port.deliver({
      intentType: 'email_verification',
      toAddress: 'user@example.invalid',
      toAddressMasked: 'u***@example.invalid',
      mailLinkUrl: 'https://console.invalid/verify-email?token=not-a-real-token',
      expiresInMinutes: 120,
    });

    expect(factoryOptions).toEqual([
      { regionId: 'cn-shanghai', endpoint: 'dm.cn-shanghai.aliyuncs.com' },
    ]);
    expect(requests).toHaveLength(1);
    expect(result).toEqual({ status: 'accepted', providerRequestId: 'provider-request-1' });
  });
});
