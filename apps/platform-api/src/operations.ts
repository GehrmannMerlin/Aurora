import type { FastifyRequest } from 'fastify';
import {
  listServerOperations,
  type AuthLevel,
  type OperationDef,
} from '@aurora/platform-contract/server';

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

/**
 * Resolve the security metadata for an incoming request using the MATCHED
 * Fastify route pattern rather than the concrete URL. Fastify exposes the
 * colon-style route pattern (e.g. `/organizations/:organizationId/projects`)
 * as `request.routeOptions.url` in the onRequest hook, and the contract
 * registry keys are colon-style. Resolving against the concrete URL (which
 * carries the real path params) would silently miss every parameterized route
 * and skip its CSRF/session gate — a security bypass. `routeOptions.url` is
 * undefined for unmatched (404) requests, so fall back to the raw URL (which
 * still won't match any registry key).
 */
export function requestRouteInfo(request: FastifyRequest): RouteInfo | undefined {
  const url = request.routeOptions.url ?? request.url;
  return routeInfo(request.method, url);
}
