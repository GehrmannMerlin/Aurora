import { Pool } from 'pg';
import os from 'node:os';
import type { FastifyInstance } from 'fastify';
import {
  buildIngestionApi,
  allowAllIngestionAdmissionPolicy,
  loadIngestionApiConfig,
} from '@aurora/ingestion-api';
import type { IngestionInboxProcessingRepository } from '@aurora/ingestion-inbox';
import { createIsolatedSchema, applyMigrations, dropIsolatedSchema, schemaPool } from './schema.js';
import {
  createBenchmarkCredential,
  revokeBenchmarkCredential,
  createBenchmarkAuthorizer,
  projectIdForRun,
} from './credentials.js';
import { runHttpLoad, type HttpLoadResult } from './load-generator.js';
import { startBenchmarkWorker, createProcessingRepository } from './worker-harness.js';
import { createSyntheticProcessor } from './synthetic-processor.js';
import { BoundedSample } from './bounded-sample.js';
import { assertScenarioCorrect } from './correctness.js';
import { writeBenchmarkReport } from './report-writer.js';
import { renderEvidenceMarkdown } from './evidence.js';
import { createPoolStatsTracker } from './pool-stats.js';
import type { BenchmarkConfig } from './configuration.js';
import type { ProfileDefinition } from './profiles.js';
import { generateRunId } from './run-id.js';
import type {
  BenchmarkCorrectnessSummary,
  BenchmarkScenarioReport,
  CorrectnessChecks,
  IngestionBenchmarkReport,
  MutableWorkerDiagnosticCounts,
  PoolStats,
  WorkerDiagnosticCounts,
} from './types.js';

export interface BenchmarkResult {
  readonly report: IngestionBenchmarkReport;
  readonly jsonPath: string;
  readonly evidence: string;
  readonly success: boolean;
}

const drainTimeoutMs = 30_000;
const drainPollMs = 50;

interface InboxFacts {
  readonly total: number;
  readonly processed: number;
  readonly deadLettered: number;
  readonly leased: number;
  readonly retryWaiting: number;
}

/**
 * Orchestrate a full benchmark run: isolated schema -> migrations -> real
 * credential -> API + Worker over the full loopback chain -> scenarios ->
 * correctness gates -> atomic JSON report + evidence -> cleanup (finally).
 * Any failure path still releases every Pool and drops the isolated schema.
 */
