import { Pool } from 'pg';

export function testDatabaseUrl(): string {
  const url = process.env.AURORA_TEST_DATABASE_URL;
  if (url === undefined) {
    throw new Error('AURORA_TEST_DATABASE_URL must be set for integration tests');
  }
  return url;
}

/** Verify the target database is the dedicated Aurora test database. */
export function assertIsTestDatabase(url: string): void {
  const parsed = new URL(url);
  if (!parsed.pathname.startsWith('/aurora_inbox_test')) {
    throw new Error(`refusing to connect to non-test database: ${parsed.pathname}`);
  }
}

export function createTestPool(): Pool {
  const url = testDatabaseUrl();
  assertIsTestDatabase(url);
  return new Pool({ connectionString: url });
}

/**
 * Ensure the generic `outbox` table exists (spec §4.11 / ADR-032). The
 * platform-worker app CONSUMES the table created by `@aurora/platform-identity`;
 * for a self-contained integration suite we create it if absent (idempotent),
 * so the test does not depend on another package's migrations having run first.
 */
export async function ensureOutboxTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS outbox (
      outbox_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      aggregate_type text NOT NULL,
      aggregate_id uuid,
      payload jsonb NOT NULL,
      status text NOT NULL DEFAULT 'pending',
      attempt_count integer NOT NULL DEFAULT 0,
      claim_id uuid,
      last_error_code text,
      provider_request_id text,
      available_at timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT ck_outbox_status CHECK (
        status IN ('pending','processing','succeeded','failed','dead_lettered','superseded')
      )
    )
  `);
  await pool.query('ALTER TABLE outbox ADD COLUMN IF NOT EXISTS claim_id uuid');
  await pool.query('ALTER TABLE outbox ADD COLUMN IF NOT EXISTS last_error_code text');
  await pool.query('ALTER TABLE outbox ADD COLUMN IF NOT EXISTS provider_request_id text');
}
