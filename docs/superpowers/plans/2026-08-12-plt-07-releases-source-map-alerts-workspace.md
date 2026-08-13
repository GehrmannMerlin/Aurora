---
title: PLT-07 Releases Source Map and Alerts Workspace Implementation Plan
status: approved
owner: platform/console
created: 2026-08-12
last-reviewed: 2026-08-12
applies-to: apps/console C8—C12 真实工作区（project.releases / project.release-detail / project.source-maps / project.alerts / project.alert-rule-create / project.alert-rule-edit / project.alert-instance-detail）
related:
  - ../../../AGENTS.md
  - ../../../AURORA_RULES.md
  - ../../architecture/aurora-v1-remaining-module-batches.md
  - ../../architecture/release-source-map-matching-and-reparse.md
  - ../../architecture/alert-evaluation-and-instance-evidence.md
  - ../../superpowers/specs/2026-07-27-aurora-frontend-ux-ui-design.md
  - ../../superpowers/specs/2026-07-30-aurora-platform-openapi-and-implementation-design.md
  - ../../../packages/platform-contract/src/releases/releases.ts
  - ../../../packages/platform-contract/src/issues-and-alerts/alerts.ts
supersedes: none
design-stage: implemented-in-feature-branch
---

# PLT-07 Releases Source Map and Alerts Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `apps/console` 的 C8—C12（发布 / 发布详情 / Source Map / 告警双标签 / 告警规则表单 / 告警实例详情）从 `UnavailableView` 占位替换为真实工作区，只消费 DAT-18/DAT-19 已存在公开契约。

**Architecture:** 纯前端增量。扩展 `apps/console/src/monitoring/` 的 typed Query/Command 消费者，新增每页纯 view-model 与 Vue SFC，把 `contracts/route-registry.ts` 中 C8—C12 路由从 `unavailable` 换成真实 lazy 组件，并为 test-mode MSW harness 增加 releases/source-maps/alerts 投影。不创建任何服务端 API、不直连数据库、不在前端做 Source Map 符号化或告警求值。

**Tech Stack:** Vue 3 SFC + Composition API、Vue Router、Pinia（不改）、Zod（路由参数）、`@aurora/platform-contract`（操作与类型唯一来源）、MSW（test-mode）、Playwright + Chromium（smoke）。

## 固定回读与权威边界

| Module ID | 完整回读文件 | 重点章节 | 本计划不得改变的业务逻辑 | 缺失门禁 |
| --------- | ------------ | -------- | ------------------------ | -------- |
| PLT-07 | `BASE-PRD`、`BASE-ARCH`、`BASE-IMPL`、`PLAT-DOMAINS`、`PLAT-UX`、`PLAT-STACK`、`PLAT-OAPI`、`OPS-DELIVERY`、`FORM` | PRD §8、§11；UX/UI §7.23—7.27、§8.21—8.25、§9.21—9.25、§10.15—10.19 | 发布由 SDK/令牌创建，平台不手工创建；Source Map 严格按项目+发布+构建路径匹配；重复上传摘要幂等/替换显式确认；重解析有限范围；Product Alert ≠ OPS-06 Operational Alert；`recovered` 是实例终态 | 部署记录/下载/手工部署 Command 无公开契约 → C8 部署区与 C9 下载恒 `unavailable`，不伪造 |

## Global Constraints

- 只消费 DAT-18（`releasesListReleases`/`sourceMapsListFiles`/`sourceMapsUpload`/`sourceMapsReplace`/`sourceMapsReparse`）与 DAT-19（`alertsGetCapability`/`alertsListRulesAndInstances`/`alertsCreateRule`/`alertsUpdateRule`/`alertsGetInstanceDetail`）公开契约；页面不得调用数据库、队列、对象内部键或未登记端点。
- 所有命令经 `executeQuery` 携带 CSRF + 幂等键（`createIdempotencyKey`）；服务端重新鉴权，前端不隐藏按钮代替授权。
- 状态诚实映射：`loading`/`empty`/`error`/`forbidden`/`processing`/`partial`/`stale`/`unavailable` 使用 `monitoring/section.ts` 的 `toSectionView`/`SectionView` 统一渲染；缺失一律 `empty`/`unavailable`，不造零值、不推断"正常"。
- 前端不实现 Source Map symbolication、不实现告警求值、不复制 DAT-18/DAT-19 数据模型；部署记录（无 Deployment contract）与 Source Map 原文件下载（无 Download contract）恒显示服务端理由的 `unavailable`。
- 不提前实现 G13 Notification、不触碰 C13—C16（PLT-08）、不修改 G04 服务端业务语义、不扩大公共 API、不在任何日志/测试截图/DevTools 快照中泄漏 Source Map 内容。
- 危险/写入操作（上传、替换、重解析、创建/更新规则）必须：明确权限 + 确认（替换冲突）或可恢复错误反馈；`replace_conflict` 必须显式确认后才替换。
- 视觉遵循 `PLAT-STACK`（Aurora UI 包装、`au-surface`/`au-button`/`mon-*` 样式、禁渐变、文字/图形双编码状态）。
- 每 Task 的目标测试统一在 Task 4 用预算内的命令 A/B/C 运行；Task 内实现的中间验证只做 `vue-tsc` 类型片段与既有测试不回归。

