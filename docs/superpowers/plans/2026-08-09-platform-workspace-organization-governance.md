# PLT-04 Workspace and Organization Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Aurora platform workspace/organization/project governance (B1-B8): workspace+projects, atomic create project, org members/invitations, org timezone, resource-usage (unavailable), private management token (one-time plaintext), security audit, project recycle bin — on real PostgreSQL 17 + Redis, with 16 operations stable, real Console pages, closing leaf PLT-04 (41/37 → 42/36).

**Architecture:** 4 new data-layer packages (`platform-organization`, `platform-project-governance`, `platform-credentials`, `platform-audit`) extend the PLT-03 foundation; `apps/platform-api` (existing) gains the B1-B8 route handlers; `apps/console` gains the B1-B8 pages. Reuses PLT-03 Session/CSRF/Origin plugins, idempotency, rate-limit, global error handler. B5 `usageGetSummary` stays blocked (front-end unavailable, no fake).

**Tech Stack:** TypeScript 6.0.3 strict, Node 24.18, Fastify 5.10.0, PostgreSQL 17 + node-pg-migrate 9 + SQL-first (ADR-029), Redis 7 (ADR-030), `pg` 8.22, `argon2`, Vue 3 + generated client (Console), Vitest/Playwright/axe.

## 固定回读与权威边界 (Module ID: PLT-04)

- **权威来源**：`docs/superpowers/specs/2026-08-09-platform-workspace-organization-governance.md`（本规格）；accepted ADR-029/030/031/032；G10 APPROVAL PACKAGE approved product rules；PRD §4.2-4.6/§5.4/§12.3/§13/§16/§17；UX §7.8-7.15/§8.6-8.13/§9.6-9.13/§10.3-10.7；backend design §4/§6 B1-B8/§7.1/§8/§13；PLT-03 规格与实现基础。
- **不变量（任何 Task 不得违反）**：
  1. token 明文/摘要/客户端密钥明文/密码**绝不**进入日志、URL、前端 Store、MSW fixture、Playwright trace；
  2. **B5 用量绝不 fake**：`usageGetSummary` 保持 blocked，前端 `unavailable`；
  3. **owner 唯一不变量**：任何 Command 不得制造无 owner 或双 owner；TransferOwnership 事务锁，ChangeRole 不得改 owner；
  4. **审计绝不由用户直接追加**：只由管理 Command 同事务写入 `security_audit_events`；
  5. **B8 恢复安全规则**（G10 approved）：只对 `trash` 恢复；告警不自动重启；已撤销令牌/失效密钥不恢复；成员/角色按当前组织状态重算；不复活删除清理状态；
  6. **B6 一次性交付**：明文只在首次成功创建响应出现一次（cache-prohibited），后续不重显；服务端只存 SHA-256 摘要；
  7. 私密令牌创建需已验证邮箱（PRD §4.1）；B2 创建项目仅 owner/admin；
  8. **data → {protocol}**：新增 4 个 data 包不依赖 contract 层或彼此；跨 data 由 service 层注入；
  9. 不实现 SEC-01/G11-G13/B5 真实 Query。
- **Module ID**：PLT-04（G10 leaf 2；目标 41/37 → 42/36）。

## Global Constraints

- Node `>=24.18.0 <25`；pnpm 11.17.0；TypeScript strict；eslint strict-type-checked（新文件必须满足，不弱化规则）。
- 新包 `aurora.layer`：4 个 data 包 = `data`（`data → {protocol}` only，不依赖 `@aurora/platform-contract`/彼此）；`apps/platform-api` = `service`。
- 所有 persisted/external input 从 `@aurora/platform-contract` Zod SchemaDef 运行时校验进入。
- 错误用 RFC 9457 `auroraProblem`；禁止栈/SQL/队列名/对象键/token/枚举信息。
- Integration tests 用真实 PostgreSQL 17 + Redis（`AURORA_TEST_DATABASE_URL`/`AURORA_TEST_REDIS_URL`）；禁止 mock 冒充。
- `pnpm platform-contract:generate` 后必须通过 `platform-contract:drift`；manifest stable 列表更新。
- 新包加入根 `lint`/`format:check`/`test:coverage`/`eslint.config.mjs` files 块（PLT-03 T10 已建立该机制）。
- 版本精确锁定；lockfile 用 `--no-frozen-lockfile` 本地更新、CI `--frozen-lockfile`。
- B5 `usageGetSummary` 保持 blocked；不建无 consumer 基础设施（ADR-032 YAGNI）。

---

## File Structure

