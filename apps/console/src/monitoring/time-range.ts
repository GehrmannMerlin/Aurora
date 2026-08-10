/**
 * UTC time-window helpers (PLT-05/PLT-06 shared).
 *
 * `issuesListIssues` (DAT-15) and `requestsListEndpoints` (DAT-16) require an
 * explicit `timeRange` on the wire; diagnostics (DAT-20) and performance
 * (DAT-17) default server-side to the last 24h. Views compute a deterministic
 * default window once (on mount) and reuse it so the request cache key stays
 * stable within the page lifetime.
 */

export interface UtcTimeRange {
  readonly start: string;
  readonly end: string;
}

function toUtcIso(date: Date): string {
  return date.toISOString();
}

/** Last-24h window ending at `now` (defaults to the current time), as RFC 3339 UTC. */
export function defaultTimeRange(now: Date = new Date(), hours = 24): UtcTimeRange {
  const end = now;
  const start = new Date(now.getTime() - hours * 60 * 60 * 1000);
  return { start: toUtcIso(start), end: toUtcIso(end) };
}
