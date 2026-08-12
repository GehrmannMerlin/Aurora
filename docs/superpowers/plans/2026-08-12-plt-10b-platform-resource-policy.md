---
title: PLT-10b Platform Resource Policy Implementation Plan
status: approved
owner: platform
created: 2026-08-12
last-reviewed: 2026-08-12
applies-to: D2 平台资源策略管理的数据模型与命令——`@aurora/platform-policy` 数据包 + 生效策略/目标搜索/版本化命令机器契约 + platform-api handler
related:
  - ../../../AGENTS.md
  - ../../../AURORA_RULES.md
  - ../../architecture/platform-resource-policy-data-model.md
  - ../../security/platform-admin-and-platform-audit.md
  - ../../adr/ADR-035-platform-resource-policy-data-model.md
  - ../../adr/ADR-034-platform-admin-and-platform-audit.md
  - ../../superpowers/plans/2026-08-12-plt-10a-platform-admin-and-audit.md
  - ../../superpowers/specs/2026-07-30-aurora-platform-openapi-and-implementation-design.md
supersedes: none
design-stage: approved
---

# PLT-10b Platform Resource Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 D2 平台资源策略的完整后端：`@aurora/platform-policy` 数据包（三表最小分层策略 + 生效值/来源计算 + 目标搜索）、9 个稳定机器契约操作（TargetSearch + 三个生效策略 Query + 五个版本化 Command）、platform-api handler（复用 Plan A 的 `requirePlatformAdmin`），使平台管理员可真实配置默认/组织覆盖/项目上限。

**Architecture:** 沿用已批准最小分层策略（ADR-035 方案 A）：`platform_resource_policies`（平台默认单行，版本化）、`organization_policy_overrides`（每组织一行六项完整覆盖，版本化）、`project_policy_limits`（每项目一行仅 `resource_limit`，版本化）；无覆盖 = 继承。生效值由服务端只读计算（平台默认 → 组织覆盖 → 项目上限），"配置值/来源/生效值"三者分离。所有命令/查询经 Plan A 的 `requirePlatformAdmin` 门禁（403 不泄露、503 fail-closed），写命令 CSRF + 幂等 + 乐观版本 + 平台审计（`policy_set_*`/`policy_clear_*`，CHECK 已由 Plan A 覆盖）。

**Tech Stack:** TypeScript、PostgreSQL 17 + `pg` + node-pg-migrate、`@aurora/platform-admin`（requirePlatformAdmin + insertPlatformAuditEvent）、`@aurora/platform-contract`（9 操作 + OpenAPI 生成 + drift）、Fastify handler。

## Global Constraints

- 所有策略操作（含查询与目标搜索）只接受平台管理员：`requirePlatformAdmin` 门禁；非管理员统一 `403 authorization`，不泄露任何策略/目录/用量；Session/DB 权威不可用 → `503 authority_unavailable`（fail-closed）。
- 生效策略 = 平台默认 →（有覆盖时）组织完整覆盖 →（有项目上限时）项目 `resource_limit`；其余保护字段继承组织有效策略。
- 无覆盖 = 无行（继承）；组织覆盖保存即整体替换（版本化）；项目覆盖只含 `resource_limit`；"恢复平台默认/清除项目覆盖" = 删除行（独立确认 Command）。
- 每表 `version` int 乐观并发；版本不匹配 → `version_conflict`（页面展示服务端当前值并要求重新确认）。
- 配置值/来源/生效值三者分离呈现；来源取 `system_default`/`platform_admin`/继承来源。
- 传播状态由服务端权威返回；第一版**无数据面消费者** → 传播恒 `{ status: 'unknown', reason: 'no data-plane consumer yet' }`（页面不得宣称已全面生效）。
- 建议默认值（产品确认点，ADR-035 决策 6）：`defaultPeriodQuota` 100 万事件/月、`warningRatio` 80%、`hardLimit` 100%、`degradationEnabled` true、`highValueRetentionDays` 90 天；`resourceLimit` 无默认（项目覆盖可选项）。
- 服务端权威校验：单位、比例关系（`0 < warningRatio < hardLimit <= 100`）、上限组合、项目上限与组织策略关系；非法组合 → `field_validation` 稳定错误。
- 平台命令同事务写审计（`insertPlatformAuditEvent`，action `policy_set_default`/`policy_set_organization`/`policy_reset_organization`/`policy_set_project_limit`/`policy_clear_project_limit`）。
- 策略 GET 读操作写 `audit_read` 平台审计事件（`policyGetDefault`/`policyGetOrganizationEffective`/`policyGetProjectEffective` 三个读；镜像 Plan A 的 admin-list 读审计），**目标搜索 GET 例外**（轻量搜索会淹没平台审计时间线，故不审计）。
- 不实现组织自助、申请扩容、套餐、收费、购买、账单、欠费、商业升级、批量策略、动态成本优化或按功能售卖额度（PRD §15.10）。
- `platform.resource-policies` route-target coverage 保持 `unavailable`（Console D2 属 Plan C）；Plan A 的 manifest.ts D2-gate 豁免已覆盖本批操作。
- 不修改 ADR-034/035 决策；不修改 `@aurora/platform-admin` 的既有接口（requirePlatformAdmin/insertPlatformAuditEvent 沿用）。

