# PLT-05 Monitoring Workspace Entry (C1/C2/C7) Implementation Plan

> **For agentic workers:** This plan is executed task-by-task in FAST INLINE MODE by the current Claude Code main session. No subagents, no reviewer agents, no other Superpowers skills. Each Task is independently verifiable.

**Goal:** Replace the `UnavailableView` placeholders for `project.onboarding` (C1), `project.overview` (C2) and `project.data-status` (C7) with real `apps/console` pages that consume the already-implemented public Platform Queries — primarily `diagnosticsGetDataStatus` (DAT-20), plus `issuesListIssues`/`requestsListEndpoints`/`performanceListPages` (DAT-15/16/17) for C2 evidence. Pages keep `accepted ≠ processed ≠ queryable` strictly distinct and never fabricate data.

**Architecture:** Frontend-only consumer. A small shared monitoring adapter module (`apps/console/src/monitoring/`) wraps the generated client (`buildRequest`/`parseResponse` via `executeQuery`) into typed query consumers and pure view-state models. Three view components render honest `sectionResult` states (`loading`/`empty`/`partial`/`stale`/`unavailable`/`forbidden`/`error`/`success`). Route registry entries flip from `unavailable` to real lazy views. No backend package, Migration, public contract, or operation is touched.

**Tech Stack:** Vue 3 SPA, Vue Router, Pinia, `@aurora/platform-contract` (existing generated client + `OPERATION_ID_*` constants), Vitest + Vue Testing Library, Playwright (Chromium).

## 固定回读与权威边界

| 来源 | 用途 |
|---|---|
| `../../AGENTS.md` / `../../AURORA_RULES.md` | 任务路由、G11 边界、质量门禁、FAST INLINE 局部验证 |
| `../architecture/monitoring-onboarding-overview-diagnosis.md`（本文规格，approved） | C1/C2/C7 页面约束的唯一权威来源（§3：共同约束、每页约束、诚实状态、隐私） |
| `../architecture/ingestion-diagnostics-status-query.md`（DAT-20，implemented） | `diagnosticsGetDataStatus` 响应结构、`sectionResult`、`actionTargets`、授权与隐私硬边界 |
| `../architecture/issue-query-projection.md`（DAT-15） | `issuesListIssues` 列表与 `pagination.totalCount`/`totalCountStatus`（C2 问题证据） |
| `../architecture/request-metric-query-projection.md`（DAT-16） | `requestsListEndpoints` summary（C2 请求证据） |
| `../architecture/performance-query-projection.md`（DAT-17） | `performanceListPages` metrics（C2 性能证据） |
| `../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md` §4.4 / §7.3 / §12.4 | C1 三步接入引导与测试事件语义、接入诊断基础检查、概览状态边界 |
| `../superpowers/specs/2026-07-27-aurora-frontend-ux-ui-design.md` §7.16/7.17/7.22、§8.14/8.15/8.20、§9.14/9.15/9.20 | 页面结构、状态语义、信息层级、非目标（已批准设计） |
| `../superpowers/specs/2026-07-30-aurora-console-visual-language-design.md` | 视觉语言与设计令牌（浅色内容区、深石墨顶栏、琥珀橙侧栏、禁渐变） |
| `apps/console/src/contracts/route-registry.ts` | RouteTarget 路径/参数/scope、`resolveRouteTarget`、`unavailable` 切换 |

**Module ID: PLT-05**（G11 第一叶子）。本计划**不得**实现 C3—C6（PLT-06）、C8—C16（G12）、后端任何包/Migration/契约/操作、保存视图、环境/发布维度（契约缺口恒 `unavailable`）、告警、影响用户估算（后端未提供）。

## Global Constraints

- **只消费已存在公开 Query**：数据一律经 `executeQuery` → 生成 client；禁止直连 PostgreSQL、禁止导入 processing 私有 Repository、禁止 MSW 作为完成证据、禁止硬编码生产数据。
- **接收≠处理≠可查询**：`received`（有 `received_at` 的行）、`processing`（pending/leased/retry_waiting）、`processed`（state='processed'）、`queryable`（processing-store 证据）分别呈现；`HTTP accepted` 绝不显示为处理完成。
- **诚实状态**：每个数据区按 `sectionResult` 渲染；缺失 → `empty`/`unavailable`，不显示零值代替缺失，不把 `no_data` 当错误或当正常。
- **授权**：页面只显示服务端返回的 `allowedActions`/`navigationTargets`/`actionTargets`；403/404 按 `ApiError` 映射为明确错误状态，不泄露存在性。
- **隐私**：不显示 envelope 原文、request_id、batch_id、密钥摘要/keyId/origin/environment 值、内部堆栈；`lastErrorCode` 为服务端稳定错误码，直接显示。
- **每 Task 验证**：受影响 `apps/console` typecheck + targeted vitest + `git diff --check`；涉及 route-registry 跑对应 registry/route 测试。默认不跑根全量测试、不跑 PG/Redis 后端测试、不跑 Browser 全矩阵（浏览器验收集中在 Task 4 的 Chromium 关键链）。

