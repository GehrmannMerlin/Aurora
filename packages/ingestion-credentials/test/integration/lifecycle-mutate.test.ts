import type { Pool } from 'pg';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createIngestionClientCredential } from '../../src/lifecycle-create.js';
import {
  disableIngestionClientCredential,
  enableIngestionClientCredential,
  revokeIngestionClientCredential,
} from '../../src/lifecycle-mutate.js';
import { verifyIngestionCredential } from '../../src/verification.js';
import { parseIngestionClientKey } from '../../src/client-key.js';
import { assertIsTestDatabase, createTestPool, migrateUp, queryRow } from './helpers.js';

const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const describeDb = hasDb ? describe : describe.skip;

const projectA = '11111111-1111-1111-1111-111111111111';
const ORIGIN_A = 'https://a.example.com';
const ENV = 'production';

describeDb('ingestion-credentials lifecycle mutate (real PostgreSQL 17)', () => {
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

  async function createKeyId() {
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
    return { keyId: parsed.keyId, clientKey: created.clientKey };
  }

  it('disables an active credential (auth fails)', async () => {
    const { keyId, clientKey } = await createKeyId();
    const result = await disableIngestionClientCredential(pool, { keyId });
    expect(result.status).toBe('success');
    const auth = await verifyIngestionCredential(pool, {
      clientKey,
      environment: ENV,
      origin: ORIGIN_A,
    });
    expect(auth.status).toBe('unauthenticated');
  });

  it('disable is idempotent', async () => {
    const { keyId } = await createKeyId();
    await disableIngestionClientCredential(pool, { keyId });
    const second = await disableIngestionClientCredential(pool, { keyId });
    expect(second.status).toBe('success');
  });

  it('re-enables a disabled credential (auth restored)', async () => {
    const { keyId, clientKey } = await createKeyId();
    await disableIngestionClientCredential(pool, { keyId });
    const result = await enableIngestionClientCredential(pool, { keyId });
    expect(result.status).toBe('success');
    const auth = await verifyIngestionCredential(pool, {
      clientKey,
      environment: ENV,
      origin: ORIGIN_A,
    });
    expect(auth.status).toBe('authorized');
  });

  it('enable is idempotent for an active credential', async () => {
    const { keyId } = await createKeyId();
    const result = await enableIngestionClientCredential(pool, { keyId });
    expect(result.status).toBe('success');
  });

  it('cannot enable an expired disabled credential', async () => {
    const { keyId } = await createKeyId();
    await disableIngestionClientCredential(pool, { keyId });
    await pool.query(
      `UPDATE ingestion_client_credentials SET expires_at = now() - interval '1 second'
       WHERE key_id = $1`,
      [keyId],
    );
    const result = await enableIngestionClientCredential(pool, { keyId });
    expect(result.status).toBe('expired');
  });

  it('cannot enable a revoked credential', async () => {
    const { keyId } = await createKeyId();
    await revokeIngestionClientCredential(pool, { keyId });
    const result = await enableIngestionClientCredential(pool, { keyId });
    expect(result.status).toBe('invalid_state');
  });

  it('revokes an active credential (auth fails permanently)', async () => {
    const { keyId, clientKey } = await createKeyId();
    const result = await revokeIngestionClientCredential(pool, { keyId });
    expect(result.status).toBe('success');
    const auth = await verifyIngestionCredential(pool, {
      clientKey,
      environment: ENV,
      origin: ORIGIN_A,
    });
    expect(auth.status).toBe('unauthenticated');
  });

  it('revoke is idempotent', async () => {
    const { keyId } = await createKeyId();
    await revokeIngestionClientCredential(pool, { keyId });
    const second = await revokeIngestionClientCredential(pool, { keyId });
    expect(second.status).toBe('success');
  });

  it('revoked cannot be re-enabled or rotated', async () => {
    const { keyId } = await createKeyId();
    await revokeIngestionClientCredential(pool, { keyId });
    const enableResult = await enableIngestionClientCredential(pool, { keyId });
    expect(enableResult.status).toBe('invalid_state');
    const disableResult = await disableIngestionClientCredential(pool, { keyId });
    expect(disableResult.status).toBe('invalid_state');
  });

  it('returns not_found for an unknown keyId', async () => {
    const result = await disableIngestionClientCredential(pool, {
      keyId: 'ZZZZZZZZZZZZZZZZZZZZZZ',
    });
    expect(result.status).toBe('not_found');
  });

  it('preserves digest and policy through disable/enable cycles', async () => {
    const { keyId } = await createKeyId();
    const before = await queryRow<{ secret_digest: Buffer; allow_non_browser: boolean }>(
      pool,
      `SELECT secret_digest, allow_non_browser FROM ingestion_client_credentials WHERE key_id = $1`,
      [keyId],
    );
    await disableIngestionClientCredential(pool, { keyId });
    await enableIngestionClientCredential(pool, { keyId });
    const after = await queryRow<{ secret_digest: Buffer; allow_non_browser: boolean }>(
      pool,
      `SELECT secret_digest, allow_non_browser FROM ingestion_client_credentials WHERE key_id = $1`,
      [keyId],
    );
    expect(after?.secret_digest.equals(before?.secret_digest ?? Buffer.alloc(0))).toBe(true);
    expect(after?.allow_non_browser).toBe(before?.allow_non_browser);
  });
});
