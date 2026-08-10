---
title: Aurora 性能指标查询投影（Performance Query Projection）
status: approved
implementation-status: in-progress
approval-status: approved
owner: ingestion/backend
created: 2026-08-10
last-reviewed: 2026-08-10
applies-to: packages/processing-store（`@aurora/processing-store` 性能指标只读查询 Repository）、packages/platform-contract（`@aurora/platform-contract` `performanceListPages` 操作）、apps/platform-api（平台公开 API 性能查询 handler 与项目级授权）
related:
  - ../../AGENTS.md
  - ../../AURORA_RULES.md
  - '../../Aurora 代码规范.md'
  - '../../Aurora 测试规范.md'
  - '../../Aurora 文档规范.md'
  - '../../Aurora ADR 规范.md'
  - ../adr/ADR-021-performance-aggregate-and-bounded-sample-storage.md
  - ../architecture/performance-metric-aggregate-and-bounded-sample-store.md
  - ../architecture/performance-event-processor.md
  - ../protocol/performance-event-contract.md
  - ../architecture/platform-contract-foundation.md
  - ../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md
supersedes: none
review-cycle: performance-query-schema-or-contract-change
---

# Aurora 性能指标查询投影（DAT-17）

## 1. 定位、效力与当前状态

本文冻结性能指标查询投影（DAT-17）第一增量：把已实施的性能指标聚合存储（`performance_metric_buckets`，accepted ADR-021，DAT-08）中由真实 Performance Processor（DAT-09）写入的数据，形成**正式、安全、项目隔离的公开 Query 投影**，暴露为平台公开 API 操作 `performanceListPages`（C6 性能监控页面 `project.performance` Route Target）。它不建设任何写侧能力，只新增只读查询 Repository、契约操作与平台 handler。

**批准状态**：本文由用户于 2026-08-10 预先批准（`status: approved`）。`implementation-status` 将在 DAT-17 独立验收后更新为 `implemented`。本文由 accepted ADR-021、approved 性能事件协议契约、approved C6 性能监控 UX/UI 设计（§9.19）、G10 授权模型与平台 Query 通用约束无歧义派生；自动审批依据见规格自检节。

**声明边界**：本模块只公开服务端**真实存在**的数据。`performance_metric_buckets` 聚合键为 `(project_id, bucket_start, metric_name, unit)`，**没有页面/路由维度**；`performance_event_samples` 在 V1 不写入（DAT-09 产品边界：V1 聚合全部有效性能事件、不持久化有界诊断样本）。因此：
- **页面/路由维度不可枚举** → `pages` 区恒为 `unavailable`（真实数据中不存在页面标识）；
- **percentile/直方图/超标比例** 原材料按 ADR-021 明确 deferred → `percentiles` 区恒为 `unavailable`，**不伪造**；
- 本 Query 公开的是**项目级性能指标聚合**（LCP/INP/CLS/页面加载耗时），来自 `performance_metric_buckets` 的真实 count/sum/max；`mean = value_sum / observed_count` 是真实聚合，非采样外推。

## 2. 元数据、Owner 和范围

- **Owner**：ingestion/backend
- **适用范围**：
  - `packages/processing-store`：性能指标项目级聚合只读查询 Repository（无新 Migration）；
  - `packages/platform-contract`：`performanceListPages` 操作定义、request/response schema、从 `BLOCKED_OPERATIONS` 移入稳定操作注册表、OpenAPI 生成与漂移门禁；
  - `apps/platform-api`：`GET /api/platform/v1/organizations/:organizationId/projects/:projectId/performance` handler、项目级查看授权（复用 DAT-16 `requireProjectAccess`）、错误映射与安全投影；
  - 正式规格、README、单元/真实 PostgreSQL 集成测试、全仓质量门禁与 OpenAPI/漂移门禁。
- **明确非职责**：
  - 修改 `performance_metric_buckets`/`performance_metric_event_applications`/`performance_event_samples` 表结构、`persistPerformanceMetricContribution`/`persistPerformanceEventSample` Repository 或 Performance Processor（DAT-09）；
  - 页面/路由维度写侧、样本选择策略执行器（deferred，需独立批准）；
  - percentile/直方图/t-digest/动态基线/采样外推/性能评分；
  - 环境、发布版本维度过滤（数据中不存在，见 §8）；
  - 逐次性能访问记录、完整页面数据、Console 业务页面（属 G11）、任何写操作、CSRF。

## 3. 模块选择依据

