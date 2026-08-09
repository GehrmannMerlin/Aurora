import { describe, expect, it } from 'vitest';
import { loadPlatformWorkerConfig } from '../src/config.js';

const DATABASE_URL = 'postgresql://aurora:aurora_test_pw@localhost:15432/aurora_inbox_test';

describe('loadPlatformWorkerConfig', () => {
  it('applies defaults and reads DATABASE_URL', () => {
    const config = loadPlatformWorkerConfig({ DATABASE_URL });
    expect(config.databaseUrl).toBe(DATABASE_URL);
    expect(config.emailDeliveryMode).toBe('console');
    expect(config.outboxPollIntervalMs).toBe(2000);
    expect(config.outboxBatchLimit).toBe(20);
    expect(config.outboxMaxAttempts).toBe(5);
    expect(config.gracefulShutdownTimeoutMs).toBe(5000);
  });

  it('reads explicit environment values', () => {
    const config = loadPlatformWorkerConfig({
      DATABASE_URL,
      EMAIL_DELIVERY_MODE: 'console',
      OUTBOX_POLL_INTERVAL_MS: '1234',
      OUTBOX_BATCH_LIMIT: '7',
      OUTBOX_MAX_ATTEMPTS: '3',
      GRACEFUL_SHUTDOWN_TIMEOUT_MS: '9999',
    });
    expect(config.emailDeliveryMode).toBe('console');
    expect(config.outboxPollIntervalMs).toBe(1234);
    expect(config.outboxBatchLimit).toBe(7);
    expect(config.outboxMaxAttempts).toBe(3);
    expect(config.gracefulShutdownTimeoutMs).toBe(9999);
  });

  it('normalizes EMAIL_DELIVERY_MODE to lower case', () => {
    const config = loadPlatformWorkerConfig({ DATABASE_URL, EMAIL_DELIVERY_MODE: 'CONSOLE' });
    expect(config.emailDeliveryMode).toBe('console');
  });

  it('rejects a missing DATABASE_URL', () => {
    expect(() => loadPlatformWorkerConfig({})).toThrow(
      'missing required configuration: DATABASE_URL',
    );
  });

  it('rejects a non-integer OUTBOX_POLL_INTERVAL_MS', () => {
    expect(() =>
      loadPlatformWorkerConfig({ DATABASE_URL, OUTBOX_POLL_INTERVAL_MS: 'fast' }),
    ).toThrow('OUTBOX_POLL_INTERVAL_MS must be a positive integer');
  });

  it('rejects an OUTBOX_BATCH_LIMIT above the repository maximum', () => {
    expect(() => loadPlatformWorkerConfig({ DATABASE_URL, OUTBOX_BATCH_LIMIT: '101' })).toThrow(
      'OUTBOX_BATCH_LIMIT must not exceed',
    );
  });

  it('freezes the returned config', () => {
    const config = loadPlatformWorkerConfig({ DATABASE_URL });
    expect(Object.isFrozen(config)).toBe(true);
  });
});
