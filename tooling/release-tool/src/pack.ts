import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import type { ValidationIssue, WorkspacePackage } from './contract.js';

/**
 * Reproducible pack verification: produce the real tarball via `pnpm pack`,
 * list its entries and assert the shipped contents match the release contract
 * (dist + types + package metadata, no src/test/coverage/secrets/fixtures).
 */

export interface PackedEntry {
  /** Entries prefixed with `package/`, forward-slash separated. */
  readonly files: readonly string[];
}

export function listTarballEntries(tarballPath: string): PackedEntry {
  const output = execFileSync('tar', ['-tzf', tarballPath], { encoding: 'utf8' });
  const files = output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line.endsWith('/') === false)
    .map((line) => (line.startsWith('package/') ? line : `package/${line}`));
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
  const hasLicense = /^package\/LICENSE(?:\.|$)/.test(entries.join('\n'));
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
        issues.push({ packageName: 'tarball', message: `forbidden entry in tarball: ${relative('package', entry) || entry}` });
        break;
      }
    }
  }
  return { ok: issues.length === 0, issues };
}

export interface PackResult {
  readonly packageName: string;
  readonly tarballPath: string;
  readonly assertion: TarballAssertion;
}

export function packPublicPackage(pkg: WorkspacePackage): PackResult {
  const packDir = join(tmpdir(), `aurora-pack-${process.pid}-${pkg.name.replace('/', '-')}`);
  mkdirSync(packDir, { recursive: true });
  try {
    execFileSync('pnpm', ['pack', '--pack-destination', packDir], {
      cwd: pkg.dir,
      encoding: 'utf8',
      stdio: 'pipe',
    });
  } finally {
    // tarball is read before cleanup in the caller path that inspects it.
  }
  const tarballs = readdirSync(packDir).filter((entry) => entry.endsWith('.tgz'));
  const tarballName = tarballs[0];
  if (tarballName === undefined) {
    throw new Error(`pnpm pack produced no tarball for ${pkg.name}`);
  }
  const tarballPath = join(packDir, tarballName);
  const { files } = listTarballEntries(tarballPath);
  const assertion = assertTarballContents(files, pkg.manifest.files ?? ['dist'], pkg.dir);
  return { packageName: pkg.name, tarballPath, assertion };
}

export function cleanupPackDir(path: string): void {
  rmSync(path, { recursive: true, force: true });
}
