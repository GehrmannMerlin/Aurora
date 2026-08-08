import type { Pool, PoolClient } from 'pg';
import { isUniqueViolation, toStableError } from '../errors.js';
import { isoTimestamp } from './timestamp.js';

export type IdempotencyStatus = 'processing' | 'succeeded' | 'failed';

export interface CreateIdempotencyRecordInput {
  readonly idempotencyKey: string;
  readonly operation: string;
  readonly requestDigest: string;
  readonly status: IdempotencyStatus;
}

export type CreateIdempotencyRecordResult = { readonly status: 'created' } | { readonly status: 'conflict' };

/** camelCase projection of the idempotency_records table. */
export interface IdempotencyRecordRow {
  readonly idempotencyKey: string;
  readonly operation: string;
  readonly requestDigest: string;
  readonly status: IdempotencyStatus;
  readonly resultData: unknown;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface UpdateIdempotencyResultInput {
  readonly key: string;
  readonly status: 'succeeded' | 'failed';
  readonly resultData: Readonly<Record<string, unknown>> | null;
}

export type UpdateIdempotencyResultResult = { readonly status: 'success' } | { readonly status: 'not_found' };

interface IdempotencyRecordRowShape {
  idempotency_key: string;
  operation: string;
  request_digest: string;
  status: IdempotencyStatus;
  result_data: unknown;
  created_at: string;
  updated_at: string;
}

function toIdempotencyRecordRow(row: IdempotencyRecordRowShape): IdempotencyRecordRow {
  return {
    idempotencyKey: row.idempotency_key,
    operation: row.operation,
    requestDigest: row.request_digest,
    status: row.status,
    resultData: row.result_data,
    createdAt: isoTimestamp(row.created_at) as string,
    updatedAt: isoTimestamp(row.updated_at) as string,
  };
}

/** Create an idempotency record; `conflict` when the key already exists. */
export async function createIdempotencyRecord(
  pool: Pool | PoolClient,
  input: CreateIdempotencyRecordInput,
): Promise<CreateIdempotencyRecordResult> {
  try {
    const result = await pool.query<{ idempotency_key: string }>(
      `INSERT INTO idempotency_records (idempotency_key, operation, request_digest, status)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING idempotency_key`,
      [input.idempotencyKey, input.operation, input.requestDigest, input.status],
    );
    return result.rows.length === 0 ? { status: 'conflict' } : { status: 'created' };
  } catch (error) {
    if (isUniqueViolation(error)) return { status: 'conflict' };
    throw toStableError(error);
  }
}

/** Fetch an idempotency record by key; null when absent. */
export async function findIdempotencyRecord(
  pool: Pool | PoolClient,
  key: string,
): Promise<IdempotencyRecordRow | null> {
  try {
    const result = await pool.query<IdempotencyRecordRowShape>(
      `SELECT idempotency_key, operation, request_digest, status, result_data, created_at, updated_at
       FROM idempotency_records
       WHERE idempotency_key = $1`,
      [key],
    );
    const row = result.rows[0];
    return row === undefined ? null : toIdempotencyRecordRow(row);
  } catch (error) {
    throw toStableError(error);
  }
}

/** Record the terminal result for an idempotency key. */
export async function updateIdempotencyResult(
  pool: Pool | PoolClient,
  input: UpdateIdempotencyResultInput,
): Promise<UpdateIdempotencyResultResult> {
  try {
    const result = await pool.query(
      `UPDATE idempotency_records
       SET status = $2, result_data = $3, updated_at = now()
       WHERE idempotency_key = $1
       RETURNING idempotency_key`,
      [input.key, input.status, input.resultData],
    );
    return result.rows.length === 0 ? { status: 'not_found' } : { status: 'success' };
  } catch (error) {
    throw toStableError(error);
  }
}
