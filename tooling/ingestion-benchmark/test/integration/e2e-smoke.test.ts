import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runBenchmark } from '../../src/harness.js';
import { loadBenchmarkConfig } from '../../src/configuration.js';
import { resolveProfile } from '../../src/profiles.js';
import { assertIsTestDatabase, testDatabaseUrl } from './helpers.js';

const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const describeDb = hasDb ? describe : describe.skip;

describeDb('benchmark harness end-to-end smoke (real PostgreSQL 17)', () => {
  beforeAll(() => {
    assertIsTestDatabase(testDatabaseUrl());
  });

  afterAll(async () => {
    // The harness owns and cleans up every resource it creates.
  });

  it('runs the smoke profile end to end with all correctness gates passing', async () => {
    const config = loadBenchmarkConfig({
      AURORA_TEST_DATABASE_URL: testDatabaseUrl(),
      BENCHMARK_PROFILE: 'smoke',
      BENCHMARK_OUTPUT_DIR: '.artifacts/benchmarks/ingestion',
    });
    const profile = resolveProfile(config.profile);
    const result = await runBenchmark(config, profile);

    expect(result.success).toBe(true);
    expect(result.report.schemaVersion).toBe(1);
    expect(result.report.run.profile).toBe('smoke');
    expect(result.report.scenarios).toHaveLength(1);
    expect(result.report.correctness.passed).toBe(true);
    // Every scenario's correctness checks must pass.
    for (const scenario of result.report.scenarios) {
      expect(Object.values(scenario.correctness).every((v) => v === true)).toBe(true);
    }
    expect(result.evidence).toContain('# Aurora 数据接入本地基准证据');
    expect(result.evidence).not.toContain('aurora_ingest_');
  });
});
