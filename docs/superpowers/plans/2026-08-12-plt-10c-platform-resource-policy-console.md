---
title: PLT-10c Platform Resource Policy Console D2 UI Implementation Plan
status: approved
owner: platform
created: 2026-08-12
last-reviewed: 2026-08-12
applies-to: Console `platform.resource-policies` 页面（D2 平台资源策略管理）——目标搜索 + 生效策略视图 + 版本化命令表单 + 来源/传播展示 + 能力门禁
related:
  - ../../../AGENTS.md
  - ../../../AURORA_RULES.md
  - ../../architecture/platform-resource-policy-data-model.md
  - ../../security/platform-admin-and-platform-audit.md
  - ../../adr/ADR-035-platform-resource-policy-data-model.md
  - ../../adr/ADR-034-platform-admin-and-platform-audit.md
  - ../../superpowers/plans/2026-08-12-plt-10b-platform-resource-policy.md
  - ../../superpowers/plans/2026-08-12-plt-10a-platform-admin-and-audit.md
  - ../../superpowers/specs/2026-07-27-aurora-frontend-ux-ui-design.md
supersedes: none
design-stage: approved
---

# PLT-10c Platform Resource Policy Console D2 UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 Console `platform.resource-policies`（D2 平台资源策略管理）真实页面：平台默认/组织/项目三目标选择与授权搜索、生效策略（配置值/来源/生效值/版本/传播）只读展示、五个版本化命令表单（Set/Reset/Clear + 独立确认），并接入平台管理员能力门禁。

**Architecture:** 只消费 Plan B 的 9 个公开机器操作 + Plan A 的 `platformAdminGetCapability`。页面为 `account`/`platform` 作用域：能力探针决定 `forbidden` 或进入目标管理；目标搜索（`policyTargetSearch`）服务端授权查找组织/项目；三个生效 Query（default/org/project）展示分离的配置值/来源/生效值；五个 Command（Set/Reset/Clear）带乐观版本 + CSRF + 幂等 + 独立确认。无 DB 直连、无前端求值、无 fake 数据（MSW 仅测试 fixture）。`platform.resource-policies` coverage 转 `stable`（本计划即 Console D2 UI 落地），manifest D2-gate 豁免移除。

**Tech Stack:** Vue 3 SFC、`@aurora/platform-contract`（client）、`apps/console` 既有 `monitoring/` adapter + `section.ts`、Pinia、MSW、Playwright Chromium。

## Global Constraints

- 页面只经公开 API：`platformAdminGetCapability`（能力）、`policyTargetSearch`、`policyGetDefault`/`policyGetOrganizationEffective`/`policyGetProjectEffective`、`policySetDefault`/`policySetOrganization`/`policyResetOrganization`/`policySetProjectLimit`/`policyClearProjectLimit`。
- 非平台管理员：能力探针 `hasCapability=false` → 页面 `forbidden`（不渲染任何策略/目录/表单；不显示"无权限"以外的策略信息）。
- 配置值/来源/生效值三者分离展示；不得把继承值伪装成目标自身保存值；来源取 `system_default`/`platform_admin`/`inherited_from_organization`/`inherited_from_platform`。
- 传播状态恒 `unknown`（无数据面消费者）：如实展示"传播状态未知/未确认"，绝不宣称已全面生效。
- 版本化乐观并发：命令提交带当前 `version`；`version_conflict` → 展示服务端当前值并要求重新确认（不合并旧草稿）。
- 降低上限、启用降级、改变最低保留策略、Reset/Clear → 显式独立确认（`confirm: true`）；不预测事件数/删除量。
- 前端只做公开契约能表达的基础校验；单位/比例/上下限由服务端权威校验（`field_validation` 就地显示）。
- 目标搜索服务端授权：不加载/暴露无关完整目录。
- `platform.resource-policies` coverage：本计划将其从 `unavailable` 转为 `stable`（移除 manifest.ts D2-gate 豁免），`manifest.test.ts` coverage 冻结更新。
- 不实现收费/组织自助/套餐/商业升级（PRD §15.10）；无 fake 生产数据（MSW 仅测试 fixture）。

## File Structure

新增（console）：

