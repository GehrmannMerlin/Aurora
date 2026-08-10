import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { RequestMethod, RequestOutcome } from '@aurora/event-schema';
import { ProcessingStoreError } from './errors.js';
import type {
  OutcomeAggregate,
  RequestEndpointPage,
  RequestEndpointPageQuery,
  RequestEndpointSummary,
  RequestMetricQueryWindow,
  RequestMetricSummary,
} from './request-metric-query-types.js';

const REQUEST_METHODS: ReadonlySet<string> = new Set(Object.values(RequestMethod));
const REQUEST_OUTCOMES: ReadonlySet<string> = new Set(Object.values(RequestOutcome));

/** Deterministic lowercase-hex SHA-256 of `method\nurl` as a stable endpoint identity. */
export function endpointIdOf(method: string, url: string): string {
  return createHash('sha256').update(`${method}\n${url}`).digest('hex');
}

/** Encode a `(method, url)` keyset as base64url of `method\nurl`. */
export function encodeEndpointCursor(method: string, url: string): string {
  return Buffer.from(`${method}\n${url}`, 'utf8').toString('base64url');
}

/** Decode a keyset cursor; malformed input maps to a stable `invalid_input` error. */
export function decodeEndpointCursor(cursor: string): { method: string; url: string } {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const sep = decoded.indexOf('\n');
    if (sep <= 0) throw new Error('malformed cursor');
    return { method: decoded.slice(0, sep), url: decoded.slice(sep + 1) };
  } catch {
    throw new ProcessingStoreError('invalid_input', 'malformed endpoint cursor');
  }
}

/** Reject values outside the public RequestMethod enum. */
function knownMethod(value: string): RequestMethod {
  if (!REQUEST_METHODS.has(value)) {
    throw new ProcessingStoreError('invalid_input', 'unexpected request method in store');
  }
  return value as RequestMethod;
}

/** Reject values outside the public RequestOutcome enum. */
function knownOutcome(value: string): RequestOutcome {
  if (!REQUEST_OUTCOMES.has(value)) {
    throw new ProcessingStoreError('invalid_input', 'unexpected request outcome in store');
  }
  return value as RequestOutcome;
}

/** bigint / numeric columns arrive from pg as strings; normalize to JS numbers. */
function asNumber(value: string): number {
  return Number(value);
}

/**
 * Mutable in-query accumulator for one request method; mapped to the readonly
 * MethodAggregate result after the window rows are aggregated.
 */
interface MethodAccumulator {
  method: RequestMethod;
  observedCount: number;
  failureCount: number;
  slowCount: number;
  durationSumMs: number;
  durationMaxMs: number;
  outcomes: { outcome: RequestOutcome; count: number }[];
}

/** Validate and normalize a jsonb outcome-counts array produced by the page query. */
function parseOutcomeCounts(raw: unknown): OutcomeAggregate[] {
  if (!Array.isArray(raw)) {
    throw new ProcessingStoreError('invalid_input', 'malformed outcome counts in store');
  }
  return raw.map((entry): OutcomeAggregate => {
    if (typeof entry !== 'object' || entry === null) {
      throw new ProcessingStoreError('invalid_input', 'malformed outcome counts in store');
    }
    const record = entry as { outcome?: unknown; count?: unknown };
    if (typeof record.outcome !== 'string' || typeof record.count !== 'number') {
      throw new ProcessingStoreError('invalid_input', 'malformed outcome counts in store');
    }
    return { outcome: knownOutcome(record.outcome), count: record.count };
  });
}

/**
 * Windowed request metric summary. Buckets are complete (no sampling
 * extrapolation): `observedCount`/`failureCount`/`slowCount` are summed across
 * the queried buckets and `durationMaxMs` is the maximum per-bucket max.
 * `dataThrough` is the latest bucket `updated_at` as an RFC 3339 UTC timestamp,
 * or null when the window contains no buckets. Database failures are mapped to
 * a stable ProcessingStoreError and never leak internal details.
 */
export async function queryRequestMetricSummary(
  pool: Pool,
  input: RequestMetricQueryWindow,
): Promise<RequestMetricSummary> {
  try {
    const rows = await pool.query<{
      method: string;
      outcome: string;
      observed: string;
      failures: string;
      slow: string;
      sum_ms: string;
      max_ms: string;
    }>(
      `SELECT method, outcome,
              SUM(observed_count)::bigint AS observed,
              SUM(failure_count)::bigint AS failures,
              SUM(slow_count)::bigint AS slow,
              SUM(duration_sum_ms) AS sum_ms,
              MAX(duration_max_ms) AS max_ms
       FROM request_metric_buckets
       WHERE project_id = $1 AND bucket_start >= $2 AND bucket_start < $3
       GROUP BY method, outcome`,
      [input.projectId, input.startIso, input.endIso],
    );

    const byMethod = new Map<string, MethodAccumulator>();
    for (const row of rows.rows) {
      const method = knownMethod(row.method);
      const outcome = knownOutcome(row.outcome);
      const observed = asNumber(row.observed);
      let aggregate = byMethod.get(method);
      if (aggregate === undefined) {
        aggregate = {
          method,
          observedCount: 0,
          failureCount: 0,
          slowCount: 0,
          durationSumMs: 0,
          durationMaxMs: 0,
          outcomes: [],
        };
        byMethod.set(method, aggregate);
      }
      aggregate.observedCount += observed;
      aggregate.failureCount += asNumber(row.failures);
      aggregate.slowCount += asNumber(row.slow);
      aggregate.durationSumMs += asNumber(row.sum_ms);
      aggregate.durationMaxMs = Math.max(aggregate.durationMaxMs, asNumber(row.max_ms));
      aggregate.outcomes.push({ outcome, count: observed });
    }

    const dataThroughRow = await pool.query<{ d: Date | null }>(
      `SELECT MAX(updated_at) AS d
       FROM request_metric_buckets
       WHERE project_id = $1 AND bucket_start >= $2 AND bucket_start < $3`,
      [input.projectId, input.startIso, input.endIso],
    );
    const latest = dataThroughRow.rows[0]?.d ?? null;
    const dataThrough = latest === null ? null : latest.toISOString();

    return { methods: [...byMethod.values()], dataThrough };
  } catch (error) {
    if (error instanceof ProcessingStoreError) throw error;
    throw new ProcessingStoreError('statement_failed', 'request metric summary query failed');
  }
}

