import { dependencyMap } from './manifest.js';
import { collectAuroraImports } from './imports.js';
import type { WorkspacePackage, WorkspaceViolation } from './types.js';

function auroraPackageName(specifier: string): string {
  return specifier.split('/').slice(0, 2).join('/');
}

function exportedSubpaths(workspacePackage: WorkspacePackage): ReadonlySet<string> {
  const value = workspacePackage.manifest.exports;
  if (typeof value === 'string') return new Set(['.']);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return new Set();
  return new Set(Object.keys(value));
}

function packageLayer(workspacePackage: WorkspacePackage): string | undefined {
  const value = workspacePackage.manifest.aurora;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  if (!('layer' in value)) return undefined;
  const layer = value.layer;
  return typeof layer === 'string' ? layer : undefined;
}

const allowedLocalDependencyLayers: ReadonlyMap<string, ReadonlySet<string>> = new Map<
  string,
  ReadonlySet<string>
>([
  ['protocol', new Set<string>()],
  ['sdk-core', new Set<string>(['protocol'])],
  ['sdk-browser', new Set<string>(['sdk-core', 'protocol'])],
  ['sdk-plugin', new Set<string>(['sdk-core', 'sdk-browser', 'protocol'])],
  ['sdk-framework', new Set<string>(['sdk-core', 'sdk-browser', 'protocol'])],
  ['data', new Set<string>(['protocol'])],
  ['service', new Set<string>(['protocol', 'data', 'tooling', 'contract'])],
  ['contract', new Set<string>(['protocol'])],
  ['tooling', new Set<string>(['service', 'data', 'protocol', 'tooling', 'contract'])],
  ['console', new Set<string>(['contract', 'tooling'])],
]);

function layerDependencyViolations(
  workspacePackage: WorkspacePackage,
  localDependencies: ReadonlySet<string>,
  packagesByName: ReadonlyMap<string, WorkspacePackage>,
): readonly WorkspaceViolation[] {
  const sourceLayer = packageLayer(workspacePackage);
  if (sourceLayer === undefined) return [];
  const allowedTargets = allowedLocalDependencyLayers.get(sourceLayer);
  if (allowedTargets === undefined) return [];
  return [...localDependencies].sort().flatMap((dependency) => {
    const target = packagesByName.get(dependency);
    const targetLayer = target === undefined ? undefined : packageLayer(target);
    if (targetLayer !== undefined && allowedTargets.has(targetLayer)) return [];
    return [
      {
        code: 'forbidden-layer-dependency' as const,
        dependency,
        packageName: workspacePackage.name,
        message: `${sourceLayer} package must not depend on ${targetLayer ?? 'unclassified'} package ${dependency}`,
      },
    ];
  });
}

function cycleMembers(graph: ReadonlyMap<string, ReadonlySet<string>>): ReadonlySet<string> {
  const members = new Set<string>();
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const stack: string[] = [];

  const visit = (name: string): void => {
    if (visited.has(name)) return;
    if (visiting.has(name)) {
      const start = stack.indexOf(name);
      for (const member of stack.slice(start)) members.add(member);
      return;
    }
    visiting.add(name);
    stack.push(name);
    for (const dependency of graph.get(name) ?? []) visit(dependency);
    stack.pop();
    visiting.delete(name);
    visited.add(name);
  };

  for (const name of graph.keys()) visit(name);
  return members;
}

export async function dependencyViolations(
  packages: readonly WorkspacePackage[],
): Promise<readonly WorkspaceViolation[]> {
  const byName = new Map(packages.map((item) => [item.name, item]));
  const graph = new Map<string, ReadonlySet<string>>();
  const violations: WorkspaceViolation[] = [];

  for (const workspacePackage of packages) {
    const declared = dependencyMap(workspacePackage.manifest);
    const localDependencies = new Set(
      Object.keys(declared).filter((dependency) => byName.has(dependency)),
    );
    graph.set(workspacePackage.name, localDependencies);
    violations.push(...layerDependencyViolations(workspacePackage, localDependencies, byName));

    for (const packageImport of await collectAuroraImports(workspacePackage.directory)) {
      const dependency = auroraPackageName(packageImport.specifier);
      const target = byName.get(dependency);
      if (target === undefined) continue;
      if (dependency !== workspacePackage.name && !(dependency in declared)) {
        violations.push({
          code: 'undeclared-dependency',
          dependency,
          file: packageImport.file,
          packageName: workspacePackage.name,
          message: `Import ${packageImport.specifier} is not declared in package.json`,
        });
        continue;
      }

      const suffix = packageImport.specifier.slice(dependency.length);
      const subpath = suffix === '' ? '.' : `.${suffix}`;
      const explicitlyPrivate = suffix.includes('/src/') || suffix.includes('/internal/');
      if (explicitlyPrivate || !exportedSubpaths(target).has(subpath)) {
        violations.push({
          code: 'private-path-import',
          dependency: packageImport.specifier,
          file: packageImport.file,
          packageName: workspacePackage.name,
          message: `Import ${packageImport.specifier} is not a public export`,
        });
      }
    }
  }

  for (const packageName of cycleMembers(graph)) {
    violations.push({
      code: 'dependency-cycle',
      packageName,
      message: `Package participates in a local dependency cycle: ${packageName}`,
    });
  }
  return violations;
}
