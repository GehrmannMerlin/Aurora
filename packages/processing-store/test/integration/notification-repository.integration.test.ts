import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  markNotificationRead,
  persistNotification,
  queryNotifications,
  queryUnreadCount,
} from '../../src/notification-repository.js';
import { assertIsTestDatabase, createTestPool, testDatabaseUrl } from './helpers.js';

const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const describeDb = hasDb ? describe : describe.skip;

const ACCOUNT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORG = '11111111-1111-4111-8111-111111111111';
const PROJECT = '22222222-2222-4222-8222-222222222222';
const OTHER_ACCOUNT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

let pool: Pool;

describeDb('notification repository (real PostgreSQL)', () => {
  beforeAll(async () => {
    const url = testDatabaseUrl();
    assertIsTestDatabase(url);
    pool = createTestPool();
    // The `notifications` migration is exercised by the CI migrate gate; this
    // test creates the table directly to avoid node-pg-migrate cross-package
    // pgmigrations ordering when a new migration is added mid-suite.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        notification_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        account_id uuid NOT NULL,
        organization_id uuid,
        project_id uuid,
        type varchar(32) NOT NULL,
        business_key varchar(256) NOT NULL,
        title varchar(256) NOT NULL,
        summary varchar(1024),
        target jsonb NOT NULL,
        read_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await pool.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_account_business ON notifications(account_id, business_key, type)',
    );
  });

  afterAll(async () => {
    await pool.query('TRUNCATE notifications');
    await pool.end();
  });

  it('persists and deduplicates by (account, business_key, type)', async () => {
    const first = await persistNotification(pool, {
      accountId: ACCOUNT,
      type: 'alert_triggered',
      businessKey: 'alert:1',
      organizationId: ORG,
      projectId: PROJECT,
      title: '错误数量过高 已触发',
      target: { routeId: 'project.alert-instance-detail', pathParams: { organizationId: ORG, projectId: PROJECT, instanceId: '1' }, query: {} },
    });
    expect(first.status).toBe('inserted');

    const dup = await persistNotification(pool, {
      accountId: ACCOUNT,
      type: 'alert_triggered',
      businessKey: 'alert:1',
      organizationId: ORG,
      projectId: PROJECT,
      title: '错误数量过高 已触发',
      target: { routeId: 'project.alert-instance-detail', pathParams: { organizationId: ORG, projectId: PROJECT, instanceId: '1' }, query: {} },
    });
    expect(dup.status).toBe('existing');
    expect(dup.notificationId).toBe(first.status === 'inserted' ? first.notificationId : dup.notificationId);
  });

  it('queries account-scoped notifications with read-state filter and unread count', async () => {
    await persistNotification(pool, {
      accountId: ACCOUNT,
      type: 'new_issue',
      businessKey: 'issue:10',
      projectId: PROJECT,
      title: '新问题',
      target: { routeId: 'project.issue-detail', pathParams: { organizationId: ORG, projectId: PROJECT, issueId: '10' }, query: {} },
    });
    const all = await queryNotifications(pool, { accountId: ACCOUNT, readState: 'all' });
    expect(all.items.length).toBeGreaterThanOrEqual(2);
    expect(all.items.every((item) => item.accountId === ACCOUNT)).toBe(true);

    const unread = await queryNotifications(pool, { accountId: ACCOUNT, readState: 'unread' });
    const unreadCount = await queryUnreadCount(pool, { accountId: ACCOUNT });
    expect(unread.items.length).toBe(unreadCount);
  });

  it('mark read is account-scoped, idempotent, and returns not_found for foreign rows', async () => {
    await persistNotification(pool, {
      accountId: ACCOUNT,
      type: 'issue_assigned_to_me',
      businessKey: 'assignment:11',
      projectId: PROJECT,
      title: '分配给我',
      target: { routeId: 'project.issue-detail', pathParams: { organizationId: ORG, projectId: PROJECT, issueId: '11' }, query: {} },
    });
    const page = await queryNotifications(pool, { accountId: ACCOUNT, readState: 'unread' });
    const target = page.items.find((item) => item.type === 'issue_assigned_to_me');
    expect(target).toBeDefined();
    if (target === undefined) return;

    const marked = await markNotificationRead(pool, { accountId: ACCOUNT, notificationId: target.notificationId });
    expect(marked.status).toBe('read');
    const again = await markNotificationRead(pool, { accountId: ACCOUNT, notificationId: target.notificationId });
    expect(again.status).toBe('read');

    const foreign = await markNotificationRead(pool, { accountId: OTHER_ACCOUNT, notificationId: target.notificationId });
    expect(foreign.status).toBe('not_found');
  });
});
