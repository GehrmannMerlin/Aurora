import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { runCli } from '../src/entry.js';

const FIXTURES = fileURLToPath(new URL('fixtures', import.meta.url));
const currentPath = join(FIXTURES, 'manifest-current.json');
const previousPath = join(FIXTURES, 'manifest-previous.json');
const migrationDirs = join(FIXTURES, 'migrations');

describe('CLI (dry-run)', () => {
  it('prints a valid deployment plan and exits 0', async () => {
    const code = await runCli([
      'plan',
      '--manifest',
      currentPath,
      '--previous',
      previousPath,
      '--targets',
      'services=ingestion-api,ingestion-worker;spa;migrate',
      '--migration-dirs',
      migrationDirs,
    ]);
    expect(code).toBe(0);
  });

  it('rejects a non-CI manifest with exit 1 and a stable error', async () => {
    await expect(
      runCli(['plan', '--manifest', join(FIXTURES, 'manifest-local.json')]),
    ).rejects.toThrow('release_manifest_build_source');
  });

  it('validate-migrations flags the destructive fixture and exits 1', async () => {
    const code = await runCli(['validate-migrations', '--migration-dirs', migrationDirs]);
    expect(code).toBe(1);
  });

  it('rejects an unknown command', async () => {
    await expect(runCli(['deploy'])).rejects.toThrow('release_cli_invalid_command');
  });

  it('renders a rollback plan from manifest + previous', async () => {
    const code = await runCli([
      'plan-rollback',
      '--manifest',
      currentPath,
      '--previous',
      previousPath,
    ]);
    expect(code).toBe(0);
  });

  it('requires --previous for plan-rollback', async () => {
    await expect(runCli(['plan-rollback', '--manifest', currentPath])).rejects.toThrow(
      'release_cli_manifest_required',
    );
  });

  it('requires --manifest for plan', async () => {
    await expect(runCli(['plan', '--targets', 'services=ingestion-api'])).rejects.toThrow(
      'release_cli_manifest_required',
    );
  });
});