## File Structure

新增（`@aurora/platform-policy` 数据包，`aurora.layer: data`，依赖仅 `pg`）：

- `packages/platform-policy/package.json`、`tsconfig.json`、`tsconfig.build.json`、`vitest.config.ts`、`README.md`
- `packages/platform-policy/migrations/1786700000011_platform-resource-policies.ts` — 平台默认（单行）
- `packages/platform-policy/migrations/1786700000012_organization-policy-overrides.ts` — 组织覆盖
- `packages/platform-policy/migrations/1786700000013_project-policy-limits.ts` — 项目上限
- `packages/platform-policy/src/errors.ts` — `PlatformPolicyError`
- `packages/platform-policy/src/run-migrations.ts`、`src/index.ts`
- `packages/platform-policy/src/policy-types.ts` — `PlatformPolicyFields`/`ResourceLimit`/`PolicySource`/生效投影类型
- `packages/platform-policy/src/effective-policy.ts` — `computeEffectivePolicy`（纯函数）
- `packages/platform-policy/src/repositories/default-policy.ts` — 平台默认 CRUD
- `packages/platform-policy/src/repositories/organization-override.ts` — 组织覆盖 Set/Reset
- `packages/platform-policy/src/repositories/project-limit.ts` — 项目上限 Set/Clear
- `packages/platform-policy/src/repositories/target-search.ts` — 目标搜索
- 测试：`packages/platform-policy/test/`（单测）、`test/integration/`（真实 PostgreSQL）

修改（契约 + handler + 文档）：

- `packages/platform-contract/src/resource-policy/resource-policy.ts`（新建）— 9 个操作
- `packages/platform-contract/src/registry/operations.ts` — 注册 9 操作
- `packages/platform-contract/src/index.ts` — 导出
- `packages/platform-contract/test/registry/manifest.test.ts` — 操作顺序 + coverage（`platform.resource-policies` 仍 `unavailable`）
- `packages/platform-contract/src/contract-testkit/samples.ts` + `index.ts` + `test/contract-testkit/samples.test.ts` — 样本
- `apps/platform-api/src/routes/resource-policy.ts`（新建）— 9 handler
- `apps/platform-api/src/app.ts` — 注册路由
- `apps/platform-api/package.json` — 加 `@aurora/platform-policy` 依赖
- 测试：`apps/platform-api/test/integration/resource-policy-flow.test.ts`（真实 PostgreSQL + Redis）

## 数据契约速查（9 新 operations，page 均 `platform.resource-policies`，tags `['usage-and-policy','platform-admin']`）

公共投影（GET 返回）：

```
PolicyTarget = { targetType: 'organization'|'project', targetId, name }
policyProjection = {
  configured: { defaultPeriodQuota, warningRatio, hardLimit, degradationEnabled, highValueRetentionDays }  // 或项目级 { resourceLimit }
  source: 'system_default'|'platform_admin'|'inherited_from_organization'|'inherited_from_platform',
  effective: { ...六项或子集 },   // 服务端计算的生效值
  version: num(0),               // 目标自身版本（0 = 无覆盖行）
  updatedAt?: utcTimestamp, updatedBy?: AccountId,
  propagation: { status: 'unknown', reason: 'no data-plane consumer yet' },
}
```

