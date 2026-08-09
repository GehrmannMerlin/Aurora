import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assertIsTestDatabase,
  createTestPool,
  queryRow,
  queryRows,
  resetCredentialsSchema,
  runCredentialsMigrationsDown,
  runMigrationsUp,
  testDatabaseUrl,
} from './helpers.js';

const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const describeDb = hasDb ? describe : describe.skip;

describeDb('platform-credentials migration up/down (real PostgreSQL 17)', () => {
  let pool: Pool;

  beforeAll(async () => {
    assertIsTestDatabase(testDatabaseUrl());
    pool = createTestPool();
    await resetCredentialsSchema(pool);
    await runMigrationsUp();
  });

  afterAll(async () => {
    await pool.end();
  });

  async function hasTable(table: string): Promise<boolean> {
    const row = await queryRow<{ present: number }>(
      pool,
      `SELECT 1 AS present FROM information_schema.tables WHERE table_name = $1 AND table_schema = 'public'`,
      [table],
    );
    return row !== undefined;
  }

  it('up creates the private_tokens table with the spec §4.5 columns', async () => {
    expect(await hasTable('private_tokens')).toBe(true);
    const columns = await queryRows<{ column_name: string; is_nullable: string }>(
      pool,
      `SELECT column_name, is_nullable FROM information_schema.columns
       WHERE table_name = 'private_tokens' ORDER BY ordinal_position`,
    );
    const byName = new Map(columns.map((c) => [c.column_name, c]));
    for (const required of [
      'token_id',
      'organization_id',
      'created_by',
      'name',
      'token_digest',
      'scopes',
      'expires_at',
      'revoked_at',
      'last_used_at',
      'created_at',
    ]) {
      expect(byName.has(required), `missing column ${required}`).toBe(true);
    }
    expect(byName.get('name')?.is_nullable).toBe('NO');
    expect(byName.get('token_digest')?.is_nullable).toBe('NO');
    expect(byName.get('scopes')?.is_nullable).toBe('NO');
  });

  it('token_digest has a unique constraint', async () => {
    const index = await queryRow<{ indexdef: string }>(
      pool,
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'private_tokens' AND indexdef ILIKE '%token_digest%'`,
    );
    expect(index?.indexdef).toContain('UNIQUE');
  });

  it('down drops private_tokens; up re-creates it', async () => {
    await runCredentialsMigrationsDown();
    expect(await hasTable('private_tokens')).toBe(false);

    await runMigrationsUp();
    expect(await hasTable('private_tokens')).toBe(true);
  });
});
