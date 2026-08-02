import type { Pool } from 'pg';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { assertIsTestDatabase, createTestPool, migrateUp, queryRow } from './helpers.js';

const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const describeDb = hasDb ? describe : describe.skip;

describeDb('ingestion-credentials schema (real PostgreSQL 17)', () => {
  let pool: Pool;

  beforeAll(async () => {
    assertIsTestDatabase(process.env.AURORA_TEST_DATABASE_URL ?? '');
    pool = createTestPool();
    await migrateUp();
    // Clean the credential tables between runs.
    await pool.query('DELETE FROM ingestion_client_credential_environments');
    await pool.query('DELETE FROM ingestion_client_credential_origins');
    await pool.query('DELETE FROM ingestion_client_credentials');
  });

  afterAll(async () => {
    await pool.end();
  });

  const digest = Buffer.alloc(32, 1);
  let fixtureIndex = 0;

  /** Insert a credential with a unique keyId by default to avoid cross-test collisions. */
  async function insertCredential(overrides?: {
    keyId?: string;
    status?: string;
    digest?: Buffer;
  }): Promise<{ id: string; keyId: string }> {
    fixtureIndex += 1;
    const index = String(fixtureIndex).padStart(2, '0');
    const uniqueKeyId = overrides?.keyId ?? `AAAAAAAAAAAAAAAAAAAA${index}`.slice(0, 22);
    const result = await pool.query<{ id: string }>(
      `INSERT INTO ingestion_client_credentials
         (project_id, key_id, secret_digest, status, allow_non_browser)
       VALUES ('11111111-1111-1111-1111-111111111111', $1, $2, $3, false)
       RETURNING id`,
      [uniqueKeyId, overrides?.digest ?? digest, overrides?.status ?? 'active'],
    );
    return { id: result.rows[0]?.id ?? '', keyId: uniqueKeyId };
  }

  it('creates the three credential tables with the expected columns', async () => {
    const cred = await queryRow<{ column_name: string }>(
      pool,
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'ingestion_client_credentials'`,
    );
    expect(cred).toBeTruthy();
    const origins = await queryRow<{ column_name: string }>(
      pool,
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'ingestion_client_credential_origins'`,
    );
    expect(origins).toBeTruthy();
    const environments = await queryRow<{ column_name: string }>(
      pool,
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'ingestion_client_credential_environments'`,
    );
    expect(environments).toBeTruthy();
  });

  it('enforces key_id uniqueness', async () => {
    const { id, keyId: insertedKeyId } = await insertCredential();
    await expect(
      pool.query(
        `INSERT INTO ingestion_client_credentials
           (project_id, key_id, secret_digest, status)
         VALUES ('22222222-2222-2222-2222-222222222222', $1, $2, 'active')`,
        [insertedKeyId, digest],
      ),
    ).rejects.toThrow(/key_id_key|unique|duplicate|重复键/i);
    await pool.query('DELETE FROM ingestion_client_credentials WHERE id = $1', [id]);
  });

  it('enforces secret_digest length of exactly 32 bytes', async () => {
    await expect(
      pool.query(
        `INSERT INTO ingestion_client_credentials
           (project_id, key_id, secret_digest, status)
         VALUES ('11111111-1111-1111-1111-111111111111', 'BBBBBBBBBBBBBBBBBBBBBB', $1, 'active')`,
        [Buffer.alloc(16, 1)],
      ),
    ).rejects.toThrow(/check|digest|octet/i);
  });

  it('enforces the status check constraint', async () => {
    await expect(
      pool.query(
        `INSERT INTO ingestion_client_credentials
           (project_id, key_id, secret_digest, status)
         VALUES ('11111111-1111-1111-1111-111111111111', 'CCCCCCCCCCCCCCCCCCCCCC', $1, 'expired')`,
        [digest],
      ),
    ).rejects.toThrow(/check|status/i);
  });

  it('enforces unique (credential_id, origin)', async () => {
    const { id } = await insertCredential();
    await pool.query(
      `INSERT INTO ingestion_client_credential_origins (credential_id, origin)
       VALUES ($1, 'https://a.example.com')`,
      [id],
    );
    await expect(
      pool.query(
        `INSERT INTO ingestion_client_credential_origins (credential_id, origin)
         VALUES ($1, 'https://a.example.com')`,
        [id],
      ),
    ).rejects.toThrow(/uq_icco|unique|duplicate|重复键/i);
    await pool.query('DELETE FROM ingestion_client_credential_origins WHERE credential_id = $1', [id]);
    await pool.query('DELETE FROM ingestion_client_credentials WHERE id = $1', [id]);
  });

  it('enforces unique (credential_id, environment)', async () => {
    const { id } = await insertCredential();
    await pool.query(
      `INSERT INTO ingestion_client_credential_environments (credential_id, environment)
       VALUES ($1, 'production')`,
      [id],
    );
    await expect(
      pool.query(
        `INSERT INTO ingestion_client_credential_environments (credential_id, environment)
         VALUES ($1, 'production')`,
        [id],
      ),
    ).rejects.toThrow(/uq_icce|unique|duplicate|重复键/i);
    await pool.query(
      'DELETE FROM ingestion_client_credential_environments WHERE credential_id = $1',
      [id],
    );
    await pool.query('DELETE FROM ingestion_client_credentials WHERE id = $1', [id]);
  });

  it('defaults allow_non_browser to false', async () => {
    const { id } = await insertCredential();
    const row = await queryRow<{ allow_non_browser: boolean }>(
      pool,
      `SELECT allow_non_browser FROM ingestion_client_credentials WHERE id = $1`,
      [id],
    );
    expect(row?.allow_non_browser).toBe(false);
    await pool.query('DELETE FROM ingestion_client_credentials WHERE id = $1', [id]);
  });

  it('allows nullable expires_at', async () => {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO ingestion_client_credentials
         (project_id, key_id, secret_digest, status, expires_at)
       VALUES ('11111111-1111-1111-1111-111111111111', 'DDDDDDDDDDDDDDDDDDDDDD', $1, 'active', NULL)
       RETURNING id`,
      [digest],
    );
    const id = result.rows[0]?.id ?? '';
    const row = await queryRow<{ expires_at: unknown }>(
      pool,
      `SELECT expires_at FROM ingestion_client_credentials WHERE id = $1`,
      [id],
    );
    expect(row?.expires_at).toBeNull();
    await pool.query('DELETE FROM ingestion_client_credentials WHERE id = $1', [id]);
  });

  it('does not contain raw secret or client key columns', async () => {
    const cols = await queryRowsCount(pool);
    for (const col of ['secret', 'raw_key', 'client_key', 'secret_text', 'key']) {
      expect(cols).not.toContain(col);
    }
  });

  it('does not index secret_digest', async () => {
    const idx = await queryRow<{ indexdef: string }>(
      pool,
      `SELECT indexdef FROM pg_indexes
       WHERE tablename = 'ingestion_client_credentials'
         AND indexdef ILIKE '%secret_digest%'`,
    );
    expect(idx).toBeUndefined();
  });
});

async function queryRowsCount(pool: Pool): Promise<string[]> {
  const rows = await pool.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'ingestion_client_credentials'`,
  );
  return rows.rows.map((r) => r.column_name);
}
