import type { Pool, PoolClient } from 'pg';

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
