import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assertIsTestDatabase,
  createTestPool,
  queryRow,
  resetAuditSchema,
  runAuditMigrationsDown,
  runMigrationsUp,
  testDatabaseUrl,
} from './helpers.js';

const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const describeDb = hasDb ? describe : describe.skip;

describeDb('platform-audit migration up/down (real PostgreSQL 17)', () => {
  let pool: Pool;

  beforeAll(async () => {
    assertIsTestDatabase(testDatabaseUrl());
    pool = createTestPool();
    await resetAuditSchema(pool);
    await runMigrationsUp();
  });

  afterAll(async () => {
    await pool.end();
  });

  async function hasTable(name: string): Promise<boolean> {
    const row = await queryRow<{ present: number }>(
      pool,
      'SELECT 1 AS present FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2',
      ['public', name],
    );
    return row !== undefined;
  }

  async function hasColumn(table: string, column: string): Promise<boolean> {
    const row = await queryRow<{ present: number }>(
      pool,
      'SELECT 1 AS present FROM information_schema.columns WHERE table_name = $1 AND column_name = $2',
      [table, column],
    );
    return row !== undefined;
  }

  async function hasIndex(indexName: string): Promise<boolean> {
    const row = await queryRow<{ present: number }>(
      pool,
      'SELECT 1 AS present FROM pg_indexes WHERE indexname = $1',
      [indexName],
    );
    return row !== undefined;
  }

  async function hasConstraint(table: string, constraint: string): Promise<boolean> {
    const row = await queryRow<{ present: number }>(
      pool,
      'SELECT 1 AS present FROM information_schema.table_constraints WHERE table_name = $1 AND constraint_name = $2',
      [table, constraint],
    );
    return row !== undefined;
  }

  it('extends security_audit_events with project_id, result and the B7 timeline index', async () => {
    expect(await hasColumn('security_audit_events', 'project_id')).toBe(true);
    expect(await hasColumn('security_audit_events', 'result')).toBe(true);
    expect(await hasIndex('idx_security_audit_events_org_occurred_at')).toBe(true);
    expect(await hasConstraint('security_audit_events', 'ck_security_audit_events_result')).toBe(
      true,
    );
  });

  it('adds no foreign key on project_id (tombstone reference, not an FK to projects)', async () => {
    const row = await queryRow<{ fk_count: number }>(
      pool,
      `SELECT count(*)::int AS fk_count
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
       WHERE tc.constraint_type = 'FOREIGN KEY'
         AND tc.table_name = 'security_audit_events'
         AND kcu.column_name = 'project_id'`,
    );
    expect(row?.fk_count ?? 0).toBe(0);
  });

  it('down drops the extension and keeps the PLT-03 table; up restores it', async () => {
    expect(await hasColumn('security_audit_events', 'project_id')).toBe(true);
    await runAuditMigrationsDown();
    expect(await hasColumn('security_audit_events', 'project_id')).toBe(false);
    expect(await hasColumn('security_audit_events', 'result')).toBe(false);
    expect(await hasIndex('idx_security_audit_events_org_occurred_at')).toBe(false);
    // The PLT-03 identity tables survive a partial PLT-04 revert.
    expect(await hasTable('security_audit_events')).toBe(true);
    expect(await hasTable('organizations')).toBe(true);
    expect(await hasTable('accounts')).toBe(true);
    await runMigrationsUp();
    expect(await hasColumn('security_audit_events', 'project_id')).toBe(true);
    expect(await hasColumn('security_audit_events', 'result')).toBe(true);
    expect(await hasIndex('idx_security_audit_events_org_occurred_at')).toBe(true);
  });
});
