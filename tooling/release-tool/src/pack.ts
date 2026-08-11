import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import type { ValidationIssue, WorkspacePackage } from './contract.js';

/**
 * Reproducible pack verification: compute the exact tarball file list via
 * `npm pack --dry-run --json` (cross-platform, no tar dependency) and assert
 * the shipped contents match the release contract (dist + types + package
 * metadata, no src/test/coverage/secrets/fixtures).
 */

export interface PackedEntry {
  /** Entries prefixed with `package/`, forward-slash separated. */
  readonly files: readonly string[];
}

export function listPackedFiles(packageDir: string): PackedEntry {
  const isWindows = process.platform === 'win32';
  const output = execFileSync(
    isWindows ? 'npm.cmd' : 'npm',
    ['pack', '--dry-run', '--json'],
    {
      cwd: packageDir,
      encoding: 'utf8',
      stdio: 'pipe',
      // `.cmd` shims on Windows can only be spawned through a shell.
      shell: isWindows,
    },
  );
  const parsed = JSON.parse(output) as Array<{ filename?: string; files?: Array<{ path?: string }> }>;
  const entry = parsed[0];
  const files = (entry?.files ?? [])
    .map((file) => file.path)
    .filter((path): path is string => typeof path === 'string' && path.length > 0)
    .map((path) => (path.startsWith('package/') ? path : `package/${path}`));
  return { files };
}

export interface TarballAssertion {
  readonly ok: boolean;
  readonly issues: readonly ValidationIssue[];
}

function entryMatches(entry: string, glob: string): boolean {
  const parts = glob.split('**');
  let pattern = '';
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (part === undefined) continue;
    const escaped = part.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
    pattern += i < parts.length - 1 ? `${escaped}.*` : escaped;
  }
  return new RegExp(`^${pattern}$`).test(entry);
}

/**
 * Assert a packed entry list satisfies the release contract. `expectedEntries`
 * is the manifest `files` array (e.g. `["dist","README.md"]`); the tarball must
 * contain dist/** and package.json, and (when declared or present) README/LICENSE.
 */
export function assertTarballContents(
  entries: readonly string[],
  expectedEntries: readonly string[],
  rootDir: string,
): TarballAssertion {
  const issues: ValidationIssue[] = [];
  if (!entries.some((entry) => /^package\/dist\//.test(entry))) {
    issues.push({ packageName: 'tarball', message: 'tarball does not contain dist/**' });
  }
  if (!entries.includes('package/package.json')) {
    issues.push({ packageName: 'tarball', message: 'tarball does not contain package.json' });
  }
  if (expectedEntries.includes('README.md') && !entries.includes('package/README.md')) {
    issues.push({ packageName: 'tarball', message: 'tarball does not contain README.md (declared in files)' });
  }
  const hasLicense = entries.some((entry) => /^package\/LICENSE(?:\.|$)/.test(entry));
  const licenseOnDisk = readdirSync(rootDir).some((entry) => /^LICENSE(?:\..+)?$/i.test(entry));
  if (licenseOnDisk && !hasLicense) {
    issues.push({ packageName: 'tarball', message: 'tarball does not contain LICENSE file present at package root' });
  }
  const forbidden = [
    'package/src/**',
    'package/test/**',
    'package/test-browser/**',
    'package/coverage/**',
    'package/.env',
    'package/*.tgz',
    'package/*.tsbuildinfo',
    'package/vitest.config.*',
    'package/playwright.config.*',
    'package/tsconfig*.json',
  ];
  for (const entry of entries) {
    for (const glob of forbidden) {
      if (entryMatches(entry, glob)) {
        issues.push({
          packageName: 'tarball',
          message: `forbidden entry in tarball: ${entry.replace(/^package\//, '')}`,
        });
        break;
      }
    }
  }
  return { ok: issues.length === 0, issues };
}

export interface PackResult {
  readonly packageName: string;
  readonly assertion: TarballAssertion;
  readonly fileCount: number;
}

export function packPublicPackage(pkg: WorkspacePackage): PackResult {
  const { files } = listPackedFiles(pkg.dir);
  const assertion = assertTarballContents(files, pkg.manifest.files ?? ['dist'], pkg.dir);
  return { packageName: pkg.name, assertion, fileCount: files.length };
}
