/**
 * Normalize an origin candidate to a canonical HTTP(S) origin, or null if it
 * is not a valid HTTP(S) origin. Does not touch the network or DNS.
 */
export function normalizeOrigin(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  if (input.trim() !== input) return null;
  if (input === '' || input === 'null' || input === '*') return null;
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username !== '' || url.password !== '') return null;
  if (url.search !== '') return null;
  if (url.hash !== '') return null;
  if (url.host === '') return null;
  if (url.pathname !== '' && url.pathname !== '/') return null;
  return url.origin;
}
