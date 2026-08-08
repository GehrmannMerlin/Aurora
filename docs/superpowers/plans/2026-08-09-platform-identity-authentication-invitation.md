# PLT-03 Identity Authentication and Invitation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Aurora platform identity/authentication/invitation (register+verify, login/logout, forgot/reset password, accept invitation, change password) on real PostgreSQL 17 + Redis, with EmailDeliveryPort + Outbox, 8 operations unblocked in Platform Contract, real Console pages, and full security/quality gates — closing leaf PLT-03 (40/38 → 41/37).

**Architecture:** `apps/platform-api` (Fastify) is the only HTTP entry; `packages/platform-identity` (data) holds account/password/intent/invitation/audit/idempotency/outbox migrations+repositories; `packages/platform-session` (data) owns Redis-authoritative sessions; `packages/platform-email` (data) defines `EmailDeliveryPort` + Outbox consumer used by `apps/platform-worker`. Console consumes generated client. Contract ops move from `BLOCKED_OPERATIONS` to `PLATFORM_OPERATIONS` via real schema modules.

**Tech Stack:** TypeScript 6.0.3 (strict), Node 24.18, Fastify (per ADR-026; exact version locked in Task 1), PostgreSQL 17 + node-pg-migrate 9 + SQL-first (ADR-029), Redis 7 (Session, ADR-030), Argon2id (via `argon2`), `pg` 8.22, Vue 3 + generated client (Console), Vitest/Playwright/axe.

## 固定回读与权威边界 (Module ID: PLT-03)

- **权威来源**：`docs/superpowers/specs/2026-08-09-platform-identity-authentication-invitation.md`（本规格）；accepted ADR-028/029/030/031/032；G10 APPROVAL PACKAGE approved product rules；PRD §4.1-4.3/§13；UX §7.2-7.6/§8.1-8.5/§9.1-9.5/§10.2.1/§11.1-11.4；backend design §4/§5/§6 A1-A5/§7/§8。
- **不变量（任何 Task 不得违反）**：
  1. 密码/一次性 token/Session ID/CSRF secret **绝不**进入日志、URL、前端 Store、MSW fixture、Playwright trace；
  2. 公开结果（register/login/request-reset/confirm）**绝不**泄漏账号存在性（防枚举）；
  3. Session 权威在 Redis（仅存 Session ID 的 SHA-256 摘要），Redis down → 受保护操作 503 失败关闭，不伪装 401；
  4. 邮件 Outbox = 送达非承诺；`enqueued` ≠ 收件箱到达；不建无 consumer 基础设施（YAGNI）；
  5. 密码重置/修改密码 → 撤销该账号**全部** Session；登录 → 旋转 Session ID；退出 → 撤销当前 Session；
  6. 意图确认（验证/重置/邀请）用短期 HttpOnly intent cookie + CSRF header，请求体**不含**原始 token；
  7. 邀请接受**原子**创建成员+项目权限，任一步失败无部分成功；账号邮箱规范匹配才显示邀请详情；
  8. 不实现 PLT-04（B1-B8）/SEC-01（A5 删除）/G11-G13 能力；`identityDeleteAccountPreflight`/`identityDeleteAccount` 保持 blocked。
- **Module ID**：PLT-03（G10 leaf 1；目标 40/38 → 41/37）。

## Global Constraints

- Node `>=24.18.0 <25`；pnpm 11.17.0；TypeScript strict。
- 所有新包 `aurora.layer` 正确：`platform-identity`/`platform-session`/`platform-email` = `data`；`platform-api`/`platform-worker` = `service`。console 层禁止依赖 data/service 内部包。
- 严格单向依赖：`console → contract`；`service → contract + data`；`data → contract（仅类型/常量）`。`pnpm check:boundaries` 强制执行。
- 所有 persisted/external input 从 `@aurora/platform-contract` 的 Zod SchemaDef 运行时校验进入；禁止裸类型断言。
- 错误用 RFC 9457 `auroraProblem`（code/title/status/detail/requestId/fieldErrors/retryAfter）；禁止栈/SQL/队列名/对象键/token/枚举信息。
- Integration tests 用真实 PostgreSQL 17 + Redis（本地容器见 memory `aurora-local-test-infra`）；禁止 mock 冒充。
- `AURORA_TEST_DATABASE_URL` 必须指向 `/aurora_inbox_test` 路径（`assertIsTestDatabase` 强制）；Redis 测试 URL `redis://localhost:16379`。
- `pnpm platform-contract:generate` 后必须通过 `platform-contract:drift`；manifest test 的 stable 列表必须更新。
- 版本精确锁定（不浮 `latest`）；lockfile 更新用 `pnpm install --no-frozen-lockfile`（本地）且 CI 用 `--frozen-lockfile`。

---

## File Structure

**Contract layer (`packages/platform-contract`):**
- Create: `src/identity/register.ts`, `src/identity/login.ts`, `src/identity/password.ts`, `src/identity/email-verification.ts`, `src/identity/invitation.ts` — schema modules.
- Modify: `src/registry/operations.ts` (unblock 8 ops), `src/index.ts` (re-export), `test/registry/manifest.test.ts` (stable list), `test/contract-testkit/samples.ts` (samples for new ops).

**Data layer (new packages, mirror `@aurora/ingestion-credentials`):**
- `packages/platform-identity`: `package.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`, `src/index.ts`, `src/run-migrations.ts`, `migrations/*.ts` (11 tables), `src/repositories/*.ts`, `src/password.ts` (Argon2id wrapper), `src/intent-token.ts` (SHA-256 digest), `test/*.test.ts`, `test/integration/*.test.ts`.
- `packages/platform-session`: `package.json`, tsconfigs, vitest.config.ts, `src/index.ts`, `src/session-store.ts` (Redis), `src/csrf.ts`, `src/cookie.ts`, `test/*.test.ts`, `test/integration/*.test.ts`.
- `packages/platform-email`: `package.json`, tsconfigs, vitest.config.ts, `src/index.ts`, `src/email-delivery-port.ts`, `src/outbox-consumer.ts`, `test/*.test.ts`, `test/integration/*.test.ts`.

