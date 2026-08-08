import { listServerOperations, type AuthLevel, type OperationDef } from '@aurora/platform-contract/server';

const operationsById = new Map<string, OperationDef>(
  listServerOperations().map((operation) => [operation.operationId, operation]),
);

/** Resolve a frozen operation definition by its stable operation id. */
export function operationById(operationId: string): OperationDef {
  const operation = operationsById.get(operationId);
  if (operation === undefined) {
    throw new Error(`unknown platform operation: ${operationId}`);
  }
  return operation;
}

/** Per-route security metadata derived from the operation registry. */
export interface RouteInfo {
  readonly authLevel: AuthLevel;
  readonly csrf: boolean;
}

const routeInfoByKey = new Map<string, RouteInfo>();
for (const operation of listServerOperations()) {
  routeInfoByKey.set(`${operation.method} ${operation.path}`, {
    authLevel: operation.authLevel,
    csrf: operation.request?.csrf ?? false,
  });
}

/**
 * Resolve the security metadata for an incoming request (method + path).
 * Returns undefined for non-operation routes (e.g. health).
 */
export function routeInfo(method: string, url: string): RouteInfo | undefined {
  const path = url.split('?')[0] ?? url;
  return routeInfoByKey.get(`${method} ${path}`);
}
