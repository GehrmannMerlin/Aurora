import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertIsTestDatabase, createTestPool, queryRows, testDatabaseUrl } from './helpers.js';

const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const describeDb = hasDb ? describe : describe.skip;

interface NamespaceRow {
  n: number;
}

describeDb('ingestion-inbox test isolation (real PostgreSQL 17)', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = createTestPool();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('refuses to connect to a non-test database', () => {
    const fake = testDatabaseUrl().replace('/aurora_inbox_test', '/postgres');
    expect(() => {
      assertIsTestDatabase(fake);
    }).toThrow(/refusing to connect/);
  });

  it('creates and drops an isolated schema without residue', async () => {
    const schema = `aurora_iso_${randomUUID().replaceAll('-', '')}`;
    await pool.query(`CREATE SCHEMA "${schema}"`);
    await pool.query(`CREATE TABLE "${schema}".probe (id bigint primary key)`);
    await pool.query(`INSERT INTO "${schema}".probe VALUES (1)`);
    await pool.query(`DROP TABLE "${schema}".probe`);
    await pool.query(`DROP SCHEMA "${schema}"`);
    const residual = await queryRows<NamespaceRow>(
      pool,
      'SELECT count(*)::int AS n FROM pg_namespace WHERE nspname = $1',
      [schema],
    );
    expect(residual[0]?.n).toBe(0);
  });

  it('runs transactions and rollbacks within an isolated schema', async () => {
    const schema = `aurora_iso_${randomUUID().replaceAll('-', '')}`;
    await pool.query(`CREATE SCHEMA "${schema}"`);
    await pool.query(`CREATE TABLE "${schema}".txn (id bigint primary key)`);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO "${schema}".txn VALUES (1)`);
      await client.query('ROLLBACK');
      const count = await queryRows<NamespaceRow>(
        client,
        `SELECT count(*)::int AS n FROM "${schema}".txn`,
      );
      expect(count[0]?.n).toBe(0);
    } finally {
      client.release();
    }
    await pool.query(`DROP TABLE "${schema}".txn`);
    await pool.query(`DROP SCHEMA "${schema}"`);
  });
});