**Service layer (new apps, mirror `apps/ingestion-api`):**
- `apps/platform-api`: `package.json`, tsconfigs, vitest.config.ts, `src/index.ts` (build), `src/server.ts` (start), `src/plugins/*.ts` (cookie/session/csrf/origin), `src/routes/*.ts` (8 operation handlers), `src/config.ts`, `test/*.test.ts`, `test/integration/*.test.ts`.
- `apps/platform-worker`: `package.json`, tsconfigs, vitest.config.ts, `src/index.ts`, `src/run.ts`, `test/*.test.ts`.

**Console (`apps/console`):**
- Modify: `src/contracts/route-registry.ts` (real views for auth/account routes), `src/router/index.ts` (guards), `src/api/client.ts` (no change needed — generated ops auto-flow), `src/styles/*`.
- Create: `src/views/auth/RegisterView.vue`, `VerifyEmailView.vue`, `VerifyEmailConfirmView.vue`, `LoginView.vue`, `ForgotPasswordView.vue`, `ResetPasswordView.vue`, `InvitationAcceptView.vue`, `src/views/account/AccountSecurityView.vue`, `src/components/auth/*.vue` (form fields, status), `test/**` and `test-browser/**` updates.

---

### Task 1: Contract — unblock 8 operations with real schema modules

**Files:**
- Create: `packages/platform-contract/src/identity/register.ts`
- Create: `packages/platform-contract/src/identity/login.ts`
- Create: `packages/platform-contract/src/identity/password.ts`
- Create: `packages/platform-contract/src/identity/email-verification.ts`
- Create: `packages/platform-contract/src/identity/invitation.ts`
- Modify: `packages/platform-contract/src/registry/operations.ts`
- Modify: `packages/platform-contract/src/index.ts`
- Test: `packages/platform-contract/test/identity/register.test.ts` (create), `test/identity/login.test.ts` (create), `test/identity/password.test.ts` (create), `test/identity/email-verification.test.ts` (create), `test/identity/invitation.test.ts` (create)

**Interfaces:**
- Consumes: `SchemaDef` builders from `src/common/schema.js` (`str`, `num`, `bool`, `enum_`, `obj`, `arr`, `nullable`, `optional`, `brandedId`); `OperationDef`/`AuthLevel` from `src/registry/operations.js`; `commandResult`, `idempotencyKey` from `src/common/command.js`; `utcTimestamp` from `src/common/time.js`; `RouteTargetId` from `src/common/navigation.js`; `auroraProblem` from `src/common/problem-details.js`.
- Produces: `OPERATION_ID_REGISTER = 'identityRegister'`, `identityRegisterRequest`, `identityRegisterResponse`, `OPERATION_ID_LOGIN`/`identityLoginRequest`/`identityLoginResponse`, `OPERATION_ID_LOGOUT`, `OPERATION_ID_REQUEST_PASSWORD_RESET`/`identityRequestPasswordResetRequest`/`identityRequestPasswordResetResponse`, `OPERATION_ID_CONFIRM_PASSWORD_RESET`/`identityConfirmPasswordResetRequest`/`identityConfirmPasswordResetResponse`, `OPERATION_ID_CHANGE_PASSWORD`/`identityChangePasswordRequest`/`identityChangePasswordResponse`, `OPERATION_ID_CONFIRM_EMAIL_VERIFICATION`/`identityConfirmEmailVerificationRequest`/`identityConfirmEmailVerificationResponse`, `OPERATION_ID_ACCEPT_INVITATION`/`organizationAcceptInvitationRequest`/`organizationAcceptInvitationResponse` — all `SchemaDef`.

- [ ] **Step 1: Write the failing schema tests**

`test/identity/register.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import {
  OPERATION_ID_REGISTER,
  identityRegisterRequest,
  identityRegisterResponse,
} from '../../src/identity/register.js';

describe('identityRegister contract', () => {
  it('has the frozen operation id', () => {
    expect(OPERATION_ID_REGISTER).toBe('identityRegister');
  });
  it('accepts a valid register request', () => {
    const result = identityRegisterRequest.zod.safeParse({
      email: '  User@Example.COM ',
      password: 's3cure-Passw0rd!',
      idempotencyKey: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b',
    });
    expect(result.success).toBe(true);
  });
  it('rejects missing email', () => {
    const result = identityRegisterRequest.zod.safeParse({ password: 'x'.repeat(12), idempotencyKey: 'k'.repeat(36) });
    expect(result.success).toBe(false);
  });
  it('rejects an undeclared field (closed object)', () => {
    const result = identityRegisterRequest.zod.safeParse({
      email: 'a@b.co', password: 'x'.repeat(12), idempotencyKey: 'k'.repeat(36), evil: true,
    });
    expect(result.success).toBe(false);
  });
});
```

`test/identity/login.test.ts`, `password.test.ts`, `email-verification.test.ts`, `invitation.test.ts` follow the same pattern for their own request/response shapes (assert: valid accepted; missing required field rejected; unknown field rejected; response closed with no passwordHash/sessionId/token keys).

- [ ] **Step 2: Run to verify failure**

```bash
cd packages/platform-contract
pnpm exec vitest run test/identity/register.test.ts test/identity/login.test.ts test/identity/password.test.ts test/identity/email-verification.test.ts test/identity/invitation.test.ts
```
Expected: FAIL — `Cannot find module '../../src/identity/register.js'`.

- [ ] **Step 3: Write the schema modules**