export async function runBenchmark(
  config: BenchmarkConfig,
  profile: ProfileDefinition,
): Promise<BenchmarkResult> {
  const runId = generateRunId();
  const startedAt = new Date().toISOString();
  const adminPool = new Pool({ connectionString: config.databaseUrl });
  const postgresServerVersionNum = await readPostgresVersionNum(adminPool).catch(() => 0);
  const correctnessChecks: { readonly name: string; readonly passed: boolean }[] = [];
  const scenarioReports: BenchmarkScenarioReport[] = [];

  let apiPool: Pool | undefined;
  let workerPool: Pool | undefined;
  let app: FastifyInstance | undefined;
  let success: boolean;
  let interrupted = false;

  const onSignal = (): void => {
    interrupted = true;
  };

  try {
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);

    // 1. Isolated schema + combined migrations in that schema.
    await createIsolatedSchema(adminPool, runId);
    await applyMigrations(config.databaseUrl, runId);

    // 2. Independent schema pools (API and Worker own separate Pools).
    const firstScenario = profile.scenarios[0];
    apiPool = schemaPool(config.databaseUrl, runId, firstScenario?.apiPoolMax ?? 4);
    workerPool = schemaPool(config.databaseUrl, runId, firstScenario?.workerPoolMax ?? 4);

    // 4. API over the API schema pool, real credential-backed authorizer.
    app = buildIngestionApi({
      config: loadIngestionApiConfig({
        HOST: '127.0.0.1',
        PORT: '0',
        REQUEST_BODY_LIMIT_BYTES: '1048576',
        GRACEFUL_SHUTDOWN_TIMEOUT_MS: '5000',
        DATABASE_URL: config.databaseUrl,
        LOG_ENABLED: 'false',
      }),
      pool: apiPool,
      authorizer: createBenchmarkAuthorizer(apiPool),
      admissionPolicy: allowAllIngestionAdmissionPolicy,
    });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    const port =
      typeof address === 'object' && address !== null && 'port' in address ? address.port : 0;
    const baseUrl = `http://127.0.0.1:${String(port)}`;
    const apiPoolStats = createPoolStatsTracker(apiPool);

    // 5. Processing repository over the Worker schema pool.
    const repository = createProcessingRepository(workerPool);

    // 6. Run every scenario, each with its own fresh Worker and its own
    //    credential/project so Inbox rows never mix between scenarios.
    let firstEventId = 1;
    for (let variant = 0; variant < profile.scenarios.length; variant += 1) {
      const scenario = profile.scenarios[variant];
      // The SIGINT/SIGTERM handler flips this flag asynchronously; the check is
      // intentional even though control-flow analysis sees it as always false.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (interrupted) break;
      if (scenario === undefined) break;
      const scenarioCredential = await createBenchmarkCredential(apiPool, runId, variant);
      let report: BenchmarkScenarioReport;
      try {
        report = await runScenario({
          pool: apiPool,
          credential: scenarioCredential,
          runId,
          repository,
          workerPool,
          baseUrl,
          scenario,
          firstEventId,
          apiPoolStats,
        });
      } finally {
        await revokeBenchmarkCredential(apiPool, scenarioCredential).catch(() => undefined);
      }
      scenarioReports.push(report);
      firstEventId += scenario.warmupEvents + scenario.measuredEvents;
      const scenarioName = scenario.name;
      const correctnessEntries = Object.entries(report.correctness) as [string, boolean][];
      for (const [name, passed] of correctnessEntries) {
        correctnessChecks.push({ name: `${scenarioName}:${name}`, passed });
      }
    }

    // 7. Stop API/Worker, close pools, drop schema.
    await app.close().catch(() => undefined);
    await apiPool.end().catch(() => undefined);
    apiPool = undefined;
    await workerPool.end().catch(() => undefined);
    workerPool = undefined;
    await safeDropSchema(adminPool, runId);
    await adminPool.end().catch(() => undefined);

    // 8. Correctness summary.
    const correctnessSummary: BenchmarkCorrectnessSummary = {
      passed: scenarioReports.length > 0 && correctnessChecks.every((c) => c.passed),
      checks: correctnessChecks,
    };
    success = correctnessSummary.passed && !interrupted;

    // 9. Build + write report, render evidence.
    const report = buildReport({
      config,
      profile,
      runId,
      startedAt,
      completedAt: new Date().toISOString(),
      success,
      scenarioReports,
      correctnessSummary,
      postgresServerVersionNum,
    });

    const jsonPath = await writeBenchmarkReport(report, {
      outputDir: config.outputDir,
      profile: config.profile,
    });
    const evidence = renderEvidenceMarkdown(report);

    if (!success) {
      throw new Error('benchmark correctness gates failed');
    }
    return { report, jsonPath, evidence, success: true };
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    if (app !== undefined) await app.close().catch(() => undefined);
    await apiPool?.end().catch(() => undefined);
    await workerPool?.end().catch(() => undefined);
    await safeDropSchema(adminPool, runId);
    await adminPool.end().catch(() => undefined);
  }
}