- C6 性能监控 UX（§9.19）明确"安全页面/路由列表 + 页面多指标详情 + 时间变化"由服务端指标查询返回，且"仓库尚无页面性能指标、安全页面列表或选中页面详情的正式 API……不确定最终接口路径、指标公式、阈值、筛选字段、分页、图表或错误码"——具体契约正是本模块要正式化的对象；
- 数据写侧已稳定：`performance_metric_buckets`（ADR-021 implemented）与 `createPerformanceEventProcessor`（DAT-09）均通过真实 PostgreSQL 17.10 验证，性能聚合已由真实 Worker 写入；
- G10/DAT-16/DAT-20 已实现平台 Query 通用能力与项目级授权（`requireProjectAccess` 直接复用）；
- 用户 G02 指令明确：只公开正式支持的 LCP/INP/CLS/load duration 等指标；Store 没有 percentile/页面能力时使用 approved unavailable/partial 语义，不得为页面设计伪造数据。

## 4. 数据来源与查询语义

查询在同一 PostgreSQL 数据库内只读 `@aurora/processing-store` 的 `performance_metric_buckets` 表：

| 来源 | 用途 | 语义 |
|---|---|---|
| `performance_metric_buckets` | 项目级性能指标聚合（完整） | `bucket_start` UTC 一分钟桶；`(metric_name, unit)` 聚合键（`lcp`/`inp`/`cls`/`page_load`，`millisecond`/`ratio`）；`observed_count`/`value_sum`/`value_max`。覆盖窗口内**已接收并已处理**的性能贡献，不按采样率外推 |

**关键查询语义**（严格遵守 C6/用户边界）：
1. **页面维度不存在**：性能事件协议（performance-event-contract）与聚合桶均无页面/路由字段，`pages` 区恒 `unavailable`。`performanceListPages` 保留为 C6 稳定 Route Target，但 v1 只返回项目级聚合与真实完整性元数据，**不伪造页面列表**。
2. **percentile 不可用**：ADR-021 明确 percentile/直方图原材料 deferred，`percentiles` 区恒 `unavailable`。`mean` 由真实 `value_sum/observed_count` 计算，是聚合事实而非 percentile。
3. **缺失不是 0**：无桶的窗口 → `metrics` 区 `empty`；指标按窗口内实际出现的 `(metric_name, unit)` 返回，不补零；`dataThrough`/`isPartial` 表达数据写入水位。

## 5. 公开契约

### 5.1 操作

```
operationId: performanceListPages
domain: monitoring-projections
authLevel: session
method: GET
path: /api/platform/v1/organizations/:organizationId/projects/:projectId/performance
page: project.performance
csrf: false
idempotency: false
tags: [monitoring, performance]
```

### 5.2 请求

- `pathParams`：`organizationId: OrganizationId`、`projectId: ProjectId`；
- `query`：
  - `timeRange`（可选）：`start`/`end`（RFC 3339 UTC，`utcTimestamp`），默认最近 24 小时；窗口上限 7 天；`start < end`；`end` 不得明显晚于服务端当前时间（允许时钟偏差）。非法 → `structural_error`。

### 5.3 响应（200）

使用 `queryResponse` 模式（`data` + `meta.requestId/readAt/normalizedQuery` + `allowedActions` + `navigationTargets`）：

```text
data:
  metrics: sectionResult(PerformanceMetricSummary)
  pages: sectionResult(obj({}))        # 恒 { status: 'unavailable', reason }
  percentiles: sectionResult(obj({}))  # 恒 { status: 'unavailable', reason }
meta, allowedActions, navigationTargets
```

- `PerformanceMetricSummary`（`metrics` 的 `data`）：
  - `metrics`: `MetricAggregate[]`（窗口内按 `(metric_name, unit)` 分组的聚合）：
    - `metricName`: `enum_(['lcp','inp','cls','page_load'])`（来自 event-schema `PerformanceMetricName` 公共常量）；
    - `unit`: `enum_(['millisecond','ratio'])`（`PerformanceMetricUnit`）；
    - `observedCount`: `num(0)`（`SUM(observed_count)`）；
    - `valueSum`: `num(0)`（`SUM(value_sum)`）；
    - `valueMax`: `num(0)`（`MAX(value_max)`）；
    - `mean`: `num(0)`（`value_sum / observed_count`，服务端计算，`observedCount > 0` 时；`observedCount === 0` 不出现该行）；
  - `dataThrough`: `optional(utcTimestamp)`（窗口内桶最新 `updated_at`）；
  - `isPartial`: `boolean`（`dataThrough !== null && dataThrough < end`）。
- `pages`: 恒 `{ status: 'unavailable', reason: 'page dimension not in performance data (deferred)' }`。
- `percentiles`: 恒 `{ status: 'unavailable', reason: 'percentiles deferred (ADR-021)' }`。

