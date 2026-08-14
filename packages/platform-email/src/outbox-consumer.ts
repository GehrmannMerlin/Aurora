import type { Pool, PoolClient } from 'pg';
import type {
  EmailDeliveryPort,
  EmailDeliveryResult,
  EmailIntentType,
} from './email-delivery-port.js';
import { calculateEmailRetryDelay } from './retry-policy.js';

export type OutboxStatus =
  'pending' | 'processing' | 'succeeded' | 'failed' | 'dead_lettered' | 'superseded';

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

export interface InsertOutboxRowInput {
  readonly aggregateType: string;
  readonly aggregateId?: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly createdAt?: Date;
}

export interface InsertOutboxRowResult {
  readonly status: 'success';
  readonly outboxId: string;
}

/** Repository surface injected by the platform-worker composition root. */
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

export interface OutboxEmailPayload {
  readonly intentType: EmailIntentType;
  readonly toAddress: string;
  readonly toMasked: string;
  readonly mailLinkUrl: string;
  readonly expiresInMinutes: number;
  readonly intentExpiresAt?: string;
}

export interface ConsumeOutboxEmailsInput {
  readonly pool: Pool;
  readonly port: EmailDeliveryPort;
  readonly outboxRepo: OutboxRepository;
  readonly now: Date;
  readonly limit?: number;
  readonly maxAttempts?: number;
  readonly processingTimeoutMs?: number;
  readonly retryBaseDelayMs?: number;
  readonly retryMaxDelayMs?: number;
  readonly entropy01?: () => number;
}

export interface ConsumeOutboxEmailsResult {
  readonly consumed: number;
  readonly failed: number;
}

const DEFAULT_LIMIT = 20;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_PROCESSING_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_RETRY_BASE_DELAY_MS = 1_000;
const DEFAULT_RETRY_MAX_DELAY_MS = 5 * 60 * 1000;
const MAX_EMAIL_LENGTH = 320;
const MAX_LINK_LENGTH = 4_096;
const MAX_EXPIRY_MINUTES = 31 * 24 * 60;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEmailIntentType(value: unknown): value is EmailIntentType {
  return (
    value === 'email_verification' ||
    value === 'password_reset' ||
    value === 'organization_invitation' ||
    value === 'deletion_confirmation'
  );
}

function boundedString(payload: Record<string, unknown>, field: string, maxLength: number): string {
  const value = payload[field];
  if (typeof value !== 'string' || value.length < 1 || value.length > maxLength) {
    throw new TypeError('invalid email outbox payload');
  }
  return value;
}

function parseIntentExpiry(
  payload: Record<string, unknown>,
  intentType: EmailIntentType,
): string | undefined {
  const value = payload.intentExpiresAt;
  if (value === undefined && intentType !== 'email_verification') return undefined;
  if (typeof value !== 'string' || value.length > 64 || !Number.isFinite(Date.parse(value))) {
    throw new TypeError('invalid email outbox payload');
  }
  return value;
}

function parseOutboxEmailPayload(payload: unknown): OutboxEmailPayload {
  if (!isRecord(payload)) throw new TypeError('invalid email outbox payload');
  const intentType = payload.intentType;
  if (!isEmailIntentType(intentType)) throw new TypeError('invalid email outbox payload');
  const expiresInMinutes = payload.expiresInMinutes;
  if (
    typeof expiresInMinutes !== 'number' ||
    !Number.isSafeInteger(expiresInMinutes) ||
    expiresInMinutes < 1 ||
    expiresInMinutes > MAX_EXPIRY_MINUTES
  ) {
    throw new TypeError('invalid email outbox payload');
  }
  const intentExpiresAt = parseIntentExpiry(payload, intentType);
  return {
    intentType,
    toAddress: boundedString(payload, 'toAddress', MAX_EMAIL_LENGTH),
    toMasked: boundedString(payload, 'toMasked', MAX_EMAIL_LENGTH),
    mailLinkUrl: boundedString(payload, 'mailLinkUrl', MAX_LINK_LENGTH),
    expiresInMinutes,
    ...(intentExpiresAt === undefined ? {} : { intentExpiresAt }),
  };
}

function requirePositiveInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${field} must be positive`);
}

function stableReasonCode(value: string): string {
  return /^[A-Z0-9_]{1,128}$/.test(value) ? value : 'EMAIL_PROVIDER_UNAVAILABLE';
}

function stableProviderRequestId(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return /^[A-Za-z0-9._:-]{1,256}$/.test(value) ? value : undefined;
}

async function settle(
  input: ConsumeOutboxEmailsInput,
  row: OutboxRow,
  settlement: Omit<MarkOutboxResultInput, 'outboxId' | 'claimId'>,
): Promise<boolean> {
  const result = await input.outboxRepo.markOutboxResult(input.pool, {
    outboxId: row.outboxId,
    claimId: row.claimId,
    ...settlement,
  });
  return result.status === 'success';
}

function invalidPayloadSettlement(
  nextAttempt: number,
  errorCode: 'EMAIL_PAYLOAD_INVALID' | 'EMAIL_INTENT_EXPIRED',
): Omit<MarkOutboxResultInput, 'outboxId' | 'claimId'> {
  return {
    status: 'dead_lettered',
    attemptCount: nextAttempt,
    errorCode,
    clearPayload: true,
  };
}

/** Claim, deliver once, and fenced-settle each available transactional email. */
export async function consumeOutboxEmails(
  input: ConsumeOutboxEmailsInput,
): Promise<ConsumeOutboxEmailsResult> {
  const limit = input.limit ?? DEFAULT_LIMIT;
  const maxAttempts = input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const processingTimeoutMs = input.processingTimeoutMs ?? DEFAULT_PROCESSING_TIMEOUT_MS;
  const retryBaseDelayMs = input.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
  const retryMaxDelayMs = input.retryMaxDelayMs ?? DEFAULT_RETRY_MAX_DELAY_MS;
  requirePositiveInteger(limit, 'limit');
  requirePositiveInteger(maxAttempts, 'maxAttempts');
  requirePositiveInteger(processingTimeoutMs, 'processingTimeoutMs');
  requirePositiveInteger(retryBaseDelayMs, 'retryBaseDelayMs');
  requirePositiveInteger(retryMaxDelayMs, 'retryMaxDelayMs');
  if (retryMaxDelayMs > 300_000) throw new TypeError('retryMaxDelayMs exceeds five minutes');

  const claimed = await input.outboxRepo.claimOutboxRows(input.pool, {
    limit,
    now: input.now,
    processingTimeoutMs,
  });
  if (claimed.status === 'nothingToClaim') return { consumed: 0, failed: 0 };

  let consumed = 0;
  let failed = 0;
  for (const row of claimed.rows) {
    const nextAttempt = row.attemptCount + 1;
    let payload: OutboxEmailPayload;
    try {
      payload = parseOutboxEmailPayload(row.payload);
    } catch {
      if (
        await settle(input, row, invalidPayloadSettlement(nextAttempt, 'EMAIL_PAYLOAD_INVALID'))
      ) {
        failed += 1;
      }
      continue;
    }

    if (
      payload.intentExpiresAt !== undefined &&
      Date.parse(payload.intentExpiresAt) <= input.now.getTime()
    ) {
      if (await settle(input, row, invalidPayloadSettlement(nextAttempt, 'EMAIL_INTENT_EXPIRED'))) {
        failed += 1;
      }
      continue;
    }

    let delivery: EmailDeliveryResult;
    try {
      delivery = await input.port.deliver({
        intentType: payload.intentType,
        toAddress: payload.toAddress,
        toAddressMasked: payload.toMasked,
        mailLinkUrl: payload.mailLinkUrl,
        expiresInMinutes: payload.expiresInMinutes,
      });
    } catch {
      delivery = {
        status: 'failed',
        retryable: true,
        reasonCode: 'EMAIL_PROVIDER_UNAVAILABLE',
      };
    }

    if (delivery.status === 'accepted') {
      const providerRequestId = stableProviderRequestId(delivery.providerRequestId);
      if (
        await settle(input, row, {
          status: 'succeeded',
          attemptCount: nextAttempt,
          ...(providerRequestId === undefined ? {} : { providerRequestId }),
          clearPayload: true,
        })
      ) {
        consumed += 1;
      }
      continue;
    }

    const errorCode = stableReasonCode(delivery.reasonCode);
    if (!delivery.retryable || nextAttempt >= maxAttempts) {
      if (
        await settle(input, row, {
          status: 'dead_lettered',
          attemptCount: nextAttempt,
          errorCode,
          clearPayload: true,
        })
      ) {
        failed += 1;
      }
      continue;
    }

    const delayMs = calculateEmailRetryDelay({
      attempt: nextAttempt,
      baseDelayMs: retryBaseDelayMs,
      maxDelayMs: retryMaxDelayMs,
      entropy01: input.entropy01?.() ?? Math.random(),
    });
    if (
      await settle(input, row, {
        status: 'failed',
        attemptCount: nextAttempt,
        availableAt: new Date(input.now.getTime() + delayMs),
        errorCode,
        clearPayload: false,
      })
    ) {
      failed += 1;
    }
  }
  return { consumed, failed };
}
