import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assertIsTestDatabase,
  createTestPool,
  queryRow,
  resetOrganizationSchema,
  runMigrationsUp,
  runOrganizationMigrationsDown,
  testDatabaseUrl,
} from './helpers.js';

const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const describeDb = hasDb ? describe : describe.skip;

describeDb('platform-organization migration down/up (real PostgreSQL 17)', () => {
  let pool: Pool;

  beforeAll(async () => {
    assertIsTestDatabase(testDatabaseUrl());
    pool = createTestPool();
    await resetOrganizationSchema(pool);
    await runMigrationsUp();
  });

  afterAll(async () => {
    await pool.end();
  });

  async function hasColumn(column: string): Promise<boolean> {
    const row = await queryRow<{ present: number }>(
      pool,
      "SELECT 1 AS present FROM information_schema.columns WHERE table_name = 'organizations' AND column_name = $1",
      [column],
    );
    return row !== undefined;
  }

  async function hasPendingInvitationIndex(): Promise<boolean> {
    const row = await queryRow<{ present: number }>(
      pool,
      "SELECT 1 AS present FROM pg_indexes WHERE indexname = 'uq_organization_invitations_pending_org_email'",
    );
    return row !== undefined;
  }

  it('down drops settings_version but keeps the PLT-03 pending-invitation index; up re-adds settings_version', async () => {
    expect(await hasColumn('settings_version')).toBe(true);
    expect(await hasPendingInvitationIndex()).toBe(true);

    await runOrganizationMigrationsDown();

    // The settings-version column is this migration's own and is dropped…
    expect(await hasColumn('settings_version')).toBe(false);
    // …but the pending-invitation partial unique index is owned by the PLT-03
    // identity migration and must survive a partial PLT-04 revert (it is the
    // unique-pending backstop inviteMember's pending_conflict detection relies on).
    expect(await hasPendingInvitationIndex()).toBe(true);

    await runMigrationsUp();

    expect(await hasColumn('settings_version')).toBe(true);
    expect(await hasPendingInvitationIndex()).toBe(true);
  });
});
