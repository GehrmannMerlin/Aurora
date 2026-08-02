import type { Pool } from 'pg';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createIngestionClientCredential } from '../../src/lifecycle-create.js';
import { rotateIngestionClientCredential } from '../../src/lifecycle-rotate.js';
import { disableIngestionClientCredential } from '../../src/lifecycle-mutate.js';
import { verifyIngestionCredential } from '../../src/verification.js';
import { parseIngestionClientKey } from '../../src/client-key.js';
import { assertIsTestDatabase, createTestPool, migrateUp, queryRow } from './helpers.js';

const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const describeDb = hasDb ? describe : describe.skip;

const projectA = '11111111-1111-1111-1111-111111111111';
const ORIGIN_A = 'https://a.example.com';
const ENV = 'production';

describeDb('ingestion-credentials lifecycle rotate (real PostgreSQL 17)', () => {
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

  async function createActive(overrides?: { status?: 'active' | 'disabled' | 'revoked' }) {
    const created = await createIngestionClientCredential(pool, {
      projectId: projectA,
      origins: [ORIGIN_A],
      environments: [ENV],
      allowNonBrowser: false,
      expiresAt: null,
    });
    if (created.status !== 'success') throw new Error('create failed');
    const parsed = parseIngestionClientKey(created.clientKey);
    if (parsed === null) throw new Error('parse failed');
    if (overrides?.status === 'disabled') {
      await disableIngestionClientCredential(pool, { keyId: parsed.keyId });
    }
    return { clientKey: created.clientKey, keyId: parsed.keyId };
  }

  it('rotates an active credential and invalidates the old key immediately', async () => {
    const { clientKey: oldKey, keyId } = await createActive();
    const result = await rotateIngestionClientCredential(pool, { keyId });
    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.clientKey).not.toBe(oldKey);
    // New key authenticates.
    const newAuth = await verifyIngestionCredential(pool, {
      clientKey: result.clientKey,
      environment: ENV,
      origin: ORIGIN_A,
    });
    expect(newAuth.status).toBe('authorized');
    // Old key returns 401-equivalent unauthenticated.
    const oldAuth = await verifyIngestionCredential(pool, {
      clientKey: oldKey,
      environment: ENV,
      origin: ORIGIN_A,
    });
    expect(oldAuth.status).toBe('unauthenticated');
    // Only one active credential for the project with that key chain.
    const activeCount = await queryRow<{ n: number }>(
      pool,
      `SELECT count(*)::int AS n FROM ingestion_client_credentials
       WHERE project_id = $1 AND status = 'active'`,
      [projectA],
    );
    expect(activeCount?.n).toBe(1);
  });

  it('rotates a disabled credential (new active, old revoked)', async () => {
    const { keyId } = await createActive({ status: 'disabled' });
    const result = await rotateIngestionClientCredential(pool, { keyId });
    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    const auth = await verifyIngestionCredential(pool, {
      clientKey: result.clientKey,
      environment: ENV,
      origin: ORIGIN_A,
    });
    expect(auth.status).toBe('authorized');
    const oldStatus = await queryRow<{ status: string }>(
      pool,
      `SELECT status FROM ingestion_client_credentials WHERE key_id = $1`,
      [keyId],
    );
    expect(oldStatus?.status).toBe('revoked');
  });

  it('rejects rotating a revoked credential', async () => {
    const { keyId } = await createActive();
    await rotateIngestionClientCredential(pool, { keyId }); // revokes it
    const result = await rotateIngestionClientCredential(pool, { keyId });
    expect(result.status).toBe('invalid_state');
  });

  it('rejects rotating an expired credential', async () => {
    const { keyId } = await createActive();
    // Force expiry.
    await pool.query(
      `UPDATE ingestion_client_credentials SET expires_at = now() - interval '1 second'
       WHERE key_id = $1`,
      [keyId],
    );
    const result = await rotateIngestionClientCredential(pool, { keyId });
    expect(result.status).toBe('expired');
  });

  it('inherits origin, environment, allowNonBrowser, and expiresAt', async () => {
    const created = await createIngestionClientCredential(pool, {
      projectId: projectA,
      origins: [ORIGIN_A, 'https://b.example.com'],
      environments: [ENV, 'staging'],
      allowNonBrowser: true,
      expiresAt: new Date(Date.now() + 3600_000),
    });
    if (created.status !== 'success') return;
    const parsed = parseIngestionClientKey(created.clientKey);
    if (parsed === null) return;
    const result = await rotateIngestionClientCredential(pool, { keyId: parsed.keyId });
    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.metadata.allowNonBrowser).toBe(true);
    expect(result.metadata.expiresAt).not.toBeNull();
    // New key inherits both origins.
    for (const origin of [ORIGIN_A, 'https://b.example.com']) {
      const auth = await verifyIngestionCredential(pool, {
        clientKey: result.clientKey,
        environment: 'staging',
        origin,
      });
      expect(auth.status).toBe('authorized');
    }
  });

  it('returns not_found for an unknown keyId', async () => {
    const result = await rotateIngestionClientCredential(pool, {
      keyId: 'ZZZZZZZZZZZZZZZZZZZZZZ',
    });
    expect(result.status).toBe('not_found');
  });

  it('two concurrent rotates produce exactly one new active credential', async () => {
    const { keyId } = await createActive();
    const before = await queryRow<{ n: number }>(
      pool,
      `SELECT count(*)::int AS n FROM ingestion_client_credentials
       WHERE project_id = $1 AND status = 'active'`,
      [projectA],
    );
    const [a, b] = await Promise.all([
      rotateIngestionClientCredential(pool, { keyId }),
      rotateIngestionClientCredential(pool, { keyId }),
    ]);
    const successCount = [a, b].filter((r) => r.status === 'success').length;
    expect(successCount).toBe(1);
    const after = await queryRow<{ n: number }>(
      pool,
      `SELECT count(*)::int AS n FROM ingestion_client_credentials
       WHERE project_id = $1 AND status = 'active'`,
      [projectA],
    );
    // The concurrent rotate must not have increased the active count (one new
    // active replaces the one being rotated; the loser finds it already revoked).
    expect(after?.n).toBe(before?.n);
  });
});
