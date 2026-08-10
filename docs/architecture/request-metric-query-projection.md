---
title: Aurora 请求指标查询投影（Request Metric Query Projection）
status: approved
implementation-status: implemented
approval-status: approved
owner: ingestion/backend
created: 2026-08-10
last-reviewed: 2026-08-10
applies-to: packages/processing-store（@aurora/processing-store）请求指标/安全样本查询 Repository、packages/platform-contract（@aurora/platform-contract）`requestsListEndpoints` 操作、apps/platform-api（平台公开 API 查询 handler 与项目级授权）
related:
  - ../../AGENTS.md
  - ../../AURORA_RULES.md
  - '../../Aurora 代码规范.md'
  - '../../Aurora 测试规范.md'
  - '../../Aurora 文档规范.md'
  - '../../Aurora ADR 规范.md'
  - ../adr/ADR-019-request-event-aggregation-and-bounded-diagnostic-sample-storage.md
  - ../adr/ADR-020-idempotent-request-metric-bucket-aggregation.md
  - ../architecture/request-metric-aggregate-store.md
  - ../architecture/request-event-sample-processing-store.md
  - ../architecture/request-sample-selection-policy.md
  - ../protocol/request-event-contract.md
  - ../architecture/platform-contract-foundation.md
  - ../architecture/platform-frontend-shell.md
  - ../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md
supersedes: none
review-cycle: request-metric-query-schema-or-contract-change
---

# Aurora 请求指标查询投影（DAT-16）

## 1. 定位、效力与当前状态

本文冻结请求指标查询投影（DAT-16）第一增量：把已实施的请求指标聚合存储（`request_metric_buckets`，accepted ADR-020）与请求事件安全样本存储（`request_event_samples`，accepted ADR-019）中的数据，经真实处理链写入后，形成**正式、安全、项目隔离的公开 Query 投影**，暴露为平台公开 API 操作 `requestsListEndpoints`（C5 请求监控页面 `project.requests` Route Target）。它不建设任何写侧能力，只新增只读查询 Repository、契约操作与平台 handler。

**批准状态**：本文由用户于 2026-08-10 预先批准（`status: approved`），并经独立验收后于 2026-08-10 更新为 `implementation-status: implemented`。本文由 accepted ADR-019/020、approved 请求事件协议契约、approved C5 请求监控 UX/UI 设计（§7.20/§8.18/§9.18）、G10 授权模型与平台 Query 通用约束无歧义派生；自动审批依据见规格自检节。

**独立验收证据（2026-08-10，DAT-16 全量 Task 实施完成）**：
- 契约层：`@aurora/platform-contract` 契约测试 226 passed（含 `requestsListEndpoints` 长 URL keyset 游标 >64/512 字符的请求/响应往返用例），`test:package` 3 passed；OpenAPI 重新生成 `docs/api/platform-openapi-v1.yaml`（`paginationMeta.cursor`/`nextCursor` 与 `requestsListEndpointsQuery.cursor` maxLength 64/512 → 4096，非破坏性放宽）通过 `openapi:platform:lint`；`@aurora/platform-contract-drift` 漂移门禁 19 passed（compat baseline 再生成逐字节一致、兼容性差异检测全绿）。
- 查询层：`@aurora/processing-store` 单元测试 99 passed + 真实 PostgreSQL 17.10 集成测试 69 passed（含长 URL 接口经 keyset 游标 encode→查询→decode 往返、游标长度 >64 的用例）。
- 服务层：`@aurora/platform-api` 单元测试 32 passed + 真实 PostgreSQL 17.10/Redis 集成测试 106 passed（含端到端长游标分页：首页返回 >64 字符 `nextCursor` 200，第二页携带该游标 200）；`platform-api`/`processing-store`/`platform-contract` typecheck 全绿。
- 门禁：`pnpm platform-contract:generate && pnpm openapi:platform:lint && pnpm --filter @aurora/platform-contract-drift test` 通过；`git diff --check` 干净。

**声明边界**：本模块只公开服务端**真实存在**的数据。请求指标聚合桶只有 `method/outcome/status_code` 低基数维度，**没有**接口/路由维度；因此"规范化接口列表"只能从**有界安全诊断样本**（`request_event_samples`）推导，是部分（`partial`）且带采样/完整性元数据的列表，**不是**完整接口枚举。percentile/直方图原材料按 ADR-020 明确 deferred，本 Query 一律以 `unavailable` 表达，**不伪造**。任何缺失数据不得解释为 0。

