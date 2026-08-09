---
title: SEC-01 Account Deletion State Machine and Orchestration — Implementation Plan
status: approved
owner: platform/security
created: 2026-08-09
last-reviewed: 2026-08-09
applies-to: G10 叶子 SEC-01（A5 账号注销状态机与编排）——契约、状态机、双重复核、唯一 Owner 阻塞、Session 终止、清理交接、审计、Console A5 危险区
related:
  - ../specs/2026-08-09-account-deletion-state-machine-and-orchestration.md
  - ../specs/2026-08-09-platform-identity-authentication-invitation.md
  - ../specs/2026-08-09-platform-workspace-organization-governance.md
  - ../../adr/ADR-028-platform-session-csrf-security.md
  - ../../adr/ADR-029-platform-database-access-and-migration.md
  - ../../adr/ADR-030-platform-session-csrf-password-physical-parameters.md
  - ../../adr/ADR-032-platform-outbox-tasks-cache-objects.md
  - ../../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md
  - ../../security/account-deletion-and-data-lifecycle.md
supersedes: none
superseded-by: none
---

# SEC-01 Account Deletion State Machine and Orchestration — 实施计划

## 固定回读与权威边界（Module ID: SEC-01，G10 leaf 3，目标 42/36 → 43/35）

**权威来源**：`docs/superpowers/specs/2026-08-09-account-deletion-state-machine-and-orchestration.md`（本规格）；accepted ADR-028/029/030/032；G10 APPROVAL PACKAGE approved product rules；PRD §4.1/§13/§16—17；UX §7.7/§8.5/§9.5/§11.1.1/§12.6；`account-deletion-and-data-lifecycle.md`（approved）；backend design §4/§6 A5/§7/§8/§13；PLT-03/PLT-04 规格与真实实现基础。

**不变量（任何 Task 不得违反）**：

1. 7 天冷静期为服务端权威 168 小时；客户端时间不授予资格；边界并发不得同时撤销成功与进入不可逆成功；
2. 双重身份复核缺任一证明不得受理或撤销注销；不建立第二套密码系统（复用 `verifyPassword` + intent 流）；
3. 唯一 Owner 阻塞不因预检放行而失效——最终 Command 服务端复检，失败关闭；不自动转让/不级联删除；
4. 受理后全部 Session 立即终止；冷却/终态账号拒绝登录（必须补 login.ts 状态门禁）；
5. 清理交接必须真实持久化且同事务一致，禁止"只打印一条日志"冒充完成；
6. 审计、日志、URL、Store、Playwright trace 不写密码/邮箱/令牌/会话秘密；
7. 不实现 SEC-02/OPS-07 能力；不 provision 无 consumer 基础设施（ADR-032 YAGNI）；
8. 不修改已批准 ADR 核心决策、公共事件协议或 PLT-03/04 已稳定操作。

**本计划不实现**：SEC-02 跨存储物理删除、对象存储、Redis/BullMQ 全量清理、备份淘汰、恢复重放；`recent-verification` 认证级别；G11—G13。

## Task 总览

| # | Task | 主要交付物 |
|---|---|---|
| 1 | 契约解锁 + 邮件意图类型扩展 | `identityDeleteAccountPreflight`/`IdentityDeleteAccount`/`IdentityRequestAccountDeletion`/`IdentityCancelAccountDeletion`/2×IntentLink（deletion_request + deletion_cancel）解锁与新增；`EmailIntentType` 增 `deletion_confirmation` |
| 2 | platform-organization 唯一 Owner 只读查询 | 新增"账号全部组织成员投影"与"组织 owner 计数"只读 Repository（被 Task 3/4 消费） |
| 3 | 数据层：Migration + Repository + 状态机纯函数 | `account_deletion_intents`/`accounts` 扩展/`account_cleanup_handoffs`；账号状态更新/deletion intent/交接 Repository；`decideDeletionFinalization` |
| 4 | platform-api handler：预检/申请确认/受理/撤销/意图链接 | 6 个 handler + 登录状态门禁 + Session 终止 + 唯一 Owner 复检 + 清理交接 + 撤销意图邮件 + `deletion_request` 确认邮件 + 审计 |
| 5 | Console A5 注销危险区 + 撤销页 | 预检/阻塞清单/双重确认/受理/撤销页；targeted Chromium |
| 6 | 完整门禁 + 叶子验证 + 关闭 | 受影响包 coverage、E2E、文档同步、叶子计数 43/35 |

