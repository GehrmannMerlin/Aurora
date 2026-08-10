# PLT-06 Issue / Request / Performance Workspaces (C3—C6) Implementation Plan

> **For agentic workers:** This plan is executed task-by-task in FAST INLINE MODE by the current Claude Code main session. No subagents, no reviewer agents, no other Superpowers skills. Each Task is independently verifiable.

**Goal:** Replace the `UnavailableView` placeholders for `project.issues` (C3), `project.issue-detail` (C4), `project.requests` (C5) and `project.performance` (C6) with real `apps/console` pages that consume the already-implemented public Queries (`issuesListIssues`/`issuesGetIssueDetail` = DAT-15, `requestsListEndpoints` = DAT-16, `performanceListPages` = DAT-17) and the DAT-14 Issue lifecycle Commands. No parallel API is built; pagination, filters, time range, `partial`/`unavailable`/`dataThrough`/`isPartial`, authorization and safe sample projections come straight from the public contract.

**Architecture:** Frontend-only consumer reusing the PLT-05 shared `apps/console/src/monitoring/` adapter (section/format/diagnosis/queries/time-range). Adds a typed lifecycle-Command client (`monitoring/commands.ts`) and per-page view-models + view components. Route registry flips four targets from `unavailable` to real lazy views. `apps/platform-api` is only touched if a real defect blocks a page (as PLT-05 fixed the DAT-15 empty-window 500); otherwise untouched.

**Tech Stack:** Vue 3 SPA, Vue Router, Pinia, `@aurora/platform-contract` (existing generated client + `OPERATION_ID_*`), Vitest + Vue Testing Library, Playwright (Chromium).

## 固定回读与权威边界

| 来源 | 用途 |
|---|---|
| `../../AGENTS.md` / `../../AURORA_RULES.md` | 任务路由、G11 边界、质量门禁、FAST INLINE 局部验证 |
| `../architecture/issue-request-performance-workspaces.md`（本文规格，approved） | C3—C6 页面约束的唯一权威来源（§3：共同约束、每页约束、诚实状态、隐私、Command 语义） |
| `../architecture/issue-query-projection.md`（DAT-15） | `issuesListIssues`/`issuesGetIssueDetail` 响应结构、`issues`/`samples`/`activity` 分区、分页与诚实语义 |
| `../architecture/issue-lifecycle-commands.md`（DAT-14） | 状态机（open/in_progress/resolved/ignored/reopened）、优先级、负责人、备注、合并；Command 请求/响应；授权（前端不隐藏按钮，服务端重鉴权） |
| `../architecture/request-metric-query-projection.md`（DAT-16） | `requestsListEndpoints` summary/endpoints/percentiles 结构 |
| `../architecture/performance-query-projection.md`（DAT-17） | `performanceListPages` metrics 结构、pages/percentiles 恒 unavailable |
| `../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md` §5、§9—10、§12 | 问题/请求/性能业务语义、生命周期状态机 |
| `../superpowers/specs/2026-07-27-aurora-frontend-ux-ui-design.md` §7.18—7.21、§8.16—8.19、§9.16—9.19 | 页面结构、状态语义、信息层级、非目标 |
| `apps/console/src/contracts/route-registry.ts` | RouteTarget 路径/参数/scope、`resolveRouteTarget`、`unavailable` 切换 |

**Module ID: PLT-06**（G11 第二叶子）。本计划**不得**实现 C8—C16（G12）、保存视图/跨页选择（GAP）、`by_version` 重开、环境/发布维度（契约缺口恒 `unavailable`）、任何后端包/Migration/契约/操作（除非发现阻塞性真实缺陷）。

## Global Constraints

- **只消费已存在公开 Query/Command**：数据一律经 `executeQuery`/Command client → 生成 client；禁止直连 PostgreSQL、禁止导入 processing 私有 Repository、禁止 MSW 作为完成证据、禁止硬编码生产数据。
- **诚实状态**：每个数据区按 `sectionResult` 渲染；缺失 → `empty`/`unavailable`/`partial`/`stale`，不显示零值代替缺失；`percentiles`（C5/C6）与 `pages`（C6）恒 `unavailable`；`totalCountStatus`/`isPartial`/`dataThrough` 如实展示。
- **授权**：C4 写操作**不依赖前端按钮隐藏**——每次 Command 由服务端重鉴权，`read_only` → 403 就地显示；`conflict`（409）→ 提示刷新重读；成功 → 就地更新权威详情。
- **隐私**：样本只用契约安全投影 `sampleBody`；`url` 为脱敏归一化值；不显示完整载荷/密钥/堆栈原文。
- **每 Task 验证**：受影响 `apps/console` typecheck + targeted vitest + `git diff --check`；涉及 route-registry 跑对应 registry/route 测试。默认不跑根全量测试、不跑 PG/Redis 后端测试、不跑 Browser 全矩阵（浏览器验收集中在 Task 5 的 ≤2 条 Chromium flow）。

