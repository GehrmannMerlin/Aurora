/**
 * SEC-02 cross-store cleanup orchestrator (account-deletion-and-data-lifecycle §8).
 *
 * Polls durable deletion intents (`account_cleanup_handoffs`, SEC-01) and runs
 * the fixed store-order cleanup through the adapters. Per-store progress is
 * persisted in `account_cleanup_steps` (partial-failure retry + idempotent
 * completion): a `succeeded` step is never re-run, and the handoff only reaches
 * `succeeded` when EVERY required store step succeeded — partial success is
 * never reported as complete. Exhausted attempts transition to
 * `dead_lettered` with a `cleanup_failed` security-audit event.
 */

import type { Pool } from 'pg';
import type { CleanupAdapter, CleanupInput } from './cleanup-adapters.js';
import {
  decideCleanupStores,
  decideHandoffOutcome,
  decideStepAfterAttempt,
  isStepEligibleForRun,
  type CleanupStep,
} from './cleanup-state-machine.js';

export interface CleanupOrchestratorOptions {
  readonly pool: Pool;
  readonly adapters: readonly CleanupAdapter[];
  readonly maxAttempts: number;
  readonly batchLimit?: number;
}

export interface CleanupRoundResult {
  readonly claimed: number;
  readonly succeeded: number;
  readonly retried: number;
  readonly deadLettered: number;
}

/** Mutable accumulator used while processing a round; returned as the readonly result. */
interface MutableRoundResult {
  claimed: number;
  succeeded: number;
  retried: number;
  deadLettered: number;
}

interface HandoffRow {
  readonly handoff_id: string;
  readonly account_id: string;
  readonly required_lifecycle: unknown;
  readonly attempt_count: number;
}

const BATCH_LIMIT_DEFAULT = 10;

export async function runCleanupRound(
  options: CleanupOrchestratorOptions,
): Promise<CleanupRoundResult> {
  const { pool, adapters, maxAttempts } = options;
  const batchLimit = options.batchLimit ?? BATCH_LIMIT_DEFAULT;

  const claimed = await pool.query<HandoffRow>(
    `SELECT handoff_id, account_id, required_lifecycle, attempt_count
     FROM account_cleanup_handoffs
     WHERE status IN ('pending','in_progress')
     ORDER BY created_at
     LIMIT $1
     FOR UPDATE SKIP LOCKED`,
    [batchLimit],
  );

  const result: MutableRoundResult = {
    claimed: claimed.rowCount ?? 0,
    succeeded: 0,
    retried: 0,
    deadLettered: 0,
  };
  const adapterByStore = new Map<string, CleanupAdapter>(adapters.map((a) => [a.store, a]));

  for (const row of claimed.rows) {
    await processHandoff(pool, adapterByStore, maxAttempts, row, result);
  }
  return result;
}

async function processHandoff(
  pool: Pool,
  adapterByStore: Map<string, CleanupAdapter>,
  maxAttempts: number,
  row: HandoffRow,
  result: MutableRoundResult,
): Promise<void> {
  const emailResult = await pool.query<{ email: string }>(
    'SELECT email FROM accounts WHERE account_id = $1',
    [row.account_id],
  );
  const accountEmail = emailResult.rows[0]?.email ?? '';

  const stores = decideCleanupStores();
  for (const store of stores) {
    await pool.query(
      `INSERT INTO account_cleanup_steps (handoff_id, store) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [row.handoff_id, store],
    );
  }

  const stepsResult = await pool.query<{
    store: string;
    status: string;
    error_code: string | null;
    attempt_count: number;
  }>(
    `SELECT store, status, error_code, attempt_count FROM account_cleanup_steps WHERE handoff_id = $1`,
    [row.handoff_id],
  );

  const steps: CleanupStep[] = stepsResult.rows.map((step) => ({
    store: step.store as CleanupStep['store'],
    status: step.status as CleanupStep['status'],
    ...(step.error_code === null ? {} : { errorCode: step.error_code }),
    attemptCount: step.attempt_count,
  }));

  const input: CleanupInput = {
    accountId: row.account_id,
    accountEmail,
    requiredLifecycle: row.required_lifecycle,
  };

  for (const [index, step] of steps.entries()) {
    if (!isStepEligibleForRun(step)) continue;
    const adapter = adapterByStore.get(step.store);
    const outcome =
      adapter === undefined
        ? { ok: false as const, errorCode: 'missing-adapter' }
        : await adapter.cleanup(input);
    const next = decideStepAfterAttempt(
      step,
      outcome.ok,
      outcome.ok ? undefined : outcome.errorCode,
    );
    await pool.query(
      `INSERT INTO account_cleanup_steps (handoff_id, store, status, error_code, attempt_count, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (handoff_id, store)
       DO UPDATE SET status = $3, error_code = $4, attempt_count = $5, updated_at = now()`,
      [row.handoff_id, next.store, next.status, next.errorCode ?? null, next.attemptCount],
    );
    steps[index] = next;
  }

  const nextAttempt = row.attempt_count + 1;
  const outcome = decideHandoffOutcome(steps, nextAttempt, maxAttempts);

  if (outcome === 'succeeded') {
    await pool.query(
      `UPDATE account_cleanup_handoffs SET status = 'succeeded', attempt_count = $2, updated_at = now() WHERE handoff_id = $1`,
      [row.handoff_id, nextAttempt],
    );
    await pool.query('DELETE FROM account_cleanup_steps WHERE handoff_id = $1', [row.handoff_id]);
    await pool.query('DELETE FROM account_cleanup_handoffs WHERE handoff_id = $1', [
      row.handoff_id,
    ]);
    result.succeeded += 1;
  } else if (outcome === 'retry') {
    await pool.query(
      `UPDATE account_cleanup_handoffs SET status = 'in_progress', attempt_count = $2, updated_at = now() WHERE handoff_id = $1`,
      [row.handoff_id, nextAttempt],
    );
    result.retried += 1;
  } else {
    await pool.query(
      `UPDATE account_cleanup_handoffs SET status = 'dead_lettered', attempt_count = $2, updated_at = now() WHERE handoff_id = $1`,
      [row.handoff_id, nextAttempt],
    );
    await pool.query(
      `INSERT INTO security_audit_events (actor_account_id, action, target_account_id, details)
       VALUES ($1, 'cleanup_failed', $1, $2::jsonb)`,
      [
        row.account_id,
        JSON.stringify({ lifecycle: 'account-deletion', attemptCount: nextAttempt }),
      ],
    );
    result.deadLettered += 1;
  }
}