- `policyTargetSearch`(GET, query `{ q?: str(1,64), limit?: num(1,50) }`, admin) → `{ data: { organizations: [{organizationId, name}], projects: [{projectId, organizationId, name}], pagination: paginationMeta } }`
- `policyGetDefault`(GET, admin) → `queryResponse({ data: policyProjection })`
- `policyGetOrganizationEffective`(GET, path `:organizationId`, admin) → `queryResponse({ data: policyProjection })`
- `policyGetProjectEffective`(GET, path `:projectId`, admin) → `queryResponse({ data: policyProjection })`
- `policySetDefault`(POST, admin) → body `{ ...五字段, version: num(0), idempotencyKey }` → `{ data: { status:'set', version: num } }`
- `policySetOrganization`(POST, path `:organizationId`, admin) → body `{ ...五字段, version: num(0), idempotencyKey }` → `{ data: { status:'set', version: num } }`
- `policyResetOrganization`(POST, path `:organizationId`, admin) → body `{ version: num(0), confirm: bool(), idempotencyKey }` → `{ data: { status:'reset' } }`
- `policySetProjectLimit`(POST, path `:projectId`, admin) → body `{ resourceLimit: num(1), version: num(0), idempotencyKey }` → `{ data: { status:'set', version: num } }`
- `policyClearProjectLimit`(POST, path `:projectId`, admin) → body `{ version: num(0), confirm: bool(), idempotencyKey }` → `{ data: { status:'cleared' } }`

## Task 结构

### Task 1: `@aurora/platform-policy` 包脚手架 + 三个 Migration

**Files:**
- Create: `packages/platform-policy/package.json`、`tsconfig.json`、`tsconfig.build.json`、`vitest.config.ts`、`README.md`
- Create: `packages/platform-policy/migrations/1786700000011_platform-resource-policies.ts`、`1786700000012_organization-policy-overrides.ts`、`1786700000013_project-policy-limits.ts`
- Create: `packages/platform-policy/src/errors.ts`、`src/run-migrations.ts`
- Test: `packages/platform-policy/test/integration/migrations.integration.test.ts`

**Interfaces:**
- Produces: `PlatformPolicyError`（`kind: 'invalid_input'|'database_unavailable'|'statement_failed'`）；三个 Migration；`run-migrations.ts`。

- [ ] **Step 1: 包脚手架**

镜像 `packages/platform-admin/package.json`（名称 `@aurora/platform-policy`、`aurora.layer: data`、依赖仅 `pg`、scripts 同）。`errors.ts` 镜像 `packages/platform-admin/src/errors.ts`（→ `PlatformPolicyError`）。`run-migrations.ts` 镜像同包。

- [ ] **Step 2: 三个 Migration**

`1786700000011_platform-resource-policies.ts`：

```ts
import type { MigrationBuilder } from 'node-pg-migrate';
export const shorthands = undefined;
export const up = (pgm: MigrationBuilder): void => {
  pgm.createTable('platform_resource_policies', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    version: { type: 'int', notNull: true, default: 1 },
    default_period_quota: { type: 'numeric', notNull: true },
    warning_ratio: { type: 'numeric', notNull: true },
    hard_limit: { type: 'numeric', notNull: true },
    degradation_enabled: { type: 'boolean', notNull: true },
    high_value_retention_days: { type: 'int', notNull: true },
    policy_source: { type: 'varchar(24)', notNull: true, default: 'system_default', check: "policy_source IN ('system_default','platform_admin')" },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_by: { type: 'uuid', references: 'accounts' },
  });
  pgm.addConstraint('platform_resource_policies', 'ck_policy_ratio_order', {
    check: 'warning_ratio > 0 AND warning_ratio < hard_limit AND hard_limit <= 100',
  });
};
export const down = (pgm: MigrationBuilder): void => { pgm.dropTable('platform_resource_policies'); };
```

`1786700000012_organization-policy-overrides.ts`：`organization_policy_overrides(organization_id uuid PK references organizations, version int NOT NULL DEFAULT 1, 五字段同上, policy_source, created_at/updated_at/updated_by)` + 同一 ratio CHECK。

`1786700000013_project-policy-limits.ts`：`project_policy_limits(project_id uuid PK references projects, version int NOT NULL DEFAULT 1, resource_limit numeric NOT NULL CHECK (resource_limit > 0), policy_source, created_at/updated_at/updated_by)`。

