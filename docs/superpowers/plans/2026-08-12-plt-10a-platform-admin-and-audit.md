---
title: PLT-10a Platform Admin & Audit Implementation Plan
status: approved
owner: platform
created: 2026-08-12
last-reviewed: 2026-08-12
applies-to: D2 平台资源策略的前置基础——平台管理员身份/授权/平台级审计（`@aurora/platform-admin` 数据包 + 机器契约 + platform-api handler + bootstrap）
related:
  - ../../../AGENTS.md
  - ../../../AURORA_RULES.md
  - ../../security/platform-admin-and-platform-audit.md
  - ../../adr/ADR-034-platform-admin-and-platform-audit.md
  - ../../architecture/platform-resource-policy-data-model.md
  - ../../superpowers/specs/2026-07-30-aurora-platform-openapi-and-implementation-design.md
supersedes: none
design-stage: approved
---

# PLT-10a Platform Admin & Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 D2 平台资源策略的前置基础：`@aurora/platform-admin` 数据包（`platform_admins` + `platform_audit_events` + Repository）、平台管理员/审计五个稳定机器契约操作、platform-api handler 与受控 bootstrap，使平台管理员身份/授权/审计可真实落地。

**Architecture:** 平台管理员=数据库显式账号级能力（`platform_admins`），与 org/project 角色完全解耦；平台命令每次鉴权重读。平台级审计独立 `platform_audit_events` 表，与 B7 分离，平台命令同事务写入，保留 1 年。新数据包 `@aurora/platform-admin`（`aurora.layer: data`，仅依赖 `pg`，workspace-policy 自动发现）。机器契约沿用统一 Platform OpenAPI（生成 + drift）。不实现自动 break-glass（v1 以 bootstrap ≥2 管理员缓解）。

**Tech Stack:** TypeScript、PostgreSQL 17 + `pg` + node-pg-migrate、`@aurora/platform-contract`（5 操作 + OpenAPI 生成 + drift）、Fastify handler、`@aurora/platform-identity`（accounts）。

## Global Constraints

- 平台管理员能力**不得**从 org owner/admin、project_admin 或任何 org/project 角色推导（OpenAPI §459）。
- 平台命令执行前重新读取 `platform_admins` 鉴权；不缓存。
- 非平台管理员访问平台能力：统一 `403 authorization`，不泄露平台策略/目录/用量。
- 平台命令 fail-closed：Redis/Session 权威不可用 → `503 authority_unavailable`，不降级允许。
- 平台审计记录完整 `actor_account_id`（安全合规用途），`target` 受约束 jsonb（不携带策略正文/密钥/完整目录）；平台命令同事务写入审计；保留 1 年。
- 审计 action CHECK 覆盖全部规划值（`admin_bootstrapped`/`admin_granted`/`admin_revoked`/`policy_set_default`/`policy_set_organization`/`policy_reset_organization`/`policy_set_project_limit`/`policy_clear_project_limit`/`audit_read`）——Plan B 复用，不改表。
- 不实现自动 break-glass、企业 IdP 组映射、云控制面身份直连。
- 不修改 ADR-028/029/030（Session/CSRF/数据库工具链沿用）；不修改 ADR-034 决策。
- 平台命令沿用既有 Session + CSRF 机制（ADR-028）；grant/revoke 为 CSRF + 幂等 + 独立确认 + 平台审计。

## File Structure

新增（`@aurora/platform-admin` 数据包）：

- `packages/platform-admin/package.json` — `aurora.layer: data`，依赖仅 `pg`
- `packages/platform-admin/tsconfig.json`、`tsconfig.build.json`、`vitest.config.ts`、`README.md`
- `packages/platform-admin/migrations/1786700000001_platform-admins.ts` — `platform_admins` 表
- `packages/platform-admin/migrations/1786700000002_platform-audit-events.ts` — `platform_audit_events` 表
- `packages/platform-admin/src/errors.ts` — `PlatformAdminError`
- `packages/platform-admin/src/run-migrations.ts` — node-pg-migrate runner
- `packages/platform-admin/src/repositories/admins.ts` — `isPlatformAdmin`/`grantPlatformAdmin`/`revokePlatformAdmin`/`listPlatformAdmins`/`countPlatformAdmins`/`bootstrapPlatformAdmins`
- `packages/platform-admin/src/repositories/audit.ts` — `insertPlatformAuditEvent`/`queryPlatformAuditEvents`
- `packages/platform-admin/src/index.ts` — 包根导出
- 测试：`packages/platform-admin/test/`（单测）、`packages/platform-admin/test/integration/`（真实 PostgreSQL）