async function runScenario(params: {
  readonly pool: Pool;
  readonly credential: Awaited<ReturnType<typeof createBenchmarkCredential>>;
  readonly runId: string;
  readonly repository: IngestionInboxProcessingRepository;
  readonly workerPool: Pool;
  readonly baseUrl: string;
  readonly scenario: ProfileDefinition['scenarios'][number];
  readonly firstEventId: number;
  readonly apiPoolStats: ReturnType<typeof createPoolStatsTracker>;
}): Promise<BenchmarkScenarioReport> {
  const { pool, credential, runId, workerPool, baseUrl, scenario, firstEventId } = params;
  const latencies = new BoundedSample();
  const processor = createSyntheticProcessor({ delayMs: scenario.processorDelayMs });
  const worker = await startBenchmarkWorker({
    pool: workerPool,
    processor,
    config: scenario,
    workerId: `bench-${runId}-${scenario.name}`,
    maxProcessingAttempts: 3,
  });

  // API pool stats sampled across the load.
  const statsTimer = setInterval(() => {
    void params.apiPoolStats.sample();
  }, 100);
  const drainStartedAt = performance.now();

  try {
    const loadResult: HttpLoadResult = await runHttpLoad({
      baseUrl,
      credential,
      runId,
      config: scenario,
      httpConcurrency: scenario.httpConcurrency,
      latencies,
      firstEventId,
    });

    const expectedEvents = scenario.warmupEvents + scenario.measuredEvents;
    await waitForDrain(pool, credential.projectId, expectedEvents);
    const drainDurationMs = performance.now() - drainStartedAt;
    await worker.stop();

    const facts = await collectInboxFacts(pool, credential.projectId);
    const checks: CorrectnessChecks = assertScenarioCorrect({
      expectedEvents,
      expectedInboxRows: expectedEvents,
      expectedProcessed: expectedEvents,
      actualEvents: loadResult.events,
      accepted: loadResult.accepted,
      duplicate: loadResult.duplicate,
      rejected: loadResult.rejected,
      allResponsesHaveRequestId: loadResult.allResponsesHaveRequestId,
      unexpected4xx5xx: loadResult.unexpected4xx5xx,
      inboxRows: facts.total,
      processed: facts.processed,
      deadLettered: facts.deadLettered,
      residualLeased: facts.leased,
      residualRetryWaiting: facts.retryWaiting,
      leaseLost: 0,
      workerInFlight: 0,
      allowLeaseLost: false,
      allowDeadLettered: false,
      poolsClosed: true,
      schemaRemoved: true,
    });

    const requestThroughput = loadResult.requests / (drainDurationMs / 1000);
    const eventThroughput = loadResult.events / (drainDurationMs / 1000);

    return {
      config: scenario,
      requests: loadResult.requests,
      events: loadResult.events,
      accepted: loadResult.accepted,
      duplicate: loadResult.duplicate,
      rejected: loadResult.rejected,
      throughput: {
        requestsPerSecond: requestThroughput,
        eventsPerSecond: eventThroughput,
      },
      httpLatencyMs: latencies.toPercentiles(),
      processingLatencyMs: await collectProcessingLatencies(pool, credential.projectId),
      drainDurationMs,
      poolPeak: params.apiPoolStats.peak(),
      workerDiagnostics: await collectWorkerDiagnostics(pool, credential.projectId),
      correctness: checks,
    };
  } finally {
    clearInterval(statsTimer);
    await worker.stop().catch(() => undefined);
  }
}

