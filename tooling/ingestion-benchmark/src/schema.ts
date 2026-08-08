import { fileURLToPath } from 'node:url';
import { copyFile, mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool, type PoolClient } from 'pg';
import { runner } from 'node-pg-migrate';
import { schemaNameForRunId } from './run-id.js';

const inboxMigrationsDir = fileURLToPath(
  new URL('../../../packages/ingestion-inbox/migrations', import.meta.url),
);
const credentialsMigrationsDir = fileURLToPath(
  new URL('../../../packages/ingestion-credentials/migrations', import.meta.url),
);
const combinedMigrationsDir = fileURLToPath(new URL('../.migrations-combined', import.meta.url));

/** Rebuild a combined migrations directory with inbox + credentials migrations. */
async function ensureCombinedMigrationsDir(): Promise<string> {
  await rm(combinedMigrationsDir, { recursive: true, force: true });
  await mkdir(combinedMigrationsDir, { recursive: true });
  for (const source of [inboxMigrationsDir, credentialsMigrationsDir]) {
    for (const entry of await readdir(source)) {
      if (entry.endsWith('.ts')) {
        await copyFile(join(source, entry), join(combinedMigrationsDir, entry));
      }
    }
  }
  return combinedMigrationsDir;
}

/**
 * Create a fresh isolated schema for the run. All tables, migrations and
 * queries for the benchmark live inside this schema so a failed run never
 * affects other schemas or the shared test database.
 */
export async function createIsolatedSchema(adminPool: Pool, runId: string): Promise<string> {
  const schema = schemaNameForRunId(runId);
  await adminPool.query(`CREATE SCHEMA "${schema}"`);
  return schema;
}

/**
 * Apply the combined Inbox + credentials migrations inside the isolated schema
 * by pointing a dedicated migration client's search_path at that schema. The
 * SQL uses unqualified table names, so search_path makes the migrations and
 * repository statements resolve to the isolated schema only. A single runner
 * over a stable combined directory keeps node-pg-migrate's ordering check
 * consistent across runs.
 */
export async function applyMigrations(databaseUrl: string, runId: string): Promise<void> {
  const schema = schemaNameForRunId(runId);
  const dir = await ensureCombinedMigrationsDir();
  const adminPool = new Pool({ connectionString: databaseUrl });
  let client: PoolClient | undefined;
  try {
    client = await adminPool.connect();
    await client.query(`SET search_path TO "${schema}", public`);
    await runner({
      dbClient: client,
      dir,
      direction: 'up',
      migrationsTable: 'pgmigrations',
      schema,
      count: Infinity,
      log: () => undefined,
    });
  } finally {
    client?.release();
    await adminPool.end();
  }
}

/** A pg Pool whose search_path targets the isolated schema. */
export function schemaPool(databaseUrl: string, runId: string, max?: number): Pool {
  const schema = schemaNameForRunId(runId);
  return new Pool({
    connectionString: databaseUrl,
    options: `-c search_path=${schema},public`,
    ...(max === undefined ? {} : { max }),
  });
}

/**
 * Drop the isolated schema and verify no residual schema remains. Fails loudly
 * if the schema still exists afterwards.
 */
export async function dropIsolatedSchema(adminPool: Pool, runId: string): Promise<void> {
  const schema = schemaNameForRunId(runId);
  await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  const residual = await adminPool.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM pg_namespace WHERE nspname = $1',
    [schema],
  );
  const count = residual.rows[0]?.n ?? 0;
  if (count !== 0) {
    throw new Error(`isolated schema was not removed: ${schema}`);
  }
}
