# Email Verification Delivery and Resend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver real Aurora email-verification messages through Alibaba Cloud DirectMail for new registrations, let authenticated historical unverified accounts safely resend, and make the transactional email outbox recoverable, bounded, and token-safe.

**Architecture:** Keep identity state changes and email intent/outbox creation in one PostgreSQL transaction. Expose a Session + CSRF protected resend command through the platform contract and Fastify API. Let `platform-worker` claim fenced outbox rows and call an injected `EmailDeliveryPort`; the Aliyun adapter owns SDK/request/error mapping while identity and HTTP layers remain provider-neutral. Restore the Console page from authoritative Session state instead of browser-only registration handoff data.

**Tech Stack:** TypeScript 6 strict mode, Node.js 24, Zod/OpenAPI 3.1, Fastify 5, PostgreSQL 17.10/`pg`/`node-pg-migrate`, Redis 7.4 sessions, Vue 3/Pinia/Vitest/Testing Library/Playwright/axe, `@alicloud/dm20151123` 1.10.2, `@alicloud/credentials` 2.4.5, pnpm 11.17.0.

## Global Constraints

- Approved source: `docs/superpowers/specs/2026-08-14-email-verification-delivery-and-resend-design.md`, PRD rule `RULE-EMAIL-VERIFICATION-RESEND-20260814-001`, accepted ADR-031 and ADR-032.
- Use test-driven development for every behavior change: write one focused failing test, run it and observe the expected failure, implement the minimum behavior, then rerun the focused and adjacent suites.
- Never log or persist Alibaba Cloud credentials, cookies, raw intent tokens, full recipient addresses, rendered bodies, or provider error bodies. Never ask the user to paste credentials into chat.
- `queued` means the identity transaction committed an Outbox row. `accepted` means DirectMail accepted the API request. Neither means inbox delivery.
- The resend request never accepts an email address. Account and normalized email come only from the authenticated Session/account row.
- The database is authoritative for cooldown, rolling quota, latest-link validity, idempotency, and claim ownership. In-memory/IP limiting is defense in depth only.
- Keep the default limits fixed unless a later approved decision changes them: 60-second cooldown, 5 accepted resends per rolling 24 hours, two-hour verification intent, five provider attempts, 10-second provider timeout, five-minute processing lease timeout.
- Do not edit generated `dist/` files. Regenerate Platform OpenAPI and the manifest with the repository generator.
- Preserve user-owned `.superpowers/brainstorm/` and unrelated dirty-tree changes.
- Before implementation, create or obtain consent for an isolated linked worktree as required by `superpowers:using-git-worktrees`; the current checkout is only on a feature branch and is not a linked worktree.
- Automated tests inject the DirectMail client and never send real mail. The final public smoke test is explicit and protected by deployment credentials.

---

## Task 1: Freeze the Resend and Session Contract

**Files:**

- Modify: `packages/platform-contract/src/identity/email-verification.ts`
- Modify: `packages/platform-contract/src/identity/register.ts`
- Modify: `packages/platform-contract/src/identity/session.ts`
- Modify: `packages/platform-contract/src/common/problem-details.ts`
- Modify: `packages/platform-contract/src/registry/operations.ts`
- Modify: `packages/platform-contract/src/contract-testkit/samples.ts`
- Modify: `packages/platform-contract/src/contract-testkit/index.ts`
- Modify: `packages/platform-contract/test/identity/email-verification.test.ts`
- Modify: `packages/platform-contract/test/identity/register.test.ts`
- Modify: `packages/platform-contract/test/identity/session.test.ts`
- Modify: `packages/platform-contract/test/common/contracts.test.ts`
- Modify: `packages/platform-contract/test/contract-testkit/samples.test.ts`
- Modify (generated): `docs/api/platform-openapi-v1.yaml`
- Modify (generated): `docs/api/platform-openapi-v1.manifest.json`

- [ ] **Step 1: Add failing closed-schema tests**

Add tests proving:

- `identityResendEmailVerificationRequest` accepts only `{ idempotencyKey }` and rejects `email` or unknown keys;
- the resend response requires `deliveryStatus: 'queued'`, `emailMasked`, `resendAvailableAt`, and `serverTime`;
- the registration response also requires `deliveryStatus: 'queued'`;
- the Session account summary includes server-produced `emailMasked`;
- the shared closed problem schema permits optional absolute `resendAvailableAt` alongside numeric `retryAfter`;
- the registry entry is `POST /api/platform/v1/auth/email/resend`, `authLevel: 'session'`, `csrf: true`, and `idempotency: true`.

Define the contract shape under test:

```ts
export const OPERATION_ID_RESEND_EMAIL_VERIFICATION =
  'identityResendEmailVerification' as const;

export const identityResendEmailVerificationRequest = obj({ idempotencyKey });

export const identityResendEmailVerificationResponse = obj({
  emailMasked: str(3, 320),
  deliveryStatus: enum_(['queued']),
  resendAvailableAt: utcTimestamp,
  serverTime: utcTimestamp,
});
```