---

### Task 1: Shared monitoring adapter module (generated-client integration)

**Files:**
- Create: `apps/console/src/monitoring/section.ts` — `sectionResult` → `SectionViewState` 纯适配器（`available`/`empty`/`partial`/`stale`/`unavailable`/`forbidden` → 渲染模型）
- Create: `apps/console/src/monitoring/format.ts` — `formatUtc`（RFC 3339 UTC → 标注时区的显示）、`formatCount`（阈值显示，不伪造精度）
- Create: `apps/console/src/monitoring/queries.ts` — typed 消费者：`fetchDataStatus`、`fetchIssueList`、`fetchIssueDetail`、`fetchRequestEndpoints`、`fetchPerformancePages`（经 `executeQuery`，正确 `scope` 与可选 `timeRange` 输入）
- Create: `apps/console/src/monitoring/diagnosis.ts` — DAT-20 `summary` 显示模型（服务端状态→文案/色调映射，纯函数）+ `actionTargets` → href（经 `resolveRouteTarget`）
- Create: `apps/console/src/monitoring/index.ts`
- Test: `apps/console/src/monitoring/section.test.ts`、`format.test.ts`、`queries.test.ts`、`diagnosis.test.ts`

**Details:**
- `section.ts` 输出封闭状态联合（如 `{ kind:'loading' } | { kind:'empty', reason } | { kind:'available', data } | { kind:'partial', data, missing } | { kind:'stale', data, freshAt, staleReason } | { kind:'unavailable', reason } | { kind:'forbidden' } | { kind:'error', message }`），供视图统一渲染。
- `diagnosis.ts` 的 `summaryDisplay` 只把 DAT-20 服务端组合的 `status`/`primaryCause` 映射为中文文案与色调（`receiving`/`processing`/`blocked`/`not_receiving`/`unknown`），**不**重算业务状态、**不**映射到 PRD §4.4.6 接入枚举。
- `queries.ts` 的 `fetchDataStatus` 接收 `{ organizationId, projectId, scope, signal?, timeRange? }`；其余 fetch 同类。返回类型来自 `@aurora/platform-contract` schema 对应的响应结构。
- 本 Task 建立 PLT-05 与 PLT-06 共享的最小 adapter 层（非“大而全 framework”）。

- [x] **Step 1:** 写失败单测（section 各分支、format 边界、diagnosis summary 文案、queries 输入构造）
- [x] **Step 2:** 运行失败（`pnpm --filter @aurora/console test -- src/monitoring`）
- [x] **Step 3:** 实现 `section.ts`/`format.ts`/`diagnosis.ts`/`queries.ts`/`index.ts`/`time-range.ts`（+ `client.ts` 嵌套 query 括号序列化、`mocks/handlers.ts` monitoring handlers）
- [x] **Step 4:** targeted vitest 绿 + `vue-tsc --noEmit`（typecheck）+ `git diff --check`

### Task 2: C1 onboarding + C2 overview vertical slice

**Files:**
- Create: `apps/console/src/views/project/ProjectOnboardingView.vue`（C1）
- Create: `apps/console/src/views/project/ProjectOverviewView.vue`（C2）
- Modify: `apps/console/src/contracts/route-registry.ts`（`project.onboarding`/`project.overview` lazy 从 `unavailable` 换为真实视图，`unavailableReason: null`）
- Test: `apps/console/test/contracts/route-registry.test.ts`（更新）、`apps/console/src/views/project/onboarding-view-model.ts` + 测试（C1 阶段展示逻辑）、`overview-view-model.ts` + 测试（C2 组合逻辑）

