import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { FastifyInstance } from 'fastify';
import { persistNotification, type NotificationType } from '@aurora/processing-store';
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

interface NotificationItem {
  notificationId: string;
  type: string;
  title: string;
}

describeDb('PLT-09 notifications API (real PostgreSQL 17 + Redis)', () => {
  let pool: Pool;
  let sessionStore: SessionStore;
  let keyPrefix: string;

  beforeAll(async () => {
    assertIsTestDatabase(testDatabaseUrl());
    pool = createTestPool();
    await runAllMigrations();
    await truncateIdentityTables(pool);
    await pool.query('TRUNCATE notifications CASCADE');
    keyPrefix = `test:notifications-api:${randomUUID()}`;
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

  async function getNotifications(
    app: FastifyInstance,
    actor: RegisteredActor,
    query: string,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await app.inject({
      method: 'GET',
      url: `/api/platform/v1/notifications${query}`,
      headers: { cookie: `aurora_session=${actor.cookie}` },
    });
    return { status: res.statusCode, body: res.json() };
  }

  async function postMarkRead(
    app: FastifyInstance,
    actor: RegisteredActor,
    notificationId: string,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await app.inject({
      method: 'POST',
      url: `/api/platform/v1/notifications/${notificationId}/read`,
      headers: {
        cookie: `aurora_session=${actor.cookie}`,
        'content-type': 'application/json',
        'x-aurora-csrf': actor.csrf,
      },
      payload: JSON.stringify({ idempotencyKey: `mark-${randomUUID()}` }),
    });
    return { status: res.statusCode, body: res.json() };
  }

  async function seedFor(actor: RegisteredActor, projectId: string, type: NotificationType, key: string) {
    const result = await persistNotification(pool, {
      accountId: actor.accountId,
      type,
      businessKey: key,
      organizationId: actor.organizationId,
      projectId,
      title: type === 'new_issue' ? '新问题出现' : '告警已触发',
      target: {
        routeId: 'project.issue-detail',
        pathParams: {
          organizationId: actor.organizationId,
          projectId,
          issueId: '7',
        },
        query: {},
      },
    });
    if (result.status !== 'inserted') throw new Error('notification seed failed');
    return result.notificationId;
  }

  it('lists with unread count, filters unread, marks read, and isolates accounts', async () => {
    const app = buildApp();
    const alice = await registerVerifiedActor(app, pool, `alice-${randomUUID()}@example.com`);
    const bob = await registerVerifiedActor(app, pool, `bob-${randomUUID()}@example.com`);
    const projectId = randomUUID();

    const issueNotif = await seedFor(alice, projectId, 'new_issue', `issue:${randomUUID()}`);
    const alertNotif = await seedFor(alice, projectId, 'alert_triggered', `alert:${randomUUID()}`);

    // List as Alice: 2 items + unread count 2 (account-scoped, no org path).
    const list = await getNotifications(app, alice, '');
    expect(list.status).toBe(200);
    const listData = list.body.data as {
      notifications: { items: NotificationItem[]; pagination: { totalCount: number } };
      unreadCount: { value: number; status: string };
    };
    expect(listData.notifications.items).toHaveLength(2);
    expect(listData.notifications.pagination.totalCount).toBe(2);
    expect(listData.unreadCount).toEqual({ value: 2, status: 'available' });
    expect(listData.notifications.items.map((i) => i.notificationId).sort()).toEqual(
      [issueNotif, alertNotif].sort(),
    );

    // Unread filter returns only unread rows.
    const unread = await getNotifications(app, alice, '?readState=unread');
    expect(unread.status).toBe(200);
    const unreadData = unread.body.data as { notifications: { items: NotificationItem[] } };
    expect(unreadData.notifications.items).toHaveLength(2);

    // Mark the issue notification read (idempotent + CSRF-protected).
    const marked = await postMarkRead(app, alice, issueNotif);
    expect(marked.status).toBe(200);
    expect((marked.body.data as { status: string; notificationId: string }).status).toBe('read');

    const afterRead = await getNotifications(app, alice, '');
    const afterReadData = afterRead.body.data as { unreadCount: { value: number } };
    expect(afterReadData.unreadCount.value).toBe(1);
    const unreadAfter = await getNotifications(app, alice, '?readState=unread');
    const unreadAfterData = unreadAfter.body.data as { notifications: { items: NotificationItem[] } };
    expect(unreadAfterData.notifications.items.map((i) => i.notificationId)).toEqual([alertNotif]);

    // Idempotent re-mark still succeeds (mark read is idempotent).
    const again = await postMarkRead(app, alice, issueNotif);
    expect(again.status).toBe(200);

    // Bob sees only his own (empty here) — never Alice's rows.
    const bobList = await getNotifications(app, bob, '');
    expect(bobList.status).toBe(200);
    const bobData = bobList.body.data as { notifications: { items: NotificationItem[] } };
    expect(bobData.notifications.items).toHaveLength(0);

    // Bob cannot mark Alice's notification read (account isolation → 404).
    const bobRead = await postMarkRead(app, bob, alertNotif);
    expect(bobRead.status).toBe(404);

    await app.close();
  });
});