- [ ] **Step 2: Run the focused tests and confirm the red state**

Run:

```powershell
pnpm --filter @aurora/platform-contract exec vitest run test/identity/email-verification.test.ts test/identity/register.test.ts test/identity/session.test.ts test/common/contracts.test.ts test/contract-testkit/samples.test.ts
```

Expected: failures for missing resend exports/registry operation and missing required response fields.

- [ ] **Step 3: Implement the contract and samples**

Add `deliveryStatus` as a required queued literal to registration. Add `emailMasked` to the Session account summary. Register the resend operation next to confirmation and add valid request/response samples to the public contract testkit. Keep all schemas closed using the existing `obj` helper.

- [ ] **Step 4: Regenerate and verify machine artifacts**

Run:

```powershell
pnpm platform-contract:generate
pnpm --filter @aurora/platform-contract test
pnpm platform-contract:drift
pnpm openapi:platform:lint
```

Expected: contract suite, drift gate, and Redocly lint pass; OpenAPI contains the new path and generated schemas.

- [ ] **Step 5: Commit the contract increment**

```powershell
git add packages/platform-contract docs/api/platform-openapi-v1.yaml docs/api/platform-openapi-v1.manifest.json
git commit -m "feat(contract): add email verification resend command"
```

---

## Task 2: Add Durable Resend State and Fenced Outbox Transitions

**Files:**

- Create: `packages/platform-identity/migrations/1897000000002_email-verification-resend-and-outbox-reliability.ts`（实施时按已冻结的生产迁移基线单调编号）
- Modify: `packages/platform-identity/src/repositories/accounts.ts`
- Modify: `packages/platform-identity/src/repositories/intents.ts`
- Modify: `packages/platform-identity/src/repositories/outbox.ts`
- Modify: `packages/platform-identity/src/index.ts`
- Modify: `packages/platform-identity/test/integration/migrations.test.ts`
- Modify: `packages/platform-identity/test/integration/accounts.test.ts`
- Modify: `packages/platform-identity/test/integration/intents.test.ts`
- Modify: `packages/platform-identity/test/integration/outbox.test.ts`

- [ ] **Step 1: Write failing migration and repository integration tests**

Cover all of these against PostgreSQL 17.10:

- migration adds `superseded` to the Outbox state constraint;
- Outbox has nullable `claim_id uuid`, `last_error_code text`, and `provider_request_id text`;
- `getAccountByIdForUpdate` serializes concurrent work;
- verification activation sets `verified_at` and advances only `pending_verification -> active`;
- superseding verification intents consumes only unused intents for the same account;
- resend state counts only `email.verification.resend` rows in the rolling window while both initial and resend rows participate in the cooldown timestamp;
- superseding unsent verification rows changes only `pending`/`failed` rows to `superseded` and scrubs payload;
- claim selects available `pending`/`failed` rows and stale `processing` rows, assigns a fresh claim UUID, and skips active claims;
- settlement requires the current claim UUID, supports retry `availableAt`, and scrubs payload on `succeeded`/`dead_lettered`;
- a stale worker receives `stale_claim` and cannot overwrite the newer claim.

Use these repository contracts:

```ts
export type OutboxStatus =
  | 'pending'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'dead_lettered'
  | 'superseded';

export interface ClaimOutboxRowsInput {
  readonly limit: number;
  readonly now: Date;
  readonly processingTimeoutMs: number;
}

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
```

- [ ] **Step 2: Run focused database tests and confirm the red state**

With the repository test services running, use the same non-production credentials as CI:

```powershell
$env:AURORA_TEST_DATABASE_URL='postgresql://aurora:aurora_ci_test_pw@localhost:5432/aurora_inbox_test'
pnpm --filter @aurora/platform-identity exec vitest run test/integration/migrations.test.ts test/integration/accounts.test.ts test/integration/intents.test.ts test/integration/outbox.test.ts --no-file-parallelism
```

Expected: missing migration fields, missing functions, and existing claim/settle semantics fail the new assertions.

- [ ] **Step 3: Implement the forward-only migration**

Replace the Outbox status check constraint with the six-state set, add the diagnostic/fencing columns, and create bounded query indexes:

```sql
CREATE INDEX outbox_claimable_idx ON outbox (status, available_at, outbox_id);
CREATE INDEX outbox_email_resend_window_idx
  ON outbox (aggregate_id, aggregate_type, created_at);
```

The down migration may remove only this increment; deployment rollback must not run it after new-state rows exist.

- [ ] **Step 4: Implement account activation, intent supersession, and resend queries**

Add:

```ts
supersedeEmailVerificationIntents(pool, { accountId, now })
getEmailVerificationResendState(pool, {
  accountId,
  now,
  cooldownMs,
  rollingWindowMs,
})
supersedePendingEmailVerificationOutbox(pool, { accountId, now })
```

Return `{ lastAcceptedAt: string | null, resendCount: number }`. Count the registration row only when calculating the most recent accepted send; count only `.resend` for the five-per-day quota. Do not store a raw token outside the existing transient Outbox payload.

