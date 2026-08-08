/** A bounded, versioned benchmark report. */
export interface IngestionBenchmarkReport {
  readonly schemaVersion: 1;
  readonly run: BenchmarkRunMetadata;
  readonly environment: BenchmarkEnvironmentMetadata;
  readonly scenarios: readonly BenchmarkScenarioReport[];
  readonly correctness: BenchmarkCorrectnessSummary;
}

export interface BenchmarkRunMetadata {
  readonly runId: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly profile: string;
  readonly success: boolean;
  readonly gitCommit: string | null;
  readonly gitDirty: boolean;
}

export interface BenchmarkEnvironmentMetadata {
  readonly nodeVersion: string;
  readonly pnpmVersion: string;
  readonly platform: string;
  readonly arch: string;
  readonly cpuModel: string;
  readonly logicalCores: number;
  readonly totalMemoryBytes: number;
  readonly postgresServerVersionNum: number;
  readonly pgClientVersion: string;
  readonly apiPoolMax: number;
  readonly workerPoolMax: number;
}

export interface BenchmarkScenarioConfig {
  readonly name: string;
  readonly warmupEvents: number;
  readonly measuredEvents: number;
  readonly batchSize: number;
  readonly httpConcurrency: number;
  readonly workerConcurrency: number;
  readonly claimBatchSize: number;
  readonly processorDelayMs: number;
  readonly maxRunDurationMs: number;
  readonly apiPoolMax: number;
  readonly workerPoolMax: number;
}

export interface PercentileSummary {
  readonly count: number;
  readonly min: number;
  readonly max: number;
  readonly mean: number;
  readonly p50: number;
  readonly p90: number;
  readonly p95: number;
  readonly p99: number;
}

export interface ThroughputSummary {
  readonly requestsPerSecond: number;
  readonly eventsPerSecond: number;
}

export interface WorkerDiagnosticCounts {
  readonly claim: number;
  readonly renew: number;
  readonly leaseLost: number;
  readonly retryBudgetExhausted: number;
  readonly processed: number;
  readonly retryScheduled: number;
  readonly deadLettered: number;
}

export type MutableWorkerDiagnosticCounts = {
  -readonly [K in keyof WorkerDiagnosticCounts]: WorkerDiagnosticCounts[K];
};

export interface PoolStats {
  readonly totalCount: number;
  readonly idleCount: number;
  readonly waitingCount: number;
}

export interface CorrectnessChecks {
  readonly requestsMatchExpected: boolean;
  readonly eventsMatchExpected: boolean;
  readonly allResponsesHaveRequestId: boolean;
  readonly noUnexpected4xx5xx: boolean;
  readonly acceptedPlusDuplicatePlusRejectedConserved: boolean;
  readonly inboxRowCountCorrect: boolean;
  readonly processedCountCorrect: boolean;
  readonly noUnexpectedDeadLettered: boolean;
  readonly noResidualLeased: boolean;
  readonly noResidualRetryWaiting: boolean;
  readonly noLeaseLost: boolean;
  readonly workerInFlightZero: boolean;
  readonly poolsClosed: boolean;
  readonly schemaRemoved: boolean;
}

export interface CorrectnessSummary {
  readonly passed: boolean;
  readonly checks: readonly { readonly name: string; readonly passed: boolean }[];
}

export type BenchmarkCorrectnessSummary = CorrectnessSummary;

export interface BenchmarkScenarioReport {
  readonly config: BenchmarkScenarioConfig;
  readonly requests: number;
  readonly events: number;
  readonly accepted: number;
  readonly duplicate: number;
  readonly rejected: number;
  readonly throughput: ThroughputSummary;
  readonly httpLatencyMs: PercentileSummary;
  readonly processingLatencyMs: PercentileSummary;
  readonly drainDurationMs: number;
  readonly poolPeak: PoolStats;
  readonly workerDiagnostics: WorkerDiagnosticCounts;
  readonly correctness: CorrectnessChecks;
}