## File Structure

新增（view-model，纯函数，可单测）：

- `apps/console/src/views/project/releases-view-model.ts` — C8 发布列表状态规范化 + 部署区 `unavailable`
- `apps/console/src/views/project/source-maps-view-model.ts` — C9 文件列表/选中详情/上传/替换/重解析状态
- `apps/console/src/views/project/alerts-view-model.ts` — C10 规则/实例双标签状态
- `apps/console/src/views/project/alert-rule-form-view-model.ts` — C11 指标优先自适应表单（能力驱动）
- `apps/console/src/views/project/alert-instance-detail-view-model.ts` — C12 详情（状态/证据/轨迹/快照）

新增（Vue SFC）：

- `apps/console/src/views/project/ProjectReleasesView.vue` — C8
- `apps/console/src/views/project/ProjectReleaseDetailView.vue` — C9 入口容器（Source Map 子路由挂载点 + 发布上下文）
- `apps/console/src/views/project/ProjectSourceMapsView.vue` — C9
- `apps/console/src/views/project/ProjectAlertsView.vue` — C10
- `apps/console/src/views/project/ProjectAlertRuleFormView.vue` — C11（create/edit 共用一个组件，靠 `ruleId` 判定）
- `apps/console/src/views/project/ProjectAlertInstanceDetailView.vue` — C12

新增（测试）：

- `apps/console/test/views/project/releases-view-model.test.ts`
- `apps/console/test/views/project/source-maps-view-model.test.ts`
- `apps/console/test/views/project/alerts-view-model.test.ts`
- `apps/console/test/views/project/alert-rule-form-view-model.test.ts`
- `apps/console/test/views/project/alert-instance-detail-view-model.test.ts`
- `apps/console/test/monitoring/alerts-commands.test.ts`
- `apps/console/test/monitoring/source-maps-commands.test.ts`
- `apps/console/test-browser/g12-release-alert-smoke.spec.ts`

修改：

- `apps/console/src/monitoring/queries.ts` — 追加 releases/source-maps/alerts 类型化 Query 消费者
- `apps/console/src/monitoring/commands.ts` — 追加 alerts/source-maps 类型化 Command 消费者（或新增同目录 `alerts-commands.ts`/`source-maps-commands.ts`）
- `apps/console/src/monitoring/index.ts` — 导出新命令文件（若新增）
- `apps/console/src/contracts/route-registry.ts` — C8—C12 路由 lazy 换真实组件
- `apps/console/src/mocks/handlers.ts` — 追加 releases/source-maps/alerts MSW 投影与请求计数
- `apps/console/test/monitoring/queries.test.ts` — 追加新 Query 包装测试
- `apps/console/test/contracts/route-registry.test.ts` — 追加新路由可解析断言
- `apps/console/test/msw/handlers.test.ts` — 追加新 handler 投影断言（若结构允许）

不改动：`apps/platform-api`、`packages/platform-contract`（operation/schema）、任何服务端/数据层包、`apps/console/src/api/*`。

## 数据契约速查（来自 `packages/platform-contract`，实施时以源码为准）

