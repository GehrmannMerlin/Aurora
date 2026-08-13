/**
 * Aurora public-preview migration runner.
 *
 * Deploy-only, plain ESM. Merges the repository's eleven migration packages
 * (ingestion-inbox ×3, ingestion-credentials ×1, processing-store ×10,
 * platform-identity ×3, platform-organization ×1, platform-project-governance
 * ×1, platform-credentials ×1, platform-audit ×1, platform-admin ×2,
 * platform-policy ×3, platform-releases ×1) into a stable combined directory
 * and applies them with node-pg-migrate over the preview DATABASE_URL.
 * node-pg-migrate bundles jiti, so the checked-in .ts migration files load
 * without tsx. This is the same combined-directory pattern proven by the
 * credentials/benchmark integration harnesses.
 *
 * Filename-collision note: node-pg-migrate v9 sorts by numeric timestamp, then
 * falls back to a numeric localeCompare of the full file name, so all files in
 * the combined directory must be uniquely named and preserve relative
 * timestamp order. Every migration here has a distinct full filename — the two
 * `1722500000002_*` files (inbox replay + client credentials) already coexist
 * in the deployed combined dir and tie-break deterministically by name. The
 * eight platform packages use distinct 1786…/1787…/17870… timestamps that sort
 * after the ingestion/processing set in dependency order (identity base →
 * organization → account-deletion → account-cleanup-steps → project-governance
 * → credentials → audit → platform-admins → platform-audit-events →
 * resource-policies/overrides/limits → releases), and the notifications
 * migration (1897000000001) sorts last. No filename prefixing is required.
 *
 * Incremental-update note: `checkOrder: false` below. The target database was
 * migrated up to the 2026-08-09 platform set (timestamps 1786…/1787…), while
 * the processing-store fingerprint/issue/alert/symbolization migrations
 * (1722500000007–0011) were added to the repo afterwards with smaller
 * timestamps. Their physical order is still correct (none of them has a
 * foreign key to a platform table), but node-pg-migrate's default order check
 * rejects any not-yet-run migration that sorts before an already-run one. For
 * an incremental deploy we intentionally disable that check and let it apply
 * only the not-yet-run migrations in filename order.
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
    // See header note: allow not-yet-run migrations that sort before an
    // already-run migration (physically correct, FK-free) on incremental deploys.
    checkOrder: false,
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