- [ ] **Step 3: 迁移集成测试**

`migrations.integration.test.ts`：连接 `AURORA_TEST_DATABASE_URL`（`/aurora_inbox_test` 守卫），跑本包 migration，断言三表存在、单行约束（重复 `organization_id`/`project_id` 冲突）、ratio CHECK 冲突。

Run: `pnpm --filter @aurora/platform-policy exec vitest run test/integration/migrations.integration.test.ts --no-file-parallelism`
Expected: PASS

- [ ] **Step 4: Commit**

### Task 2: 策略 Repository（默认/组织/项目 CRUD + 生效纯函数）

**Files:**
- Create: `packages/platform-policy/src/policy-types.ts`、`src/effective-policy.ts`
- Create: `packages/platform-policy/src/repositories/default-policy.ts`、`organization-override.ts`、`project-limit.ts`
- Modify: `packages/platform-policy/src/index.ts`
- Test: `packages/platform-policy/test/effective-policy.test.ts`（单测）、`test/integration/policy-repository.integration.test.ts`

**Interfaces:**
- Produces（全部原始 SQL + `PlatformPolicyError` 包装）：
  - `getPlatformDefaultPolicy(pool)` → `PlatformDefaultPolicy | null`（`{ defaultPeriodQuota, warningRatio, hardLimit, degradationEnabled, highValueRetentionDays, policySource, version, updatedBy?, updatedAt }`）
  - `setPlatformDefaultPolicy(pool, input: { ...五字段; expectedVersion: number; actorAccountId: string })` → `{ status:'set', version } | { status:'version_conflict' } | { status:'temporarily_unavailable' }`（无行 → INSERT version 1；有行 → `UPDATE ... WHERE version = expectedVersion`，0 行 → conflict；`policy_source = 'platform_admin'`）
  - `getOrganizationOverride(pool, { organizationId })` → `OrganizationOverride | null`
  - `setOrganizationOverride(pool, input: { organizationId; ...五字段; expectedVersion: number; actorAccountId })` → `{ status:'set', version } | { status:'version_conflict' } | { status:'organization_not_found' } | { status:'temporarily_unavailable' }`（expectedVersion 0 = 无覆盖 → INSERT；>0 = UPDATE 校验）
  - `resetOrganizationOverride(pool, input: { organizationId; expectedVersion: number; actorAccountId })` → `{ status:'reset' } | { status:'version_conflict' } | { status:'temporarily_unavailable' }`（无行 → reset 视为成功；有行校验 version 后 DELETE）
  - `getProjectLimit(pool, { projectId })` → `ProjectLimit | null`
  - `setProjectLimit(pool, input: { projectId; resourceLimit; expectedVersion: number; actorAccountId })`、`clearProjectLimit(pool, input: { projectId; expectedVersion; actorAccountId })`（同组织模式）
  - `computeEffectivePolicy(input: { defaultPolicy: PlatformDefaultPolicy | null; orgOverride: OrganizationOverride | null; projectLimit: ProjectLimit | null })` → `{ configured; source; effective }`（纯函数：项目 `resource_limit` 覆盖 + 其余继承；org 覆盖继承默认；无默认时返回 `null` = 平台默认未配置）
  - 注：`bootstrapPlatformDefaultIfAbsent(pool, { actorAccountId })` — 若无默认行则用 ADR-035 建议默认值 INSERT（`policy_source='system_default'`），保证 `policyGetDefault` 恒有值。

- [ ] **Step 1: 写失败单测（生效纯函数）**

`effective-policy.test.ts`：默认+无覆盖 → source system_default；org 覆盖 → source platform_admin（effective 用覆盖值）；项目 limit → resource_limit 覆盖 + 其余继承 org；无默认 → null。

- [ ] **Step 2: 实现 `policy-types.ts` + `effective-policy.ts`**

`PlatformPolicyFields = { defaultPeriodQuota: number; warningRatio: number; hardLimit: number; degradationEnabled: boolean; highValueRetentionDays: number }`；`PolicySource = 'system_default'|'platform_admin'|'inherited_from_organization'|'inherited_from_platform'`。`computeEffectivePolicy` 纯函数按上述规则。

