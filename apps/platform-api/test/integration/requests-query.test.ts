import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { FastifyInstance } from 'fastify';
import { insertOrganizationMembership } from '@aurora/platform-identity';
import { createProject, insertProjectMember } from '@aurora/platform-project-governance';
import {
  persistRequestEventSample,
  persistRequestMetricContribution,
} from '@aurora/processing-store';
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

/** Seed timestamps: contributions/samples land inside the window. */
const SEED_MS = new Date('2026-08-10T09:15:00.000Z').getTime();
/** Deterministic bucket/sample dataThrough (inside the window, before `end`). */
const UPDATED_AT = new Date('2026-08-10T09:40:00.000Z');

const ORDERS_URL = 'https://api.example.test/orders';
const PAYMENTS_URL = 'https://api.example.test/payments';

const RFC3339_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

interface MethodAggregateBody {
  method?: string;
  observedCount?: number;
  failureCount?: number;
  slowCount?: number;
  durationSumMs?: number;
  durationMaxMs?: number;
  outcomes?: readonly { outcome?: string; count?: number }[];
}

interface EndpointItemBody {
  endpointId?: string;
  method?: string;
  url?: string;
  sampleCount?: number;
  outcomeCounts?: readonly { outcome?: string; count?: number }[];
  dataThrough?: string;
  isPartial?: boolean;
  completeness?: { source?: string; bounded?: boolean };
}