### 5.4 错误

`structural_error`、`authentication`、`authorization`、`not_found`（org/project 不存在或项目不属于该 org，不泄露存在性）、`rate_limited`、`authority_unavailable`。

## 6. 授权与隐私

- **项目级查看权限**：handler 复用 G10 `requireSession` + `effectivePermissions` + DAT-16 `requireProjectAccess`（org manager 或 `project_members`；跨 org 404 无存在性泄露）；无权限 → 403 且**不调用数据 Repository**。
- **隐私硬边界**：只返回聚合计数/求和/最大值/均值与时间水位；不返回任何原始事件、`performance_event_samples` 样本、完整页面数据、Cookie/Authorization；缺失一律 `empty`/`unavailable`，不伪造 0 或评分。

## 7. 包位置与包结构

- `@aurora/processing-store`（`data` 层，无新 Migration）新增：
  - `src/performance-metric-query-types.ts`、`src/performance-metric-query-repository.ts`：`queryPerformanceMetricSummary(pool, {projectId, startIso, endIso})` → `{ metrics: MetricAggregate[]; dataThrough: string | null }`（参数化 SQL，`GROUP BY metric_name, unit`；`metricName`/`unit` 用 event-schema 常量校验，未知值 `invalid_input`；数据库错误 → `ProcessingStoreError`）；
  - 包根 `index.ts` 导出。
- `@aurora/platform-contract`（`contract` 层）：
  - `src/monitoring/performance.ts`（操作常量、pathParams/query/response schema）；
  - `src/registry/operations.ts`（从 `BLOCKED_OPERATIONS` 移除、加入稳定操作）；
  - OpenAPI 重新生成 + 漂移门禁通过。
- `apps/platform-api`（`service` 层）：
  - `src/routes/performance.ts`（handler：parseInput → requireUuidParams → requireSession → effectivePermissions → requireProjectAccess → 查询 → 组装 → serializeOutput）；
  - `src/app.ts` 注册路由。

## 8. 明确不暴露（deferred / blocked）

- 页面/路由维度（数据中不存在）；
- 环境、发布版本维度过滤；
- percentile/直方图/超标比例/性能评分/动态基线；
- 有界性能诊断样本（`performance_event_samples` 未写入，样本选择策略 deferred）；
- 逐次性能访问记录、完整页面数据。

## 9. 测试策略

- 单元测试（聚合组装、`mean` 计算、未知 metric/unit 拒绝、窗口校验）；
- 真实 PostgreSQL 17.10 集成测试（`AURORA_TEST_DATABASE_URL`）：
  - 写侧种子（`persistPerformanceMetricContribution` 多桶多指标）后查询：按 `(metric_name, unit)` 分组正确、`observedCount`/`valueSum`/`valueMax`/`mean` 正确、`dataThrough`/`isPartial` 语义；
  - 空窗口 → `metrics` `empty`；
  - `pages`/`percentiles` 恒 `unavailable`（通过 handler 层断言）；
  - project isolation（两项目不串扰）；
  - 隐私负例（响应不含原始样本/事件/内部列）；
- 契约测试（操作注册、OpenAPI 生成、漂移门禁）；
- 授权集成测试（manager/member/403/404，无权限不查数据）；
- 全仓质量门禁 + `openapi:check`。

## 10. 非目标与回归约束

- 不修改 `performance_metric_buckets` 写侧、`persistPerformanceMetricContribution`/`persistPerformanceEventSample`、Performance Processor（DAT-09）、Worker、ingestion-api、Console；
- 不新增依赖、不新增 Migration；
- 不修改 DAT-16/DAT-20 已实施契约（`requestsListEndpoints`/`diagnosticsGetDataStatus` 保持）；
- 无新 ADR（`performanceListPages` 已在 `BLOCKED_OPERATIONS` 预留，契约定义为附加式公开能力）。

## 11. 规格自检

- **占位符扫描**：无 TBD/TODO；所有字段、枚举、计算、错误码、测试路径已冻结；
- **内部一致性**：`metrics` 数据来源与 §4 对应；`pages`/`percentiles` 恒 unavailable 与 §1/§4/§5.3 一致；`mean` 定义唯一；
- **范围检查**：单模块（只读查询 + 契约 + handler + 授权），可一次实施；无写侧、无 UI、无 percentile 伪造、无新 Migration；
- **歧义检查**："页面不可枚举"已显式（§1/§4/§5.3）；`performanceListPages` 名称保留为稳定 Route Target 而 v1 只返回项目级聚合，已在 §1/§4 显式说明。
