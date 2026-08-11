import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import {
  discoverMigrationSet,
  renderForwardMigrationCommand,
  validateForwardCompatibility,
  type MigrationFile,
} from '../src/migrations.js';

const FIXTURES = fileURLToPath(new URL('fixtures/migrations', import.meta.url));

const ordered: readonly [MigrationFile, MigrationFile] = [
  { dir: FIXTURES, version: '1720000000001', file: '1720000000001_init.js' },
  { dir: FIXTURES, version: '1720000000002', file: '1720000000002_add-column.js' },
];

describe('migration set discovery', () => {
  it('discovers and globally orders timestamped migration files across dirs', async () => {
    const migrations = await discoverMigrationSet([FIXTURES]);
    expect(migrations.map((m) => m.version)).toEqual([
      '1720000000001',
      '1720000000002',
      '1720000000003',
    ]);
  });

  it('throws a stable error for a missing migrations dir', async () => {
    await expect(discoverMigrationSet(['packages/does-not-exist/migrations'])).rejects.toThrow(
      'release_migration_dir_missing',
    );
  });
});

describe('forward-compatibility validation', () => {
  it('returns no violations for additive, ordered migrations', () => {
    expect(validateForwardCompatibility(ordered)).toEqual([]);
  });

  it('flags out-of-order versions', () => {
    const bad = [ordered[1], ordered[0]];
    expect(validateForwardCompatibility(bad)).toContain('out-of-order');
  });

  it('flags duplicate versions', () => {
    const duplicate = [ordered[0], ordered[0]];
    expect(validateForwardCompatibility(duplicate)).toContain('duplicate');
  });

  it('flags missing migration files', () => {
    const missing = [{ dir: FIXTURES, version: '1720000000099', file: 'absent.js' }];
    expect(validateForwardCompatibility(missing)).toContain('missing-file');
  });

  it('flags destructive up-migrations (DROP TABLE / DROP COLUMN / pgm.drop*)', async () => {
    const migrations = await discoverMigrationSet([FIXTURES]);
    const violations = validateForwardCompatibility(migrations);
    expect(violations).toContain('destructive-up');
  });

  it('deduplicates repeated violations', async () => {
    const migrations = await discoverMigrationSet([FIXTURES]);
    const drop = migrations.at(-1);
    if (drop === undefined) throw new Error('expected fixture migration');
    const violations = validateForwardCompatibility([drop, drop]);
    const dupCount = violations.filter((v) => v === 'destructive-up').length;
    expect(dupCount).toBe(1);
  });
});

describe('forward migration command rendering', () => {
  it('renders one forward-only node-pg-migrate up command per migration dir', () => {
    const twoDirs: readonly MigrationFile[] = [
      { dir: 'packages/ingestion-inbox/migrations', version: '1720000000001', file: 'x.js' },
      { dir: 'packages/processing-store/migrations', version: '1720000000002', file: 'y.js' },
    ];
    const commands = renderForwardMigrationCommand(twoDirs, 'DATABASE_URL');
    expect(commands).toHaveLength(2);
    for (const command of commands) {
      expect(command).toContain('node-pg-migrate up');
      expect(command).toContain('DATABASE_URL');
      expect(command).not.toMatch(/\bdown\b/);
    }
  });
});
