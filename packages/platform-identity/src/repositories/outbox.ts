import type { Pool, PoolClient } from 'pg';
import { PlatformIdentityError, toStableError } from '../errors.js';
import { isoTimestamp } from './timestamp.js';

export type OutboxStatus =
  'pending' | 'processing' | 'succeeded' | 'failed' | 'dead_lettered' | 'superseded';

export const MAX_CLAIM_LIMIT = 100;

export interface InsertOutboxRowInput {
  readonly aggregateType: string;
  readonly aggregateId?: string;
  /** Outbox payload. May hold a transient one-time token for email link rendering. */
  readonly payload: Readonly<Record<string, unknown>>;
  /** Authoritative command acceptance time; defaults to the database clock. */
  readonly createdAt?: Date;
}

export interface InsertOutboxRowResult {
  readonly status: 'success';
  readonly outboxId: string;
}

/** camelCase projection of a claimed outbox row. */
export interface OutboxRow {
  readonly outboxId: string;
  readonly aggregateType: string;
  readonly aggregateId: string | null;
  readonly payload: unknown;
  readonly status: OutboxStatus;
  readonly attemptCount: number;
  readonly claimId: string;
  readonly lastErrorCode: string | null;
  readonly providerRequestId: string | null;
  readonly availableAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ClaimOutboxRowsInput {
  readonly limit: number;
  readonly now: Date;
  readonly processingTimeoutMs: number;
}

export type ClaimOutboxRowsResult =
  | { readonly status: 'claimed'; readonly rows: readonly OutboxRow[] }
  | { readonly status: 'nothingToClaim' };

export interface MarkOutboxResultInput {
  readonly outboxId: string;
  readonly claimId: string;
  readonly status: 'succeeded' | 'failed' | 'dead_lettered';
  readonly attemptCount: number;
  readonly availableAt?: Date;
  readonly errorCode?: string;
  readonly providerRequestId?: string;
  readonly clearPayload: boolean;
}

export type MarkOutboxResultResult =
  | { readonly status: 'success' }
  | { readonly status: 'not_found' }
  | { readonly status: 'stale_claim' };

export interface GetEmailVerificationResendStateInput {
  readonly accountId: string;
  readonly now: Date;
  readonly cooldownMs: number;
  readonly rollingWindowMs: number;
}

export interface EmailVerificationResendState {
  readonly lastAcceptedAt: string | null;
  readonly resendCount: number;
}

interface OutboxRowShape {
  outbox_id: string;
  aggregate_type: string;
  aggregate_id: string | null;
  payload: unknown;
  status: OutboxStatus;
  attempt_count: number;
  claim_id: string;
  last_error_code: string | null;
  provider_request_id: string | null;
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
    claimId: row.claim_id,
    lastErrorCode: row.last_error_code,
    providerRequestId: row.provider_request_id,
    availableAt: isoTimestamp(row.available_at),
    createdAt: isoTimestamp(row.created_at),
    updatedAt: isoTimestamp(row.updated_at),
  };
}

