import { describe, expect, it } from 'vitest';
import { loadIngestionWorkerConfig } from '../src/configuration.js';

const validEnv = {
  WORKER_ID: 'worker-1',
  CLAIM_BATCH_SIZE: '5',
  MAX_CONCURRENT_HANDLERS: '3',
  LEASE_DURATION_MS: '1000',
  LEASE_RENEW_INTERVAL_MS: '200',
  IDLE_POLL_INTERVAL_MS: '250',
  INFRASTRUCTURE_FAILURE_DELAY_MS: '500',
  SHUTDOWN_GRACE_PERIOD_MS: '2000',
  MAX_PROCESSING_ATTEMPTS: '3',
  DATABASE_URL: 'postgresql://localhost/aurora_inbox_test',
};

describe('loadIngestionWorkerConfig', () => {
  it('freezes a typed config from valid environment strings', () => {
    const config = loadIngestionWorkerConfig(validEnv);
    expect(config.workerId).toBe('worker-1');
    expect(config.claimBatchSize).toBe(5);
    expect(config.maxConcurrentHandlers).toBe(3);
    expect(config.leaseDurationMs).toBe(1000);
    expect(config.leaseRenewIntervalMs).toBe(200);
    expect(config.idlePollIntervalMs).toBe(250);
    expect(config.infrastructureFailureDelayMs).toBe(500);
    expect(config.shutdownGracePeriodMs).toBe(2000);
    expect(config.maxProcessingAttempts).toBe(3);
    expect(config.databaseUrl).toBe('postgresql://localhost/aurora_inbox_test');
    expect(config.logEnabled).toBe(false);
    expect(Object.isFrozen(config)).toBe(true);
  });

  it('fails startup when a required key is missing', () => {
    const rest: Record<string, string> = { ...validEnv };
    delete rest.WORKER_ID;
    expect(() => loadIngestionWorkerConfig(rest)).toThrow(/WORKER_ID/);
  });

  it('fails startup on a non-positive integer', () => {
    expect(() => loadIngestionWorkerConfig({ ...validEnv, CLAIM_BATCH_SIZE: '0' })).toThrow(
      /CLAIM_BATCH_SIZE/,
    );
    expect(() => loadIngestionWorkerConfig({ ...validEnv, LEASE_DURATION_MS: '-1' })).toThrow(
      /LEASE_DURATION_MS/,
    );
    expect(() => loadIngestionWorkerConfig({ ...validEnv, IDLE_POLL_INTERVAL_MS: 'abc' })).toThrow(
      /IDLE_POLL_INTERVAL_MS/,
    );
  });

  it('fails startup when leaseRenewIntervalMs >= leaseDurationMs', () => {
    expect(() =>
      loadIngestionWorkerConfig({ ...validEnv, LEASE_RENEW_INTERVAL_MS: '1000' }),
    ).toThrow(/LEASE_RENEW_INTERVAL_MS/);
  });

  it('fails startup when maxConcurrentHandlers > claimBatchSize', () => {
    expect(() =>
      loadIngestionWorkerConfig({ ...validEnv, MAX_CONCURRENT_HANDLERS: '6' }),
    ).toThrow(/MAX_CONCURRENT_HANDLERS/);
  });

  it('fails startup when claimBatchSize exceeds the inbox claim limit', () => {
    expect(() =>
      loadIngestionWorkerConfig({ ...validEnv, CLAIM_BATCH_SIZE: '101' }),
    ).toThrow(/CLAIM_BATCH_SIZE/);
  });

  it('defaults logEnabled to false when absent', () => {
    const { ...rest } = validEnv;
    const config = loadIngestionWorkerConfig(rest);
    expect(config.logEnabled).toBe(false);
  });

  it('rejects an invalid logEnabled boolean value', () => {
    expect(() => loadIngestionWorkerConfig({ ...validEnv, LOG_ENABLED: 'yes' })).toThrow(
      /LOG_ENABLED/,
    );
  });

  it('fails startup when MAX_PROCESSING_ATTEMPTS is missing', () => {
    const rest: Record<string, string> = { ...validEnv };
    delete rest.MAX_PROCESSING_ATTEMPTS;
    expect(() => loadIngestionWorkerConfig(rest)).toThrow(/MAX_PROCESSING_ATTEMPTS/);
  });

  it('rejects non-positive, non-integer, or non-safe-integer MAX_PROCESSING_ATTEMPTS', () => {
    expect(() => loadIngestionWorkerConfig({ ...validEnv, MAX_PROCESSING_ATTEMPTS: '0' })).toThrow(
      /MAX_PROCESSING_ATTEMPTS/,
    );
    expect(() => loadIngestionWorkerConfig({ ...validEnv, MAX_PROCESSING_ATTEMPTS: '-1' })).toThrow(
      /MAX_PROCESSING_ATTEMPTS/,
    );
    expect(() => loadIngestionWorkerConfig({ ...validEnv, MAX_PROCESSING_ATTEMPTS: '2.5' })).toThrow(
      /MAX_PROCESSING_ATTEMPTS/,
    );
    expect(() =>
      loadIngestionWorkerConfig({ ...validEnv, MAX_PROCESSING_ATTEMPTS: '9007199254740992' }),
    ).toThrow(/MAX_PROCESSING_ATTEMPTS/);
  });
});
