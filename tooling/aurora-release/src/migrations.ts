/**
 * OPS-05 forward-compatible Migration pipeline (release-migration-and-rollback.md §3).
 *
 * Node-pg-migrate timestamped migration files live per-package under the
 * package `migrations` directory (e.g. `1722500000000_event-inbox.ts`). The
 * pipeline:
 *
 * 1. `discoverMigrationSet` collects every migration file across the ordered
 *    package dirs and sorts them globally by version prefix.
 * 2. `validateForwardCompatibility` guards the release is forward-compatible:
 *    versions are ordered and unique, every file exists, and no up-migration
 *    contains destructive DDL (DROP TABLE / DROP COLUMN / pgm.dropTable /
 *    pgm.dropColumn). Destructive changes must ship in a separate contract
 *    release after old readers have exited (expand/contract).
 * 3. `renderForwardMigrationCommand` renders one `node-pg-migrate up`
 *    (forward-only, never `down`) command per migration dir.
 */

import { readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

export interface MigrationFile {
  readonly dir: string;
  readonly version: string;
  readonly file: string;
}

const VERSION_PREFIX = /^(\d{8,20})[_-]/;

/** Destructive DDL markers that break forward compatibility when present in an up-migration. */
const DESTRUCTIVE_UP = /\b(pgm\.(dropTable|dropColumn)|\bDROP\s+TABLE\b|\bDROP\s+COLUMN\b)\b/i;

export async function discoverMigrationSet(
  dirs: readonly string[],
): Promise<readonly MigrationFile[]> {
  const found: MigrationFile[] = [];
  for (const dir of dirs) {
    let entries: readonly string[];
    try {
      entries = await readdir(dir);
    } catch {
      throw new Error(`release_migration_dir_missing: ${dir}`);
    }
    for (const file of entries) {
      const match = VERSION_PREFIX.exec(file);
      if (match?.[1] === undefined) continue;
      found.push({ dir, version: match[1], file });
    }
  }
  found.sort((a, b) =>
    a.version < b.version ? -1 : a.version > b.version ? 1 : a.file.localeCompare(b.file),
  );
  return Object.freeze(found);
}

export function validateForwardCompatibility(
  migrations: readonly MigrationFile[],
): readonly string[] {
  const violations: string[] = [];
  for (let i = 1; i < migrations.length; i += 1) {
    const previous = migrations[i - 1];
    const current = migrations[i];
    if (previous !== undefined && current !== undefined && current.version < previous.version) {
      violations.push('out-of-order');
    }
  }
  const seen = new Set<string>();
  for (const migration of migrations) {
    if (seen.has(migration.version)) violations.push('duplicate');
    seen.add(migration.version);
  }
  for (const migration of migrations) {
    let body: string;
    try {
      body = readFileSync(join(migration.dir, migration.file), 'utf8');
    } catch {
      violations.push('missing-file');
      continue;
    }
    if (DESTRUCTIVE_UP.test(body)) violations.push('destructive-up');
  }
  return Object.freeze([...new Set(violations)]);
}

export function renderForwardMigrationCommand(
  migrations: readonly MigrationFile[],
  databaseUrlEnv: string,
): readonly string[] {
  const dirs = [...new Set(migrations.map((migration) => migration.dir))];
  return Object.freeze(
    dirs.map((dir) => `node-pg-migrate up --migrations-dir ${dir} --env ${databaseUrlEnv}`),
  );
}
