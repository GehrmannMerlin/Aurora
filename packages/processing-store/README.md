# Aurora Processing Store

## 模块定位

`@aurora/processing-store` 承载错误事件 occurrence 明细处理存储第一增量、请求事件安全样本处理存储第一增量、请求指标聚合存储第一增量与性能指标聚合/有界样本存储第一增量（`packages/processing-store`）。错误部分为未来错误事件 processor 提供稳定存储边界（`error_event_occurrences`，accepted [ADR-018](../../docs/adr/ADR-018-error-event-occurrence-processing-storage.md)）；请求样本部分为"聚合主路径＋有限安全诊断样本"边界中的样本存储能力（`request_event_samples`，accepted [ADR-019](../../docs/adr/ADR-019-request-event-aggregation-and-bounded-diagnostic-sample-storage.md)）；请求指标部分为幂等请求指标桶聚合（`request_metric_buckets` + `request_metric_event_applications`，accepted [ADR-020](../../docs/adr/ADR-020-idempotent-request-metric-bucket-aggregation.md)）；性能部分为聚合主路径＋有界安全诊断样本（`performance_metric_buckets` + `performance_metric_event_applications` + `performance_event_samples`，accepted [ADR-021](../../docs/adr/ADR-021-performance-aggregate-and-bounded-sample-storage.md)）。

## 职责

- `error_event_occurrences` 表与 Migration（追加式，可 up/down，应用启动不自动执行）；`(project_id, event_id)` 唯一幂等；`persistErrorEventOccurrence` Repository；
- `request_event_samples` 表与 Migration；`(project_id, event_id)` 唯一幂等；`persistRequestEventSample` Repository（只持久化已由上游选中的合法 Request 事件的安全投影）；
- `request_metric_buckets` + `request_metric_event_applications` 表与 Migration；`persistRequestMetricContribution` Repository（UTC 一分钟桶 + 最小事件应用登记 + 同事务 UPSERT + `(project_id, event_id)` 幂等）；
- `performance_metric_buckets` + `performance_metric_event_applications` 表与 Migration；`persistPerformanceMetricContribution` Repository（UTC 一分钟桶 + 最小事件应用登记 + 同事务 UPSERT + `(project_id, event_id)` 幂等 + `(project_id, bucket_start, metric_name, unit)` 聚合键 + `observed_count`/`value_sum`/`value_max`）；
- `performance_event_samples` 表与 Migration；`persistPerformanceEventSample` Repository（`(project_id, event_id)` 幂等 + 受协议约束 `sample_body` 白名单投影）；
- 请求指标查询投影只读 Repository（DAT-16）：`queryRequestMetricSummary`（窗口内按 method 汇总）与 `queryRequestEndpointPage`（有界样本接口列表，keyset 分页、`totalCount`、`(method, url)` 游标）——由 [请求指标查询投影正式规格](../../docs/architecture/request-metric-query-projection.md) 承载；
- 接入诊断可查询证据只读查询（DAT-20）：`queryProjectQueryableEvidence`（`error_event_occurrences`/`request_metric_buckets`/`performance_metric_buckets` 三表行数证据，按项目隔离、无新 Migration）——由 [接入诊断状态查询正式规格](../../docs/architecture/ingestion-diagnostics-status-query.md) 承载；
- 性能指标查询投影只读 Repository（DAT-17）：`queryPerformanceMetricSummary`（半开窗口 `[startIso, endIso)` 内按 `(metric_name, unit)` 分组聚合：`observedCount`/`valueSum`/`valueMax`/`mean` + `dataThrough`；`observedCount === 0` 行不返回、空窗口 → `metrics: []`/`dataThrough: null`，无新 Migration）——由 [性能指标查询投影正式规格](../../docs/architecture/performance-query-projection.md) 承载；
- 顶层 `unknown` 输入校验 + 通过 `@aurora/event-schema` 根入口验证事件；
- 稳定可判别结果（`inserted`/`duplicate`/`applied`/`invalid_input`/`temporarily_unavailable`）；
- 协议漂移测试与真实 PostgreSQL 17 集成测试。

## 非职责

- 不实现具体错误/请求/性能事件 processor、样本选择策略执行器、isFailure/isSlow 分类、percentile/直方图、超标比例、采样外推；
- 不硬编码慢请求阈值（3000ms）、HTTP 429、HTTP 500—599 或额外状态码；
- 除 DAT-16 已实现的请求指标/接口列表只读查询与 keyset 分页、DAT-20 已实现的接入诊断可查询证据只读查询、DAT-17 已实现的性能指标查询投影只读查询外，不实现其他查询、过滤、Issue 分组、fingerprint、Source Map、搜索、告警；
- 不冻结数据保留天数、不自动删除、不创建定时清理任务；
- 不修改 Inbox、Worker、event-schema、ingestion-api、OpenAPI、request-event-contract、performance-event-contract；
- 本轮不把请求样本/请求指标存储/性能存储接入 Worker 生产 composition root；
- 不创建 CI、RDS、IaC、容量基准。

## 对外接口

包根导出：