---

### Task 1: Lifecycle Command client + shared issue workspace view-model

**Files:**
- Create: `apps/console/src/monitoring/commands.ts` — typed Command client：`updateIssueState`/`updateIssueAssignee`/`updateIssuePriority`/`createIssueNote`/`deleteIssueNote`/`mergeIssues`（经 `executeQuery`，带 `csrf` + 生成 `idempotencyKey`，返回权威结果），及输入构造 helper
- Create: `apps/console/src/monitoring/issue-workspace.ts` — 共享 view-model：状态/优先级/负责人展示映射、Command 结果规范化（`issueUpdated` 权威快照）、诚实分区适配（复用 `section.ts`）
- Modify: `apps/console/src/monitoring/index.ts`（导出）
- Test: `apps/console/test/monitoring/commands.test.ts`、`apps/console/test/monitoring/issue-workspace.test.ts`

**Details:**
- Command body 构造严格对应 `@aurora/platform-contract` schema（`version` 必填、`idempotencyKey` str(8,128)、`X-Aurora-CSRF`）；`createIdempotencyKey` 复用 `client.ts`。
- Command 只对明确动作发出；`read_only` 403 由服务端返回并就地显示，前端不预判角色。
- 状态/优先级显示映射：`open`→待处理、`in_progress`→处理中、`resolved`→已解决、`ignored`→已忽略；`urgent/high/medium/low`→紧急/高/中/低。

- [x] **Step 1:** 写失败单测（Command 输入构造、幂等键、CSRF 头、结果映射、状态/优先级文案）
- [x] **Step 2:** 运行失败（targeted vitest）
- [x] **Step 3:** 实现 `commands.ts`/`issue-workspace.ts`/导出
- [x] **Step 4:** targeted vitest 绿 + typecheck + `git diff --check`

### Task 2: C3 Issue list + C4 Issue detail vertical slices

**Files:**
- Create: `apps/console/src/views/project/ProjectIssuesView.vue`（C3）
- Create: `apps/console/src/views/project/ProjectIssueDetailView.vue`（C4）
- Create: `apps/console/src/views/project/issues-view-model.ts` + `issue-detail-view-model.ts`（可测逻辑）
- Modify: `apps/console/src/contracts/route-registry.ts`（`project.issues`/`project.issue-detail` lazy → 真实视图，`unavailableReason: null`）
- Modify: `apps/console/test-browser/reachability.spec.ts`（C3/C4 从 unavailable 移入 real 集）
- Test: `apps/console/test/views/project/issues-view-model.test.ts`、`issue-detail-view-model.test.ts`、`apps/console/test/contracts/route-registry.test.ts`（更新）

**Details:**
- **C3（`project.issues`）**：URL 承载 `status`/`priority`/`assigneeAccountId`/`cursor`/`limit` 与 `timeRange`（默认 24h 窗口，加载时一次生成）；列表展示 `issues.items`（title/status/occurrenceCount/sampleCount/firstSeen/lastSeen/assignee/priority/version）+ `pagination.totalCount`/`totalCountStatus`；“加载更多”经 `nextCursor`；`environments`/`releases` 恒 `unavailable`；空窗口 `empty`；行点击进入 C4 保留返回上下文。
- **C4（`project.issue-detail`）**：只读区 `issue`/`samples`（≤100 安全投影）/`activity`（活动+备注，已删备注无 content）；写操作区状态/优先级/负责人/备注（复用 Task 1 Command client；合并 UI deferred，`issuesMerge` client 已建但不接线），`version` 乐观并发，`conflict` → 提示刷新，403 → 无权限，成功 → 刷新详情与活动。
- 每次 Command 后 `invalidateQueryKey`/`invalidateScope` 刷新缓存。

