import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import { Pool } from 'pg';

const migrationsDir = fileURLToPath(
  new URL('../../../../packages/platform-identity/migrations', import.meta.url),
);

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

export function redisUrl(): string {
  const url = process.env.AURORA_TEST_REDIS_URL;
  if (url === undefined) {
    throw new Error('AURORA_TEST_REDIS_URL must be set for integration tests');
  }
  return url;
}

export function createTestPool(): Pool {
  const url = testDatabaseUrl();
  assertIsTestDatabase(url);
  return new Pool({ connectionString: url });
}

/** Run all platform-identity migrations up (idempotent). */
export async function runIdentityMigrations(): Promise<void> {
  await runner({
    databaseUrl: testDatabaseUrl(),
    dir: migrationsDir,
    direction: 'up',
    migrationsTable: 'pgmigrations',
    count: Infinity,
    log: () => undefined,
  });
}

/** Extract the `aurora_session` cookie value from a `set-cookie` header. */
export function extractSessionCookie(setCookie: unknown): string {
  const value = Array.isArray(setCookie) ? setCookie[0] : (setCookie as string | undefined);
  if (typeof value !== 'string') {
    throw new Error('no set-cookie header in response');
  }
  const match = /^aurora_session=([^;]+)/.exec(value);
  if (match === null) {
    throw new Error('no aurora_session cookie in set-cookie header');
  }
  return match[1] ?? '';
}
