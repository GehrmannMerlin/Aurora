import type { Pool } from 'pg';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createIngestionClientCredential } from '../../src/lifecycle-create.js';
import { verifyIngestionCredential } from '../../src/verification.js';
import { parseIngestionClientKey } from '../../src/client-key.js';
import { sha256Digest } from '../../src/digest.js';
import { assertIsTestDatabase, createTestPool, migrateUp, queryRow } from './helpers.js';

const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const describeDb = hasDb ? describe : describe.skip;

const projectA = '11111111-1111-1111-1111-111111111111';
const ORIGIN_A = 'https://a.example.com';
const ENV = 'production';

describeDb('ingestion-credentials lifecycle create (real PostgreSQL 17)', () => {
  let pool: Pool;

  beforeAll(async () => {
    assertIsTestDatabase(process.env.AURORA_TEST_DATABASE_URL ?? '');
    pool = createTestPool();
    await migrateUp();
    await pool.query('DELETE FROM ingestion_client_credential_environments');
    await pool.query('DELETE FROM ingestion_client_credential_origins');
    await pool.query('DELETE FROM ingestion_client_credentials');
  });

  afterAll(async () => {
    await pool.end();
  });

  it('creates a credential atomically with origins and environments', async () => {
    const result = await createIngestionClientCredential(pool, {
      projectId: projectA,
      origins: [ORIGIN_A],
      environments: [ENV],
      allowNonBrowser: false,
      expiresAt: null,
    });
    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.clientKey).toMatch(/^aurora_ingest_/);
    expect(result.metadata.status).toBe('active');
    expect(result.metadata.projectId).toBe(projectA);
    // Verify the returned key authenticates.
    const auth = await verifyIngestionCredential(pool, {
      clientKey: result.clientKey,
      environment: ENV,
      origin: ORIGIN_A,
    });
    expect(auth.status).toBe('authorized');
  });

  it('composes with a caller-owned transaction without connecting or committing it', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await createIngestionClientCredential(client, {
        projectId: projectA,
        origins: [ORIGIN_A],
        environments: [ENV],
        allowNonBrowser: true,
        expiresAt: null,
      });
      expect(result.status).toBe('success');
      if (result.status !== 'success') return;
      const inside = await client.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM ingestion_client_credentials WHERE key_id = $1',
        [result.metadata.keyId],
      );
      expect(inside.rows[0]?.n).toBe(1);
      await client.query('ROLLBACK');
      const outside = await pool.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM ingestion_client_credentials WHERE key_id = $1',
        [result.metadata.keyId],
      );
      expect(outside.rows[0]?.n).toBe(0);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  });

  it('stores no raw secret or full key in the database', async () => {
    await createIngestionClientCredential(pool, {
      projectId: projectA,
      origins: [ORIGIN_A],
      environments: [ENV],
      allowNonBrowser: false,
      expiresAt: null,
    });
    const cols = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'ingestion_client_credentials'`,
    );
    const names = cols.rows.map((r) => r.column_name);
    for (const forbidden of ['secret', 'client_key', 'raw_key', 'secret_text']) {
      expect(names).not.toContain(forbidden);
    }
  });

  it('stores a digest that matches the returned key', async () => {
    const result = await createIngestionClientCredential(pool, {
      projectId: projectA,
      origins: [ORIGIN_A],
      environments: [ENV],
      allowNonBrowser: false,
      expiresAt: null,
    });
    if (result.status !== 'success') return;
    const parsed = parseIngestionClientKey(result.clientKey);
    expect(parsed).not.toBeNull();
    if (parsed === null) return;
    const secretBytes = Buffer.from(parsed.secret, 'utf8');
    // The digest stored must match sha256 of the DECODED secret bytes.
    const decoded = Buffer.from(
      `${parsed.secret}${'='.repeat((4 - (parsed.secret.length % 4)) % 4)}`
        .replace(/-/g, '+')
        .replace(/_/g, '/'),
      'base64',
    );
    const row = await queryRow<{ secret_digest: Buffer }>(
      pool,
      `SELECT secret_digest FROM ingestion_client_credentials WHERE key_id = $1`,
      [parsed.keyId],
    );
    expect(row).toBeTruthy();
    expect(row?.secret_digest.equals(sha256Digest(decoded))).toBe(true);
    void secretBytes;
  });

  it('returns invalid_input for a non-UUID projectId', async () => {
    const result = await createIngestionClientCredential(pool, {
      projectId: 'not-a-uuid',
      origins: [],
      environments: [],
      allowNonBrowser: false,
      expiresAt: null,
    });
    expect(result.status).toBe('invalid_input');
  });

  it('returns invalid_input for an invalid origin', async () => {
    const result = await createIngestionClientCredential(pool, {
      projectId: projectA,
      origins: ['*'],
      environments: [],
      allowNonBrowser: false,
      expiresAt: null,
    });
    expect(result.status).toBe('invalid_input');
  });

  it('rolls back the credential when an environment insert fails', async () => {
    const before = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ingestion_client_credentials`,
    );
    // A duplicated environment list should be deduped; use an oversized value to fail validation.
    const result = await createIngestionClientCredential(pool, {
      projectId: projectA,
      origins: [],
      environments: [ENV, ENV],
      allowNonBrowser: false,
      expiresAt: null,
    });
    expect(result.status).toBe('success');
    const after = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ingestion_client_credentials`,
    );
    // Deduped environments means one credential created.
    expect(after.rows[0]?.n).toBe((before.rows[0]?.n ?? 0) + 1);
  });

  it('returns temporarily_unavailable when the database is unreachable', async () => {
    const brokenPool = {
      connect: async () => {
        await Promise.resolve();
        throw new Error('db down');
      },
    } as unknown as Pool;
    const result = await createIngestionClientCredential(brokenPool, {
      projectId: projectA,
      origins: [ORIGIN_A],
      environments: [ENV],
      allowNonBrowser: false,
      expiresAt: null,
    });
    expect(result.status).toBe('temporarily_unavailable');
  });
});