- `releasesListReleases` → `queryResponse(sectionResult({items: releaseSummary[]}))`；`releaseSummary = {releaseId, version, source, firstSeenAt, sourceMapFileCount}`。**无部署记录字段**。
- `sourceMapsListFiles`（path 含 `releaseId`）→ `queryResponse(sectionResult({items: sourceMapFileSummary[]}))`；`sourceMapFileSummary = {sourceMapFileId, buildPath, digestPrefix, status, reparse:{state, processedCount?, totalCount?, updatedAt?}, uploadedAt, replacedAt?, version}`。
- `sourceMapsUpload`（body: `{releaseVersion, buildPath, content, digest, buildId?, idempotencyKey}`）→ `{data:{status: 'uploaded'|'duplicate'|'replace_conflict', releaseId, sourceMapFileId?, currentDigest?, version?}}`。
- `sourceMapsReplace`（body: `{content, digest, version, idempotencyKey}`）→ `{data:{status:'replaced', sourceMapFileId, version}}`。
- `sourceMapsReparse`（body: `{idempotencyKey}`）→ `{data:{status:'queued', releaseId, taskCount}}`。
- `alertsGetCapability` → `queryResponse({metrics[8], windowsMinutes[5], triggerDurationsMinutes[5], cooldownsMinutes[4], filterDimensions[4], recipients[]})`。
- `alertsListRulesAndInstances` → `queryResponse({rules: sectionResult({items: ruleSummary[]}), instances: sectionResult({items: instanceSummary[], count, totalCountStatus})})`。
- `alertsCreateRule`/`alertsUpdateRule` body 为 `alertRuleInput`；update 额外带 `version`；响应 `{data:{status, ruleId, version?}}`。
- `alertsGetInstanceDetail`（path 含 `instanceId`）→ `queryResponse({instance, ruleSnapshot, evidence, transitions[]})`。
- 错误统一为 `AuroraProblem`（`code`：`structural_error`/`authorization`/`not_found`/`field_validation`/`business_validation`/`idempotency_conflict`/`version_conflict`/`authority_unavailable`…），`describeRequestError` 处理。

---

### Task 1: Releases workspace（C8 发布列表 + 发布详情容器）

**Files:**
- Create: `apps/console/src/views/project/releases-view-model.ts`
- Create: `apps/console/src/views/project/ProjectReleasesView.vue`
- Create: `apps/console/src/views/project/ProjectReleaseDetailView.vue`
- Create: `apps/console/test/views/project/releases-view-model.test.ts`
- Modify: `apps/console/src/monitoring/queries.ts`（追加 `fetchReleases`）
- Modify: `apps/console/src/mocks/handlers.ts`（追加 `http.get .../releases`）

**Interfaces:**
- Consumes: `executeQuery`（`apps/console/src/api/query.ts`）、`OPERATION_ID_RELEASES_LIST`（`@aurora/platform-contract`）、`toSectionView`/`SectionView`（`monitoring/section.ts`）、`ProjectScope`（`monitoring/queries.ts`）
- Produces: `fetchReleases(scope, options?): Promise<ReleasesData>`；`ReleasesData = {releases: SectionResult<{items: ReleaseSummary[]}>}`；`buildReleasesView(source): ReleasesViewState`（含部署区 `unavailable`）；`releaseParams` 已在 route-registry 存在

- [ ] **Step 1: 在 queries.ts 追加 typed Query**

```ts
export interface ReleaseSummary {
  readonly releaseId: string;
  readonly version: string;
  readonly source: string;
  readonly firstSeenAt: string;
  readonly sourceMapFileCount: number;
}

export interface ReleasesData {
  readonly releases: SectionResult<{ readonly items: readonly ReleaseSummary[] }>;
}

export function fetchReleases(
  scope: ProjectScope,
  options: FetchOptions = {},
): Promise<ReleasesData> {
  return executeQuery<QueryResponse<ReleasesData>>({
    operationId: OPERATION_ID_RELEASES_LIST,
    input: {
      pathParams: { organizationId: scope.organizationId, projectId: scope.projectId },
    },
    scope: projectScope(scope),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  }).then((response) => response.data);
}
```
（`OPERATION_ID_RELEASES_LIST` 追加到 queries.ts 顶部 import。）

- [ ] **Step 2: 写 releases-view-model.ts**

纯函数：把 `ReleasesSource {loading, error, releases}` 规范化为 `ReleasesViewState`，包含三个渲染区 `list`（`SectionView<ReleaseSummary[]>`）、`deployments`（恒 `{kind:'unavailable', reason:'部署记录契约未提供（DAT-18 无 Deployment Query）'}`）、`detail`（选中发布）。提供 `releaseListToItems(section)` 把 `available` section 的 `items` 取出、其余状态映射为 `empty`/`unavailable`。

- [ ] **Step 3: 写 releases-view-model.test.ts（failing）**

断言：available 列表 → `kind:'available'` 且 items 透传；empty → `kind:'empty'`；releases 缺失且无 error → `unavailable`；deployments 恒 `unavailable`；error 优先于 section。运行命令见 Task 4 命令 A。

- [ ] **Step 4: 实现 ProjectReleasesView.vue（C8）**

参考 `ProjectRequestsView.vue` 结构：`au-surface` + `AppPageHeader`；`list` 区用 `SectionNotice` 处理非 available，available 时渲染发布版本表（version/source/firstSeenAt/sourceMapFileCount），每行提供"Source Map"入口（`router-link` 到 `project.source-maps`，保留 releaseId）；`deployments` 区用 `SectionNotice` 显示 `unavailable` 理由；`detail` 区不显示伪部署。空列表文案："尚无发布。发布由 SDK 首次上报或获准令牌/CI 创建，管理平台不手工创建。"