- `apps/console/src/views/platform/ResourcePolicyView.vue` — D2 页面
- `apps/console/src/views/platform/resource-policy-view-model.ts` — view-model（目标选择 + 投影映射 + 命令阶段 + 确认状态）
- `apps/console/src/views/platform/resource-policy-format.ts` — 来源/传播/数字格式化（如 `formatCount`）
- `apps/console/test/views/platform/resource-policy-view-model.test.ts` — view-model 单测
- `apps/console/test/monitoring/resource-policy-commands.test.ts` — 命令 client 单测
- `apps/console/test-browser/g13-resource-policy-smoke.spec.ts` — Chromium smoke

修改（console）：

- `apps/console/src/monitoring/queries.ts` — `fetchPlatformAdminCapability` + `fetchPolicyTargetSearch` + `fetchPolicyGetDefault`/`fetchPolicyGetOrganizationEffective`/`fetchPolicyGetProjectEffective`（scope `{ type: 'account' }`）
- `apps/console/src/monitoring/commands.ts` — `setPolicyDefault`/`setPolicyOrganization`/`resetPolicyOrganization`/`setPolicyProjectLimit`/`clearPolicyProjectLimit`（CSRF + idempotency + `confirm`）
- `apps/console/src/contracts/route-registry.ts` — `platform.resource-policies` → 真实组件（lazy `resourcePolicyView`）；`unavailableReason: null`
- `apps/console/src/components/shell/TopBar.vue` / `LayeredSidebar.vue` — 如需暴露入口（D2 仅平台管理员；`menu` 可保持 false，由导航直达；若侧栏需显示管理员入口，用能力门禁）
- `apps/console/src/mocks/handlers.ts` — capability + 9 个 policy 操作 handler
- `apps/console/test/contracts/route-registry.test.ts` — `platform.resource-policies` 加入 realViewRoutes

修改（契约 manifest）：

- `packages/platform-contract/src/registry/manifest.ts` — 移除 `platform.resource-policies` D2-gate 豁免（本计划落地 D2 UI）
- `packages/platform-contract/test/registry/manifest.test.ts` — coverage `platform.resource-policies: 'unavailable'` → `'stable'`
- `pnpm platform-contract:generate && pnpm platform-contract:drift`

## 数据契约速查（console 消费）

- `platformAdminGetCapability`(session) → `{ hasCapability: boolean }`
- `policyTargetSearch`(query `{ q?, limit? }`) → `{ organizations: [{organizationId, name}], projects: [{projectId, organizationId, name}], pagination }`
- `policyGetDefault` → `{ configured, source, effective, version, updatedAt?, updatedBy?, propagation }`（configured/effective 五字段）
- `policyGetOrganizationEffective`(path `:organizationId`) → 同上
- `policyGetProjectEffective`(path `:projectId`) → `{ configured: { resourceLimit? }, source, effective: { 五字段, resourceLimit? }, version, ... }`
- `policySetDefault`(body `{ 五字段, version, idempotencyKey }`) → `{ data: { status:'set', version } }`
- `policySetOrganization`(path `:organizationId`, body 同上) → 同上
- `policyResetOrganization`(path `:organizationId`, body `{ version, confirm, idempotencyKey }`) → `{ data: { status:'reset' } }`
- `policySetProjectLimit`(path `:projectId`, body `{ resourceLimit, version, idempotencyKey }`) → `{ data: { status:'set', version } }`
- `policyClearProjectLimit`(path `:projectId`, body `{ version, confirm, idempotencyKey }`) → `{ data: { status:'cleared' } }`

## Task 结构

### Task 1: monitoring queries + commands

**Files:**
- Modify: `apps/console/src/monitoring/queries.ts`、`commands.ts`
- Test: `apps/console/test/monitoring/resource-policy-commands.test.ts`

**Interfaces:**
- Consumes: `@aurora/platform-contract` 操作 ID（Plan B）+ `executeQuery`/`createIdempotencyKey`。
- Produces: `fetchPlatformAdminCapability()` → `{ hasCapability: boolean }`；`fetchPolicyTargetSearch({q?, limit?})` → 目标结果；三个 `fetchPolicyGet*` → 投影；五个 `setPolicy*`/`resetPolicy*`/`clearPolicy*`（CSRF + idempotencyKey + `confirm`）。

- [ ] **Step 1: 写失败命令测试**

`resource-policy-commands.test.ts`（镜像 `notifications-commands.test.ts`，mock `executeQuery`）：断言 `setPolicyDefault` 调 `policySetDefault`、body 含五字段 + `version` + `idempotencyKey`、scope `{type:'account'}`；`resetPolicyOrganization` body 含 `confirm:true`；`setPolicyProjectLimit` body 含 `resourceLimit`。

