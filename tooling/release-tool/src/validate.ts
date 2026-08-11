import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  discoverPublicPackages,
  discoverWorkspacePackages,
  isPublicPackageName,
  type ValidationIssue,
  type WorkspacePackage,
} from './contract.js';
import { parseSemverResult } from './semver.js';

const WORKSPACE_RANGE = /^workspace:/;
const SEMVER_RANGE = /^(?:~|\^|>=?|<=?)?\s*[0-9]+\.[0-9]+\.[0-9]+(?:-[\w.-]+)?(?:[ |,][~^]?[0-9]+\.[0-9]+\.[0-9]+(?:-[\w.-]+)?)*$/;
const FORBIDDEN_RANGE = /^(?:file:|link:|workspace:|git\+|\/|\.\.\/|\.\/)/;

/** True when a dependency specifier is a valid `workspace:` or semver range. */
export function isAllowedDependencyRange(spec: string): boolean {
  if (WORKSPACE_RANGE.test(spec)) return true;
  if (FORBIDDEN_RANGE.test(spec)) return false;
  return SEMVER_RANGE.test(spec.trim());
}

function validatePublicPackage(pkg: WorkspacePackage, issues: ValidationIssue[]): void {
  const { name, dir, manifest } = pkg;
  if (manifest.version === undefined) {
    issues.push({ packageName: name, message: 'missing version' });
  } else if (parseSemverResult(manifest.version).ok === false) {
    issues.push({ packageName: name, message: `invalid semver version "${manifest.version}"` });
  }
  if (manifest.private === true) {
    issues.push({ packageName: name, message: 'must not be private (must be publishable)' });
  }
  if (manifest.publishConfig?.access !== 'public') {
    issues.push({ packageName: name, message: 'publishConfig.access must be "public"' });
  }
  const dot = manifest.exports?.['.'];
  if (typeof dot !== 'object' || dot === null) {
    issues.push({ packageName: name, message: 'exports["."] is missing' });
  } else {
    const entry = dot as Record<string, unknown>;
    if (typeof entry.types !== 'string') {
      issues.push({ packageName: name, message: 'exports["."].types is missing' });
    } else if (!existsSync(join(dir, entry.types))) {
      issues.push({ packageName: name, message: `exports["."].types target does not exist: ${entry.types}` });
    }
    if (typeof entry.import !== 'string') {
      issues.push({ packageName: name, message: 'exports["."].import is missing' });
    } else if (!existsSync(join(dir, entry.import))) {
      issues.push({ packageName: name, message: `exports["."].import target does not exist: ${entry.import}` });
    }
  }
  const files = manifest.files ?? [];
  if (!files.includes('dist')) {
    issues.push({ packageName: name, message: 'files must include "dist"' });
  }
  if (existsSync(join(dir, 'README.md')) && !files.includes('README.md')) {
    issues.push({ packageName: name, message: 'files must include README.md (present at package root)' });
  }
  const licenseEntries = readdirSync(dir).filter((entry) => /^LICENSE(?:\..+)?$/i.test(entry));
  for (const entry of licenseEntries) {
    if (!files.includes(entry)) {
      issues.push({ packageName: name, message: `files must include ${entry} (present at package root)` });
    }
  }
  if (manifest.license !== undefined && !/^[A-Za-z0-9. ()+-]+$/.test(manifest.license)) {
    issues.push({ packageName: name, message: `invalid SPDX-like license "${manifest.license}"` });
  }
  for (const section of ['dependencies', 'peerDependencies'] as const) {
    const deps = manifest[section];
    if (deps === undefined) continue;
    for (const [depName, spec] of Object.entries(deps)) {
      if (!isAllowedDependencyRange(spec)) {
        issues.push({
          packageName: name,
          message: `${section}.${depName} uses forbidden specifier "${spec}" (workspace:* or semver range only)`,
        });
      }
    }
  }
}

function validatePrivatePackages(
  packages: Map<string, WorkspacePackage>,
  issues: ValidationIssue[],
): void {
  for (const pkg of packages.values()) {
    if (isPublicPackageName(pkg.name)) continue;
    if (pkg.manifest.private !== true) {
      issues.push({ packageName: pkg.name, message: 'private (non-public) package must set private: true' });
    }
    if (pkg.manifest.publishConfig?.access === 'public') {
      issues.push({ packageName: pkg.name, message: 'private package must not set publishConfig.access = "public"' });
    }
  }
}

export interface ValidateResult {
  readonly ok: boolean;
  readonly issues: readonly ValidationIssue[];
  readonly publicChecked: number;
  readonly privateChecked: number;
}

export function validateWorkspace(root: string): ValidateResult {
  const issues: ValidationIssue[] = [];
  const publicPackages = discoverPublicPackages(root);
  if (publicPackages.size !== PUBLIC_PACKAGE_COUNT) {
    issues.push({
      packageName: 'workspace',
      message: `expected ${PUBLIC_PACKAGE_COUNT} public packages, found ${publicPackages.size}`,
    });
  }
  for (const pkg of publicPackages.values()) {
    validatePublicPackage(pkg, issues);
  }
  const all = discoverWorkspacePackages(root);
  const privatePackages = new Map(
    [...all.entries()].filter(([name]) => !isPublicPackageName(name)),
  );
  validatePrivatePackages(privatePackages, issues);
  return {
    ok: issues.length === 0,
    issues,
    publicChecked: publicPackages.size,
    privateChecked: privatePackages.size,
  };
}

const PUBLIC_PACKAGE_COUNT = 9;