`src/identity/register.ts`:
```ts
import { obj, str } from '../common/schema.js';
import { idempotencyKey } from '../common/command.js';
import { utcTimestamp } from '../common/time.js';
import { AccountId } from '../common/identifiers.js';

export const OPERATION_ID_REGISTER = 'identityRegister' as const;

export const identityRegisterRequest = obj({
  email: str(3, 320),
  password: str(8, 256),
  idempotencyKey,
});

export const identityRegisterResponse = obj({
  accountId: AccountId,
  workspaceId: obj({ organizationId: AccountId }), // personal workspace org id is the same id type family
  emailMasked: str(3, 320),
  verificationStatus: obj({ verified: false, reason: str(1, 64) }),
  resendAvailableAt: obj({ value: utcTimestamp }),
  serverTime: utcTimestamp,
});
```
> Note: `workspaceId` here is the personal `organization_id` (a UUID). For contract precision, use `brandedId<'OrganizationId'>('organizationId')` alias in this module. The personal workspace is an `organizations` row with `kind='personal'`.

`src/identity/login.ts`:
```ts
import { obj, str, enum_ } from '../common/schema.js';
import { idempotencyKey } from '../common/command.js';
import { utcTimestamp } from '../common/time.js';
import { AccountId } from '../common/identifiers.js';
import { routeTarget } from '../common/navigation.js';

export const OPERATION_ID_LOGIN = 'identityLogin' as const;
export const OPERATION_ID_LOGOUT = 'identityLogout' as const;

export const identityLoginRequest = obj({
  email: str(3, 320),
  password: str(8, 256),
  idempotencyKey,
});

export const identityLoginResponse = obj({
  account: obj({ accountId: AccountId, email: str(3, 320), verified: false }),
  authentication: enum_(['pending_verification', 'authenticated', 'restricted']),
  session: obj({ expiresAt: utcTimestamp, rotationDueAt: obj({ value: utcTimestamp }) }),
  csrf: str(1, 256),
  navigation: obj({ navigationTargets: routeTarget }),
  continuation: obj({ target: routeTarget, kind: enum_(['invitation', 'return_to']) }),
});
```
> `obj({ value: utcTimestamp })` wraps the *optional* `rotationDueAt` (the base contract shape uses `optional(utcTimestamp)`); match the session.ts convention precisely (see `src/identity/session.ts` for the exact optional wrapper used).

`src/identity/password.ts`: exports `OPERATION_ID_REQUEST_PASSWORD_RESET`/`OPERATION_ID_CONFIRM_PASSWORD_RESET`/`OPERATION_ID_CHANGE_PASSWORD`; `identityRequestPasswordResetRequest = obj({ email, idempotencyKey })`; `identityRequestPasswordResetResponse = obj({ serverTime, nextRequestAllowedAt: obj({ value: utcTimestamp }) })` (uniform, no account-existence leak); `identityConfirmPasswordResetRequest = obj({ newPassword: str(8, 256), idempotencyKey })` (intent cookie carries token); `identityConfirmPasswordResetResponse = obj({ status: enum_(['succeeded']), serverTime })`; `identityChangePasswordRequest = obj({ currentPassword: str(8, 256), newPassword: str(8, 256), idempotencyKey })`; `identityChangePasswordResponse = obj({ status: enum_(['succeeded']), sessionImpact: enum_(['revoked_all']) })`.

`src/identity/email-verification.ts`: `OPERATION_ID_CONFIRM_EMAIL_VERIFICATION`; `identityConfirmEmailVerificationRequest = obj({ idempotencyKey })` (intent cookie + CSRF); `identityConfirmEmailVerificationResponse = obj({ verificationStatus: obj({ verified: true }), account: obj({ accountId: AccountId, email: str(3,320), verified: true }) })`.

`src/identity/invitation.ts`: `OPERATION_ID_ACCEPT_INVITATION`; `organizationAcceptInvitationRequest = obj({ idempotencyKey })` (intent cookie + CSRF); `organizationAcceptInvitationResponse = obj({ organization: obj({ organizationId: AccountId, name: str(1,128), role: enum_(['owner','admin','member']) }), navigationTargets: routeTarget })`.

- [ ] **Step 4: Run tests to verify pass**

Same command as Step 2. Expected: 5 test files PASS.

- [ ] **Step 5: Register the operations**

In `src/registry/operations.ts`:
- Remove from `BLOCKED_OPERATIONS`: `identityRegister`, `identityConfirmEmailVerification`, `identityLogin`, `identityLogout`, `identityRequestPasswordReset`, `identityConfirmPasswordReset`, `identityChangePassword`, `organizationAcceptInvitation`.
- Append to `PLATFORM_OPERATIONS` the 8 `OperationDef`s with the auth levels from spec §7.1 (register=public, login=public, logout=session, request-reset=public, confirm-reset=intent, confirm-email=intent, change-password=session, accept-invitation=session), each with `csrf`/`idempotency` flags, `page` RouteTargetId, `tags`, and `errorCodes` per spec §9.

- [ ] **Step 6: Re-export from index**

In `src/index.ts`, add:
```ts
export * from './identity/register.js';
export * from './identity/login.js';
export * from './identity/password.js';
export * from './identity/email-verification.js';
export * from './identity/invitation.js';
```

- [ ] **Step 7: Update manifest test stable list**

In `test/registry/manifest.test.ts`, update the frozen stable list to include the 8 new operation ids (keeping `identityGetSession`, `navigationGetContext`), and the route-target coverage entries.

- [ ] **Step 8: Regenerate OpenAPI + run full contract gate**

```bash
pnpm platform-contract:generate
pnpm platform-contract:drift
pnpm openapi:platform:lint
cd packages/platform-contract && pnpm typecheck && pnpm test && pnpm test:package
```
Expected: all pass; `docs/api/platform-openapi-v1.yaml` + manifest updated.

- [ ] **Step 9: Commit**

