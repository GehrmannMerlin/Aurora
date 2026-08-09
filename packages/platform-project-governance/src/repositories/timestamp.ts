/**
 * Normalize a pg `timestamptz` value (parsed to a JS Date by node-postgres)
 * into a stable ISO-8601 UTC string. Keeps the public repository surface
 * string-typed regardless of the pg parser's runtime representation.
 */
export function isoTimestamp(value: Date | string): string;
export function isoTimestamp(value: Date | string | null): string | null;
export function isoTimestamp(value: Date | string | null): string | null {
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

/**
 * Optimistic-concurrency version key for project lifecycle commands. Both the
 * stored `updated_at` (a JS Date carrying PostgreSQL microsecond precision) and
 * the caller-supplied resource version string are normalized to millisecond ISO
 * so a stale-version comparison is never false-positived by microseconds.
 */
export function isoVersionKey(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString();
}
