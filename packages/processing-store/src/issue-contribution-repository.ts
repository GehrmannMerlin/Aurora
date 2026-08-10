import type { Pool, PoolClient } from 'pg';
import type { PersistIssueContributionResult } from './issue-contribution-types.js';
import { decideIssueSample } from './issue-sample-decision.js';

const CATEGORIES = new Set(['javascript', 'unhandled_rejection', 'resource']);

interface ParsedIssueContribution {
  readonly projectId: string;
  readonly fingerprint: string;
  readonly fingerprintVersion: number;
  readonly category: string;
  readonly normalizedTitle: string;
  readonly eventId: string;
  readonly occurredAt: Date;
  readonly occurredAtIso: string;
  readonly sampleBody: unknown;
}

interface IssueRow {
  readonly id: string;
  readonly lastSeenAt: Date;
  readonly sampleCount: number;
  readonly status: string;
  readonly resolvedAt: Date | null;
  readonly ignoredUntil: Date | null;
  readonly version: number;
}

function isPlainRecord(input: unknown): input is Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return false;
  const prototype: unknown = Object.getPrototypeOf(input);
  return prototype === Object.prototype || prototype === null;
}

function invalid(code: string): { readonly status: 'invalid_input'; readonly code: string } {
  return { status: 'invalid_input', code };
}

function parsePersistIssueContributionInput(
  input: unknown,
): ParsedIssueContribution | { readonly status: 'invalid_input'; readonly code: string } {
  if (!isPlainRecord(input)) return invalid('invalid_top_level');
  const {
    projectId,
    fingerprint,
    fingerprintVersion,
    category,
    normalizedTitle,
    eventId,
    occurredAtIso,
    sampleBody,
  } = input;

  if (typeof projectId !== 'string' || projectId.length === 0) return invalid('invalid_project_id');
  if (typeof fingerprint !== 'string' || fingerprint.length === 0 || fingerprint.length > 1024) {
    return invalid('invalid_fingerprint');
  }
  if (typeof fingerprintVersion !== 'number' || !Number.isInteger(fingerprintVersion)) {
    return invalid('invalid_fingerprint_version');
  }
  if (typeof category !== 'string' || !CATEGORIES.has(category)) return invalid('invalid_category');
  if (typeof normalizedTitle !== 'string' || normalizedTitle.length === 0) {
    return invalid('invalid_normalized_title');
  }
  if (typeof eventId !== 'string' || eventId.length === 0) return invalid('invalid_event_id');
  if (typeof occurredAtIso !== 'string') return invalid('invalid_occurred_at');
  const occurredAt = new Date(occurredAtIso);
  if (Number.isNaN(occurredAt.getTime())) return invalid('invalid_occurred_at');
  if (!isPlainRecord(sampleBody)) return invalid('invalid_sample_body');

  return {
    projectId,
    fingerprint,
    fingerprintVersion,
    category,
    normalizedTitle,
    eventId,
    occurredAt,
    occurredAtIso,
    sampleBody,
  };
}

async function findIssueForUpdate(client: PoolClient, parsed: ParsedIssueContribution): Promise<IssueRow | null> {
  const result = await client.query<{
    id: string;
    last_seen_at: Date;
    sample_count: number;
    status: string;
    resolved_at: Date | null;
    ignored_until: Date | null;
    version: number;
  }>(
    `SELECT id, last_seen_at, sample_count, status, resolved_at, ignored_until, version
       FROM issues
      WHERE project_id = $1 AND fingerprint = $2 AND fingerprint_version = $3
      FOR UPDATE`,
    [parsed.projectId, parsed.fingerprint, parsed.fingerprintVersion],
  );
  const row = result.rows[0];
  if (row === undefined) return null;
  return {
    id: row.id,
    lastSeenAt: new Date(row.last_seen_at),
    sampleCount: row.sample_count,
    status: row.status,
    resolvedAt: row.resolved_at === null ? null : new Date(row.resolved_at),
    ignoredUntil: row.ignored_until === null ? null : new Date(row.ignored_until),
    version: row.version,
  };
}

