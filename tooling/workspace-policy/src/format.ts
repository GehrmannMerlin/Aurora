import type { WorkspaceCheckResult } from './types.js';

export function formatViolations(result: WorkspaceCheckResult): string {
  return result.violations
    .map((violation) => {
      const file = violation.file === undefined ? '' : ` ${violation.file.replaceAll('\\', '/')}`;
      const dependency = violation.dependency === undefined ? '' : ` -> ${violation.dependency}`;
      return `${violation.packageName} [${violation.code}]${file}${dependency}`;
    })
    .join('\n')
    .concat(result.violations.length === 0 ? '' : '\n');
}