/** Insert an outbox row for later async delivery (ADR-032). */
export async function insertOutboxRow(
  pool: Pool | PoolClient,
  input: InsertOutboxRowInput,
): Promise<InsertOutboxRowResult> {
  try {
    const result = await pool.query<{ outbox_id: string }>(
      `INSERT INTO outbox (
         aggregate_type, aggregate_id, payload, available_at, created_at, updated_at
       )
       VALUES (
         $1, $2, $3::jsonb,
         COALESCE($4::timestamptz, now()),
         COALESCE($4::timestamptz, now()),
         COALESCE($4::timestamptz, now())
       )
       RETURNING outbox_id`,
      [
        input.aggregateType,
        input.aggregateId ?? null,
        input.payload,
        input.createdAt?.toISOString() ?? null,
      ],
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

function validatePositiveDuration(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new PlatformIdentityError('invalid_input', `${name} must be a positive integer`);
  }
}

function validateClaimInput(input: ClaimOutboxRowsInput): void {
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > MAX_CLAIM_LIMIT) {
    throw new PlatformIdentityError(
      'invalid_input',
      `limit must be an integer in 1..${String(MAX_CLAIM_LIMIT)}`,
    );
  }
  validatePositiveDuration(input.processingTimeoutMs, 'processingTimeoutMs');
}

const CLAIM_SQL = `
  UPDATE outbox
  SET status = 'processing', claim_id = gen_random_uuid(), updated_at = $2
  WHERE outbox_id IN (
    SELECT outbox_id FROM outbox
    WHERE
      (status IN ('pending', 'failed') AND available_at <= $2)
      OR
      (status = 'processing' AND updated_at <= $2 - ($3::bigint * interval '1 millisecond'))
    ORDER BY outbox_id
    LIMIT $1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING outbox_id, aggregate_type, aggregate_id, payload, status,
            attempt_count, claim_id, last_error_code, provider_request_id,
            available_at, created_at, updated_at
`;

/** Claim available or stale outbox rows with a fresh fencing UUID. */
export async function claimOutboxRows(
  pool: Pool | PoolClient,
  input: ClaimOutboxRowsInput,
): Promise<ClaimOutboxRowsResult> {
  validateClaimInput(input);
  try {
    const result = await pool.query<OutboxRowShape>(CLAIM_SQL, [
      input.limit,
      input.now.toISOString(),
      input.processingTimeoutMs,
    ]);
    if (result.rows.length === 0) return { status: 'nothingToClaim' };
    return { status: 'claimed', rows: result.rows.map(toOutboxRow) };
  } catch (error) {
    throw toStableError(error);
  }
}

/**
 * Settle only the currently fenced processing attempt. A stale worker can
 * observe the row but can never overwrite a newer claim.
 */
export async function markOutboxResult(
  pool: Pool | PoolClient,
  input: MarkOutboxResultInput,
): Promise<MarkOutboxResultResult> {
  try {
    const result = await pool.query(
      `UPDATE outbox
       SET status = $3,
           attempt_count = $4,
           available_at = COALESCE($5, available_at),
           last_error_code = $6,
           provider_request_id = $7,
           payload = CASE WHEN $8 THEN '{}'::jsonb ELSE payload END,
           claim_id = NULL,
           updated_at = now()
       WHERE outbox_id = $1 AND status = 'processing' AND claim_id = $2
       RETURNING outbox_id`,
      [
        input.outboxId,
        input.claimId,
        input.status,
        input.attemptCount,
        input.availableAt?.toISOString() ?? null,
        input.errorCode ?? null,
        input.providerRequestId ?? null,
        input.clearPayload,
      ],
    );
    if (result.rows.length > 0) return { status: 'success' };

    const existing = await pool.query('SELECT outbox_id FROM outbox WHERE outbox_id = $1', [
      input.outboxId,
    ]);
    return existing.rows.length === 0 ? { status: 'not_found' } : { status: 'stale_claim' };
  } catch (error) {
    throw toStableError(error);
  }
}

/** Return the bounded cooldown and rolling resend quota projection. */
export async function getEmailVerificationResendState(
  pool: Pool | PoolClient,
  input: GetEmailVerificationResendStateInput,
): Promise<EmailVerificationResendState> {
  validatePositiveDuration(input.cooldownMs, 'cooldownMs');
  validatePositiveDuration(input.rollingWindowMs, 'rollingWindowMs');
  try {
    const result = await pool.query<{
      last_accepted_at: string | null;
      resend_count: number;
    }>(
      `SELECT
         MAX(created_at) FILTER (
           WHERE created_at > $2::timestamptz - ($3::bigint * interval '1 millisecond')
         ) AS last_accepted_at,
         COUNT(*) FILTER (
           WHERE aggregate_type = 'email.verification.resend'
             AND created_at > $2::timestamptz - ($4::bigint * interval '1 millisecond')
         )::int AS resend_count
       FROM outbox
       WHERE aggregate_id = $1
         AND aggregate_type IN ('email.verification', 'email.verification.resend')
         AND created_at > $2::timestamptz - (GREATEST($3::bigint, $4::bigint) * interval '1 millisecond')`,
      [input.accountId, input.now.toISOString(), input.cooldownMs, input.rollingWindowMs],
    );
    const row = result.rows[0];
    return {
      lastAcceptedAt: isoTimestamp(row?.last_accepted_at ?? null),
      resendCount: row?.resend_count ?? 0,
    };
  } catch (error) {
    throw toStableError(error);
  }
}

/** Supersede unsent verification mail after a replacement link is accepted. */
export async function supersedePendingEmailVerificationOutbox(
  pool: Pool | PoolClient,
  input: { readonly accountId: string; readonly now: Date },
): Promise<void> {
  try {
    await pool.query(
      `UPDATE outbox
       SET status = 'superseded', payload = '{}'::jsonb, claim_id = NULL, updated_at = $2
       WHERE aggregate_id = $1
         AND aggregate_type IN ('email.verification', 'email.verification.resend')
         AND status IN ('pending', 'failed')`,
      [input.accountId, input.now.toISOString()],
    );
  } catch (error) {
    throw toStableError(error);
  }
}