修改（契约 + handler + bootstrap + 文档）：

- `packages/platform-contract/src/platform-admin/platform-admin.ts`（新建）— 5 个操作
- `packages/platform-contract/src/registry/operations.ts` — 注册 5 操作（`platformAdminGetCapability`/`platformAdminList`/`platformAdminGrant`/`platformAdminRevoke`/`platformAuditListEvents`）
- `packages/platform-contract/src/index.ts` — 导出
- `packages/platform-contract/test/registry/manifest.test.ts` — 操作顺序 + coverage（`platform.resource-policies` 仍 `unavailable`，因 D2 页面 Plan C 未接）
- `apps/platform-api/src/routes/platform-admin.ts`（新建）— 5 handler
- `apps/platform-api/src/routes/_shared.ts` — `requirePlatformAdmin` 辅助
- `apps/platform-api/src/app.ts` — 注册路由
- `apps/platform-api/src/bootstrap.ts`（新建）— 受控 bootstrap
- `apps/platform-api/src/start.ts` — 接线 bootstrap
- `apps/platform-api/package.json` — 加 `@aurora/platform-admin` 依赖
- 测试：`apps/platform-api/test/integration/platform-admin-flow.test.ts`（真实 PostgreSQL + Redis）

## 数据契约速查（5 新 operations）

- `platformAdminGetCapability`(GET, session) → `{ data: { hasCapability: boolean }, meta, allowedActions, navigationTargets }`
- `platformAdminList`(GET, admin) → `{ data: { admins: [{ accountId, grantedBy, grantedAt }], pagination: paginationMeta } }`
- `platformAdminGrant`(POST, path `:accountId`, admin) → body `{ idempotencyKey }` → `{ data: { status:'granted'|'already_admin', accountId } }`
- `platformAdminRevoke`(POST, path `:accountId`, admin) → body `{ idempotencyKey }` → `{ data: { status:'revoked'|'not_admin', accountId } }`（`last_admin`/`account_not_found` → 稳定错误）
- `platformAuditListEvents`(GET, admin, keyset) → `{ data: { events: [{ eventId, action, actorAccountId, target, result, occurredAt }], pagination: paginationMeta } }`

## Task 结构

### Task 1: `@aurora/platform-admin` 包脚手架 + Migration

**Files:**
- Create: `packages/platform-admin/package.json`、`tsconfig.json`、`tsconfig.build.json`、`vitest.config.ts`、`README.md`
- Create: `packages/platform-admin/migrations/1786700000001_platform-admins.ts`
- Create: `packages/platform-admin/migrations/1786700000002_platform-audit-events.ts`
- Create: `packages/platform-admin/src/errors.ts`、`src/run-migrations.ts`
- Test: `packages/platform-admin/test/integration/migrations.integration.test.ts`

**Interfaces:**
- Produces: `PlatformAdminError`（`kind: 'invalid_input'|'database_unavailable'|'statement_failed'`）；两个 Migration（`platform_admins`、`platform_audit_events`）；`run-migrations.ts` 可执行迁移。

- [ ] **Step 1: 包脚手架**

按 `packages/platform-audit/package.json` 镜像创建（名称 `@aurora/platform-admin`、`aurora.layer: data`、dependencies 仅 `pg`、devDependencies 同 platform-audit、scripts 同 platform-audit）。创建 `tsconfig.json`/`tsconfig.build.json`/`vitest.config.ts`（镜像 platform-audit 对应文件）、`README.md`。

