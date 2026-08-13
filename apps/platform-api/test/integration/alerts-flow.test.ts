import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { FastifyInstance } from 'fastify';
import { createProject, insertProjectMember } from '@aurora/platform-project-governance';
import { RequestMethod, RequestOutcome } from '@aurora/event-schema';
import {
  persistRequestMetricContribution,
  runAlertEvaluationRound,
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
import { registerVerifiedActor, type RegisteredActor } from './flow-helpers.js';

const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const hasRedis = process.env.AURORA_TEST_REDIS_URL !== undefined;
const describeDb = hasDb && hasRedis ? describe : describe.skip;

const FIXED_NOW = new Date('2026-08-10T12:00:00.000Z');
const MINUTE = 60_000;

async function createProjectFor(pool: Pool, owner: RegisteredActor): Promise<string> {
  const created = await createProject(pool, {
    orgId: owner.organizationId,
    name: `Alerts ${randomUUID().slice(0, 8)}`,
    frameworkType: 'react',
    createdBy: owner.accountId,
  });
  return created.projectId;
}

/** Seed one request metric contribution that lands in the minute bucket of `occurredAt`. */
async function seedRequestBucket(
  pool: Pool,
  projectId: string,
  occurredAtMs: number,
  failures: number,
  observed: number,
): Promise<void> {
  const result = await persistRequestMetricContribution(pool, {
    projectId,
    eventId: `alerts-seed-${randomUUID()}`,
    occurredAt: occurredAtMs,
    method: RequestMethod.Get,
    outcome: RequestOutcome.HttpError,
    statusCode: 500,
    durationMs: 42,
    isFailure: true,
    isSlow: false,
  });
  expect(result.status).toBe('applied');
  // Above only inserts one bucket row with failure_count 1 — instead scale by
  // inserting the requested failure/observed counts as distinct rows.
  for (let i = 1; i < observed; i += 1) {
    const r = await persistRequestMetricContribution(pool, {
      projectId,
      eventId: `alerts-seed-${randomUUID()}`,
      occurredAt: occurredAtMs,
      method: RequestMethod.Get,
      outcome: i < failures ? RequestOutcome.HttpError : RequestOutcome.Success,
      statusCode: i < failures ? 500 : 200,
      durationMs: 42,
      isFailure: i < failures,
      isSlow: false,
    });
    expect(r.status).toBe('applied');
  }
}

function alertRuleBody(owner: RegisteredActor): Record<string, unknown> {
  return {
    metric: 'request_failure_rate',
    filters: { environment: [], release: [], pageOrEndpoint: [], errorSeverity: [] },
    windowMinutes: 5,
    triggerThreshold: 50,
    triggerDurationMinutes: 1,
    recoveryThreshold: 10,
    recoveryDurationMinutes: 1,
    minSampleCount: 50,
    cooldownMinutes: 10,
    recipientAccountIds: [owner.accountId],
    idempotencyKey: `rule-${randomUUID().slice(0, 20)}`,
  };
}

describeDb('DAT-19 alert evaluation flow (real PostgreSQL 17 + Redis)', () => {
  let pool: Pool;
  let sessionStore: SessionStore;
  let keyPrefix: string;

  beforeAll(async () => {
    assertIsTestDatabase(testDatabaseUrl());
    pool = createTestPool();
    await runAllMigrations();
    await truncateIdentityTables(pool);
    await pool.query(
      `TRUNCATE alert_instance_transitions, alert_instance_evidence, alert_instances,
        alert_rules, issue_notes, issue_activities, issue_samples,
        issue_event_applications, issues, request_metric_buckets,
        request_metric_event_applications, request_event_samples,
        error_event_occurrences, performance_metric_buckets,
        performance_metric_event_applications, performance_event_samples CASCADE`,
    );
    keyPrefix = `test:alerts-flow:${randomUUID()}`;
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

  async function postAlert(
    app: FastifyInstance,
    actor: RegisteredActor,
    organizationId: string,
    projectId: string,
    path: string,
    body: Record<string, unknown>,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await app.inject({
      method: 'POST',
      url: `/api/platform/v1/organizations/${organizationId}/projects/${projectId}/alerts${path}`,
      headers: {
        cookie: `aurora_session=${actor.cookie}`,
        'content-type': 'application/json',
        'x-aurora-csrf': actor.csrf,
      },
      payload: JSON.stringify(body),
    });
    return { status: res.statusCode, body: res.json() };
  }

  async function getAlerts(
    app: FastifyInstance,
    actor: RegisteredActor,
    organizationId: string,
    projectId: string,
    path: string,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await app.inject({
      method: 'GET',
      url: `/api/platform/v1/organizations/${organizationId}/projects/${projectId}/alerts${path}`,
      headers: { cookie: `aurora_session=${actor.cookie}` },
    });
    return { status: res.statusCode, body: res.json() };
  }

  it('create rule → evaluate → instance/evidence → recover via the API + evaluation round', async () => {
    const app = buildApp();
    const owner = await registerVerifiedActor(app, pool, `owner-${randomUUID()}@example.com`);
    const projectId = await createProjectFor(pool, owner);

    // Capability contract is reachable with real recipient members.
    const capability = await getAlerts(app, owner, owner.organizationId, projectId, '/capability');
    expect(capability.status).toBe(200);
    const capData = capability.body.data as {
      metrics: readonly { metric: string }[];
      recipients: readonly { accountId: string }[];
    };
    expect(capData.metrics).toHaveLength(8);
    expect(capData.recipients.map((r) => r.accountId)).toContain(owner.accountId);

    // Create rule.
    const create = await postAlert(
      app,
      owner,
      owner.organizationId,
      projectId,
      '/rules',
      alertRuleBody(owner),
    );
    expect(create.status).toBe(200);
    const ruleId = (create.body.data as { ruleId?: string }).ruleId ?? '';

    // High failure rate in the window → first round pending_trigger, second round triggered.
    await seedRequestBucket(pool, projectId, FIXED_NOW.getTime() - 3 * MINUTE, 60, 100);
    let round = await runAlertEvaluationRound({
      pool,
      now: new Date(FIXED_NOW.getTime()),
      maxRules: 100,
    });
    expect(round.failedRules).toBe(0);
    round = await runAlertEvaluationRound({
      pool,
      now: new Date(FIXED_NOW.getTime() + 2 * MINUTE),
      maxRules: 100,
    });
    expect(round.createdInstances).toBe(1);

    const list = await getAlerts(app, owner, owner.organizationId, projectId, '');
    expect(list.status).toBe(200);
    const listData = list.body.data as {
      rules: {
        status: string;
        data?: { items: readonly { ruleId: string; evaluation: { state: string } }[] };
      };
      instances: {
        status: string;
        data?: {
          items: readonly { instanceId: string; state: string }[];
          count: number;
          totalCountStatus: string;
        };
      };
    };
    expect(listData.rules.status).toBe('available');
    const ruleSummary = listData.rules.data?.items.find((r) => r.ruleId === ruleId);
    expect(ruleSummary?.evaluation.state).toBe('triggered');
    expect(listData.instances.status).toBe('available');
    expect(listData.instances.data?.count).toBe(1);
    const instanceId = listData.instances.data?.items[0]?.instanceId ?? '';

    // Instance detail carries the evidence that drove the trigger.
    const detail = await getAlerts(
      app,
      owner,
      owner.organizationId,
      projectId,
      `/instances/${instanceId}`,
    );
    expect(detail.status).toBe(200);
    const detailData = detail.body.data as {
      instance: { state: string; directReason: string };
      evidence: {
        observedValue: number;
        numerator: number;
        denominator: number;
        minSampleRequirement: number;
        completeness: string;
      };
      transitions: readonly { from: string; to: string; reason: string }[];
      ruleSnapshot: { metric: string };
    };
    expect(detailData.instance.state).toBe('triggered');
    expect(detailData.evidence.observedValue).toBe(60);
    expect(detailData.evidence.numerator).toBe(60);
    expect(detailData.evidence.denominator).toBe(100);
    expect(detailData.evidence.minSampleRequirement).toBe(50);
    expect(detailData.evidence.completeness).toBe('complete');
    expect(detailData.transitions.map((t) => t.to)).toContain('triggered');
    expect(detailData.ruleSnapshot.metric).toBe('request_failure_rate');

    // Low failure rate in later windows → pending_recovery then recovered.
    await seedRequestBucket(pool, projectId, FIXED_NOW.getTime() + 39 * MINUTE, 5, 100);
    round = await runAlertEvaluationRound({
      pool,
      now: new Date(FIXED_NOW.getTime() + 40 * MINUTE),
      maxRules: 100,
    });
    expect(round.recoveredInstances).toBe(0);
    await seedRequestBucket(pool, projectId, FIXED_NOW.getTime() + 41 * MINUTE, 2, 100);
    round = await runAlertEvaluationRound({
      pool,
      now: new Date(FIXED_NOW.getTime() + 42 * MINUTE),
      maxRules: 100,
    });
    expect(round.recoveredInstances).toBe(1);

    const recovered = await getAlerts(
      app,
      owner,
      owner.organizationId,
      projectId,
      `/instances/${instanceId}`,
    );
    const recoveredData = recovered.body.data as {
      instance: { state: string; recoveredAt?: string };
      transitions: readonly { to: string }[];
    };
    expect(recoveredData.instance.state).toBe('recovered');
    expect(typeof recoveredData.instance.recoveredAt).toBe('string');
    expect(recoveredData.transitions.map((t) => t.to)).toContain('recovered');
  });

  it('rejects non-admin rule creation, filtered rules, and cross-project detail', async () => {
    const app = buildApp();
    const owner = await registerVerifiedActor(app, pool, `owner2-${randomUUID()}@example.com`);
    const projectId = await createProjectFor(pool, owner);
    const developer = await registerVerifiedActor(app, pool, `dev-${randomUUID()}@example.com`);
    await insertProjectMember(pool, {
      orgId: owner.organizationId,
      projectId,
      accountId: developer.accountId,
      role: 'developer',
    });

    // Developer (not project_admin) cannot create an alert rule.
    const forbidden = await postAlert(
      app,
      developer,
      owner.organizationId,
      projectId,
      '/rules',
      alertRuleBody(owner),
    );
    expect(forbidden.status).toBe(403);

    // A rule declaring a filter has no valid data range (PRD §11.2.8) → 422.
    const filtered = alertRuleBody(owner);
    (filtered.filters as Record<string, unknown>).environment = ['production'];
    const invalid = await postAlert(
      app,
      owner,
      owner.organizationId,
      projectId,
      '/rules',
      filtered,
    );
    expect(invalid.status).toBe(422);

    // Valid create writes an audit row.
    const created = await postAlert(
      app,
      owner,
      owner.organizationId,
      projectId,
      '/rules',
      alertRuleBody(owner),
    );
    expect(created.status).toBe(200);
    const audit = await pool.query<{ action: string }>(
      `SELECT action FROM security_audit_events WHERE organization_id = $1 AND action = 'alert.rule_created'`,
      [owner.organizationId],
    );
    expect(audit.rows.length).toBe(1);

    // Cross-project / unknown instance id is a closed 404 (no existence leak).
    const otherProject = await createProjectFor(pool, owner);
    const missing = await getAlerts(
      app,
      owner,
      owner.organizationId,
      otherProject,
      '/instances/999999',
    );
    expect(missing.status).toBe(404);
  });
});
