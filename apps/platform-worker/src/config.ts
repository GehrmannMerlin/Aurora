import { MAX_CLAIM_LIMIT } from '@aurora/platform-identity';

/**
 * Typed, validated platform-worker configuration. Environment strings are read
 * once and frozen here; business modules must never read process.env directly
 * (mirrors apps/ingestion-worker configuration.ts).
 */
export interface PlatformWorkerConfig {
  readonly databaseUrl: string;
  /** Explicit provider mode. `console` is restricted to local/Preview delivery. */
  readonly emailDeliveryMode: 'console' | 'aliyun';
  readonly aliyunDirectMailAccountName: string | null;
  readonly aliyunDirectMailFromAlias: string;
  readonly aliyunDirectMailRegionId: string;
  readonly aliyunDirectMailEndpoint: string | null;
  readonly emailProviderTimeoutMs: number;
  readonly emailOutboxProcessingTimeoutMs: number;
  readonly emailOutboxRetryBaseDelayMs: number;
  readonly emailOutboxRetryMaxDelayMs: number;
  /** Poll interval in milliseconds between outbox claim passes. */
  readonly outboxPollIntervalMs: number;
  /** Maximum outbox rows claimed per pass (1..MAX_CLAIM_LIMIT). */
  readonly outboxBatchLimit: number;
  /** Delivery attempt budget before a row is dead-lettered. */
  readonly outboxMaxAttempts: number;
  /** SEC-02 cleanup attempt budget before a handoff is dead-lettered. */
  readonly cleanupMaxAttempts: number;
  /** DAT-19 alert evaluation: enable the per-poll evaluation round. */
  readonly alertsEnabled: boolean;
  /** DAT-19 alert evaluation: maximum rules evaluated per round. */
  readonly alertMaxRules: number;
  /** DAT-18 Source Map reparse: enable the per-poll reparse round. */
  readonly sourceMapsReparseEnabled: boolean;
  /** DAT-18 Source Map reparse: max occurrences re-symbolized per task. */
  readonly sourceMapsReparseMaxOccurrences: number;
  /** DAT-18 Source Map reparse: max tasks claimed per round. */
  readonly sourceMapsReparseMaxTasks: number;
  /** Graceful shutdown timeout in milliseconds (operational knob). */
  readonly gracefulShutdownTimeoutMs: number;
}

function requiredString(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (value === undefined || value === '') {
    throw new Error(`missing required configuration: ${key}`);
  }
  return value;
}

function optionalPositiveInt(env: NodeJS.ProcessEnv, key: string, defaultValue: number): number {
  const value = env[key];
  if (value === undefined || value === '') return defaultValue;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`invalid configuration: ${key} must be a positive integer`);
  }
  return parsed;
}

function optionalTrimmedString(env: NodeJS.ProcessEnv, key: string, defaultValue: string): string {
  const raw = env[key];
  if (raw === undefined) return defaultValue;
  const value = raw.trim();
  if (value === '') {
    throw new Error(`invalid configuration: ${key} must be non-empty when provided`);
  }
  return value;
}

function deliveryMode(env: NodeJS.ProcessEnv): 'console' | 'aliyun' {
  const mode = (env.EMAIL_DELIVERY_MODE ?? 'console').trim().toLowerCase();
  if (mode !== 'console' && mode !== 'aliyun') {
    throw new Error('invalid configuration: EMAIL_DELIVERY_MODE must be one of: console, aliyun');
  }
  return mode;
}

function directMailAccountName(env: NodeJS.ProcessEnv, mode: 'console' | 'aliyun'): string | null {
  const value = env.ALIYUN_DIRECT_MAIL_ACCOUNT_NAME?.trim() ?? '';
  if (mode === 'console' && value === '') return null;
  if (value.length > 320 || /[\r\n]/u.test(value) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value)) {
    throw new Error(
      'invalid configuration: ALIYUN_DIRECT_MAIL_ACCOUNT_NAME must be a valid sender address in aliyun mode',
    );
  }
  return value;
}

/**
 * Read untrusted environment strings once and freeze a validated typed config.
 */
