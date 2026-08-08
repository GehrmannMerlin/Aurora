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
 * Ensure the generic `outbox` table exists (ADR-032 / spec §4.11).
 *
 * This package ships no migration of its own — it CONSUMES the outbox table
 * created by `@aurora/platform-identity`. For a self-contained integration
 * suite we create it if absent (idempotent), so the test does not depend on
 * another package's migrations having run first.
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
      available_at timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT ck_outbox_status CHECK (
        status IN ('pending','processing','succeeded','failed','dead_lettered')
      )
    )
  `);
}

/** Normalize a raw pg timestamptz value to a stable ISO-8601 UTC string. */
export function toIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
