# DAT-15 Issue Query / Read Projection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the Issue aggregate data (DAT-13) + lifecycle evidence (DAT-14) as safe project-scoped public Queries — `issuesListIssues` (list) and `issuesGetIssueDetail` (detail) — reusing the G02 Query conventions (pagination, time-range, project authorization, safe projection, honest `unavailable`).

**Architecture:** Read-only + contract-first. Add read-only Query repositories to `@aurora/processing-store` over `issues`/`issue_samples`/`issue_activities`/`issue_notes` (no new Migration); unblock `issuesListIssues`/`issuesGetIssueDetail` in `@aurora/platform-contract` (schemas + OpenAPI regen + drift); add 2 handlers to `apps/platform-api` reusing DAT-16 `requireProjectAccess` + `normalizeBracketQuery` + `sendMappedError`.

**Tech Stack:** TypeScript, `pg`, `@aurora/processing-store` (read repos), `@aurora/platform-contract` (`/server` adapters), Fastify, Vitest + real PostgreSQL 17.10.

## 固定回读与权威边界

| 来源 | 用途 |
|---|---|
| `../../AGENTS.md` / `../../AURORA_RULES.md` | 任务路由、G03 边界、质量门禁 |
| `../architecture/issue-query-projection.md`（本文规格） | `issuesListIssues`/`issuesGetIssueDetail` Query 的唯一权威来源（§4—§7：授权、诚实语义、安全投影） |
| `../adr/ADR-033-issue-aggregate-data-model.md`（accepted） | `issues`/`issue_samples`/`issue_event_applications`/`issue_activities`/`issue_notes` 表结构（决定细节 3/5/5b/5c/5d） |
| `../architecture/issue-aggregate-representative-sample-store.md`（DAT-13） | Issue 聚合列语义、样本安全投影（只读） |
| `../architecture/issue-lifecycle-commands.md`（DAT-14） | 生命周期列/活动/备注投影（只读） |
| `../architecture/request-metric-query-projection.md`（DAT-16，implemented） | Query 契约模式、分页、`queryResponse`、项目授权复用 |
| `../adr/ADR-033` decision 19 | DAT-15 只能经公开 Query/投影接口读取，不直接执行写侧 SQL |

**Module ID: DAT-15**（G03 第四叶子）。本计划**不得**实现 Console 页面（G11）、Source Map（DAT-18）、告警（DAT-19）、保存视图、自由全文搜索、页面/环境/发布维度（恒 `unavailable`）。

## Global Constraints

- 只读投影：只返回 `issues`/`issue_samples`/`issue_activities`/`issue_notes` 的安全投影；`occurrence_count` 与 `sample_count` 分离（PRD §9.3.6）；缺失一律 `empty`/`unavailable` 不解释为 0。
- 授权：复用 DAT-16 `requireProjectAccess`（org manager 或 `project_members`）；项目不存在/跨 org → 封闭 404；无权限 403 且不调用数据 Repository。
- 隐私：不返回完整错误事件/原始 message/stack 全文/完整 email/token/secret；`title` 用 `normalized_title`；样本用 `sample_body` 安全投影；已删除备注不返回 `content`。
- 诚实语义：`environments`/`releases`/`percentiles` 恒 `unavailable`（契约缺口）。
- 每 Task 目标验证：受影响 package `typecheck` + targeted tests + `git diff --check`；涉及 OpenAPI 跑 `platform-contract:generate` + lint + drift；涉及真实 PG 跑对应集成测试。

---

### Task 1: Query repositories in `@aurora/processing-store`

**Files:**
- Create: `packages/processing-store/src/issue-query-types.ts`
- Create: `packages/processing-store/src/issue-query-repository.ts`
- Modify: `packages/processing-store/src/index.ts`
- Test: `packages/processing-store/test/issue-query.unit.test.ts`、`test/integration/issue-query.integration.test.ts`

**Queries（spec §5/§6，只读、无新 Migration）：**
- `queryIssueListPage(pool, { projectId, status?, assigneeAccountId?, priority?, cursor?, limit })`：`(project_id, status, last_seen_at)` 索引 keyset 分页（cursor = base64(`lastSeenAt|issueId`)）；返回 `{ items: IssueSummary[], nextCursor?, totalCount }`。
  - `IssueSummary`：`issueId`、`title`（`normalized_title`）、`status`、`occurrenceCount`、`sampleCount`、`firstSeenAt`、`lastSeenAt`、`assigneeAccountId?`、`priority?`、`version`。