## 2. 元数据、Owner 和范围

- **Owner**：ingestion/backend
- **适用范围**：
  - `packages/processing-store`：请求指标汇总与接口列表只读查询 Repository（无新 Migration）；
  - `packages/platform-contract`：`requestsListEndpoints` 操作定义、request/response schema、从 `BLOCKED_OPERATIONS` 移入稳定操作注册表、OpenAPI 生成与漂移门禁；
  - `apps/platform-api`：`GET /api/platform/v1/organizations/:organizationId/projects/:projectId/requests` handler、项目级查看授权（复用 G10 授权模型）、错误映射与安全投影；
  - 正式规格、README、单元/真实 PostgreSQL 集成测试、全仓质量门禁与 OpenAPI/漂移门禁。
- **明确非职责**：
  - 修改请求事件协议契约、`request_metric_buckets`/`request_metric_event_applications`/`request_event_samples` 表结构、`persistRequestMetricContribution`/`persistRequestEventSample` Repository 或 Worker 处理链；
  - 新增接口/路由维度、归一化路径段、高基数聚合或写侧改动（需独立 approved 规格）；
  - percentile/直方图/采样外推/动态基线；
  - 环境、发布版本、页面/来源维度过滤（数据中不存在，见 §8）；
  - 请求正文/响应正文/Cookie/Authorization/完整查询参数/完整逐请求历史；
  - Console 业务页面（属 G11）、任何写操作、CSRF。

## 3. 模块选择依据

- C5 请求监控 UX（§9.18）明确"规范化接口列表 + 选中接口详情 + 时间变化"由服务端指标查询返回，且"仓库尚无请求指标、规范化接口列表或选中接口详情的正式 API……不确定最终接口路径、指标公式、筛选字段、分页、图表或错误码"——具体契约正是本模块要正式化的对象；
- 数据写侧已稳定：`request_metric_buckets`（ADR-020 implemented）与 `request_event_samples`（ADR-019 implemented）均通过真实 PostgreSQL 17.10 集成验证，Request Processor（DAT 系列）已向桶写入真实贡献；
- G10 已实现平台 Query 通用能力（`queryResponse`/`pageResult`/`timeRange`/`sectionResult`）与 org 授权，本模块新增**首个项目级查询**并复用该授权模型；
- 用户 G02 指令明确：只公开服务端真实存在的数据，使用 approved unavailable/partial 语义，不把缺失解释为 0。

## 4. 数据来源与查询语义

查询在同一 PostgreSQL 数据库内只读 `@aurora/processing-store` 的两张表（平台与接入共享同一数据库，见 Public Preview 与本地测试拓扑）：

| 来源 | 用途 | 语义 |
|---|---|---|
| `request_metric_buckets` | 项目级/方法级指标汇总（完整） | `bucket_start` UTC 一分钟桶；`method`/`outcome`/`status_code` 低基数键；`observed_count`/`failure_count`/`slow_count`/`duration_sum_ms`/`duration_max_ms`。覆盖在窗口内**已接收并已处理**的事件，不按采样率外推 |
| `request_event_samples` | 有界安全诊断样本 → 规范化接口列表（部分） | `sample_body` 为协议安全六字段白名单（`method`/`url`/`startedAt`/`durationMs`/`outcome`/`statusCode`，URL 已剥离查询与片段但**不做路径动态段归一化**）；样本按 DAT 样本选择策略只覆盖选定请求（默认 slow≥3000ms / failure 429+500—599 / 额外监控状态码），是诊断子集而非完整历史 |

