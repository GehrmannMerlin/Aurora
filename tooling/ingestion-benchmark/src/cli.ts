import { Pool } from 'pg';
import {
  loadBenchmarkConfig,
  redactedConfigSummary,
  assertIsTestDatabase,
} from './configuration.js';
import { resolveProfile } from './profiles.js';
import { runBenchmark } from './harness.js';

/**
 * Verify the environment gates before any benchmark work starts.
 * Returns an exit code (2) or null when all gates pass.
 */
async function checkEnvironmentGate(env: NodeJS.ProcessEnv): Promise<number | null> {
  const databaseUrl = env.AURORA_TEST_DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl === '') {
    process.stderr.write('AURORA_TEST_DATABASE_URL must be set to run the benchmark\n');
    return 2;
  }
  try {
    assertIsTestDatabase(databaseUrl);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
  // PostgreSQL 17 gate: the server must be 17.x.
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const result = await pool.query<{ server_version_num: string }>('SHOW server_version_num');
    const versionNum = Number(result.rows[0]?.server_version_num ?? '0');
    if (!Number.isSafeInteger(versionNum) || versionNum < 170000 || versionNum >= 180000) {
      process.stderr.write(
        `PostgreSQL 17 required; found server_version_num=${String(versionNum)}\n`,
      );
      return 2;
    }
  } finally {
    await pool.end().catch(() => undefined);
  }
  return null;
}

/**
 * Entry point for the benchmark CLI.
 *
 * Exit codes:
 *   0 = completed and correctness passed
 *   1 = configuration or correctness failure
 *   2 = environment gate failure (no test DB URL / not PostgreSQL 17 / not a test DB)
 */
export async function runBenchmarkCli(
  env: NodeJS.ProcessEnv,
  argv: readonly string[] = [],
): Promise<number> {
  // Profile comes from --profile <name> (cross-platform), else the environment.
  const profileFlagIndex = argv.indexOf('--profile');
  let profileName = env.BENCHMARK_PROFILE ?? 'smoke';
  if (profileFlagIndex !== -1) {
    const value = argv[profileFlagIndex + 1];
    if (value === undefined) {
      process.stderr.write('--profile requires a value\n');
      return 1;
    }
    profileName = value;
  }

  const gate = await checkEnvironmentGate(env);
  if (gate !== null) return gate;

  let config;
  try {
    config = loadBenchmarkConfig({ ...env, BENCHMARK_PROFILE: profileName });
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }

  process.stdout.write(`${redactedConfigSummary(config)}\n`);
  try {
    const profile = resolveProfile(config.profile);
    const result = await runBenchmark(config, profile);
    process.stdout.write(`benchmark ${config.profile} complete: ${result.jsonPath}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(
      `benchmark failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
}
