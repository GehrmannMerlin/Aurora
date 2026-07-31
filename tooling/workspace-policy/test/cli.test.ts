import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { formatViolations } from '../src/format.js';
import { createWorkspaceFixture, type WorkspaceFixture, validManifest } from './fixtures.js';

const cliPath = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
let fixture: WorkspaceFixture | undefined;

afterEach(async () => fixture?.dispose());

function runCli(args: readonly string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', cliPath, ...args], {
    encoding: 'utf8',
  });
}

describe('Workspace policy CLI', () => {
  it('formats violations in stable, secret-free lines', () => {
    expect(
      formatViolations({
        ok: false,
        violations: [
          {
            code: 'undeclared-dependency',
            dependency: '@aurora/zeta',
            file: 'src/index.ts',
            message: 'ignored free-form text',
            packageName: '@aurora/alpha',
          },
        ],
      }),
    ).toBe('@aurora/alpha [undeclared-dependency] src/index.ts -> @aurora/zeta\n');
  });

  it('returns 0 with no output for a valid Workspace', async () => {
    fixture = await createWorkspaceFixture([
      { directory: 'tooling/valid', manifest: validManifest('@aurora/valid') },
    ]);
    const result = runCli(['--root', fixture.rootDir]);
    expect({ status: result.status, stdout: result.stdout, stderr: result.stderr }).toEqual({
      status: 0,
      stdout: '',
      stderr: '',
    });
  });

  it('returns 1 and deterministic stderr for policy violations', async () => {
    fixture = await createWorkspaceFixture([
      { directory: 'tooling/bad', manifest: { name: 'bad name' } },
    ]);
    const result = runCli(['--root', fixture.rootDir]);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('bad name [invalid-package-name]');
    expect(result.stderr).not.toContain(fixture.rootDir);
  });

  it('returns 2 for invalid arguments and unreadable roots', () => {
    const missingRoot = runCli([]);
    expect(missingRoot.status).toBe(2);
    expect(missingRoot.stderr).toBe('workspace-policy: expected --root <path>\n');

    const unreadable = runCli(['--root', 'does-not-exist']);
    expect(unreadable.status).toBe(2);
    expect(unreadable.stderr).toBe('workspace-policy: unable to read Workspace\n');
  });
});
