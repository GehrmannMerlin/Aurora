import type { Pool, PoolClient } from 'pg';

/**
 * Distinguish a `Pool` (opens its own transaction) from an already-leased
 * `PoolClient` (runs directly on the caller's transaction). `PoolClient` owns a
 * `release` method that `Pool` does not, so this check is unambiguous.
 */
export function isPoolClient(value: Pool | PoolClient): value is PoolClient {
  return typeof (value as PoolClient).release === 'function';
}

/**
 * Run `fn` inside a single explicit transaction. Rolls back on any throw and
 * always releases the pooled connection. The original error is rethrown so
 * callers can inspect PostgreSQL error codes (unique/FK violations) before
 * mapping to a stable PlatformIdentityError.
 */
export async function withTransaction<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