- [ ] **Step 5: Implement fenced claim and settlement**

Claim rows with `FOR UPDATE SKIP LOCKED`, set `status='processing'`, generate a new `claim_id`, and set `updated_at=input.now`. A row is claimable when:

```sql
(status IN ('pending', 'failed') AND available_at <= now)
OR (status = 'processing' AND updated_at <= now - processing_timeout)
```

Settlement must use `WHERE outbox_id = $1 AND status = 'processing' AND claim_id = $2`. Distinguish nonexistent rows from mismatched claims with a read after a zero-row update. Clear `claim_id` after settlement; set `payload='{}'::jsonb` when `clearPayload` is true.

- [ ] **Step 6: Verify identity integration and package boundaries**

Run:

```powershell
pnpm --filter @aurora/platform-identity test:integration
pnpm --filter @aurora/platform-identity typecheck
pnpm --filter @aurora/platform-identity build
pnpm check:boundaries
```

Expected: all identity integration tests pass and no data-layer cross-import is introduced.

- [ ] **Step 7: Commit the durable state increment**

```powershell
git add packages/platform-identity
git commit -m "feat(identity): add resend state and fenced email outbox"
```

---

## Task 3: Implement Atomic Registration, Confirmation, and Authenticated Resend

**Files:**

- Modify: `apps/platform-api/src/config.ts`
- Modify: `apps/platform-api/src/app.ts`
- Modify: `apps/platform-api/src/routes/register.ts`
- Modify: `apps/platform-api/src/routes/email-verification.ts`
- Create: `apps/platform-api/src/routes/email-verification-resend.ts`
- Modify: `apps/platform-api/src/routes/session.ts`
- Modify: `apps/platform-api/src/routes/password.ts`
- Modify: `apps/platform-api/src/routes/invitations.ts`
- Modify: `apps/platform-api/src/routes/deletion.ts`
- Modify: `apps/platform-api/src/error-mapper.ts`
- Modify: `apps/platform-api/test/integration/register-flow.test.ts`
- Modify: `apps/platform-api/test/integration/email-verification-flow.test.ts`
- Create: `apps/platform-api/test/integration/email-verification-resend-flow.test.ts`
- Modify: `apps/platform-api/test/integration/password-flow.test.ts`
- Modify: `apps/platform-api/test/integration/invitations-flow.test.ts`
- Modify: `apps/platform-api/test/integration/deletion-flow.test.ts`
- Modify: `apps/platform-api/test/unit-pieces.test.ts`

- [ ] **Step 1: Add failing Fastify + PostgreSQL + Redis tests**

Test these externally visible cases:

- registration commits one two-hour verification intent and one `email.verification` Outbox row whose payload includes `intentExpiresAt`; response has queued status and `resendAvailableAt = serverTime + 60s`;
- Session returns `emailMasked` generated by the server;
- resend requires Session and CSRF, rejects a body containing `email`, and derives the target from Session;
- accepted resend invalidates prior unused verification intents, supersedes unsent old verification Outbox rows, inserts one new intent and `.resend` row atomically, and returns queued state;
- the same idempotency key replays the same response without another intent/row;
- different concurrent keys serialize on the account row, so only one passes the cooldown;
- cooldown returns `429 rate_limited`, numeric problem `retryAfter`, HTTP `Retry-After`, and `resendAvailableAt`;
- the sixth accepted resend inside a rolling day is rejected, while the first registration email is excluded from the five-resend count;
- a verified or deletion-state account returns `409 state_machine_conflict` without sending;
- confirm-before-resend prevents resend; resend-before-confirm makes the old token fail and the latest token succeed;
- successful confirmation changes `pending_verification` to `active`.

- [ ] **Step 2: Run the focused API suite and confirm the red state**

```powershell
$env:AURORA_TEST_DATABASE_URL='postgresql://aurora:aurora_ci_test_pw@localhost:5432/aurora_inbox_test'
$env:AURORA_TEST_REDIS_URL='redis://localhost:6379'
pnpm --filter @aurora/platform-api exec vitest run test/integration/register-flow.test.ts test/integration/email-verification-flow.test.ts test/integration/email-verification-resend-flow.test.ts test/integration/password-flow.test.ts test/integration/invitations-flow.test.ts test/integration/deletion-flow.test.ts --no-file-parallelism
```

Expected: route/fields are absent and current confirmation does not provide the required account-lock ordering or activation transition.

- [ ] **Step 3: Add typed configuration**

Extend `PlatformApiConfig` and its parser with exact defaults:

```ts
emailResendCooldownMs: 60_000
emailResendRollingWindowMs: 86_400_000
emailResendMaxPerWindow: 5
```

Expose optional environment overrides `EMAIL_RESEND_COOLDOWN_MS`, `EMAIL_RESEND_WINDOW_MS`, and `EMAIL_RESEND_MAX_PER_WINDOW`; validate them as positive safe integers.

- [ ] **Step 4: Complete registration and confirmation semantics**