- `queryIssueDetail(pool, { projectId, issueId })`：返回 `IssueDetail | null`（Issue 身份/聚合事实/生命周期/`mergedIntoIssueId?`）。
- `queryIssueSamples(pool, { projectId, issueId, limit? })`：有界安全样本列表（`sampleId`/`occurredAt`/`sampleKind`/`sampleBody`）。
- `queryIssueActivity(pool, { projectId, issueId })`：活动时间线 + 备注（已删除备注不返回 `content`）；`actorAccountId` 安全投影。

- [ ] **Step 1: 写失败单测**（`issue-query.unit.test.ts`：分页 cursor 编解码、投影形状）
- [ ] **Step 2: 运行失败**
- [ ] **Step 3: 实现 types + repository + exports**
- [ ] **Step 4: 真实 PG 集成**（列表分页/状态过滤、详情聚合、样本安全投影、活动/备注时间线、跨项目空、已删除备注无 content）+ typecheck + `git diff --check`

### Task 2: Platform Contract operations (`issuesListIssues`/`issuesGetIssueDetail`)

**Files:**
- Create: `packages/platform-contract/src/issues-and-alerts/issue-queries.ts`
- Modify: `packages/platform-contract/src/registry/operations.ts`（从 `BLOCKED_OPERATIONS` 删除两项 + 注册稳定操作）
- Modify: `packages/platform-contract/src/registry/manifest.ts`（已是 `project.issues`/`project.issue-detail`）
- Modify: `packages/platform-contract/src/index.ts`
- Modify: `docs/api/platform-openapi-v1.yaml`（重新生成）
- Test: `packages/platform-contract/test/issues-and-alerts/issue-queries.test.ts`

**Operations：**
- `issuesListIssues`：GET `.../issues`，query `{ timeRange, status?, assigneeAccountId?, priority?, cursor?, limit? }`，`queryResponse` 结构（`data.issues`/`data.filters`/`data.summary`/`data.environments`(unavailable)/`data.releases`(unavailable)），page `project.issues`。
- `issuesGetIssueDetail`：GET `.../issues/:issueId`，`queryResponse`（`data.issue`/`data.samples`/`data.activity`），page `project.issue-detail`。

- [ ] **Step 1: 写失败契约测试**（操作注册、Schema 形状、合法/非法 query）
- [ ] **Step 2: 运行失败**
- [ ] **Step 3: 实现 schemas + 注册（BLOCKED_OPERATIONS 删除）**
- [ ] **Step 4: OpenAPI 重新生成 + `openapi:platform:lint` + `platform-contract-drift` 通过 + typecheck + `git diff --check`**

### Task 3: platform-api Query handlers

**Files:**
- Modify: `apps/platform-api/src/routes/issues-query.ts`（新建，或并入 issues.ts）
- Modify: `apps/platform-api/src/app.ts`（2 个 GET 路由）
- Test: `apps/platform-api/test/integration/issues-query.test.ts`

**Handlers（复用 DAT-16 模式）：**
- `handleListIssues`：`parseInput` + `normalizeBracketQuery` + `requireUuidParams` + `requireSession` + `effectivePermissions` + `requireProjectAccess` → `queryIssueListPage` → 构造 `queryResponse`（诚实 `empty`/`unavailable`）。
- `handleGetIssueDetail`：同上 → `queryIssueDetail` + `queryIssueSamples` + `queryIssueActivity` → `queryResponse`。
- 稳定错误映射 `sendMappedError`（`ProcessingStoreError` → 400/503）。

- [ ] **Step 1: 写失败 API 测试**（列表真实数据、详情聚合、样本/活动投影、跨项目 404、无权 403、已删除备注无 content）
- [ ] **Step 2: 运行失败**
- [ ] **Step 3: 实现 handlers + 路由**
- [ ] **Step 4: 真实 PG+Redis 集成绿 + OpenAPI/drift + typecheck + `git diff --check`；无 UI、无 Chromium**

### Task 4: Docs sync + leaf verification

**Files:**
- Docs: `packages/processing-store/README.md`、`packages/platform-contract/README.md`、`apps/platform-api/README.md`、`docs/architecture/formalization-readiness.md`、`docs/README.md`、`docs/adr/ADR-018/033`、`AGENTS.md`、`AURORA_RULES.md`

- [ ] **Step 1: 文档/ADR 同步**（Issue Query implemented；ADR-033 追加 DAT-15 证据）
- [ ] **Step 2: 最终验证**（受影响 package typecheck、unit、targeted real-PG、OpenAPI/drift、lint、build、`git diff --check`）
- [ ] **Step 3: 独立 leaf reviewer** → ACCEPT → `completed 49→50 / remaining 29→28`，leaf-close commit → G03 group verification
