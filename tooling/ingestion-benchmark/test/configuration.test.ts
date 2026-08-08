import { describe, expect, it } from 'vitest';
import {
  assertIsTestDatabase,
  loadBenchmarkConfig,
  redactedConfigSummary,
} from '../src/configuration.js';
import { PROFILES, resolveProfile, isBenchmarkProfile } from '../src/profiles.js';

describe('configuration', () => {
  it('refuses a non-test database', () => {
    expect(() => {
      assertIsTestDatabase('postgresql://localhost/postgres');
    }).toThrow(/refusing to connect/);
  });

  it('accepts the dedicated test database', () => {
    expect(() => {
      assertIsTestDatabase('postgresql://localhost/aurora_inbox_test');
    }).not.toThrow();
  });

  it('loads a frozen config from the environment', () => {
    const config = loadBenchmarkConfig({
      AURORA_TEST_DATABASE_URL: 'postgresql://u:p@localhost:5432/aurora_inbox_test',
      BENCHMARK_PROFILE: 'smoke',
    });
    expect(config.profile).toBe('smoke');
    expect(Object.isFrozen(config)).toBe(true);
    expect(config.maxRunDurationMs).toBe(PROFILES.smoke.maxRunDurationMs);
  });

  it('throws when the database URL is missing', () => {
    expect(() => loadBenchmarkConfig({})).toThrow(/AURORA_TEST_DATABASE_URL/);
  });

  it('throws on an unknown profile', () => {
    expect(() =>
      loadBenchmarkConfig({
        AURORA_TEST_DATABASE_URL: 'postgresql://localhost/aurora_inbox_test',
        BENCHMARK_PROFILE: 'nope',
      }),
    ).toThrow(/unknown benchmark profile/);
  });

  it('redacts the config summary so no credentials appear', () => {
    const config = loadBenchmarkConfig({
      AURORA_TEST_DATABASE_URL: 'postgresql://user:secretpass@localhost:5432/aurora_inbox_test',
      BENCHMARK_PROFILE: 'smoke',
    });
    const summary = redactedConfigSummary(config);
    expect(summary).not.toContain('secretpass');
    expect(summary).not.toContain('user:');
  });
});

describe('profiles', () => {
  it('defines the smoke profile with fixed values', () => {
    const smoke = PROFILES.smoke;
    expect(smoke.scenarios).toHaveLength(1);
    const scenario = smoke.scenarios[0] as {
      warmupEvents: number;
      measuredEvents: number;
      batchSize: number;
      httpConcurrency: number;
      workerConcurrency: number;
      claimBatchSize: number;
      maxRunDurationMs: number;
    };
    expect(scenario.warmupEvents).toBe(100);
    expect(scenario.measuredEvents).toBe(500);
    expect(scenario.batchSize).toBe(10);
    expect(scenario.httpConcurrency).toBe(2);
    expect(scenario.workerConcurrency).toBe(2);
    expect(scenario.claimBatchSize).toBe(10);
    expect(scenario.maxRunDurationMs).toBe(120000);
  });

  it('defines the local-baseline profile with three scenarios', () => {
    const baseline = PROFILES['local-baseline'];
    expect(baseline.scenarios).toHaveLength(3);
    const a = baseline.scenarios[0];
    const b = baseline.scenarios[1];
    const c = baseline.scenarios[2];
    expect(a?.name).toContain('A');
    expect(b?.batchSize).toBe(10);
    expect(c?.batchSize).toBe(50);
  });

  it('resolves profiles by name and rejects unknown ones', () => {
    expect(resolveProfile('smoke').name).toBe('smoke');
    expect(isBenchmarkProfile('smoke')).toBe(true);
    expect(isBenchmarkProfile('local-baseline')).toBe(true);
    expect(isBenchmarkProfile('nope')).toBe(false);
    expect(() => resolveProfile('nope')).toThrow(/unknown benchmark profile/);
  });
});