Registration computes one `now`, sets `expiresAt = now + 2h`, writes `intentExpiresAt: expiresAt.toISOString()` in the payload, and returns queued/cooldown timestamps from that same clock value. Confirmation obtains the account row `FOR UPDATE` before consuming the intent and uses the repository activation update in the same transaction.

Add `intentExpiresAt` to newly produced password-reset, organization-invitation, and deletion-confirmation Outbox payloads as well, so the strengthened consumer does not send any new transactional intent after expiry. Keep the consumer backward-compatible with already persisted legacy rows that do not have this field.

- [ ] **Step 5: Implement the resend handler**

Structure the transaction in this order:

```ts
await runIdempotentCommand(client, command, async () => {
  const account = await getAccountByIdForUpdate(client, session.accountId);
  assertResendEligible(account);
  const state = await getEmailVerificationResendState(client, limits);
  assertCooldownAndRollingQuota(state, now);
  await supersedeEmailVerificationIntents(client, { accountId, now });
  await supersedePendingEmailVerificationOutbox(client, { accountId, now });
  const token = createIntentToken();
  await insertIntent(client, digestOnly(token), expiresAt);
  await insertOutboxRow(client, verificationPayload(token, expiresAt));
  return queuedResponse;
});
```

Use the registry’s existing Session, CSRF, idempotency, and outer rate-limit middleware. The handler must never accept or log a recipient supplied by the browser.

Extend `ProblemExtras`/`AuroraProblem` with optional `resendAvailableAt`, sourced from the same server clock. Set `Retry-After` to the rounded-up remaining seconds before sending the problem body.

- [ ] **Step 6: Run API verification**

```powershell
pnpm --filter @aurora/platform-api test
pnpm --filter @aurora/platform-api test:integration
pnpm --filter @aurora/platform-api typecheck
pnpm --filter @aurora/platform-api build
```

Expected: unit/integration/type/build gates pass with real PostgreSQL and Redis.

- [ ] **Step 7: Commit the API increment**

```powershell
git add apps/platform-api
git commit -m "feat(api): add safe email verification resend flow"
```

---

## Task 4: Render Safe Transactional Templates and Map Aliyun DirectMail

**Files:**

- Modify: `packages/platform-email/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `packages/platform-email/src/email-delivery-port.ts`
- Modify: `packages/platform-email/src/console-email-adapter.ts`
- Create: `packages/platform-email/src/email-template.ts`
- Create: `packages/platform-email/src/aliyun-direct-mail-adapter.ts`
- Create: `packages/platform-email/src/aliyun-direct-mail-client.ts`
- Modify: `packages/platform-email/src/index.ts`
- Modify: `packages/platform-email/test/email-delivery-port.test.ts`
- Create: `packages/platform-email/test/email-template.test.ts`
- Create: `packages/platform-email/test/aliyun-direct-mail-adapter.test.ts`
- Modify: `packages/platform-email/test/package-entry.test.ts`

- [ ] **Step 1: Change the port tests to the provider-neutral result model**

Use this result union:

```ts
export type EmailDeliveryResult =
  | { readonly status: 'accepted'; readonly providerRequestId?: string }
  | {
      readonly status: 'failed';
      readonly retryable: boolean;
      readonly reasonCode: string;
    };
```

The console adapter returns `accepted` only in explicit console mode and logs only intent type plus masked recipient. An unconfigured adapter returns a permanent stable `EMAIL_PROVIDER_NOT_CONFIGURED` result.

- [ ] **Step 2: Add failing template and DirectMail adapter tests**

Cover all four existing intent types (`email_verification`, `password_reset`, `organization_invitation`, `deletion_confirmation`), UTF-8 HTML and plain text, correct expiry wording, HTML escaping of links/text, no images/tracking/attachments, and no raw message content in returned errors.

Inject this SDK-independent client boundary:

```ts
export interface DirectMailSingleSendRequest {
  readonly accountName: string;
  readonly addressType: 1;
  readonly replyToAddress: false;
  readonly toAddress: string;
  readonly subject: string;
  readonly htmlBody: string;
  readonly textBody: string;
  readonly fromAlias: string;
}