```bash
git add packages/platform-contract/src/identity packages/platform-contract/src/registry/operations.ts packages/platform-contract/src/index.ts packages/platform-contract/test docs/api/
git commit -m "feat(contract): unblock 8 PLT-03 identity/invitation operations"
```

---

### Task 2: Data layer scaffolding — platform-identity package

**Files:**
- Create: `packages/platform-identity/package.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`
- Create: `packages/platform-identity/src/index.ts`, `src/run-migrations.ts`
- Create: `packages/platform-identity/migrations/<epoch>_create-platform-identity-tables.ts`
- Test: `packages/platform-identity/test/integration/migrations.test.ts`

**Interfaces:**
- Consumes: repo patterns from `packages/ingestion-credentials` (package.json scripts, tsconfig, run-migrations.ts, vitest alias).
- Produces: package `@aurora/platform-identity` with `migrate` script and `run-migrations` entry; migration creating all 11 tables from spec §4.

- [ ] **Step 1: Write the failing migration test**

`test/integration/migrations.test.ts` (mirror ingestion-inbox `test/integration/helpers.ts` — copy that helper; `assertIsTestDatabase` requires path `/aurora_inbox_test`):
```ts
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { runner } from 'node-pg-migrate';
import { createTestPool, testDatabaseUrl } from './helpers.js';

const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const describeDb = hasDb ? describe : describe.skip;

describeDb('platform-identity migrations', () => {
  let pool: Awaited<ReturnType<typeof createTestPool>>;
  beforeAll(async () => {
    pool = await createTestPool();
    await runner({ databaseUrl: testDatabaseUrl(), dir: new URL('../../migrations/', import.meta.url).pathname, direction: 'up', migrationsTable: 'pgmigrations', count: Infinity, log: () => undefined });
  });
  afterAll(async () => { await pool.end(); });
  it('creates the identity tables', async () => {
    const tables = await pool.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('accounts','account_credentials','email_verification_intents','password_reset_intents','organizations','organization_members','organization_invitations','project_members','security_audit_events','idempotency_records','outbox')",
    );
    expect(tables.rows).toHaveLength(11);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd packages/platform-identity
AURORA_TEST_DATABASE_URL=postgresql://aurora:aurora_test_pw@localhost:15432/aurora_inbox_test pnpm exec vitest run test/integration/migrations.test.ts
```
Expected: FAIL — module not found / no tables.

- [ ] **Step 3: Write package.json, tsconfigs, vitest.config.ts, run-migrations.ts**

Copy structure from `packages/ingestion-credentials`. `package.json`:
```json
{
  "name": "@aurora/platform-identity",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "files": ["dist"],
  "engines": { "node": ">=24.18.0 <25" },
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run --exclude test/integration/**",
    "test:integration": "vitest run test/integration --no-file-parallelism",
    "test:coverage": "vitest run --coverage --exclude test/integration/**",
    "test:package": "pnpm build && vitest run test/package-entry.test.ts",
    "migrate": "tsx src/run-migrations.ts"
  },
  "dependencies": { "pg": "8.22.0" },
  "devDependencies": { "@types/pg": "8.20.0", "node-pg-migrate": "9.0.0", "tsx": "4.23.1", "vitest": "4.1.10", "typescript": "6.0.3" },
  "aurora": { "layer": "data" }
}
```
`vitest.config.ts` aliases workspace deps to source (mirror ingestion-credentials). `src/run-migrations.ts` reads `AURORA_TEST_DATABASE_URL` and runs `runner`.

- [ ] **Step 4: Write the migration**

`migrations/<epoch>_create-platform-identity-tables.ts` — create the 11 tables exactly per spec §4.1-4.11 (uuid PKs `gen_random_uuid()`, `timestamptz` defaults, CHECK constraints, unique indexes; `organization_invitations` partial unique index on `(organization_id, invited_email) WHERE status='pending'`; `email_normalized` unique on accounts). Provide `down` (drop in reverse).

- [ ] **Step 5: Run tests to verify pass**

Same command as Step 2. Expected: PASS (11 tables exist).

- [ ] **Step 6: Add run-migrations + README + package-entry test**

Create `test/package-entry.test.ts` asserting `dist/` exports the public API after build. Add `README.md` per doc spec.

- [ ] **Step 7: Commit**

```bash
git add packages/platform-identity pnpm-lock.yaml pnpm-workspace.yaml
git commit -m "feat(platform-identity): scaffold data package + 11-table migration"
```
> `pnpm-workspace.yaml` already globs `packages/*` — verify no change needed; `pnpm install` to link workspace dep.

---

### Task 3: platform-identity repositories + password/intent-token services

**Files:**
- Create: `packages/platform-identity/src/password.ts`
- Create: `packages/platform-identity/src/intent-token.ts`
- Create: `packages/platform-identity/src/repositories/accounts.ts`
- Create: `packages/platform-identity/src/repositories/intents.ts`
- Create: `packages/platform-identity/src/repositories/organizations.ts`
- Create: `packages/platform-identity/src/repositories/audit.ts`
- Create: `packages/platform-identity/src/repositories/idempotency.ts`
- Create: `packages/platform-identity/src/repositories/outbox.ts`
- Modify: `packages/platform-identity/src/index.ts`
- Test: `packages/platform-identity/test/password.test.ts`, `test/intent-token.test.ts`, `test/integration/accounts.test.ts`, `test/integration/intents.test.ts`, `test/integration/organizations.test.ts`, `test/integration/idempotency.test.ts`, `test/integration/outbox.test.ts`