**关键查询语义**（严格遵守 C5/用户边界）：
1. **`accepted ≠ processed/queryable`**：`request_metric_buckets` 只包含 Worker 处理过的贡献；窗口内被可靠接收但尚未处理的批次不计入汇总。`summary.dataThrough` 报告数据实际写入的最近时间，`isPartial` 表达"数据只到 `dataThrough` 而查询窗口延伸到 `end`"。
2. **接口列表来自有界样本**：列表只包含窗口内 `request_event_samples` 中实际出现的方法+安全 URL；`endpoints.completeness` 明确标记 `source: 'diagnostic_samples'`、`bounded: true`、`isPartial: true`。不以样本推导精确比率/零值（C5：分母/采样未知时不显示伪精确比率）。
3. **缺失不是 0**：无桶/无样本的窗口返回 `empty`（`sectionStatus: 'empty'`），不返回全零行；percentile 返回 `unavailable`（原材料 deferred）。

## 5. 公开契约

### 5.1 操作

```
operationId: requestsListEndpoints
domain: monitoring-projections
authLevel: session
method: GET
path: /api/platform/v1/organizations/:organizationId/projects/:projectId/requests
page: project.requests
csrf: false
idempotency: false
tags: [monitoring, requests]
```

### 5.2 请求

- `pathParams`：`organizationId: OrganizationId`、`projectId: ProjectId`；
- `query`：
  - `timeRange`（必填）：`start`/`end`（RFC 3339 UTC 时间戳，`utcTimestamp`）；
  - `cursor`（可选）：字符串，接口列表 keyset 游标；
  - `limit`（可选）：`1..100`，默认 `50`；
- 服务端校验：`start < end`；窗口上限 90 天；`end` 不得明显晚于服务端当前时间（允许时钟偏差，见实现细节）。非法 → `structural_error`。

### 5.3 响应（200）

使用 `queryResponse` 模式（`data` + `meta.requestId/readAt/normalizedQuery` + `allowedActions` + `navigationTargets`）：

```text
data:
  summary: sectionResult(RequestAggregateSummary)
  endpoints: sectionResult(pageResult(RequestEndpointSummary))
  percentiles: sectionResult(empty)   # status: 'unavailable', reason 固定
meta:
  requestId, readAt, normalizedQuery
allowedActions, navigationTargets
```

- `RequestAggregateSummary`（`summary` 的 `data`）：
  - `methods`: `MethodAggregate[]`，按 `method` 分组的窗口聚合（`observedCount`/`failureCount`/`slowCount`/`durationSumMs`/`durationMaxMs`/`outcomes: {outcome, count}[]`）；
  - `dataThrough`: `utcTimestamp`（窗口内桶的最新 `updated_at`）；
  - `isPartial`: `boolean`（`dataThrough < end` 时为 `true`）。
- `RequestEndpointSummary`（`endpoints` 的 `items`）：
  - `endpointId`: `string`（服务端稳定标识，`method + ' ' + url` 的确定性哈希，十六进制小写）；
  - `method`: `RequestMethod`（来自 event-schema 公共常量）；
  - `url`: `string`（协议安全 URL：已剥离查询/片段、无凭据、`1..2048`）；
  - `sampleCount`: `num(0)`（窗口内该接口的样本行数）；
  - `outcomeCounts`: `{outcome, count}[]`（样本事实，仅来自样本）；
  - `dataThrough`: `utcTimestamp`（该接口最新样本 `created_at`）；
  - `isPartial`: `true`（恒为 true：样本是有界诊断子集）；
  - `completeness`: `{ source: 'diagnostic_samples', bounded: true }`。
- `percentiles`: `{ status: 'unavailable', reason }`（固定 reason 文本，不返回任何伪值）。

### 5.4 分页

`endpoints` 使用 cursor 分页（keyset）：`(method, url)` 复合有序键；`pagination.totalCount` = 窗口内不同接口数（`available`，`totalCountStatus: 'available'`）。`summary` 不分页。

### 5.5 错误

`structural_error`、`authentication`、`authorization`、`not_found`（org/project 不存在或项目不属于该 org，不泄露存在性）、`rate_limited`、`authority_unavailable`。

## 6. 授权与隐私

- **项目级查看权限**：handler 复用 G10 `requireSession` + `effectivePermissions`（org 成员判定）；对 `projectId` 增加**项目访问检查**：org manager（owner/admin）可看 org 下全部项目，普通成员只可看其 `project_members` 行存在的项目；无权限 → 403，且**不调用数据 Repository**（不泄露数据存在性）。该检查由 `@aurora/platform-project-governance` 提供只读函数（复用 `listProjects` 的 membership 过滤语义），`apps/platform-api` `_shared.ts` 增加 `requireProjectAccess` 守卫。
- **隐私硬边界**：不返回请求/响应正文、Cookie、Authorization、完整查询字符串、完整 URL 导出、内部数据库标识、`sample_body` 原文以外的任何字段；`url` 只来自协议已验证的安全投影；任何字段缺失即 `partial/unavailable`，不伪造 0。