export interface DirectMailClientPort {
  singleSendMail(
    request: DirectMailSingleSendRequest,
    timeoutMs: number,
  ): Promise<{ readonly requestId?: string }>;
}
```

Assert classification: timeout/network/429/5xx are retryable; invalid address, sender validation, authentication/signature, permissions, and malformed request are permanent.

- [ ] **Step 3: Run focused tests and confirm the red state**

```powershell
pnpm --filter @aurora/platform-email exec vitest run test/email-delivery-port.test.ts test/email-template.test.ts test/aliyun-direct-mail-adapter.test.ts test/package-entry.test.ts
```

Expected: missing templates/client/adapter and old `enqueued` result assertions fail.

- [ ] **Step 4: Install pinned official SDK dependencies**

```powershell
pnpm --filter @aurora/platform-email add @alicloud/dm20151123@1.10.2 @alicloud/credentials@2.4.5
```

Do not add `@alicloud/openapi-client` unless the actual generated SDK public types require a direct import. Keep the lockfile frozen after this step.

- [ ] **Step 5: Implement templates and adapter mapping**

`renderTransactionalEmail()` returns `{ subject, htmlBody, textBody }` and escapes every interpolated value. The verification subject is `验证你的 Aurora 邮箱`; the body states the two-hour validity, contains one primary link and one copyable fallback, and explains how to ignore an unsolicited message.

The Aliyun request maps to `SingleSendMail` with `AddressType=1`, `ReplyToAddress=false`, configured account name/from alias, and one recipient. Normalize SDK failures into stable codes without exposing the SDK response body.

- [ ] **Step 6: Implement the official SDK wrapper**

Create the SDK client from the Alibaba Cloud default credential chain. Accept typed `regionId` and optional `endpoint`; do not read or expose credential values in the domain adapter. Apply the configured request timeout through the SDK runtime options.

- [ ] **Step 7: Verify the email package**

```powershell
pnpm --filter @aurora/platform-email test
pnpm --filter @aurora/platform-email typecheck
pnpm --filter @aurora/platform-email build
pnpm --filter @aurora/platform-email test:package
```

Expected: templates, adapter mapping, types, package exports, and build all pass without a network call.

- [ ] **Step 8: Commit the provider adapter**

```powershell
git add packages/platform-email/package.json packages/platform-email/src packages/platform-email/test pnpm-lock.yaml
git commit -m "feat(email): add Aliyun DirectMail delivery adapter"
```

---

## Task 5: Make Email Outbox Consumption Retryable, Recoverable, and Token-Safe

**Files:**

- Create: `packages/platform-email/src/retry-policy.ts`
- Modify: `packages/platform-email/src/outbox-consumer.ts`
- Modify: `packages/platform-email/src/index.ts`
- Create: `packages/platform-email/test/retry-policy.test.ts`
- Modify: `packages/platform-email/test/outbox-consumer.test.ts`
- Modify: `packages/platform-email/test/integration/outbox-flow.test.ts`

- [ ] **Step 1: Add failing pure retry-policy tests**

Implement deterministic tests around an injected entropy value for capped exponential backoff with jitter. The result must be finite, nonnegative, no greater than 300 seconds, and monotonically bounded as attempts grow.

Use an explicit API:

```ts
calculateEmailRetryDelay({
  attempt,
  baseDelayMs,
  maxDelayMs,
  entropy01,
}): number
```

- [ ] **Step 2: Add failing consumer tests**

Cover:

- accepted delivery settles succeeded and scrubs payload;
- retryable failure below budget settles failed with a future `availableAt` and retains payload;
- retryable failure at attempt five dead-letters and scrubs;
- permanent failure dead-letters immediately and scrubs;
- malformed or expired payload dead-letters without calling the provider;
- failed rows are re-claimed when available;
- a stale processing row is re-claimed with a new claim ID;
- stale-claim settlement is ignored and counted as neither a newly consumed nor newly failed row;
- provider request ID and stable reason code persist without the raw provider error;
- optional `intentExpiresAt` remains backward-compatible for pre-migration non-verification rows, while every new verification row has it.

- [ ] **Step 3: Run focused tests and confirm the red state**

```powershell
pnpm --filter @aurora/platform-email exec vitest run test/retry-policy.test.ts test/outbox-consumer.test.ts
$env:AURORA_TEST_DATABASE_URL='postgresql://aurora:aurora_ci_test_pw@localhost:5432/aurora_inbox_test'
pnpm --filter @aurora/platform-email test:integration
```

Expected: old consumer cannot pass claim fencing, scheduling, expiry, or scrub assertions.

- [ ] **Step 4: Implement the consumer state machine**

Extend the consumer input with `processingTimeoutMs`, `retryBaseDelayMs`, `retryMaxDelayMs`, and an injected entropy provider. Pass `processingTimeoutMs` to claim. For each row:

1. parse bounded runtime fields;
2. reject expired/malformed rows before delivery;
3. call the port once;
4. settle using `row.claimId`;
5. preserve payload only for a scheduled retry;
6. scrub it for every terminal result.

Treat a synchronous throw from the provider boundary as a retryable stable `EMAIL_PROVIDER_UNAVAILABLE` failure without serializing the exception.

- [ ] **Step 5: Verify package and database behavior**

```powershell
pnpm --filter @aurora/platform-email test
pnpm --filter @aurora/platform-email test:integration
pnpm --filter @aurora/platform-email typecheck
pnpm --filter @aurora/platform-email build
```

Expected: unit and real PostgreSQL integration tests pass, including retry reclaim and terminal scrub.

- [ ] **Step 6: Commit the reliability increment**

```powershell
git add packages/platform-email
git commit -m "fix(email): recover and scrub transactional outbox delivery"
```

---

## Task 6: Compose Aliyun in `platform-worker`

**Files:**

- Modify: `apps/platform-worker/src/config.ts`
- Modify: `apps/platform-worker/src/index.ts`
- Modify: `apps/platform-worker/src/start.ts`
- Modify: `apps/platform-worker/src/worker.ts`
- Modify: `apps/platform-worker/test/config.test.ts`
- Modify: `apps/platform-worker/test/worker.test.ts`
- Modify: `apps/platform-worker/test/integration/outbox-worker.test.ts`

- [ ] **Step 1: Add failing configuration and composition tests**

Test that:

- only `console` and `aliyun` are accepted delivery modes;
- Aliyun mode requires a valid account name and uses `Aurora`, `cn-hangzhou`, 10 seconds, and five minutes as defaults;
- endpoint is optional and validated as a nonempty string when present;
- credentials are not members of `PlatformWorkerConfig`;
- console mode never creates an Aliyun client;
- aliyun mode injects the adapter and retry/lease settings into the consumer;
- invalid retry/timeout relationships fail startup (provider timeout must be shorter than the processing timeout).

- [ ] **Step 2: Run focused worker tests and confirm the red state**

```powershell
pnpm --filter @aurora/platform-worker exec vitest run test/config.test.ts test/worker.test.ts
```

Expected: parser/composition lacks Aliyun and the new reliability settings.

- [ ] **Step 3: Implement typed composition**

Support these environment names:

```text
EMAIL_DELIVERY_MODE
ALIYUN_DIRECT_MAIL_ACCOUNT_NAME
ALIYUN_DIRECT_MAIL_FROM_ALIAS
ALIYUN_DIRECT_MAIL_REGION_ID
ALIYUN_DIRECT_MAIL_ENDPOINT
EMAIL_PROVIDER_TIMEOUT_MS
EMAIL_OUTBOX_PROCESSING_TIMEOUT_MS
EMAIL_OUTBOX_RETRY_BASE_DELAY_MS
EMAIL_OUTBOX_RETRY_MAX_DELAY_MS
```

Build the email port once at startup. Let the official credentials package resolve ECS RAM role/default-chain credentials, including `ALIBABA_CLOUD_ACCESS_KEY_ID` and `ALIBABA_CLOUD_ACCESS_KEY_SECRET` only when the deployment uses a protected RAM user secret.

- [ ] **Step 4: Add real-PostgreSQL worker transition tests**

With an injected fake delivery port, verify accepted, retry, dead-letter, processing recovery, and scrub from the actual worker round. Do not contact Aliyun.

- [ ] **Step 5: Run worker verification**

```powershell
$env:AURORA_TEST_DATABASE_URL='postgresql://aurora:aurora_ci_test_pw@localhost:5432/aurora_inbox_test'
pnpm --filter @aurora/platform-worker test
pnpm --filter @aurora/platform-worker test:integration
pnpm --filter @aurora/platform-worker typecheck
pnpm --filter @aurora/platform-worker build
```

Expected: configuration, composition, polling behavior, and integration tests pass.

- [ ] **Step 6: Commit worker composition**

```powershell
git add apps/platform-worker
git commit -m "feat(worker): compose Aliyun transactional email delivery"
```

---

## Task 7: Restore the Verification Page from Session and Send Real Resend Commands

**Files:**

- Modify: `apps/console/src/stores/session.ts`
- Modify: `apps/console/src/views/auth/VerifyEmailView.vue`
- Create: `apps/console/src/views/auth/email-verification-view-model.ts`
- Modify: `apps/console/src/mocks/handlers.ts`
- Modify: `apps/console/test/stores/session.test.ts`
- Modify: `apps/console/test/views/auth.test.ts`
- Create: `apps/console/test/views/auth/email-verification-view-model.test.ts`
- Modify: `apps/console/test/msw/handlers.test.ts`
- Modify: `apps/console/test-browser/auth-flow.spec.ts`
- Modify: `apps/console/test-browser/axe.spec.ts`
- Modify: `apps/console/test-browser/focus.spec.ts`

- [ ] **Step 1: Add failing Session restoration and view-model tests**

Add `session.restore({ force: true })` behavior so the verify page can refresh authoritative account state even when Pinia currently says authenticated. Test server-time offset and countdown as pure functions:

```ts
deriveResendState({ serverTime, resendAvailableAt, clientNow }):
  | { kind: 'ready' }
  | { kind: 'cooldown'; remainingSeconds: number };