**Interfaces:**
- Consumes: `argon2` (new dep, locked version), `pg` Pool, migration tables.
- Produces:
  - `hashPassword(password: string): Promise<string>` / `verifyPassword(password: string, hash: string): Promise<boolean>` (Argon2id, constant-time; failure paths uniform).
  - `createIntentToken(): { token: string; digest: string }` (32-byte CSPRNG token, SHA-256 digest).
  - Repository functions: `createAccount`, `findAccountByEmailNormalized`, `getAccountById`, `updateAccountVerifiedAt`, `incrementSecurityVersion`, `insertEmailVerificationIntent`, `insertPasswordResetIntent`, `consumeIntent` (one-time + expiry), `findIntentByDigest`, `createPersonalOrganization`, `insertOrganizationMembership`, `insertProjectMembership`, `createInvitation`, `findInvitationByDigest`, `updateInvitationStatus`, `insertAuditEvent`, `createIdempotencyRecord`, `findIdempotencyRecord`, `insertOutboxRow`, `claimOutboxRows`, `markOutboxResult` — all typed with stable union returns mirroring ingestion-inbox (`{status:'success'} | {status:'conflict'} | ...`).

- [ ] **Step 1: Write failing unit tests for password/intent-token**

`test/password.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/password.js';

describe('password hashing', () => {
  it('hashes and verifies a password', async () => {
    const hash = await hashPassword('s3cure-Passw0rd!');
    expect(hash).not.toContain('s3cure-Passw0rd!');
    await expect(verifyPassword('s3cure-Passw0rd!', hash)).resolves.toBe(true);
    await expect(verifyPassword('wrong', hash)).resolves.toBe(false);
  });
  it('produces unique salts (different hashes per call)', async () => {
    const a = await hashPassword('same-password');
    const b = await hashPassword('same-password');
    expect(a).not.toBe(b);
  });
});
```
`test/intent-token.test.ts`: asserts token is ≥32 bytes, digest is 64 hex chars, digest !== token.

- [ ] **Step 2: Run to verify failure**

