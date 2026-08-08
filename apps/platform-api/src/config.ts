/**
 * Typed, validated platform-api configuration. Environment strings are read
 * once and frozen here; route/business modules must never read process.env
 * directly (mirrors apps/ingestion-api configuration.ts).
 */
export interface PlatformApiConfig {
  readonly host: string;
  readonly port: number;
  readonly databaseUrl: string;
  readonly redisUrl: string;
  /** Idle session lifetime in milliseconds (Redis key TTL). */
  readonly sessionIdleMs: number;
  /** Absolute session lifetime in milliseconds (checked on read). */
  readonly sessionAbsoluteMs: number;
  /** Whether the session cookie carries the `Secure` attribute. */
  readonly cookieSecure: boolean;
  /** `EMAIL_DELIVERY_MODE` for the local/Preview email adapter. */
  readonly emailDeliveryMode: string;
  /** Explicitly allowed browser Origin values (CSRF Origin check). */
  readonly appOrigins: readonly string[];
  /** Rate-limit window in milliseconds for the public auth commands (in-memory stub). */
  readonly rateLimitWindowMs: number;
  /** Maximum requests per rate-limit window per (operation, IP, email) key. */
  readonly rateLimitMax: number;
  readonly gracefulShutdownTimeoutMs: number;
  readonly logEnabled: boolean;
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

function optionalNonNegativeInt(env: NodeJS.ProcessEnv, key: string, defaultValue: number): number {
  const value = env[key];
  if (value === undefined || value === '') return defaultValue;
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

function optionalOriginList(env: NodeJS.ProcessEnv, key: string): readonly string[] {
  const value = env[key];
  if (value === undefined || value === '') return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/**
 * Read untrusted environment strings once and freeze a validated typed config.
 */
export function loadPlatformApiConfig(env: NodeJS.ProcessEnv): PlatformApiConfig {
  const config: PlatformApiConfig = {
    host: env.HOST ?? '127.0.0.1',
    port: optionalNonNegativeInt(env, 'PORT', 8787),
    databaseUrl: requiredString(env, 'DATABASE_URL'),
    redisUrl: requiredString(env, 'REDIS_URL'),
    sessionIdleMs: optionalPositiveInt(env, 'SESSION_IDLE_MS', 30 * 60 * 1000),
    sessionAbsoluteMs: optionalPositiveInt(env, 'SESSION_ABSOLUTE_MS', 8 * 60 * 60 * 1000),
    cookieSecure: optionalBoolean(env, 'COOKIE_SECURE', false),
    emailDeliveryMode: env.EMAIL_DELIVERY_MODE ?? 'console',
    appOrigins: optionalOriginList(env, 'APP_ORIGIN'),
    rateLimitWindowMs: optionalPositiveInt(env, 'RATE_LIMIT_WINDOW_MS', 60_000),
    rateLimitMax: optionalPositiveInt(env, 'RATE_LIMIT_MAX', 10),
    gracefulShutdownTimeoutMs: optionalPositiveInt(env, 'GRACEFUL_SHUTDOWN_TIMEOUT_MS', 5000),
    logEnabled: optionalBoolean(env, 'LOG_ENABLED', false),
  };
  return Object.freeze(config);
}