- [ ] **Step 2: `platform_admins` Migration**

`1786700000001_platform-admins.ts`：

```ts
import type { MigrationBuilder } from 'node-pg-migrate';
export const shorthands = undefined;
export const up = (pgm: MigrationBuilder): void => {
  pgm.createTable('platform_admins', {
    account_id: { type: 'uuid', primaryKey: true, references: 'accounts' },
    granted_by: { type: 'uuid', notNull: true, references: 'accounts' },
    granted_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
};
export const down = (pgm: MigrationBuilder): void => {
  pgm.dropTable('platform_admins');
};
```

- [ ] **Step 3: `platform_audit_events` Migration**

`1786700000002_platform-audit-events.ts`：

```ts
import type { MigrationBuilder } from 'node-pg-migrate';
export const shorthands = undefined;
export const up = (pgm: MigrationBuilder): void => {
  pgm.createTable('platform_audit_events', {
    event_id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    actor_account_id: { type: 'uuid', notNull: true, references: 'accounts' },
    action: {
      type: 'varchar(48)', notNull: true,
      check: "action IN ('admin_bootstrapped','admin_granted','admin_revoked','policy_set_default','policy_set_organization','policy_reset_organization','policy_set_project_limit','policy_clear_project_limit','audit_read')",
    },
    target: { type: 'jsonb', notNull: true },
    result: { type: 'varchar(16)', notNull: true, check: "result IN ('succeeded','rejected')" },
    occurred_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    request_id: { type: 'varchar(64)' },
  });
  pgm.createIndex('platform_audit_events', [{ name: 'occurred_at', sort: 'DESC' }], { name: 'idx_platform_audit_events_occurred_at' });
};
export const down = (pgm: MigrationBuilder): void => { pgm.dropTable('platform_audit_events'); };
```

- [ ] **Step 4: errors.ts + run-migrations.ts**

`errors.ts` 镜像 `packages/processing-store/src/errors.ts`（`ProcessingStoreError` 同构 → `PlatformAdminError`）。`run-migrations.ts` 镜像 `packages/platform-audit/src/run-migrations.ts`（`node-pg-migrate` runner，`checkOrder: false`，migrationsTable `pgmigrations`）。

- [ ] **Step 5: 集成测试（migration）**

`test/integration/migrations.integration.test.ts`：连接 `AURORA_TEST_DATABASE_URL`（断言 path `/aurora_inbox_test`），跑本包 migration，断言 `platform_admins`/`platform_audit_events` 存在、约束生效（重复 `platform_admins.account_id` 冲突、非法 `action` 冲突）。

Run: `pnpm --filter @aurora/platform-admin exec vitest run test/integration/migrations.integration.test.ts --no-file-parallelism`
Expected: PASS

- [ ] **Step 6: Commit**

### Task 2: 平台管理员 Repository

**Files:**
- Create: `packages/platform-admin/src/repositories/admins.ts`
- Modify: `packages/platform-admin/src/index.ts`
- Test: `packages/platform-admin/test/integration/admins.integration.test.ts`

**Interfaces:**
- Consumes: Task 1 `PlatformAdminError`、Migration。
- Produces:
  - `isPlatformAdmin(pool: Pool, input: { accountId: string }): Promise<boolean>`
  - `grantPlatformAdmin(pool, input: { accountId: string; grantedBy: string })` → `{ status: 'granted' } | { status: 'already_admin' } | { status: 'account_not_found' } | { status: 'temporarily_unavailable' }`
  - `revokePlatformAdmin(pool, input: { accountId: string; revokedBy: string })` → `{ status: 'revoked' } | { status: 'not_admin' } | { status: 'last_admin' } | { status: 'temporarily_unavailable' }`（`account_not_found` 合并为 `not_admin`）
  - `listPlatformAdmins(pool, input: { limit?: number })` → `{ items: readonly { accountId; grantedBy; grantedAt }[] }`
  - `countPlatformAdmins(pool)` → `number`
  - `bootstrapPlatformAdmins(pool, input: { accountIds: readonly string[]; bootstrapBy: string })` → `{ seeded: number }`（只对存在的账号、且非已管理员者插入；写入一条 `admin_bootstrapped` 审计）