export function loadPlatformWorkerConfig(env: NodeJS.ProcessEnv): PlatformWorkerConfig {
  const emailDeliveryMode = deliveryMode(env);
  const emailProviderTimeoutMs = optionalPositiveInt(env, 'EMAIL_PROVIDER_TIMEOUT_MS', 10_000);
  const emailOutboxProcessingTimeoutMs = optionalPositiveInt(
    env,
    'EMAIL_OUTBOX_PROCESSING_TIMEOUT_MS',
    300_000,
  );
  const emailOutboxRetryBaseDelayMs = optionalPositiveInt(
    env,
    'EMAIL_OUTBOX_RETRY_BASE_DELAY_MS',
    1_000,
  );
  const emailOutboxRetryMaxDelayMs = optionalPositiveInt(
    env,
    'EMAIL_OUTBOX_RETRY_MAX_DELAY_MS',
    300_000,
  );
  if (emailProviderTimeoutMs >= emailOutboxProcessingTimeoutMs) {
    throw new Error(
      'invalid configuration: EMAIL_PROVIDER_TIMEOUT_MS must be shorter than EMAIL_OUTBOX_PROCESSING_TIMEOUT_MS',
    );
  }
  if (emailOutboxRetryBaseDelayMs > emailOutboxRetryMaxDelayMs) {
    throw new Error(
      'invalid configuration: EMAIL_OUTBOX_RETRY_BASE_DELAY_MS must not exceed EMAIL_OUTBOX_RETRY_MAX_DELAY_MS',
    );
  }
  if (emailOutboxRetryMaxDelayMs > 300_000) {
    throw new Error(
      'invalid configuration: EMAIL_OUTBOX_RETRY_MAX_DELAY_MS must not exceed 300000',
    );
  }
  const outboxBatchLimit = optionalPositiveInt(env, 'OUTBOX_BATCH_LIMIT', 20);
  if (outboxBatchLimit > MAX_CLAIM_LIMIT) {
    throw new Error(
      `invalid configuration: OUTBOX_BATCH_LIMIT must not exceed ${String(MAX_CLAIM_LIMIT)}`,
    );
  }
  const config: PlatformWorkerConfig = {
    databaseUrl: requiredString(env, 'DATABASE_URL'),
    emailDeliveryMode,
    aliyunDirectMailAccountName: directMailAccountName(env, emailDeliveryMode),
    aliyunDirectMailFromAlias: optionalTrimmedString(
      env,
      'ALIYUN_DIRECT_MAIL_FROM_ALIAS',
      'Aurora',
    ),
    aliyunDirectMailRegionId: optionalTrimmedString(
      env,
      'ALIYUN_DIRECT_MAIL_REGION_ID',
      'cn-hangzhou',
    ),
    aliyunDirectMailEndpoint:
      env.ALIYUN_DIRECT_MAIL_ENDPOINT === undefined
        ? null
        : optionalTrimmedString(env, 'ALIYUN_DIRECT_MAIL_ENDPOINT', ''),
    emailProviderTimeoutMs,
    emailOutboxProcessingTimeoutMs,
    emailOutboxRetryBaseDelayMs,
    emailOutboxRetryMaxDelayMs,
    outboxPollIntervalMs: optionalPositiveInt(env, 'OUTBOX_POLL_INTERVAL_MS', 2000),
    outboxBatchLimit,
    outboxMaxAttempts: optionalPositiveInt(env, 'OUTBOX_MAX_ATTEMPTS', 5),
    cleanupMaxAttempts: optionalPositiveInt(env, 'CLEANUP_MAX_ATTEMPTS', 5),
    alertsEnabled: (env.ALERTS_EVALUATION_ENABLED ?? 'true').trim().toLowerCase() !== 'false',
    alertMaxRules: optionalPositiveInt(env, 'ALERT_MAX_RULES', 100),
    sourceMapsReparseEnabled:
      (env.SOURCE_MAPS_REPARSE_ENABLED ?? 'true').trim().toLowerCase() !== 'false',
    sourceMapsReparseMaxOccurrences: optionalPositiveInt(
      env,
      'SOURCE_MAPS_REPARSE_MAX_OCCURRENCES',
      500,
    ),
    sourceMapsReparseMaxTasks: optionalPositiveInt(env, 'SOURCE_MAPS_REPARSE_MAX_TASKS', 10),
    gracefulShutdownTimeoutMs: optionalPositiveInt(env, 'GRACEFUL_SHUTDOWN_TIMEOUT_MS', 5000),
  };
  return Object.freeze(config);
}