## 7. 包位置与包结构

- `@aurora/processing-store`（`data` 层，无新 Migration）新增只读查询：
  - `src/request-metric-query-types.ts`（输入/结果类型，复用 `RequestMethod`/`RequestOutcome` 来自 event-schema）；
  - `src/request-metric-query-repository.ts`（`queryRequestMetricSummary`/`queryRequestEndpointPage`，参数化 SQL、keyset 分页、稳定错误）；
  - 包根 `index.ts` 追加导出；
- `@aurora/platform-contract`（`contract` 层）：
  - `src/monitoring/request-metrics.ts`（操作常量、pathParams/query/response schema）；
  - `src/registry/operations.ts`（从 `BLOCKED_OPERATIONS` 移除、加入稳定操作数组）；
  - OpenAPI 重新生成 + 漂移门禁通过；
- `apps/platform-api`（`service` 层）：
  - `src/routes/requests.ts`（handler，遵循 audit GET-query 模式）；
  - `src/routes/_shared.ts` 增加 `requireProjectAccess`；`src/app.ts` 注册路由；
  - `src/authorization.ts` 或 `_shared.ts` 复用 `effectivePermissions`，新增项目成员检查。

## 8. 明确不暴露（deferred / blocked）

- 环境、发布版本、页面/来源维度过滤：当前请求事件协议与处理链**无**这些维度，契约不提供对应筛选；
- 接口/路由维度聚合：`request_metric_buckets` 无路由键，本模块不新增写侧维度；
- percentile/直方图/动态基线/采样外推：ADR-020 deferred，`unavailable`；
- URL 路径动态段归一化：协议层明确不做（request-event-contract §2），接口身份 = 方法+协议安全 URL 原文；高基数接口由 `endpointId` 哈希稳定标识并在完整性元数据中说明。

## 9. 测试策略

- 单元测试（仓库纯逻辑：分页游标编解码、时间范围校验、端点身份哈希、outcome 汇总）；
- 真实 PostgreSQL 17.10 集成测试（`AURORA_TEST_DATABASE_URL`）：
  - 写侧种子后查询：窗口内聚合正确（method 分组、failure/slow/duration）、`dataThrough`/`isPartial` 语义；
  - 样本接口列表：只含窗口内有样本的接口、分页、totalCount、`isPartial: true`；
  - 空窗口 → `empty`；无 percentile → `unavailable`；
  - 隐私负例：不返回 body/cookie/query 原文、不返回 DB 内部列；
- 契约测试：`@aurora/platform-contract` 操作注册、OpenAPI 生成与漂移门禁；
- 授权集成测试：project manager 可读、普通成员按项目过滤、无权限 403 且不查询数据、项目不属于 org 时 404；
- 全仓质量门禁 + `openapi:check`。

## 10. 非目标与回归约束

- 不修改 `request-metric-aggregate-store.md`/`request-event-sample-processing-store.md` 既有契约；
- 不引入新依赖、不新增 Migration、不改变任何写侧 Repository；
- 不修改 Worker、`POST /v1/batches`、ingestion-api、Console；
- 无新 ADR（`requestsListEndpoints` 已在 `BLOCKED_OPERATIONS` 预留，契约定义为附加式公开能力）。

## 11. 规格自检

- **占位符扫描**：无 TBD/TODO；所有字段、语义、错误码、测试路径已冻结；
- **内部一致性**：`summary`/`endpoints`/`percentiles` 与 §4 数据来源一一对应；`isPartial`/`dataThrough`/`completeness` 语义在 §1/§4/§5.3 一致；
- **范围检查**：单模块（契约+只读查询+handler+授权），可一次实施；无写侧、无 UI、无 percentile；
- **歧义检查**："接口列表来自有界样本"已显式（§4 语义 2、§5.3 `completeness`）；时间窗口上限、`isPartial` 判定已冻结。
