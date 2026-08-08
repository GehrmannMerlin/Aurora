import { describe, expect, it } from 'vitest';
import { renderEvidenceMarkdown } from '../src/evidence.js';
import type { IngestionBenchmarkReport } from '../src/types.js';

function sampleReport(): IngestionBenchmarkReport {
  return {
    schemaVersion: 1,
    run: {
      runId: '00000000-0000-4000-8000-000000000001',
      startedAt: '2026-08-02T00:00:00.000Z',
      completedAt: '2026-08-02T00:01:00.000Z',
      profile: 'smoke',
      success: true,
      gitCommit: null,
      gitDirty: false,
    },
    environment: {
      nodeVersion: 'v24.18.0',
      pnpmVersion: '11.17.0',
      platform: 'win32',
      arch: 'x64',
      cpuModel: 'test cpu',
      logicalCores: 8,
      totalMemoryBytes: 8 * 1024 * 1024 * 1024,
      postgresServerVersionNum: 170010,
      pgClientVersion: '8.22.0',
      apiPoolMax: 0,
      workerPoolMax: 0,
    },
    scenarios: [
      {
        config: {
          name: 'smoke',
          warmupEvents: 100,
          measuredEvents: 500,
          batchSize: 10,
          httpConcurrency: 2,
          workerConcurrency: 2,
          claimBatchSize: 10,
          processorDelayMs: 0,
          maxRunDurationMs: 120000,
          apiPoolMax: 4,
          workerPoolMax: 4,
        },
        requests: 60,
        events: 600,
        accepted: 600,
        duplicate: 0,
        rejected: 0,
        throughput: { requestsPerSecond: 120, eventsPerSecond: 1200 },
        httpLatencyMs: { count: 60, min: 1, max: 5, mean: 2, p50: 2, p90: 4, p95: 5, p99: 5 },
        processingLatencyMs: {
          count: 600,
          min: 1,
          max: 10,
          mean: 3,
          p50: 3,
          p90: 5,
          p95: 6,
          p99: 9,
        },
        drainDurationMs: 5000,
        poolPeak: { totalCount: 4, idleCount: 2, waitingCount: 0 },
        workerDiagnostics: {
          claim: 60,
          renew: 0,
          leaseLost: 0,
          retryBudgetExhausted: 0,
          processed: 600,
          retryScheduled: 0,
          deadLettered: 0,
        },
        correctness: {
          requestsMatchExpected: true,
          eventsMatchExpected: true,
          allResponsesHaveRequestId: true,
          noUnexpected4xx5xx: true,
          acceptedPlusDuplicatePlusRejectedConserved: true,
          inboxRowCountCorrect: true,
          processedCountCorrect: true,
          noUnexpectedDeadLettered: true,
          noResidualLeased: true,
          noResidualRetryWaiting: true,
          noLeaseLost: true,
          workerInFlightZero: true,
          poolsClosed: true,
          schemaRemoved: true,
        },
      },
    ],
    correctness: { passed: true, checks: [] },
  };
}

describe('evidence', () => {
  it('renders markdown with environment, configs, results and limitations', () => {
    const md = renderEvidenceMarkdown(sampleReport());
    expect(md).toContain('# Aurora 数据接入本地基准证据');
    expect(md).toContain('profile');
    expect(md).toContain('smoke');
    expect(md).toContain('PostgreSQL server_version_num');
    expect(md).toContain('局限性');
    expect(md).toContain('不构成生产容量');
  });

  it('never leaks credentials, URLs, event bodies or SQL', () => {
    const md = renderEvidenceMarkdown(sampleReport());
    const forbidden = [
      'aurora_ingest_',
      'secret',
      'clientKey',
      'client-key',
      'x-aurora-client-key',
      'postgresql://',
      'aurora_inbox_test',
      'RETURNING',
      'INSERT INTO',
      '"body"',
      'https://benchmark',
    ];
    for (const token of forbidden) {
      expect(md.toLowerCase()).not.toContain(token.toLowerCase());
    }
  });
});