```ts
import {
  persistErrorEventOccurrence,
  persistRequestEventSample,
  persistRequestMetricContribution,
  persistPerformanceMetricContribution,
  persistPerformanceEventSample,
  queryRequestMetricSummary,
  queryRequestEndpointPage,
  queryProjectQueryableEvidence,
  type ProjectQueryableEvidence,
  queryPerformanceMetricSummary,
  type MetricAggregate,
  type PerformanceMetricQueryWindow,
  type PerformanceMetricSummary,
  ProcessingStoreError,
  type PersistErrorEventOccurrenceInput,
  type PersistErrorEventOccurrenceResult,
  type PersistRequestEventSampleInput,
  type PersistRequestEventSampleResult,
  type PersistRequestMetricContributionResult,
  type RequestMetricContributionInput,
  type PerformanceMetricContributionInput,
  type PersistPerformanceMetricContributionResult,
  type PersistPerformanceEventSampleInput,
  type PersistPerformanceEventSampleResult,
} from '@aurora/processing-store';
```

```ts
export interface PersistErrorEventOccurrenceInput {
  readonly projectId: string;
  readonly eventEnvelope: unknown;
}

export type PersistErrorEventOccurrenceResult =
  | { readonly status: 'inserted'; readonly occurrenceId: string }
  | { readonly status: 'duplicate' }
  | { readonly status: 'invalid_input'; readonly code: string }
  | { readonly status: 'temporarily_unavailable' };

export function persistErrorEventOccurrence(
  pool: Pool,
  input: unknown,
): Promise<PersistErrorEventOccurrenceResult>;

export interface PersistRequestEventSampleInput {
  readonly projectId: string;
  readonly eventEnvelope: unknown;
}

export type PersistRequestEventSampleResult =
  | { readonly status: 'inserted'; readonly sampleId: string }
  | { readonly status: 'duplicate' }
  | { readonly status: 'invalid_input'; readonly code: string }
  | { readonly status: 'temporarily_unavailable' };

export function persistRequestEventSample(
  pool: Pool,
  input: unknown,
): Promise<PersistRequestEventSampleResult>;
```

禁止导入 `src`、`internal`、测试文件或未导出的子路径。

## 输入与输出

- 输入：可信 `projectId` + 未经校验的 `eventEnvelope: unknown`；
- 输出：`inserted`（含内部 occurrenceId/sampleId）/`duplicate`/`invalid_input`（稳定 code，不回显输入）/`temporarily_unavailable`；
- 数据库错误映射为稳定结果，不泄露 SQL、数据库错误码、内部标识或 EventEnvelope/RequestEventEnvelope 正文。

## 依赖边界

- `pg`（生产依赖）、`@aurora/event-schema`（包根，开发依赖，vitest alias）；
- 只从 `@aurora/event-schema` 包根导入；不访问 `src`/`internal`；
- 不依赖 Inbox、Worker、Browser、Core 或任何 SDK 插件；`aurora.layer: data`（允许 `data → {protocol}`）。

## 命令

```bash
pnpm --filter @aurora/processing-store typecheck       # TypeScript strict
pnpm --filter @aurora/processing-store test            # 单元测试（不连数据库）
pnpm --filter @aurora/processing-store test:integration  # 真实 PostgreSQL 17 集成测试
pnpm --filter @aurora/processing-store test:coverage   # 覆盖率（85/80/85/85）
pnpm --filter @aurora/processing-store test:package    # 包入口测试（build 后）
pnpm --filter @aurora/processing-store build           # 构建 dist
```

集成测试需要真实 PostgreSQL 17，通过 `AURORA_TEST_DATABASE_URL` 连接（目标必须是 `aurora_inbox_test` 测试库）；禁止以 SQLite/mock/PGlite 替代真实数据库证据。

## 关联文档

- [错误事件 occurrence 处理存储正式规格](../../docs/architecture/error-event-occurrence-processing-store.md)
- [请求事件安全样本处理存储正式规格](../../docs/architecture/request-event-sample-processing-store.md)
- [请求指标聚合存储正式规格](../../docs/architecture/request-metric-aggregate-store.md)
- [性能指标聚合与有界诊断样本存储正式规格](../../docs/architecture/performance-metric-aggregate-and-bounded-sample-store.md)
- [请求指标查询投影正式规格](../../docs/architecture/request-metric-query-projection.md)
- [接入诊断状态查询正式规格](../../docs/architecture/ingestion-diagnostics-status-query.md)
- [性能指标查询投影正式规格](../../docs/architecture/performance-query-projection.md)
- [ADR-018 错误事件 occurrence 处理存储](../../docs/adr/ADR-018-error-event-occurrence-processing-storage.md)
- [ADR-019 请求事件聚合与有界诊断样本存储](../../docs/adr/ADR-019-request-event-aggregation-and-bounded-diagnostic-sample-storage.md)
- [ADR-020 幂等请求指标桶聚合](../../docs/adr/ADR-020-idempotent-request-metric-bucket-aggregation.md)
- [ADR-021 性能指标聚合与有界诊断样本存储](../../docs/adr/ADR-021-performance-aggregate-and-bounded-sample-storage.md)
- [错误事件协议契约](../../docs/protocol/error-event-contract.md)
- [请求事件协议契约](../../docs/protocol/request-event-contract.md)
- [性能事件协议契约](../../docs/protocol/performance-event-contract.md)
- [ADR-005 event-schema 单一来源](../../docs/adr/ADR-005-event-schema-source-of-truth.md)
- [ADR-010 数据库访问与 Migration 工具链](../../docs/adr/ADR-010-postgresql-access-and-migration-tooling.md)
