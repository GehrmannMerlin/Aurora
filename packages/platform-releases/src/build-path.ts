/**
 * PRD §8.3.3 limited path normalization for Source Map matching. Allowed: strip
 * protocol and host, strip query/fragment, keep the real path and filename
 * (including content hashes). No fuzzy filename matching, no CDN-prefix config
 * (deferred). Deterministic — two build paths that normalize the same match.
 */
export function normalizeBuildPath(input: string): string {
  let path = input.trim();
  if (/^https?:\/\//i.test(path)) {
    try {
      path = new URL(path).pathname;
    } catch {
      // Not a parseable URL: keep the raw value so a later match simply fails.
      path = input.trim();
    }
  }
  path = path.split('?')[0]?.split('#')[0] ?? path;
  if (path.length === 0) return path;
  if (!path.startsWith('/')) path = `/${path}`;
  return path;
}
