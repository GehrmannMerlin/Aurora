import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { FastifyInstance } from 'fastify';
import { insertOrganizationMembership } from '@aurora/platform-identity';
import { createProject, insertProjectMember } from '@aurora/platform-project-governance';
import { persistPerformanceMetricContribution } from '@aurora/processing-store';
import { createSessionStore, type SessionStore } from '@aurora/platform-session';
import { ConsoleEmailAdapter } from '@aurora/platform-email';
import { buildPlatformApi } from '../../src/app.js';
import { loadPlatformApiConfig } from '../../src/config.js';
import {
  assertIsTestDatabase,
  createTestPool,
  redisUrl,
  runAllMigrations,
  testDatabaseUrl,
  truncateIdentityTables,
} from './helpers.js';
import { registerActor, type RegisteredActor } from './flow-helpers.js';

const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const hasRedis = process.env.AURORA_TEST_REDIS_URL !== undefined;
const describeDb = hasDb && hasRedis ? describe : describe.skip;

const FIXED_NOW = new Date('2026-08-10T12:00:00.000Z');

const WINDOW = {
  start: '2026-08-10T09:00:00.000Z',
  end: '2026-08-10T10:00:00.000Z',
};

/** Seed timestamps: contributions land inside the window. */
const SEED_MS = new Date('2026-08-10T09:15:00.000Z').getTime();
/** Deterministic bucket dataThrough (inside the window, before `end`). */
const UPDATED_AT = '2026-08-10T09:40:00.000Z';

/** A seed eventId that must never leak out of the handler (privacy negative). */
const PRIVATE_EVENT_ID = `priv-pm-${randomUUID()}`;

interface MetricAggregateBody {
  metricName: string;
  unit: string;
  observedCount?: number;
  valueSum?: number;
  valueMax?: number;
  mean?: number;
}

interface PerformanceBody {
  data?: {
    metrics?: {
      status?: string;
      reason?: string;
      data?: {
        metrics?: readonly MetricAggregateBody[];
        dataThrough?: string;
        isPartial?: boolean;
      };
    };
    pages?: { status?: string; reason?: string };
    percentiles?: { status?: string; reason?: string };
  };
  meta?: { requestId?: string; readAt?: string; normalizedQuery?: { timeRange?: string } };
  allowedActions?: readonly string[];
  navigationTargets?: readonly { routeId?: string; pathParams?: Record<string, string> }[];
}

interface ProblemBody {
  code?: string;
  detail?: string;
}

/** Seed three metric aggregates into the project's performance bucket store. */
async function seedPerformanceData(pool: Pool, projectId: string): Promise<void> {
  // lcp/millisecond: two contributions (120ms, 180ms) → observedCount 2,
  // valueSum 300, valueMax 180, mean 150.
  await persistPerformanceMetricContribution(pool, {
    projectId,
    eventId: `flow-pm-${randomUUID()}`,
    occurredAt: SEED_MS,
    metricName: 'lcp',
    unit: 'millisecond',
    value: 120,
    startedAt: SEED_MS,
    durationMs: 120,
  });
  await persistPerformanceMetricContribution(pool, {
    projectId,
    eventId: `flow-pm-${randomUUID()}`,
    occurredAt: SEED_MS + 30_000,
    metricName: 'lcp',
    unit: 'millisecond',
    value: 180,
    startedAt: SEED_MS + 30_000,
    durationMs: 180,
  });
  // inp/millisecond: one contribution (250ms) → observedCount 1, valueSum 250,
  // valueMax 250, mean 250.
  await persistPerformanceMetricContribution(pool, {
    projectId,
    eventId: `flow-pm-${randomUUID()}`,
    occurredAt: SEED_MS,
    metricName: 'inp',
    unit: 'millisecond',
    value: 250,
    startedAt: SEED_MS,
    durationMs: 250,
  });
  // cls/ratio: one contribution (0.12) → observedCount 1, valueSum 0.12,
  // valueMax 0.12, mean 0.12.
  await persistPerformanceMetricContribution(pool, {
    projectId,
    eventId: `flow-pm-${randomUUID()}`,
    occurredAt: SEED_MS,
    metricName: 'cls',
    unit: 'ratio',
    value: 0.12,
    startedAt: SEED_MS,
  });
  // Deterministic dataThrough so `isPartial` semantics are stable.
  await pool.query('UPDATE performance_metric_buckets SET updated_at = $1 WHERE project_id = $2', [
    UPDATED_AT,
    projectId,
  ]);
}