> 依赖：Task 2（owner 查询）是 Task 3/4 的前置；Task 1（契约类型）是 Task 3/4/5 的前置；Task 5 依赖 Task 4 后端。Task 2 只读查询不依赖 Task 1，可与 Task 1 并行。Task 6 汇总验证。

## Task 1 — 契约解锁 + 邮件意图类型扩展

**交付物**：6 个操作从 blocked/新增 → stable（2 个解锁：`identityDeleteAccountPreflight`/`identityDeleteAccount`；4 个新增：`identityRequestAccountDeletion`/`identityCancelAccountDeletion`/2×IntentLink），生成真实 OpenAPI/client/server；`EmailIntentType` 增 `deletion_confirmation`。

**实现**：

1. `packages/platform-contract/src/identity/deletion.ts` 新建 SchemaDef 模块，镜像 `password.ts` 模式：
   - `identityDeleteAccountPreflightResponse`：`{ status: enum(['ready','blocked','unavailable']), blockingOrganizations?: arr(obj({organizationId:brandedId, organizationName:str, organizationKind:enum(['personal','organization'])})), requiredLifecycle: obj({coolingHours:num, onlineCleanupDays:num, auditRetentionYears:num, backupRetentionDays:num}), serverTime: utcTimestamp }`；
   - `identityRequestAccountDeletionRequest`：`{ idempotencyKey }`；`identityRequestAccountDeletionResponse`：`{ status: enum(['succeeded']), maskedEmail: str, resendAvailableAt?: utcTimestamp }`（枚举安全，不泄漏意图存在性）；
   - `identityDeleteAccountRequest`：`{ currentPassword: str(8,256), idempotencyKey }`；`identityDeleteAccountResponse`：`{ status: enum(['succeeded']), accountStatus: enum(['deletion_cooling']), deletionRequestedAt: utcTimestamp, deletionCoolingEndsAt: utcTimestamp, sessionImpact: enum(['revoked_all']) }`；
   - `identityCancelAccountDeletionRequest`：`{ currentPassword: str(8,256), idempotencyKey }`；`identityCancelAccountDeletionResponse`：`{ status: enum(['succeeded']), accountStatus: enum(['active']), sessionImpact: enum(['revoked_all']) }`；
   - `identityDeleteAccountIntentLinkResponse` / `identityCancelAccountDeletionIntentLinkResponse`：`{ status: enum(['valid']), csrf: str, maskedEmail?: str, intentKind: enum(['deletion_request','deletion_cancel']) }`；
   - 全部 closed object（`obj()` strict zod，`additionalProperties:false`）。
2. `packages/platform-contract/src/registry/operations.ts`：
   - 从 `BLOCKED_OPERATIONS` 移除 `identityDeleteAccountPreflight` / `identityDeleteAccount`；
   - 新增 5 个稳定操作（方法/路径/authLevel/CSRF/idempotency 按 spec §5.1）；`identityRequestAccountDeletion` 为 POST `/api/platform/v1/account/deletion/request`（session, csrf+idempotency）；`identityCancelAccountDeletion` 的 authLevel 为 `intent`（spec §5.1 说明）；
   - `index.ts` re-export `deletion.js`。
3. `packages/platform-email/src/email-delivery-port.ts`：`EmailIntentType` 增 `'deletion_confirmation'`；`packages/platform-email/src/outbox-consumer.ts` `isEmailIntentType` 白名单同步。
4. 运行：`pnpm platform-contract:generate && pnpm platform-contract:drift && pnpm openapi:platform:lint`，然后 `cd packages/platform-contract && pnpm typecheck && pnpm test && pnpm test:package`；`cd packages/platform-email && pnpm typecheck && pnpm test`。
5. 更新 `packages/platform-contract/test/registry/manifest.test.ts` stable 列表断言 + 新增 `deletion.ts` 契约测试（schema 形状、closed、枚举）+ email port/consumer 意图类型测试。

**验收**：`pnpm platform-contract:drift` 通过；OpenAPI 含 5 个新/解锁操作（`usageGetSummary` 等仍 blocked）；email 意图类型单测通过；`pnpm openapi:check` 通过。

