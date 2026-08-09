import type { PoolClient } from 'pg';

export interface InsertAuditEventInput {
  readonly organizationId?: string;
  readonly actorAccountId?: string;
  readonly action: string;
  readonly targetAccountId?: string;
  /**
   * Arbitrary structured detail. MUST NOT contain passwords, one-time token
   * plaintext, token digests or full secrets.
   */
  readonly details?: Readonly<Record<string, unknown>>;
}

/**
 * Persist a security audit event on the caller's transaction.
 *
 * `security_audit_events` is FK-free by design and is only ever written by a
 * management command in the same transaction (PRD §13.3 high-risk mutations:
 * private-token create/revoke). The `details` jsonb is trusted from the caller
 * but the contract is explicit: never include passwords, one-time tokens,
 * token digests, CSRF secrets or full email addresses.
 */
export async function insertAuditEvent(
  client: PoolClient,
  input: InsertAuditEventInput,
): Promise<void> {
  await client.query(
    `INSERT INTO security_audit_events
       (organization_id, actor_account_id, action, target_account_id, details)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [
      input.organizationId ?? null,
      input.actorAccountId ?? null,
      input.action,
      input.targetAccountId ?? null,
      input.details ?? {},
    ],
  );
}
