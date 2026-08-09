import {
  buildRequest,
  ClientInputError,
  parseResponse,
  PLATFORM_OPERATIONS,
  type OperationDef,
} from '@aurora/platform-contract/client';
import type { ScopeKey } from './scope.js';
import { ApiError, normalizeProblem } from './errors.js';

/**
 * Request input for a platform operation. `pathParams` are interpolated into the
 * contract path template (e.g. `organizationListProjects` →
 * `/api/platform/v1/organizations/:organizationId/projects`) and validated
 * against the operation's pathParams schema. The generated `buildRequest` only
 * validates query/body, so path interpolation lives in this layer.
 */
export interface PlatformRequestInput {
  query?: unknown;
  body?: unknown;
  pathParams?: Readonly<Record<string, string>>;
}

export interface RequestOptions {
  scope: ScopeKey;
  signal?: AbortSignal;
  /**
   * Synchronous CSRF token (accepted ADR-030 决定细节 5). Required for CSRF-
   * protected state-changing operations. Public commands (register/login/
   * request-reset) do not bind a CSRF secret and must not send this header.
   * The value is held only for the duration of the request — never persisted.
   */
  csrf?: string;
}

const operationById = new Map(PLATFORM_OPERATIONS.map((op) => [op.operationId, op]));

/**
 * Generate a client-side idempotency key (contract: exactly 36 chars). A UUID is
 * used when the runtime provides it; a deterministic-length base36 fallback keeps
 * every submission contract-valid in test/legacy environments.
 */
export function createIdempotencyKey(): string {
  const cryptoObject = globalThis.crypto as (Crypto & { randomUUID?: () => string }) | undefined;
  if (cryptoObject !== undefined && typeof cryptoObject.randomUUID === 'function') {
    try {
      const uuid = cryptoObject.randomUUID();
      if (typeof uuid === 'string' && uuid.length === 36) return uuid;
    } catch {
      // fall through to the deterministic fallback
    }
  }
  const prefix = `k${Date.now().toString(36)}`;
  return `${prefix}${Math.random().toString(36).slice(2)}`.slice(0, 36).padEnd(36, '0');
}

function interpolatePathParams(
  op: OperationDef,
  path: string,
  pathParams: Readonly<Record<string, string>> | undefined,
): string {
  if (op.request?.pathParams === undefined) {
    if (pathParams !== undefined && Object.keys(pathParams).length > 0) {
      throw new ApiError({
        code: 'structural_error',
        message: `Operation ${op.operationId} accepts no path parameters`,
      });
    }
    return path;
  }
  const paramsResult = op.request.pathParams.zod.safeParse(pathParams ?? {});
  if (!paramsResult.success) {
    throw new ApiError({
      code: 'structural_error',
      message: `Invalid path parameters for ${op.operationId}`,
    });
  }
  let interpolated = path;
  for (const [key, value] of Object.entries(
    paramsResult.data as Readonly<Record<string, string>>,
  )) {
    interpolated = interpolated.replace(`:${key}`, encodeURIComponent(value));
  }
  return interpolated;
}

export async function platformRequest<T>(
  operationId: string,
  input: PlatformRequestInput,
  options: RequestOptions,
): Promise<T> {
  const op = operationById.get(operationId);
  if (op === undefined) {
    throw new ApiError({ code: 'structural_error', message: `Unknown operation ${operationId}` });
  }
  let request;
  try {
    request = buildRequest(op, { query: input.query, body: input.body });
  } catch (error) {
    if (error instanceof ClientInputError) {
      throw new ApiError({ code: 'structural_error', message: error.message });
    }
    throw error;
  }
  const url = new URL(
    interpolatePathParams(op, request.path, input.pathParams),
    window.location.origin,
  );
  if (request.query !== undefined) {
    for (const [key, value] of Object.entries(request.query as Readonly<Record<string, unknown>>)) {
      url.searchParams.set(key, String(value));
    }
  }
  let response: Response;
  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (request.body !== undefined) headers['Content-Type'] = 'application/json';
    if (options.csrf !== undefined) headers['X-Aurora-CSRF'] = options.csrf;
    const init: RequestInit = {
      method: request.method,
      headers,
      credentials: 'same-origin',
    };
    if (options.signal !== undefined) init.signal = options.signal;
    if (request.body !== undefined) init.body = JSON.stringify(request.body);
    response = await fetch(url.toString(), init);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new ApiError({ code: 'network_error', message: 'Network request failed.' });
  }
  const raw: unknown = await response.json().catch(() => null);
  const result = parseResponse(op, raw, response.status);
  if (!result.ok) throw normalizeProblem(result.problem, response.status);
  return result.data as T;
}
