import { MAX_CLAIM_LIMIT } from '@aurora/platform-identity';

/**
 * Typed, validated platform-worker configuration. Environment strings are read
 * once and frozen here; business modules must never read process.env directly
 * (mirrors apps/ingestion-worker configuration.ts).
 */
export interface PlatformWorkerConfig {
  readonly databaseUrl: string;
  /** `EMAIL_DELIVERY_MODE` for the local/Preview email adapter ('console'). */
  readonly emailDeliveryMode: string;
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

/**
 * Read untrusted environment strings once and freeze a validated typed config.
 */
export function loadPlatformWorkerConfig(env: NodeJS.ProcessEnv): PlatformWorkerConfig {
  const outboxBatchLimit = optionalPositiveInt(env, 'OUTBOX_BATCH_LIMIT', 20);
  if (outboxBatchLimit > MAX_CLAIM_LIMIT) {
    throw new Error(
      `invalid configuration: OUTBOX_BATCH_LIMIT must not exceed ${String(MAX_CLAIM_LIMIT)}`,
    );
  }
  const config: PlatformWorkerConfig = {
    databaseUrl: requiredString(env, 'DATABASE_URL'),
    emailDeliveryMode: (env.EMAIL_DELIVERY_MODE ?? 'console').trim().toLowerCase() || 'console',
    outboxPollIntervalMs: optionalPositiveInt(env, 'OUTBOX_POLL_INTERVAL_MS', 2000),
    outboxBatchLimit,
    outboxMaxAttempts: optionalPositiveInt(env, 'OUTBOX_MAX_ATTEMPTS', 5),
    cleanupMaxAttempts: optionalPositiveInt(env, 'CLEANUP_MAX_ATTEMPTS', 5),
    alertsEnabled: (env.ALERTS_EVALUATION_ENABLED ?? 'true').trim().toLowerCase() !== 'false',
    alertMaxRules: optionalPositiveInt(env, 'ALERT_MAX_RULES', 100),
    gracefulShutdownTimeoutMs: optionalPositiveInt(env, 'GRACEFUL_SHUTDOWN_TIMEOUT_MS', 5000),
  };
  return Object.freeze(config);
}
