import type { BenchmarkScenarioConfig } from './types.js';

export type BenchmarkProfile = 'smoke' | 'local-baseline';

export interface ProfileDefinition {
  readonly name: BenchmarkProfile;
  readonly description: string;
  readonly maxRunDurationMs: number;
  readonly scenarios: readonly BenchmarkScenarioConfig[];
}

function scenario(
  config: Omit<
    BenchmarkScenarioConfig,
    'processorDelayMs' | 'maxRunDurationMs' | 'apiPoolMax' | 'workerPoolMax'
  > & {
    readonly processorDelayMs?: number;
    readonly maxRunDurationMs?: number;
    readonly apiPoolMax?: number;
    readonly workerPoolMax?: number;
  },
): BenchmarkScenarioConfig {
  return {
    processorDelayMs: 0,
    maxRunDurationMs: 300000,
    apiPoolMax: config.httpConcurrency * 2,
    workerPoolMax: config.workerConcurrency * 2,
    ...config,
  };
}

export const SMOKE_PROFILE: ProfileDefinition = Object.freeze({
  name: 'smoke',
  description: 'Tool correctness and fast local verification; not a performance conclusion',
  maxRunDurationMs: 120000,
  scenarios: Object.freeze([
    scenario({
      name: 'smoke',
      warmupEvents: 100,
      measuredEvents: 500,
      batchSize: 10,
      httpConcurrency: 2,
      workerConcurrency: 2,
      claimBatchSize: 10,
      apiPoolMax: 4,
      workerPoolMax: 4,
      maxRunDurationMs: 120000,
    }),
  ]),
});

export const LOCAL_BASELINE_PROFILE: ProfileDefinition = Object.freeze({
  name: 'local-baseline',
  description: 'First local machine baseline; not a production gate',
  maxRunDurationMs: 300000,
  scenarios: Object.freeze([
    scenario({
      name: 'A-low-concurrency-single-event',
      warmupEvents: 200,
      measuredEvents: 2000,
      batchSize: 1,
      httpConcurrency: 1,
      workerConcurrency: 2,
      claimBatchSize: 10,
      apiPoolMax: 4,
      workerPoolMax: 4,
    }),
    scenario({
      name: 'B-regular-batch',
      warmupEvents: 500,
      measuredEvents: 5000,
      batchSize: 10,
      httpConcurrency: 4,
      workerConcurrency: 4,
      claimBatchSize: 20,
      apiPoolMax: 8,
      workerPoolMax: 8,
    }),
    scenario({
      name: 'C-max-approved-batch',
      warmupEvents: 500,
      measuredEvents: 5000,
      batchSize: 50,
      httpConcurrency: 8,
      workerConcurrency: 8,
      claimBatchSize: 50,
      apiPoolMax: 16,
      workerPoolMax: 16,
    }),
  ]),
});

export const PROFILES: Readonly<Record<BenchmarkProfile, ProfileDefinition>> = Object.freeze({
  smoke: SMOKE_PROFILE,
  'local-baseline': LOCAL_BASELINE_PROFILE,
});

export function isBenchmarkProfile(value: unknown): value is BenchmarkProfile {
  return value === 'smoke' || value === 'local-baseline';
}

export function resolveProfile(name: string): ProfileDefinition {
  if (!isBenchmarkProfile(name)) {
    throw new Error(`unknown benchmark profile: ${name}`);
  }
  return PROFILES[name];
}
