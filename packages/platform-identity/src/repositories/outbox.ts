import type { Pool, PoolClient } from 'pg';
import { PlatformIdentityError, toStableError } from '../errors.js';
import { isoTimestamp } from './timestamp.js';

export type OutboxStatus = 'pending' | 'processing' | 'succeeded' | 'failed' | 'dead_lettered';

export const MAX_CLAIM_LIMIT = 100;

export interface InsertOutboxRowInput {
  readonly aggregateType: string;
  readonly aggregateId?: string;
  /** Outbox payload. May hold a transient one-time token for email link rendering. */
  readonly payload: Readonly<Record<string, unknown>>;
}

export type InsertOutboxRowResult = { readonly status: 'success'; readonly outboxId: string };

/** camelCase projection of the outbox table. */
export interface OutboxRow {
  readonly outboxId: string;
  readonly aggregateType: string;
  readonly aggregateId: string | null;
  readonly payload: unknown;
  readonly status: OutboxStatus;
  readonly attemptCount: number;
  readonly availableAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ClaimOutboxRowsInput {
  readonly limit: number;
  readonly now: Date;
}

export type ClaimOutboxRowsResult =
  | { readonly status: 'claimed'; readonly rows: readonly OutboxRow[] }
  | { readonly status: 'nothingToClaim' };

export interface MarkOutboxResultInput {
  readonly outboxId: string;
  readonly status: Exclude<OutboxStatus, 'pending' | 'processing'>;
  readonly attemptCount: number;
}

export type MarkOutboxResultResult = { readonly status: 'success' } | { readonly status: 'not_found' };

interface OutboxRowShape {
  outbox_id: string;
  aggregate_type: string;
  aggregate_id: string | null;
  payload: unknown;
  status: OutboxStatus;
  attempt_count: number;
  available_at: string;
  created_at: string;
  updated_at: string;
}

function toOutboxRow(row: OutboxRowShape): OutboxRow {
  return {
    outboxId: row.outbox_id,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    payload: row.payload,
    status: row.status,
    attemptCount: row.attempt_count,
    availableAt: isoTimestamp(row.available_at) as string,
    createdAt: isoTimestamp(row.created_at) as string,
    updatedAt: isoTimestamp(row.updated_at) as string,
  };
}

/** Insert an outbox row for later async delivery (ADR-032). */
export async function insertOutboxRow(
  pool: Pool | PoolClient,
  input: InsertOutboxRowInput,
): Promise<InsertOutboxRowResult> {
  try {
    const result = await pool.query<{ outbox_id: string }>(
      `INSERT INTO outbox (aggregate_type, aggregate_id, payload)
       VALUES ($1, $2, $3::jsonb)
       RETURNING outbox_id`,
      [input.aggregateType, input.aggregateId ?? null, input.payload],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new PlatformIdentityError('statement_failed', 'outbox insert returned no row');
    }
    return { status: 'success', outboxId: row.outbox_id };
  } catch (error) {
    throw toStableError(error);
  }
}

function validateClaimInput(input: ClaimOutboxRowsInput): void {
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > MAX_CLAIM_LIMIT) {
    throw new PlatformIdentityError(
      'invalid_input',
      `limit must be an integer in 1..${String(MAX_CLAIM_LIMIT)}`,
    );
  }
}

const CLAIM_SQL = `
  UPDATE outbox
  SET status = 'processing', updated_at = $2
  WHERE outbox_id IN (
    SELECT outbox_id FROM outbox
    WHERE status = 'pending' AND available_at <= $2
    ORDER BY outbox_id
    LIMIT $1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING outbox_id, aggregate_type, aggregate_id, payload, status,
            attempt_count, available_at, created_at, updated_at
`;

/**
 * Claim pending and available outbox rows for processing (ADR-032). Rows are
 * atomically moved to `processing` and skipped by concurrent claims via
 * `FOR UPDATE SKIP LOCKED`.
 */
export async function claimOutboxRows(
  pool: Pool | PoolClient,
  input: ClaimOutboxRowsInput,
): Promise<ClaimOutboxRowsResult> {
  validateClaimInput(input);
  try {
    const result = await pool.query<OutboxRowShape>(CLAIM_SQL, [
      input.limit,
      input.now.toISOString(),
    ]);
    if (result.rows.length === 0) return { status: 'nothingToClaim' };
    return { status: 'claimed', rows: result.rows.map(toOutboxRow) };
  } catch (error) {
    throw toStableError(error);
  }
}

/** Settle a claimed outbox row to a terminal/retry state. */
export async function markOutboxResult(
  pool: Pool | PoolClient,
  input: MarkOutboxResultInput,
): Promise<MarkOutboxResultResult> {
  try {
    const result = await pool.query(
      `UPDATE outbox
       SET status = $2, attempt_count = $3, updated_at = now()
       WHERE outbox_id = $1
       RETURNING outbox_id`,
      [input.outboxId, input.status, input.attemptCount],
    );
    return result.rows.length === 0 ? { status: 'not_found' } : { status: 'success' };
  } catch (error) {
    throw toStableError(error);
  }
}
