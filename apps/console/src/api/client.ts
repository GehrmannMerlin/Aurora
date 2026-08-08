import {
  buildRequest,
  ClientInputError,
  parseResponse,
  PLATFORM_OPERATIONS,
} from '@aurora/platform-contract/client';
import type { ScopeKey } from './scope.js';
import { ApiError, normalizeProblem } from './errors.js';

export interface RequestOptions {
  scope: ScopeKey;
  signal?: AbortSignal;
}

const operationById = new Map(PLATFORM_OPERATIONS.map((op) => [op.operationId, op]));

export async function platformRequest<T>(
  operationId: string,
  input: { query?: unknown; body?: unknown },
  options: RequestOptions,
): Promise<T> {
  const op = operationById.get(operationId);
  if (op === undefined) {
    throw new ApiError({ code: 'structural_error', message: `Unknown operation ${operationId}` });
  }
  let request;
  try {
    request = buildRequest(op, input);
  } catch (error) {
    if (error instanceof ClientInputError) {
      throw new ApiError({ code: 'structural_error', message: error.message });
    }
    throw error;
  }
  const url = new URL(request.path, window.location.origin);
  if (request.query !== undefined) {
    for (const [key, value] of Object.entries(request.query as Readonly<Record<string, unknown>>)) {
      url.searchParams.set(key, String(value));
    }
  }
  let response: Response;
  try {
    const init: RequestInit = {
      method: request.method,
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    };
    if (options.signal !== undefined) init.signal = options.signal;
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