```bash
cd packages/platform-identity
pnpm exec vitest run test/password.test.ts test/intent-token.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write password.ts and intent-token.ts**

```ts
// src/password.ts
import argon2 from 'argon2';
export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
}
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try { return await argon2.verify(hash, password); } catch { return false; }
}
```
```ts
// src/intent-token.ts
import { createHash, randomBytes } from 'node:crypto';
export function createIntentToken(): { token: string; digest: string } {
  const token = randomBytes(32).toString('base64url');
  const digest = createHash('sha256').update(token).digest('hex');
  return { token, digest };
}
```

- [ ] **Step 4: Run tests to verify pass**

Expected: PASS.

- [ ] **Step 5: Write repositories (integration tests first, then impl)**

For each repository, write `test/integration/*.test.ts` using `describeDb` (skip when `AURORA_TEST_DATABASE_URL` unset), asserting: `createAccount` returns the row with normalized email; `findAccountByEmailNormalized` finds by canonical form; `consumeIntent` succeeds once then returns `already_consumed`; `createPersonalOrganization` + `insertOrganizationMembership` creates an owner row; idempotency `createIdempotencyRecord` returns `conflict` on duplicate key; `insertOutboxRow` persists and `claimOutboxRows` claims with lease. Implement the repositories with explicit `BEGIN/COMMIT/ROLLBACK` and parameterized SQL (Kysely per ADR-029 is optional here — plain parameterized `pg` mirrors ingestion-inbox and satisfies ADR-029's SQL-first; document the choice in README).

- [ ] **Step 6: Run integration tests**

```bash
cd packages/platform-identity
AURORA_TEST_DATABASE_URL=postgresql://aurora:aurora_test_pw@localhost:15432/aurora_inbox_test pnpm test:integration
```
Expected: all pass.

- [ ] **Step 7: Export public API from index.ts + commit**

`src/index.ts` re-exports all repository functions, `hashPassword`/`verifyPassword`, `createIntentToken`, and repository interfaces. Commit: `feat(platform-identity): repositories + argon2id + intent tokens`.

---

### Task 4: platform-session package (Redis authoritative sessions + CSRF + cookie)

**Files:**
- Create: `packages/platform-session/package.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`, `src/index.ts`, `src/session-store.ts`, `src/csrf.ts`, `src/cookie.ts`
- Test: `packages/platform-session/test/session-store.test.ts`, `test/csrf.test.ts`, `test/integration/redis-session.test.ts`

**Interfaces:**
- Consumes: Redis client (`redis` npm package, locked version), SHA-256 via `node:crypto`.
- Produces:
  - `createSession(store, { accountId, authLevel, now }): Promise<{ cookieValue: string; expiresAt: string }>` — generates 32-byte opaque session id; stores `sha256(sessionId)` → JSON `{accountId, authLevel, expiresAt, rotationDueAt, csrfSecret}` with TTL; returns raw cookieValue (only response setter sees it).
  - `getSession(store, cookieValue): Promise<SessionPayload | null>` — looks up by digest; null → missing/expired/revoked.
  - `rotateSession(store, cookieValue, now): Promise<{ cookieValue, expiresAt } | null>` — delete old digest, create new.
  - `revokeSession(store, cookieValue): Promise<void>`.
  - `revokeAllAccountSessions(store, accountId): Promise<void>` — delete all `aurora:platform:session:account:<id>:*` keys.
  - `createCsrfSecret()` / `verifyCsrf(secret, token): boolean` (constant-time).
  - `sessionCookieOptions(secure: boolean): { httpOnly: true; secure; sameSite: 'lax'; path: '/' }` (no Domain).

- [ ] **Step 1: Write failing unit tests**

`test/csrf.test.ts`: create/verify round-trip; wrong token false; timing-safe (no early-exit observable). `test/session-store.test.ts`: `createSession` stores digest not raw value (assert Redis key value !== cookieValue and === sha256); `revokeAllAccountSessions` removes all keys for account. `test/integration/redis-session.test.ts`: `describeDb`-style skip when `AURORA_TEST_REDIS_URL` unset; full create→get→rotate→revoke flow against `redis://localhost:16379`.

- [ ] **Step 2: Run to verify failure**

```bash
cd packages/platform-session
AURORA_TEST_REDIS_URL=redis://localhost:16379 pnpm exec vitest run test/integration/redis-session.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement session-store.ts, csrf.ts, cookie.ts**

```ts
// src/session-store.ts
import { createClient, type RedisClientType } from 'redis';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export interface SessionPayload {
  readonly accountId: string;
  readonly authLevel: 'pending_verification' | 'authenticated' | 'restricted';
  readonly expiresAt: string;
  readonly rotationDueAt: string | null;
  readonly csrfSecret: string;
}
export interface SessionStore { readonly client: RedisClientType; readonly keyPrefix: string; }

function digest(value: string): string { return createHash('sha256').update(value).digest('hex'); }

export async function createSession(store: SessionStore, input: { accountId: string; authLevel: SessionPayload['authLevel']; now: Date; idleMs: number; absoluteMs: number }): Promise<{ cookieValue: string; expiresAt: string }> {
  const cookieValue = randomBytes(32).toString('base64url');
  const expiresAt = new Date(input.now.getTime() + input.absoluteMs);
  const payload: SessionPayload = { accountId: input.accountId, authLevel: input.authLevel, expiresAt: expiresAt.toISOString(), rotationDueAt: null, csrfSecret: randomBytes(32).toString('base64url') };
  await store.client.set(`${store.keyPrefix}:${digest(cookieValue)}`, JSON.stringify(payload), { PX: input.idleMs });
  await store.client.sAdd(`${store.keyPrefix}:account:${input.accountId}`, digest(cookieValue));
  return { cookieValue, expiresAt: expiresAt.toISOString() };
}
// getSession: GET key; null if missing; verify expiresAt >= now
// rotateSession: DEL old digest, createSession with new id, keep account set membership
// revokeSession: DEL key, SREM account set
// revokeAllAccountSessions: SMEMBERS account set → DEL each + DEL account set
```
```ts
// src/csrf.ts
export function verifyCsrf(secret: string, token: string): boolean {
  const a = Buffer.from(secret); const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}
```
```ts
// src/cookie.ts
export function sessionCookieOptions(secure: boolean): { httpOnly: true; secure: boolean; sameSite: 'lax' as const; path: '/' } {
  return { httpOnly: true, secure, sameSite: 'lax', path: '/' };
}
```

- [ ] **Step 4: Run tests to verify pass**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/platform-session pnpm-lock.yaml
git commit -m "feat(platform-session): redis-authoritative session store + csrf + cookie"
```

---

### Task 5: platform-email package (EmailDeliveryPort + Outbox consumer)

**Files:**
- Create: `packages/platform-email/package.json`, tsconfigs, `vitest.config.ts`, `src/index.ts`, `src/email-delivery-port.ts`, `src/outbox-consumer.ts`
- Test: `packages/platform-email/test/outbox-consumer.test.ts`, `test/email-delivery-port.test.ts`, `test/integration/outbox-flow.test.ts`

**Interfaces:**
- Consumes: `EmailDeliveryRequest`/`EmailDeliveryResult` types (spec §6.1); Outbox repository from platform-identity.
- Produces: `EmailDeliveryPort` interface + `ConsoleEmailDeliveryAdapter` (env-gated, for local/Preview without provider secret — logs a redacted placeholder, NEVER the token), `consumeOutboxEmails({ pool, port, limit, now }): Promise<{ consumed: number; failed: number }>` — claims pending rows, marks processing, calls port.deliver, marks succeeded/failed, dead-letters after N attempts.

- [ ] **Step 1: Write failing tests**

`test/email-delivery-port.test.ts`: adapter returns `{status:'enqueued'}` and does not emit the token to output. `test/outbox-consumer.test.ts`: state transitions pending→processing→succeeded/failed/dead_lettered with retry budget. `test/integration/outbox-flow.test.ts` (real PG): insert outbox row → consume → row `succeeded`; failing port → after max attempts → `dead_lettered`.

- [ ] **Step 2: Run to verify failure**

```bash
cd packages/platform-email
AURORA_TEST_DATABASE_URL=postgresql://aurora:aurora_test_pw@localhost:15432/aurora_inbox_test pnpm exec vitest run test/integration/outbox-flow.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement**

`email-delivery-port.ts` defines the port interface + `ConsoleEmailDeliveryAdapter` (reads `EMAIL_DELIVERY_MODE` env; when `console`, resolves `{status:'enqueued'}` and logs `[email] queued <intentType> to <masked>` — NEVER the token or full address). `outbox-consumer.ts` implements the claim→deliver→settle loop with `attempt_count` increment and dead-letter threshold (e.g. 5). The outbox payload stores `{intentType, toMasked, intentToken, expiresInMinutes}`; the consumer renders the mail link using the transient token.

- [ ] **Step 4: Run tests to verify pass**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/platform-email pnpm-lock.yaml
git commit -m "feat(platform-email): EmailDeliveryPort + outbox consumer"
```

---

### Task 6: apps/platform-api — build Fastify server, config, cookie/session/csrf/origin plugins

**Files:**
- Create: `apps/platform-api/package.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`
- Create: `apps/platform-api/src/config.ts`, `src/index.ts` (build), `src/server.ts` (start), `src/plugins/cookie-session.ts`, `src/plugins/csrf.ts`, `src/plugins/origin.ts`
- Test: `apps/platform-api/test/integration/auth-flow.test.ts`

**Interfaces:**
- Consumes: Fastify (locked version), `@aurora/platform-contract/server` (`parseInput`, `serializeOutput`), `@aurora/platform-session` (session store), `@aurora/platform-identity` (repos), `@aurora/platform-email` (port).
- Produces: Fastify server with `GET /api/platform/v1/session` (identityGetSession), cookie parse/set, CSRF verify on non-safe methods, Origin/Fetch-Metadata check.

- [ ] **Step 1: Write failing integration test**

`test/integration/auth-flow.test.ts` (mirror `apps/ingestion-api/test/integration/real-postgres.test.ts` pattern — `describeDb` skip when `AURORA_TEST_DATABASE_URL` unset; needs Redis URL too): boots the app with real PG + Redis, asserts:
- `GET /api/platform/v1/session` with no cookie → 200 `{account: null}` (or 401 with safe login target per ADR-028 — match the exact shape implemented by the session plugin);
- `POST /api/platform/v1/auth/register` → 200 with `accountId` + `emailMasked`, and an outbox row persisted;
- cookie `Set-Cookie` is `HttpOnly` + `SameSite=Lax`.

- [ ] **Step 2: Run to verify failure**

```bash
cd apps/platform-api
AURORA_TEST_DATABASE_URL=postgresql://aurora:aurora_test_pw@localhost:15432/aurora_inbox_test AURORA_TEST_REDIS_URL=redis://localhost:16379 pnpm exec vitest run test/integration/auth-flow.test.ts
```
Expected: FAIL — module not found / no server.

- [ ] **Step 3: Implement package scaffolding + plugins + server**

`config.ts`: reads env (`HOST`, `PORT`, `DATABASE_URL`, `REDIS_URL`, `SESSION_IDLE_MS`, `SESSION_ABSOLUTE_MS`, `COOKIE_SECURE`). `index.ts` builds the Fastify instance (registers plugins, routes), `server.ts` starts it. `plugins/cookie-session.ts`: parses `aurora_session` cookie → `getSession` → decorates request; `plugins/csrf.ts`: on POST/PATCH/DELETE, verifies `X-Aurora-CSRF` against session csrfSecret (or allows public commands with anti-abuse); `plugins/origin.ts`: checks Origin against allow-list.

- [ ] **Step 4: Run tests to verify pass**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/platform-api pnpm-lock.yaml
git commit -m "feat(platform-api): fastify server + session/csrf/origin plugins"
```

---

### Task 7: platform-api route handlers (8 operations)

**Files:**
- Create: `apps/platform-api/src/routes/register.ts`, `routes/login.ts`, `routes/logout.ts`, `routes/password.ts`, `routes/email-verification.ts`, `routes/invitation.ts`
- Modify: `apps/platform-api/src/index.ts`
- Test: `apps/platform-api/test/integration/*.test.ts` (per flow)

**Interfaces:**
- Consumes: operation schema modules from Task 1, platform-identity repositories, platform-session, platform-email port.
- Produces: full 8-operation HTTP behavior with RFC 9457 errors, idempotency, rate-limit stubs, CSRF, enumeration-safe responses.

- [ ] **Step 1: Write failing per-flow integration tests**

Each of register/login/logout/request-reset/confirm-reset/confirm-email/change-password/accept-invitation gets an integration test asserting the happy path AND a security-negative (e.g. login with wrong password → same 401 shape as nonexistent account; reset-confirm revokes all sessions; accept-invitation email mismatch → 404 with no org details; change-password revokes all sessions).

- [ ] **Step 2: Run to verify failure**

```bash
cd apps/platform-api
AURORA_TEST_DATABASE_URL=... AURORA_TEST_REDIS_URL=... pnpm test:integration
```
Expected: FAIL.

- [ ] **Step 3: Implement each route handler**

register.ts: normalize email → check unique → Argon2id hash → transaction {createAccount, createPersonalOrganization, insertOwner, insertEmailVerificationIntent, insertOutboxRow, createIdempotencyRecord} → create Session → set cookie → return `identityRegisterResponse`. login.ts: find account → verifyPassword (uniform failure) → rotate/create Session → return `identityLoginResponse` with safe continuation. logout.ts: revoke current session → clear cookie. password.ts: request-reset writes outbox only when account exists (uniform response); confirm-reset consumes intent + hash new password + revokeAll + no auto-login; change-password verifies current + hashes new + revokeAll + `sessionImpact:'revoked_all'`. email-verification.ts: confirm consumes intent, sets verified_at, rotates session if matched. invitation.ts: accept requires intent (this-visit) + session + account-email matches invited-email → atomic membership + project perms + invitation accepted.

Rate limiting: a small in-memory limiter (per operation + IP + email-normalized) returning 429 `rate_limited`; anti-enumeration: uniform public responses.

- [ ] **Step 4: Run tests to verify pass**

Expected: all integration tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/platform-api/src/routes apps/platform-api/src/index.ts apps/platform-api/test
git commit -m "feat(platform-api): 8 PLT-03 operation handlers"
```

---

### Task 8: apps/platform-worker — outbox email consumer

**Files:**
- Create: `apps/platform-worker/package.json`, tsconfigs, `vitest.config.ts`, `src/index.ts`, `src/run.ts`
- Test: `apps/platform-worker/test/integration/outbox-worker.test.ts`

**Interfaces:**
- Consumes: `@aurora/platform-email` `consumeOutboxEmails`, platform-identity outbox repo.
- Produces: worker loop polling outbox every N ms with claim/retry/dead-letter, graceful shutdown on SIGTERM.

- [ ] **Step 1: Write failing test**

`test/integration/outbox-worker.test.ts`: insert outbox rows → run one poll → assert rows settled (succeeded/failed/dead_lettered per port result).

- [ ] **Step 2: Run to verify failure**

```bash
cd apps/platform-worker
AURORA_TEST_DATABASE_URL=... AURORA_TEST_REDIS_URL=... pnpm exec vitest run test/integration/outbox-worker.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/run.ts`: loop `consumeOutboxEmails` with configurable interval + `AbortController` on SIGTERM/SIGINT. `src/index.ts`: build worker with injected deps.

- [ ] **Step 4: Run tests to verify pass + commit**

`feat(platform-worker): outbox email consumer`.

---

### Task 9: Console real auth/account views

**Files:**
- Modify: `apps/console/src/contracts/route-registry.ts`, `src/router/index.ts`
- Create: `apps/console/src/views/auth/RegisterView.vue`, `LoginView.vue`, `VerifyEmailView.vue`, `VerifyEmailConfirmView.vue`, `ForgotPasswordView.vue`, `ResetPasswordView.vue`, `InvitationAcceptView.vue`, `apps/console/src/views/account/AccountSecurityView.vue`
- Create: `apps/console/src/components/auth/*.vue` (form fields, status banner)
- Test: `apps/console/test/views/auth.test.ts`, `test-browser/auth-flow.spec.ts`

**Interfaces:**
- Consumes: `@aurora/platform-contract/client` (`buildRequest`/`parseResponse`/`PLATFORM_OPERATIONS`), `apps/console/src/api/client.ts` `platformRequest`, session store.
- Produces: real Vue views calling the 8 operations with loading/error/forbidden/processing/partial/stale/unavailable states; route guards redirect unauthenticated to `/login`.

- [ ] **Step 1: Write failing component/browser tests**

`test/views/auth.test.ts` (jsdom): LoginView submits `identityLogin` via mocked client; RegisterView shows `emailMasked` after register. `test-browser/auth-flow.spec.ts` (Playwright + MSW from contract samples): full register→verify→login→logout walk with real Vue components.

- [ ] **Step 2: Run to verify failure**

```bash
cd apps/console
pnpm test && pnpm test:browser
```
Expected: FAIL — routes still unavailable views.

- [ ] **Step 3: Implement views**

Each view uses the generated client operations, Aurora UI wrapper primitives (AppButton/AppLink/AppPageHeader/AppStatusBadge), and the existing tokenized styles. Follow UX §8.1-8.5 state handling. Route guards in `router/index.ts`: protected routes require `session.status === 'authenticated'`.

- [ ] **Step 4: Run tests to verify pass**

`pnpm test && pnpm test:browser` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/views apps/console/src/components/auth apps/console/src/contracts apps/console/src/router apps/console/test apps/console/test-browser
git commit -m "feat(console): real auth/account views for PLT-03"
```

---

### Task 10: Full quality gate + leaf verification + close

**Files:** (no new code — verification only, plus any fix-up commits)

**Interfaces:** Consumes all prior tasks.

- [ ] **Step 1: Run full repo gates**

```bash
pnpm lint
pnpm typecheck
pnpm check:boundaries
pnpm openapi:check
pnpm build
pnpm --filter @aurora/platform-contract test:package
pnpm --filter @aurora/platform-identity test:package
pnpm --filter @aurora/platform-session test:package
pnpm --filter @aurora/platform-email test:package
pnpm --filter @aurora/console test:package
```
Expected: all pass.

- [ ] **Step 2: Run all integration + browser**

```bash
AURORA_TEST_DATABASE_URL=postgresql://aurora:aurora_test_pw@localhost:15432/aurora_inbox_test \
AURORA_TEST_REDIS_URL=redis://localhost:16379 \
pnpm --filter @aurora/platform-identity test:integration && \
pnpm --filter @aurora/platform-session test:integration && \
pnpm --filter @aurora/platform-email test:integration && \
pnpm --filter @aurora/platform-api test:integration && \
pnpm --filter @aurora/platform-worker test:integration && \
pnpm --filter @aurora/console test:browser
```
Expected: all pass.

- [ ] **Step 3: Security-negative re-check**

Confirm: no `password`, `token`, `sessionId`, `csrf` value appears in any `console.log`, MSW fixture, Playwright trace, or test fixture under the new packages/apps/views. Grep:
```bash
grep -rn "console.log.*password\|console.log.*token\|console.log.*sessionId\|console.log.*csrf" packages/platform-* apps/platform-* apps/console/src --include="*.ts" --include="*.vue" | grep -v test | head
```
Expected: empty.

- [ ] **Step 4: Coverage**

```bash
pnpm test:coverage
```
Expected: thresholds met (branches 75 / functions 80 / lines 80 / statements 80) across new packages.

- [ ] **Step 5: Leaf close + update entry docs**

- Update `docs/architecture/aurora-v1-remaining-module-batches.md`: PLT-03 completed 40→41 / remaining 38→37 (only if all gates genuinely pass).
- Append PLT-03 completion record to `docs/superpowers/g10-approval-package.md` or the PLT-03 spec's completion section.
- Verify `git diff --check` clean.

- [ ] **Step 6: Commit**

```bash
git add docs/
git commit -m "docs: close PLT-03 leaf 40->41 / 38->37"
```
(Only after all gates genuinely pass; do not fabricate counts.)

---

## Plan Self-Review

**Spec coverage** — each spec requirement maps to a task:
- §3 package structure → Tasks 2-6; §4 data model → Task 2-3; §5 password/session/CSRF → Tasks 3-4, 6-7; §6 EmailDeliveryPort/Outbox → Tasks 5, 8; §7 contract/OpenAPI → Task 1, 10; §8 Console → Task 9; §9 errors → Tasks 6-7; §10 gates → Task 10; §11 completion → Task 10.
- **No PLT-04/SEC-01 leak**: `identityDeleteAccountPreflight`/`identityDeleteAccount` stay blocked; no org-create/project-create/usage/audit-list/token/trash operations added; no deletion tables/migrations. ✅
- **No placeholders**: every task has concrete Files/Interfaces/TDD steps with real code.
- **Type consistency**: schema modules export `OPERATION_ID_*` consts consumed by registry; repository names consistent across tasks; session/csrf interfaces match across platform-api.
- **YAGNI respected**: no BullMQ/S3 created (Outbox+worker only); Redis only for Session.

**Command reality** — commands mirror `pnpm --filter @aurora/<pkg>` patterns already in the repo (see root package.json scripts and ingestion packages).

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-08-09-platform-identity-authentication-invitation.md`.** Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Per G10 directive (user authorized subagent-driven-development with no execution-mode prompt), executing via **Subagent-Driven**.