/**
 * Windowed keyset page over distinct endpoints derived from bounded diagnostic
 * samples (`request_event_samples`). The list is a partial view: each item
 * carries `isPartial: true` and `completeness: { source: 'diagnostic_samples',
 * bounded: true }`. Rows are grouped per endpoint (method + protocol-safe url),
 * outcomes are aggregated, and pagination uses the `(method, url)` composite
 * keyset ordered by `ORDER BY method, url`. `nextCursor` encodes the last item
 * of the current page when more than `limit` endpoints were found.
 */
export async function queryRequestEndpointPage(
  pool: Pool,
  input: RequestEndpointPageQuery,
): Promise<RequestEndpointPage> {
  const decoded = input.cursor === undefined ? null : decodeEndpointCursor(input.cursor);

  const params: unknown[] = [input.projectId, input.startIso, input.endIso];
  let keyset = '';
  if (decoded !== null) {
    keyset = `AND (sample_body->>'method', sample_body->>'url') > ($${String(params.length + 1)}, $${String(params.length + 2)})`;
    params.push(decoded.method, decoded.url);
  }
  const limitPlusOne = input.limit + 1;
  params.push(limitPlusOne);

  try {
    const rows = await pool.query<{
      method: string;
      url: string;
      cnt: string;
      created: Date | null;
      outcomes: unknown;
    }>(
      `SELECT sub.method AS method,
              sub.url AS url,
              SUM(sub.cnt)::bigint AS cnt,
              MAX(sub.created) AS created,
              jsonb_agg(jsonb_build_object('outcome', sub.outcome, 'count', sub.cnt)
                        ORDER BY sub.outcome) AS outcomes
       FROM (
         SELECT sample_body->>'method' AS method,
                sample_body->>'url' AS url,
                sample_body->>'outcome' AS outcome,
                COUNT(*)::bigint AS cnt,
                MAX(created_at) AS created
         FROM request_event_samples
         WHERE project_id = $1 AND occurred_at >= $2 AND occurred_at < $3 ${keyset}
         GROUP BY method, url, outcome
       ) sub
       GROUP BY sub.method, sub.url
       ORDER BY sub.method, sub.url
       LIMIT $${String(params.length)}`,
      params,
    );

    // PostgreSQL COUNT takes a single argument; count distinct endpoints via a
    // DISTINCT subquery over the (method, url) pair.
    const totalCountRow = await pool.query<{ total: string }>(
      `SELECT COUNT(*) AS total
       FROM (
         SELECT DISTINCT sample_body->>'method' AS method, sample_body->>'url' AS url
         FROM request_event_samples
         WHERE project_id = $1 AND occurred_at >= $2 AND occurred_at < $3
       ) t`,
      [input.projectId, input.startIso, input.endIso],
    );
    const totalCount = Number(totalCountRow.rows[0]?.total ?? '0');

    const items: RequestEndpointSummary[] = [];
    for (const row of rows.rows) {
      if (typeof row.url !== 'string' || row.url.length === 0) {
        throw new ProcessingStoreError('invalid_input', 'malformed endpoint url in store');
      }
      const method = knownMethod(row.method);
      items.push({
        endpointId: endpointIdOf(method, row.url),
        method,
        url: row.url,
        sampleCount: asNumber(row.cnt),
        outcomeCounts: parseOutcomeCounts(row.outcomes),
        dataThrough: row.created === null ? null : row.created.toISOString(),
        isPartial: true,
        completeness: { source: 'diagnostic_samples', bounded: true },
      });
    }

    let nextCursor: string | null = null;
    if (items.length > input.limit) {
      const lastItem = items[input.limit - 1];
      if (lastItem !== undefined) {
        nextCursor = encodeEndpointCursor(lastItem.method, lastItem.url);
      }
      items.length = input.limit;
    }

    return { items, nextCursor, totalCount };
  } catch (error) {
    if (error instanceof ProcessingStoreError) throw error;
    throw new ProcessingStoreError('statement_failed', 'request endpoint page query failed');
  }
}