**Contract layer (`packages/platform-contract`):**
- Create: `src/organization/workspace.ts`, `src/organization/members.ts`, `src/organization/invitations.ts`, `src/organization/settings.ts`, `src/project-governance/create.ts`, `src/project-governance/trash.ts`, `src/credentials/private-tokens.ts`, `src/audit/security-audit.ts` — schema modules (16 operations).
- Modify: `src/registry/operations.ts` (unblock 11 + add 5 new), `src/index.ts` (re-export), `test/registry/manifest.test.ts`, `test/contract-testkit/samples.ts`, `test/generator/openapi.test.ts`.

**Data layer (4 new packages, mirror PLT-03 pattern):**
- `packages/platform-organization`: package.json/tsconfigs/vitest/run-migrations + `migrations/` + `src/repositories/{organizations,members,invitations,timezone}.ts` + `test/*.test.ts` + `test/integration/*.test.ts`.
- `packages/platform-project-governance`: same skeleton + `migrations/` (projects/client_keys/project_environments/project_onboarding) + `src/repositories/{projects,client-keys,onboarding,project-members,trash}.ts`.
- `packages/platform-credentials`: skeleton + `migrations/` (private_tokens) + `src/repositories/{private-tokens}.ts` + `src/token.ts` (digest + one-time format).
- `packages/platform-audit`: skeleton + `migrations/` (security_audit_events extension) + `src/repositories/{audit}.ts`.

**Service layer (`apps/platform-api`):**
- Create: `src/routes/workspace.ts`, `src/routes/projects.ts`, `src/routes/members.ts`, `src/routes/invitations.ts`, `src/routes/settings.ts`, `src/routes/private-tokens.ts`, `src/routes/audit.ts`, `src/routes/trash.ts` + `src/authorization.ts` (effective permission projection).
- Modify: `src/app.ts` (wire new routes + deps), `src/index.ts` (composition root), `src/route-deps.ts`.

**Console (`apps/console`):**
- Create: `src/views/workspace/WorkspaceHomeView.vue`, `src/views/organization/MembersView.vue`, `SettingsView.vue`, `UsageView.vue`, `TokensView.vue`, `AuditView.vue`, `TrashView.vue`, `src/views/organization/projects/CreateProjectView.vue` (or under `src/views/org/`), `src/components/org/*.vue`.
- Modify: `src/contracts/route-registry.ts`, `src/router/guards.ts`, `test/**`, `test-browser/**`.

---

### Task 1: Contract — unblock 11 + add 5 organization/credentials/audit operations

**Files:**
- Create: `packages/platform-contract/src/organization/workspace.ts`, `members.ts`, `invitations.ts`, `settings.ts`
- Create: `packages/platform-contract/src/project-governance/create.ts`, `trash.ts`
- Create: `packages/platform-contract/src/credentials/private-tokens.ts`
- Create: `packages/platform-contract/src/audit/security-audit.ts`
- Modify: `packages/platform-contract/src/registry/operations.ts`, `src/index.ts`, `test/registry/manifest.test.ts`, `test/generator/openapi.test.ts`, `test/contract-testkit/samples.ts`

**Interfaces:**
- Consumes: `SchemaDef` builders from `src/common/schema.js`; `OperationDef`/`AuthLevel`; `commandResult`/`idempotencyKey`; `utcTimestamp`; `RouteTargetId`; `auroraProblem`; existing `AccountId`/`OrganizationId`/`ProjectId` from `src/common/identifiers.js`.
- Produces: 16 `OPERATION_ID_*` consts + request/response SchemaDefs (per spec §5.1/§5.2).

- [ ] **Step 1: Write failing schema tests**

