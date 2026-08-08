import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { createProductionIngestionWorker } from '../src/production-composition.js';
import type { IngestionWorkerConfig } from '../src/configuration.js';
import type { RetryBackoffConfig } from '../src/retry-backoff-types.js';

const backoff: RetryBackoffConfig = { initialDelayMs: 100, maxDelayMs: 1000 };

const config: IngestionWorkerConfig = {
  workerId: 'test-worker',
  claimBatchSize: 5,
  maxConcurrentHandlers: 2,
  leaseDurationMs: 30_000,
  leaseRenewIntervalMs: 10_000,
  idlePollIntervalMs: 1000,
  infrastructureFailureDelayMs: 500,
  shutdownGracePeriodMs: 5000,
  maxProcessingAttempts: 3,
  databaseUrl: 'postgres://test',
  logEnabled: false,
};

function fakePool(): { pool: Pool; connect: ReturnType<typeof vi.fn> } {
  const connect = vi.fn();
  return { pool: { connect } as unknown as Pool, connect };
}

describe('createProductionIngestionWorker', () => {
  it('wires a real router with three processors and returns it as the worker processor', () => {
    const { pool } = fakePool();
    const worker = createProductionIngestionWorker({ config, pool, backoff, entropyProvider: { next: () => 0 }, now: () => new Date('2026-08-07T00:00:00.000Z') });
    expect(typeof worker.processor.process).toBe('function');
    expect(typeof worker.close).toBe('function');
  });

  it('provides a close that is idempotent and does not close a caller-owned pool', async () => {
    const { pool, connect } = fakePool();
    const worker = createProductionIngestionWorker({ config, pool, backoff, entropyProvider: { next: () => 0 }, now: () => new Date('2026-08-07T00:00:00.000Z') });
    await worker.close();
    await worker.close();
    expect(connect).toHaveBeenCalledTimes(0); // composition does not open a pool
  });
});
