import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  createIdempotencyRecord,
  findIdempotencyRecord,
  updateIdempotencyResult,
} from '@aurora/platform-identity';
import { withTransaction } from './db.js';

/**
 * Deterministic request digest for idempotency: SHA-256 over the canonical JSON
 * of the parsed request body with the idempotency key excluded (the key is the
 * primary lookup identity). Same key + same effective request -> same digest;
 * same key + different request -> different digest (409 idempotency_conflict).
 */
export function requestDigest(input: object): string {
  const rest = { ...(input as Readonly<Record<string, unknown>>) };
  delete rest.idempotencyKey;
  return createHash('sha256').update(JSON.stringify(rest)).digest('hex');
}

export type IdempotencyLookup =
  | { readonly outcome: 'new' }
  | { readonly outcome: 'replay'; readonly resultData: unknown }
  | { readonly outcome: 'conflict' };

/** Read-only idempotency probe; used before running a command. */
export async function lookupIdempotency(
  pool: Pool,
  key: string,
  digest: string,
): Promise<IdempotencyLookup> {
  const record = await findIdempotencyRecord(pool, key);
  if (record === null) return { outcome: 'new' };
  if (record.requestDigest !== digest) return { outcome: 'conflict' };
  if (record.status === 'succeeded' && record.resultData !== null) {
    return { outcome: 'replay', resultData: record.resultData };
  }
  // A record exists with the same digest but is not terminal (processing/failed).
  // Because command records are committed atomically with their terminal status,
  // this branch is normally unreachable; fail closed with a conflict rather than
  // risk running a partial command twice.
  return { outcome: 'conflict' };
}

/** Thrown internally when a concurrent same-key transaction wins the race. */
class IdempotencyRaceError extends Error {}

export interface IdempotentCommandInput {
  readonly pool: Pool;
  readonly key: string;
  readonly operation: string;
  readonly digest: string;
  /** Runs the business writes on the caller's transaction and returns the response data. */
  readonly execute: (client: PoolClient) => Promise<object>;
}

export type IdempotentCommandResult =
  | { readonly outcome: 'replayed'; readonly resultData: unknown }
  | { readonly outcome: 'conflict' }
  | { readonly outcome: 'succeeded'; readonly resultData: unknown };

/**
 * Run a non-idempotent command exactly-once per (idempotency key, request
 * digest):
 * - replay: an earlier run with the same key + digest committed -> return its
 *   stored result without re-running the business writes;
 * - conflict: the key is present with a different digest -> 409
 *   idempotency_conflict;
 * - succeeded: first run; the business writes AND the idempotency record
 *   (status `succeeded` + result data) are committed in ONE transaction so a
 *   failure rolls everything back and a retry re-runs cleanly.
 *
 * The caller is responsible for post-commit side effects that live outside
 * PostgreSQL (e.g. creating a Redis session, revoking sessions). Those side
 * effects run for BOTH `succeeded` and `replayed` so a lost-response retry
 * converges.
 */
export async function runIdempotentCommand(
  input: IdempotentCommandInput,
): Promise<IdempotentCommandResult> {
  const probe = await lookupIdempotency(input.pool, input.key, input.digest);
  if (probe.outcome === 'replay') return { outcome: 'replayed', resultData: probe.resultData };
  if (probe.outcome === 'conflict') return { outcome: 'conflict' };

  try {
    const resultData = await withTransaction(input.pool, async (client) => {
      const created = await createIdempotencyRecord(client, {
        idempotencyKey: input.key,
        operation: input.operation,
        requestDigest: input.digest,
        status: 'processing',
      });
      if (created.status === 'conflict') throw new IdempotencyRaceError();
      const data = await input.execute(client);
      await updateIdempotencyResult(client, {
        key: input.key,
        status: 'succeeded',
        resultData: data as Record<string, unknown>,
      });
      return data;
    });
    return { outcome: 'succeeded', resultData };
  } catch (error) {
    if (error instanceof IdempotencyRaceError) {
      // A concurrent same-key transaction committed first. Re-read and decide
      // between replay (same digest) and conflict (different digest).
      const record = await findIdempotencyRecord(input.pool, input.key);
      if (record?.requestDigest !== input.digest) {
        return { outcome: 'conflict' };
      }
      if (record.status === 'succeeded' && record.resultData !== null) {
        return { outcome: 'replayed', resultData: record.resultData };
      }
      return { outcome: 'conflict' };
    }
    throw error;
  }
}