**Targeted tests**：`cd packages/platform-contract && pnpm test`；`cd packages/platform-email && pnpm test`；根 `pnpm platform-contract:drift`、`pnpm openapi:platform:lint`。

## Task 2 — platform-organization 唯一 Owner 只读查询

**交付物**：两个只读 Repository 函数（不动 owner 不变量逻辑，只新增查询）。

**实现**：

1. `packages/platform-organization/src/repositories/organizations.ts`（或新建 `ownership.ts`）新增：
   - `listAccountOrganizations(pool, accountId)`：`SELECT o.organization_id, o.name, o.kind, m.role FROM organization_members m JOIN organizations o ON o.organization_id = m.organization_id WHERE m.account_id = $1 ORDER BY o.created_at`；
   - `countOrganizationOwners(pool, orgId)`：`SELECT count(*)::int AS owner_count FROM organization_members WHERE organization_id = $1 AND role = 'owner'`；
   - `isUniqueOrganizationOwner(pool, { orgId, accountId })`：`role='owner'` 且 owner_count=1。
2. `src/index.ts` re-export。
3. 单元 + 集成测试：`test/ownership.test.ts` + `test/integration/ownership.test.ts`（真实 PG：多 org、唯一/非唯一 owner、personal/org kind 区分）。

**验收**：`pnpm --filter @aurora/platform-organization test`、`test:integration` 通过；owner 唯一语义与 remove/transfer 不变量不冲突（复用既有锁）。

**Targeted tests**：`cd packages/platform-organization && pnpm test && pnpm test:integration`。

## Task 3 — 数据层：Migration + Repository + 状态机纯函数

**交付物**：真实 Migration（3 项变更）+ Repository（账号状态更新、deletion intent、交接）+ 状态机纯函数。

**前置**：Task 2 完成（owner 只读查询已存在于 `@aurora/platform-organization`），本 Task 消费。

**实现**：

1. `packages/platform-identity/migrations/<epoch>_account-deletion.ts`：
   - `account_deletion_intents`：`intent_id uuid PK`、`account_id uuid FK→accounts`、`intent_kind text CHECK ('deletion_request','deletion_cancel')`、`token_digest text UNIQUE`、`expires_at timestamptz`、`consumed_at timestamptz`、`created_at timestamptz`；
   - `accounts` 追加列：`deletion_requested_at timestamptz`、`deletion_cooling_ends_at timestamptz`、`deletion_terminated_at timestamptz`（nullable）；
   - `account_cleanup_handoffs`：`handoff_id uuid PK`、`account_id uuid FK→accounts UNIQUE`、`status text CHECK ('pending','in_progress','succeeded','failed','dead_lettered')`、`required_lifecycle jsonb`、`attempt_count int DEFAULT 0`、`created_at/updated_at timestamptz`；
   - down 语句对称回滚。
2. `packages/platform-identity/src/repositories/accounts.ts` 新增：
   - `updateAccountStatus(pool, { accountId, status, now })`：`UPDATE accounts SET status=$2, updated_at=now() ... RETURNING`，`status` 参数限定 `'active'|'pending_verification'|'deletion_cooling'|'terminated'`；
   - `recordDeletionRequest(pool, { accountId, coolingEndsAt, now })`：置 `status='deletion_cooling'`、`deletion_requested_at`、`deletion_cooling_ends_at`，`incrementSecurityVersion`；
   - `recordDeletionTermination(pool, { accountId, now })`：置 `status='terminated'`、`deletion_terminated_at`（供 lazy 最终化事务内调用）。
3. `packages/platform-identity/src/repositories/deletion-intents.ts` 新增（镜像 `intents.ts`）：
   - `insertDeletionIntent(pool, { accountId, intentKind, tokenDigest, expiresAt })`；
   - `findDeletionIntentByDigest(pool, kind, digest)`；`consumeDeletionIntent(pool, { kind, intentId, now })`。
4. `packages/platform-identity/src/repositories/cleanup-handoffs.ts` 新增：
   - `insertCleanupHandoff(pool, { accountId, requiredLifecycle, now })`；`findCleanupHandoffByAccount(pool, accountId)`。