/** Create a project under the actor's personal org and return its id. */
async function createProjectFor(pool: Pool, owner: RegisteredActor): Promise<string> {
  const created = await createProject(pool, {
    orgId: owner.organizationId,
    name: `Performance ${randomUUID().slice(0, 8)}`,
    frameworkType: 'react',
    createdBy: owner.accountId,
  });
  return created.projectId;
}

function windowQuery(start: string, end: string): string {
  return `timeRange[start]=${encodeURIComponent(start)}&timeRange[end]=${encodeURIComponent(end)}`;
}

describeDb('DAT-17 performanceListPages flow (real PostgreSQL 17 + Redis)', () => {
  let pool: Pool;
  let sessionStore: SessionStore;
  let keyPrefix: string;

  beforeAll(async () => {
    assertIsTestDatabase(testDatabaseUrl());
    pool = createTestPool();
    await runAllMigrations();
    await truncateIdentityTables(pool);
    // processing-store tables are not covered by truncateIdentityTables; keep the
    // performance-query data set isolated across suites.
    await pool.query(
      `TRUNCATE request_metric_buckets, request_metric_event_applications,
        request_event_samples, error_event_occurrences,
        performance_metric_buckets, performance_metric_event_applications,
        performance_event_samples CASCADE`,
    );
    keyPrefix = `test:performance-query:${randomUUID()}`;
    sessionStore = await createSessionStore({ url: redisUrl(), keyPrefix });
  });

  afterAll(async () => {
    await sessionStore.client.quit().catch(() => undefined);
    await pool.end();
  });

  function buildApp(): FastifyInstance {
    return buildPlatformApi({
      config: loadPlatformApiConfig({
        HOST: '127.0.0.1',
        PORT: '0',
        DATABASE_URL: testDatabaseUrl(),
        REDIS_URL: redisUrl(),
        SESSION_IDLE_MS: String(30 * 60 * 1000),
        SESSION_ABSOLUTE_MS: String(8 * 60 * 60 * 1000),
        COOKIE_SECURE: 'false',
        EMAIL_DELIVERY_MODE: 'console',
        APP_ORIGIN: '',
        LOG_ENABLED: 'false',
      }),
      pool,
      sessionStore,
      emailPort: new ConsoleEmailAdapter({ mode: 'console', log: () => undefined }),
      now: () => new Date(FIXED_NOW.getTime()),
    });
  }

  async function getPerformance(
    app: FastifyInstance,
    actor: RegisteredActor,
    organizationId: string,
    projectId: string,
    query = '',
  ): Promise<{ status: number; body: PerformanceBody | ProblemBody }> {
    const url = `/api/platform/v1/organizations/${organizationId}/projects/${projectId}/performance${
      query === '' ? '' : `?${query}`
    }`;
    const response = await app.inject({
      method: 'GET',
      url,
      headers: { cookie: `aurora_session=${actor.cookie}` },
    });
    return { status: response.statusCode, body: response.json() };
  }

  it('the project manager (owner) sees real metric aggregates with pages/percentiles unavailable', async () => {
    const app = buildApp();
    const owner = await registerActor(app, `owner-${randomUUID()}@example.com`);
    const projectId = await createProjectFor(pool, owner);
    await seedPerformanceData(pool, projectId);

    const { status, body } = await getPerformance(
      app,
      owner,
      owner.organizationId,
      projectId,
      windowQuery(WINDOW.start, WINDOW.end),
    );
    expect(status).toBe(200);
    const data = (body as PerformanceBody).data;
    expect(data?.metrics?.status).toBe('available');

    const metrics = data?.metrics?.data?.metrics ?? [];
    // Repository ORDER BY metric_name, unit → cls/ratio, inp/millisecond, lcp/millisecond.
    expect(metrics.map((m) => `${m.metricName}/${m.unit}`)).toEqual([
      'cls/ratio',
      'inp/millisecond',
      'lcp/millisecond',
    ]);
    const byKey = new Map(metrics.map((m) => [`${m.metricName}/${m.unit}`, m]));
    expect(byKey.get('cls/ratio')).toMatchObject({
      metricName: 'cls',
      unit: 'ratio',
      observedCount: 1,
      valueSum: 0.12,
      valueMax: 0.12,
      mean: 0.12,
    });
    expect(byKey.get('inp/millisecond')).toMatchObject({
      metricName: 'inp',
      unit: 'millisecond',
      observedCount: 1,
      valueSum: 250,
      valueMax: 250,
      mean: 250,
    });
    expect(byKey.get('lcp/millisecond')).toMatchObject({
      metricName: 'lcp',
      unit: 'millisecond',
      observedCount: 2,
      valueSum: 300,
      valueMax: 180,
      mean: 150,
    });

    // dataThrough is the deterministic latest bucket updated_at; the window end is
    // 10:00 so dataThrough (09:40) < end → isPartial true.
    expect(data?.metrics?.data?.dataThrough).toBe(UPDATED_AT);
    expect(data?.metrics?.data?.isPartial).toBe(true);

    // The page dimension and percentile raw material are not present in the data:
    // both sections are honestly unavailable, never forged.
    expect(data?.pages).toEqual({
      status: 'unavailable',
      reason: 'page dimension not in performance data (deferred)',
    });
    expect(data?.percentiles).toEqual({
      status: 'unavailable',
      reason: 'percentiles deferred (ADR-021)',
    });

    const meta = (body as PerformanceBody).meta;
    expect(meta?.requestId).toBeDefined();
    expect(meta?.readAt).toBe(FIXED_NOW.toISOString());
    expect(meta?.normalizedQuery?.timeRange).toBe(`${WINDOW.start}..${WINDOW.end}`);

    const allowed = (body as PerformanceBody).allowedActions ?? [];
    expect(allowed).toContain('read');
    const targets = (body as PerformanceBody).navigationTargets ?? [];
    expect(targets[0]?.routeId).toBe('project.performance');
    expect(targets[0]?.pathParams?.organizationId).toBe(owner.organizationId);
    expect(targets[0]?.pathParams?.projectId).toBe(projectId);
    await app.close();
  });

  it('a plain project member (developer) sees the data with a read-only action projection', async () => {
    const app = buildApp();
    const owner = await registerActor(app, `owner-${randomUUID()}@example.com`);
    const member = await registerActor(app, `member-${randomUUID()}@example.com`);
    const membership = await insertOrganizationMembership(pool, {
      organizationId: owner.organizationId,
      accountId: member.accountId,
      role: 'member',
    });
    expect(membership.status).toBe('success');
    const projectId = await createProjectFor(pool, owner);
    await seedPerformanceData(pool, projectId);
    const granted = await insertProjectMember(pool, {
      orgId: owner.organizationId,
      projectId,
      accountId: member.accountId,
      role: 'developer',
    });
    expect(granted.status).toBe('success');

    const { status, body } = await getPerformance(
      app,
      member,
      owner.organizationId,
      projectId,
      windowQuery(WINDOW.start, WINDOW.end),
    );
    expect(status).toBe(200);
    const data = (body as PerformanceBody).data;
    expect(data?.metrics?.status).toBe('available');
    expect(data?.metrics?.data?.metrics?.length).toBe(3);
    expect(data?.pages?.status).toBe('unavailable');
    expect(data?.percentiles?.status).toBe('unavailable');
    expect((body as PerformanceBody).allowedActions).toEqual(['read']);
    const targets = (body as PerformanceBody).navigationTargets ?? [];
    expect(targets[0]?.routeId).toBe('project.performance');
    await app.close();
  });

  it('an org member without project access gets a closed 403 with no data', async () => {
    const app = buildApp();
    const owner = await registerActor(app, `owner-${randomUUID()}@example.com`);
    const outsider = await registerActor(app, `outsider-${randomUUID()}@example.com`);
    const membership = await insertOrganizationMembership(pool, {
      organizationId: owner.organizationId,
      accountId: outsider.accountId,
      role: 'member',
    });
    expect(membership.status).toBe('success');
    const projectId = await createProjectFor(pool, owner);
    await seedPerformanceData(pool, projectId);

    const { status, body } = await getPerformance(
      app,
      outsider,
      owner.organizationId,
      projectId,
      windowQuery(WINDOW.start, WINDOW.end),
    );
    expect(status).toBe(403);
    expect((body as ProblemBody).code).toBe('authorization');
    // The metric repository was never queried: the problem carries only closed
    // error fields and no data section at all.
    const raw = JSON.stringify(body);
    expect(raw).not.toContain('"data"');
    expect(raw).not.toContain('metrics');
    expect(raw).not.toContain('dataThrough');
    await app.close();
  });

  it('a project belonging to a different org is a closed 404 (even for an org manager)', async () => {
    const app = buildApp();
    const ownerA = await registerActor(app, `ownerA-${randomUUID()}@example.com`);
    const projectId = await createProjectFor(pool, ownerA);
    await seedPerformanceData(pool, projectId);
    // ownerB is an org manager of org B — they must NOT read org A's project.
    const ownerB = await registerActor(app, `ownerB-${randomUUID()}@example.com`);

    const { status, body } = await getPerformance(
      app,
      ownerB,
      ownerB.organizationId,
      projectId,
      windowQuery(WINDOW.start, WINDOW.end),
    );
    expect(status).toBe(404);
    expect((body as ProblemBody).code).toBe('not_found');
    const raw = JSON.stringify(body);
    expect(raw).not.toContain('"data"');
    expect(raw).not.toContain('dataThrough');
    await app.close();
  });

  it('an empty project reports empty metrics with unavailable pages/percentiles', async () => {
    const app = buildApp();
    const owner = await registerActor(app, `owner-${randomUUID()}@example.com`);
    const projectId = await createProjectFor(pool, owner); // no data seeded

    const { status, body } = await getPerformance(
      app,
      owner,
      owner.organizationId,
      projectId,
      windowQuery(WINDOW.start, WINDOW.end),
    );
    expect(status).toBe(200);
    const data = (body as PerformanceBody).data;
    expect(data?.metrics).toEqual({ status: 'empty', reason: 'no performance data in window' });
    expect(data?.pages).toEqual({
      status: 'unavailable',
      reason: 'page dimension not in performance data (deferred)',
    });
    expect(data?.percentiles).toEqual({
      status: 'unavailable',
      reason: 'percentiles deferred (ADR-021)',
    });
    await app.close();
  });

  it('omitting timeRange applies the default last-24h window', async () => {
    const app = buildApp();
    const owner = await registerActor(app, `owner-${randomUUID()}@example.com`);
    const projectId = await createProjectFor(pool, owner);
    await seedPerformanceData(pool, projectId);

    // 09:15 is within the default window [12:00-24h, 12:00].
    const { status, body } = await getPerformance(app, owner, owner.organizationId, projectId);
    expect(status).toBe(200);
    const data = (body as PerformanceBody).data;
    expect(data?.metrics?.status).toBe('available');
    expect(data?.metrics?.data?.metrics?.length).toBe(3);
    expect(data?.metrics?.data?.isPartial).toBe(true);
    await app.close();
  });

  it('a malformed timeRange maps to a structural 400', async () => {
    const app = buildApp();
    const owner = await registerActor(app, `owner-${randomUUID()}@example.com`);
    const projectId = await createProjectFor(pool, owner);

    const badRanges = [
      // start after end.
      windowQuery('2026-08-10T11:00:00.000Z', '2026-08-10T08:00:00.000Z'),
      // window longer than 7 days.
      windowQuery('2026-08-01T00:00:00.000Z', '2026-08-10T00:00:00.000Z'),
      // end beyond the ~5 min clock-skew allowance (FIXED_NOW is 12:00).
      windowQuery('2026-08-10T08:00:00.000Z', '2026-08-10T12:10:00.000Z'),
    ];
    for (const query of badRanges) {
      const response = await app.inject({
        method: 'GET',
        url: `/api/platform/v1/organizations/${owner.organizationId}/projects/${projectId}/performance?${query}`,
        headers: { cookie: `aurora_session=${owner.cookie}` },
      });
      expect(response.statusCode).toBe(400);
      const body: ProblemBody = response.json();
      expect(body.code).toBe('structural_error');
    }
    await app.close();
  });

  it('privacy: the response never leaks raw samples/events/ids/internal columns', async () => {
    const app = buildApp();
    const owner = await registerActor(app, `owner-${randomUUID()}@example.com`);
    const projectId = await createProjectFor(pool, owner);
    const lcp = await persistPerformanceMetricContribution(pool, {
      projectId,
      eventId: PRIVATE_EVENT_ID,
      occurredAt: SEED_MS,
      metricName: 'lcp',
      unit: 'millisecond',
      value: 120,
      startedAt: SEED_MS,
      durationMs: 120,
    });
    expect(lcp.status).toBe('applied');

    const { status, body } = await getPerformance(
      app,
      owner,
      owner.organizationId,
      projectId,
      windowQuery(WINDOW.start, WINDOW.end),
    );
    expect(status).toBe(200);
    const raw = JSON.stringify(body);
    for (const forbidden of [
      'event_id',
      'occurred_at',
      'bucket_start',
      'started_at',
      'duration_ms',
      'value_sum',
      'value_max',
      'created_at',
      'updated_at',
      'envelope',
      'sample_body',
      'sample',
      'project_id',
      'organization_id',
    ]) {
      expect(raw).not.toContain(forbidden);
    }
    // The exact seeded eventId never leaks.
    expect(raw).not.toContain(PRIVATE_EVENT_ID);
    await app.close();
  });
});