- [ ] **Step 5: 实现 ProjectReleaseDetailView.vue（C9 容器）**

从路由参数读 `releaseId`，展示发布上下文（版本号），内嵌 `<RouterView>` 或直接渲染 `ProjectSourceMapsView`（子路由挂载）。本 Task 先用占位上下文 + `RouterView`，Task 2 填充 Source Map。

- [ ] **Step 6: 在 handlers.ts 追加 releases MSW**

`http.get('/api/platform/v1/organizations/:organizationId/projects/:projectId/releases')` 返回 `mockReleases()`（含 2 条 release，`status:'available'`），并递增 `handlerControls.listReleasesRequests`。

- [ ] **Step 7: 机械检查**

Run: `pnpm --filter @aurora/console typecheck`（预期通过；若仅本轮 diff 引起的 prettier/TS 错误，最小修复一次）。

- [ ] **Step 8: Commit**

```bash
git add apps/console/src/monitoring/queries.ts apps/console/src/views/project/releases-view-model.ts apps/console/src/views/project/ProjectReleasesView.vue apps/console/src/views/project/ProjectReleaseDetailView.vue apps/console/test/views/project/releases-view-model.test.ts apps/console/src/mocks/handlers.ts
git commit -m "feat(console): PLT-07 C8 releases workspace (DAT-18 releasesListReleases)"
```

---

### Task 2: Source Map management workspace（C9）

**Files:**
- Create: `apps/console/src/views/project/source-maps-view-model.ts`
- Create: `apps/console/src/views/project/ProjectSourceMapsView.vue`
- Create: `apps/console/test/views/project/source-maps-view-model.test.ts`
- Create: `apps/console/test/monitoring/source-maps-commands.test.ts`
- Modify: `apps/console/src/monitoring/queries.ts`（追加 `fetchSourceMapFiles`）
- Modify: `apps/console/src/monitoring/commands.ts`（追加 `uploadSourceMap`/`replaceSourceMap`/`reparseRelease`）
- Modify: `apps/console/src/mocks/handlers.ts`（追加 source-maps GET/POST + replace + reparse）

**Interfaces:**
- Consumes: `OPERATION_ID_SOURCE_MAPS_LIST`/`_UPLOAD`/`_REPLACE`/`_REPARSE`、`createIdempotencyKey`、`ProjectScope`
- Produces: `fetchSourceMapFiles(scope, releaseId, options?): Promise<SourceMapFilesData>`；`SourceMapFilesData = {files: SectionResult<{items: SourceMapFileSummary[]}>}`；`SourceMapFileSummary = {sourceMapFileId, buildPath, digestPrefix, status, reparse:{state, processedCount?, totalCount?, updatedAt?}, uploadedAt, replacedAt?, version}`；命令：`uploadSourceMap(scope, body:{releaseVersion, buildPath, content, digest, buildId?}, options): Promise<UploadResult>`；`replaceSourceMap(scope, releaseId, sourceMapFileId, body:{content, digest, version}, options): Promise<ReplaceResult>`；`reparseRelease(scope, releaseId, options): Promise<ReparseResult>`

- [ ] **Step 1: queries.ts 追加 fetchSourceMapFiles**

按 Task 1 模式；pathParams 含 `{organizationId, projectId, releaseId}`；operationId 用 `OPERATION_ID_SOURCE_MAPS_LIST`。

- [ ] **Step 2: commands.ts 追加三个 Source Map 命令**

按 `monitoring/commands.ts` 既有 `runCommand` 模式：

```ts
export interface UploadSourceMapResult {
  readonly status: string;
  readonly releaseId: string;
  readonly sourceMapFileId?: string;
  readonly currentDigest?: string;
  readonly version?: number;
}

export function uploadSourceMap(
  scope: ProjectScope,
  params: {
    readonly releaseVersion: string;
    readonly buildPath: string;
    readonly content: string;
    readonly digest: string;
    readonly buildId?: string;
  },
  options: IssueCommandOptions,
): Promise<UploadSourceMapResult> {
  const body: Record<string, unknown> = {
    releaseVersion: params.releaseVersion,
    buildPath: params.buildPath,
    content: params.content,
    digest: params.digest,
  };
  if (params.buildId !== undefined) body.buildId = params.buildId;
  return runCommand<UploadSourceMapResult>(
    OPERATION_ID_SOURCE_MAPS_UPLOAD,
    scope,
    { organizationId: scope.organizationId, projectId: scope.projectId },
    body,
    options,
  );
}
```
（`replaceSourceMap` path 含 `releaseId`/`sourceMapFileId`，body `{content, digest, version}`；`reparseRelease` path 含 `releaseId`，body `{}`。）

