import type { PackageManifest, WorkspacePackage, WorkspaceViolation } from './types.js';

const packageNamePattern = /^@aurora\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
const requiredFields = [
  'private',
  'type',
  'exports',
  'files',
  'engines',
  'scripts',
  'aurora',
] as const;
const dependencyFields = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;

function asStringMap(value: unknown): Readonly<Record<string, string>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

export function manifestViolations(
  workspacePackage: WorkspacePackage,
  localNames: ReadonlySet<string>,
): readonly WorkspaceViolation[] {
  const { manifest, name } = workspacePackage;
  const violations: WorkspaceViolation[] = [];
  if (!packageNamePattern.test(name)) {
    violations.push({
      code: 'invalid-package-name',
      packageName: name,
      message: `Invalid package name: ${name}`,
    });
  }
  for (const field of requiredFields) {
    if (!(field in manifest)) {
      violations.push({
        code: 'missing-package-field',
        packageName: name,
        message: `Missing package.json field: ${field}`,
      });
    }
  }
  for (const field of dependencyFields) {
    for (const [dependency, range] of Object.entries(asStringMap(manifest[field]))) {
      if (localNames.has(dependency) && !range.startsWith('workspace:')) {
        violations.push({
          code: 'non-workspace-local-dependency',
          dependency,
          packageName: name,
          message: `Local dependency ${dependency} must use workspace: protocol`,
        });
      }
    }
  }
  return violations;
}

export function dependencyMap(manifest: PackageManifest): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const field of dependencyFields) Object.assign(result, asStringMap(manifest[field]));
  return result;
}