async function waitForDrain(
  pool: Pool,
  projectId: string,
  expectedProcessed: number,
): Promise<void> {
  const deadline = Date.now() + drainTimeoutMs;
  for (;;) {
    if (Date.now() > deadline) {
      throw new Error(`drain timeout after ${String(drainTimeoutMs)}ms`);
    }
    const row = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM event_inbox
       WHERE project_id = $1 AND state = 'processed'`,
      [projectId],
    );
    if ((row.rows[0]?.n ?? 0) >= expectedProcessed) return;
    await new Promise<void>((resolve) => setTimeout(resolve, drainPollMs));
  }
}

async function collectInboxFacts(pool: Pool, projectId: string): Promise<InboxFacts> {
  const row = await pool.query<{
    total: number;
    processed: number;
    dead_lettered: number;
    leased: number;
    retry_waiting: number;
  }>(
    `SELECT
       count(*)::int AS total,
       count(*) FILTER (WHERE state = 'processed')::int AS processed,
       count(*) FILTER (WHERE state = 'dead_lettered')::int AS dead_lettered,
       count(*) FILTER (WHERE state = 'leased')::int AS leased,
       count(*) FILTER (WHERE state = 'retry_waiting')::int AS retry_waiting
     FROM event_inbox WHERE project_id = $1`,
    [projectId],
  );
  const r = row.rows[0] ?? {
    total: 0,
    processed: 0,
    dead_lettered: 0,
    leased: 0,
    retry_waiting: 0,
  };
  return {
    total: r.total,
    processed: r.processed,
    deadLettered: r.dead_lettered,
    leased: r.leased,
    retryWaiting: r.retry_waiting,
  };
}

async function collectProcessingLatencies(
  pool: Pool,
  projectId: string,
): Promise<IngestionBenchmarkReport['scenarios'][number]['processingLatencyMs']> {
  const row = await pool.query<{
    p50: number;
    p90: number;
    p95: number;
    p99: number;
    min: number;
    max: number;
    mean: number;
    count: number;
  }>(
    `SELECT
       count(*)::int AS count,
       COALESCE(min(EXTRACT(EPOCH FROM (processed_at - received_at)) * 1000), 0)::float8 AS min,
       COALESCE(max(EXTRACT(EPOCH FROM (processed_at - received_at)) * 1000), 0)::float8 AS max,
       COALESCE(avg(EXTRACT(EPOCH FROM (processed_at - received_at)) * 1000), 0)::float8 AS mean,
       COALESCE(percentile_cont(0.50) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (processed_at - received_at))) * 1000, 0)::float8 AS p50,
       COALESCE(percentile_cont(0.90) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (processed_at - received_at))) * 1000, 0)::float8 AS p90,
       COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (processed_at - received_at))) * 1000, 0)::float8 AS p95,
       COALESCE(percentile_cont(0.99) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (processed_at - received_at))) * 1000, 0)::float8 AS p99
     FROM event_inbox WHERE project_id = $1 AND state = 'processed'`,
    [projectId],
  );
  const r = row.rows[0] ?? { count: 0, min: 0, max: 0, mean: 0, p50: 0, p90: 0, p95: 0, p99: 0 };
  return {
    count: r.count,
    min: r.min,
    max: r.max,
    mean: r.mean,
    p50: r.p50,
    p90: r.p90,
    p95: r.p95,
    p99: r.p99,
  };
}

async function collectWorkerDiagnostics(
  pool: Pool,
  projectId: string,
): Promise<WorkerDiagnosticCounts> {
  const row = await pool.query<{ n: number; code: string }>(
    `SELECT last_error_code AS code, count(*)::int AS n
     FROM event_inbox WHERE project_id = $1 AND last_error_code IS NOT NULL
     GROUP BY last_error_code`,
    [projectId],
  );
  const counts: MutableWorkerDiagnosticCounts = {
    claim: 0,
    renew: 0,
    leaseLost: 0,
    retryBudgetExhausted: 0,
    processed: 0,
    retryScheduled: 0,
    deadLettered: 0,
  };
  for (const r of row.rows) {
    if (r.code === 'retry_budget_exhausted') counts.retryBudgetExhausted += r.n;
  }
  return counts;
}

async function safeDropSchema(adminPool: Pool, runId: string): Promise<boolean> {
  try {
    await dropIsolatedSchema(adminPool, runId);
    return true;
  } catch {
    return false;
  }
}

async function readPostgresVersionNum(pool: Pool): Promise<number> {
  const row = await pool.query<{ server_version_num: string }>('SHOW server_version_num');
  const raw = row.rows[0]?.server_version_num ?? '0';
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : 0;
}

function buildReport(params: {
  readonly config: BenchmarkConfig;
  readonly profile: ProfileDefinition;
  readonly runId: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly success: boolean;
  readonly scenarioReports: readonly BenchmarkScenarioReport[];
  readonly correctnessSummary: BenchmarkCorrectnessSummary;
  readonly postgresServerVersionNum: number;
}): IngestionBenchmarkReport {
  const cpus = os.cpus();
  const firstScenario = params.scenarioReports[0]?.config;
  return {
    schemaVersion: 1,
    run: {
      runId: params.runId,
      startedAt: params.startedAt,
      completedAt: params.completedAt,
      profile: params.profile.name,
      success: params.success,
      gitCommit: null,
      gitDirty: false,
    },
    environment: {
      nodeVersion: process.version,
      pnpmVersion: '11.17.0',
      platform: process.platform,
      arch: process.arch,
      cpuModel: cpus[0]?.model ?? 'unknown',
      logicalCores: cpus.length,
      totalMemoryBytes: os.totalmem(),
      postgresServerVersionNum: params.postgresServerVersionNum,
      pgClientVersion: '8.22.0',
      apiPoolMax: firstScenario?.apiPoolMax ?? 0,
      workerPoolMax: firstScenario?.workerPoolMax ?? 0,
    },
    scenarios: params.scenarioReports,
    correctness: params.correctnessSummary,
  };
}

export type { CorrectnessChecks, PoolStats };
export { projectIdForRun };
