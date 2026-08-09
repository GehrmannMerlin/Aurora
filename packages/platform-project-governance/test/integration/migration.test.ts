import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assertIsTestDatabase,
  createTestPool,
  queryRow,
  resetProjectGovernanceSchema,
  runMigrationsUp,
  runProjectGovernanceMigrationsDown,
  testDatabaseUrl,
} from './helpers.js';

const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const describeDb = hasDb ? describe : describe.skip;

describeDb('platform-project-governance migration down/up (real PostgreSQL 17)', () => {
  let pool: Pool;

  beforeAll(async () => {
    assertIsTestDatabase(testDatabaseUrl());
    pool = createTestPool();
    await resetProjectGovernanceSchema(pool);
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

  async function hasConstraint(table: string, constraint: string): Promise<boolean> {
    const row = await queryRow<{ present: number }>(
      pool,
      'SELECT 1 AS present FROM information_schema.table_constraints WHERE table_name = $1 AND constraint_name = $2',
      [table, constraint],
    );
    return row !== undefined;
  }

  it('creates the four project governance tables with the spec constraints', async () => {
    for (const table of ['projects', 'client_keys', 'project_environments', 'project_onboarding']) {
      expect(await hasTable(table), table).toBe(true);
    }
    expect(await hasConstraint('projects', 'ck_projects_status')).toBe(true);
    expect(await hasConstraint('projects', 'ck_projects_framework_type')).toBe(true);
    expect(await hasConstraint('projects', 'ck_projects_name_length')).toBe(true);
    expect(await hasConstraint('project_onboarding', 'ck_project_onboarding_status')).toBe(true);
  });

  it('does NOT add a foreign key on project_members.project_id (PLT-03 §4.8)', async () => {
    const row = await queryRow<{ fk_count: number }>(
      pool,
      `SELECT count(*)::int AS fk_count
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
       WHERE tc.constraint_type = 'FOREIGN KEY'
         AND tc.table_name = 'project_members'
         AND kcu.column_name = 'project_id'`,
    );
    expect(row?.fk_count ?? 0).toBe(0);
  });

  it('down drops this package tables and keeps PLT-03 tables; up restores them', async () => {
    expect(await hasTable('projects')).toBe(true);
    await runProjectGovernanceMigrationsDown();
    for (const table of ['projects', 'client_keys', 'project_environments', 'project_onboarding']) {
      expect(await hasTable(table), table).toBe(false);
    }
    // The PLT-03 identity tables survive a partial PLT-04 revert.
    expect(await hasTable('organizations')).toBe(true);
    expect(await hasTable('accounts')).toBe(true);
    await runMigrationsUp();
    for (const table of ['projects', 'client_keys', 'project_environments', 'project_onboarding']) {
      expect(await hasTable(table), table).toBe(true);
    }
  });
});