- [ ] **Step 3: 写 source-maps-view-model.ts**

纯函数：`buildSourceMapsView(source)` → `{files: SectionView<SourceMapFileSummary[]>, selected: SectionView<SourceMapFileSummary>|null, upload: UploadPhase, replace: ReplacePhase, reparse: ReparsePhase}`。`UploadPhase/ReplacePhase/ReparsePhase` 为 `{kind:'idle'|'submitting'|'duplicate'|'replace_conflict'|'succeeded'|'error', message?}` 封闭联合。`fileListToItems(section)` 映射列表状态。`reparseStateLabel(state)` 中文标签（等待处理/处理中/已完成/处理失败）。

- [ ] **Step 4: 写 source-maps-view-model.test.ts（failing）**

断言：文件列表 available → items 透传 + reparse 状态标签正确；empty → 'empty'；上传响应 `duplicate` → 显示幂等复用；`replace_conflict` → 进入确认态（不自动替换）；替换成功 → `succeeded`；命令参数透传（digest/version 原样）。命令测试 source-maps-commands.test.ts 用 `vi.mock('../api/query.js')` 断言 `executeQuery` 收到正确 operationId/body/CSRF。

- [ ] **Step 5: 实现 ProjectSourceMapsView.vue（C9）**

- 文件列表区：`SectionNotice` 非 available；available 渲染每文件 buildPath/digestPrefix/status/reparse 状态（`reparseStateLabel`）。
- 上传区：buildPath 输入 + 文件选择（读文件内容，限制 ≤ 240000 字符契约上限）+ 可选 buildId；releaseVersion 取当前 release。计算 `digest`（用 `crypto.subtle` SHA-256 hex，仅作传输层使用；服务端仍是权威）。提交用 `uploadSourceMap`；`duplicate` → 提示"同路径同摘要已存在，未重复上传"；`replace_conflict` → 显示确认框，确认后调用 `replaceSourceMap`（携带返回 `sourceMapFileId` + `version`）；取消保持当前有效文件。
- 重解析区：`reparseRelease` 按钮 + 成功后显示 `taskCount`。
- 下载：不显示（无 Download contract）。
- 不泄漏 Source Map 内容：上传内容只存在于提交瞬间的内存变量，不进入日志/Store/URL。

- [ ] **Step 6: handlers.ts 追加 source-maps MSW**

`http.get .../releases/:releaseId/source-maps` → `mockSourceMapFiles()`；`http.post .../source-maps` → 读 body 返回 `{data:{status:'uploaded', releaseId, sourceMapFileId}}`；`http.post .../source-maps/:sourceMapFileId/replace` → `{data:{status:'replaced', sourceMapFileId, version}}`；`http.post .../releases/:releaseId/reparse` → `{data:{status:'queued', releaseId, taskCount}}`。全部递增对应 `handlerControls` 计数。

- [ ] **Step 7: 机械检查**（同 Task 1 Step 7）

- [ ] **Step 8: Commit**

```bash
git add apps/console/src/monitoring/queries.ts apps/console/src/monitoring/commands.ts apps/console/src/views/project/source-maps-view-model.ts apps/console/src/views/project/ProjectSourceMapsView.vue apps/console/test/views/project/source-maps-view-model.test.ts apps/console/test/monitoring/source-maps-commands.test.ts apps/console/src/mocks/handlers.ts
git commit -m "feat(console): PLT-07 C9 source-map workspace (DAT-18 list/upload/replace/reparse)"
```

---

### Task 3: Alert rules / instances workspace（C10/C11/C12）

**Files:**
- Create: `apps/console/src/views/project/alerts-view-model.ts`
- Create: `apps/console/src/views/project/alert-rule-form-view-model.ts`
- Create: `apps/console/src/views/project/alert-instance-detail-view-model.ts`
- Create: `apps/console/src/views/project/ProjectAlertsView.vue`
- Create: `apps/console/src/views/project/ProjectAlertRuleFormView.vue`
- Create: `apps/console/src/views/project/ProjectAlertInstanceDetailView.vue`
- Create: `apps/console/test/views/project/alerts-view-model.test.ts`
- Create: `apps/console/test/views/project/alert-rule-form-view-model.test.ts`
- Create: `apps/console/test/views/project/alert-instance-detail-view-model.test.ts`
- Create: `apps/console/test/monitoring/alerts-commands.test.ts`
- Modify: `apps/console/src/monitoring/queries.ts`（追加 `fetchAlertsList`/`fetchAlertsCapability`/`fetchAlertInstanceDetail`）
- Modify: `apps/console/src/monitoring/commands.ts`（追加 `createAlertRule`/`updateAlertRule`）
- Modify: `apps/console/src/mocks/handlers.ts`（追加 alerts 5 条）

