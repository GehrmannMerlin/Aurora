import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bootstrapPlatformAdmins,
  countPlatformAdmins,
  grantPlatformAdmin,
  isPlatformAdmin,
  listPlatformAdmins,
  revokePlatformAdmin,
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

/**
 * Run this package's migrations UP (idempotent against the shared `pgmigrations`
 * table; `checkOrder: false` for the shared cross-directory history). Same
 * pattern as the migration integration test.
 */
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

describeDb('platform-admin admins repository (real PostgreSQL 17)', () => {
  let pool: Pool | undefined;
  const createdAccountIds: string[] = [];

  beforeAll(async () => {
    assertIsTestDatabase(testDatabaseUrl());
    pool = new Pool({ connectionString: testDatabaseUrl() });
    await runMigrationsUp();
  });

  afterAll(async () => {
    if (pool !== undefined) {
      // Remove only rows this suite created, in FK-safe order (audit → admins →
      // accounts). The shared test database keeps rows from other packages; never
      // drop tables here.
      await pool.query('DELETE FROM platform_audit_events WHERE actor_account_id = ANY($1)', [
        createdAccountIds,
      ]);
      await pool.query(
        'DELETE FROM platform_admins WHERE account_id = ANY($1) OR granted_by = ANY($1)',
        [createdAccountIds],
      );
      await pool.query('DELETE FROM accounts WHERE account_id = ANY($1)', [createdAccountIds]);
      await pool.end();
    }
  });

  function db(): Pool {
    if (pool === undefined) throw new Error('pool not initialized');
    return pool;
  }

  async function createAccount(): Promise<string> {
    const email = `plt10a-task2-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
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

  /** Remove only the admin rows this suite created (shared DB; never drop). */
  async function clearMyAdmins(): Promise<void> {
    await db().query(
      'DELETE FROM platform_admins WHERE account_id = ANY($1) OR granted_by = ANY($1)',
      [createdAccountIds],
    );
  }

  it('grants platform admin and reports already_admin / account_not_found', async () => {
    const alice = await createAccount();
    const bob = await createAccount();

    expect(await grantPlatformAdmin(db(), { accountId: alice, grantedBy: bob })).toEqual({
      status: 'granted',
    });
    expect(await isPlatformAdmin(db(), { accountId: alice })).toBe(true);
    expect(await isPlatformAdmin(db(), { accountId: bob })).toBe(false);

    expect(await grantPlatformAdmin(db(), { accountId: alice, grantedBy: bob })).toEqual({
      status: 'already_admin',
    });

    const missing = '00000000-0000-4000-8000-000000000001';
    expect(await grantPlatformAdmin(db(), { accountId: missing, grantedBy: bob })).toEqual({
      status: 'account_not_found',
    });
  });

  it('revokes platform admin and reports not_admin for a non-admin', async () => {
    const alice = await createAccount();
    const bob = await createAccount();
    await grantPlatformAdmin(db(), { accountId: alice, grantedBy: bob });

    expect(await revokePlatformAdmin(db(), { accountId: alice, revokedBy: bob })).toEqual({
      status: 'revoked',
    });
    expect(await isPlatformAdmin(db(), { accountId: alice })).toBe(false);

    expect(await revokePlatformAdmin(db(), { accountId: alice, revokedBy: bob })).toEqual({
      status: 'not_admin',
    });
  });

  it('refuses to revoke the last remaining platform admin', async () => {
    const alice = await createAccount();
    const bob = await createAccount();
    await clearMyAdmins();
    await grantPlatformAdmin(db(), { accountId: alice, grantedBy: bob });

    expect(await revokePlatformAdmin(db(), { accountId: alice, revokedBy: bob })).toEqual({
      status: 'last_admin',
    });
    expect(await isPlatformAdmin(db(), { accountId: alice })).toBe(true);
  });

  it('never drops to zero admins under concurrent revoke (last-admin race)', async () => {
    const alice = await createAccount();
    const bob = await createAccount();
    const carol = await createAccount();
    await clearMyAdmins();
    await grantPlatformAdmin(db(), { accountId: alice, grantedBy: carol });
    await grantPlatformAdmin(db(), { accountId: bob, grantedBy: carol });

    // Two concurrent revokes of the two remaining admins: the FOR UPDATE row
    // lock serializes them so exactly one reports last_admin and one row always
    // survives (the platform admin invariant count >= 1).
    const [resultA, resultB] = await Promise.all([
      revokePlatformAdmin(db(), { accountId: alice, revokedBy: carol }),
      revokePlatformAdmin(db(), { accountId: bob, revokedBy: carol }),
    ]);

    expect(await countPlatformAdmins(db())).toBe(1);
    expect([resultA.status, resultB.status].sort()).toEqual(['last_admin', 'revoked']);
  });

  it('lists and counts platform admins', async () => {
    const alice = await createAccount();
    const bob = await createAccount();
    await clearMyAdmins();
    await grantPlatformAdmin(db(), { accountId: alice, grantedBy: bob });
    await grantPlatformAdmin(db(), { accountId: bob, grantedBy: alice });

    const list = await listPlatformAdmins(db(), {});
    const accountIds = list.items.map((item) => item.accountId);
    expect(accountIds).toEqual(expect.arrayContaining([alice, bob]));
    for (const item of list.items) {
      expect(item.grantedBy).toBeTruthy();
      expect(Number.isNaN(new Date(item.grantedAt).getTime())).toBe(false);
    }
    expect(await countPlatformAdmins(db())).toBeGreaterThanOrEqual(2);
  });

  it('bootstraps only existing non-admin accounts and writes an admin_bootstrapped audit', async () => {
    const alice = await createAccount();
    const bob = await createAccount();
    await clearMyAdmins();
    const missing = '00000000-0000-4000-8000-000000000002';

    expect(
      await bootstrapPlatformAdmins(db(), { accountIds: [alice, missing], bootstrapBy: bob }),
    ).toEqual({ seeded: 1 });
    expect(await isPlatformAdmin(db(), { accountId: alice })).toBe(true);
    expect(await isPlatformAdmin(db(), { accountId: missing })).toBe(false);

    const audit = await db().query<{ cnt: string }>(
      `SELECT count(*)::bigint AS cnt FROM platform_audit_events
       WHERE actor_account_id = $1 AND action = 'admin_bootstrapped'`,
      [bob],
    );
    expect(Number(audit.rows[0]?.cnt ?? 0)).toBeGreaterThanOrEqual(1);

    // Re-bootstrap with an already-admin account is a no-op for that account;
    // the still-missing account is skipped; the not-yet-admin bob is seeded.
    expect(
      await bootstrapPlatformAdmins(db(), { accountIds: [alice, bob], bootstrapBy: bob }),
    ).toEqual({ seeded: 1 });
    expect(await isPlatformAdmin(db(), { accountId: bob })).toBe(true);
  });
});