async function insertIssue(
  client: PoolClient,
  parsed: ParsedIssueContribution,
): Promise<string | null> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO issues
       (project_id, fingerprint, fingerprint_version, category, normalized_title,
        first_seen_at, last_seen_at, occurrence_count, sample_count)
     VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $6::timestamptz, 1, 0)
     ON CONFLICT (project_id, fingerprint, fingerprint_version) DO NOTHING
     RETURNING id`,
    [
      parsed.projectId,
      parsed.fingerprint,
      parsed.fingerprintVersion,
      parsed.category,
      parsed.normalizedTitle,
      parsed.occurredAtIso,
    ],
  );
  return result.rows[0]?.id ?? null;
}

/** Register the event application. Returns false when already applied (idempotent). */
async function registerEventApplication(
  client: PoolClient,
  parsed: ParsedIssueContribution,
  issueId: string,
): Promise<boolean> {
  const result = await client.query(
    `INSERT INTO issue_event_applications (project_id, event_id, issue_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (project_id, event_id) DO NOTHING`,
    [parsed.projectId, parsed.eventId, issueId],
  );
  return (result.rowCount ?? 0) > 0;
}

async function findEvictableSample(
  client: PoolClient,
  issueId: string,
  eventSampleKind: string,
): Promise<string | null> {
  // Prefer the oldest `regular` sample for any priority kind. When no regular
  // remains, evict the oldest sample of the SAME incoming kind (a new `latest`
  // evicts the oldest `latest`; a new `reappeared` evicts the oldest
  // `reappeared`) — never crossing kinds, so reappearance evidence is never
  // lost to a newer latest (ADR-033 decision detail 8).
  const regular = await client.query<{ id: string }>(
    `SELECT id FROM issue_samples
      WHERE issue_id = $1 AND sample_kind = 'regular'
      ORDER BY occurred_at ASC, id ASC
      LIMIT 1`,
    [issueId],
  );
  if (regular.rows[0] !== undefined) return regular.rows[0].id;
  if (eventSampleKind === 'first') return null; // first is never evictable.
  const sameKind = await client.query<{ id: string }>(
    `SELECT id FROM issue_samples
      WHERE issue_id = $1 AND sample_kind = $2
      ORDER BY occurred_at ASC, id ASC
      LIMIT 1`,
    [issueId, eventSampleKind],
  );
  return sameKind.rows[0]?.id ?? null;
}

async function storeSample(
  client: PoolClient,
  parsed: ParsedIssueContribution,
  issueId: string,
  sampleKind: string,
  replaceSampleId: string | null,
): Promise<void> {
  if (replaceSampleId !== null) {
    await client.query(`DELETE FROM issue_samples WHERE id = $1`, [replaceSampleId]);
  }
  const inserted = await client.query(
    `INSERT INTO issue_samples
       (issue_id, project_id, event_id, occurred_at, sample_body, sample_kind)
     VALUES ($1, $2, $3, $4::timestamptz, $5::jsonb, $6)
     ON CONFLICT (project_id, event_id) DO NOTHING`,
    [
      issueId,
      parsed.projectId,
      parsed.eventId,
      parsed.occurredAtIso,
      JSON.stringify(parsed.sampleBody),
      sampleKind,
    ],
  );
  // Only a non-conflict insert grows sample_count (replace is net-zero).
  if (replaceSampleId === null && (inserted.rowCount ?? 0) > 0) {
    await client.query(`UPDATE issues SET sample_count = sample_count + 1 WHERE id = $1`, [
      issueId,
    ]);
  }
}

/** v1 only `by_time` reopen (ADR-033 decision detail 12). Returns true when reopened. */
async function maybeReopenIssue(
  client: PoolClient,
  issue: IssueRow,
  occurredAt: Date,
): Promise<boolean> {
  let shouldReopen = false;
  if (issue.status === 'resolved' && issue.resolvedAt !== null && occurredAt.getTime() > issue.resolvedAt.getTime()) {
    shouldReopen = true;
  } else if (
    issue.status === 'ignored' &&
    issue.ignoredUntil !== null &&
    occurredAt.getTime() >= issue.ignoredUntil.getTime()
  ) {
    shouldReopen = true;
  }
  if (!shouldReopen) return false;
  await client.query(
    `UPDATE issues SET status = 'open', version = version + 1, updated_at = now() WHERE id = $1`,
    [issue.id],
  );
  return true;
}

/**
 * Contribute one fingerprinted error event to the Issue aggregate within a
 * single committed transaction (DAT-13 spec §5.1 / ADR-033 decision details
 * 9—11). Event-application idempotency keeps `occurrence_count` from double
 * counting under Worker retry / manual replay; `last_seen_at` uses GREATEST to
 * survive out-of-order processing; the first-insert race is recovered via
 * `ON CONFLICT DO NOTHING` + re-lock; samples stay bounded via
 * `decideIssueSample`. Never exposes the pg Result object or database errors.
 */
export async function persistIssueContribution(
  pool: Pool,
  input: unknown,
): Promise<PersistIssueContributionResult> {
  const parsed = parsePersistIssueContributionInput(input);
  if ('status' in parsed) return parsed;

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    // Find or create the issue. `issue` is always non-null after this block:
    // a fresh INSERT yields a synthetic row, and a lost INSERT race re-locks
    // the winner (ADR-033 decision detail 10).
    let created = false;
    let issue = await findIssueForUpdate(client, parsed);
    if (issue === null) {
      const insertedId = await insertIssue(client, parsed);
      if (insertedId !== null) {
        created = true;
        issue = {
          id: insertedId,
          lastSeenAt: parsed.occurredAt,
          sampleCount: 0,
          status: 'open',
          resolvedAt: null,
          ignoredUntil: null,
          version: 1,
        };
      } else {
        issue = await findIssueForUpdate(client, parsed);
        if (issue === null) {
          await client.query('ROLLBACK');
          return { status: 'temporarily_unavailable' };
        }
      }
    }
    const issueId = issue.id;

    // Idempotent event-application registry.
    const applied = await registerEventApplication(client, parsed, issueId);
    if (!applied) {
      // Already applied: roll back a just-created (orphan) issue, else commit a no-op.
      await client.query(created ? 'ROLLBACK' : 'COMMIT');
      return { status: 'duplicate' };
    }

    if (created) {
      await storeSample(client, parsed, issueId, 'first', null);
    } else {
      // Repeated occurrence: increment count, keep last_seen monotonic.
      await client.query(
        `UPDATE issues
            SET occurrence_count = occurrence_count + 1,
                last_seen_at = GREATEST(last_seen_at, $4::timestamptz),
                updated_at = now()
          WHERE id = $1 AND project_id = $2 AND fingerprint = $3`,
        [issueId, parsed.projectId, parsed.fingerprint, parsed.occurredAtIso],
      );
      const reopened = await maybeReopenIssue(client, issue, parsed.occurredAt);
      const eventSampleKind = reopened
        ? 'reappeared'
        : parsed.occurredAt.getTime() > issue.lastSeenAt.getTime()
          ? 'latest'
          : 'regular';
      const evictableSampleId = await findEvictableSample(client, issueId, eventSampleKind);
      const decision = decideIssueSample({
        sampleCount: issue.sampleCount,
        eventSampleKind,
        evictableSampleId,
      });
      if (decision.action === 'store') {
        await storeSample(client, parsed, issueId, eventSampleKind, null);
      } else if (decision.action === 'replace') {
        await storeSample(client, parsed, issueId, eventSampleKind, decision.replaceSampleId);
      }
    }

    await client.query('COMMIT');
    return created ? { status: 'inserted', issueId } : { status: 'applied' };
  } catch {
    await client.query('ROLLBACK').catch(() => undefined);
    return { status: 'temporarily_unavailable' };
  } finally {
    client.release();
  }
}
