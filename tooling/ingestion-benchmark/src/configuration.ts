import { PROFILES, isBenchmarkProfile, type BenchmarkProfile } from './profiles.js';

/** Frozen benchmark configuration, validated once before any work begins. */
export interface BenchmarkConfig {
  readonly profile: BenchmarkProfile;
  readonly databaseUrl: string;
  readonly outputDir: string;
  readonly maxRunDurationMs: number;
}

/**
 * Validate the target database before running. The database name must be the
 * dedicated Aurora test database (aurora_inbox_test); anything else is refused.
 */
export function assertIsTestDatabase(url: string): void {
  const parsed = new URL(url);
  if (!parsed.pathname.startsWith('/aurora_inbox_test')) {
    throw new Error(`refusing to connect to non-test database: ${parsed.pathname}`);
  }
}

/** Read untrusted environment once and freeze a validated typed config. */
export function loadBenchmarkConfig(env: NodeJS.ProcessEnv): BenchmarkConfig {
  const databaseUrl = env.AURORA_TEST_DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl === '') {
    throw new Error('AURORA_TEST_DATABASE_URL must be set to run the benchmark');
  }
  assertIsTestDatabase(databaseUrl);
  const profileName = env.BENCHMARK_PROFILE ?? 'smoke';
  if (!isBenchmarkProfile(profileName)) {
    throw new Error(`unknown benchmark profile: ${profileName}`);
  }
  const profile = PROFILES[profileName];
  const outputDir = env.BENCHMARK_OUTPUT_DIR ?? '.artifacts/benchmarks/ingestion';
  const config: BenchmarkConfig = Object.freeze({
    profile: profileName,
    databaseUrl,
    outputDir,
    maxRunDurationMs: profile.maxRunDurationMs,
  });
  return config;
}

/** A redacted one-line config summary. Never includes the connection string. */
export function redactedConfigSummary(config: BenchmarkConfig): string {
  const parsed = new URL(config.databaseUrl);
  return [
    `profile=${config.profile}`,
    `dbname=${parsed.pathname.replace(/^\//, '')}`,
    `host=${parsed.hostname}`,
    `outputDir=${config.outputDir}`,
  ].join(' ');
}
