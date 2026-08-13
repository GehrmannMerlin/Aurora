# DAT-21 Usage / Quota / Degradation Aggregate and Projection Implementation Plan

> **For agentic workers:** This plan is executed INLINE by the main session (user override: no subagents, no executing-plans skill). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立真实组织周期资源用量聚合、额度状态、降级投影与 `usageGetSummary` 查询（PRD §15），全部基于真实处理数据，无采样外推、无收费。

**Architecture:** 在 `@aurora/platform-contract` 增加 `usage-and-policy/usage.ts`（`UsageStage`/`degradeForUsageRatio` 纯模型 + `usageGetSummary` schema + `DEFAULT_ORGANIZATION_QUOTA`）；`usageGetSummary` 从 `BLOCKED_OPERATIONS` 移入稳定操作，重新生成 Platform OpenAPI；`apps/platform-api` 新增 org 级 GET handler（org manager 授权，按 org 项目汇总 `queryProjectInboxDiagnostics`（accepted）与 `queryProjectQueryableEvidence`（processed）真实数据，`degradeForUsageRatio` 投影降级档）。

**Tech Stack:** TypeScript（NodeNext ESM）、@aurora/platform-contract（schema 构建器）、Fastify、vitest。

## Global Constraints

- 不做收费/套餐/账单/欠费（PRD §15.1）；控制台使用"资源用量"，不使用收费术语。
- 只统计真实处理数据，禁止采样外推；性能/慢请求样本计数当前 `unavailable`（不伪造 0）。
- 固定降级顺序（PRD §15.5）：normal → near-limit(80%) → degraded → hard-limit(100%)。
- 额度为免费额度占位（D2/G13 平台管理员配置后续替换）。
- 测试预算（用户限定）：degradation 纯函数单测、contract 漂移/OpenAPI 门禁、platform-api handler 测试、affected typecheck、`git diff --check`。禁止 root check/coverage、完整 PG suite、浏览器。

---

### Task 1: 用量/额度/降级纯模型 + usageGetSummary 契约
- `packages/platform-contract/src/usage-and-policy/usage.ts`：`UsageStage`、`DEFAULT_DEGRADATION_THRESHOLDS`（0.8/0.9/1.0）、`degradeForUsageRatio`、`DEFAULT_ORGANIZATION_QUOTA`（1,000,000）、`usageGetSummaryPathParams`/`usageGetSummaryResponse` schema、`OPERATION_ID_GET_USAGE_SUMMARY`；`src/index.ts` 导出。
- `src/registry/operations.ts`：import + 稳定操作（GET `/api/platform/v1/organizations/:organizationId/usage`，page `organization.usage`）+ 从 `BLOCKED_OPERATIONS` 移除。
- `pnpm platform-contract:generate` 重新生成 OpenAPI；漂移门禁通过。
- 测试：`test/usage-and-policy/usage.test.ts`（降级档/阈值/不外推）；`manifest.test.ts`/`openapi.test.ts` 随 unblock 更新（36 稳定操作、usage 路由 stable）。

### Task 2: platform-api handler + 路由
- `apps/platform-api/src/routes/usage.ts`：`handleGetUsageSummary`（parseInput → requireUuidParams → requireSession → effectivePermissions + requireOrgManager → `listProjects` → 逐项目 `queryProjectInboxDiagnostics`(accepted) + `queryProjectQueryableEvidence`(processed) 求和 → ratio = accepted/quota → `degradeForUsageRatio` → serializeOutput）。30 天周期窗口。
- `apps/platform-api/src/app.ts`：注册 `GET /api/platform/v1/organizations/:organizationId/usage`。
- 测试：platform-api 现有测试全绿；typecheck/lint 通过。

### Task 3: 正式规格 + 定向验证
- `docs/architecture/usage-quota-degradation-projection.md`（`status: approved`、`implementation-status: implemented-in-feature-branch`）。
- 定向验证：platform-contract 248 测试、platform-api 56 测试、`pnpm platform-contract:generate` 漂移 19 测试、typecheck、lint、`git diff --check`。

## Self-Review

**Spec coverage（PRD §15）**：真实用量聚合（§15.4 已接收/已保存）✓；额度状态与降级投影（§15.5 normal/near-limit/degraded/hard-limit）✓；usageGetSummary 查询 ✓；无采样外推/收费 ✓；性能/慢请求样本 `unavailable` 不伪造 ✓。**与现有实现无冲突**：复用既有 `queryProjectInboxDiagnostics`/`queryProjectQueryableEvidence`/`listProjects`，未重复建 Repository；未新增无关测试。