- [ ] **Step 1: 写失败测试**

`admins.integration.test.ts`：建表（Task 1 migration 已跑），insert 两个测试账号（`accounts` 表），断言：grant → `isPlatformAdmin` true；重复 grant → `already_admin`；revoke → false；再次 revoke → `not_admin`；把唯一管理员 revoke → `last_admin`（保持 ≥1）；bootstrap 对空表 seed + `admin_bootstrapped` 审计；`countPlatformAdmins`。

- [ ] **Step 2: 运行确认失败**

Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `admins.ts`**

原始 SQL；`isPlatformAdmin` = `SELECT 1 FROM platform_admins WHERE account_id=$1`；`grantPlatformAdmin` 先查 `accounts` 存在 → `INSERT ... ON CONFLICT (account_id) DO NOTHING` → conflict 则 `already_admin`；`revokePlatformAdmin` 在**事务内**先 `SELECT count(*) FROM platform_admins`，若当前为最后一个管理员（`count=1` 且该行即目标）→ `last_admin` 回滚，否则 DELETE；`bootstrapPlatformAdmins` 逐 accountId 校验账号存在后 INSERT（`ON CONFLICT DO NOTHING`）并累计 seeded，最后写一条 `admin_bootstrapped` 审计（复用 Task 3 的 `insertPlatformAuditEvent`）。

- [ ] **Step 4: 运行通过**

Run: `pnpm --filter @aurora/platform-admin exec vitest run test/integration/admins.integration.test.ts --no-file-parallelism`
Expected: PASS

- [ ] **Step 5: index.ts 导出**

`packages/platform-admin/src/index.ts` 导出 admins + audit 全部函数与类型。

- [ ] **Step 6: Commit**

### Task 3: 平台审计 Repository

**Files:**
- Create: `packages/platform-admin/src/repositories/audit.ts`
- Test: `packages/platform-admin/test/integration/audit.integration.test.ts`

**Interfaces:**
- Consumes: Task 1 Migration。
- Produces:
  - `insertPlatformAuditEvent(client: PoolClient, input: { actorAccountId: string; action: PlatformAuditAction; target: unknown; result: 'succeeded'|'rejected'; requestId?: string }): Promise<void>`（必须在调用方事务内；`PlatformAuditAction` = `'admin_bootstrapped'|'admin_granted'|'admin_revoked'|'policy_set_default'|'policy_set_organization'|'policy_reset_organization'|'policy_set_project_limit'|'policy_clear_project_limit'|'audit_read'`）
  - `queryPlatformAuditEvents(pool, input: { cursor?: string; limit?: number })` → `{ items: readonly { eventId; actorAccountId; action; target; result; occurredAt; requestId? }[]; nextCursor? }`（keyset 分页按 `occurred_at DESC, event_id DESC`，limit 默认 50 上限 50）

- [ ] **Step 1: 写失败测试**

`audit.integration.test.ts`：insert 多条（含 `request_id`），query 断言排序、keyset `nextCursor` 翻页、`limit` 上限。

- [ ] **Step 2: 运行确认失败**

Expected: FAIL

- [ ] **Step 3: 实现 `audit.ts`**

镜像 `packages/processing-store/src/notification-repository.ts` 的 keyset 分页模式；`target` 序列化为 JSONB；错误包装 `PlatformAdminError`。

- [ ] **Step 4: 运行通过**

Expected: PASS

- [ ] **Step 5: Commit**

### Task 4: 机器契约操作（5 个）

**Files:**
- Create: `packages/platform-contract/src/platform-admin/platform-admin.ts`
- Modify: `packages/platform-contract/src/registry/operations.ts`、`src/index.ts`
- Modify: `packages/platform-contract/test/registry/manifest.test.ts`
- Test: `packages/platform-contract/test/contract-testkit/samples.test.ts`（+ samples）、`test/registry/manifest.test.ts`

