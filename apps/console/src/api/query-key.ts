import type { ScopeKey } from './scope.js';
import { scopeKeyString } from './scope.js';

export function queryKey(
  scope: ScopeKey,
  operationId: string,
  params: Readonly<Record<string, unknown>> = {},
): string {
  const suffix = Object.keys(params).length === 0 ? '' : `:${JSON.stringify(params)}`;
  return `${scopeKeyString(scope)}:${operationId}${suffix}`;
}
