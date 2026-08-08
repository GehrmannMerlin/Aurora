import type { Pool, PoolClient } from 'pg';
import type { EmailDeliveryPort, EmailIntentType } from './email-delivery-port.js';

/**
 * Outbox consumer types (accepted ADR-032 generic transactional outbox;
 * Workspace Policy `data → {protocol}` only).
 *
 * This package is a data layer and therefore MUST NOT depend on
 * `@aurora/platform-identity` (also data). Instead it declares the subset of
 * outbox repository functions it needs as its OWN `OutboxRepository` interface
 * and receives an implementation by argument injection through
 * `consumeOutboxEmails`. The real implementation is provided by the
 * platform-worker composition root (PLT-03 Task 8) from
 * `@aurora/platform-identity`.
 */
export type OutboxStatus = 'pending' | 'processing' | 'succeeded' | 'failed' | 'dead_lettered';

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

export type MarkOutboxResultResult =
  { readonly status: 'success' } | { readonly status: 'not_found' };

export interface InsertOutboxRowInput {
  readonly aggregateType: string;
  readonly aggregateId?: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export type InsertOutboxRowResult = { readonly status: 'success'; readonly outboxId: string };

/** The subset of outbox repository functions the consumer needs (injected). */
export interface OutboxRepository {
  readonly insertOutboxRow: (
    pool: Pool | PoolClient,
    input: InsertOutboxRowInput,
  ) => Promise<InsertOutboxRowResult>;
  readonly claimOutboxRows: (
    pool: Pool | PoolClient,
    input: ClaimOutboxRowsInput,
  ) => Promise<ClaimOutboxRowsResult>;
  readonly markOutboxResult: (
    pool: Pool | PoolClient,
    input: MarkOutboxResultInput,
  ) => Promise<MarkOutboxResultResult>;
}

/**
 * Typed outbox payload for transactional emails (produced by the platform-api
 * service layer in PLT-03 Task 7 and persisted verbatim by the outbox repo).
 *
 * `toAddress` is the normalized recipient needed for actual delivery (ADR-031
 * 决定细节 2 records the recipient email in the outbox). `toMasked` is the
 * server-side mask used for logging/display. `mailLinkUrl` embeds the transient
 * one-time intent token — the ONLY place the raw token travels; the request
 * built from this payload carries no separate token field.
 */
export interface OutboxEmailPayload {
  readonly intentType: EmailIntentType;
  readonly toAddress: string;
  readonly toMasked: string;
  readonly mailLinkUrl: string;
  readonly expiresInMinutes: number;
}

export interface ConsumeOutboxEmailsInput {
  readonly pool: Pool;
  readonly port: EmailDeliveryPort;
  readonly outboxRepo: OutboxRepository;
  readonly now: Date;
  readonly limit?: number;
  readonly maxAttempts?: number;
}

export interface ConsumeOutboxEmailsResult {
  /** Rows whose port delivery resolved `enqueued` and were marked succeeded. */
  readonly consumed: number;
  /** Rows that failed delivery, were malformed, or were dead-lettered. */
  readonly failed: number;
}

const DEFAULT_LIMIT = 20;
const DEFAULT_MAX_ATTEMPTS = 5;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEmailIntentType(value: unknown): value is EmailIntentType {
  return (
    value === 'email_verification' ||
    value === 'password_reset' ||
    value === 'organization_invitation'
  );
}

function requireNonEmptyString(payload: Record<string, unknown>, field: string): string {
  const value = payload[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`outbox email payload ${field} invalid`);
  }
  return value;
}

/**
 * Runtime-validate an outbox payload into a typed `OutboxEmailPayload`. Throws
 * a stable error for malformed payloads; the consumer dead-letters those rows
 * (a malformed row can never succeed after retries).
 */
function parseOutboxEmailPayload(payload: unknown): OutboxEmailPayload {
  if (!isRecord(payload)) throw new TypeError('outbox email payload must be an object');
  const intentType = payload.intentType;
  if (!isEmailIntentType(intentType)) {
    throw new TypeError('outbox email payload intentType invalid');
  }
  const toAddress = requireNonEmptyString(payload, 'toAddress');
  const toMasked = requireNonEmptyString(payload, 'toMasked');
  const mailLinkUrl = requireNonEmptyString(payload, 'mailLinkUrl');
  const expiresInMinutes = payload.expiresInMinutes;
  if (
    typeof expiresInMinutes !== 'number' ||
    !Number.isFinite(expiresInMinutes) ||
    expiresInMinutes <= 0
  ) {
    throw new TypeError('outbox email payload expiresInMinutes invalid');
  }
  return { intentType, toAddress, toMasked, mailLinkUrl, expiresInMinutes };
}

/**
 * Claim pending + available outbox rows (already atomically marked `processing`
 * by `claimOutboxRows`), deliver each through the port, and settle the row:
 * `succeeded` on `enqueued`, `failed` (retryable) on a port failure below the
 * budget, `dead_lettered` once the attempt budget is exhausted. Malformed
 * payloads are dead-lettered immediately.
 *
 * Delivery is non-committal: `enqueued` means the send request was durably
 * recorded, NOT that the inbox received it (ADR-031).
 */
export async function consumeOutboxEmails(
  input: ConsumeOutboxEmailsInput,
): Promise<ConsumeOutboxEmailsResult> {
  const limit = input.limit ?? DEFAULT_LIMIT;
  const maxAttempts = input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  const claimed = await input.outboxRepo.claimOutboxRows(input.pool, { limit, now: input.now });
  if (claimed.status === 'nothingToClaim') return { consumed: 0, failed: 0 };

  let consumed = 0;
  let failed = 0;
  for (const row of claimed.rows) {
    const nextAttempt = row.attemptCount + 1;
    let payload: OutboxEmailPayload;
    try {
      payload = parseOutboxEmailPayload(row.payload);
    } catch {
      failed += 1;
      await input.outboxRepo.markOutboxResult(input.pool, {
        outboxId: row.outboxId,
        status: 'dead_lettered',
        attemptCount: nextAttempt,
      });
      continue;
    }

    const delivery = await input.port.deliver({
      intentType: payload.intentType,
      toAddress: payload.toAddress,
      toAddressMasked: payload.toMasked,
      mailLinkUrl: payload.mailLinkUrl,
      expiresInMinutes: payload.expiresInMinutes,
    });

    if (delivery.status === 'enqueued') {
      consumed += 1;
      await input.outboxRepo.markOutboxResult(input.pool, {
        outboxId: row.outboxId,
        status: 'succeeded',
        attemptCount: nextAttempt,
      });
    } else {
      failed += 1;
      const status = nextAttempt >= maxAttempts ? 'dead_lettered' : 'failed';
      await input.outboxRepo.markOutboxResult(input.pool, {
        outboxId: row.outboxId,
        status,
        attemptCount: nextAttempt,
      });
    }
  }
  return { consumed, failed };
}