```

Round up remaining seconds; never allow a negative display.

- [ ] **Step 2: Add failing component tests for every required state**

Using Testing Library and MSW, cover loading, pending ready, queued/cooldown, rolling limit, verified, expired Session/login, provider unavailable/retry, keyboard activation, and disabled resend during an in-flight request. Prove refresh and a historical account work without `auth.registration` data. Prove the UI never renders an editable email input.

- [ ] **Step 3: Run focused Console tests and confirm the red state**

```powershell
pnpm --filter @aurora/console exec vitest run test/stores/session.test.ts test/views/auth.test.ts test/views/auth/email-verification-view-model.test.ts test/msw/handlers.test.ts
```

Expected: force restore, resend operation, and required visual states are missing.

- [ ] **Step 4: Implement the page without changing the approved visual language**

On mount, call `session.restore({ force: true })`. Use Session `account.verified` and `account.emailMasked` as authority; registration response may only accelerate the first paint. Send:

```ts
platformRequest(OPERATION_ID_RESEND_EMAIL_VERIFICATION, {
  body: { idempotencyKey: createIdempotencyKey() },
  csrf: session.csrf,
});
```

Use one timer derived from absolute server timestamps, clear it on unmount, and refresh Session when the API says the account is already verified. Keep the restricted-workspace link. Map 401/409/429/503 through the shared API error layer and move focus to the status summary after an action result.

- [ ] **Step 5: Verify unit, build, and browser accessibility**

```powershell
pnpm --filter @aurora/console test
pnpm --filter @aurora/console typecheck
pnpm --filter @aurora/console test:package
pnpm --filter @aurora/console test:browser
```

Expected: unit tests, production build, Playwright flow, responsive layout, and axe checks pass.

- [ ] **Step 6: Commit the Console flow**

```powershell
git add apps/console
git commit -m "feat(console): enable session-backed email verification resend"
```

---

## Task 8: Add Deployment Configuration and Operator Documentation

**Files:**

- Modify: `deploy/preview/compose.yaml`
- Modify: `deploy/preview/.env.example`
- Modify: `deploy/preview/README.md`
- Modify: `packages/platform-email/README.md`
- Modify: `packages/platform-identity/README.md`
- Modify: `apps/platform-api/README.md`
- Modify: `apps/platform-worker/README.md`
- Modify: `apps/console/README.md`
- Create: `docs/operations/aliyun-direct-mail-email-verification.md`
- Modify: `docs/README.md`

- [ ] **Step 1: Add failing documentation/config contract assertions where existing suites support them**

Extend the email/worker documentation tests to require: delivery modes, no-secret rule, exact environment names, retry/lease semantics, meaning of queued/accepted, and manual DirectMail setup. Add a compose config check that public environments do not silently default to a fake successful console delivery.

- [ ] **Step 2: Run focused docs/config tests and confirm the red state**

```powershell
pnpm --filter @aurora/platform-email test
pnpm --filter @aurora/platform-worker test
docker compose --env-file deploy/preview/.env.example -f deploy/preview/compose.yaml config --quiet
```

Expected: documentation assertions/config references are missing before implementation. If Docker is unavailable, record that specific local tooling blocker and still validate YAML through repository lint/type gates.

- [ ] **Step 3: Wire non-secret deployment settings**

Pass the Task 6 environment variables only to `platform-worker`. Document optional protected fallback variables without values:

```text
ALIBABA_CLOUD_ACCESS_KEY_ID=
ALIBABA_CLOUD_ACCESS_KEY_SECRET=
```

Prefer ECS RAM role/default credentials. Do not expose these variables to the Console image or client bundle. In public Preview/production, require an explicit `EMAIL_DELIVERY_MODE`; retain `console` only for local controlled development and label it non-delivering.

- [ ] **Step 4: Write the operator runbook**

Document the user-owned Alibaba Cloud steps: enable DirectMail, add `notifications.aurora.ah.cn`, apply the exact DNS records shown by the Alibaba console, create/approve `support@notifications.aurora.ah.cn`, assign least-privilege RAM role/secret, configure cost alerts, deploy, then perform two controlled smoke cases. Include rollback: stop worker before rolling back code that cannot interpret new outbox states; never roll back verified accounts or consumed intents.

- [ ] **Step 5: Verify docs and deployment config**

```powershell
pnpm prettier --check deploy/preview packages/platform-email/README.md packages/platform-identity/README.md apps/platform-api/README.md apps/platform-worker/README.md apps/console/README.md docs/operations/aliyun-direct-mail-email-verification.md docs/README.md
pnpm --filter @aurora/platform-email test
pnpm --filter @aurora/platform-worker test
```

Expected: docs/config contracts and formatting pass; no secret value appears in tracked files.

- [ ] **Step 6: Commit deployment and runbook changes**

```powershell
git add deploy/preview packages/platform-email/README.md packages/platform-identity/README.md apps/platform-api/README.md apps/platform-worker/README.md apps/console/README.md docs/operations/aliyun-direct-mail-email-verification.md docs/README.md
git commit -m "docs(ops): add Aliyun email delivery runbook"
```

---

## Task 9: Run the Complete Gates, Audit Secrets, and Record Honest Status

**Files:**

- Modify: `docs/superpowers/specs/2026-08-14-email-verification-delivery-and-resend-design.md`
- Modify: `docs/adr/ADR-031-platform-email-delivery.md`
- Modify: `AGENTS.md`
- Modify: `AURORA_RULES.md` only if the existing concise status snapshot can be replaced without increasing its known size debt
- Modify: `docs/architecture/formalization-readiness.md` if it tracks this implementation dependency
- Modify: `docs/testing/evidence/2026-08-14-email-verification-delivery-and-resend.md`

- [ ] **Step 1: Run focused package gates from a clean build graph**

```powershell
pnpm install --frozen-lockfile
pnpm --filter @aurora/platform-contract build
pnpm --filter @aurora/platform-identity build
pnpm --filter @aurora/platform-email build
pnpm --filter @aurora/platform-api build
pnpm --filter @aurora/platform-worker build
pnpm --filter @aurora/console test:package
```

- [ ] **Step 2: Run all real service integration suites**

```powershell
$env:AURORA_TEST_DATABASE_URL='postgresql://aurora:aurora_ci_test_pw@localhost:5432/aurora_inbox_test'
$env:AURORA_TEST_REDIS_URL='redis://localhost:6379'
pnpm --filter @aurora/platform-identity test:integration
pnpm --filter @aurora/platform-email test:integration
pnpm --filter @aurora/platform-api test:integration
pnpm --filter @aurora/platform-worker test:integration
```

Use isolated/reset test databases between suites if the local harness does not provide per-suite PostgreSQL isolation, matching CI behavior.

- [ ] **Step 3: Run repository-wide quality gates**

```powershell
pnpm platform-contract:drift
pnpm openapi:check
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm check:boundaries
pnpm build
pnpm --filter @aurora/platform-contract test:package
pnpm --filter @aurora/console test:browser
```

Fix every regression in scope. Do not dismiss existing unrelated failures; capture exact evidence and distinguish them from feature failures.

- [ ] **Step 4: Audit tracked changes for secret/token leakage**

Run read-only scans over tracked diffs:

```powershell
git diff --check
git diff --cached --check
git grep -n -E 'ALIBABA_CLOUD_ACCESS_KEY_(ID|SECRET)=[^[:space:]]+|LTAI[A-Za-z0-9]+' -- . ':(exclude)pnpm-lock.yaml'
git status --short
```

Expected: no credential values or AccessKey-like literals; only empty variable names/documentation may exist. Inspect every Outbox assertion to ensure terminal payloads do not retain raw links.

- [ ] **Step 5: Record implementation evidence without overstating deployment**

Create a dated evidence file listing commit, commands, results, PostgreSQL/Redis versions, browser checks, and any unavailable local tool. Update the approved design and ADR status to `implemented-in-feature-branch / deployment-blocked` until Alibaba Cloud domain/sender/RAM and public smoke tests are complete. Update `AGENTS.md` and readiness tracking with one concise snapshot. Do not claim real delivery complete yet.

- [ ] **Step 6: Request code review and apply technically verified findings**

Invoke `superpowers:requesting-code-review`. Review contract compatibility, transaction order, row-lock races, retry budget, claim fencing, payload scrub, log redaction, Vue timer cleanup, deployment safety, and tests. Apply findings using `superpowers:receiving-code-review` and rerun the affected gates.

- [ ] **Step 7: Commit verified status evidence**

```powershell
git add docs/superpowers/specs/2026-08-14-email-verification-delivery-and-resend-design.md docs/adr/ADR-031-platform-email-delivery.md AGENTS.md docs/architecture/formalization-readiness.md docs/testing/evidence/2026-08-14-email-verification-delivery-and-resend.md
git add AURORA_RULES.md
git commit -m "docs(identity): record email verification implementation evidence"
```

Omit `AURORA_RULES.md` from `git add` when no concise replacement was necessary.

- [ ] **Step 8: Perform the user-owned protected deployment checkpoint**

After the user completes the runbook in Alibaba Cloud, deploy with `EMAIL_DELIVERY_MODE=aliyun` and run exactly two controlled public cases:

1. new registration receives the verification message and becomes active;
2. historical unverified account resends, receives the latest message, old link fails, latest link activates the account.

Also verify the restricted workspace remains available before verification, the normal workspace is available afterward, terminal Outbox payloads are scrubbed, and logs contain neither full addresses nor tokens. Only after this checkpoint may status change from `deployment-blocked` to deployed/complete.

**2026-08-15 completion record:** Public Preview release `20260815-132409` (commit `d6700af`) was deployed. The user confirmed receipt of a real DirectMail message and explicitly accepted the increment as complete. The previously listed cost/sending alert setup was explicitly cancelled for the current low-usage application and is no longer a completion gate. Full mailbox addresses, tokens, message bodies, credentials, and provider raw responses are intentionally absent from the evidence.

---

## Final Definition of Done

- New registration, historical resend, confirmation, and account activation work through the public contract and UI.
- Cooldown, rolling quota, idempotency, latest-link-only semantics, and confirm/resend races are proven with real PostgreSQL/Redis tests.
- Failed and stale-processing Outbox rows recover with bounded retries and fenced claims; expired/terminal/superseded rows cannot leak tokens.
- Aliyun DirectMail mapping uses the official SDK/default credential chain and all four identity email templates pass unit tests.
- Console refresh/history scenarios pass Vitest, Playwright, and axe checks.
- Machine OpenAPI, manifest, package exports, boundaries, lint, typecheck, tests, coverage, and builds are green.
- No secret/token appears in Git, logs, front-end code, or evidence.
- Deployment status remains honest until Alibaba Cloud console configuration and the two protected real-mail smoke tests pass.