For each of the 16 operations, a `test/.../*.test.ts` asserting: valid accepted, missing-required rejected, unknown field rejected (closed object), response closed with no token-plaintext/digest/password leak. Example (`test/organization/workspace.test.ts`):
```ts
import { describe, expect, it } from 'vitest';
import { OPERATION_ID_LIST_PROJECTS, organizationListProjectsResponse } from '../../src/organization/workspace.js';
describe('organizationListProjects', () => {
  it('has the frozen operation id', () => { expect(OPERATION_ID_LIST_PROJECTS).toBe('organizationListProjects'); });
  it('accepts a valid workspace response', () => {
    const r = organizationListProjectsResponse.zod.safeParse({
      projects: [{ projectId: 'prj_123', name: 'Web', frameworkType: 'vue', status: 'active', lifecycle: 'active' }],
      allowedActions: ['create'], navigationTargets: [],
    });
    expect(r.success).toBe(true);
  });
  it('rejects a leaked client-key plaintext', () => {
    const r = organizationListProjectsResponse.zod.safeParse({ projects: [{ projectId: 'p', name: 'x', frameworkType: 'js', status: 'active', lifecycle: 'active', clientKeyPlaintext: 'aurora_key_secret' }], allowedActions: [], navigationTargets: [] });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `cd packages/platform-contract && pnpm exec vitest run test/organization test/project-governance test/credentials test/audit` → FAIL (module not found).

- [ ] **Step 3: Write the 8 schema modules** — each exports `OPERATION_ID_*` + request/response SchemaDefs exactly per spec §5.1/§5.2. Follow the session.ts conventions (closed `obj`, `optional(utcTimestamp)`, `brandedId`). The private-token create response includes `tokenPlaintext` (string) — this is the ONLY place the plaintext exists.

- [ ] **Step 4: Register 16 operations** — unblock the 11 existing blocked ops (`organizationListProjects`, `organizationCreateProject`, `organizationListMembers`, `organizationInviteMember`, `organizationUpdateTimezone`, `credentialsListPrivateTokens`, `credentialsCreatePrivateToken`, `auditListSecurityAudit`, `projectGovernanceListTrash`, `projectGovernanceRestoreProject`) by removing from `BLOCKED_OPERATIONS` and appending `OperationDef`s; add 5 new ops (`organizationRevokeInvitation`, `organizationResendInvitation`, `organizationChangeRole`, `organizationRemoveMember`, `organizationTransferOwnership`, `credentialsRevokePrivateToken`) directly to `PLATFORM_OPERATIONS`. Auth levels/CSRF/idempotency per spec §5.1. `usageGetSummary` stays blocked.

- [ ] **Step 5: Re-export from index.ts + update manifest/samples tests.**

- [ ] **Step 6: Regenerate + full contract gate** — `pnpm platform-contract:generate && pnpm platform-contract:drift && pnpm openapi:platform:lint && cd packages/platform-contract && pnpm typecheck && pnpm test && pnpm test:package`.

- [ ] **Step 7: Commit** — `feat(contract): unblock 16 PLT-04 organization/credentials/audit operations`.

---

### Task 2: platform-organization data package (organizations/members/invitations/timezone repositories)

**Files:**
- Create: `packages/platform-organization/{package.json, tsconfig.json, tsconfig.build.json, vitest.config.ts, src/index.ts, src/run-migrations.ts, README.md}`
- Create: `packages/platform-organization/migrations/<epoch>_organization-lifecycle.ts` — organizations settings version + timezone (already has timezone column), organization_members (already exists), organization_invitations (already exists). **This migration extends existing tables**: add `organizations.settings_version` (integer default 0) for optimistic concurrency (B4); add partial unique index on invitations if not present.
- Create: `packages/platform-organization/src/repositories/{organizations,members,invitations,timezone}.ts`
- Test: `test/{index,package-entry}.test.ts`, `test/integration/{organizations,members,invitations,timezone}.test.ts`

**Interfaces:**
- Consumes: PLT-03 tables (`organizations`, `organization_members`, `organization_invitations`), PLT-03 `normalizeEmail`/`createIntentToken` from `@aurora/platform-identity` (**data→data forbidden — must inject or re-implement**: since `data → {protocol}` only, this package CANNOT import platform-identity; copy `normalizeEmail`/`createIntentToken` into this package or accept them as injected params. Prefer: duplicate the small `normalizeEmail` helper locally; the intent-token digest for invitations is already handled by PLT-03 accept flow; this package only creates/revokes/resends, so it needs a token generator — replicate `createIntentToken` locally).
- Produces: `listMembers(pool, orgId, opts)`, `inviteMember(pool, {orgId, invitedEmail, orgRole, projectGrants, tokenDigest, expiresAt, actorAccountId})` (atomic invite + audit), `revokeInvitation`, `resendInvitation`, `changeOrganizationRole`, `removeMember`, `transferOwnership` (transactional, owner-invariant), `getOrganizationSettings`, `updateOrganizationTimezone` (versioned).

- [ ] **Step 1: Write failing integration tests** (describeDb skip when env unset): members CRUD, invitation lifecycle (create/revoke/resend/expire), owner-invariant (transfer keeps exactly one owner; remove-last-owner blocked; change-role-to-owner blocked), timezone update with version conflict → 412.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Write package skeleton + migration + repositories.** Owner-invariant via transaction: `SELECT ... FOR UPDATE` on org+members, verify count of owners == 1 post-commit, reject removing/deroting the last owner.
- [ ] **Step 4: Run integration + typecheck + test + package-entry + boundaries → PASS.**
- [ ] **Step 5: Commit** — `feat(platform-organization): members/invitations/timezone repositories`.

---

### Task 3: platform-project-governance data package (projects/client-keys/onboarding/trash)

**Files:**
- Create: `packages/platform-project-governance/` skeleton (same as Task 2) + `migrations/<epoch>_project-governance.ts` (projects/client_keys/project_environments/project_onboarding per spec §4.1-4.4) + `src/repositories/{projects,client-keys,onboarding,trash}.ts`
- Test: `test/integration/{projects,client-keys,onboarding,trash}.test.ts`

**Interfaces:**
- Consumes: PLT-03 `accounts`/`organizations` tables; `normalizeEmail` (local copy).
- Produces: `createProject(pool, {orgId, name, frameworkType, websiteUrl, createdBy})` — **atomic** {insert project + default production env + default client key (public_identifier + key_digest) + onboarding row}; `listProjects(pool, {orgId, accountId})` (permission-filtered); `listTrash(pool, orgId)`; `restoreProject(pool, {orgId, projectId, resourceVersion, actor})` — **atomic** {verify status='trash' + within recoverable_until + recompute membership roles vs current org state + set status='active' + audit}; `updateProjectStatus` (archive); `revokeClientKey`; `insertProjectMember`.

- [ ] **Step 1: Write failing integration tests**: atomic createProject (all 4 rows present, any failure = no partial), permission-filtered listProjects, trash lifecycle, restoreProject safety (only trash+within window; membership recomputed; keys/tokens not restored), archive→trash→restore state machine.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Write package skeleton + migration + repositories.** The default client key: `public_identifier = 'aurora_key_<base64url(8)>'` (public), `key_digest = sha256(secret)` (secret generated once at creation, NOT persisted, only the digest).
- [ ] **Step 4: Run gates → PASS.**
- [ ] **Step 5: Commit** — `feat(platform-project-governance): projects/client-keys/onboarding/trash repositories`.

---

### Task 4: platform-credentials data package (private tokens)

**Files:**
- Create: `packages/platform-credentials/` skeleton + `migrations/<epoch>_private-tokens.ts` (per spec §4.5) + `src/token.ts` + `src/repositories/private-tokens.ts`
- Test: `test/integration/private-tokens.test.ts`

**Interfaces:**
- Consumes: PLT-03 `organizations`/`accounts` tables; `createIntentToken`-style CSPRNG (local copy).
- Produces: `createPrivateToken(pool, {orgId, createdBy, name, scopes, expiresAt?, idempotencyKey})` → `{ tokenId, tokenPlaintext, digest, ... }` (atomic: metadata + sha256 digest + audit; plaintext returned only to the caller, never stored); `listPrivateTokens(pool, orgId)` (metadata only, NO digest/plaintext); `revokePrivateToken(pool, {tokenId, actor})` (irreversible, audited); `verifyTokenScope` helper.

- [ ] **Step 1: Write failing integration tests**: create returns one-time plaintext + stores only digest (assert DB has no plaintext), list returns metadata only, revoke irreversible + audited, expires_at enforced.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Write package + token.ts + repository.**
- [ ] **Step 4: Run gates → PASS.**
- [ ] **Step 5: Commit** — `feat(platform-credentials): private-token digest + one-time delivery`.

---

### Task 5: platform-audit data package (security audit read)

**Files:**
- Create: `packages/platform-audit/` skeleton + `migrations/<epoch>_audit-extension.ts` (add `project_id` + `result` columns to `security_audit_events`; index on `(organization_id, occurred_at DESC)`) + `src/repositories/audit.ts`
- Test: `test/integration/audit.test.ts`

**Interfaces:**
- Consumes: PLT-03 `security_audit_events` table.
- Produces: `listAuditEvents(pool, {orgId, cursor?, limit?, from?, to?})` (redacted summary: action/result/occurredAt/actorMasked/targetProjectRef), `insertAuditEvent` is owned by other packages (PLT-03 already exports one; this package only READS for B7). Tombstone: events for permanently-deleted projects keep `project_id` as a bare uuid (no FK).

- [ ] **Step 1: Write failing integration tests**: reads redacted events, 1y retention window, forbidden projection not applicable (data layer just reads; permission at service layer), tombstone for deleted project.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Write package + migration + repository.**
- [ ] **Step 4: Run gates → PASS.**
- [ ] **Step 5: Commit** — `feat(platform-audit): security-audit read repository`.

---

### Task 6: platform-api route handlers (B1-B8)

**Files:**
- Create: `apps/platform-api/src/authorization.ts`, `src/routes/{workspace,projects,members,invitations,settings,private-tokens,audit,trash}.ts`
- Modify: `apps/platform-api/src/app.ts` (wire 16 routes + new deps), `src/index.ts`, `src/route-deps.ts`
- Test: `test/integration/{workspace,projects,members,invitations,settings,private-tokens,audit,trash}-flow.test.ts`

**Interfaces:**
- Consumes: the 16 operation schemas, the 4 new data packages, PLT-03 session/csrf/origin/idempotency/rate-limit/error-mapper, `parseInput`/`serializeOutput`.
- Produces: 16 route handlers with RFC 9457 errors, permission re-checks, idempotency, audit-write-in-transaction.

- [ ] **Step 1: Write failing integration tests** per flow (happy + security-negative): B2 create (owner only, atomic, 403 for member, idempotent), B3 invite/revoke/resend/change-role/remove/transfer (owner-invariant, audit), B4 timezone (version conflict 412), B6 token (one-time plaintext, list-no-secret, revoke irreversible), B7 audit (owner/admin only, forbidden leaks nothing), B8 trash/restore (safety rules, window expiry 409).
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement handlers** using the spec §6 permission model (authorization.ts: `effectivePermissions(accountId, orgId)` = org inheritance + project explicit; every Command re-reads).
- [ ] **Step 4: Run integration + typecheck + lint → PASS.**
- [ ] **Step 5: Commit** — `feat(platform-api): B1-B8 organization/project governance handlers`.

---

### Task 7: Console B1-B8 pages

**Files:**
- Modify: `apps/console/src/contracts/route-registry.ts`, `src/router/guards.ts`
- Create: `src/views/workspace/WorkspaceHomeView.vue`, `src/views/organization/{MembersView,SettingsView,UsageView,TokensView,AuditView,TrashView,ProjectCreateView}.vue`, `src/components/org/*.vue`
- Test: `test/views/org.test.ts`, `test-browser/org-flow.spec.ts`

**Interfaces:**
- Consumes: generated client ops, `platformRequest`/`executeQuery`, session store.
- Produces: B1-B8 real pages + B5 `unavailable` (UsageView shows honest capability-gap, no fake data).

- [ ] **Step 1: Write failing component/browser tests** (jsdom + Playwright): workspace lists orgs/projects (member sees only assigned), create-project form (owner/admin), members/invitations tabs, timezone settings, private-token one-time delivery (assert no re-display on refresh), audit timeline, trash/restore (safety copy). UsageView asserts unavailable.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement views** using Aurora UI wrapper + 8-state model + one-time-secret handling (no re-display after leave; history.replaceState where relevant).
- [ ] **Step 4: Run console unit + browser + package → PASS.**
- [ ] **Step 5: Commit** — `feat(console): B1-B8 organization/project governance views`.

---

### Task 8: Full quality gate + leaf close

**Files:** (verification + docs only)

- [ ] **Step 1: Root gates** — `pnpm lint && pnpm typecheck && pnpm check:boundaries && pnpm openapi:check && pnpm build` (fresh).
- [ ] **Step 2: All integration + browser + coverage** — the 4 new packages + platform-api + console (with `AURORA_TEST_DATABASE_URL`/`AURORA_TEST_REDIS_URL`).
- [ ] **Step 3: Security-negative re-grep** — no token/plaintext/password/client-key in logs/URL/fixtures.
- [ ] **Step 4: Update `docs/architecture/aurora-v1-remaining-module-batches.md`**: PLT-04 closed 41→42 / 37→36.
- [ ] **Step 5: Commit** — `docs: close PLT-04 leaf 41->42 / 37->36`.

---

## Plan Self-Review

**Spec coverage** — each spec requirement maps to a task: §5 operations → T1; §4 data model → T2-T5; §6 permissions → T6; §7 B6 token params → T4/T6; §8 B8 restore rule → T3/T6; §9 errors → T6; §10 gates → T8; §11 completion → T8.
- **No SEC-01/G11-G13/B5 leak**: `usageGetSummary` stays blocked; no deletion ops; no monitoring/publish/alerts pages.
- **No placeholders**: every task has concrete Files/Interfaces/TDD steps.
- **data → {protocol}**: 4 new data packages don't depend on contract or each other (local `normalizeEmail`/`createIntentToken` copies for the data packages that need them).
- **Type consistency**: op ids match registry (projectGovernanceListTrash/RestoreProject preserved); repository names consistent.

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-08-09-platform-workspace-organization-governance.md`.** Per G10 directive (user authorized subagent-driven-development with no execution-mode prompt), executing via **Subagent-Driven**.
