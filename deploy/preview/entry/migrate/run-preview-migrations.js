/**
 * Aurora public-preview migration runner.
 *
 * Deploy-only, plain ESM. Merges every repository migration package into a
 * stable combined directory and applies it with node-pg-migrate over the
 * preview DATABASE_URL. The production ledger contains one frozen historical
 * ordering exception, so the runner validates that exact sequence and only
 * disables the upstream order check for that known-compatible baseline.
 *
 * Filename-collision note: node-pg-migrate v9 sorts by numeric timestamp, then
 * falls back to a numeric localeCompare of the full file name, so all files in
 * the combined directory must be uniquely named and preserve relative
 * timestamp order. Every migration here has a distinct full filename — the two
 * `1722500000002_*` files (inbox replay + client credentials) already coexist
 * in the deployed combined dir and tie-break deterministically by name. The
 * frozen production baseline ends at `1897000000001_notifications`; all new
 * migrations must sort after that name. No filename prefixing is required.
 */
import { copyFile, mkdir, readdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';

import { analyzeMigrationOrder, compareMigrationNames } from './migration-order.js';

// node-pg-migrate is a devDependency of apps/ingestion-api, whose own
// node_modules resolve it under pnpm's strict layout. Anchor a require here so
// ESM resolution works regardless of this runner's file location.
const here = dirname(fileURLToPath(import.meta.url));

// this file: <repo>/deploy/preview/entry/migrate/run-preview-migrations.js
// repo root = ../../../../ from here (migrate → entry → preview → deploy → root).
const REPO_ROOT = join(here, '..', '..', '..', '..');

const require = createRequire(join(REPO_ROOT, 'apps', 'ingestion-api', 'package.json'));
const { runner } = require('node-pg-migrate');
const { Client } = require('pg');

const MIGRATION_SOURCES = [
  join(REPO_ROOT, 'packages', 'ingestion-inbox', 'migrations'),
  join(REPO_ROOT, 'packages', 'ingestion-credentials', 'migrations'),
  join(REPO_ROOT, 'packages', 'processing-store', 'migrations'),
  join(REPO_ROOT, 'packages', 'platform-identity', 'migrations'),
  join(REPO_ROOT, 'packages', 'platform-organization', 'migrations'),
  join(REPO_ROOT, 'packages', 'platform-project-governance', 'migrations'),
  join(REPO_ROOT, 'packages', 'platform-credentials', 'migrations'),
  join(REPO_ROOT, 'packages', 'platform-audit', 'migrations'),
  join(REPO_ROOT, 'packages', 'platform-admin', 'migrations'),
  join(REPO_ROOT, 'packages', 'platform-policy', 'migrations'),
  join(REPO_ROOT, 'packages', 'platform-releases', 'migrations'),
];

const COMBINED_DIR = join(REPO_ROOT, '.migrations-combined-preview');

function migrationSchema() {
  const value = process.env.MIGRATIONS_SCHEMA ?? 'public';
  if (!/^[a-z_][a-z0-9_]*$/u.test(value)) {
    throw new Error('MIGRATIONS_SCHEMA must be a simple PostgreSQL identifier');
  }
  return value;
}

async function ensureCombinedDir() {
  await rm(COMBINED_DIR, { recursive: true, force: true });
  await mkdir(COMBINED_DIR, { recursive: true });
  const filenames = [];
  for (const source of MIGRATION_SOURCES) {
    for (const entry of await readdir(source)) {
      if (entry.endsWith('.ts')) {
        filenames.push(entry);
      }
    }
  }
  filenames.sort(compareMigrationNames);
  const seen = new Set();
  for (const entry of filenames) {
    if (seen.has(entry)) {
      throw new Error(`duplicate migration filename across packages: ${entry}`);
    }
    seen.add(entry);
  }
  for (const source of MIGRATION_SOURCES) {
    const entries = new Set(await readdir(source));
    for (const entry of filenames) {
      if (entries.has(entry)) {
        await copyFile(join(source, entry), join(COMBINED_DIR, entry));
      }
    }
  }
  return { dir: COMBINED_DIR, filenames };
}

async function readExecutedMigrations(databaseUrl, schema) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const table = await client.query('SELECT to_regclass($1) AS name', [`${schema}.pgmigrations`]);
    if (table.rows[0]?.name === null) {
      return [];
    }
    const result = await client.query(`SELECT name FROM "${schema}".pgmigrations ORDER BY id ASC`);
    return result.rows.map((row) => String(row.name));
  } finally {
    await client.end();
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl === '') {
    throw new Error('DATABASE_URL must be set to run preview migrations');
  }
  const schema = migrationSchema();
  const { dir, filenames } = await ensureCombinedDir();
  const executedNames = await readExecutedMigrations(databaseUrl, schema);
  const order = analyzeMigrationOrder(filenames, executedNames);
  const executed = await runner({
    databaseUrl,
    dir,
    direction: 'up',
    migrationsTable: 'pgmigrations',
    migrationsSchema: schema,
    schema,
    count: Infinity,
    log: () => undefined,
    checkOrder: order.checkOrder,
  });
  console.log(
    `preview migrations up: ${String(executed.length)} executed; order=${order.compatibility}; pending-before=${String(order.pendingNames.length)}`,
  );
}

main()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`preview migration failed: ${message}`);
    process.exitCode = 1;
  });