interface RequestsBody {
  data?: {
    summary?: {
      status?: string;
      reason?: string;
      data?: {
        methods?: readonly MethodAggregateBody[];
        dataThrough?: string;
        isPartial?: boolean;
      };
    };
    endpoints?: {
      status?: string;
      reason?: string;
      data?: {
        items?: readonly EndpointItemBody[];
        pagination?: {
          nextCursor?: string;
          totalCount?: number;
          totalCountStatus?: string;
        };
      };
    };
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

/** Build a project-scoped requests query URL with an RFC 3339 timeRange. */
function requestsUrl(
  organizationId: string,
  projectId: string,
  start: string,
  end: string,
  extra = '',
): string {
  const timeRange = `timeRange[start]=${encodeURIComponent(start)}&timeRange[end]=${encodeURIComponent(end)}`;
  const query = extra === '' ? timeRange : `${timeRange}&${extra}`;
  return `/api/platform/v1/organizations/${organizationId}/projects/${projectId}/requests?${query}`;
}

/** Seed request metric contributions + diagnostic samples for a project. */
async function seedProjectData(pool: Pool, projectId: string): Promise<void> {
  await persistRequestMetricContribution(pool, {
    projectId,
    eventId: `flow-metric-${randomUUID()}`,
    occurredAt: SEED_MS,
    method: 'GET',
    outcome: 'success',
    statusCode: 200,
    durationMs: 120,
    isFailure: false,
    isSlow: false,
  });
  await persistRequestMetricContribution(pool, {
    projectId,
    eventId: `flow-metric-${randomUUID()}`,
    occurredAt: SEED_MS,
    method: 'POST',
    outcome: 'success',
    statusCode: 201,
    durationMs: 300,
    isFailure: false,
    isSlow: false,
  });
  await persistRequestEventSample(pool, {
    projectId,
    eventEnvelope: {
      protocolVersion: 1,
      eventId: `flow-smp-${randomUUID()}`,
      eventType: 'request',
      occurredAt: SEED_MS,
      body: {
        method: 'GET',
        url: ORDERS_URL,
        startedAt: SEED_MS,
        durationMs: 120,
        outcome: 'success',
        statusCode: 200,
      },
    },
  });
  await persistRequestEventSample(pool, {
    projectId,
    eventEnvelope: {
      protocolVersion: 1,
      eventId: `flow-smp-${randomUUID()}`,
      eventType: 'request',
      occurredAt: SEED_MS,
      body: {
        method: 'POST',
        url: PAYMENTS_URL,
        startedAt: SEED_MS,
        durationMs: 5000,
        outcome: 'timeout',
        statusCode: 504,
      },
    },
  });
  // Deterministic dataThrough/created_at so `isPartial` semantics are stable.
  await pool.query('UPDATE request_metric_buckets SET updated_at = $1 WHERE project_id = $2', [
    UPDATED_AT,
    projectId,
  ]);
  await pool.query('UPDATE request_event_samples SET created_at = $1 WHERE project_id = $2', [
    UPDATED_AT,
    projectId,
  ]);
}

/** Create a project under the actor's personal org and return its id. */
async function createProjectFor(pool: Pool, owner: RegisteredActor): Promise<string> {
  const created = await createProject(pool, {
    orgId: owner.organizationId,
    name: `Requests ${randomUUID().slice(0, 8)}`,
    frameworkType: 'react',
    createdBy: owner.accountId,
  });
  return created.projectId;
}

describeDb('DAT-16 requestsListEndpoints flow (real PostgreSQL 17 + Redis)', () => {
  let pool: Pool;
  let sessionStore: SessionStore;
  let keyPrefix: string;

  beforeAll(async () => {
    assertIsTestDatabase(testDatabaseUrl());
    pool = createTestPool();
    await runAllMigrations();
    await truncateIdentityTables(pool);
    // processing-store tables are not covered by truncateIdentityTables; keep the
    // requests-query data set isolated across suites.
    await pool.query(
      `TRUNCATE request_metric_buckets, request_metric_event_applications,
        request_event_samples, error_event_occurrences,
        performance_metric_buckets, performance_metric_event_applications,
        performance_event_samples CASCADE`,
    );
    keyPrefix = `test:requests-query:${randomUUID()}`;
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

  async function getRequests(
    app: FastifyInstance,
    actor: RegisteredActor,
    organizationId: string,
    projectId: string,
    extra = '',
  ): Promise<{ status: number; body: RequestsBody | ProblemBody }> {
    const response = await app.inject({
      method: 'GET',
      url: requestsUrl(organizationId, projectId, WINDOW.start, WINDOW.end, extra),
      headers: { cookie: `aurora_session=${actor.cookie}` },
    });
    return { status: response.statusCode, body: response.json() };
  }

  it('the project manager (owner) sees real summary + endpoints data', async () => {
    const app = buildApp();
    const owner = await registerActor(app, `owner-${randomUUID()}@example.com`);
    const projectId = await createProjectFor(pool, owner);
    await seedProjectData(pool, projectId);

    const { status, body } = await getRequests(app, owner, owner.organizationId, projectId);
    expect(status).toBe(200);
    const data = (body as RequestsBody).data;
    expect(data?.summary?.status).toBe('available');
    expect(data?.summary?.data?.isPartial).toBe(true);
    const methods = data?.summary?.data?.methods ?? [];
    expect(methods.map((m) => m.method)).toEqual(['GET', 'POST']);
    for (const method of methods) {
      expect(method.observedCount).toBe(1);
      expect(method.failureCount).toBe(0);
      expect(method.slowCount).toBe(0);
      expect(method.durationMaxMs).toBeGreaterThan(0);
      expect(Array.isArray(method.outcomes)).toBe(true);
    }
    const summaryRaw = data?.summary?.data;
    if (summaryRaw?.dataThrough !== undefined) {
      expect(summaryRaw.dataThrough).toMatch(RFC3339_UTC);
    }

    expect(data?.endpoints?.status).toBe('available');
    const items = data?.endpoints?.data?.items ?? [];
    expect(items.map((i) => i.url)).toEqual([ORDERS_URL, PAYMENTS_URL]);
    for (const item of items) {
      expect(item.endpointId).toMatch(/^[0-9a-f]{64}$/);
      expect(item.method).toBeDefined();
      expect(item.sampleCount).toBe(1);
      expect(Array.isArray(item.outcomeCounts)).toBe(true);
      expect(item.isPartial).toBe(true);
      expect(item.completeness).toEqual({ source: 'diagnostic_samples', bounded: true });
    }
    expect(data?.endpoints?.data?.pagination?.totalCount).toBe(2);
    expect(data?.endpoints?.data?.pagination?.totalCountStatus).toBe('available');

    expect(data?.percentiles?.status).toBe('unavailable');
    expect(data?.percentiles?.reason).toBe('percentiles deferred (ADR-020)');

    const meta = (body as RequestsBody).meta;
    expect(meta?.requestId).toBeDefined();
    expect(meta?.readAt).toMatch(RFC3339_UTC);
    expect(meta?.normalizedQuery?.timeRange).toBe(`${WINDOW.start}..${WINDOW.end}`);

    // Org manager → full allowedActions verb set + project navigation target.
    const allowed = (body as RequestsBody).allowedActions ?? [];
    expect(allowed).toContain('read');
    const targets = (body as RequestsBody).navigationTargets ?? [];
    expect(targets[0]?.routeId).toBe('project.requests');
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
    await seedProjectData(pool, projectId);
    const granted = await insertProjectMember(pool, {
      orgId: owner.organizationId,
      projectId,
      accountId: member.accountId,
      role: 'developer',
    });
    expect(granted.status).toBe('success');

    const { status, body } = await getRequests(app, member, owner.organizationId, projectId);
    expect(status).toBe(200);
    const data = (body as RequestsBody).data;
    expect(data?.summary?.status).toBe('available');
    expect(data?.endpoints?.status).toBe('available');
    expect((body as RequestsBody).allowedActions).toEqual(['read']);
    const targets = (body as RequestsBody).navigationTargets ?? [];
    expect(targets[0]?.routeId).toBe('project.requests');
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
    await seedProjectData(pool, projectId);

    const { status, body } = await getRequests(app, outsider, owner.organizationId, projectId);
    expect(status).toBe(403);
    expect((body as ProblemBody).code).toBe('authorization');
    // The metric/sample repositories were never queried: the problem carries only
    // closed error fields and no data section at all.
    const raw = JSON.stringify(body);
    expect(raw).not.toContain('"data"');
    expect(raw).not.toContain('summary');
    expect(raw).not.toContain('methods');
    expect(raw).not.toContain('endpoints');
    expect(raw).not.toContain(ORDERS_URL);
    await app.close();
  });

  it('a project belonging to a different org is a closed 404 (even for an org manager)', async () => {
    const app = buildApp();
    const ownerA = await registerActor(app, `ownerA-${randomUUID()}@example.com`);
    const projectId = await createProjectFor(pool, ownerA);
    await seedProjectData(pool, projectId);
    // ownerB is an org manager of org B — they must NOT read org A's project.
    const ownerB = await registerActor(app, `ownerB-${randomUUID()}@example.com`);

    const { status, body } = await getRequests(app, ownerB, ownerB.organizationId, projectId);
    expect(status).toBe(404);
    expect((body as ProblemBody).code).toBe('not_found');
    const raw = JSON.stringify(body);
    expect(raw).not.toContain(ORDERS_URL);
    await app.close();
  });

  it('an empty window returns empty summary/endpoints and unavailable percentiles', async () => {
    const app = buildApp();
    const owner = await registerActor(app, `owner-${randomUUID()}@example.com`);
    const projectId = await createProjectFor(pool, owner); // no data seeded

    const { status, body } = await getRequests(app, owner, owner.organizationId, projectId);
    expect(status).toBe(200);
    const data = (body as RequestsBody).data;
    expect(data?.summary?.status).toBe('empty');
    expect(data?.summary?.reason).toBe('no request data in window');
    expect(data?.endpoints?.status).toBe('empty');
    expect(data?.endpoints?.reason).toBe('no request samples in window');
    expect(data?.percentiles?.status).toBe('unavailable');
    expect(data?.percentiles?.reason).toBe('percentiles deferred (ADR-020)');
    await app.close();
  });

  it('a non-numeric or non-integer limit maps to a structural 400', async () => {
    const app = buildApp();
    const owner = await registerActor(app, `owner-${randomUUID()}@example.com`);
    const projectId = await createProjectFor(pool, owner);

    for (const badLimit of ['abc', '1.5', '0', '101']) {
      const response = await app.inject({
        method: 'GET',
        url: requestsUrl(
          owner.organizationId,
          projectId,
          WINDOW.start,
          WINDOW.end,
          `limit=${badLimit}`,
        ),
        headers: { cookie: `aurora_session=${owner.cookie}` },
      });
      expect(response.statusCode).toBe(400);
      const body: ProblemBody = response.json();
      expect(body.code).toBe('structural_error');
    }
    await app.close();
  });

  it('a malformed endpoint cursor (valid base64url, no method\\nurl separator) is a structural 400, not 500', async () => {
    // The contract `cursor` bound is str(1, 4096), so base64url that decodes to
    // something without a `method\nurl` separator passes parseInput and reaches
    // the repository, which throws ProcessingStoreError('invalid_input'). It must
    // map to 400 structural_error (DAT-16 error-mapping fix) — never a 500.
    const app = buildApp();
    const owner = await registerActor(app, `owner-${randomUUID()}@example.com`);
    const projectId = await createProjectFor(pool, owner);

    // "SGVsbG8gd29ybGQ" is base64url("Hello world") — no `\n`, so it cannot be a
    // valid endpoint keyset cursor.
    const response = await app.inject({
      method: 'GET',
      url: requestsUrl(
        owner.organizationId,
        projectId,
        WINDOW.start,
        WINDOW.end,
        'cursor=SGVsbG8gd29ybGQ',
      ),
      headers: { cookie: `aurora_session=${owner.cookie}` },
    });
    expect(response.statusCode).toBe(400);
    const body: ProblemBody = response.json();
    expect(body.code).toBe('structural_error');
    // The response must not leak the internal decode failure or a 500.
    const raw = JSON.stringify(body);
    expect(raw).not.toContain('malformed endpoint cursor');
    await app.close();
  });

  it('an absent limit defaults to 50 (contract optional, schema default)', async () => {
    const app = buildApp();
    const owner = await registerActor(app, `owner-${randomUUID()}@example.com`);
    const projectId = await createProjectFor(pool, owner);
    await seedProjectData(pool, projectId);

    const { status, body } = await getRequests(app, owner, owner.organizationId, projectId);
    expect(status).toBe(200);
    const data = (body as RequestsBody).data;
    expect(data?.summary?.status).toBe('available');
    expect(data?.endpoints?.data?.pagination?.totalCount).toBe(2);
    await app.close();
  });

  it('paginates a long-URL endpoint with a >64-char keyset cursor (DAT-16 cursor bound fix)', async () => {
    // The endpoint keyset cursor is base64url(method\nurl). A long URL encodes to
    // far more than the old str(1,64)/str(1,512) bounds, which previously made the
    // response fail serializeOutput → 500. This end-to-end flow must return 200 on
    // both the page producing the long nextCursor and the page consuming it.
    const app = buildApp();
    const owner = await registerActor(app, `owner-${randomUUID()}@example.com`);
    const projectId = await createProjectFor(pool, owner);
    await seedProjectData(pool, projectId);
    const longUrl = 'https://api.example.test/zzz-checkout/' + 'z'.repeat(380);
    await persistRequestEventSample(pool, {
      projectId,
      eventEnvelope: {
        protocolVersion: 1,
        eventId: `flow-smp-${randomUUID()}`,
        eventType: 'request',
        occurredAt: SEED_MS,
        body: {
          method: 'GET',
          url: longUrl,
          startedAt: SEED_MS,
          durationMs: 200,
          outcome: 'success',
          statusCode: 200,
        },
      },
    });
    // Deterministic created_at so `isPartial` semantics stay stable.
    await pool.query('UPDATE request_event_samples SET created_at = $1 WHERE project_id = $2', [
      UPDATED_AT,
      projectId,
    ]);

    // ORDER BY method, url → GET/orders, GET/zzz-checkout/…, POST/payments; with
    // limit=2 the nextCursor is the (long-URL) GET/zzz-checkout keyset.
    const first = await getRequests(app, owner, owner.organizationId, projectId, 'limit=2');
    expect(first.status).toBe(200);
    const data1 = (first.body as RequestsBody).data;
    expect(data1?.endpoints?.data?.pagination?.totalCount).toBe(3);
    const nextCursor = data1?.endpoints?.data?.pagination?.nextCursor;
    expect(nextCursor).toBeDefined();
    if (nextCursor === undefined) {
      throw new Error('expected a nextCursor from the first page');
    }
    expect(nextCursor.length).toBeGreaterThan(64);

    const second = await getRequests(
      app,
      owner,
      owner.organizationId,
      projectId,
      `limit=2&cursor=${encodeURIComponent(nextCursor)}`,
    );
    expect(second.status).toBe(200);
    const data2 = (second.body as RequestsBody).data;
    expect(data2?.endpoints?.status).toBe('available');
    const items2 = data2?.endpoints?.data?.items ?? [];
    expect(items2).toHaveLength(1);
    expect(items2[0]?.url).toBe(PAYMENTS_URL);
    expect(data2?.endpoints?.data?.pagination?.nextCursor).toBeUndefined();
    await app.close();
  });

  it('privacy: the response never leaks body/cookie/auth fields or internal columns', async () => {
    const app = buildApp();
    const owner = await registerActor(app, `owner-${randomUUID()}@example.com`);
    const projectId = await createProjectFor(pool, owner);
    await seedProjectData(pool, projectId);

    const { status, body } = await getRequests(app, owner, owner.organizationId, projectId);
    expect(status).toBe(200);
    const raw = JSON.stringify(body);
    for (const forbidden of [
      'requestBody',
      'responseBody',
      'request_body',
      'response_body',
      'cookie',
      'authorization',
      'password',
      'csrf',
      'token',
      'sample_body',
      'event_id',
      'bucket_start',
      'occurred_at',
      'status_code',
      'duration_ms',
      'created_by',
      'website_url',
    ]) {
      expect(raw).not.toContain(forbidden);
    }
    await app.close();
  });
});
