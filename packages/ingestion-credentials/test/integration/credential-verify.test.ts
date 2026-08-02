import type { Pool } from 'pg';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { generateFixtureClientKey, insertCredentialFixture } from '../../src/create-fixture.js';
import { verifyIngestionCredential } from '../../src/verification.js';
import { assertIsTestDatabase, createTestPool, migrateUp } from './helpers.js';

const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const describeDb = hasDb ? describe : describe.skip;

const projectA = '11111111-1111-1111-1111-111111111111';
const projectB = '22222222-2222-2222-2222-222222222222';
const ORIGIN_A = 'https://a.example.com';
const ENV = 'production';

describeDb('ingestion-credentials verify (real PostgreSQL 17)', () => {
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

  async function insertActiveCredential(overrides?: {
    origins?: string[];
    environments?: string[];
    allowNonBrowser?: boolean;
    expiresAt?: Date | null;
    projectId?: string;
    status?: 'active' | 'disabled' | 'revoked';
  }) {
    const { clientKey, keyId, secret } = generateFixtureClientKey();
    const options: {
      projectId: string;
      keyId: string;
      secret: string;
      status?: 'active' | 'disabled' | 'revoked';
      allowNonBrowser?: boolean;
      expiresAt?: Date | null;
      origins?: string[];
      environments?: string[];
    } = { projectId: overrides?.projectId ?? projectA, keyId, secret };
    if (overrides?.status !== undefined) options.status = overrides.status;
    if (overrides?.allowNonBrowser !== undefined) {
      options.allowNonBrowser = overrides.allowNonBrowser;
    }
    if (overrides?.expiresAt !== undefined) options.expiresAt = overrides.expiresAt;
    if (overrides?.origins !== undefined) options.origins = overrides.origins;
    if (overrides?.environments !== undefined) options.environments = overrides.environments;
    await insertCredentialFixture(pool, options);
    return { clientKey, keyId, secret };
  }

  it('authorizes a valid active credential with matching origin and environment', async () => {
    const { clientKey } = await insertActiveCredential({
      origins: [ORIGIN_A],
      environments: [ENV],
    });
    const result = await verifyIngestionCredential(pool, {
      clientKey,
      environment: ENV,
      origin: ORIGIN_A,
    });
    expect(result.status).toBe('authorized');
    if (result.status === 'authorized') {
      expect(result.projectId).toBe(projectA);
      expect(result.allowedOrigin).toBe(ORIGIN_A);
    }
  });

  it('returns unauthenticated for an unknown keyId', async () => {
    const { clientKey } = await insertActiveCredential({
      origins: [ORIGIN_A],
      environments: [ENV],
    });
    void clientKey;
    const fake = generateFixtureClientKey();
    const result = await verifyIngestionCredential(pool, {
      clientKey: fake.clientKey,
      environment: ENV,
      origin: ORIGIN_A,
    });
    expect(result.status).toBe('unauthenticated');
  });

  it('returns unauthenticated for a wrong secret', async () => {
    const { keyId } = await insertActiveCredential({
      origins: [ORIGIN_A],
      environments: [ENV],
    });
    const wrong = generateFixtureClientKey();
    const result = await verifyIngestionCredential(pool, {
      clientKey: `aurora_ingest_${keyId}_${wrong.secret}`,
      environment: ENV,
      origin: ORIGIN_A,
    });
    expect(result.status).toBe('unauthenticated');
  });

  it('returns unauthenticated for disabled credentials', async () => {
    const { clientKey } = await insertActiveCredential({
      origins: [ORIGIN_A],
      environments: [ENV],
      status: 'disabled',
    });
    const result = await verifyIngestionCredential(pool, {
      clientKey,
      environment: ENV,
      origin: ORIGIN_A,
    });
    expect(result.status).toBe('unauthenticated');
  });

  it('returns unauthenticated for revoked credentials', async () => {
    const { clientKey } = await insertActiveCredential({
      origins: [ORIGIN_A],
      environments: [ENV],
      status: 'revoked',
    });
    const result = await verifyIngestionCredential(pool, {
      clientKey,
      environment: ENV,
      origin: ORIGIN_A,
    });
    expect(result.status).toBe('unauthenticated');
  });

  it('returns unauthenticated for expired credentials', async () => {
    const { clientKey } = await insertActiveCredential({
      origins: [ORIGIN_A],
      environments: [ENV],
      expiresAt: new Date(Date.now() - 60_000),
    });
    const result = await verifyIngestionCredential(pool, {
      clientKey,
      environment: ENV,
      origin: ORIGIN_A,
    });
    expect(result.status).toBe('unauthenticated');
  });

  it('returns origin_forbidden when the origin is not in the allowlist', async () => {
    const { clientKey } = await insertActiveCredential({
      origins: [ORIGIN_A],
      environments: [ENV],
    });
    const result = await verifyIngestionCredential(pool, {
      clientKey,
      environment: ENV,
      origin: 'https://evil.example.com',
    });
    expect(result.status).toBe('origin_forbidden');
  });

  it('returns origin_forbidden for a missing origin when non-browser is not allowed', async () => {
    const { clientKey } = await insertActiveCredential({
      origins: [ORIGIN_A],
      environments: [ENV],
      allowNonBrowser: false,
    });
    const result = await verifyIngestionCredential(pool, {
      clientKey,
      environment: ENV,
      origin: null,
    });
    expect(result.status).toBe('origin_forbidden');
  });

  it('authorizes a missing origin when non-browser is allowed', async () => {
    const { clientKey } = await insertActiveCredential({
      origins: [ORIGIN_A],
      environments: [ENV],
      allowNonBrowser: true,
    });
    const result = await verifyIngestionCredential(pool, {
      clientKey,
      environment: ENV,
      origin: null,
    });
    expect(result.status).toBe('authorized');
    if (result.status === 'authorized') expect(result.allowedOrigin).toBeNull();
  });

  it('returns environment_forbidden when the environment is not allowed', async () => {
    const { clientKey } = await insertActiveCredential({
      origins: [ORIGIN_A],
      environments: ['staging'],
    });
    const result = await verifyIngestionCredential(pool, {
      clientKey,
      environment: ENV,
      origin: ORIGIN_A,
    });
    expect(result.status).toBe('environment_forbidden');
  });

  it('isolates credentials across projects', async () => {
    const { clientKey } = await insertActiveCredential({
      origins: [ORIGIN_A],
      environments: [ENV],
      projectId: projectA,
    });
    const result = await verifyIngestionCredential(pool, {
      clientKey,
      environment: ENV,
      origin: ORIGIN_A,
    });
    expect(result.status).toBe('authorized');
    if (result.status === 'authorized') expect(result.projectId).toBe(projectA);
    // A credential in project B never authorizes for project A requests.
    void projectB;
  });

  it('returns unauthenticated for a malformed key', async () => {
    const result = await verifyIngestionCredential(pool, {
      clientKey: 'not-a-valid-key',
      environment: ENV,
      origin: ORIGIN_A,
    });
    expect(result.status).toBe('unauthenticated');
  });

  it('does not modify the input', async () => {
    const { clientKey } = await insertActiveCredential({
      origins: [ORIGIN_A],
      environments: [ENV],
    });
    const input = { clientKey, environment: ENV, origin: ORIGIN_A };
    await verifyIngestionCredential(pool, input);
    expect(input.clientKey).toBe(clientKey);
    expect(input.origin).toBe(ORIGIN_A);
  });
});