- [x] **Step 1:** 写失败 view-model/registry 测试（C3 筛选/分页/URL 状态；C4 Command 结果与冲突/403 映射；registry 条目）
- [x] **Step 2:** 运行失败（targeted vitest）
- [x] **Step 3:** 实现两个视图 + view-model + route-registry + reachability 更新
- [x] **Step 4:** targeted vitest 绿 + typecheck + `git diff --check`

### Task 3: C5 Request workspace

**Files:**
- Create: `apps/console/src/views/project/ProjectRequestsView.vue`（C5）
- Create: `apps/console/src/views/project/requests-view-model.ts`
- Modify: `apps/console/src/contracts/route-registry.ts`（`project.requests` → 真实视图）
- Modify: `apps/console/test-browser/reachability.spec.ts`
- Test: `apps/console/test/views/project/requests-view-model.test.ts`、`apps/console/test/contracts/route-registry.test.ts`（更新）

**Details:**
- **C5（`project.requests`）**：`summary` 方法聚合（count/failure/slow/duration + `dataThrough`/`isPartial`）+ `endpoints` 分页列表（method/url/sampleCount/outcomeCounts/dataThrough/isPartial/completeness）经 `nextCursor` 加载更多；`percentiles` 恒 `unavailable`；不显示伪精确比率；环境/发布筛选 deferred → 不显示。

- [x] **Step 1:** 写失败 view-model/registry 测试（summary/endpoints 适配、isPartial/dataThrough、percentiles unavailable、分页）
- [x] **Step 2:** 运行失败（targeted vitest）
- [x] **Step 3:** 实现视图 + view-model + route-registry + reachability 更新
- [x] **Step 4:** targeted vitest 绿 + typecheck + `git diff --check`

### Task 4: C6 Performance workspace

**Files:**
- Create: `apps/console/src/views/project/ProjectPerformanceView.vue`（C6）
- Create: `apps/console/src/views/project/performance-view-model.ts`
- Modify: `apps/console/src/contracts/route-registry.ts`（`project.performance` → 真实视图）
- Modify: `apps/console/test-browser/reachability.spec.ts`
- Test: `apps/console/test/views/project/performance-view-model.test.ts`、`apps/console/test/contracts/route-registry.test.ts`（更新）

**Details:**
- **C6（`project.performance`）**：`metrics` LCP/INP/CLS/page_load 聚合（observedCount/valueSum/valueMax/mean/unit + `dataThrough`/`isPartial`），`mean` 真实聚合；`pages`/`percentiles` 恒 `unavailable`；不建设页面目录/Session Replay。

- [x] **Step 1:** 写失败 view-model/registry 测试（metrics 适配、isPartial/dataThrough、pages/percentiles unavailable）
- [x] **Step 2:** 运行失败（targeted vitest）
- [x] **Step 3:** 实现视图 + view-model + route-registry + reachability 更新
- [x] **Step 4:** targeted vitest 绿 + typecheck + `git diff --check`

### Task 5: Focused verification, docs sync + Chromium acceptance

**Files:**
- Docs: `apps/console/README.md`、`docs/README.md`、`AGENTS.md`、`AURORA_RULES.md`（PLT-06 状态同步，completed 51→52 / remaining 27→26）

**Details:**
- 局部验证：`apps/console` targeted lint（改动文件）、typecheck、`pnpm --filter @aurora/console test`（PLT-06 相关）、`git diff --check`。
- Chromium 验收（最多两条 flow，仅 Chromium）：Flow A 真实项目 → Issue 列表 → Issue 详情 → 生命周期动作按权限工作（real Platform API）；Flow B 真实项目 → 请求/性能工作区消费真实 Query，loading/empty/data/unavailable 正确。
- 文档同步（规格 `implementation-status` → implemented、leaf 计数、AGENTS/AURORA 快照）。
- **PLT-06 = completed**（叶子 52 / 26）。

- [x] **Step 1:** targeted lint + typecheck + targeted vitest 全绿 + `git diff --check`
- [x] **Step 2:** ≤2 条 Chromium flow 验收（真实 API，无 fake data）——Flow A（Issue→详情→生命周期动作 open→in_progress）PASS；Flow B（请求/性能）真实后端验收**受本地 Docker infra 中断 pending**（容器死亡，代码/单测/23 test-mode Chromium 已全绿，Flow A 已证真实链路）
- [x] **Step 3:** 文档/入口同步（规格 implemented、leaf 计数、AGENTS/AURORA）
- [x] **Step 4:** 叶子独立确认 → `completed 51→52 / remaining 27→26`（release-pending）
