import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { runner } from 'node-pg-migrate';
import type { FastifyInstance } from 'fastify';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { buildIngestionApi } from '../../src/app.js';
import { loadIngestionApiConfig } from '../../src/configuration.js';
import { allowAllIngestionAdmissionPolicy } from '../../src/admission-policy.js';
import { createPostgresRequestAuthorizer } from '../../src/postgres-request-authorizer.js';
import { assertIsTestDatabase, createTestPool, queryRows, testDatabaseUrl } from './helpers.js';
import {
  generateFixtureClientKey,
  insertCredentialFixture,
} from '../../../../packages/ingestion-credentials/src/create-fixture.js';

const inboxMigrations = fileURLToPath(
  new URL('../../../../packages/ingestion-inbox/migrations', import.meta.url),
);
const credentialsMigrations = fileURLToPath(
  new URL('../../../../packages/ingestion-credentials/migrations', import.meta.url),
);
const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const describeDb = hasDb ? describe : describe.skip;

const projectA = '11111111-1111-1111-1111-111111111111';
const ORIGIN_A = 'https://a.example.com';
const ENV = 'production';

interface CountRow {
  n: number;
}

function validBatch(eventId: string): unknown {
  return {
    protocolVersion: 1,
    events: [
      {
        protocolVersion: 1,
        eventId,
        eventType: 'error',
        occurredAt: 1_800_000_000_000,
        body: {},
      },
    ],
  };
}