- [ ] **Step 2: 实现 queries.ts**

`fetchPlatformAdminCapability`（scope `{type:'account'}`，无 body）；`fetchPolicyTargetSearch`；三个 `fetchPolicyGet*`（path params org/project）；返回 `.data`。类型镜像 Plan B 契约（`PlatformPolicyProjection`/`ProjectPolicyProjection`/`PolicyTarget`）。

- [ ] **Step 3: 实现 commands.ts**

五个命令（scope `{type:'account'}`，csrf + fresh idempotencyKey；reset/clear 传 `confirm`）。

- [ ] **Step 4: 运行通过 + Commit**

Run: `pnpm --filter @aurora/console exec vitest run test/monitoring/resource-policy-commands.test.ts`
Expected: PASS

### Task 2: view-model

**Files:**
- Create: `apps/console/src/views/platform/resource-policy-view-model.ts`、`resource-policy-format.ts`
- Test: `apps/console/test/views/platform/resource-policy-view-model.test.ts`

**Interfaces:**
- Consumes: Task 1 类型。
- Produces: `buildResourcePolicyView(source)` → `ResourcePolicyViewState`（`capability: 'checking'|'forbidden'|'ready'`；`target: 'default'|{type:'organization'|'project', id, name}`；`projection: SectionView<PolicyProjection>`；`commandPhase`；`version`；`stale/conflict` 状态）；`policySourceLabel`/`formatConfigValue`。

- [ ] **Step 1: 写失败单测**

`resource-policy-view-model.test.ts`：capability false → forbidden（不渲染投影）；capability true → ready；projection available/empty/unavailable 映射；`inherited_from_*` 来源标签；`version_conflict` → conflict 状态（展示服务端当前值要求重确认）。

- [ ] **Step 2: 实现 view-model**

纯函数：capability → 门禁；目标选择（default / org / project，project 显示自身 `resourceLimit` 覆盖 + 其余继承）；投影 → `SectionView`；命令阶段（`idle|submitting|error`）；来源/传播格式化。

- [ ] **Step 3: 运行通过 + Commit**

### Task 3: D2 视图 + 路由接线 + 能力门禁

**Files:**
- Create: `apps/console/src/views/platform/ResourcePolicyView.vue`
- Modify: `apps/console/src/contracts/route-registry.ts`（`platform.resource-policies` → `resourcePolicyView`，`unavailableReason: null`）
- Modify: `packages/platform-contract/src/registry/manifest.ts`（移除 D2-gate 豁免）、`packages/platform-contract/test/registry/manifest.test.ts`（coverage → stable）
- Test: `apps/console/test/contracts/route-registry.test.ts`（`platform.resource-policies` 入 realViewRoutes）

**Interfaces:**
- Consumes: Task 1/2。
- Produces: D2 页面（目标选择 + 生效策略展示 + 命令表单 + 确认流）。

- [ ] **Step 1: 移除 manifest D2-gate 豁免 + 更新 coverage**

`manifest.ts` 移除 `platform.resource-policies` 的 stable-derivation 豁免；`manifest.test.ts` coverage 冻结 `'unavailable'` → `'stable'`；`pnpm platform-contract:generate && pnpm platform-contract:drift`（PASS）。

- [ ] **Step 2: 实现 `ResourcePolicyView.vue`**

镜像 `NotificationsView.vue` 结构。核心：
- 挂载时 `fetchPlatformAdminCapability` → forbidden/ready。
- 目标选择：默认（恒可）+ 组织/项目（`policyTargetSearch` 按名搜索，select 列表）。
- 生效策略展示：`configured`/`source`/`effective`/`version`/`propagation`（`propagation.status='unknown'` 如实展示）；项目显示自身 `resourceLimit` 覆盖 + 组织继承来源。
- 默认/组织编辑表单（五字段）+ 保存（带 version）；项目上限编辑（`resourceLimit`）+ 保存。
- Reset/Clear：独立确认对话框（`confirm: true`）；降低上限/启用降级/改变保留 → 显式确认。
- `version_conflict` → 重新查询服务端当前值 + 提示刷新；`field_validation` → 就地显示。

- [ ] **Step 3: 路由接线 + typecheck**

`route-registry.ts` `platform.resource-policies` → lazy `resourcePolicyView`；`unavailableReason: null`。`pnpm --filter @aurora/console exec vue-tsc --noEmit -p tsconfig.json`（PASS）。

- [ ] **Step 4: Commit**

### Task 4: MSW handlers