5. `packages/platform-identity/src/deletion-state-machine.ts` 新增纯函数：
   - `decideDeletionFinalization({ account, now, ownerBlocked })` → `'finalize' | 'keep_cooling' | 'not_due'`（spec §4.2；fake clock 可测）。
6. `src/index.ts` re-export 全部新增。
7. 集成测试：`test/integration/deletion.test.ts`（受理事务：状态迁移+审计+交接同事务；回滚→无交接行；撤销；lazy 最终化：届满+未阻塞→terminated+交接；届满+阻塞→keep_cooling）+ `migrations.test.ts` 表清单扩展。单元测试：`deletion-state-machine.test.ts`。

**验收**：`pnpm --filter @aurora/platform-identity test`、`test:integration`（真实 PG）、`test:package` 通过；migration up/down 幂等。

**Targeted tests**：`cd packages/platform-identity && pnpm test && pnpm test:integration && pnpm test:package`。

## Task 4 — platform-api handler：预检/受理/撤销/意图链接 + 登录门禁

**交付物**：6 个真实 handler（preflight/request/delete-intent-link/delete/cancel-intent-link/cancel）+ 登录状态门禁 + Session 终止 + 唯一 Owner 复检 + 清理交接 + **受理时创建撤销意图并发确认邮件** + 审计。

**实现**：

1. `apps/platform-api/src/routes/deletion.ts` 新建（镜像 `intent-links.ts`/`password.ts` 模式）：
   - `handleDeleteAccountPreflight`（GET，session）：读取当前账号全部组织成员投影（Task 2 查询），对每个 `kind='organization'` 组织判断唯一 Owner；返回 `ready`/`blocked`（阻塞组织最小清单）/`unavailable`；写入审计 `account.deletion.preflight_blocked`（仅当 blocked）；
   - `handleRequestAccountDeletion`（POST `/account/deletion/request`，session + CSRF + 幂等）：`requireSession` → **lazy 最终化检查** → 若已冷却 → 409 `state_machine_conflict`（已在注销流程）→ `runIdempotentCommand`：`createIntentToken()` 创建 `deletion_request` 意图（`insertDeletionIntent`，短期 TTL）+ `insertOutboxRow`（`intentType: 'deletion_confirmation'`，mailLinkUrl 内嵌 `deletion_request` token）→ 返回 `{ status:'succeeded', maskedEmail, resendAvailableAt? }`（枚举安全，镜像 `identityRequestPasswordReset`）；**这是 `deletion_request` 确认邮件的唯一生产触发**（Task 5 的"发送邮箱确认"按钮调用它）；
   - `handleDeleteAccountIntentLink`（GET `/account/deletion/intent/:token`，public）：按 `deletion_request` digest 校验意图 → `setIntentCookie` → 返回 `{status:'valid', csrf, maskedEmail, intentKind}`（镜像 intent-links.ts）；
   - `handleDeleteAccount`（POST，session）：`parseInput` → `requireSession` → 读取当前账号 → **lazy 最终化检查**（若已冷却且届满尝试推进）→ 校验 `request.intentPayload?.kind === 'deletion_request'`（否则 409）→ `verifyPassword`（403 统一）→ 消费意图（一次性/过期 → 409）→ `runIdempotentCommand`：事务内 `requireOrgOwnerOnAccount` 最终唯一 Owner 复检（Task 2 查询，失败 → 409 `state_machine_conflict` + 最新阻塞清单）→ `recordDeletionRequest` + **受理事务同时创建 `deletion_cancel` 撤销意图 + Outbox 确认邮件**（spec §7.1，含 `deletion_confirmation` email intent）→ 审计 `account.deletion.requested` → 提交后 `revokeAllAccountSessions` + 清 Session Cookie；
   - `handleCancelAccountDeletionIntentLink`（GET `/account/deletion/cancel/intent/:token`，public）：`deletion_cancel` 意图 → 意图 cookie；
   - `handleCancelAccountDeletion`（POST，intent authLevel）：`parseInput` → 校验 `intentPayload?.kind === 'deletion_cancel'` → 从意图解析账号 → 读账号：若 `status !== 'deletion_cooling'` → 409 `state_machine_conflict`；`verifyPassword` → 消费意图 → `runIdempotentCommand`：`updateAccountStatus('active')` + 审计 `account.deletion.cancelled` → 提交后 `revokeAllAccountSessions`（已终止的全部保持无效）。