**Interfaces:**
- Consumes: 无（独立 schema）。
- Produces: `OPERATION_ID_PLATFORM_ADMIN_GET_CAPABILITY`/`OPERATION_ID_PLATFORM_ADMIN_LIST`/`OPERATION_ID_PLATFORM_ADMIN_GRANT`/`OPERATION_ID_PLATFORM_ADMIN_REVOKE`/`OPERATION_ID_PLATFORM_AUDIT_LIST`；响应/查询/路径/请求 schema。

- [ ] **Step 1: 定义操作文件**

按 `packages/platform-contract/src/notifications/notifications.ts` 模式定义 5 操作。示例核心：

```ts
export const OPERATION_ID_PLATFORM_ADMIN_GET_CAPABILITY = 'platformAdminGetCapability' as const;
export const OPERATION_ID_PLATFORM_ADMIN_LIST = 'platformAdminList' as const;
export const OPERATION_ID_PLATFORM_ADMIN_GRANT = 'platformAdminGrant' as const;
export const OPERATION_ID_PLATFORM_ADMIN_REVOKE = 'platformAdminRevoke' as const;
export const OPERATION_ID_PLATFORM_AUDIT_LIST = 'platformAuditListEvents' as const;

const adminSummary = obj({ accountId: AccountId, grantedBy: AccountId, grantedAt: utcTimestamp });
const adminSection = obj({ status: str(1,16), reason: optional(str(1,128)), items: arr(adminSummary, 0, 100), pagination: paginationMeta });
export const platformAdminGetCapabilityResponse = obj({ data: obj({ hasCapability: bool() }) });
export const platformAdminListResponse = queryResponse(obj({ admins: adminSection }));
export const platformAdminGrantPathParams = obj({ accountId: AccountId });
export const platformAdminGrantBody = obj({ idempotencyKey: str(8,128) });
export const platformAdminGrantResponse = obj({ data: obj({ status: str(1,32), accountId: AccountId }) });
export const platformAdminRevokePathParams = obj({ accountId: AccountId });
export const platformAdminRevokeBody = obj({ idempotencyKey: str(8,128) });
export const platformAdminRevokeResponse = obj({ data: obj({ status: str(1,32), accountId: AccountId }) });
const auditEvent = obj({ eventId: AuditEventId, action: str(1,48), actorAccountId: AccountId, target: rec(str(1,4096)), result: str(1,16), occurredAt: utcTimestamp, requestId: optional(str(1,64)) });
const auditSection = obj({ status: str(1,16), reason: optional(str(1,128)), items: arr(auditEvent, 0, 50), pagination: paginationMeta });
export const platformAuditListEventsQuery = obj({ cursor: optional(str(1,512)), limit: optional(num(1,50)) });
export const platformAuditListEventsResponse = queryResponse(obj({ events: auditSection }));
```

（`AuditEventId` 已存在于 `common/identifiers.ts`；`rec` 从 `common/schema.js` 导入。）

- [ ] **Step 2: 注册 + 解冻**

`registry/operations.ts` 导入并追加 5 操作（GET 操作 `csrf:false, idempotency:false`；POST grant/revoke `csrf:true, idempotency:true`）；`platform.resource-policies` 的 coverage 保持 `unavailable`（D2 页面 Plan C 未接），本批不触碰 `BLOCKED_OPERATIONS`。`src/index.ts` `export * from './platform-admin/platform-admin.js'`。

- [ ] **Step 3: OpenAPI 生成 + drift**

Run: `pnpm platform-contract:generate && pnpm platform-contract:drift`
Expected: drift PASS

- [ ] **Step 4: 更新 manifest/samples 测试**

`manifest.test.ts` 稳定操作顺序追加 5 个 ID；`samples.ts` 加 `validPlatformAdmin*Samples`（capability/list/grant/revoke/audit，查询响应含 meta/allowedActions/navigationTargets），`samples.test.ts` 接线。

- [ ] **Step 5: 运行 contract 测试**

Run: `pnpm --filter @aurora/platform-contract exec vitest run`
Expected: 全 PASS

- [ ] **Step 6: 重建 + Commit**