**Files:**
- Modify: `apps/console/src/mocks/handlers.ts`

**Interfaces:**
- Consumes: Task 1 操作。
- Produces: capability + 9 个 policy 操作 mock（测试 fixture only）。

- [ ] **Step 1: 实现 mock**

`GET /api/platform/v1/platform-admin/capability` → `{ data: { hasCapability: true } }`（test 模式默认管理员）；`GET /platform-admin/policy/targets`（按 q 过滤 mock 组织/项目）；三个生效 GET 返回 fixture 投影；五个 POST 返回 `{ data: { status, version } }`。镜像 `mockNotifications()` 结构。

- [ ] **Step 2: Commit**

### Task 5: 测试（view-model/commands/route-registry/smoke）

**Files:**
- Create: `apps/console/test-browser/g13-resource-policy-smoke.spec.ts`
- Modify: `apps/console/test/contracts/route-registry.test.ts`

**Interfaces:**
- Consumes: 全计划产出。

- [ ] **Step 1: Chromium smoke**

`g13-resource-policy-smoke.spec.ts`（镜像 `g13-notifications-smoke.spec.ts`）：正常导航 → `/platform/resource-policies` → 能力探针 → 目标选择可见 → 默认策略生效展示可见 → 无 fatal error、无 `capability-not-provided`。

Run: `cd apps/console && npx playwright test --config playwright.config.ts test-browser/g13-resource-policy-smoke.spec.ts`
Expected: PASS

- [ ] **Step 2: 预算单测**

`pnpm --filter @aurora/console exec vitest run test/views/platform/resource-policy-view-model.test.ts test/monitoring/resource-policy-commands.test.ts test/contracts/route-registry.test.ts`
Expected: PASS

### Task 6: 质量门禁 + 文档同步

**Files:**
- Modify: `AGENTS.md`、`AURORA_RULES.md`

- [ ] **Step 1: 全量 targeted 验证**

Run: `pnpm --filter @aurora/console exec vue-tsc --noEmit -p tsconfig.json`、`pnpm --filter @aurora/console build`（生产构建）、`pnpm --filter @aurora/console exec vitest run test/views/platform test/monitoring/resource-policy-commands.test.ts test/contracts/route-registry.test.ts`、`pnpm platform-contract:drift`、Chromium smoke、`git diff --check`。Expected: 全 PASS。

- [ ] **Step 2: ledger 同步**

`AGENTS.md`/`AURORA_RULES.md` G13 条目：PLT-10c（Console D2 页面 + 9 操作消费 + 能力门禁）implemented-in-feature-branch；`platform.resource-policies` coverage 转 `stable`（D2 UI 已落地）；**计数提前**：Plan A/B/C 三叶子各自独立验收后一并关闭（completed 69→70 / remaining 9→8，如三计划均独立验收通过）。

- [ ] **Step 3: git diff --check + Commit**

## Self-Review

**1. Spec coverage（UX/UI §8.31 / platform-resource-policy-data-model spec）：**
- 目标选择区（平台默认/组织/项目 + 授权搜索）：Task 1/2/3 ✓
- 生效策略摘要（目标身份/来源/生效值/版本/更新时间；项目显示组织来源 + 自身覆盖）：Task 2/3 ✓
- 平台默认/组织覆盖/项目上限编辑 + 恢复默认/清除覆盖独立确认：Task 2/3 ✓
- 配置值/来源/生效值分离 + 继承来源展示：Task 2/3 ✓
- 传播恒 unknown 不宣称生效：Task 2/3 ✓
- 保存前影响说明 + 收紧显式确认：Task 3 ✓
- 状态语义（loading/empty/error/forbidden/partial/stale-conflict/unavailable/inherited）：Task 2/3 ✓
- 能力门禁（非管理员 forbidden 不泄露）：Task 3 ✓
- `platform.resource-policies` coverage 转 stable（D2 UI 落地）：Task 3 ✓

**2. Placeholder scan：** 无 TBD；操作/类型/页面结构完整给出。

**3. Type consistency：** `PolicyProjection`/`ProjectPolicyProjection`/`PolicyTarget` 在 Task 1/2/3 一致；命令名在 Task 1/3 一致；`fetchPlatformAdminCapability` 在 Task 1/3 一致。

**缺陷修正：** 能力门禁不渲染策略信息；`version_conflict` 重新确认不合并草稿；传播恒 unknown 不宣称生效；目标搜索服务端授权；MSW 仅测试 fixture。
