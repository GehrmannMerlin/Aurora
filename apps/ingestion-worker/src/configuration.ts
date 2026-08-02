import { MAX_CLAIM_LIMIT } from '@aurora/ingestion-inbox';

/** Frozen worker configuration, validated once at startup. */
export interface IngestionWorkerConfig {
  readonly workerId: string;
  readonly claimBatchSize: number;
  readonly maxConcurrentHandlers: number;
  readonly leaseDurationMs: number;
  readonly leaseRenewIntervalMs: number;
  readonly idlePollIntervalMs: number;
  readonly infrastructureFailureDelayMs: number;
  readonly shutdownGracePeriodMs: number;
  readonly maxProcessingAttempts: number;
  readonly databaseUrl: string;
  readonly logEnabled: boolean;
}

function requiredString(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (value === undefined || value === '') {
    throw new Error(`missing required configuration: ${key}`);
  }
  return value;
}

function requiredPositiveInt(env: NodeJS.ProcessEnv, key: string): number {
  const value = requiredString(env, key);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`invalid configuration: ${key} must be a positive integer`);
  }
  return parsed;
}

function optionalBoolean(env: NodeJS.ProcessEnv, key: string, defaultValue: boolean): boolean {
  const value = env[key];
  if (value === undefined || value === '') return defaultValue;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`invalid configuration: ${key} must be true or false`);
}

/**
 * Read untrusted environment strings once and freeze a validated typed config.
 * All values are explicitly configured; none are product promises.
 */
export function loadIngestionWorkerConfig(env: NodeJS.ProcessEnv): IngestionWorkerConfig {
  const claimBatchSize = requiredPositiveInt(env, 'CLAIM_BATCH_SIZE');
  const maxConcurrentHandlers = requiredPositiveInt(env, 'MAX_CONCURRENT_HANDLERS');
  const leaseDurationMs = requiredPositiveInt(env, 'LEASE_DURATION_MS');
  const leaseRenewIntervalMs = requiredPositiveInt(env, 'LEASE_RENEW_INTERVAL_MS');

  if (claimBatchSize > MAX_CLAIM_LIMIT) {
    throw new Error(
      `invalid configuration: CLAIM_BATCH_SIZE must not exceed ${String(MAX_CLAIM_LIMIT)}`,
    );
  }
  if (maxConcurrentHandlers > claimBatchSize) {
    throw new Error(
      'invalid configuration: MAX_CONCURRENT_HANDLERS must not exceed CLAIM_BATCH_SIZE',
    );
  }
  if (leaseRenewIntervalMs >= leaseDurationMs) {
    throw new Error(
      'invalid configuration: LEASE_RENEW_INTERVAL_MS must be less than LEASE_DURATION_MS',
    );
  }

  const config: IngestionWorkerConfig = {
    workerId: requiredString(env, 'WORKER_ID'),
    claimBatchSize,
    maxConcurrentHandlers,
    leaseDurationMs,
    leaseRenewIntervalMs,
    idlePollIntervalMs: requiredPositiveInt(env, 'IDLE_POLL_INTERVAL_MS'),
    infrastructureFailureDelayMs: requiredPositiveInt(env, 'INFRASTRUCTURE_FAILURE_DELAY_MS'),
    shutdownGracePeriodMs: requiredPositiveInt(env, 'SHUTDOWN_GRACE_PERIOD_MS'),
    maxProcessingAttempts: requiredPositiveInt(env, 'MAX_PROCESSING_ATTEMPTS'),
    databaseUrl: requiredString(env, 'DATABASE_URL'),
    logEnabled: optionalBoolean(env, 'LOG_ENABLED', false),
  };
  return Object.freeze(config);
}
