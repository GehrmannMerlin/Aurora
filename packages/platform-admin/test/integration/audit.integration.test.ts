import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  insertPlatformAuditEvent,
  queryPlatformAuditEvents,
  type PlatformAuditAction,
} from '../../src/index.js';

const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const describeDb = hasDb ? describe : describe.skip;

const migrationsDir = fileURLToPath(new URL('../../migrations', import.meta.url));

function testDatabaseUrl(): string {
  const url = process.env.AURORA_TEST_DATABASE_URL;
  if (url === undefined) {
    throw new Error('AURORA_TEST_DATABASE_URL must be set for integration tests');
  }
  return url;
}

/** Verify the target database is the dedicated Aurora test database. */
function assertIsTestDatabase(url: string): void {
  const parsed = new URL(url);
  if (!parsed.pathname.startsWith('/aurora_inbox_test')) {
    throw new Error(`refusing to connect to non-test database: ${parsed.pathname}`);
  }
}

async function runMigrationsUp(): Promise<void> {
  await runner({
    databaseUrl: testDatabaseUrl(),
    dir: migrationsDir,
    direction: 'up',
    migrationsTable: 'pgmigrations',
    count: Infinity,
    log: () => undefined,
    checkOrder: false,
  });
}

describeDb('platform-admin audit repository (real PostgreSQL 17)', () => {
  let pool: Pool | undefined;
  const createdAccountIds: string[] = [];

  beforeAll(async () => {
    assertIsTestDatabase(testDatabaseUrl());
    pool = new Pool({ connectionString: testDatabaseUrl() });
    await runMigrationsUp();
    // Hermetic start: this package shares one test database with every other
    // suite (apps/platform-api flow suites, other data packages). Leftover
    // platform_audit_events rows from a prior suite would break the global
    // keyset pagination/ordering assertions, so truncate both platform tables
    // at start. Same start-of-suite truncate pattern as apps/platform-api
    // test/integration/helpers.ts truncateIdentityTables.
    await pool.query('TRUNCATE platform_admins, platform_audit_events CASCADE');
  });

  afterAll(async () => {
    if (pool !== undefined) {
      // Remove only rows this suite created, in FK-safe order. The shared test
      // database keeps rows from other packages; never drop tables here.
      await pool.query('DELETE FROM platform_audit_events WHERE actor_account_id = ANY($1)', [
        createdAccountIds,
      ]);
      await pool.query('DELETE FROM accounts WHERE account_id = ANY($1)', [createdAccountIds]);
      await pool.end();
    }
  });

  function db(): Pool {
    if (pool === undefined) throw new Error('pool not initialized');
    return pool;
  }

  async function createAccount(): Promise<string> {
    const email = `plt10a-task3-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
    const result = await db().query<{ account_id: string }>(
      `INSERT INTO accounts (email, email_normalized, status)
       VALUES ($1, $1, 'active')
       RETURNING account_id`,
      [email.trim().toLowerCase()],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('account insert returned no row');
    createdAccountIds.push(row.account_id);
    return row.account_id;
  }

  /** Remove only the audit rows this suite created (shared DB; never drop). */
  async function clearMyAudit(): Promise<void> {
    await db().query('DELETE FROM platform_audit_events WHERE actor_account_id = ANY($1)', [
      createdAccountIds,
    ]);
  }

  /** Insert one audit event inside its own caller-owned transaction. */
  async function insertAudit(input: {
    actorAccountId: string;
    action: PlatformAuditAction;
    target: unknown;
    result: 'succeeded' | 'rejected';
    requestId?: string;
  }): Promise<void> {
    const client = await db().connect();
    try {
      await client.query('BEGIN');
      await insertPlatformAuditEvent(client, input);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  }

  it('inserts audit events (with and without request_id) and round-trips fields', async () => {
    const alice = await createAccount();
    const bob = await createAccount();

    await insertAudit({
      actorAccountId: alice,
      action: 'admin_granted',
      target: { accountId: bob, granted: true },
      result: 'succeeded',
      requestId: 'req-abc-123',
    });
    await insertAudit({
      actorAccountId: alice,
      action: 'audit_read',
      target: { scope: 'platform' },
      result: 'succeeded',
    });

    const rows = await db().query<{
      event_id: string;
      actor_account_id: string;
      action: string;
      target: unknown;
      result: string;
      occurred_at: Date;
      request_id: string | null;
    }>(
      `SELECT event_id, actor_account_id, action, target, result, occurred_at, request_id
       FROM platform_audit_events
       WHERE actor_account_id = $1
       ORDER BY occurred_at ASC`,
      [alice],
    );
    expect(rows.rows.length).toBe(2);

    const withRequestId = rows.rows.find((row) => row.request_id === 'req-abc-123');
    expect(withRequestId).toBeTruthy();
    expect(withRequestId?.action).toBe('admin_granted');
    expect(withRequestId?.target).toEqual({ accountId: bob, granted: true });
    expect(withRequestId?.result).toBe('succeeded');
    expect(withRequestId?.event_id).toBeTruthy();
    expect(Number.isNaN(new Date(withRequestId?.occurred_at as Date).getTime())).toBe(false);

    const withoutRequestId = rows.rows.find((row) => row.action === 'audit_read');
    expect(withoutRequestId).toBeTruthy();
    expect(withoutRequestId?.request_id).toBeNull();
  });

  it('runs inside the caller transaction (rollback removes the event)', async () => {
    const actor = await createAccount();
    const client: PoolClient = await db().connect();
    try {
      await client.query('BEGIN');
      await insertPlatformAuditEvent(client, {
        actorAccountId: actor,
        action: 'audit_read',
        target: { scope: 'rollback-probe' },
        result: 'succeeded',
      });
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    const rows = await db().query(
      `SELECT 1 FROM platform_audit_events
       WHERE actor_account_id = $1 AND target->>'scope' = 'rollback-probe'`,
      [actor],
    );
    expect(rows.rows.length).toBe(0);
  });

  it('queries with occurred_at DESC ordering and keyset nextCursor pagination', async () => {
    const actor = await createAccount();
    // Start from a clean page: remove rows this suite created in earlier tests.
    await clearMyAudit();

    const base = Date.parse('2026-08-12T00:00:00.000Z');
    for (let i = 1; i <= 5; i += 1) {
      await insertAudit({
        actorAccountId: actor,
        action: 'policy_set_organization',
        target: { organizationId: `org-${i}` },
        result: 'succeeded',
      });
      // Force a deterministic occurred_at so the ordering assertions are fully
      // controlled (newest = org-5, oldest = org-1).
      const idRow = await db().query<{ event_id: string }>(
        `SELECT event_id FROM platform_audit_events
         WHERE actor_account_id = $1 AND target->>'organizationId' = $2`,
        [actor, `org-${i}`],
      );
      const eventId = idRow.rows[0]?.event_id;
      expect(eventId).toBeTruthy();
      await db().query(
        'UPDATE platform_audit_events SET occurred_at = $2::timestamptz WHERE event_id = $1',
        [eventId, new Date(base + i * 60_000).toISOString()],
      );
    }

    const page1 = await queryPlatformAuditEvents(db(), { limit: 2 });
    expect(page1.items.length).toBe(2);
    expect(page1.items[0]?.target).toEqual({ organizationId: 'org-5' });
    expect(page1.items[1]?.target).toEqual({ organizationId: 'org-4' });
    expect(page1.nextCursor).toBeTruthy();

    const page2 = await queryPlatformAuditEvents(db(), {
      ...(page1.nextCursor === undefined ? {} : { cursor: page1.nextCursor }),
      limit: 2,
    });
    expect(page2.items.length).toBe(2);
    expect(page2.items[0]?.target).toEqual({ organizationId: 'org-3' });
    expect(page2.items[1]?.target).toEqual({ organizationId: 'org-2' });
    expect(page2.nextCursor).toBeTruthy();

    const page3 = await queryPlatformAuditEvents(db(), {
      ...(page2.nextCursor === undefined ? {} : { cursor: page2.nextCursor }),
      limit: 2,
    });
    expect(page3.items.length).toBe(1);
    expect(page3.items[0]?.target).toEqual({ organizationId: 'org-1' });
    expect(page3.nextCursor).toBeUndefined();
  });

  it('caps the limit at the page-size maximum (50) and returns a cursor when more remain', async () => {
    const actor = await createAccount();
    await clearMyAudit();

    for (let i = 1; i <= 60; i += 1) {
      await insertAudit({
        actorAccountId: actor,
        action: 'audit_read',
        target: { index: i },
        result: 'succeeded',
      });
    }

    // Requesting more than the 50 cap returns at most 50 items and a cursor.
    const oversized = await queryPlatformAuditEvents(db(), { limit: 1000 });
    expect(oversized.items.length).toBe(50);
    expect(oversized.nextCursor).toBeTruthy();

    // Default limit is 50 as well.
    const defaultPage = await queryPlatformAuditEvents(db(), {});
    expect(defaultPage.items.length).toBe(50);
    expect(defaultPage.nextCursor).toBeTruthy();
  });
});
