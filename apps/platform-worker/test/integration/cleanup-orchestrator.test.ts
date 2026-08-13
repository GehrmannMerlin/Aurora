import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runner } from 'node-pg-migrate';
import { fileURLToPath } from 'node:url';
import { runCleanupRound } from '../../src/retention/cleanup-orchestrator.js';
import { PostgresCleanupAdapter } from '../../src/retention/postgres-cleanup-adapter.js';
import { RedisSessionCleanupAdapter } from '../../src/retention/redis-session-cleanup-adapter.js';
import { ObjectStorageCleanupAdapter } from '../../src/retention/object-storage-cleanup-adapter.js';
import { BackupLifecycleCleanupAdapter } from '../../src/retention/backup-lifecycle-cleanup-adapter.js';
import { AuditCleanupAdapter } from '../../src/retention/audit-cleanup-adapter.js';

const migrationsDir = fileURLToPath(
  new URL('../../../../packages/platform-identity/migrations', import.meta.url),
);

const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const describeDb = hasDb ? describe : describe.skip;

const DROP_ORDER = [
  'account_cleanup_steps',
  'account_cleanup_handoffs',
  'account_deletion_intents',
  'outbox',
  'idempotency_records',
  'security_audit_events',
  'project_members',
  'organization_invitations',
  'organization_members',
  'organizations',
  'password_reset_intents',
  'email_verification_intents',
  'account_credentials',
  'accounts',
];

describeDb('SEC-02 focused cleanup orchestration (PostgreSQL)', () => {
  let pool: Pool;

  beforeAll(async () => {
    const url = process.env.AURORA_TEST_DATABASE_URL;
    if (url === undefined) throw new Error('AURORA_TEST_DATABASE_URL required');
    if (!new URL(url).pathname.startsWith('/aurora_inbox_test')) {
      throw new Error(`refusing to connect to non-test database: ${new URL(url).pathname}`);
    }
    pool = new Pool({ connectionString: url });
    for (const table of DROP_ORDER) {
      await pool.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
    }
    await pool.query('DROP TABLE IF EXISTS pgmigrations CASCADE');
    await runner({
      databaseUrl: url,
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

  it('cleans the account across stores, persists steps, and completes the handoff (no fake partial success)', async () => {
    const account = await pool.query<{ account_id: string }>(
      `INSERT INTO accounts (email, email_normalized, status)
       VALUES ('leaver@example.com', 'leaver@example.com', 'terminated')
       RETURNING account_id`,
    );
    const accountId = account.rows[0]?.account_id;
    if (accountId === undefined) throw new Error('no account row');

    await pool.query(
      'INSERT INTO account_credentials (account_id, password_hash) VALUES ($1, $2)',
      [accountId, 'not-a-real-hash'],
    );
    const org = await pool.query<{ organization_id: string }>(
      `INSERT INTO organizations (name, kind) VALUES ('Personal', 'personal') RETURNING organization_id`,
    );
    const orgId = org.rows[0]?.organization_id;
    if (orgId === undefined) throw new Error('no org row');
    await pool.query(
      'INSERT INTO organization_members (organization_id, account_id, role) VALUES ($1, $2, $3)',
      [orgId, accountId, 'owner'],
    );
    await pool.query(
      `INSERT INTO security_audit_events (actor_account_id, action, target_account_id)
       VALUES ($1, 'deletion_terminated', $1)`,
      [accountId],
    );

    const handoff = await pool.query<{ handoff_id: string }>(
      `INSERT INTO account_cleanup_handoffs (account_id, status, required_lifecycle)
       VALUES ($1, 'pending', $2::jsonb)
       RETURNING handoff_id`,
      [accountId, JSON.stringify({ backupExpiryDays: 35, onlineCleanupDays: 7, auditYears: 1 })],
    );
    const handoffId = handoff.rows[0]?.handoff_id;
    if (handoffId === undefined) throw new Error('no handoff row');

    const result = await runCleanupRound({
      pool,
      maxAttempts: 5,
      adapters: [
        new PostgresCleanupAdapter(pool),
        new RedisSessionCleanupAdapter(),
        new ObjectStorageCleanupAdapter(),
        new BackupLifecycleCleanupAdapter(),
        new AuditCleanupAdapter(pool),
      ],
    });

    expect(result.succeeded).toBe(1);
    expect(result.claimed).toBe(1);

    // direct identity deleted / anonymized; email freed (no tombstone)
    const accountAfter = await pool.query<{ email: string; status: string }>(
      'SELECT email, status FROM accounts WHERE account_id = $1',
      [accountId],
    );
    expect(accountAfter.rows[0]?.status).toBe('terminated');
    expect(accountAfter.rows[0]?.email).toMatch(/^deleted:/);
    // credentials + memberships removed
    const creds = await pool.query('SELECT 1 FROM account_credentials WHERE account_id = $1', [
      accountId,
    ]);
    expect(creds.rowCount).toBe(0);
    const members = await pool.query('SELECT 1 FROM organization_members WHERE account_id = $1', [
      accountId,
    ]);
    expect(members.rowCount).toBe(0);
    // handoff + steps purged only after full success
    const handoffAfter = await pool.query(
      'SELECT 1 FROM account_cleanup_handoffs WHERE handoff_id = $1',
      [handoffId],
    );
    expect(handoffAfter.rowCount).toBe(0);
    const stepsAfter = await pool.query(
      'SELECT 1 FROM account_cleanup_steps WHERE handoff_id = $1',
      [handoffId],
    );
    expect(stepsAfter.rowCount).toBe(0);
    // audit completion event recorded (anonymous subject only)
    const audit = await pool.query<{ action: string }>(
      'SELECT action FROM security_audit_events WHERE target_account_id = $1',
      [accountId],
    );
    expect(audit.rows.map((row) => row.action)).toContain('cleanup_completed');
  });
});