**Details:**
- **C1（`project.onboarding`）**：第一层真实接入链状态（`fetchDataStatus` 的 `summary`/`stages`/`credential`/`queryable`/`actionTargets`）；PRD §4.4.5 三步引导以说明性内容展示（安装/初始化/发送测试错误）；`clientKey` 真实投影未提供 → 代码片段中该字段渲染为明确的“未提供”状态（灰色标注，不显示伪造 key 值），并注明能力缺口；不声明版本化安装模板契约；`connected` 依赖后端未提供 → 该步以 `capability-not-provided` 诚实标注；“我已经发送测试事件”读取最新 `fetchDataStatus` 就地显示阶段。
- **C2（`project.overview`）**：第一层权威状态与原因 = DAT-20 `summary`（服务端组合）；第二层最小证据：问题总数（`fetchIssueList` 的 `totalCount`+`totalCountStatus`）、请求证据（`fetchRequestEndpoints` summary）、性能证据（`fetchPerformancePages` metrics）、最近数据与可信度（`recent`/`queryable`/`stages`）；环境/发布筛选、告警摘要、影响用户估算 → 对应区块 `unavailable`；入口只显示 `actionTargets` 与已存在页面安全导航。
- **route-registry.ts**：两个条目 lazy 换真实视图、`unavailableReason: null`；`project.issue-detail`/`project.requests`/`project.performance` 仍保持 `unavailable`（PLT-06 范围）。

- [x] **Step 1:** 写失败 view-model/registry 测试（C1 阶段区分 received/processing/processed/queryable；C2 组合 `sectionResult` 与 `unavailable`；registry 条目更新）
- [x] **Step 2:** 运行失败（targeted vitest）
- [x] **Step 3:** 实现两个视图 + `SectionNotice.vue` + route-registry 更新（`project.onboarding`/`project.overview` → 真实视图）
- [x] **Step 4:** targeted vitest 绿（112）+ typecheck + `git diff --check`

### Task 3: C7 data-status diagnosis vertical slice

**Files:**
- Create: `apps/console/src/views/project/ProjectDataStatusView.vue`（C7）
- Modify: `apps/console/src/contracts/route-registry.ts`（`project.data-status` lazy 换真实视图，`unavailableReason: null`）
- Test: `apps/console/test/contracts/route-registry.test.ts`（更新）、`apps/console/src/views/project/data-status-view-model.ts` + 测试

**Details:**
- **C7（`project.data-status`）**：完整呈现 `fetchDataStatus` 六区（`summary`/`stages`（含 `deadLetter.lastErrorCode`）/`recent`/`rejection`（契约恒 `unavailable`，诚实显示原因）/`credential`（仅安全计数）/`queryable`）；`actionTargets` 渲染为真实导航（`project.client-keys`/`project.onboarding`/`project.requests`/`project.performance` 等），无权目标不显示；不建设原始请求日志/逐事件轨迹/完整载荷/密钥查看/无限轮询。
- **route-registry.ts**：`project.data-status` 条目换真实视图、`unavailableReason: null`。

- [x] **Step 1:** 写失败 view-model/registry 测试（六区各 `sectionResult` 状态、rejection 恒 unavailable、actionTargets 渲染、隐私负例）
- [x] **Step 2:** 运行失败（targeted vitest）
- [x] **Step 3:** 实现 `ProjectDataStatusView.vue` + `data-status-view-model.ts` + route-registry 更新（`project.data-status` → 真实视图）+ `reachability.spec.ts` 拆分真实/未提供
- [x] **Step 4:** targeted vitest 绿（71）+ typecheck + `git diff --check`

### Task 4: Focused verification, docs sync + Chromium acceptance

**Files:**
- Docs: `apps/console/README.md`、`docs/README.md`、`docs/architecture/formalization-readiness.md`、`AGENTS.md`、`AURORA_RULES.md`（PLT-05 状态同步，completed 50→51 / remaining 28→27）

**Details:**
- 局部验证：`apps/console` targeted lint（改动文件）、typecheck、`pnpm --filter @aurora/console test`（PLT-05 相关）、`git diff --check`。
- Chromium 关键链（仅 Chromium）：本地真实栈（Postgres+Redis 容器 → migrate → platform-api → console dev）登录测试账号 → 选择真实项目 → 进入 C1/C2/C7 → 页面调用真实 Platform API → 断言 `accepted`/`processing`/`queryable` 未被混成同一状态。
- 文档同步（规格 `implementation-status` → implemented、leaf 计数、AGENTS/AURORA 快照）。
- **PLT-05 = completed**（叶子 51 / 27）。

- [x] **Step 1:** targeted lint + typecheck + targeted vitest 全绿 + `git diff --check`
- [x] **Step 2:** 必要 Chromium 关键链验收（真实本地栈：received=5/processing=2/processed=3/queryable=3 独立，无 fake data；同时修复 DAT-15 issues 空窗口 500 + 回归集成测试）
- [x] **Step 3:** 文档/入口同步（规格 implemented、leaf 计数 50→51、AGENTS/AURORA/docs-README/console-README）
- [x] **Step 4:** 叶子独立确认 → `completed 50→51 / remaining 28→27`（release-pending）