- [ ] **Step 3: 写失败集成测试**

`policy-repository.integration.test.ts`：建测试账号/org/project；断言 default set/get/version_conflict；org set/reset/version；project set/clear/version；`bootstrapPlatformDefaultIfAbsent` 幂等。

- [ ] **Step 4: 实现三个 Repository + index 导出**

原始 SQL；乐观版本用 `UPDATE ... WHERE version = $n`；INSERT 用 `ON CONFLICT DO NOTHING` + 重读或 `RETURNING`；错误包装 `PlatformPolicyError`。

- [ ] **Step 5: 运行通过 + Commit**

Run: `pnpm --filter @aurora/platform-policy exec vitest run` 与 `test/integration --no-file-parallelism`
Expected: PASS

### Task 3: 目标搜索 Repository

**Files:**
- Create: `packages/platform-policy/src/repositories/target-search.ts`
- Test: `packages/platform-policy/test/integration/target-search.integration.test.ts`

**Interfaces:**
- Consumes: 无（独立表查询）。
- Produces: `searchPolicyTargets(pool, input: { query?: string; limit?: number })` → `{ organizations: readonly { organizationId; name }[]; projects: readonly { projectId; organizationId; name }[] }`（按名称 ILIKE 前缀匹配，bounded `limit` 默认 25 上限 50；只返回 `kind='organization'` 的组织与 `status IN ('active','archived')` 的项目）

- [ ] **Step 1: 失败测试** → **Step 2: 实现** → **Step 3: 通过 + Commit**（镜像 Task 2 模式）

### Task 4: 机器契约操作（9 个）

**Files:**
- Create: `packages/platform-contract/src/resource-policy/resource-policy.ts`
- Modify: `packages/platform-contract/src/registry/operations.ts`、`src/index.ts`
- Modify: `packages/platform-contract/test/registry/manifest.test.ts`、`src/contract-testkit/samples.ts`/`index.ts`、`test/contract-testkit/samples.test.ts`

**Interfaces:**
- Consumes: 无（独立 schema）。
- Produces: 9 操作 ID + 请求/响应/路径/查询 schema（见"数据契约速查"）。

- [ ] **Step 1: 定义操作文件**

镜像 `packages/platform-contract/src/platform-admin/platform-admin.ts`。核心：

```ts
export const OPERATION_ID_POLICY_TARGET_SEARCH = 'policyTargetSearch' as const;
export const OPERATION_ID_POLICY_GET_DEFAULT = 'policyGetDefault' as const;
export const OPERATION_ID_POLICY_GET_ORGANIZATION = 'policyGetOrganizationEffective' as const;
export const OPERATION_ID_POLICY_GET_PROJECT = 'policyGetProjectEffective' as const;
export const OPERATION_ID_POLICY_SET_DEFAULT = 'policySetDefault' as const;
export const OPERATION_ID_POLICY_SET_ORGANIZATION = 'policySetOrganization' as const;
export const OPERATION_ID_POLICY_RESET_ORGANIZATION = 'policyResetOrganization' as const;
export const OPERATION_ID_POLICY_SET_PROJECT_LIMIT = 'policySetProjectLimit' as const;
export const OPERATION_ID_POLICY_CLEAR_PROJECT_LIMIT = 'policyClearProjectLimit' as const;

const policyFields = obj({ defaultPeriodQuota: num(1), warningRatio: num(1,100), hardLimit: num(1,100), degradationEnabled: bool(), highValueRetentionDays: num(1) });
const projectLimitField = obj({ resourceLimit: num(1) });
const propagation = obj({ status: enum_(['unknown']), reason: str(1,128) });
const policyProjection = obj({
  configured: policyFields,          // 或 projectLimitField（项目级）
  source: str(1,40),
  effective: policyFields,           // 或 projectLimitField
  version: num(0),
  updatedAt: optional(utcTimestamp),
  updatedBy: optional(AccountId),
  propagation,
});
export const policyTargetSearchQuery = obj({ q: optional(str(1,64)), limit: optional(num(1,50)) });
export const policyTargetSearchResponse = queryResponse(obj({ organizations: arr(obj({ organizationId: OrganizationId, name: str(1,128) }), 0, 50), projects: arr(obj({ projectId: ProjectId, organizationId: OrganizationId, name: str(1,128) }), 0, 50), pagination: paginationMeta }));
export const policyGetDefaultResponse = queryResponse(obj({ data: policyProjection }));
export const policyGetOrganizationEffectivePathParams = obj({ organizationId: OrganizationId });
export const policyGetOrganizationEffectiveResponse = queryResponse(obj({ data: policyProjection }));
export const policyGetProjectEffectivePathParams = obj({ projectId: ProjectId });
export const policyGetProjectEffectiveResponse = queryResponse(obj({ data: policyProjection }));
export const policySetDefaultBody = obj({ ...policyFields, version: num(0), idempotencyKey: str(8,128) });
export const policySetDefaultResponse = obj({ data: obj({ status: enum_(['set']), version: num(0) }) });
export const policySetOrganizationPathParams = obj({ organizationId: OrganizationId });
export const policySetOrganizationBody = obj({ ...policyFields, version: num(0), idempotencyKey: str(8,128) });
export const policySetOrganizationResponse = obj({ data: obj({ status: enum_(['set']), version: num(0) }) });
export const policyResetOrganizationPathParams = obj({ organizationId: OrganizationId });
export const policyResetOrganizationBody = obj({ version: num(0), confirm: bool(), idempotencyKey: str(8,128) });
export const policyResetOrganizationResponse = obj({ data: obj({ status: enum_(['reset']) }) });
export const policySetProjectLimitPathParams = obj({ projectId: ProjectId });
export const policySetProjectLimitBody = obj({ ...projectLimitField, version: num(0), idempotencyKey: str(8,128) });
export const policySetProjectLimitResponse = obj({ data: obj({ status: enum_(['set']), version: num(0) }) });
export const policyClearProjectLimitPathParams = obj({ projectId: ProjectId });
export const policyClearProjectLimitBody = obj({ version: num(0), confirm: bool(), idempotencyKey: str(8,128) });
export const policyClearProjectLimitResponse = obj({ data: obj({ status: enum_(['cleared']) }) });
```

