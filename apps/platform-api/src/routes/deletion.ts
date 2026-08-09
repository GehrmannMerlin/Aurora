import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  consumeDeletionIntent,
  createIntentToken,
  decideDeletionFinalization,
  findDeletionIntentByDigest,
  getAccountById,
  getAccountByIdForUpdate,
  insertAuditEvent,
  insertCleanupHandoff,
  insertDeletionIntent,
  insertOutboxRow,
  recordDeletionRequest,
  recordDeletionTermination,
  updateAccountStatus,
  verifyPassword,
  type AccountRow,
} from '@aurora/platform-identity';
import { isUniqueOrganizationOwner, listAccountOrganizations } from '@aurora/platform-organization';
import {
  createCsrfSecret,
  revokeAllAccountSessions,
  type SessionStore,
} from '@aurora/platform-session';
import {
  OPERATION_ID_CANCEL_ACCOUNT_DELETION,
  OPERATION_ID_DELETE_ACCOUNT,
  OPERATION_ID_DELETE_ACCOUNT_PREFLIGHT,
  OPERATION_ID_REQUEST_ACCOUNT_DELETION,
} from '@aurora/platform-contract';
import { parseInput, serializeOutput, type OperationDef } from '@aurora/platform-contract/server';
import { operationById } from '../operations.js';
import { sendProblem } from '../error-mapper.js';
import { requireSession } from './_shared.js';
import { clearSessionCookie } from '../session-cookie.js';
import { clearIntentCookieOnReply, setIntentCookie } from '../intent-cookie.js';
import { maskEmail } from '../email-mask.js';
import {
  runIdempotentCommand,
  requestDigest,
  type IdempotentCommandResult,
} from '../idempotency.js';
import { ServiceError, sendMappedError } from '../service-error.js';
import type { PlatformApiRouteDependencies } from '../route-deps.js';

const PREFLIGHT_OPERATION: OperationDef = operationById(OPERATION_ID_DELETE_ACCOUNT_PREFLIGHT);
const REQUEST_ACCOUNT_DELETION_OPERATION: OperationDef = operationById(
  OPERATION_ID_REQUEST_ACCOUNT_DELETION,
);
const DELETE_ACCOUNT_OPERATION: OperationDef = operationById(OPERATION_ID_DELETE_ACCOUNT);
const CANCEL_OPERATION: OperationDef = operationById(OPERATION_ID_CANCEL_ACCOUNT_DELETION);

/** 7-day cooling window in hours / ms (server-authoritative; spec §4.1/§5.2). */
const COOLING_HOURS = 168;
const COOLING_MS = COOLING_HOURS * 60 * 60 * 1000;

/** Request-confirm intent lifetime (hours/ms) — the value shown in the mail. */
const REQUEST_INTENT_HOURS = 2;
const REQUEST_INTENT_MS = REQUEST_INTENT_HOURS * 60 * 60 * 1000;

/** Minimum gap before a confirmation email can be sent again (resend cooldown). */
const REQUEST_EMAIL_COOLDOWN_MS = 60_000;

/**
 * Cancel-intent lifetime, bounded strictly inside the cooling window (spec
 * §7.1): the confirmation email carries the cancel link and it must expire
 * before `deletion_cooling_ends_at` so a cancel is never possible after the
 * irreversible boundary is reached.
 */
const CANCEL_INTENT_HOURS = 72;
const CANCEL_INTENT_MS = CANCEL_INTENT_HOURS * 60 * 60 * 1000;

/** Frozen required-lifecycle intent persisted at the irreversible boundary (spec §9). */
const REQUIRED_LIFECYCLE: Readonly<Record<string, number>> = Object.freeze({
  onlineCleanupDays: 7,
  auditRetentionYears: 1,
  backupRetentionDays: 35,
});

/** Preflight `requiredLifecycle` projection (spec §5.2). */
const PREFLIGHT_LIFECYCLE: Readonly<Record<string, number>> = Object.freeze({
  coolingHours: COOLING_HOURS,
  onlineCleanupDays: 7,
  auditRetentionYears: 1,
  backupRetentionDays: 35,
});

/** Internal idempotency operation id for the system-driven lazy finalization. */
const FINALIZE_OPERATION = 'internal.account.deletion.finalize' as const;

interface DeleteAccountBody {
  readonly currentPassword: string;
  readonly idempotencyKey: string;
}

interface RequestAccountDeletionBody {
  readonly idempotencyKey: string;
}

interface CancelDeletionBody {
  readonly currentPassword: string;
  readonly idempotencyKey: string;
}

interface TokenParams {
  readonly token: string;
}

