const ALLOWED_PREFLIGHT_METHOD = 'POST';
const ALLOWED_PREFLIGHT_HEADERS = new Set([
  'content-type',
  'x-aurora-client-key',
  'x-aurora-environment',
]);

/**
 * Validate and normalize an HTTP(S) origin for CORS preflight. Returns the
 * canonical origin, or null when the value is absent, `null`, or carries a
 * path, query, fragment, or userinfo. Never returns `*`.
 */
export function validatePreflightOrigin(origin: string | undefined): string | null {
  if (origin === undefined || origin === '' || origin === 'null') return null;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (parsed.pathname !== '/' && parsed.pathname !== '') return null;
  if (parsed.search !== '' || parsed.hash !== '') return null;
  if (parsed.username !== '' || parsed.password !== '') return null;
  return `${parsed.protocol}//${parsed.host}`;
}

/** True when the preflight request method and headers are permitted. */
export function isPreflightAllowed(
  method: string | undefined,
  requestHeaders: readonly string[],
): boolean {
  if (method !== ALLOWED_PREFLIGHT_METHOD) return false;
  return requestHeaders.every((header) => ALLOWED_PREFLIGHT_HEADERS.has(header.toLowerCase()));
}
