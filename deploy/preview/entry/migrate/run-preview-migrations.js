/**
 * Aurora public-preview migration runner.
 *
 * Deploy-only, plain ESM. Merges the repository's three migration packages
 * (ingestion-inbox ×3, ingestion-credentials ×1, processing-store ×4) into a
 * stable combined directory and applies them with node-pg-migrate over the
 * preview DATABASE_URL. node-pg-migrate bundles jiti, so the checked-in .ts
 * migration files load without tsx. This is the same combined-directory
 * pattern proven by the credentials/benchmark integration harnesses.
 */
import { copyFile, mkdir, readdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';

// node-pg-migrate is a devDependency of apps/ingestion-api, whose own
// node_modules resolve it under pnpm's strict layout. Anchor a require here so
// ESM resolution works regardless of this runner's file location.
const require = createRequire('file:///workspace/apps/ingestion-api/package.json');
const { runner } = require('node-pg-migrate');

const here = dirname(fileURLToPath(import.meta.url));

// this file: <repo>/deploy/preview/entry/migrate/run-preview-migrations.js
// repo root = ../../../../ from here (migrate → entry → preview → deploy → root).
const REPO_ROOT = join(here, '..', '..', '..', '..');

const MIGRATION_SOURCES = [
  join(REPO_ROOT, 'packages', 'ingestion-inbox', 'migrations'),
  join(REPO_ROOT, 'packages', 'ingestion-credentials', 'migrations'),
  join(REPO_ROOT, 'packages', 'processing-store', 'migrations'),
];

const COMBINED_DIR = join(REPO_ROOT, '.migrations-combined-preview');

async function ensureCombinedDir() {
  await rm(COMBINED_DIR, { recursive: true, force: true });
  await mkdir(COMBINED_DIR, { recursive: true });
  for (const source of MIGRATION_SOURCES) {
    for (const entry of await readdir(source)) {
      if (entry.endsWith('.ts')) {
        await copyFile(join(source, entry), join(COMBINED_DIR, entry));
      }
    }
  }
  return COMBINED_DIR;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl === '') {
    throw new Error('DATABASE_URL must be set to run preview migrations');
  }
  const dir = await ensureCombinedDir();
  const executed = await runner({
    databaseUrl,
    dir,
    direction: 'up',
    migrationsTable: 'pgmigrations',
    count: Infinity,
    log: () => undefined,
  });
  console.log(`preview migrations up: ${String(executed.length)} executed`);
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
