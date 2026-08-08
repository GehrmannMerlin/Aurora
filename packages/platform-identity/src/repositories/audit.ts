import type { Pool, PoolClient } from 'pg';
import { PlatformIdentityError, toStableError } from '../errors.js';

export interface InsertAuditEventInput {
  readonly organizationId?: string;
  readonly actorAccountId?: string;
  readonly action: string;
  readonly targetAccountId?: string;
  /** Arbitrary structured detail. MUST NOT contain passwords, tokens or full emails. */
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface InsertAuditEventResult {
  readonly status: 'success';
  readonly eventId: string;
}

/**
 * Persist a security audit event. `security_audit_events` is FK-free by design
 * (identity events may reference actors/orgs that are not rows yet). The
 * `details` jsonb is trusted from the caller but the contract is explicit:
 * never include passwords, one-time tokens, CSRF secrets or full email
 * addresses.
 */
export async function insertAuditEvent(
  pool: Pool | PoolClient,
  input: InsertAuditEventInput,
): Promise<InsertAuditEventResult> {
  try {
    const result = await pool.query<{ event_id: string }>(
      `INSERT INTO security_audit_events
         (organization_id, actor_account_id, action, target_account_id, details)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       RETURNING event_id`,
      [
        input.organizationId ?? null,
        input.actorAccountId ?? null,
        input.action,
        input.targetAccountId ?? null,
        input.details ?? {},
      ],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new PlatformIdentityError('statement_failed', 'audit insert returned no row');
    }
    return { status: 'success', eventId: row.event_id };
  } catch (error) {
    throw toStableError(error);
  }
}
