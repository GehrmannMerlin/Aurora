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
    expect(config.aliyunDirectMailAccountName).toBeNull();
    expect(config.aliyunDirectMailFromAlias).toBe('Aurora');
    expect(config.aliyunDirectMailRegionId).toBe('cn-hangzhou');
    expect(config.aliyunDirectMailEndpoint).toBeNull();
    expect(config.emailProviderTimeoutMs).toBe(10_000);
    expect(config.emailOutboxProcessingTimeoutMs).toBe(300_000);
    expect(config.emailOutboxRetryBaseDelayMs).toBe(1_000);
    expect(config.emailOutboxRetryMaxDelayMs).toBe(300_000);
    expect(config.gracefulShutdownTimeoutMs).toBe(5000);
    expect(config).not.toHaveProperty('accessKeyId');
    expect(config).not.toHaveProperty('accessKeySecret');
  });

  it('reads explicit environment values', () => {
    const config = loadPlatformWorkerConfig({
      DATABASE_URL,
      EMAIL_DELIVERY_MODE: 'console',
      OUTBOX_POLL_INTERVAL_MS: '1234',
      OUTBOX_BATCH_LIMIT: '7',
      OUTBOX_MAX_ATTEMPTS: '3',
      EMAIL_PROVIDER_TIMEOUT_MS: '8000',
      EMAIL_OUTBOX_PROCESSING_TIMEOUT_MS: '120000',
      EMAIL_OUTBOX_RETRY_BASE_DELAY_MS: '2500',
      EMAIL_OUTBOX_RETRY_MAX_DELAY_MS: '90000',
      GRACEFUL_SHUTDOWN_TIMEOUT_MS: '9999',
    });
    expect(config.emailDeliveryMode).toBe('console');
    expect(config.outboxPollIntervalMs).toBe(1234);
    expect(config.outboxBatchLimit).toBe(7);
    expect(config.outboxMaxAttempts).toBe(3);
    expect(config.emailProviderTimeoutMs).toBe(8000);
    expect(config.emailOutboxProcessingTimeoutMs).toBe(120000);
    expect(config.emailOutboxRetryBaseDelayMs).toBe(2500);
    expect(config.emailOutboxRetryMaxDelayMs).toBe(90000);
    expect(config.gracefulShutdownTimeoutMs).toBe(9999);
  });

  it('normalizes EMAIL_DELIVERY_MODE to lower case', () => {
    const config = loadPlatformWorkerConfig({ DATABASE_URL, EMAIL_DELIVERY_MODE: 'CONSOLE' });
    expect(config.emailDeliveryMode).toBe('console');
  });

  it('accepts Aliyun mode only with a valid DirectMail account and trims public settings', () => {
    const config = loadPlatformWorkerConfig({
      DATABASE_URL,
      EMAIL_DELIVERY_MODE: ' ALIYUN ',
      ALIYUN_DIRECT_MAIL_ACCOUNT_NAME: ' no-reply@example.invalid ',
      ALIYUN_DIRECT_MAIL_FROM_ALIAS: ' Aurora Security ',
      ALIYUN_DIRECT_MAIL_REGION_ID: ' cn-hangzhou ',
      ALIYUN_DIRECT_MAIL_ENDPOINT: ' dm.cn-hangzhou.aliyuncs.com ',
    });

    expect(config.emailDeliveryMode).toBe('aliyun');
    expect(config.aliyunDirectMailAccountName).toBe('no-reply@example.invalid');
    expect(config.aliyunDirectMailFromAlias).toBe('Aurora Security');
    expect(config.aliyunDirectMailRegionId).toBe('cn-hangzhou');
    expect(config.aliyunDirectMailEndpoint).toBe('dm.cn-hangzhou.aliyuncs.com');
  });

  it('rejects unsupported delivery modes', () => {
    expect(() => loadPlatformWorkerConfig({ DATABASE_URL, EMAIL_DELIVERY_MODE: 'smtp' })).toThrow(
      'EMAIL_DELIVERY_MODE must be one of: console, aliyun',
    );
  });

  it('requires a valid DirectMail account name in Aliyun mode', () => {
    expect(() => loadPlatformWorkerConfig({ DATABASE_URL, EMAIL_DELIVERY_MODE: 'aliyun' })).toThrow(
      'ALIYUN_DIRECT_MAIL_ACCOUNT_NAME',
    );
    expect(() =>
      loadPlatformWorkerConfig({
        DATABASE_URL,
        EMAIL_DELIVERY_MODE: 'aliyun',
        ALIYUN_DIRECT_MAIL_ACCOUNT_NAME: 'not-an-address',
      }),
    ).toThrow('ALIYUN_DIRECT_MAIL_ACCOUNT_NAME');
  });

  it('rejects a present but blank DirectMail endpoint', () => {
    expect(() =>
      loadPlatformWorkerConfig({
        DATABASE_URL,
        EMAIL_DELIVERY_MODE: 'aliyun',
        ALIYUN_DIRECT_MAIL_ACCOUNT_NAME: 'no-reply@example.invalid',
        ALIYUN_DIRECT_MAIL_ENDPOINT: '   ',
      }),
    ).toThrow('ALIYUN_DIRECT_MAIL_ENDPOINT must be non-empty when provided');
  });

  it('rejects unsafe provider, processing lease, and retry timeout relationships', () => {
    expect(() =>
      loadPlatformWorkerConfig({
        DATABASE_URL,
        EMAIL_PROVIDER_TIMEOUT_MS: '10000',
        EMAIL_OUTBOX_PROCESSING_TIMEOUT_MS: '10000',
      }),
    ).toThrow('EMAIL_PROVIDER_TIMEOUT_MS must be shorter than EMAIL_OUTBOX_PROCESSING_TIMEOUT_MS');

    expect(() =>
      loadPlatformWorkerConfig({
        DATABASE_URL,
        EMAIL_OUTBOX_RETRY_BASE_DELAY_MS: '5000',
        EMAIL_OUTBOX_RETRY_MAX_DELAY_MS: '1000',
      }),
    ).toThrow('EMAIL_OUTBOX_RETRY_BASE_DELAY_MS must not exceed EMAIL_OUTBOX_RETRY_MAX_DELAY_MS');

    expect(() =>
      loadPlatformWorkerConfig({ DATABASE_URL, EMAIL_OUTBOX_RETRY_MAX_DELAY_MS: '300001' }),
    ).toThrow('EMAIL_OUTBOX_RETRY_MAX_DELAY_MS must not exceed 300000');
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