/** SHA-256 hex digest of a transient intent token (matches platform-identity). */
function digestOf(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

type FinalizationOutcome = 'finalized' | 'kept_cooling' | 'not_applicable' | 'sent';

/**
 * Internal sentinel: a lazy-finalization attempt found the account not
 * finalizable (still owner-blocked at the deadline, not in cooling, etc.) and
 * performed NO writes. It is thrown inside the idempotent transaction so the
 * `processing` idempotency record ROLLS BACK — nothing is cached — and every
 * later trigger re-evaluates the finalization (spec §4.2 "re-evaluate on each
 * trigger"). The handler catches it and maps to `kept_cooling`. A successful
 * finalization must NEVER throw this.
 */
class FinalizationNotDueError extends Error {
  constructor() {
    super('finalization not due');
    this.name = 'FinalizationNotDueError';
  }
}

interface MaybeFinalizeDeletionInput {
  readonly pool: Pool;
  readonly account: AccountRow;
  readonly now: Date;
  readonly sessionStore: SessionStore;
  readonly requestId: string;
  readonly reply: FastifyReply;
}

/**
 * SEC-01 lazy finalization (spec §4.2/§9): when a `deletion_cooling` account has
 * reached its 168h deadline and the final unique-owner re-check passes, advance
 * it to `terminated` and persist the durable cleanup handoff in the SAME
 * transaction (status transition + handoff + audit) — a real, recoverable,
 * auditable orchestration intent, never "just a log line". Idempotent on a
 * deterministic per-account key so concurrent calls and retries converge to one
 * handoff row (`insertCleanupHandoff` is already UNIQUE-account idempotent).
 *
 * The account row is locked `FOR UPDATE` inside the transaction so a concurrent
 * cancel serializes here: whichever acquires the accounts row first wins the
 * 168h boundary (spec §4.2 不变量: 边界并发不得同时撤销成功与进入不可逆成功).
 *
 * Returns:
 * - 'finalized' — transitioned to `terminated`, handoff written, sessions revoked;
 * - 'kept_cooling' — deadline reached but the final owner re-check failed (cancel stays usable);
 * - 'not_applicable' — not in cooling or the deadline has not been reached (no-op);
 * - 'sent' — an error problem response was already sent (caller must return).
 */
async function maybeFinalizeDeletion(
  input: MaybeFinalizeDeletionInput,
): Promise<FinalizationOutcome> {
  const { pool, account, now } = input;
  if (account.status !== 'deletion_cooling') return 'not_applicable';
  if (
    decideDeletionFinalization({
      status: account.status,
      deletionCoolingEndsAt: account.deletionCoolingEndsAt,
      now,
      ownerBlocked: false,
    }) !== 'finalize'
  ) {
    return 'not_applicable';
  }

  const accountId = account.accountId;
  let idempotency: IdempotentCommandResult;
  try {
    idempotency = await runIdempotentCommand({
      pool,
      key: `finalize:${accountId}`,
      operation: FINALIZE_OPERATION,
      digest: requestDigest({ finalize: accountId }),
      execute: async (client) => {
        // Row-lock the account: a concurrent cancel must serialize here instead
        // of racing the status write (spec §4.2 不变量).
        const locked = await getAccountByIdForUpdate(client, accountId);
        if (locked === null) {
          throw new ServiceError(404, 'not_found', 'The account was not found.');
        }
        if (locked.status !== 'deletion_cooling') throw new FinalizationNotDueError();
        if (
          decideDeletionFinalization({
            status: locked.status,
            deletionCoolingEndsAt: locked.deletionCoolingEndsAt,
            now,
            ownerBlocked: false,
          }) !== 'finalize'
        ) {
          throw new FinalizationNotDueError();
        }

        // Final unique-owner re-check in the same transaction (spec §6.2/§9). A
        // blocked owner keeps the account frozen; the cancel flow stays usable.
        // Throwing the sentinel rolls back the idempotency record, so when the
        // block later clears a future trigger RE-EVALUATES instead of replaying
        // a stale kept_cooling (spec §4.2).
        const memberships = await listAccountOrganizations(client, accountId);
        for (const membership of memberships) {
          if (membership.kind !== 'organization') continue;
          if (
            await isUniqueOrganizationOwner(client, {
              orgId: membership.organizationId,
              accountId,
            })
          ) {
            throw new FinalizationNotDueError();
          }
        }

        await recordDeletionTermination(client, { accountId, now });
        const handoff = await insertCleanupHandoff(client, {
          accountId,
          requiredLifecycle: REQUIRED_LIFECYCLE,
          now,
        });
        const handoffId = handoff.status === 'success' ? handoff.handoffId : undefined;
        await insertAuditEvent(client, {
          actorAccountId: accountId,
          targetAccountId: accountId,
          action: 'account.deletion.terminated',
          details: {
            terminatedAt: now.toISOString(),
            ...(handoffId === undefined ? {} : { handoffId }),
          },
        });
        await insertAuditEvent(client, {
          actorAccountId: accountId,
          targetAccountId: accountId,
          action: 'account.deletion.handoff_created',
          details: {
            ...(handoffId === undefined ? {} : { handoffId }),
            requiredLifecycle: REQUIRED_LIFECYCLE,
          },
        });
        return { outcome: 'finalized' as const };
      },
    });
  } catch (error) {
    // The not-due sentinel is caught here (it rolls back, so nothing was
    // committed); all other errors map via the standard mapper.
    if (error instanceof FinalizationNotDueError) return 'kept_cooling';
    if (await sendMappedError(input.reply, input.requestId, error)) return 'sent';
    throw error;
  }

  if (idempotency.outcome === 'conflict') return 'kept_cooling';
  // A `succeeded` outcome here always means `finalized`: every kept_cooling
  // path throws `FinalizationNotDueError` inside the transaction, so no
  // kept_cooling result is ever committed or replayed.

  // A terminated account must never present a live session (spec §8 不变量).
  // Sessions were revoked at request time; this is the defensive re-confirmation.
  try {
    await revokeAllAccountSessions(input.sessionStore, accountId);
  } catch {
    await sendProblem(
      input.reply,
      input.requestId,
      503,
      'authority_unavailable',
      'Session authority is temporarily unavailable.',
    );
    return 'sent';
  }
  return 'finalized';
}

/**
 * GET /api/platform/v1/account/deletion/preflight — A5. Session-authLevel.
 * Resolves the unique-owner blocking projection for the current account (spec
 * §5.2/§6): a `kind='organization'` org of which the account is the sole owner
 * blocks deletion; the personal workspace never blocks (spec §6.2). Also runs
 * the lazy-finalization guard so a `deletion_cooling` account that has reached
 * its deadline is advanced (and surfaces as `unavailable` once terminated).
 */
export async function handleDeleteAccountPreflight(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();
  const now = deps.now();

  const parsed = parseInput(PREFLIGHT_OPERATION, { body: request.body });
  if (!parsed.ok) {
    await sendProblem(
      reply,
      requestId,
      400,
      'structural_error',
      'Request does not match the public contract.',
    );
    return;
  }

  const session = await requireSession(request, reply, requestId);
  if (session === null) return;

  let account;
  try {
    account = await getAccountById(deps.pool, session.accountId);
  } catch {
    await sendProblem(
      reply,
      requestId,
      503,
      'authority_unavailable',
      'Account store is temporarily unavailable.',
    );
    return;
  }
  if (account === null) {
    await sendProblem(reply, requestId, 404, 'not_found', 'The account was not found.');
    return;
  }

  // Lazy finalization (spec §4.2: 预检 is one of the trigger paths). A cooling
  // account that has crossed its deadline advances here; a terminated account's
  // preflight is no longer meaningful.
  if (account.status === 'deletion_cooling') {
    const finalization = await maybeFinalizeDeletion({
      pool: deps.pool,
      account,
      now,
      sessionStore: deps.sessionStore,
      requestId,
      reply,
    });
    if (finalization === 'sent') return;
    if (finalization === 'finalized') {
      const serialized = serializeOutput(PREFLIGHT_OPERATION, 200, {
        status: 'unavailable',
        requiredLifecycle: PREFLIGHT_LIFECYCLE,
        serverTime: now.toISOString(),
      });
      if (!serialized.ok) {
        await sendProblem(reply, requestId, 500, 'internal_error', 'An internal error occurred.');
        return;
      }
      void reply.header('x-aurora-request-id', requestId).code(200).send(serialized.body);
      return;
    }
    // kept_cooling (owner-blocked) / not_applicable: the account stays frozen;
    // fall through to surface the current blockers.
  }

  let memberships;
  try {
    memberships = await listAccountOrganizations(deps.pool, session.accountId);
  } catch {
    await sendProblem(
      reply,
      requestId,
      503,
      'authority_unavailable',
      'Account store is temporarily unavailable.',
    );
    return;
  }

  const blockingOrganizations: {
    organizationId: string;
    organizationName: string;
    organizationKind: 'organization';
  }[] = [];
  for (const membership of memberships) {
    if (membership.kind !== 'organization') continue;
    let blocked: boolean;
    try {
      blocked = await isUniqueOrganizationOwner(deps.pool, {
        orgId: membership.organizationId,
        accountId: session.accountId,
      });
    } catch {
      await sendProblem(
        reply,
        requestId,
        503,
        'authority_unavailable',
        'Account store is temporarily unavailable.',
      );
      return;
    }
    if (blocked) {
      blockingOrganizations.push({
        organizationId: membership.organizationId,
        organizationName: membership.name,
        organizationKind: 'organization',
      });
    }
  }

  const blockedCount = blockingOrganizations.length;
  if (blockedCount > 0) {
    try {
      await insertAuditEvent(deps.pool, {
        actorAccountId: session.accountId,
        targetAccountId: session.accountId,
        action: 'account.deletion.preflight_blocked',
        details: { blockedOrganizationCount: blockedCount },
      });
    } catch (error) {
      if (await sendMappedError(reply, requestId, error)) return;
      throw error;
    }
  }

  const response = {
    status: blockedCount > 0 ? ('blocked' as const) : ('ready' as const),
    ...(blockedCount > 0 ? { blockingOrganizations } : {}),
    requiredLifecycle: PREFLIGHT_LIFECYCLE,
    serverTime: now.toISOString(),
  };

  const serialized = serializeOutput(PREFLIGHT_OPERATION, 200, response);
  if (!serialized.ok) {
    await sendProblem(reply, requestId, 500, 'internal_error', 'An internal error occurred.');
    return;
  }
  void reply.header('x-aurora-request-id', requestId).code(200).send(serialized.body);
}

/**
 * POST /api/platform/v1/account/deletion/request — A5. Session-authLevel + CSRF +
 * idempotency (spec §5.1/§7). The production path that creates the
 * `deletion_request` intent and sends the confirmed-mailbox link: without this
 * the delete command's mailbox factor can never be satisfied end-to-end. Reads
 * the current account from the session (the session established identity), then
 * atomically { insertDeletionIntent(digest-only, 2h) + outbox email row with the
 * transient token + audit + idempotency }. The response is uniform (masked
 * recipient + resend cooldown) and never leaks the token or the full email.
 */
export async function handleRequestAccountDeletion(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();
  const now = deps.now();

  const parsed = parseInput(REQUEST_ACCOUNT_DELETION_OPERATION, { body: request.body });
  if (!parsed.ok) {
    await sendProblem(
      reply,
      requestId,
      400,
      'structural_error',
      'Request does not match the public contract.',
    );
    return;
  }
  const input = parsed.data.body as RequestAccountDeletionBody;

  const session = await requireSession(request, reply, requestId);
  if (session === null) return;

  let account;
  try {
    account = await getAccountById(deps.pool, session.accountId);
  } catch {
    await sendProblem(
      reply,
      requestId,
      503,
      'authority_unavailable',
      'Account store is temporarily unavailable.',
    );
    return;
  }
  if (account === null) {
    await sendProblem(reply, requestId, 404, 'not_found', 'The account was not found.');
    return;
  }

  // Lazy finalization guard (spec §4.2): a cooling account that re-requests has
  // its deadline re-evaluated server-authoritatively. A terminated account — or
  // one finalized by the guard — is past the point of no return and cannot send
  // a new confirmation; an unconsumed `deletion_cooling` account is already
  // inside the deletion flow.
  if (account.status === 'terminated') {
    await sendProblem(
      reply,
      requestId,
      409,
      'state_machine_conflict',
      'This account has already been deleted.',
    );
    return;
  }
  if (account.status === 'deletion_cooling') {
    const finalization = await maybeFinalizeDeletion({
      pool: deps.pool,
      account,
      now,
      sessionStore: deps.sessionStore,
      requestId,
      reply,
    });
    if (finalization === 'sent') return;
    try {
      account = await getAccountById(deps.pool, session.accountId);
    } catch {
      await sendProblem(
        reply,
        requestId,
        503,
        'authority_unavailable',
        'Account store is temporarily unavailable.',
      );
      return;
    }
    if (account === null) {
      await sendProblem(reply, requestId, 404, 'not_found', 'The account was not found.');
      return;
    }
    if (account.status === 'terminated') {
      await sendProblem(
        reply,
        requestId,
        409,
        'state_machine_conflict',
        'This account has already been deleted.',
      );
      return;
    }
    if (account.status === 'deletion_cooling') {
      await sendProblem(
        reply,
        requestId,
        409,
        'state_machine_conflict',
        'Account deletion is already in progress.',
      );
      return;
    }
  }

  const accountId = account.accountId;
  const base = deps.config.consoleOrigin.replace(/\/$/, '');
  let idempotency: IdempotentCommandResult;
  try {
    idempotency = await runIdempotentCommand({
      pool: deps.pool,
      key: input.idempotencyKey,
      operation: OPERATION_ID_REQUEST_ACCOUNT_DELETION,
      digest: requestDigest(input),
      execute: async (client) => {
        // The request-confirm intent: digest-only, bound to the account, 2h TTL
        // (spec §7). The raw token travels ONLY in the outbox email payload.
        const { token, digest } = createIntentToken();
        const expiresAt = new Date(now.getTime() + REQUEST_INTENT_MS);
        await insertDeletionIntent(client, {
          accountId,
          intentKind: 'deletion_request',
          tokenDigest: digest,
          expiresAt,
        });
        await insertOutboxRow(client, {
          aggregateType: 'email.deletion_request',
          aggregateId: accountId,
          payload: {
            intentType: 'deletion_confirmation',
            toAddress: account.email,
            toMasked: maskEmail(account.email),
            mailLinkUrl: `${base}/account/deletion-confirm?token=${token}`,
            expiresInMinutes: REQUEST_INTENT_HOURS * 60,
          },
        });
        await insertAuditEvent(client, {
          actorAccountId: accountId,
          targetAccountId: accountId,
          action: 'account.deletion.email_requested',
          details: { requestedAt: now.toISOString() },
        });
        // Uniform response — never reveals the token or the full email (spec
        // §5.2). resendAvailableAt is the earliest the confirmation can be sent
        // again (a replay converges to the first-run cooldown).
        return {
          status: 'succeeded' as const,
          maskedEmail: maskEmail(account.email),
          resendAvailableAt: new Date(now.getTime() + REQUEST_EMAIL_COOLDOWN_MS).toISOString(),
        };
      },
    });
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }

  if (idempotency.outcome === 'conflict') {
    await sendProblem(reply, requestId, 409, 'idempotency_conflict', 'Idempotency key conflict.');
    return;
  }

  const serialized = serializeOutput(
    REQUEST_ACCOUNT_DELETION_OPERATION,
    200,
    idempotency.resultData,
  );
  if (!serialized.ok) {
    await sendProblem(reply, requestId, 500, 'internal_error', 'An internal error occurred.');
    return;
  }
  void reply.header('x-aurora-request-id', requestId).code(200).send(serialized.body);
}

/**
 * GET /api/platform/v1/account/deletion/intent/:token — A5 request-link GET
 * (spec §7). Mirrors the PLT-03 intent-link pattern (intent-links.ts): validates
 * the raw `deletion_request` token against the intent table (digest-only),
 * establishes the short-lived HttpOnly intent cookie (clearing the token from
 * the URL) and returns the intent-bound CSRF secret for the confirm POST.
 * Expired/consumed intents map to 409 (the token is a capability; no
 * account-existence leak).
 */
export async function handleDeleteAccountIntentLink(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();
  const params = request.params as TokenParams;
  const token = params.token;
  if (typeof token !== 'string' || token.length === 0 || token.length > 256) {
    await sendProblem(reply, requestId, 404, 'not_found', 'The intent was not found.');
    return;
  }

  let intent;
  try {
    intent = await findDeletionIntentByDigest(deps.pool, 'deletion_request', digestOf(token));
  } catch {
    await sendProblem(
      reply,
      requestId,
      503,
      'authority_unavailable',
      'Account store is temporarily unavailable.',
    );
    return;
  }
  const now = deps.now().getTime();
  if (intent?.consumedAt !== null || Date.parse(intent.expiresAt) <= now) {
    await sendProblem(
      reply,
      requestId,
      409,
      'business_validation',
      'The deletion confirmation is no longer valid.',
    );
    return;
  }

  let masked = '';
  try {
    const account = await getAccountById(deps.pool, intent.accountId);
    if (account !== null) masked = maskEmail(account.email);
  } catch {
    // The intent is valid; a display mask is best-effort and never a blocker.
  }

  const csrfSecret = createCsrfSecret();
  const remainingMs = Math.max(60_000, Date.parse(intent.expiresAt) - now);
  setIntentCookie(reply, 'deletion_request', token, csrfSecret, deps.cookieOptions, remainingMs);

  void reply
    .header('x-aurora-request-id', requestId)
    .code(200)
    .send({
      status: 'valid',
      csrf: csrfSecret,
      ...(masked === '' ? {} : { maskedEmail: masked }),
      intentKind: 'deletion_request',
    });
}

/**
 * POST /api/platform/v1/account/deletion — A5. Session-authLevel + CSRF +
 * idempotency (spec §5.1/§7). Dual-factor re-check (current password + the
 * one-time mailbox `deletion_request` intent cookie), then atomically {
 * in-transaction final unique-owner re-check + consumeIntent +
 * recordDeletionRequest + create deletion_cancel intent + confirm email +
 * audit + idempotency }. On commit every session is revoked (the user must
 * re-login and can only cancel through the emailed cancel link).
 */
export async function handleDeleteAccount(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();
  const now = deps.now();

  const parsed = parseInput(DELETE_ACCOUNT_OPERATION, { body: request.body });
  if (!parsed.ok) {
    await sendProblem(
      reply,
      requestId,
      400,
      'structural_error',
      'Request does not match the public contract.',
    );
    return;
  }
  const input = parsed.data.body as DeleteAccountBody;

  const session = await requireSession(request, reply, requestId);
  if (session === null) return;

  let account;
  try {
    account = await getAccountById(deps.pool, session.accountId);
  } catch {
    await sendProblem(
      reply,
      requestId,
      503,
      'authority_unavailable',
      'Account store is temporarily unavailable.',
    );
    return;
  }
  if (account === null) {
    await sendProblem(reply, requestId, 404, 'not_found', 'The account was not found.');
    return;
  }

  // Lazy finalization guard: a cooling account that re-attempts deletion has its
  // deadline re-evaluated server-authoritatively. A terminated account (or one
  // finalized by the guard) is past the point of no return and cannot re-delete.
  if (account.status === 'terminated') {
    await sendProblem(
      reply,
      requestId,
      409,
      'state_machine_conflict',
      'This account has already been deleted.',
    );
    return;
  }
  if (account.status === 'deletion_cooling') {
    const finalization = await maybeFinalizeDeletion({
      pool: deps.pool,
      account,
      now,
      sessionStore: deps.sessionStore,
      requestId,
      reply,
    });
    if (finalization === 'sent') return;
    try {
      account = await getAccountById(deps.pool, session.accountId);
    } catch {
      await sendProblem(
        reply,
        requestId,
        503,
        'authority_unavailable',
        'Account store is temporarily unavailable.',
      );
      return;
    }
    if (account === null) {
      await sendProblem(reply, requestId, 404, 'not_found', 'The account was not found.');
      return;
    }
    if (account.status === 'terminated') {
      await sendProblem(
        reply,
        requestId,
        409,
        'state_machine_conflict',
        'This account has already been deleted.',
      );
      return;
    }
    if (account.status === 'deletion_cooling') {
      await sendProblem(
        reply,
        requestId,
        409,
        'state_machine_conflict',
        'Account deletion is already in progress.',
      );
      return;
    }
  }

  const intentPayload = request.intentPayload;
  if (intentPayload?.kind !== 'deletion_request') {
    await sendProblem(
      reply,
      requestId,
      404,
      'not_found',
      'The deletion confirmation was not found.',
    );
    return;
  }

  const currentOk = await verifyPassword(input.currentPassword, account.passwordHash ?? '');
  if (!currentOk) {
    await sendProblem(
      reply,
      requestId,
      403,
      'authorization',
      'Current password verification failed.',
    );
    return;
  }

  let intent;
  try {
    intent = await findDeletionIntentByDigest(
      deps.pool,
      'deletion_request',
      digestOf(intentPayload.token),
    );
  } catch {
    await sendProblem(
      reply,
      requestId,
      503,
      'authority_unavailable',
      'Account store is temporarily unavailable.',
    );
    return;
  }
  if (intent?.consumedAt !== null || Date.parse(intent.expiresAt) <= now.getTime()) {
    await sendProblem(
      reply,
      requestId,
      409,
      'business_validation',
      'The deletion confirmation is no longer valid.',
    );
    return;
  }
  // The mailbox confirmation must be bound to THIS account (spec §7: intent is
  // only valid for its own account + intent). A deletion_request intent created
  // for a different account must never authorize deleting the session account —
  // otherwise the email factor is bypassable cross-account.
  if (intent.accountId !== account.accountId) {
    await sendProblem(
      reply,
      requestId,
      409,
      'business_validation',
      'The deletion confirmation is no longer valid.',
    );
    return;
  }

  const accountId = account.accountId;
  let idempotency: IdempotentCommandResult;
  try {
    idempotency = await runIdempotentCommand({
      pool: deps.pool,
      key: input.idempotencyKey,
      operation: OPERATION_ID_DELETE_ACCOUNT,
      digest: requestDigest(input),
      execute: async (client) => {
        // In-transaction final unique-owner re-check (spec §6): the client
        // preflight may be stale; the authoritative memberships are re-read on
        // the command transaction and any blocker fails the whole command closed.
        const memberships = await listAccountOrganizations(client, accountId);
        for (const membership of memberships) {
          if (membership.kind !== 'organization') continue;
          if (
            await isUniqueOrganizationOwner(client, {
              orgId: membership.organizationId,
              accountId,
            })
          ) {
            throw new ServiceError(
              409,
              'state_machine_conflict',
              'You are the unique owner of an organization. Transfer ownership before deleting this account.',
            );
          }
        }

        const consumed = await consumeDeletionIntent(client, {
          intentId: intent.intentId,
          now,
        });
        if (consumed.status === 'already_consumed' || consumed.status === 'expired') {
          throw new ServiceError(
            409,
            'business_validation',
            'The deletion confirmation is no longer valid.',
          );
        }
        if (consumed.status === 'not_found') {
          throw new ServiceError(404, 'not_found', 'The deletion confirmation was not found.');
        }

        const coolingEndsAt = new Date(now.getTime() + COOLING_MS);
        const recorded = await recordDeletionRequest(client, { accountId, coolingEndsAt, now });
        if (recorded.status === 'not_found') {
          throw new ServiceError(404, 'not_found', 'The account was not found.');
        }

        // Create the cancel intent + email in the SAME transaction (spec §7.1):
        // after all sessions are revoked the user can only cancel through this
        // emailed link, bounded strictly inside the cooling window.
        const { token, digest } = createIntentToken();
        const cancelExpiresAt = new Date(now.getTime() + CANCEL_INTENT_MS);
        await insertDeletionIntent(client, {
          accountId,
          intentKind: 'deletion_cancel',
          tokenDigest: digest,
          expiresAt: cancelExpiresAt,
        });
        const base = deps.config.consoleOrigin.replace(/\/$/, '');
        await insertOutboxRow(client, {
          aggregateType: 'email.deletion_cancel',
          aggregateId: accountId,
          payload: {
            intentType: 'deletion_confirmation',
            toAddress: account.email,
            toMasked: maskEmail(account.email),
            mailLinkUrl: `${base}/account/deletion-cancel?token=${token}`,
            expiresInMinutes: CANCEL_INTENT_HOURS * 60,
          },
        });

        await insertAuditEvent(client, {
          actorAccountId: accountId,
          targetAccountId: accountId,
          action: 'account.deletion.requested',
          details: {
            requestedAt: now.toISOString(),
            coolingEndsAt: coolingEndsAt.toISOString(),
          },
        });

        return {
          status: 'succeeded' as const,
          accountStatus: 'deletion_cooling' as const,
          deletionRequestedAt: now.toISOString(),
          deletionCoolingEndsAt: coolingEndsAt.toISOString(),
          sessionImpact: 'revoked_all' as const,
        };
      },
    });
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }

  if (idempotency.outcome === 'conflict') {
    await sendProblem(reply, requestId, 409, 'idempotency_conflict', 'Idempotency key conflict.');
    return;
  }

  // Post-commit (fresh AND replay): terminate every session and drop the session
  // + intent cookies (mirrors password.ts + email-verification.ts). The user must
  // re-login; only the emailed cancel link remains usable.
  try {
    await revokeAllAccountSessions(deps.sessionStore, accountId);
  } catch {
    await sendProblem(
      reply,
      requestId,
      503,
      'authority_unavailable',
      'Session authority is temporarily unavailable.',
    );
    return;
  }
  clearSessionCookie(reply, deps.cookieOptions);
  clearIntentCookieOnReply(reply, deps.cookieOptions);

  const serialized = serializeOutput(DELETE_ACCOUNT_OPERATION, 200, idempotency.resultData);
  if (!serialized.ok) {
    await sendProblem(reply, requestId, 500, 'internal_error', 'An internal error occurred.');
    return;
  }
  void reply.header('x-aurora-request-id', requestId).code(200).send(serialized.body);
}

/**
 * GET /api/platform/v1/account/deletion/cancel/intent/:token — A5 cancel-link
 * GET (spec §7). Mirrors the request-link GET for the `deletion_cancel` intent.
 */
export async function handleCancelAccountDeletionIntentLink(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();
  const params = request.params as TokenParams;
  const token = params.token;
  if (typeof token !== 'string' || token.length === 0 || token.length > 256) {
    await sendProblem(reply, requestId, 404, 'not_found', 'The intent was not found.');
    return;
  }

  let intent;
  try {
    intent = await findDeletionIntentByDigest(deps.pool, 'deletion_cancel', digestOf(token));
  } catch {
    await sendProblem(
      reply,
      requestId,
      503,
      'authority_unavailable',
      'Account store is temporarily unavailable.',
    );
    return;
  }
  const now = deps.now().getTime();
  if (intent?.consumedAt !== null || Date.parse(intent.expiresAt) <= now) {
    await sendProblem(
      reply,
      requestId,
      409,
      'business_validation',
      'The cancellation confirmation is no longer valid.',
    );
    return;
  }

  let masked = '';
  try {
    const account = await getAccountById(deps.pool, intent.accountId);
    if (account !== null) masked = maskEmail(account.email);
  } catch {
    // The intent is valid; a display mask is best-effort and never a blocker.
  }

  const csrfSecret = createCsrfSecret();
  const remainingMs = Math.max(60_000, Date.parse(intent.expiresAt) - now);
  setIntentCookie(reply, 'deletion_cancel', token, csrfSecret, deps.cookieOptions, remainingMs);

  void reply
    .header('x-aurora-request-id', requestId)
    .code(200)
    .send({
      status: 'valid',
      csrf: csrfSecret,
      ...(masked === '' ? {} : { maskedEmail: masked }),
      intentKind: 'deletion_cancel',
    });
}

/**
 * POST /api/platform/v1/account/deletion/cancel — A5. Intent-authLevel + CSRF +
 * idempotency (spec §5.1/§7). Runs entirely from the `deletion_cancel` intent
 * cookie (no session — all sessions were revoked at request time). Re-verifies
 * the current password, then atomically { row-locked status re-check +
 * consumeIntent + updateAccountStatus(active) + audit + idempotency }. Only a
 * `deletion_cooling` account that has not crossed the irreversible boundary may
 * be cancelled; an overdue-but-owner-blocked account stays cancellable (spec §3).
 */
export async function handleCancelAccountDeletion(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: PlatformApiRouteDependencies,
): Promise<void> {
  const requestId = deps.requestIdProvider();
  const now = deps.now();

  const parsed = parseInput(CANCEL_OPERATION, { body: request.body });
  if (!parsed.ok) {
    await sendProblem(
      reply,
      requestId,
      400,
      'structural_error',
      'Request does not match the public contract.',
    );
    return;
  }
  const input = parsed.data.body as CancelDeletionBody;

  const intentPayload = request.intentPayload;
  if (intentPayload?.kind !== 'deletion_cancel') {
    await sendProblem(
      reply,
      requestId,
      404,
      'not_found',
      'The cancellation confirmation was not found.',
    );
    return;
  }

  let intent;
  try {
    intent = await findDeletionIntentByDigest(
      deps.pool,
      'deletion_cancel',
      digestOf(intentPayload.token),
    );
  } catch {
    await sendProblem(
      reply,
      requestId,
      503,
      'authority_unavailable',
      'Account store is temporarily unavailable.',
    );
    return;
  }
  if (intent?.consumedAt !== null || Date.parse(intent.expiresAt) <= now.getTime()) {
    await sendProblem(
      reply,
      requestId,
      409,
      'business_validation',
      'The cancellation confirmation is no longer valid.',
    );
    return;
  }

  let account;
  try {
    account = await getAccountById(deps.pool, intent.accountId);
  } catch {
    await sendProblem(
      reply,
      requestId,
      503,
      'authority_unavailable',
      'Account store is temporarily unavailable.',
    );
    return;
  }
  if (account === null) {
    await sendProblem(reply, requestId, 404, 'not_found', 'The account was not found.');
    return;
  }

  if (account.status !== 'deletion_cooling') {
    await sendProblem(
      reply,
      requestId,
      409,
      'state_machine_conflict',
      'Deletion is not in a cancellable state.',
    );
    return;
  }

  // Lazy finalization guard: an overdue + unblocked account is past the point of
  // no return and cannot be cancelled. Only a `kept_cooling` (owner-blocked) or
  // not-yet-due account remains cancellable (spec §3/§4.2).
  const finalization = await maybeFinalizeDeletion({
    pool: deps.pool,
    account,
    now,
    sessionStore: deps.sessionStore,
    requestId,
    reply,
  });
  if (finalization === 'sent') return;
  if (finalization === 'finalized') {
    await sendProblem(
      reply,
      requestId,
      409,
      'state_machine_conflict',
      'Account deletion has already completed and cannot be cancelled.',
    );
    return;
  }

  const currentOk = await verifyPassword(input.currentPassword, account.passwordHash ?? '');
  if (!currentOk) {
    await sendProblem(
      reply,
      requestId,
      403,
      'authorization',
      'Current password verification failed.',
    );
    return;
  }

  const accountId = intent.accountId;
  let idempotency: IdempotentCommandResult;
  try {
    idempotency = await runIdempotentCommand({
      pool: deps.pool,
      key: input.idempotencyKey,
      operation: OPERATION_ID_CANCEL_ACCOUNT_DELETION,
      digest: requestDigest(input),
      execute: async (client) => {
        // Row-lock the account so a concurrent boundary finalization serializes
        // here (spec §4.2 不变量): only a `deletion_cooling` account may cancel.
        const locked = await getAccountByIdForUpdate(client, accountId);
        if (locked === null) {
          throw new ServiceError(404, 'not_found', 'The account was not found.');
        }
        if (locked.status !== 'deletion_cooling') {
          throw new ServiceError(
            409,
            'state_machine_conflict',
            'Deletion is not in a cancellable state.',
          );
        }
        // Under the lock, re-evaluate the irreversible boundary: an overdue
        // account whose final owner re-check now passes cannot be cancelled.
        if (
          decideDeletionFinalization({
            status: locked.status,
            deletionCoolingEndsAt: locked.deletionCoolingEndsAt,
            now,
            ownerBlocked: false,
          }) === 'finalize'
        ) {
          const memberships = await listAccountOrganizations(client, accountId);
          let ownerBlocked = false;
          for (const membership of memberships) {
            if (membership.kind !== 'organization') continue;
            if (
              await isUniqueOrganizationOwner(client, {
                orgId: membership.organizationId,
                accountId,
              })
            ) {
              ownerBlocked = true;
              break;
            }
          }
          if (!ownerBlocked) {
            throw new ServiceError(
              409,
              'state_machine_conflict',
              'Account deletion has already passed the point of no return.',
            );
          }
        }

        const consumed = await consumeDeletionIntent(client, {
          intentId: intent.intentId,
          now,
        });
        if (consumed.status === 'already_consumed' || consumed.status === 'expired') {
          throw new ServiceError(
            409,
            'business_validation',
            'The cancellation confirmation is no longer valid.',
          );
        }
        if (consumed.status === 'not_found') {
          throw new ServiceError(404, 'not_found', 'The cancellation confirmation was not found.');
        }

        const updated = await updateAccountStatus(client, { accountId, status: 'active', now });
        if (updated.status === 'not_found') {
          throw new ServiceError(404, 'not_found', 'The account was not found.');
        }
        await insertAuditEvent(client, {
          actorAccountId: accountId,
          targetAccountId: accountId,
          action: 'account.deletion.cancelled',
          details: { cancelledAt: now.toISOString() },
        });

        return {
          status: 'succeeded' as const,
          accountStatus: 'active' as const,
          sessionImpact: 'revoked_all' as const,
        };
      },
    });
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return;
    throw error;
  }

  if (idempotency.outcome === 'conflict') {
    await sendProblem(reply, requestId, 409, 'idempotency_conflict', 'Idempotency key conflict.');
    return;
  }

  // Post-commit (fresh AND replay): revoke any remaining sessions (the account is
  // active again but the user must re-login) and drop the intent cookie.
  try {
    await revokeAllAccountSessions(deps.sessionStore, accountId);
  } catch {
    await sendProblem(
      reply,
      requestId,
      503,
      'authority_unavailable',
      'Session authority is temporarily unavailable.',
    );
    return;
  }
  clearIntentCookieOnReply(reply, deps.cookieOptions);

  const serialized = serializeOutput(CANCEL_OPERATION, 200, idempotency.resultData);
  if (!serialized.ok) {
    await sendProblem(reply, requestId, 500, 'internal_error', 'An internal error occurred.');
    return;
  }
  void reply.header('x-aurora-request-id', requestId).code(200).send(serialized.body);
}
