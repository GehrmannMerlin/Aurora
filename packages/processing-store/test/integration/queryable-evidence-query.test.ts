import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  persistErrorEventOccurrence,
  persistPerformanceMetricContribution,
  persistRequestMetricContribution,
  queryProjectQueryableEvidence,
} from '../../src/index.js';
import {
  assertIsTestDatabase,
  createTestPool,
  testDatabaseUrl,
} from './helpers.js';

const migrationsDir = fileURLToPath(new URL('../../migrations', import.meta.url));
const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const describeDb = hasDb ? describe : describe.skip;

const projectA = '11111111-1111-1111-1111-111111111111';
const projectB = '22222222-2222-2222-2222-222222222222';
const projectEmpty = '99999999-9999-9999-9999-999999999999';

function errorEnvelope(eventId: string, occurredAt: number): unknown {
  return {
    protocolVersion: 1,
    eventId,
    eventType: 'error',
    occurredAt,
    body: { category: 'javascript', error: { message: 'Synthetic runtime failure' } },
  };
}

async function seedOneOfEach(pool: Pool, projectId: string): Promise<void> {
  await persistErrorEventOccurrence(pool, {
    projectId,
    eventEnvelope: errorEnvelope(`evt-qe-error-${projectId}`, 1_800_000_054_000),
  });
  await persistRequestMetricContribution(pool, {
    projectId,
    eventId: `evt-qe-request-${projectId}`,
    occurredAt: 1_800_000_054_000,
    method: 'GET',
    outcome: 'success',
    statusCode: 200,
    durationMs: 120,
    isFailure: false,
    isSlow: false,
  });
  await persistPerformanceMetricContribution(pool, {
    projectId,
    eventId: `evt-qe-performance-${projectId}`,
    occurredAt: 1_800_000_054_000,
    metricName: 'lcp',
    unit: 'millisecond',
    value: 2500,
    startedAt: 1_800_000_050_000,
  });
}

describeDb('processing-store queryable evidence query (real PostgreSQL 17)', () => {
  let pool: Pool;

  beforeAll(async () => {
    assertIsTestDatabase(testDatabaseUrl());
    pool = createTestPool();
    await pool.query('DROP TABLE IF EXISTS request_metric_event_applications CASCADE');
    await pool.query('DROP TABLE IF EXISTS request_metric_buckets CASCADE');
    await pool.query('DROP TABLE IF EXISTS request_event_samples CASCADE');
    await pool.query('DROP TABLE IF EXISTS error_event_occurrences CASCADE');
    await pool.query('DROP TABLE IF EXISTS performance_metric_event_applications CASCADE');
    await pool.query('DROP TABLE IF EXISTS performance_metric_buckets CASCADE');
    await pool.query('DROP TABLE IF EXISTS performance_event_samples CASCADE');
    await pool.query('DROP TABLE IF EXISTS pgmigrations CASCADE');
    await runner({
      databaseUrl: testDatabaseUrl(),
      dir: migrationsDir,
      direction: 'up',
      migrationsTable: 'pgmigrations',
      count: Infinity,
      log: () => undefined,
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('counts one row per queryable table for the project', async () => {
    await pool.query('DELETE FROM error_event_occurrences WHERE project_id = $1', [projectA]);
    await pool.query('DELETE FROM request_metric_buckets WHERE project_id = $1', [projectA]);
    await pool.query('DELETE FROM performance_metric_buckets WHERE project_id = $1', [projectA]);
    await pool.query('DELETE FROM request_metric_event_applications WHERE project_id = $1', [projectA]);
    await pool.query('DELETE FROM performance_metric_event_applications WHERE project_id = $1', [projectA]);
    await seedOneOfEach(pool, projectA);

    const evidence = await queryProjectQueryableEvidence(pool, { projectId: projectA });
    expect(evidence).toEqual({
      errorOccurrences: 1,
      requestMetricBuckets: 1,
      performanceMetricBuckets: 1,
    });
  });

  it('counts every row, not just a boolean presence', async () => {
    await pool.query('DELETE FROM error_event_occurrences WHERE project_id = $1', [projectA]);
    await persistErrorEventOccurrence(pool, {
      projectId: projectA,
      eventEnvelope: errorEnvelope('evt-qe-error-a1', 1_800_000_054_000),
    });
    await persistErrorEventOccurrence(pool, {
      projectId: projectA,
      eventEnvelope: errorEnvelope('evt-qe-error-a2', 1_800_000_055_000),
    });

    const evidence = await queryProjectQueryableEvidence(pool, { projectId: projectA });
    expect(evidence.errorOccurrences).toBe(2);
  });

  it('returns all zeros for an empty project', async () => {
    const evidence = await queryProjectQueryableEvidence(pool, { projectId: projectEmpty });
    expect(evidence).toEqual({
      errorOccurrences: 0,
      requestMetricBuckets: 0,
      performanceMetricBuckets: 0,
    });
  });

  it('isolates evidence across projects', async () => {
    await pool.query('DELETE FROM error_event_occurrences WHERE project_id = $1', [projectA]);
    await pool.query('DELETE FROM request_metric_buckets WHERE project_id = $1', [projectA]);
    await pool.query('DELETE FROM performance_metric_buckets WHERE project_id = $1', [projectA]);
    await pool.query('DELETE FROM request_metric_event_applications WHERE project_id = $1', [projectA]);
    await pool.query('DELETE FROM performance_metric_event_applications WHERE project_id = $1', [projectA]);
    await seedOneOfEach(pool, projectA);
    await seedOneOfEach(pool, projectB);

    const a = await queryProjectQueryableEvidence(pool, { projectId: projectA });
    const b = await queryProjectQueryableEvidence(pool, { projectId: projectB });
    expect(a).toEqual({
      errorOccurrences: 1,
      requestMetricBuckets: 1,
      performanceMetricBuckets: 1,
    });
    expect(b).toEqual({
      errorOccurrences: 1,
      requestMetricBuckets: 1,
      performanceMetricBuckets: 1,
    });
  });
});
