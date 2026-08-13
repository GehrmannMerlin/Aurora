import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { FastifyInstance } from 'fastify';
import { createProject } from '@aurora/platform-project-governance';
import { RequestMethod, RequestOutcome } from '@aurora/event-schema';
import {
  createAlertRule,
  persistAlertRoundNotifications,
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
    name: `AlertNotif ${randomUUID().slice(0, 8)}`,
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
  for (let i = 0; i < observed; i += 1) {
    const result = await persistRequestMetricContribution(pool, {
      projectId,
      eventId: `alert-notif-seed-${randomUUID()}`,
      occurredAt: occurredAtMs,
      method: RequestMethod.Get,
      outcome: i < failures ? RequestOutcome.HttpError : RequestOutcome.Success,
      statusCode: i < failures ? 500 : 200,
      durationMs: 42,
      isFailure: i < failures,
      isSlow: false,
    });
    expect(result.status).toBe('applied');
  }
}

describeDb('PLT-09 alert trigger notifications (real PostgreSQL 17 + Redis)', () => {
  let pool: Pool;
  let sessionStore: SessionStore;
  let keyPrefix: string;

  beforeAll(async () => {
    assertIsTestDatabase(testDatabaseUrl());
    pool = createTestPool();
    await runAllMigrations();
    await truncateIdentityTables(pool);
    await pool.query(
      `TRUNCATE notifications, alert_instance_transitions, alert_instance_evidence,
        alert_instances, alert_rules, request_metric_buckets,
        request_metric_event_applications, request_event_samples,
        error_event_occurrences, performance_metric_buckets,
        performance_metric_event_applications, performance_event_samples CASCADE`,
    );
    keyPrefix = `test:alert-notification:${randomUUID()}`;
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

  it('alert trigger then recovery append account-scoped notifications (deduped)', async () => {
    const app = buildApp();
    const owner = await registerVerifiedActor(app, pool, `owner-${randomUUID()}@example.com`);
    const projectId = await createProjectFor(pool, owner);

    const rule = await createAlertRule(pool, {
      projectId,
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
    });
    expect(rule.status).toBe('inserted');

    // High failure rate in the window → first round pending_trigger, second
    // round triggered with a first_trigger notification decision.
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
    expect(round.notifications).toHaveLength(1);
    const triggered = round.notifications[0];
    if (triggered === undefined) throw new Error('expected an alert_triggered decision');
    expect(triggered.type).toBe('alert_triggered');
    expect(triggered.projectId).toBe(projectId);
    expect(triggered.recipientAccountIds).toEqual([owner.accountId]);

    await persistAlertRoundNotifications(pool, { notifications: round.notifications });
    const triggeredRows = await pool.query<{
      business_key: string;
      organization_id: string;
      project_id: string;
      target: { routeId: string; pathParams: Record<string, string> };
    }>(
      `SELECT business_key, organization_id, project_id, target
         FROM notifications WHERE account_id = $1 AND type = $2`,
      [owner.accountId, 'alert_triggered'],
    );
    expect(triggeredRows.rows).toHaveLength(1);
    const triggeredRow = triggeredRows.rows[0];
    if (triggeredRow === undefined) throw new Error('missing triggered notification row');
    expect(triggeredRow.business_key).toBe(`alert:${triggered.instanceId}`);
    expect(triggeredRow.organization_id).toBe(owner.organizationId);
    expect(triggeredRow.project_id).toBe(projectId);
    expect(triggeredRow.target.routeId).toBe('project.alert-instance-detail');
    expect(triggeredRow.target.pathParams.organizationId).toBe(owner.organizationId);

    // Re-running the same decision never duplicates (business_key dedupe).
    await persistAlertRoundNotifications(pool, { notifications: round.notifications });
    const triggeredCount = await pool.query<{ n: string }>(
      `SELECT count(*)::bigint AS n FROM notifications
         WHERE account_id = $1 AND type = $2`,
      [owner.accountId, 'alert_triggered'],
    );
    expect(Number(triggeredCount.rows[0]?.n ?? 0)).toBe(1);

    // Low failure rate in later windows → pending_recovery then recovered with
    // an alert_recovered notification decision.
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
    const recovered = round.notifications.find((n) => n.type === 'alert_recovered');
    expect(recovered).toBeDefined();
    if (recovered === undefined) return;

    await persistAlertRoundNotifications(pool, { notifications: round.notifications });
    const recoveredRows = await pool.query<{ business_key: string }>(
      `SELECT business_key FROM notifications
         WHERE account_id = $1 AND type = $2`,
      [owner.accountId, 'alert_recovered'],
    );
    expect(recoveredRows.rows).toHaveLength(1);
    expect(recoveredRows.rows[0]?.business_key).toBe(`alert:${recovered.instanceId}`);

    await app.close();
  });
});