Run: `pnpm --filter @aurora/platform-contract build`

### Task 5: platform-api handler（5 个）+ 注册

**Files:**
- Create: `apps/platform-api/src/routes/platform-admin.ts`
- Modify: `apps/platform-api/src/routes/_shared.ts`（`requirePlatformAdmin`）、`apps/platform-api/src/app.ts`、`apps/platform-api/package.json`
- Test: `apps/platform-api/test/integration/platform-admin-flow.test.ts`

**Interfaces:**
- Consumes: Task 2/3 Repository、Task 4 操作、`requireSession`、`runIdempotentCommand`。
- Produces: 5 handler；`requirePlatformAdmin(request, reply, deps, requestId)`（session → `isPlatformAdmin` → 非管理员 403）。

- [ ] **Step 1: `requirePlatformAdmin` 辅助**

`_shared.ts` 新增：session 鉴权后 `isPlatformAdmin(deps.pool, { accountId })`，false → `403 authorization 'You do not have platform admin permission.'`（不泄露任何平台数据）；DB 失败 → `503 authority_unavailable`。

- [ ] **Step 2: 写失败集成测试**

`platform-admin-flow.test.ts`：真实 PostgreSQL + Redis；`registerVerifiedActor` 建 alice（非管理员）+ 直接 `bootstrapPlatformAdmins` 建平台管理员 bob。断言：alice capability=false；bob capability=true；bob grant alice → alice capability=true + 审计 `admin_granted`；bob revoke alice → false；bob 审计列表含 `audit_read`/`admin_granted`；非管理员 alice 访问 grant → 403 且不泄露；跨账号 grant 幂等重放不重复。

- [ ] **Step 3: 运行确认失败**

Expected: FAIL（路由/handler 未实现）

- [ ] **Step 4: 实现 5 handler + 注册**

`platform-admin.ts` 镜像 `apps/platform-api/src/routes/notifications.ts`（GET 用 `parseInput`+`serializeOutput`；POST 用 `runIdempotentCommand` + 事务内 `insertPlatformAuditEvent`）。grant 成功 → `admin_granted` 审计；revoke 成功 → `admin_revoked` 审计（`last_admin` → `ServiceError(409,'state_machine_conflict',...)` 回滚不写审计）；capability/audit 读取在 `audit_read` 时也写审计（审计读取本身留痕）。`app.ts` 注册：

```ts
app.get('/api/platform/v1/platform-admin/capability', (req, rep) => handleGetPlatformAdminCapability(req, rep, routeContext));
app.get('/api/platform/v1/platform-admin/admins', (req, rep) => handleListPlatformAdmins(req, rep, routeContext));
app.post('/api/platform/v1/platform-admin/admins/:accountId/grant', (req, rep) => handleGrantPlatformAdmin(req, rep, routeContext));
app.post('/api/platform/v1/platform-admin/admins/:accountId/revoke', (req, rep) => handleRevokePlatformAdmin(req, rep, routeContext));
app.get('/api/platform/v1/platform-admin/audit', (req, rep) => handleListPlatformAuditEvents(req, rep, routeContext));
```

`apps/platform-api/package.json` dependencies 加 `"@aurora/platform-admin": "workspace:*"`。

- [ ] **Step 5: 运行集成测试**

Run: `AURORA_TEST_DATABASE_URL=... AURORA_TEST_REDIS_URL=... pnpm --filter @aurora/platform-api exec vitest run test/integration/platform-admin-flow.test.ts --no-file-parallelism`
Expected: PASS

- [ ] **Step 6: typecheck + Commit**

Run: `pnpm --filter @aurora/platform-api exec tsc -p tsconfig.json --noEmit`

### Task 6: 受控 bootstrap 接线

**Files:**
- Create: `apps/platform-api/src/bootstrap.ts`
- Modify: `apps/platform-api/src/start.ts`

**Interfaces:**
- Consumes: Task 2 `bootstrapPlatformAdmins`。
- Produces: 启动时若 `platform_admins` 为空且配置 `PLATFORM_ADMIN_BOOTSTRAP_ACCOUNT_IDS` 存在则 seed。