**Interfaces:**
- Consumes: DAT-19 五个 operationId、`IssueCommandOptions`（`monitoring/commands.ts` 既有）
- Produces: `AlertsData = {rules: SectionResult<{items: AlertRuleSummary[]}>, instances: SectionResult<{items: AlertInstanceSummary[], count, totalCountStatus}>}`；`AlertCapabilityData`；`AlertInstanceDetailData`；`buildAlertsView(source)`（规则/实例两区 + `tab`）；`buildAlertRuleFormView(source)`（能力驱动表单模型：`metricOptions`/`windowOptions`/`durationOptions`/`cooldownOptions`/`filterDimensions`/`recipients`，指标切换失效字段确认清除）；`buildAlertInstanceDetailView(source)`（状态/直接原因/证据/轨迹/快照）；`createAlertRule`/`updateAlertRule` 命令

- [ ] **Step 1: queries.ts 追加三个 alert Query**

`fetchAlertsList(scope, options?)` → `OPERATION_ID_ALERTS_LIST`；`fetchAlertsCapability(scope, options?)` → `OPERATION_ID_ALERTS_GET_CAPABILITY`；`fetchAlertInstanceDetail(scope, instanceId, options?)` → `OPERATION_ID_ALERTS_GET_INSTANCE`（path 含 instanceId）。类型镜像 contract（`ALERT_INSTANCE_STATES` 等枚举用 string 联合）。

- [ ] **Step 2: commands.ts 追加 createAlertRule/updateAlertRule**

body 为完整 `alertRuleInput`（name?/metric/filters/windowMinutes/triggerThreshold/triggerDurationMinutes/recoveryThreshold/recoveryDurationMinutes?/minSampleCount?/cooldownMinutes/recipientAccountIds + idempotencyKey）；update 额外 `version`。`filters` 为 `{environment: string[], release: string[], pageOrEndpoint: string[], errorSeverity: string[]}`。

- [ ] **Step 3: 写三个 view-model**

- `alerts-view-model.ts`：`buildAlertsView({tab, loading, error, rules, instances})` → `{rules: SectionView, instances: SectionView, canManage: boolean}`（canManage 由服务端 `allowedActions` 或规则列表可用性驱动——不得用角色名判断）；`ruleToSummary`/`instanceToSummary` 投影。
- `alert-rule-form-view-model.ts`：`buildAlertRuleFormView({capability, loading, error})` → 表单模型。提供 `initialRuleDraft(metric)` 按能力初始化默认值；`metricSwitchConflicts(draft, nextMetric)` → 返回失效字段列表（用于"切换指标清除确认"）；`validateLocal(draft)` 只做契约可表达的必填/固定选项校验。比例指标必须显示最小样本数（`isRatio`），数量指标不强制。
- `alert-instance-detail-view-model.ts`：`buildAlertInstanceDetailView({loading, error, detail})` → `{instance: SectionView, evidence: SectionView, transitions: SectionView}`；`stateLabel(state)` 中文（正常/等待触发/已触发/等待恢复/已恢复/计算暂停）。

- [ ] **Step 4: 写三个 view-model 测试（failing）**

断言：alerts 规则/实例两区独立状态（实例查询失败不影响规则区）；C10 双标签 `tab=rules|instances`；C11 能力驱动字段（比例指标出现 minSampleCount，数量指标不出现）；指标切换列出失效字段；C12 状态标签与证据 `completeness` 映射、`evaluation_paused` 显示暂停而非恢复。命令测试断言 operationId/body/CSRF。

- [ ] **Step 5: 实现 ProjectAlertsView.vue（C10）**

双标签页：URL `?tab=rules|instances` 权威（默认 `instances`，按 §7.25）；`rules` 区渲染规则摘要 + 当前评估投影（state/observedValue/sinceAt/lastEvaluatedAt/pauseReason），`project_admin` 可创建/编辑（按钮由服务端 `allowedActions` 驱动，仅 `read` 时隐藏 C11 入口）；`instances` 区渲染实例（state/triggeredAt/recoveredAt/pauseReason），行点击进 C12。`normal`/`pending_trigger`/`triggered`/`pending_recovery`/`recovered`/`evaluation_paused` 用 `stateLabel` 中文展示，`evaluation_paused` 显示 pauseReason。

- [ ] **Step 6: 实现 ProjectAlertRuleFormView.vue（C11）**

