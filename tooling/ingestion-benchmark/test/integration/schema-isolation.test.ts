import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createIsolatedSchema,
  applyMigrations,
  dropIsolatedSchema,
  schemaPool,
} from '../../src/schema.js';
import { generateRunId, schemaNameForRunId } from '../../src/run-id.js';
import { assertIsTestDatabase, createTestPool, queryRows, testDatabaseUrl } from './helpers.js';

const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const describeDb = hasDb ? describe : describe.skip;

describeDb('benchmark schema isolation (real PostgreSQL 17)', () => {
  let adminPool: Pool;
  let runId: string;

  beforeAll(() => {
    assertIsTestDatabase(testDatabaseUrl());
    adminPool = createTestPool();
    runId = generateRunId();
  });

  afterAll(async () => {
    await dropIsolatedSchema(adminPool, runId).catch(() => undefined);
    await adminPool.end();
  });

  it('creates, migrates and drops an isolated schema without residue', async () => {
    const schema = await createIsolatedSchema(adminPool, runId);
    expect(schema).toBe(schemaNameForRunId(runId));
    await applyMigrations(testDatabaseUrl(), runId);

    const probe = schemaPool(testDatabaseUrl(), runId);
    const tables = await queryRows<{ table: string }>(
      probe,
      `SELECT table_name::text AS table FROM information_schema.tables
       WHERE table_schema = $1 ORDER BY table_name`,
      [schema],
    );
    expect(tables.map((t) => t.table)).toContain('event_inbox');
    expect(tables.map((t) => t.table)).toContain('ingestion_client_credentials');
    await probe.end();

    await dropIsolatedSchema(adminPool, runId);
    const residual = await queryRows<{ n: number }>(
      adminPool,
      'SELECT count(*)::int AS n FROM pg_namespace WHERE nspname = $1',
      [schema],
    );
    expect(residual[0]?.n).toBe(0);
  });

  it('drops the isolated schema even when it contains data', async () => {
    const runId2 = generateRunId();
    await createIsolatedSchema(adminPool, runId2);
    await applyMigrations(testDatabaseUrl(), runId2);
    const probe = schemaPool(testDatabaseUrl(), runId2);
    await probe.query(
      `INSERT INTO event_inbox
        (project_id, event_id, event_type, protocol_version, envelope,
         received_at, available_at, created_at, updated_at)
       VALUES ('11111111-1111-1111-1111-111111111111', 'evt', 'error', 1, '{}'::jsonb,
               now(), now(), now(), now())`,
    );
    await probe.end();
    await dropIsolatedSchema(adminPool, runId2);
  });
});