2. `apps/platform-api/src/routes/login.ts`：登录成功后、建 Session 前，检查 `account.status`：
   - `deletion_cooling` / `terminated` → 拒绝登录（`sendProblem` 409 `state_machine_conflict`，安全返回，不暴露详情）；不建立 Session；
   - `identityGetSession`（`routes/session.ts`）同样对冷却/终态账号返回非业务 Session（统一 401/受限，不泄漏生命周期详情）。
3. `apps/platform-api/src/app.ts` 注册 5 条路由（方法/路径与契约一致）。
4. `apps/platform-api/src/operations.ts` 无需改（`operationById` 从注册表读取）。
5. 集成测试：`test/integration/deletion-flow.test.ts`（真实 PG+Redis，fake clock）覆盖：
   - E2E-1 受理全流程：注册 → 验证 → 登录 → preflight ready → 意图链接 → 密码+意图确认 → 受理 → 全部 Session 终止（旧 Session 401）→ 冷却状态返回 → 交接行不存在（受理阶段）→ **`deletion_cancel` 意图 + 确认邮件已创建** → 冷却届满 lazy 最终化 → terminated + 交接行存在；
   - E2E-2 唯一 Owner 阻塞：用户是某 `kind='organization'` 组织唯一 Owner → preflight blocked → 受理 409 → 无交接 → 账号仍 usable；
   - E2E-3 撤销：受理 → 撤销链接（deletion_cancel 意图）→ 密码 → 撤销成功 → active → 重新登录；原 Session 无效；
   - 冷却账号登录被拒（security-negative）；
   - CSRF 负例、Redis down→503、意图过期/重复消费 409。

**验收**：`pnpm --filter @aurora/platform-api test`、`test:integration`（真实 PG+Redis）通过；登录门禁负例通过。

**Targeted tests**：`cd apps/platform-api && pnpm test && pnpm test:integration`。

## Task 5 — Console A5 注销危险区 + 撤销页

**交付物**：A5 危险区（预检/阻塞/双重确认/受理）+ 撤销页；targeted Chromium。

**实现**：

1. `apps/console/src/views/account/AccountSecurityView.vue`：在独立危险区增加"注销账号"：
   - 进入 → `executeQuery(OPERATION_ID_DELETE_ACCOUNT_PREFLIGHT, { scope: {type:'account'} })`；
   - `blocked` → 阻塞组织清单（名称 + 类型）+ 每个"转让所有权"真实入口（导航到对应组织 B3 流程）+ "重新检查"（重新请求权威预检）；不显示最终提交；
   - `ready` → 危险确认 + 当前密码字段 + "发送邮箱确认"（调用触发 `deletion_request` 意图创建 + 邮件，本规格经后端确认后由邮件携带链接）；
   - 受理成功 → 显示服务端 `deletionCoolingEndsAt`（不信任客户端倒计时）+ Session 已终止 + 引导重新登录/撤销说明。
2. `apps/console/src/contracts/route-registry.ts` 新增撤销页 route（scope: 'public'，镜像 `auth.reset-password`）：routeId `account.deletion-cancel`（**需要新增 RouteTargetId** → 同步 `packages/platform-contract/src/common/navigation.ts` `ROUTE_TARGET_IDS`）+ `route-registry.test.ts`/`router.test.ts` 同步。
   - 撤销页（`views/account/DeletionCancelView.vue`，public）：读 `route.query.token` → `fetchIntentLink`（deletion cancel 意图链接）→ 清 URL token → 输入当前密码 → `OPERATION_ID_CANCEL_ACCOUNT_DELETION`（intent cookie + CSRF）→ 成功 → 登录。
3. `apps/console/src/mocks/handlers.ts` + `handlerControls` 增加 A5 操作 mock 与计数（`deletionPreflightRequests`/`deleteAccountRequests`/`cancelDeletionRequests`）。
4. 组件测试：`apps/console/test/views/account.test.ts`（预检 ready/blocked、阻塞清单、受理、撤销页）。
5. 浏览器测试：`apps/console/test-browser/deletion-flow.spec.ts`（2 条：受理阻塞 + 受理+撤销；axe 在既有 `axe.spec.ts` 覆盖 A5 页）。

