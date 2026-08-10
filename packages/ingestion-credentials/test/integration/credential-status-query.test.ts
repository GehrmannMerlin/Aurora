import type { Pool } from 'pg';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { parseIngestionClientKey } from '../../src/client-key.js';
import {
  createIngestionClientCredential,
  disableIngestionClientCredential,
  queryProjectCredentialSafeStatus,
  revokeIngestionClientCredential,
} from '../../src/index.js';
import { assertIsTestDatabase, createTestPool, migrateUp, queryRow } from './helpers.js';

const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const describeDb = hasDb ? describe : describe.skip;

const projectA = '11111111-1111-1111-1111-111111111111';
const projectB = '22222222-2222-2222-2222-222222222222';
const projectEmpty = '99999999-9999-9999-9999-999999999999';
const ORIGIN_A = 'https://a.example.com';
const ENV = 'production';

describeDb('ingestion-credentials safe status query (real PostgreSQL 17)', () => {
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

  async function clearCredentials(): Promise<void> {
    await pool.query('DELETE FROM ingestion_client_credential_environments');
    await pool.query('DELETE FROM ingestion_client_credential_origins');
    await pool.query('DELETE FROM ingestion_client_credentials');
  }

  async function createCredential(projectId: string) {
    const created = await createIngestionClientCredential(pool, {
      projectId,
      origins: [ORIGIN_A],
      environments: [ENV],
      allowNonBrowser: false,
      expiresAt: null,
    });
    if (created.status !== 'success') throw new Error('create failed');
    const parsed = parseIngestionClientKey(created.clientKey);
    if (parsed === null) throw new Error('parse failed');
    return { keyId: parsed.keyId, secret: parsed.secret, clientKey: created.clientKey };
  }

  it('counts active, disabled and revoked credentials and returns the latest created time', async () => {
    await clearCredentials();
    await createCredential(projectA); // active
    const disabled = await createCredential(projectA);
    await disableIngestionClientCredential(pool, { keyId: disabled.keyId });
    const revoked = await createCredential(projectA);
    await revokeIngestionClientCredential(pool, { keyId: revoked.keyId });

    const status = await queryProjectCredentialSafeStatus(pool, { projectId: projectA });
    expect(status.activeCount).toBe(1);
    expect(status.disabledCount).toBe(1);
    expect(status.revokedCount).toBe(1);

    const latest = await queryRow<{ latest: string | null }>(
      pool,
      `SELECT MAX(created_at)::text AS latest
       FROM ingestion_client_credentials WHERE project_id = $1`,
      [projectA],
    );
    expect(status.latestCreatedAt).not.toBeNull();
    expect(new Date(status.latestCreatedAt ?? 0).getTime()).toBe(
      new Date(latest?.latest ?? 0).getTime(),
    );
  });

  it('never exposes key or secret material in the result (privacy negative)', async () => {
    await clearCredentials();
    const created = await createCredential(projectA);
    const status = await queryProjectCredentialSafeStatus(pool, { projectId: projectA });

    // The projection is exactly the four safe fields, nothing more.
    expect(Object.keys(status).sort()).toEqual([
      'activeCount',
      'disabledCount',
      'latestCreatedAt',
      'revokedCount',
    ]);
    const text = JSON.stringify(status);
    expect(text).not.toContain(created.clientKey);
    expect(text).not.toContain(created.keyId);
    expect(text).not.toContain(created.secret);
  });

  it('returns zero counts and null latestCreatedAt for an empty project', async () => {
    const status = await queryProjectCredentialSafeStatus(pool, { projectId: projectEmpty });
    expect(status).toEqual({
      activeCount: 0,
      disabledCount: 0,
      revokedCount: 0,
      latestCreatedAt: null,
    });
  });

  it('isolates credentials across projects', async () => {
    await clearCredentials();
    await createCredential(projectA);
    const revokedB = await createCredential(projectB);
    await revokeIngestionClientCredential(pool, { keyId: revokedB.keyId });

    const a = await queryProjectCredentialSafeStatus(pool, { projectId: projectA });
    const b = await queryProjectCredentialSafeStatus(pool, { projectId: projectB });
    expect(a.activeCount).toBe(1);
    expect(a.revokedCount).toBe(0);
    expect(b.activeCount).toBe(0);
    expect(b.revokedCount).toBe(1);
  });
});