describeDb('ingestion-api credential-backed authorizer (real PostgreSQL 17)', () => {
  let pool: Awaited<ReturnType<typeof createTestPool>>;

  beforeAll(async () => {
    assertIsTestDatabase(testDatabaseUrl());
    pool = createTestPool();
    // Apply both migration sets in a single ordered run.
    const fsp = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'aurora-api-migrations-'));
    for (const source of [inboxMigrations, credentialsMigrations]) {
      for (const entry of await fsp.readdir(source)) {
        if (entry.endsWith('.ts')) await fsp.copyFile(path.join(source, entry), path.join(dir, entry));
      }
    }
    await runner({
      databaseUrl: testDatabaseUrl(),
      dir,
      direction: 'up',
      migrationsTable: 'pgmigrations',
      count: Infinity,
      log: () => undefined,
    });
    await pool.query('DELETE FROM event_inbox');
    await pool.query('DELETE FROM ingestion_client_credential_environments');
    await pool.query('DELETE FROM ingestion_client_credential_origins');
    await pool.query('DELETE FROM ingestion_client_credentials');
  });

  afterAll(async () => {
    await pool.end();
  });

  function buildApp(): FastifyInstance {
    return buildIngestionApi({
      config: loadIngestionApiConfig({
        HOST: '127.0.0.1',
        PORT: '0',
        REQUEST_BODY_LIMIT_BYTES: '1048576',
        GRACEFUL_SHUTDOWN_TIMEOUT_MS: '5000',
        DATABASE_URL: testDatabaseUrl(),
        LOG_ENABLED: 'false',
      }),
      pool,
      authorizer: createPostgresRequestAuthorizer(pool),
      admissionPolicy: allowAllIngestionAdmissionPolicy,
      requestIdProvider: () => 'req-cred-auth',
    });
  }

  async function insertActiveCredential(overrides?: {
    allowNonBrowser?: boolean;
    status?: 'active' | 'disabled' | 'revoked';
    expiresAt?: Date | null;
    origins?: string[];
    environments?: string[];
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
    } = { projectId: projectA, keyId, secret };
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

  async function post(
    app: FastifyInstance,
    clientKey: string,
    opts: { origin?: string | null; environment?: string },
  ) {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-aurora-client-key': clientKey,
      'x-aurora-environment': opts.environment ?? ENV,
    };
    if (opts.origin !== undefined && opts.origin !== null) {
      headers.origin = opts.origin;
    }
    return app.inject({
      method: 'POST',
      url: '/v1/batches',
      headers,
      payload: JSON.stringify(validBatch(`http-auth-${Math.random().toString(36).slice(2)}`)),
    });
  }

  it('authorizes a valid credential and persists to the inbox', async () => {
    const { clientKey } = await insertActiveCredential({
      origins: [ORIGIN_A],
      environments: [ENV],
    });
    const app = buildApp();
    const res = await post(app, clientKey, { origin: ORIGIN_A });
    expect(res.statusCode).toBe(200);
    const row = await queryRows<CountRow>(
      pool,
      `SELECT count(*)::int AS n FROM event_inbox WHERE project_id = $1`,
      [projectA],
    );
    expect(row[0]?.n).toBeGreaterThanOrEqual(1);
  });

  it('returns 401 for a wrong secret', async () => {
    const { keyId } = await insertActiveCredential({
      origins: [ORIGIN_A],
      environments: [ENV],
    });
    const wrong = generateFixtureClientKey();
    const app = buildApp();
    const res = await post(app, `aurora_ingest_${keyId}_${wrong.secret}`, { origin: ORIGIN_A });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 for an unknown key', async () => {
    const fake = generateFixtureClientKey();
    const app = buildApp();
    const res = await post(app, fake.clientKey, { origin: ORIGIN_A });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 for disabled, revoked, and expired credentials', async () => {
    const cases: {
      label: string;
      overrides: {
        status?: 'active' | 'disabled' | 'revoked';
        expiresAt?: Date;
        origins: string[];
        environments: string[];
      };
    }[] = [
      {
        label: 'disabled',
        overrides: { status: 'disabled', origins: [ORIGIN_A], environments: [ENV] },
      },
      {
        label: 'revoked',
        overrides: { status: 'revoked', origins: [ORIGIN_A], environments: [ENV] },
      },
      {
        label: 'expired',
        overrides: { expiresAt: new Date(Date.now() - 60_000), origins: [ORIGIN_A], environments: [ENV] },
      },
    ];
    for (const { label, overrides } of cases) {
      const { clientKey } = await insertActiveCredential(overrides);
      const app = buildApp();
      const res = await post(app, clientKey, { origin: ORIGIN_A });
      expect(res.statusCode, label).toBe(401);
    }
  });

  it('returns 403 when the origin is not allowed', async () => {
    const { clientKey } = await insertActiveCredential({
      origins: [ORIGIN_A],
      environments: [ENV],
    });
    const app = buildApp();
    const res = await post(app, clientKey, { origin: 'https://evil.example.com' });
    expect(res.statusCode).toBe(403);
  });

  it('returns 403 for a missing origin when non-browser is disallowed', async () => {
    const { clientKey } = await insertActiveCredential({
      allowNonBrowser: false,
      origins: [ORIGIN_A],
      environments: [ENV],
    });
    const app = buildApp();
    const res = await post(app, clientKey, { origin: null });
    expect(res.statusCode).toBe(403);
  });

  it('returns 403 when the environment is not allowed', async () => {
    const { clientKey } = await insertActiveCredential({
      origins: [ORIGIN_A],
      environments: ['staging'],
    });
    const app = buildApp();
    const res = await post(app, clientKey, { origin: ORIGIN_A, environment: 'production' });
    expect(res.statusCode).toBe(403);
  });

  it('does not persist to the inbox for an unauthorized request', async () => {
    const { keyId } = await insertActiveCredential({
      origins: [ORIGIN_A],
      environments: [ENV],
    });
    const wrong = generateFixtureClientKey();
    const before = await queryRows<CountRow>(
      pool,
      `SELECT count(*)::int AS n FROM event_inbox WHERE project_id = $1`,
      [projectA],
    );
    const app = buildApp();
    const res = await post(app, `aurora_ingest_${keyId}_${wrong.secret}`, { origin: ORIGIN_A });
    expect(res.statusCode).toBe(401);
    const after = await queryRows<CountRow>(
      pool,
      `SELECT count(*)::int AS n FROM event_inbox WHERE project_id = $1`,
      [projectA],
    );
    expect(after[0]?.n).toBe(before[0]?.n);
  });

  it('returns 503 when the verifier database is unavailable', async () => {
    const { clientKey } = await insertActiveCredential({
      origins: [ORIGIN_A],
      environments: [ENV],
    });
    // A separate app whose authorizer is backed by a broken pool.
    const brokenPool = new Pool({ connectionString: 'postgresql://invalid:invalid@127.0.0.1:1/x' });
    const brokenApp = buildIngestionApi({
      config: loadIngestionApiConfig({
        HOST: '127.0.0.1',
        PORT: '0',
        REQUEST_BODY_LIMIT_BYTES: '1048576',
        GRACEFUL_SHUTDOWN_TIMEOUT_MS: '5000',
        DATABASE_URL: testDatabaseUrl(),
        LOG_ENABLED: 'false',
      }),
      pool,
      authorizer: createPostgresRequestAuthorizer(brokenPool),
      admissionPolicy: allowAllIngestionAdmissionPolicy,
      requestIdProvider: () => 'req-broken',
    });
    const res = await post(brokenApp, clientKey, { origin: ORIGIN_A });
    expect(res.statusCode).toBe(503);
    await brokenPool.end().catch(() => undefined);
  });

  it('rejects a disabled credential with 401 and restores it after enable', async () => {
    const { clientKey, keyId } = await insertActiveCredential({
      origins: [ORIGIN_A],
      environments: [ENV],
    });
    const { disableIngestionClientCredential, enableIngestionClientCredential } = await import(
      '../../../../packages/ingestion-credentials/src/lifecycle-mutate.js'
    );
    const app = buildApp();
    // Disable -> 401.
    await disableIngestionClientCredential(pool, { keyId });
    const disabled = await post(app, clientKey, { origin: ORIGIN_A });
    expect(disabled.statusCode).toBe(401);
    // Enable -> 200.
    await enableIngestionClientCredential(pool, { keyId });
    const enabled = await post(app, clientKey, { origin: ORIGIN_A });
    expect(enabled.statusCode).toBe(200);
  });

  it('rejects a revoked credential with 401 and it cannot be re-enabled', async () => {
    const { clientKey, keyId } = await insertActiveCredential({
      origins: [ORIGIN_A],
      environments: [ENV],
    });
    const { revokeIngestionClientCredential, enableIngestionClientCredential } = await import(
      '../../../../packages/ingestion-credentials/src/lifecycle-mutate.js'
    );
    const app = buildApp();
    await revokeIngestionClientCredential(pool, { keyId });
    const revoked = await post(app, clientKey, { origin: ORIGIN_A });
    expect(revoked.statusCode).toBe(401);
    const enableResult = await enableIngestionClientCredential(pool, { keyId });
    expect(enableResult.status).toBe('invalid_state');
    const stillRevoked = await post(app, clientKey, { origin: ORIGIN_A });
    expect(stillRevoked.statusCode).toBe(401);
  });

  it('invalidates the old key over HTTP immediately after rotate', async () => {
    const { clientKey: oldKey, keyId } = await insertActiveCredential({
      origins: [ORIGIN_A],
      environments: [ENV],
    });
    const { rotateIngestionClientCredential } = await import(
      '../../../../packages/ingestion-credentials/src/lifecycle-rotate.js'
    );
    const app = buildApp();
    const rotateResult = await rotateIngestionClientCredential(pool, { keyId });
    expect(rotateResult.status).toBe('success');
    // Old key -> 401 immediately.
    const oldRes = await post(app, oldKey, { origin: ORIGIN_A });
    expect(oldRes.statusCode).toBe(401);
    // New key -> 200.
    if (rotateResult.status === 'success') {
      const newRes = await post(app, rotateResult.clientKey, { origin: ORIGIN_A });
      expect(newRes.statusCode).toBe(200);
    }
  });
});
