import type { Pool, PoolClient } from 'pg';

/**
 * Run `fn` inside a single explicit PostgreSQL transaction. Rolls back on any
 * throw and always releases the pooled connection. Used by the platform-api
 * handlers to compose the platform-identity repository writes (which accept a
 * `PoolClient`) into one atomic command transaction (PLT-03 Task 7 carry-forward
 * "atomic register").
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
