export interface IngestionApiConfig {
  readonly host: string;
  readonly port: number;
  readonly requestBodyLimitBytes: number;
  readonly gracefulShutdownTimeoutMs: number;
  readonly databaseUrl: string;
  readonly logEnabled: boolean;
  readonly logLevel: string;
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

function requiredNonNegativeInt(env: NodeJS.ProcessEnv, key: string): number {
  const value = requiredString(env, key);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`invalid configuration: ${key} must be a non-negative integer`);
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
 * Route and business modules must never read process.env directly.
 */
export function loadIngestionApiConfig(env: NodeJS.ProcessEnv): IngestionApiConfig {
  const config: IngestionApiConfig = {
    host: requiredString(env, 'HOST'),
    port: requiredNonNegativeInt(env, 'PORT'),
    requestBodyLimitBytes: requiredPositiveInt(env, 'REQUEST_BODY_LIMIT_BYTES'),
    gracefulShutdownTimeoutMs: requiredPositiveInt(env, 'GRACEFUL_SHUTDOWN_TIMEOUT_MS'),
    databaseUrl: requiredString(env, 'DATABASE_URL'),
    logEnabled: optionalBoolean(env, 'LOG_ENABLED', false),
    logLevel: env.LOG_LEVEL ?? 'info',
  };
  return Object.freeze(config);
}