**验收**：`pnpm --filter @aurora/console test`、`test:browser`（chromium deletion-flow + axe）通过；`test:package` 通过。

**Targeted tests**：`cd apps/console && pnpm test && pnpm test:package`；`pnpm test:browser --project=chromium`（仅 deletion-flow + axe spec）。

## Task 6 — 完整门禁 + 叶子验证 + 关闭

**交付物**：SEC-01 新鲜验证证据、文档同步、叶子计数 43/35、handoff。

**实现**：

1. 受影响包 coverage：`packages/platform-identity`、`platform-organization`、`platform-email`、`apps/platform-api`、`apps/console` 的 `test:coverage`（阈值不降低）。
2. 全仓门禁：`pnpm format:check && pnpm openapi:check && pnpm lint && pnpm typecheck && pnpm check:boundaries && pnpm build && git diff --check`（不跑全量 `pnpm test` 重复；各包 test 已在 Task 1—5 新鲜跑过）。
3. 文档同步：
   - `docs/architecture/aurora-v1-remaining-module-batches.md`：SEC-01 closed，completed 42→43 / remaining 36→35；G10 当前状态段落补 SEC-01；覆盖矩阵表同步（G10 Platform 2→2、Security/Lifecycle 1→0，Total 36→35）；
   - `docs/architecture/formalization-readiness.md`：SEC-01 完成记录（若该文件有 SEC-01 行）；
   - `AGENTS.md`/`AURORA_RULES.md`：G10 状态快照更新（SEC-01 已关闭、42/36→43/35）；
   - `docs/api/platform-openapi-v1.yaml` + `.manifest.json`：由 `platform-contract:generate` 生成（Task 1 已做，此处确认 drift）。
4. 更新记忆：`plt-04-authority-extract.md` 补充 SEC-01 完成事实。
5. 最终 E2E 已由 Task 3/5 覆盖；本 Task 汇总证据。

**验收**：全仓门禁新鲜通过；受影响包 coverage 达到阈值；叶子计数 43/35；无未提交无关修改被覆盖。

**Targeted tests**：受影响 5 包 `test:coverage`；根 `pnpm format:check && pnpm openapi:check && pnpm lint && pnpm typecheck && pnpm check:boundaries && pnpm build && git diff --check`。

## 全局约束

- `pnpm platform-contract:generate` 后必须通过 `platform-contract:drift`；manifest stable 列表必须更新（Task 1）。
- 每 Task 只运行 targeted tests + 必要 typecheck + `git diff --check`；不每 Task 跑完整 root CI/全量 Chromium/全部 PG suites（LEAN EXECUTION MODE）。
- 真实 PostgreSQL 只用于涉及 Migration/Repository/状态迁移/事务/交接/API→DB 的 Task（2/3/4）；契约-only（1）与 UI-only（5）不跑 PG。
- 浏览器只用于 UI Task（5）与最终关键 E2E（3 的集成 E2E 用 Fastify inject，5 的 Chromium 只跑 deletion-flow + axe）；Firefox/WebKit 由 OPS-02/Nightly/Release 负责。
- 每 Task 保留 fresh reviewer（subagent-driven-development），reviewer 只检查 correctness/spec compliance/security-privacy/state-machine integrity/persistence-transaction/public API 兼容；不要求无关全仓测试。
- 不创建无 consumer 基础设施（ADR-032 YAGNI）；`account_cleanup_handoffs` 只持久化，SEC-02 consumer 未来消费。

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| `EmailIntentType` 扩展波及 outbox-consumer 白名单 | Task 1 同步 data layer + email port + consumer 校验；测试锁白名单 |
| 唯一 Owner 预检误伤 personal workspace | spec §6.2 冻结：只对 `kind='organization'` 判定；Task 4 测试覆盖 |
| 撤销流程无 Session 的认证 | `intent` authLevel + 受理时发送 `deletion_cancel` 意图（spec §7.1）；Task 3 集成测试覆盖 |
| lazy 最终化与撤销并发竞争 | 最终化纯函数 + 事务内复检 + `runIdempotentCommand`；Task 2/3 测试覆盖边界并发 |
| 登录门禁遗漏 | Task 3 补 login.ts + session.ts 状态检查；security-negative 测试锁死 |
