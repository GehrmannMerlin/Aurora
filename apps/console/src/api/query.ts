import { PLATFORM_OPERATIONS } from '@aurora/platform-contract/client';
import type { ScopeKey } from './scope.js';
import { scopeKeyString } from './scope.js';
import { queryKey } from './query-key.js';
import { platformRequest, type PlatformRequestInput, type RequestOptions } from './client.js';
import { requestCache } from './cache.js';
import { ApiError } from './errors.js';

export interface ExecuteQueryOptions {
  operationId: string;
  input?: PlatformRequestInput;
  scope: ScopeKey;
  signal?: AbortSignal;
  retry?: boolean;
  csrf?: string;
}

const inFlight = new Map<string, Promise<unknown>>();
const generationByKey = new Map<string, number>();

function currentGeneration(key: string): number {
  return generationByKey.get(key) ?? 0;
}

export function invalidateQueryKey(key: string): void {
  requestCache.invalidateKey(key);
  generationByKey.set(key, currentGeneration(key) + 1);
}

export function invalidateScope(scope: ScopeKey): void {
  requestCache.invalidateScope(scope);
  const prefix = `${scopeKeyString(scope)}:`;
  for (const key of generationByKey.keys()) {
    if (key.startsWith(prefix)) generationByKey.set(key, currentGeneration(key) + 1);
  }
  for (const key of inFlight.keys()) {
    if (key.startsWith(prefix)) generationByKey.set(key, currentGeneration(key) + 1);
  }
}

export async function executeQuery<T>(options: ExecuteQueryOptions): Promise<T> {
  const input = options.input ?? {};
  const key = queryKey(
    options.scope,
    options.operationId,
    (input.query ?? {}) as Readonly<Record<string, unknown>>,
  );
  const cached = requestCache.get<T>(key);
  if (cached !== undefined) return cached.data;

  const existing = inFlight.get(key);
  if (existing !== undefined) return existing as Promise<T>;

  const generation = currentGeneration(key);
  const promise: Promise<T> = performRequest(key, generation, options, input);
  inFlight.set(key, promise);
  try {
    return await promise;
  } finally {
    if (inFlight.get(key) === promise) inFlight.delete(key);
  }
}

function requestOptions(options: ExecuteQueryOptions): RequestOptions {
  const result: RequestOptions = { scope: options.scope };
  if (options.signal !== undefined) result.signal = options.signal;
  if (options.csrf !== undefined) result.csrf = options.csrf;
  return result;
}

async function performRequest<T>(
  key: string,
  generation: number,
  options: ExecuteQueryOptions,
  input: PlatformRequestInput,
): Promise<T> {
  try {
    const data = await platformRequest<T>(options.operationId, input, requestOptions(options));
    if (generation === currentGeneration(key)) requestCache.set(key, data, options.scope);
    return data;
  } catch (error) {
    if (
      error instanceof ApiError &&
      options.retry !== false &&
      isRetryableRead(options.operationId, error)
    ) {
      const data = await platformRequest<T>(options.operationId, input, requestOptions(options));
      if (generation === currentGeneration(key)) requestCache.set(key, data, options.scope);
      return data;
    }
    throw error;
  }
}

function isRetryableRead(operationId: string, error: ApiError): boolean {
  const op = PLATFORM_OPERATIONS.find((candidate) => candidate.operationId === operationId);
  if (op?.method !== 'GET') return false;
  if (error.code === 'network_error') return true;
  return error.status === 503;
}