- [ ] **Step 2: 注册 + 解冻**

`registry/operations.ts` 追加 9 操作（GET `csrf:false, idempotency:false`；POST `csrf:true, idempotency:true`）；page 均 `platform.resource-policies`（Plan A 的 manifest D2-gate 豁免已覆盖）；不触碰 `BLOCKED_OPERATIONS`；`src/index.ts` `export * from './resource-policy/resource-policy.js'`。

- [ ] **Step 3: OpenAPI 生成 + drift**

Run: `pnpm platform-contract:generate && pnpm platform-contract:drift`
Expected: drift PASS

- [ ] **Step 4: manifest/samples 测试更新**

`manifest.test.ts` 稳定操作顺序追加 9 个 ID（coverage 冻结不变）；`samples.ts` 加 `validPolicy*Samples`（queryResponse 样本含 meta/allowedActions/navigationTargets；命令样本含 data），`samples.test.ts` 接线。

- [ ] **Step 5: 运行 contract 测试 + 重建 + Commit**

Run: `pnpm --filter @aurora/platform-contract exec vitest run`（PASS）+ `pnpm --filter @aurora/platform-contract build`

### Task 5: platform-api handler（9 个）+ 注册

**Files:**
- Create: `apps/platform-api/src/routes/resource-policy.ts`
- Modify: `apps/platform-api/src/app.ts`、`apps/platform-api/package.json`
- Test: `apps/platform-api/test/integration/resource-policy-flow.test.ts`

**Interfaces:**
- Consumes: Task 2/3 Repository、Task 4 操作、Plan A `requirePlatformAdmin`/`insertPlatformAuditEvent`。
- Produces: 9 handler。

- [ ] **Step 1: 写失败集成测试**

`resource-policy-flow.test.ts`（真实 PG + Redis）：`bootstrapPlatformAdmins` 建管理员 bob + `registerVerifiedActor` 建非管理员 alice。断言：alice 访问 `policyGetDefault` → 403 不泄露；bob 默认策略生效（bootstrap 后 available）；bob `policySetDefault` → 200 + `policy_set_default` 审计；`policySetOrganization`/`policySetProjectLimit` → 200 + 审计；版本陈旧 → `version_conflict`（409/422）；`policyResetOrganization`/`policyClearProjectLimit`（confirm）→ 200 + 审计；`policyTargetSearch` 按名搜索 org/project；org 覆盖后 `policyGetProjectEffective` 的 `resourceLimit` 生效 + 其余继承；非法比例（warningRatio >= hardLimit）→ `field_validation`。

