import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ValidationIssue, WorkspacePackage } from './contract.js';
import type { VersionPlanEntry } from './version.js';

/**
 * Compatibility gate for the release chain:
 *  - public `exports` subpaths must resolve to real files (no dangling paths);
 *  - the wire protocol is decoupled from npm package versions: the protocol
 *    package's `CURRENT_PROTOCOL_VERSION` must stay `1` and its supported set
 *    unchanged (PRO-06); a package version bump must never change the protocol;
 *  - every `workspace:*` dependency of a public package must resolve to a real
 *    version in the release plan (no dangling workspace specifier at publish).
 */

const PROTOCOL_CONSTANTS_REL = 'packages/event-schema/src/constants.ts';

export function checkExportsTypes(publicPackages: Map<string, WorkspacePackage>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const pkg of publicPackages.values()) {
    const exports = pkg.manifest.exports;
    if (exports === undefined) {
      issues.push({ packageName: pkg.name, message: 'missing exports' });
      continue;
    }
    for (const [subpath, spec] of Object.entries(exports)) {
      const entry = spec as Record<string, unknown>;
      const types = typeof entry.types === 'string' ? entry.types : undefined;
      const importTarget = typeof entry.import === 'string' ? entry.import : undefined;
      if (types !== undefined && !existsSync(join(pkg.dir, types))) {
        issues.push({ packageName: pkg.name, message: `exports${subpath}.types target missing: ${types}` });
      }
      if (importTarget !== undefined && !existsSync(join(pkg.dir, importTarget))) {
        issues.push({ packageName: pkg.name, message: `exports${subpath}.import target missing: ${importTarget}` });
      }
    }
  }
  return issues;
}

export interface ProtocolVersionCheck {
  readonly currentVersion: number;
  readonly supportedVersions: readonly number[];
}

export function readProtocolVersion(root: string): ProtocolVersionCheck {
  const source = readFileSync(join(root, PROTOCOL_CONSTANTS_REL), 'utf8');
  const current = /CURRENT_PROTOCOL_VERSION\s*=\s*(\d+)/.exec(source);
  const currentVersion = current === null ? -1 : Number(current[1]);
  const supportedMatch = /SUPPORTED_PROTOCOL_VERSIONS\s*=\s*\[([^\]]*)\]/.exec(source);
  const supportedLiteral = supportedMatch === null ? '' : (supportedMatch[1] ?? '').trim();
  const supported =
    supportedLiteral === 'CURRENT_PROTOCOL_VERSION'
      ? [currentVersion]
      : supportedLiteral
          .split(',')
          .map((part) => part.trim())
          .filter((part) => /^\d+$/.test(part))
          .map(Number);
  return { currentVersion, supportedVersions: supported };
}

export function checkProtocolDecoupling(root: string): ValidationIssue[] {
  const { currentVersion, supportedVersions } = readProtocolVersion(root);
  if (currentVersion !== 1) {
    return [{
      packageName: '@aurora/event-schema',
      message: `CURRENT_PROTOCOL_VERSION changed to ${currentVersion}; wire protocol change requires a new ADR (PRO-06), not an npm version bump`,
    }];
  }
  if (supportedVersions.length !== 1 || supportedVersions[0] !== 1) {
    return [{
      packageName: '@aurora/event-schema',
      message: `SUPPORTED_PROTOCOL_VERSIONS changed to [${supportedVersions.join(', ')}]; protocol change requires a new ADR (PRO-06)`,
    }];
  }
  return [];
}

export function checkWorkspaceDepRewritePlan(
  publicPackages: Map<string, WorkspacePackage>,
  plan: readonly VersionPlanEntry[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const finalVersions = new Map(plan.map((entry) => [entry.packageName, entry.to]));
  for (const pkg of publicPackages.values()) {
    const deps = pkg.manifest.dependencies ?? {};
    for (const [depName, spec] of Object.entries(deps)) {
      if (spec !== 'workspace:*') continue;
      if (!depName.startsWith('@aurora/')) continue;
      const version = finalVersions.get(depName);
      if (version === undefined) {
        issues.push({
          packageName: pkg.name,
          message: `workspace:* dependency ${depName} is not resolved by the release plan; it must be planned or already published`,
        });
      }
    }
  }
  return issues;
}