创建（`alert-rule-create`）与编辑（`alert-rule-edit`，路由参数 `ruleId`，先 `fetchAlertsList` 找到该规则预填）共用组件。先加载 `alertsGetCapability`（指标/窗口/持续/冷却/接收成员）。指标是第一个业务选择；切换指标若产生失效字段 → 确认清除；比例指标显示最小样本数必填；接收成员至少选一个；提交用 `createAlertRule`/`updateAlertRule`（编辑带 `version`）；成功 → 返回 C10 规则标签（`router.push` 到 `project.alerts?tab=rules`）；`version_conflict`/`idempotency_conflict` → 提示刷新。首版 filterDimensions 恒 `available:false`（服务端返回），故筛选区显示"该指标当前无可用筛选维度"的说明，不渲染可编辑筛选控件。

- [ ] **Step 7: 实现 ProjectAlertInstanceDetailView.vue（C12）**

只读。依次展示：当前状态 + 直接原因（`directReason`）+ 关键时间；规则快照（metric/window/thresholds/duration/minSampleCount/cooldown/filters）；评估证据（observedValue/numerator/denominator/sampleCount/minSampleRequirement/watermarkAt/completeness）；有序业务状态轨迹（transitions）。`evaluation_paused`/`completeness:'insufficient'|'missing'` 显示暂停/数据不足而非恢复。无任何手工操作按钮。

- [ ] **Step 8: handlers.ts 追加 alerts MSW**

`http.get .../alerts/capability`、`.../alerts`（list）、`.../alerts/instances/:instanceId`，`http.post .../alerts/rules`、`.../alerts/rules/:ruleId`。mock 投影按 contract 形状构造（8 指标、5 窗口、5 持续、4 冷却、4 维度 `available:false`、2 接收成员；1 条规则 + 1 条实例）。全部递增对应 `handlerControls`。

- [ ] **Step 9: 机械检查**（同 Task 1 Step 7）

- [ ] **Step 10: Commit**

```bash
git add apps/console/src/monitoring/queries.ts apps/console/src/monitoring/commands.ts apps/console/src/views/project/alerts-view-model.ts apps/console/src/views/project/alert-rule-form-view-model.ts apps/console/src/views/project/alert-instance-detail-view-model.ts apps/console/src/views/project/ProjectAlertsView.vue apps/console/src/views/project/ProjectAlertRuleFormView.vue apps/console/src/views/project/ProjectAlertInstanceDetailView.vue apps/console/test/views/project/alerts-view-model.test.ts apps/console/test/views/project/alert-rule-form-view-model.test.ts apps/console/test/views/project/alert-instance-detail-view-model.test.ts apps/console/test/monitoring/alerts-commands.test.ts apps/console/src/mocks/handlers.ts
git commit -m "feat(console): PLT-07 C10-C12 alert workspace (DAT-19 capability/list/rule/instance)"
```

---

### Task 4: routing / state / focused acceptance

**Files:**
- Modify: `apps/console/src/contracts/route-registry.ts`（C8—C12 路由 lazy 换真实组件）
- Modify: `apps/console/src/monitoring/index.ts`（若新增命令文件则导出）
- Create: `apps/console/test-browser/g12-release-alert-smoke.spec.ts`
- Modify: `apps/console/test/contracts/route-registry.test.ts`（追加新路由断言）
- Modify: `apps/console/test/msw/handlers.test.ts`（若结构允许，追加新 handler 投影断言）

**Interfaces:**
- Consumes: Task 1—3 的全部 view 组件与 query/command
- Produces: C8—C12 全部路由从 `UnavailableView` 换成真实组件；`menu` 状态不变（C8/C10 `menu:true`，C9/C11/C12 `menu:false` + parent 正确）；可达性由既有 `reachability.spec.ts` 的 `REAL_PROJECT_ENTRIES` 扩展或本 Task 的 smoke 验证

- [ ] **Step 1: route-registry.ts 接线**

新增 lazy import（`projectReleasesView`/`projectReleaseDetailView`/`projectSourceMapsView`/`projectAlertsView`/`projectAlertRuleFormView`/`projectAlertInstanceDetailView`），C8—C12 七条路由的 `lazy` 从 `unavailable` 换成真实组件，`unavailableReason: null`。C11 的 create/edit 共用 `projectAlertRuleFormView`。保留 parent 层级（`project.source-maps` parent `project.release-detail`；`project.alert-rule-create`/`edit`/`project.alert-instance-detail` parent `project.alerts`）。

- [ ] **Step 2: route-registry.test.ts 追加断言**

断言 C8—C12 路由 `unavailableReason === null`、lazy 组件可解析（`await lazy()` 返回组件）、parent 关系正确、paramsSchema 保留 `releaseParams`/`sourceMapParams`/`ruleParams`/`instanceParams`。

- [ ] **Step 3: g12-release-alert-smoke.spec.ts**

