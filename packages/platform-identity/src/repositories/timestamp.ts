/**
 * Normalize a pg `timestamptz` value (parsed to a JS Date by node-postgres)
 * into a stable ISO-8601 UTC string. Keeps the public repository surface
 * string-typed regardless of the pg parser's runtime representation.
 */
export function isoTimestamp(value: Date | string | null): string | null {
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}
