import { ERROR_EVENT_LIMITS, type ErrorDescriptor } from '@aurora/event-schema';

function removeUrlSuffix(input: string): string {
  const queryIndex = input.indexOf('?');
  const fragmentIndex = input.indexOf('#');
  const suffixIndex =
    queryIndex < 0
      ? fragmentIndex
      : fragmentIndex < 0
        ? queryIndex
        : Math.min(queryIndex, fragmentIndex);
  return suffixIndex < 0 ? input : input.slice(0, suffixIndex);
}

export function sanitizeErrorText(input: unknown, maxLength: number): string | undefined {
  if (typeof input !== 'string' || input.length === 0) return undefined;
  const urlPattern = /https?:\/\/[^\s"'<>]+/giu;
  const credentialPattern =
    /\b(authorization|cookie|token|access_token|refresh_token|password|session)\s*[:=]\s*[^\s,;]+/giu;
  const withoutUrlSecrets = input.replace(urlPattern, removeUrlSuffix);
  const redacted = withoutUrlSecrets.replace(
    credentialPattern,
    (match: string): string => `${match.slice(0, match.search(/[:=]/u)).trim()}=[redacted]`,
  );
  const bounded = redacted.slice(0, maxLength);
  return bounded.length === 0 ? undefined : bounded;
}

function readProperty(input: unknown, key: 'name' | 'message' | 'stack'): unknown {
  if ((typeof input !== 'object' || input === null) && typeof input !== 'function') {
    return undefined;
  }
  try {
    return Reflect.get(input, key);
  } catch {
    return undefined;
  }
}

export function createErrorDescriptor(input: unknown, fallbackMessage: string): ErrorDescriptor {
  const name = sanitizeErrorText(
    readProperty(input, 'name'),
    ERROR_EVENT_LIMITS.maxErrorNameLength,
  );
  const message =
    sanitizeErrorText(readProperty(input, 'message'), ERROR_EVENT_LIMITS.maxErrorMessageLength) ??
    sanitizeErrorText(fallbackMessage, ERROR_EVENT_LIMITS.maxErrorMessageLength) ??
    'Unknown error';
  const stack = sanitizeErrorText(readProperty(input, 'stack'), ERROR_EVENT_LIMITS.maxStackLength);
  return {
    ...(name === undefined ? {} : { name }),
    message,
    ...(stack === undefined ? {} : { stack }),
  };
}