- [ ] **Step 2: 运行确认失败**

Expected: FAIL（路由未实现）

- [ ] **Step 3: 实现 9 handler + 注册**

镜像 `apps/platform-api/src/routes/platform-admin.ts`（`parseInput`+`serializeOutput` / `runIdempotentCommand` + 事务内 `insertPlatformAuditEvent`）。GET 用 `requirePlatformAdmin`；三个生效策略 GET 写 `audit_read`（存在性检查先于审计写，phantom-org/project 404 不产生审计事件），**目标搜索 GET 不审计（flood-avoidance）**；POST 命令在幂等事务内写审计（action 按命令映射）；`version_conflict` → `ServiceError(409,'version_conflict',...)`；非法配置 → `ServiceError(422,'field_validation',...)`。org/project 生效 GET 在读取平台默认前先执行受控 bootstrap（`bootstrapPlatformDefaultIfAbsent`，幂等），保证空环境深链可用。`app.ts` 注册 9 路由；`package.json` 加 `"@aurora/platform-policy": "workspace:*"`。

- [ ] **Step 4: 运行集成测试 + typecheck**

Run: `AURORA_TEST_DATABASE_URL=... AURORA_TEST_REDIS_URL=... pnpm --filter @aurora/platform-api exec vitest run test/integration/resource-policy-flow.test.ts --no-file-parallelism`
Expected: PASS

- [ ] **Step 5: Commit**

### Task 6: 质量门禁 + 文档同步

**Files:**
- Modify: `AGENTS.md`、`AURORA_RULES.md`

- [ ] **Step 1: 全量 targeted 验证**

Run:
- `pnpm --filter @aurora/platform-policy exec vitest run`
- `pnpm --filter @aurora/platform-policy exec vitest run test/integration --no-file-parallelism`
- `pnpm --filter @aurora/platform-contract exec vitest run`
- `pnpm platform-contract:drift`
- `pnpm --filter @aurora/platform-api exec vitest run test/integration/resource-policy-flow.test.ts --no-file-parallelism`
- `pnpm --filter @aurora/platform-api exec tsc -p tsconfig.json --noEmit`
Expected: 全 PASS

- [ ] **Step 2: ledger 同步**

`AGENTS.md`/`AURORA_RULES.md` G13 条目：PLT-10b（`@aurora/platform-policy` 数据包 + 9 操作 + handler）implemented-in-feature-branch；`platform.resource-policies` coverage 仍 `unavailable`（Console D2 属 Plan C）；计数不提前加。

- [ ] **Step 3: git diff --check + Commit**

## Self-Review

**1. Spec coverage（ADR-035 / platform-resource-policy-data-model spec）：**
- 三表最小分层 + 无覆盖继承：Task 1/2 ✓
- 组织完整覆盖、项目仅资源上限：Task 2 ✓
- 版本化乐观并发 + `version_conflict`：Task 2/5 ✓
- 配置值/来源/生效值分离：Task 2 `computeEffectivePolicy` + Task 4 投影 ✓
- 传播状态恒 unknown（无数据面消费者）：Global Constraints + Task 4 ✓
- PRD §15.8 六字段 + 建议默认值：Task 1/2/4 ✓
- 目标搜索、三个生效 Query、五个 Command：Task 3/4/5 ✓
- 平台管理员门禁 + 平台审计：Task 5（复用 Plan A）✓
- 不收费/组织自助：Global Constraints ✓

**2. Placeholder scan：** 无 TBD；操作/schema/签名完整给出。

**3. Type consistency：** `PlatformPolicyFields`/`PolicySource`/`computeEffectivePolicy` 在 Task 2/4/5 一致；操作 ID 在 Task 4/5 一致；`requirePlatformAdmin`/`insertPlatformAuditEvent` 复用 Plan A 签名。

**缺陷修正：** 生效值由服务端计算（不缓存）；`version_conflict` 不静默覆盖；传播恒 unknown 不宣称生效；建议默认值为产品确认点；`platform.resource-policies` coverage 在 Plan C 前保持 unavailable。
