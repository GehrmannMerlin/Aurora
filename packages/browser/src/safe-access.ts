export type SafeAccessFailureReason = 'unavailable' | 'threw';
export interface SafeAccessSuccess<T> {
  readonly ok: true;
  readonly value: T;
}
export interface SafeAccessFailure {
  readonly ok: false;
  readonly reason: SafeAccessFailureReason;
}
export type SafeAccessResult<T> = SafeAccessSuccess<T> | SafeAccessFailure;
export type UnknownCallable = (...args: unknown[]) => unknown;

export function isObjectLike(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

function isCallable(value: unknown): value is UnknownCallable {
  return typeof value === 'function';
}

export function readProperty(target: unknown, key: PropertyKey): SafeAccessResult<unknown> {
  if (!isObjectLike(target)) return { ok: false, reason: 'unavailable' };
  try {
    return { ok: true, value: Reflect.get(target, key) };
  } catch {
    return { ok: false, reason: 'threw' };
  }
}

export function readMethod(target: unknown, key: PropertyKey): SafeAccessResult<UnknownCallable> {
  const result = readProperty(target, key);
  if (!result.ok || !isCallable(result.value)) {
    return { ok: false, reason: result.ok ? 'unavailable' : result.reason };
  }
  return { ok: true, value: result.value };
}

export function callMethod(
  method: UnknownCallable,
  receiver: unknown,
  args: readonly unknown[],
): SafeAccessResult<unknown> {
  try {
    return { ok: true, value: Reflect.apply(method, receiver, args) };
  } catch {
    return { ok: false, reason: 'threw' };
  }
}

export function sanitizePageUrl(input: unknown): string | null {
  if (typeof input !== 'string' || input.length === 0) return null;
  try {
    const parsed = new URL(input);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return null;
  }
}