参考 `reachability.spec.ts`：`startSpaServer` + `setMockScope`（project `prj_test_1`）+ `primeApp`。一条链路：`page.goto('/organizations/org_test_1/projects/prj_test_1/releases')` → 断言发布列表可见（`project-releases-view`）→ 点击第一条发布进入 `project.release-detail` → 断言 Source Map 区（`project-source-maps-view`）可渲染 → 导航到 `project.alerts` → 断言规则/实例双标签可见（`project-alerts-view`）→ 断言无 fatal error（页面无 `UnavailableView` 的"capability-not-provided"占位，且 `getByTestId` 命中真实视图）。

- [ ] **Step 4: 运行 targeted 测试（预算命令 A/B/C）**

A（component/view 状态）:
```
pnpm --filter @aurora/console exec vitest run test/views/project/releases-view-model.test.ts test/views/project/source-maps-view-model.test.ts test/views/project/alerts-view-model.test.ts test/views/project/alert-rule-form-view-model.test.ts test/views/project/alert-instance-detail-view-model.test.ts
```
Expected: 全部 PASS；覆盖 loading/success/empty/error/permission/unavailable。

B（API/router）:
```
pnpm --filter @aurora/console exec vitest run test/monitoring/queries.test.ts test/monitoring/source-maps-commands.test.ts test/monitoring/alerts-commands.test.ts test/contracts/route-registry.test.ts
```
Expected: 全部 PASS；覆盖 Release → Source Map → Alert 操作与路由解析。

C（Chromium smoke）:
```
pnpm --filter @aurora/console build:test && pnpm --filter @aurora/console exec playwright test test-browser/g12-release-alert-smoke.spec.ts --project=chromium
```
Expected: PASS；正常导航 → Releases → Source Map → Alerts 真实可达、无 fatal error。不跑 Firefox/WebKit、不跑全 Console E2E。

- [ ] **Step 5: 组级最终门禁**

```
pnpm --filter @aurora/console typecheck
pnpm --filter @aurora/console build
git diff --check
```
Expected: 全 PASS。若 prettier/format/lint/简单 TS/route manifest/package-entry 机械错误且明确由本轮 diff 引起，最小修复一次，不重跑 A/B/C 全量。

- [ ] **Step 6: Commit**

```bash
git add apps/console/src/contracts/route-registry.ts apps/console/src/monitoring/index.ts apps/console/test-browser/g12-release-alert-smoke.spec.ts apps/console/test/contracts/route-registry.test.ts apps/console/test/msw/handlers.test.ts
git commit -m "feat(console): PLT-07 route wiring + focused acceptance (C8-C12 real views)"
```

---

## Self-Review

**1. Spec coverage:**
- C8 发布列表 + 部署区：Task 1 ✓（部署区因无 Deployment contract 恒 `unavailable`，符合 UX §7.23"只有正式 Deployment Command 存在时才进入页面，否则 C8 保持只读"）。
- C9 Source Map：Task 2 ✓（列表/上传/替换冲突显式确认/重解析；下载 deferred 不显示）。
- C10 双标签：Task 3 ✓（`tab=rules|instances` URL 权威，默认实例，规则/实例独立状态）。
- C11 指标优先自适应表单：Task 3 ✓（能力驱动、指标切换失效确认、比例指标样本必填、至少一接收成员）。
- C12 只读详情：Task 3 ✓（状态/原因/证据/快照/轨迹；`evaluation_paused` 不显示为恢复）。
- routing/state/error/loading/unavailable：Task 4 ✓（route-registry 接线 + 状态映射 + 预算 A/B/C）。

**2. Placeholder scan:** 无 TBD/TODO；每步有具体文件、签名与代码块。

**3. Type consistency:** `fetchReleases`/`fetchSourceMapFiles`/`fetchAlertsList`/`fetchAlertsCapability`/`fetchAlertInstanceDetail`、`uploadSourceMap`/`replaceSourceMap`/`reparseRelease`/`createAlertRule`/`updateAlertRule`、`ReleasesViewState`/`SourceMapsViewState`/`AlertsViewState`/`AlertRuleFormViewState`/`AlertInstanceDetailViewState` 命名在 Task 1—3 间一致；路径参数 `releaseId`/`sourceMapFileId`/`ruleId`/`instanceId` 与 contract pathParams 一致。

**缺陷修正：** C8 部署记录与 C9 原文件下载在 DAT-18 contract 中不存在（无 Deployment/Download 操作），计划明确二者恒 `unavailable` 并在 Global Constraints 声明，不伪造。C11 filterDimensions 服务端返回 `available:false`，计划明确筛选区显示说明而非可编辑控件，避免前端自造筛选数据源。