- [ ] **Step 1: 实现 `bootstrap.ts`**

`runPlatformAdminBootstrap(pool, { accountIds, bootstrapBy })`：先 `countPlatformAdmins`，非空则跳过；否则 `bootstrapPlatformAdmins`；失败记录边界日志（不携带账号/token）。

- [ ] **Step 2: 接线 start.ts**

`apps/platform-api/src/start.ts` 在 server.listen 前调用；`PLATFORM_ADMIN_BOOTSTRAP_ACCOUNT_IDS` 从 `loadPlatformApiConfig` 读取（在 `config.ts` 增 `platformAdminBootstrapAccountIds?: readonly string[]`，缺省 `[]`）。

- [ ] **Step 3: typecheck + Commit**

Run: `pnpm --filter @aurora/platform-api exec tsc -p tsconfig.json --noEmit`

### Task 7: 质量门禁 + 文档同步

**Files:**
- Modify: `AGENTS.md`、`AURORA_RULES.md`

**Interfaces:**
- Consumes: 全计划产出。

- [ ] **Step 1: 全量 targeted 验证**

Run:
- `pnpm --filter @aurora/platform-admin exec vitest run`（单测）
- `pnpm --filter @aurora/platform-admin exec vitest run test/integration --no-file-parallelism`
- `pnpm --filter @aurora/platform-contract exec vitest run`
- `pnpm platform-contract:drift`
- `pnpm --filter @aurora/platform-api exec vitest run test/integration/platform-admin-flow.test.ts --no-file-parallelism`
- `pnpm --filter @aurora/platform-api exec tsc -p tsconfig.json --noEmit`
Expected: 全 PASS

- [ ] **Step 2: ledger 同步**

`AGENTS.md`/`AURORA_RULES.md` G13 条目：PLT-10a（`@aurora/platform-admin` 数据包 + 平台管理员/审计 5 操作 + handler + bootstrap）implemented-in-feature-branch；`platform.resource-policies` coverage 仍 `unavailable`（D2 页面 Plan C 未接）；计数不提前加（Plan A/B/C 各自独立验收后才关闭叶子）。

- [ ] **Step 3: git diff --check + Commit**

Run: `git diff --check`

## Self-Review

**1. Spec coverage（ADR-034 / platform-admin-and-platform-audit spec）：**
- 身份模型（`platform_admins` 显式账号级、非推导）：Task 1/2 ✓
- 授权/撤销（管理员维护、CSRF+幂等+确认+审计、撤销立即失效、每次鉴权重读）：Task 2/5 ✓
- bootstrap（受控、≥1 管理员、`admin_bootstrapped` 审计）：Task 2/6 ✓
- break-glass（v1 无自动、≥2 管理员）：Global Constraints + Task 6（bootstrap 支持多 id）✓
- 平台审计（独立表、同事务写入、仅管理员读、1 年、完整 accountId + 掩码 target）：Task 3/5 ✓
- 状态语义（403 不泄露、fail-closed 503）：Task 5 ✓
- 机器契约边界（capability/admin/audit 操作）：Task 4/5 ✓

**2. Placeholder scan：** 无 TBD；关键接口签名已给出；所有 code 步骤有真实代码或精确镜像文件。

**3. Type consistency：** `isPlatformAdmin`/`grantPlatformAdmin`/`revokePlatformAdmin`/`listPlatformAdmins`/`countPlatformAdmins`/`bootstrapPlatformAdmins`/`insertPlatformAuditEvent`/`queryPlatformAuditEvents` 命名在 Task 2/3/5/6 一致；操作 ID 在 Task 4/5 一致；`PlatformAdminError` 在 Task 1/2/3 一致。

**缺陷修正：** 平台命令每次鉴权重读（不缓存）；`last_admin` 拒绝回滚不写审计；audit `target` 受约束不携带正文；`platform.resource-policies` coverage 在 Plan C 前保持 `unavailable`；bootstrap 只对存在的账号 seed。
