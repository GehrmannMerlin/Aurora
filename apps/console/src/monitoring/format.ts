/**
 * Display formatting for monitoring evidence (PLT-05/PLT-06 shared).
 *
 * All timestamps from the Platform API are RFC 3339 UTC (the contract regex is
 * `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$`). We render the UTC wall
 * time with an explicit `UTC` label so the displayed value is unambiguous and
 * deterministic — the console never converts server evidence into a local
 * business state. Counts are exact server aggregates; formatting must not imply
 * a precision the data does not have.
 */

/** Format an RFC 3339 UTC timestamp as `YYYY-MM-DD HH:MM UTC` (deterministic, labeled). */
export function formatUtc(iso: string): string {
  // Contract guarantees this shape; slicing avoids locale-dependent Intl output.
  const date = iso.slice(0, 10);
  const time = iso.length >= 16 ? iso.slice(11, 16) : '';
  return `${date} ${time} UTC`.trim();
}

/** Render an exact non-negative count without inventing precision. */
export function formatCount(count: number): string {
  if (!Number.isFinite(count) || count < 0) return '—';
  return String(count);
}

/** Render a count that may exceed a documented cap (e.g. samples capped at 100). */
export function formatBoundedCount(count: number, cap: number): string {
  return count >= cap ? `${String(cap)}+` : String(count);
}
