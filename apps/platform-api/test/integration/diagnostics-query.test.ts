import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { FastifyInstance } from 'fastify';
import { insertOrganizationMembership } from '@aurora/platform-identity';
import { createProject, insertProjectMember } from '@aurora/platform-project-governance';
import { persistBatch } from '@aurora/ingestion-inbox';
import {
  createIngestionClientCredential,
  disableIngestionClientCredential,
  revokeIngestionClientCredential,
} from '@aurora/ingestion-credentials';
import {
  persistErrorEventOccurrence,
  persistPerformanceMetricContribution,
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

/** Deterministic query window; seeded events land inside it. */
const WINDOW = {
  start: '2026-08-10T08:00:00.000Z',
  end: '2026-08-10T11:00:00.000Z',
};

const SEED_MS = new Date('2026-08-10T09:15:00.000Z').getTime();
const RFC3339_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** A seeded origin/environment value that must never leak out of the handler. */
const SEED_ORIGIN = 'https://app.example.test';
const SEED_ENVIRONMENT = 'production';

interface StageFactBody {
  count?: number;
  latestAt?: string;
  lastErrorCode?: string;
}

interface DataStatusBody {
  data?: {
    summary?: {
      status?: string;
      reason?: string;
      data?: { status?: string; primaryCause?: string; asOf?: string };
    };
    stages?: {
      status?: string;
      reason?: string;
      data?: {
        received?: StageFactBody;
        processing?: StageFactBody;
        processed?: StageFactBody;
        deadLetter?: StageFactBody;
      };
    };
    recent?: {
      status?: string;
      reason?: string;
      data?: {
        latestReceivedAt?: string;
        receivedCount?: number;
        latestProcessedAt?: string;
        processedCount?: number;
        environmentBreakdown?: { status?: string; reason?: string };
      };
    };
    rejection?: { status?: string; reason?: string };
    credential?: {
      status?: string;
      reason?: string;
      data?: {
        activeCount?: number;
        disabledCount?: number;
        revokedCount?: number;
        latestCreatedAt?: string;
      };
    };
    queryable?: {
      status?: string;
      reason?: string;
      data?: {
        errorOccurrences?: number;
        requestMetricBuckets?: number;
        performanceMetricBuckets?: number;
        latestProcessedAt?: string;
      };
    };
    actionTargets?: readonly { routeId?: string; pathParams?: Record<string, string> }[];
  };
  meta?: { requestId?: string; readAt?: string; normalizedQuery?: { timeRange?: string } };
  allowedActions?: readonly string[];
  navigationTargets?: readonly { routeId?: string; pathParams?: Record<string, string> }[];
}

interface ProblemBody {
  code?: string;
  detail?: string;
}

/** A valid @aurora/event-schema error envelope for `persistBatch` seeding. */
function errorEnvelope(eventId: string, occurredAtMs: number): {
  protocolVersion: 1;
  eventId: string;
  eventType: 'error';
  occurredAt: number;
  body: { category: 'javascript'; error: { message: string } };
} {
  return {
    protocolVersion: 1,
    eventId,
    eventType: 'error',
    occurredAt: occurredAtMs,
    body: { category: 'javascript', error: { message: 'Synthetic runtime failure' } },
  };
}

/** Insert one event_inbox row via the real persistBatch write path + set its state. */
async function insertInboxEvent(
  pool: Pool,
  projectId: string,
  eventId: string,
  receivedAtIso: string,
  state: 'pending' | 'retry_waiting' | 'processed' | 'dead_lettered' = 'pending',
  opts: { processedAt?: string; deadLetteredAt?: string; lastErrorCode?: string } = {},
): Promise<void> {
  await persistBatch(pool, {
    projectId,
    events: [{ batchIndex: 0, event: errorEnvelope(eventId, SEED_MS) }],
    receivedAt: new Date(receivedAtIso).getTime(),
  });
  if (state !== 'pending') {
    await pool.query(
      `UPDATE event_inbox
       SET state = $1, processed_at = $2, dead_lettered_at = $3, last_error_code = $4
       WHERE project_id = $5 AND event_id = $6`,
      [
        state,
        opts.processedAt ?? null,
        opts.deadLetteredAt ?? null,
        opts.lastErrorCode ?? null,
        projectId,
        eventId,
      ],
    );
  }
}

/** Create one client reporting credential through the real lifecycle repository. */
async function insertCredential(
  pool: Pool,
  projectId: string,
  status: 'active' | 'disabled' | 'revoked' = 'active',
): Promise<{ clientKey: string }> {
  const created = await createIngestionClientCredential(pool, {
    projectId,
    origins: [SEED_ORIGIN],
    environments: [SEED_ENVIRONMENT],
    allowNonBrowser: true,
    expiresAt: null,
  });
  if (created.status !== 'success') {
    throw new Error(`credential create failed: ${created.status}`);
  }
  if (status === 'disabled') {
    const result = await disableIngestionClientCredential(pool, {
      keyId: created.metadata.keyId,
    });
    if (result.status !== 'success') {
      throw new Error(`credential disable failed: ${result.status}`);
    }
  }
  if (status === 'revoked') {
    const result = await revokeIngestionClientCredential(pool, {
      keyId: created.metadata.keyId,
    });
    if (result.status !== 'success') {
      throw new Error(`credential revoke failed: ${result.status}`);
    }
  }
  return { clientKey: created.clientKey };
}

/** Seed one row into each of the three queryable processing stores. */
async function seedQueryableEvidence(pool: Pool, projectId: string): Promise<void> {
  const error = await persistErrorEventOccurrence(pool, {
    projectId,
    eventEnvelope: errorEnvelope(`q-ev-${randomUUID()}`, SEED_MS),
  });
  if (error.status === 'invalid_input' || error.status === 'temporarily_unavailable') {
    throw new Error(`error occurrence persist failed: ${error.status}`);
  }
  const request = await persistRequestMetricContribution(pool, {
    projectId,
    eventId: `q-rm-${randomUUID()}`,
    occurredAt: SEED_MS,
    method: 'GET',
    outcome: 'success',
    statusCode: 200,
    durationMs: 120,
    isFailure: false,
    isSlow: false,
  });
  if (request.status === 'invalid_input' || request.status === 'temporarily_unavailable') {
    throw new Error(`request metric persist failed: ${request.status}`);
  }
  const perf = await persistPerformanceMetricContribution(pool, {
    projectId,
    eventId: `q-pm-${randomUUID()}`,
    occurredAt: SEED_MS,
    metricName: 'lcp',
    unit: 'millisecond',
    value: 120,
    startedAt: SEED_MS,
    durationMs: 120,
  });
  if (perf.status === 'invalid_input' || perf.status === 'temporarily_unavailable') {
    throw new Error(`performance metric persist failed: ${perf.status}`);
  }
}

/** Create a project under the actor's personal org and return its id. */
async function createProjectFor(pool: Pool, owner: RegisteredActor): Promise<string> {
  const created = await createProject(pool, {
    orgId: owner.organizationId,
    name: `Diagnostics ${randomUUID().slice(0, 8)}`,
    frameworkType: 'react',
    createdBy: owner.accountId,
  });
  return created.projectId;
}

function windowQuery(start: string, end: string): string {
  return `timeRange[start]=${encodeURIComponent(start)}&timeRange[end]=${encodeURIComponent(end)}`;
}

describeDb('DAT-20 diagnosticsGetDataStatus flow (real PostgreSQL 17 + Redis)', () => {
  let pool: Pool;
  let sessionStore: SessionStore;
  let keyPrefix: string;

  beforeAll(async () => {
    assertIsTestDatabase(testDatabaseUrl());
    pool = createTestPool();
    await runAllMigrations();
    await truncateIdentityTables(pool);
    // The ingestion diagnosis handler reads event_inbox + ingestion client
    // credentials + the three queryable processing stores; keep those isolated
    // across suites (not covered by truncateIdentityTables).
    await pool.query(
      `TRUNCATE event_inbox,
        ingestion_client_credentials, ingestion_client_credential_origins,
        ingestion_client_credential_environments,
        request_metric_buckets, request_metric_event_applications,
        request_event_samples, error_event_occurrences,
        performance_metric_buckets, performance_metric_event_applications,
        performance_event_samples CASCADE`,
    );
    keyPrefix = `test:diagnostics-query:${randomUUID()}`;
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

  async function getDataStatus(
    app: FastifyInstance,
    actor: RegisteredActor,
    organizationId: string,
    projectId: string,
    query = '',
  ): Promise<{ status: number; body: DataStatusBody | ProblemBody }> {
    const url = `/api/platform/v1/organizations/${organizationId}/projects/${projectId}/data-status${
      query === '' ? '' : `?${query}`
    }`;
    const response = await app.inject({
      method: 'GET',
      url,
      headers: { cookie: `aurora_session=${actor.cookie}` },
    });
    return { status: response.statusCode, body: response.json() };
  }

  it('the project manager (owner) sees the real diagnosis across all six sections', async () => {
    const app = buildApp();
    const owner = await registerActor(app, `owner-${randomUUID()}@example.com`);
    const projectId = await createProjectFor(pool, owner);
    // 1 active credential + 1 pending + 2 processed + 1 dead_lettered inbox rows
    // + one row in each queryable store → summary processing/processing_backlog.
    await insertCredential(pool, projectId);
    await insertInboxEvent(pool, projectId, 'flow-p1', '2026-08-10T09:00:00.000Z', 'pending');
    await insertInboxEvent(pool, projectId, 'flow-o1', '2026-08-10T09:10:00.000Z', 'processed', {
      processedAt: '2026-08-10T09:11:00.000Z',
    });
    await insertInboxEvent(pool, projectId, 'flow-o2', '2026-08-10T09:20:00.000Z', 'processed', {
      processedAt: '2026-08-10T09:22:00.000Z',
    });
    await insertInboxEvent(pool, projectId, 'flow-d1', '2026-08-10T09:30:00.000Z', 'dead_lettered', {
      deadLetteredAt: '2026-08-10T09:31:00.000Z',
      lastErrorCode: 'capacity_protected',
    });
    await seedQueryableEvidence(pool, projectId);

    const { status, body } = await getDataStatus(
      app,
      owner,
      owner.organizationId,
      projectId,
      windowQuery(WINDOW.start, WINDOW.end),
    );
    expect(status).toBe(200);
    const data = (body as DataStatusBody).data;

    expect(data?.summary?.status).toBe('available');
    expect(data?.summary?.data?.status).toBe('processing');
    expect(data?.summary?.data?.primaryCause).toBe('processing_backlog');
    expect(data?.summary?.data?.asOf).toBe(FIXED_NOW.toISOString());

    expect(data?.stages?.status).toBe('available');
    expect(data?.stages?.data?.received).toEqual({
      count: 4,
      latestAt: '2026-08-10T09:30:00.000Z',
    });
    expect(data?.stages?.data?.processing).toEqual({ count: 1 });
    expect(data?.stages?.data?.processed).toEqual({
      count: 2,
      latestAt: '2026-08-10T09:22:00.000Z',
    });
    expect(data?.stages?.data?.deadLetter).toEqual({
      count: 1,
      latestAt: '2026-08-10T09:31:00.000Z',
      lastErrorCode: 'capacity_protected',
    });

    expect(data?.recent?.status).toBe('available');
    expect(data?.recent?.data?.latestReceivedAt).toBe('2026-08-10T09:30:00.000Z');
    expect(data?.recent?.data?.receivedCount).toBe(4);
    expect(data?.recent?.data?.latestProcessedAt).toBe('2026-08-10T09:22:00.000Z');
    expect(data?.recent?.data?.processedCount).toBe(2);
    expect(data?.recent?.data?.environmentBreakdown).toEqual({
      status: 'unavailable',
      reason: 'environment not persisted (deferred)',
    });

    // Rejected batches are never persisted: the rejection section is always
    // unavailable rather than invented.
    expect(data?.rejection).toEqual({
      status: 'unavailable',
      reason: 'rejected batches are not persisted (deferred)',
    });

    expect(data?.credential?.status).toBe('available');
    expect(data?.credential?.data?.activeCount).toBe(1);
    expect(data?.credential?.data?.disabledCount).toBe(0);
    expect(data?.credential?.data?.revokedCount).toBe(0);
    expect(data?.credential?.data?.latestCreatedAt).toMatch(RFC3339_UTC);

    expect(data?.queryable?.status).toBe('available');
    expect(data?.queryable?.data?.errorOccurrences).toBe(1);
    expect(data?.queryable?.data?.requestMetricBuckets).toBe(1);
    expect(data?.queryable?.data?.performanceMetricBuckets).toBe(1);
    expect(data?.queryable?.data?.latestProcessedAt).toBe('2026-08-10T09:22:00.000Z');

    // processing → project.requests + project.performance action targets.
    expect(data?.actionTargets?.map((t) => t.routeId)).toEqual([
      'project.requests',
      'project.performance',
    ]);
    for (const target of data?.actionTargets ?? []) {
      expect(target.pathParams?.organizationId).toBe(owner.organizationId);
      expect(target.pathParams?.projectId).toBe(projectId);
    }

    const meta = (body as DataStatusBody).meta;
    expect(meta?.requestId).toBeDefined();
    expect(meta?.readAt).toBe(FIXED_NOW.toISOString());
    expect(meta?.normalizedQuery?.timeRange).toBe(`${WINDOW.start}..${WINDOW.end}`);

    const allowed = (body as DataStatusBody).allowedActions ?? [];
    expect(allowed).toContain('read');
    const targets = (body as DataStatusBody).navigationTargets ?? [];
    expect(targets[0]?.routeId).toBe('project.data-status');
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
    await insertCredential(pool, projectId);
    await insertInboxEvent(pool, projectId, 'member-p1', '2026-08-10T09:00:00.000Z', 'pending');
    const granted = await insertProjectMember(pool, {
      orgId: owner.organizationId,
      projectId,
      accountId: member.accountId,
      role: 'developer',
    });
    expect(granted.status).toBe('success');

    const { status, body } = await getDataStatus(
      app,
      member,
      owner.organizationId,
      projectId,
      windowQuery(WINDOW.start, WINDOW.end),
    );
    expect(status).toBe(200);
    const data = (body as DataStatusBody).data;
    expect(data?.summary?.data?.status).toBe('processing');
    expect(data?.stages?.data?.processing?.count).toBe(1);
    expect((body as DataStatusBody).allowedActions).toEqual(['read']);
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
    await insertCredential(pool, projectId);
    await insertInboxEvent(pool, projectId, 'forbidden-p1', '2026-08-10T09:00:00.000Z', 'pending');

    const { status, body } = await getDataStatus(
      app,
      outsider,
      owner.organizationId,
      projectId,
      windowQuery(WINDOW.start, WINDOW.end),
    );
    expect(status).toBe(403);
    expect((body as ProblemBody).code).toBe('authorization');
    // The repositories were never queried: only closed error fields, no data.
    const raw = JSON.stringify(body);
    expect(raw).not.toContain('"data"');
    expect(raw).not.toContain('summary');
    expect(raw).not.toContain('stages');
    await app.close();
  });

  it('a project belonging to a different org is a closed 404 (even for an org manager)', async () => {
    const app = buildApp();
    const ownerA = await registerActor(app, `ownerA-${randomUUID()}@example.com`);
    const projectId = await createProjectFor(pool, ownerA);
    await insertCredential(pool, projectId);
    await insertInboxEvent(pool, projectId, 'cross-p1', '2026-08-10T09:00:00.000Z', 'pending');
    // ownerB is an org manager of org B — they must NOT read org A's project.
    const ownerB = await registerActor(app, `ownerB-${randomUUID()}@example.com`);

    const { status, body } = await getDataStatus(
      app,
      ownerB,
      ownerB.organizationId,
      projectId,
      windowQuery(WINDOW.start, WINDOW.end),
    );
    expect(status).toBe(404);
    expect((body as ProblemBody).code).toBe('not_found');
    const raw = JSON.stringify(body);
    expect(raw).not.toContain(SEED_ORIGIN);
    await app.close();
  });

  it('an empty project reports not_receiving/no_credential with empty stages/credential and honest zero queryable counts', async () => {
    const app = buildApp();
    const owner = await registerActor(app, `owner-${randomUUID()}@example.com`);
    const projectId = await createProjectFor(pool, owner); // no data seeded

    const { status, body } = await getDataStatus(
      app,
      owner,
      owner.organizationId,
      projectId,
      windowQuery(WINDOW.start, WINDOW.end),
    );
    expect(status).toBe(200);
    const data = (body as DataStatusBody).data;
    expect(data?.summary?.data?.status).toBe('not_receiving');
    expect(data?.summary?.data?.primaryCause).toBe('no_credential');
    expect(data?.stages).toEqual({ status: 'empty', reason: 'no inbox rows in window' });
    expect(data?.recent).toEqual({ status: 'empty', reason: 'no inbox rows in window' });
    expect(data?.credential).toEqual({
      status: 'empty',
      reason: 'no client reporting credentials',
    });
    // Queryable evidence is honest real row counts: a truly empty project is
    // available with factual zeros, not forged as absent.
    expect(data?.queryable?.status).toBe('available');
    expect(data?.queryable?.data?.errorOccurrences).toBe(0);
    expect(data?.queryable?.data?.requestMetricBuckets).toBe(0);
    expect(data?.queryable?.data?.performanceMetricBuckets).toBe(0);
    expect(data?.actionTargets?.map((t) => t.routeId)).toEqual(['project.onboarding']);
    await app.close();
  });

  it('credentials with no events in the window report not_receiving/no_received_events', async () => {
    const app = buildApp();
    const owner = await registerActor(app, `owner-${randomUUID()}@example.com`);
    const projectId = await createProjectFor(pool, owner);
    await insertCredential(pool, projectId);
    // The only inbox event lands OUTSIDE the queried window (before start).
    await insertInboxEvent(pool, projectId, 'old-p1', '2026-08-10T06:00:00.000Z', 'processed', {
      processedAt: '2026-08-10T06:01:00.000Z',
    });

    const { status, body } = await getDataStatus(
      app,
      owner,
      owner.organizationId,
      projectId,
      windowQuery(WINDOW.start, WINDOW.end),
    );
    expect(status).toBe(200);
    const data = (body as DataStatusBody).data;
    expect(data?.summary?.data?.status).toBe('not_receiving');
    expect(data?.summary?.data?.primaryCause).toBe('no_received_events');
    // Credentials exist (activeCount 1) but the window has no inbox rows.
    expect(data?.credential?.data?.activeCount).toBe(1);
    expect(data?.stages?.status).toBe('empty');
    expect(data?.actionTargets?.map((t) => t.routeId)).toEqual(['project.onboarding']);
    await app.close();
  });

  it('all credentials disabled reports blocked/credential_inactive with a project.client-keys target', async () => {
    const app = buildApp();
    const owner = await registerActor(app, `owner-${randomUUID()}@example.com`);
    const projectId = await createProjectFor(pool, owner);
    await insertCredential(pool, projectId, 'disabled');
    await insertCredential(pool, projectId, 'disabled');
    await insertInboxEvent(pool, projectId, 'blocked-p1', '2026-08-10T09:00:00.000Z', 'pending');

    const { status, body } = await getDataStatus(
      app,
      owner,
      owner.organizationId,
      projectId,
      windowQuery(WINDOW.start, WINDOW.end),
    );
    expect(status).toBe(200);
    const data = (body as DataStatusBody).data;
    expect(data?.summary?.data?.status).toBe('blocked');
    expect(data?.summary?.data?.primaryCause).toBe('credential_inactive');
    expect(data?.credential?.data?.activeCount).toBe(0);
    expect(data?.credential?.data?.disabledCount).toBe(2);
    expect(data?.actionTargets?.map((t) => t.routeId)).toContain('project.client-keys');
    await app.close();
  });

  it('a dead-lettered row exposes the deadLetter count + stable lastErrorCode', async () => {
    const app = buildApp();
    const owner = await registerActor(app, `owner-${randomUUID()}@example.com`);
    const projectId = await createProjectFor(pool, owner);
    await insertCredential(pool, projectId);
    await insertInboxEvent(pool, projectId, 'dl-o1', '2026-08-10T09:10:00.000Z', 'processed', {
      processedAt: '2026-08-10T09:12:00.000Z',
    });
    await insertInboxEvent(pool, projectId, 'dl-d1', '2026-08-10T09:20:00.000Z', 'dead_lettered', {
      deadLetteredAt: '2026-08-10T09:21:00.000Z',
      lastErrorCode: 'retry_budget_exhausted',
    });

    const { status, body } = await getDataStatus(
      app,
      owner,
      owner.organizationId,
      projectId,
      windowQuery(WINDOW.start, WINDOW.end),
    );
    expect(status).toBe(200);
    const data = (body as DataStatusBody).data;
    // processedCount > 0 and processingCount === 0 → receiving (no primaryCause).
    expect(data?.summary?.data?.status).toBe('receiving');
    expect(data?.summary?.data?.primaryCause).toBeUndefined();
    expect(data?.stages?.data?.deadLetter).toEqual({
      count: 1,
      latestAt: '2026-08-10T09:21:00.000Z',
      lastErrorCode: 'retry_budget_exhausted',
    });
    await app.close();
  });

  it('only dead-lettered rows (with active credentials) fall through to unknown', async () => {
    const app = buildApp();
    const owner = await registerActor(app, `owner-${randomUUID()}@example.com`);
    const projectId = await createProjectFor(pool, owner);
    await insertCredential(pool, projectId);
    await insertInboxEvent(pool, projectId, 'unk-d1', '2026-08-10T09:20:00.000Z', 'dead_lettered', {
      deadLetteredAt: '2026-08-10T09:21:00.000Z',
      lastErrorCode: 'capacity_protected',
    });

    const { status, body } = await getDataStatus(
      app,
      owner,
      owner.organizationId,
      projectId,
      windowQuery(WINDOW.start, WINDOW.end),
    );
    expect(status).toBe(200);
    const data = (body as DataStatusBody).data;
    expect(data?.summary?.data?.status).toBe('unknown');
    expect(data?.summary?.data?.primaryCause).toBeUndefined();
    expect(data?.actionTargets).toEqual([]);
    await app.close();
  });

  it('omitting timeRange applies the default last-24h window', async () => {
    const app = buildApp();
    const owner = await registerActor(app, `owner-${randomUUID()}@example.com`);
    const projectId = await createProjectFor(pool, owner);
    await insertCredential(pool, projectId);
    // 09:00 is within the default window [12:00-24h, 12:00].
    await insertInboxEvent(pool, projectId, 'def-p1', '2026-08-10T09:00:00.000Z', 'pending');

    const { status, body } = await getDataStatus(app, owner, owner.organizationId, projectId);
    expect(status).toBe(200);
    const data = (body as DataStatusBody).data;
    expect(data?.summary?.data?.status).toBe('processing');
    expect(data?.stages?.data?.received?.count).toBe(1);
    expect(data?.stages?.data?.processing?.count).toBe(1);
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
      // end beyond the ~5 min clock-skew allowance.
      windowQuery('2026-08-10T08:00:00.000Z', '2026-08-10T12:10:00.000Z'),
    ];
    for (const query of badRanges) {
      const response = await app.inject({
        method: 'GET',
        url: `/api/platform/v1/organizations/${owner.organizationId}/projects/${projectId}/data-status?${query}`,
        headers: { cookie: `aurora_session=${owner.cookie}` },
      });
      expect(response.statusCode).toBe(400);
      const body: ProblemBody = response.json();
      expect(body.code).toBe('structural_error');
    }
    await app.close();
  });

  it('privacy: the response never leaks envelope/ids/secrets/origins/environments or lease internals', async () => {
    const app = buildApp();
    const owner = await registerActor(app, `owner-${randomUUID()}@example.com`);
    const projectId = await createProjectFor(pool, owner);
    const { clientKey } = await insertCredential(pool, projectId);
    await insertInboxEvent(pool, projectId, 'priv-p1', '2026-08-10T09:00:00.000Z', 'pending');
    await seedQueryableEvidence(pool, projectId);

    const { status, body } = await getDataStatus(
      app,
      owner,
      owner.organizationId,
      projectId,
      windowQuery(WINDOW.start, WINDOW.end),
    );
    expect(status).toBe(200);
    const raw = JSON.stringify(body);
    for (const forbidden of [
      'envelope',
      'request_id',
      'batch_id',
      'key_id',
      'secret',
      'secret_digest',
      'origin',
      'digest',
      'lease',
    ]) {
      expect(raw).not.toContain(forbidden);
    }
    // The seeded origin/environment VALUES and the full client key never leak.
    // (The contract field `environmentBreakdown` and its deferred reason text
    // legitimately contain the word "environment", so the VALUE is what matters.)
    expect(raw).not.toContain(SEED_ORIGIN);
    expect(raw).not.toContain(SEED_ENVIRONMENT);
    expect(raw).not.toContain(clientKey);
    await app.close();
  });
});
