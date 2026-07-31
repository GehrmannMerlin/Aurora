import { discoverWorkspacePackages } from './discover.js';
import { findEnvironmentViolations } from './environment.js';
import { dependencyViolations } from './graph.js';
import { manifestViolations } from './manifest.js';
import type { WorkspaceCheckResult, WorkspaceViolation } from './types.js';

export function sortViolations(
  violations: readonly WorkspaceViolation[],
): readonly WorkspaceViolation[] {
  return [...violations].sort((left, right) =>
    [left.packageName, left.code, left.file ?? '', left.dependency ?? '']
      .join('\0')
      .localeCompare(
        [right.packageName, right.code, right.file ?? '', right.dependency ?? ''].join('\0'),
      ),
  );
}

export async function checkWorkspace(rootDir: string): Promise<WorkspaceCheckResult> {
  const packages = await discoverWorkspacePackages(rootDir);
  const localNames = new Set(packages.map(({ name }) => name));
  const environmentViolations = await Promise.all(
    packages.map((item) => findEnvironmentViolations(item)),
  );
  const violations = sortViolations([
    ...packages.flatMap((item) => manifestViolations(item, localNames)),
    ...(await dependencyViolations(packages)),
    ...environmentViolations.flat(),
  ]);
  return { ok: violations.length === 0, violations };
}
