---
title: Aurora 性能事件 Processor 核心第一增量（Performance Event Processor）
status: approved
implementation-status: implemented
approval-status: approved
owner: ingestion/backend
created: 2026-08-07
last-reviewed: 2026-08-07
applies-to: apps/ingestion-worker（@aurora/ingestion-worker）的性能事件 Processor 核心能力（createPerformanceEventProcessor 工厂、event-schema 解析、性能指标聚合贡献、结果映射）
related:
  - ../../AGENTS.md
  - ../../AURORA_RULES.md
  - '../../Aurora 代码规范.md'
  - '../../Aurora 测试规范.md'
  - '../../Aurora 文档规范.md'
  - '../../Aurora ADR 规范.md'
  - ../adr/ADR-004-asynchronous-event-processing.md
  - ../adr/ADR-005-event-schema-source-of-truth.md
  - ../adr/ADR-006-one-way-dependencies.md
  - ../adr/ADR-012-ingestion-worker-runtime.md
  - ../adr/ADR-015-ingestion-worker-retry-budget-policy.md
  - ../adr/ADR-016-ingestion-worker-retry-backoff-schedule.md
  - ../adr/ADR-017-ingestion-dead-letter-manual-replay.md
  - ../adr/ADR-018-error-event-occurrence-processing-storage.md
  - ../adr/ADR-019-request-event-aggregation-and-bounded-diagnostic-sample-storage.md
  - ../adr/ADR-020-idempotent-request-metric-bucket-aggregation.md
  - ../adr/ADR-021-performance-aggregate-and-bounded-sample-storage.md
  - ../protocol/performance-event-contract.md
  - ../architecture/performance-metric-aggregate-and-bounded-sample-store.md
  - ../architecture/error-event-processor.md
  - ../architecture/request-event-processor.md
  - ../architecture/formalization-readiness.md
  - ../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md
supersedes: none
review-cycle: performance-event-processor-contract-or-release
---

# Aurora 性能事件 Processor 核心第一增量（DAT-09）

## 1. 定位、效力与当前状态

本文冻结性能事件 Processor 核心能力第一增量，实施为 `apps/ingestion-worker`（包名 `@aurora/ingestion-worker`）内的 `createPerformanceEventProcessor` 工厂。它实现既有 `IngestionEventProcessor` 端口，接收 `ProcessIngestionEventInput`，只处理 `EventType.Performance`，通过 `@aurora/event-schema` 包根 `parsePerformanceEventEnvelope` 解析 Performance Event，通过注入的 `persistPerformanceMetricContribution` 函数把每个合法性能事件构建为 DAT-08 已批准的 aggregate contribution 并持久化，并把稳定结果映射到既有 Worker 处理结果（`processed`/`retry`/`dead-letter`）。

**批准状态**：本文由用户于 2026-08-07 明确批准产品/实现边界："DAT-09 V1 aggregates every valid received Performance Event and does not persist bounded performance diagnostic samples"。本文 `status: approved`、`approval-status: approved`。`implementation-status` 于 2026-08-07 更新为 `implemented`：`apps/ingestion-worker` 的 `createPerformanceEventProcessor` 已实施并通过单元测试、真实 PostgreSQL 17.10 集成测试与全仓质量门禁。本文由 accepted ADR-004/005/006/012/015/016/017/018/019/020/021、approved 性能事件协议契约、DAT-08 性能聚合/样本存储规格、既有 Error/Request Processor 规格无歧义派生；自动审批依据见规格自检节。

**声明边界（阻塞记录）**：性能事件 Processor **核心能力**已在本增量实施，但**生产 composition root 接线（DAT-11）与总事件路由（DAT-10）仍为后续独立模块**。本增量不接入生产 `startIngestionWorker`、不创建生产 bin/start、不实现总事件路由器。**性能事件 Processor V1 不调用 `persistPerformanceEventSample`（不保存性能诊断样本）；性能诊断样本保存策略 deferred（Activation requires a separately approved sample-selection policy）。**

## 2. 元数据、Owner 和范围

- **Owner**：ingestion/backend
- **适用范围**：`apps/ingestion-worker` 的性能事件 Processor 核心能力：工厂、Performance Event 解析、指标聚合贡献构造、结果映射、单元测试、真实 PostgreSQL 17 集成测试、README、正式规格、ADR-021 实施证据。
- **明确非职责**：
  - 生产 composition root 接线（DAT-11）、生产 bin/start、总事件路由器（DAT-10）；
  - 性能诊断样本保存（不调用 `persistPerformanceEventSample`；样本选择策略 deferred）；
  - percentile、直方图、超标比例、采样率执行、采样外推；
  - 页面身份/环境/发布版本维度（协议层无这些字段）；
  - Performance Query（DAT-17）、Issue、告警；
  - 数据保留与清理；
  - 修改 performance-event-contract、ingestion-api、POST /v1/batches、processing-store、Inbox、retry/backoff/replay。

## 3. 模块选择依据

- DAT-08 规格 §52 明确"DAT-09 Performance Processor 通过 `@aurora/processing-store` 包根调用 `persistPerformanceMetricContribution`（先）→ 样本资格判断（未来策略）→ `persistPerformanceEventSample`（后）；Store 结果映射到 Worker 结果由 DAT-09 负责"；
- accepted ADR-021 决定细节 12 明确"样本容量由未来性能样本选择策略保证；本 Repository 只持久化已由上游选中的合法性能事件"；
- 用户 2026-08-07 明确批准：**DAT-09 V1 只实现性能指标聚合主路径，不调用 `persistPerformanceEventSample`**（方案 2，解除样本选择策略阻塞）；性能诊断样本保存策略保持 deferred；不创建 ADR-022；
- `apps/ingestion-worker` 已有 `createErrorEventProcessor`/`createRequestEventProcessor` 工厂（approved + implemented），展示处理器核心能力的既有模式：实现 `IngestionEventProcessor` 端口、注入 store 函数、映射稳定结果、未知异常传播、不接生产 composition root。

## 4. 系统与模块位置

- 本模块位于 `apps/ingestion-worker`（`@aurora/ingestion-worker`，`aurora.layer: service`）；
- 新文件：`src/performance-event-processor.ts`、`test/performance-event-processor.test.ts`、`test/integration/performance-event-processor.test.ts`；
- 遵循 `createErrorEventProcessor`/`createRequestEventProcessor` 的文件组织与命名模式；
- **不**创建新的 processor framework、base class 或通用 orchestration package；
- 从包根导出 `createPerformanceEventProcessor` 与相关类型（与 `createRequestEventProcessor` 模式一致）；
- **不**导出私有 helper、仅测试使用的类型；
- **不**扩大 `@aurora/processing-store`/`@aurora/event-schema` 公共 API；**不**修改 performance-event-contract。

## 5. 依赖方向

`performance-event-processor.ts` → `@aurora/event-schema` 包根（`parsePerformanceEventEnvelope`、`PerformanceMetricName`、`PerformanceMetricUnit`、`EventType` 类型）、`@aurora/processing-store` 包根（`persistPerformanceMetricContribution`、`PerformanceMetricContributionInput`、`PersistPerformanceMetricContributionResult` 类型）、`./processor.ts`（端口类型）、`./retry-backoff-policy.ts`（`calculateRetryBackoffSchedule`）、`./retry-backoff-entropy.ts`（`createNodeCryptoEntropyProvider`）、`./retry-backoff-types.ts`（`RetryBackoffConfig`/`RetryBackoffEntropyProvider`）。

处理器**不**创建或关闭 Pool；**不**直接执行 SQL；**不**访问 `process.env`；**不**复制 retry budget/backoff/lease/processing-store 逻辑。

## 6. 输入

`ProcessIngestionEventInput`（既有端口）：

```ts
export interface ProcessIngestionEventInput {
  readonly inboxId: number;
  readonly projectId: string;
  readonly eventId: string;
  readonly event: EventEnvelope;
  readonly attemptCount: number;
  readonly leaseId: string;
  readonly leaseExpiresAt: Date;
}
```

## 7. 输出

`ProcessIngestionEventResult`（既有端口）：

```ts
export type ProcessIngestionEventResult =
  | { readonly outcome: 'processed' }
  | { readonly outcome: 'retry'; readonly availableAt: Date; readonly errorCode: IngestionErrorCode }
  | { readonly outcome: 'dead-letter'; readonly errorCode: IngestionErrorCode };
```

## 8. event-schema 解析

- 处理器读取 `input.event`，先校验 `eventType === EventType.Performance`；若非 Performance Event，返回 `{ outcome: 'dead-letter', errorCode: 'invalid_event_type' }` 作为**处理器局部前置条件**（与 `createErrorEventProcessor`/`createRequestEventProcessor` 一致）；
- 通过 `@aurora/event-schema` 包根 `parsePerformanceEventEnvelope` 解析完整 Performance Event；
- 解析失败 → 返回 `{ outcome: 'dead-letter', errorCode: 'invalid_event_type' }`（permanent rejection）；
- 解析成功 → 从 `PerformanceEventEnvelope` 提取 `eventId`、`occurredAt`、`body.metricName`、`body.value`、`body.unit`、`body.startedAt`、可选 `body.durationMs`；
- 处理器**不得**重新定义 `PerformanceMetricName`/`PerformanceMetricUnit`/Performance Event Schema；只使用 `@aurora/event-schema` 包根常量与类型。

## 9. 指标范围

- 只接受 `PerformanceMetricName` 的 `lcp`/`inp`/`cls`/`page_load` 四项（PRD 5.1.9 批准）；
- 未知/未批准指标由 `parsePerformanceEventEnvelope` 返回 `invalid_enum`，处理器映射为 `invalid_input` → `dead-letter`；
- 不新建性能指标。

## 10. 单位处理

- `metricName`/`unit`/`value` 的语义完全由 `@aurora/event-schema` 校验（`millisecond` 为安全整数毫秒，`ratio` 为 0..1 有限非负）；
- 处理器**不重新计算** LCP/INP/CLS/页面加载耗时；不修改 `value`；
- 处理器把 `metricName`/`unit`/`value` 原样传入 DAT-08 的 `PerformanceMetricContributionInput`；
- CLS 的 `ratio` 与毫秒类指标的 `millisecond` 由 DAT-08 `unit` 列区分，处理器不转换。

## 11. 不修改事件时间

- 处理器**不修改** `occurredAt`（信封事件产生时间）或 `startedAt`（测量开始时间）；
- UTC minute bucket 完全由 DAT-08 `computeBucketStart(occurredAt)` 决定，处理器不重算、不复制 bucket 算法。

## 12. UTC minute bucket 的来源

- 聚合桶归属由 DAT-08 `persistPerformanceMetricContribution` 内部 `computeBucketStart` 处理（`bucket_start = occurredAt 向下取整到 UTC 分钟`）；
- 处理器把 `occurredAt` 传入 `PerformanceMetricContributionInput.occurredAt`；
- 处理器不定义、不重复实现 bucket 算法（ADR-021 决定细节 4 冻结）。

## 13. safe page identity 的处理

- **不处理**：性能事件协议层无页面字段，safe page/route 归一化与过滤属未来能力；处理器不产生页面身份；
- 处理器不保存/不记录任何 URL、页面文本、DOM 或用户输入。

## 14. 对 DAT-08 Repository 的调用顺序

对每个合法 Performance Event，处理器按以下顺序调用：

```text
parsePerformanceEventEnvelope(input.event)
→ 构建 PerformanceMetricContributionInput
→ persistPerformanceMetricContribution（聚合主路径）
→ 将 Repository 结果映射为 ProcessIngestionEventResult
```

- **不调用** `persistPerformanceEventSample`（用户批准的 V1 冻结：不保存性能诊断样本）；
- 聚合是唯一持久化副作用。

## 15. aggregate contribution 语义

```ts
const contribution: PerformanceMetricContributionInput = {
  projectId: input.projectId,
  eventId: envelope.eventId,
  occurredAt: envelope.occurredAt,
  metricName: envelope.body.metricName,
  unit: envelope.body.unit,
  value: envelope.body.value,
  startedAt: envelope.body.startedAt,
  ...(envelope.body.durationMs !== undefined ? { durationMs: envelope.body.durationMs } : {}),
};
```

- `PerformanceMetricContributionInput` 从 `@aurora/processing-store` 包根导入（真实类型）；
- 处理器不判断性能好坏、不计算超标、不硬编码任何阈值。

## 16. bounded sample application 语义

- **DAT-09 V1 不调用** `persistPerformanceEventSample`；
- 不实现样本容量、淘汰、first-wins、随机样本、优先级、reservoir；
- 不根据页面/环境/指标自行挑选样本；
- DAT-08 的 bounded sample Store 保留为已批准但当前未激活的存储能力。

## 17. Store 不实现采样/水位时 Processor 的职责

- DAT-08 Store 明确"不实现采样/水位"（§33/§34）；DAT-09 Processor 同样**不实现**：
  - 第二层随机采样、百分比采样、reservoir sampling、first-wins 容量策略、优先级采样；
  - 任何新的性能样本选择算法；
  - 采样外推；
- Processor 对到达其边界的每个合法性能事件**确定性**执行聚合（见 §21）。

## 18. 若样本选择仍需独立策略，必须明确其 approved 来源

- **样本选择策略当前无 approved 来源**，且用户 2026-08-07 明确批准：DAT-09 V1 **不保存**性能诊断样本，样本选择策略保持 deferred；
- 未来若产品或 DAT-17/C6 需要展示性能诊断样本，必须重新执行：产品/Query 需求确认 → 样本选择策略规格化 → ADR 判断 → 必要的 approved/accepted 门禁 → 才能让 Processor 调用 `persistPerformanceEventSample`；
- 本规格在 out-of-scope/deferred 中明确记录："Activation of the DAT-08 bounded diagnostic sample repository requires a separately approved sample-selection policy."

## 19. duplicate 聚合结果的处理

| `persistPerformanceMetricContribution` 结果 | Processor 结果 | 语义 |
| --- | --- | --- |
| `applied` | `processed` | 首次贡献成功 |
| `duplicate` | `processed` | 幂等成功（retry/replay 后，不重复增加计数） |

## 20. duplicate 样本结果的处理

- **不适用**：DAT-09 V1 不调用样本 Store，不存在样本 duplicate 分支。

## 21. invalid_input 的处理

- `persistPerformanceMetricContribution` 返回 `invalid_input`（顶层非法、协议解析失败、未知指标/单位、数值越界）→ Processor 返回 `{ outcome: 'dead-letter', errorCode: 'invalid_event_type' }`（permanent rejection）；
- `invalid_input` 不进入 retry、不静默忽略。

## 22. temporarily_unavailable 的处理

- `persistPerformanceMetricContribution` 返回 `temporarily_unavailable` → Processor 返回 `retry`，`availableAt` 复用 ADR-016 `calculateRetryBackoffSchedule`；
- retry 的 `attemptCount` 来自 `ProcessIngestionEventInput`，`now` 来自可注入时钟，`entropy` 来自 `createNodeCryptoEntropyProvider`；
- 若 `calculateRetryBackoffSchedule` 返回非 `success`（非法 backoff 配置，程序缺陷），不静默降级为业务 retry——抛稳定 Error，由 Worker runtime 按 ADR-015 处理器异常规则处理（与 Error/Request Processor 一致）。

## 23. processor 成功、可重试失败和永久失败结果

| 场景 | Processor 结果 |
| --- | --- |
| 非 Performance Event（局部前置） | `dead-letter{invalid_event_type}` |
| 解析失败 | `dead-letter{invalid_event_type}` |
| 聚合 `applied` | `processed` |
| 聚合 `duplicate` | `processed` |
| 聚合 `invalid_input` | `dead-letter{invalid_event_type}` |
| 聚合 `temporarily_unavailable` | `retry{service_temporarily_unavailable}` + backoff availableAt |
| backoff 非法 | 抛稳定 Error（程序缺陷） |
| 未知异常 | 传播给 Worker runtime |

## 24. retry budget、backoff、dead-letter 不在 Processor 内重新实现

- Processor **不**实现 retry budget（ADR-015 的 `maxProcessingAttempts` 属 Worker 主循环）；
- Processor **不**实现 backoff 算法（只调用 `calculateRetryBackoffSchedule`）；
- Processor **不**调用 `markDeadLettered`/`scheduleRetry`（Worker runtime 负责 Inbox 状态写回）；
- Processor **不**复制 lease/fencing 逻辑。

## 25. lease lost 仍由 Worker 运行时控制

- Processor 不执行写回、不涉及 lease；lease lost 处理完全由 Worker runtime 的 `lease_id` fencing 保证（ADR-012/015/018 不修改）。

## 26. 事务边界

- 聚合持久化由 DAT-08 `persistPerformanceMetricContribution` 内部事务保证（登记 → duplicate 跳过 → UPSERT 桶 → COMMIT）；
- Processor 不建立新的数据库事务 API。

## 27. 部分写入失败语义

- DAT-09 V1 只有**一个**持久化副作用（聚合），不存在跨 Store 部分写入问题；
- 聚合 `temporarily_unavailable` 时整个事务 ROLLBACK（DAT-08 保证），Processor 返回 `retry`，下次执行 `duplicate` 不重复计数后收敛。

## 28. 幂等和重复消费

- 同一 `(projectId, eventId)` 重复消费：聚合贡献**最多生效一次**（DAT-08 `performance_metric_event_applications` PK + `ON CONFLICT DO NOTHING`）；
- 不因 Worker retry 重复增加 count/sum/max；
- 无样本写入，因此**没有第二个非确定性副作用**；
- 收敛完全依赖 DAT-08 数据库幂等，无跨 Store 事务。

## 29. 敏感字段限制

处理器只使用 Performance Contract 与 DAT-08 approved safe projection 已允许的数据：

- `metricName`/`value`/`unit`/`startedAt`/可选 `durationMs`；
- 禁止：请求/响应体、Header、Cookie、Authorization、完整 URL、查询参数值、DOM、页面文本、用户输入、用户标识、session、IP、设备指纹。

## 30. 日志和诊断

- Processor 不写日志；
- 可选诊断端口（复用 `ErrorEventProcessorDiagnostics`/`RequestEventProcessorDiagnostics` 模式）接收稳定诊断事件：`performance_applied`/`performance_duplicate`/`permanently_rejected_invalid_input`/`temporarily_unavailable` 等，含 `inboxId`/`eventType`/`attemptCount`；
- 诊断**不得**包含完整事件正文、Token、Cookie、Authorization、数据库 URL、SQL、SQLSTATE、metric value 或任何敏感字段。

## 31. 公开接口

包根新增导出（与 `createErrorEventProcessor`/`createRequestEventProcessor` 模式一致）：

```ts
export interface PerformanceEventProcessorDiagnostic {
  readonly code: string;
  readonly inboxId?: number;
  readonly eventType?: string;
  readonly attemptCount?: number;
}

export interface PerformanceEventProcessorDiagnostics {
  record(diagnostic: PerformanceEventProcessorDiagnostic): void;
}

export type PersistPerformanceMetricFn = (
  input: PerformanceMetricContributionInput,
) => Promise<PersistPerformanceMetricContributionResult>;

export interface CreatePerformanceEventProcessorInput {
  readonly persistMetric: PersistPerformanceMetricFn;
  readonly backoff: RetryBackoffConfig;
  readonly calculateBackoff?: typeof calculateRetryBackoffSchedule;
  readonly entropyProvider?: RetryBackoffEntropyProvider;
  readonly now?: () => Date;
  readonly diagnostics?: PerformanceEventProcessorDiagnostics;
}

export function createPerformanceEventProcessor(
  input: CreatePerformanceEventProcessorInput,
): IngestionEventProcessor;
```

- 私有结果映射 helper 不导出（与既有处理器一致，或按需最小导出）；
- `package-entry.test.ts` 追加断言。

## 32. 依赖方向

- 依赖 `@aurora/event-schema` 包根（解析器、枚举、类型）；禁止深层导入；
- 依赖 `@aurora/processing-store` 包根（`persistPerformanceMetricContribution` 与类型）；
- 依赖 worker 内部 `./processor.ts`（端口）、`./retry-backoff-*.ts`（退避）；
- `apps/ingestion-worker` 为 `aurora.layer: service`，允许 `service → {data, protocol}`；`package.json` 不新增依赖（`@aurora/processing-store` 已存在）；
- 无循环依赖、无私有跨包引用。

## 33. 单元测试

直接调用 `createPerformanceEventProcessor(...)` 工厂返回的处理器，注入 fake store 函数，覆盖：

- 合法 Performance Event（lcp/inp/cls/page_load）→ 聚合 `applied` → `processed`；
- 聚合 `duplicate` → `processed`（幂等成功）；
- 聚合 `invalid_input` → `dead-letter{invalid_event_type}`；
- 聚合 `temporarily_unavailable` → `retry{service_temporarily_unavailable}` + backoff availableAt；
- 聚合未知异常 → 异常传播；
- 非 Performance Event → `dead-letter{invalid_event_type}`；
- 解析失败（非法 envelope）→ `dead-letter{invalid_event_type}`；
- 未知指标名（如 fcp）→ `dead-letter{invalid_event_type}`；
- backoff 非法 → 抛稳定 Error（不静默降级）；
- 处理器不调用 `persistPerformanceEventSample`（注入 spy 断言调用次数为 0）；
- 处理器不调用 `Date.now`/`Math.random`/`process.env`；
- 处理器不修改输入对象；
- 传给 `persistMetric` 的 contribution 字段逐字段正确（metricName/unit/value/startedAt/occurredAt/durationMs?）；
- 处理器不硬编码任何采样率/阈值；
- 不读取页面/URL/环境/发布字段；
- 诊断不含事件正文/敏感字段。

## 34. Repository 集成测试

- 使用注入 fake（`persistPerformanceMetricContribution` 的兼容 fake）验证处理器编排逻辑，不连数据库（与 Request Processor Store fake 集成一致）。

## 35. Processor 与真实 PostgreSQL 集成测试

在真实 PostgreSQL 17.10 上验证（`AURORA_TEST_DATABASE_URL`；隔离/清理）：

- `lcp` 事件 + 聚合 `applied`：`performance_metric_buckets` 有对应行（metric_name=lcp、unit=millisecond、observed_count=1、value_sum=value）；
- `cls` 事件 + `ratio`：unit=ratio、value_sum 正确；
- `inp`/`page_load` 事件各成桶；
- 同一事件 replay：聚合 `duplicate`，计数不重复增加；
- `temporarily_unavailable` 后的重试收敛：先注入失败 store → retry → 恢复后 `duplicate` → processed；
- Error Processor 回归、Request Processor 回归、Request Store 回归、Metric Store 回归；
- Inbox/Schema/Pool 完整隔离与清理；
- **断言 `performance_event_samples` 表始终无新增行**（V1 不保存样本）。

## 36. 未来 DAT-10 的消费契约

- DAT-10 Event Processor Router 通过 `createPerformanceEventProcessor` 工厂创建的处理器作为 `IngestionEventProcessor` 实例；
- Router 依赖 EventType 分发，Performance 路由到本处理器；
- 本处理器保持 `IngestionEventProcessor` 端口签名，Router 不修改本处理器。

## 37. 未来 DAT-11 的消费契约

- DAT-11 production composition root 通过注入 `persistPerformanceMetricContribution(pool, input)` 与 backoff 配置创建本处理器；
- 本处理器不创建 Pool、不拥有 Pool；Pool 所有权归 composition root。

## 38. ADR 判断

**不需要新 ADR**。理由：

- 本处理器实现既有 `IngestionEventProcessor` 端口边界内的普通 processor 核心能力，调用已 accepted ADR-021/DAT-08 批准的聚合 Store；
- **不改变**产品规则（用户已批准 V1 只聚合不保存样本）、公共协议、隐私、数据模型、模块依赖方向；
- **不调用**样本 Store（样本选择策略 deferred，用户明确不创建 ADR-022）；
- 不创建新数据库、Migration、基础设施；
- 按 ADR 规范 §7.2，本模块不属于必须创建 ADR 的变更类型。

## 39. 回滚

- 处理器是 `apps/ingestion-worker` 内部独立模块，与 Worker runtime/processing-store/Inbox 解耦；
- 回滚只需移除 `performance-event-processor.ts` 及其导出、测试与 README 条目，不影响任何既有模块；
- 不涉及新 Migration；不修改任何公共 API（除新增 `createPerformanceEventProcessor` 导出外）。

## 40. 文档影响

- `apps/ingestion-worker/README.md`：增加性能事件 Processor 职责与接口；
- 本规格 `implementation-status` → implemented；
- `docs/README.md`：模块表新增一行；
- `docs/architecture/formalization-readiness.md`：状态记录更新；
- ADR-021 追加实施证据，保持 `accepted / implemented`；
- `AGENTS.md`/`AURORA_RULES.md`：仅在代码和完整门禁实际通过后更新阶段快照。

## 41. 未来 Router 和 production composition 阻塞

- DAT-10 Event Processor Router：not-started（后续独立模块）；
- DAT-11 production worker composition：not-started（后续独立模块）；
- Performance Query（DAT-17）：not-started；
- 性能诊断样本保存：deferred（需独立批准样本选择策略）。

## 42. deferred

- 性能诊断样本保存与样本选择策略（用户 2026-08-07 明确 deferred；Activation requires a separately approved sample-selection policy）；
- percentile/直方图/超标比例原材料；
- 页面/环境/发布版本维度（协议层缺字段，契约缺口）；
- 采样率执行/采样外推（SDK-13 客户端采样与 DAT-09 服务端聚合是分离关注点，DAT-09 不实现 SDK-13 职责）；
- 数据保留/清理任务。

## 43. out-of-scope

- DAT-10 Event Processor Router；
- DAT-11 production composition root；
- DAT-17 Performance Query projection；
- 管理平台 C6 页面、Platform OpenAPI；
- 告警计算、Issue 创建；
- SDK 性能采样算法、transport、队列、上报；
- 通用 Resource Event、Resource Timing、资源尺寸、缓存状态、initiatorType；
- 原始完整 URL、查询参数值、页面文本、DOM；
- 请求体、响应体、Cookie、Authorization；
- Redis、BullMQ、对象存储、搜索引擎、新云资源。

## 44. 完成标准

- `createPerformanceEventProcessor` 工厂实现并导出；
- 每个合法性能事件确定性进入 `persistPerformanceMetricContribution`；
- 不调用 `persistPerformanceEventSample`（V1 不保存样本）；
- 无服务器侧随机采样/double sampling；
- 结果映射、幂等、隐私、退避语义符合 §19—§28；
- 单元测试覆盖 §33 全部场景；
- 真实 PostgreSQL 集成测试覆盖 §35 全部场景并通过；
- 既有 Error/Request Processor 与 Store 测试全部回归通过；
- `package-entry.test.ts`、`documentation-contract.test.ts`、`security-negative.test.ts` 同步；
- README、正式规格、formalization-readiness、docs/README、ADR-021 实施证据同步；
- 全仓质量门禁通过；覆盖率满足 85/80/85/85。

## 45. PRD、协议、ADR、Store 和 Worker 追踪矩阵

| 权威来源 | 条款 | 本模块落实 |
| --- | --- | --- |
| PRD 5.1.9 | 基础页面性能默认开启；四项指标；主要进入聚合指标；不为每次性能数据生成问题 | 聚合主路径；不保存样本 |
| PRD 15.2 | 页面性能默认采样率 10%（SDK 采集层） | DAT-09 不应用 10% 采样；不对到达 Worker 的事件二次采样 |
| Performance Contract §4—10 | 四项指标、两单位、限制、解析 | 复用包根解析与枚举；只接受 lcp/inp/cls/page_load |
| ADR-021 决定细节 1—19 | 聚合主路径＋有界样本；样本容量由未来策略 | 本处理器只聚合；样本 deferred |
| DAT-08 规格 §52 | DAT-09 先聚合、后样本 | 只聚合；样本不调用 |
| Error Processor 规格 | 工厂/端口/结果映射/异常传播模式 | 本处理器复用同一模式 |
| Request Processor 规格 | 工厂/端口/分类端口/结果映射 | 本处理器复用同一模式（无分类端口，性能无失败/慢分类） |
| ADR-012/015/016 | Worker 生命周期、retry budget、backoff | 本处理器不实现这些；只调用 backoff |

## 46. 规格自检

- **权威一致性**：Performance Event 字段完全来自 event-schema 包根；聚合贡献逐字段映射 `PerformanceMetricContributionInput`；结果映射使用既有 `IngestionEventProcessor` 端口类型与既有 `IngestionErrorCode` 值；不复制 processing-store/event-schema/retry-budget/lease 逻辑；不改变 Inbox/Worker runtime/processing-store/OpenAPI/performance-event-contract；
- **兼容性**：新依赖只通过 `@aurora/processing-store` 与 `@aurora/event-schema` 包根；无循环依赖、无私有深导入；Worker runtime 公共接口不变；`apps/ingestion-worker` 为 `service` 层；
- **用户批准边界**：V1 聚合所有到达的合法性能事件、不保存性能诊断样本 —— 已由用户 2026-08-07 明确批准；不创建 ADR-022；
- **SDK 采样区分**："Performance Processor aggregates every valid Performance Event delivered to its processor boundary. Upstream SDK sampling and downstream diagnostic-sample selection are separate concerns."；
- **安全和数据**：不记录事件正文/凭据/数据库 URL；不修改输入；不执行 SQL（只调用包根）；无样本写入 → 无第二个副作用；
- **幂等**：聚合 `(project_id, event_id)` 最多一次；retry/replay 不重复计数；
- **范围控制**：只实现性能处理器核心能力；生产 composition root（DAT-11）与总事件路由（DAT-10）明确后续；不扩大到 Query/告警/页面/采样率；
- **ADR 门禁**：无需新 ADR；ADR-021 保持 `accepted / implemented`。

自动审批依据：本文全部语义由 accepted ADR-004/005/006/012/015/016/017/018/019/020/021、approved 性能事件协议契约、DAT-08 性能聚合/样本存储规格与既有 Error/Request Processor 规格无歧义派生；用户已通过 2026-08-07 消息明确批准 DAT-09 产品/实现边界（V1 只聚合不保存样本）；无新增产品/架构/安全/隐私/公共协议决策；自检全部通过。

## 47. 实施记录（2026-08-07）

- **实现**：`apps/ingestion-worker` `src/performance-event-processor.ts`（`PerformanceEventProcessorDiagnostic(s)` 诊断端口、`PersistPerformanceMetricFn` 注入类型、`mapPerformanceMetricResultToWorkerResult` 结果映射、`createPerformanceEventProcessor` 工厂）；只处理 `EventType.Performance`，经 `@aurora/event-schema` 包根 `parsePerformanceEventEnvelope` 解析，构建 `PerformanceMetricContributionInput`（metricName/unit/value/startedAt/可选 durationMs/occurredAt）并调用 `persistPerformanceMetricContribution`；结果映射：`applied`/`duplicate`→`processed`、`invalid_input`→`dead-letter{invalid_event_type}`、`temporarily_unavailable`→`retry{service_temporarily_unavailable}`（复用 ADR-016 backoff）；非 Performance Event/解析失败→`dead-letter`；未知异常传播；**V1 不调用 `persistPerformanceEventSample`**；
- **测试**：单元测试（15 个：解析/聚合/映射/幂等/unknown 异常/backoff 非法/no-sample spy/no-sampling 确定性/输入不变/诊断）+ 真实 PostgreSQL 17.10 集成测试（7 个：lcp 聚合、cls ratio 桶、replay 幂等、不写样本、temporarily_unavailable 收敛、非 Performance 拒绝、清理）；既有 Error/Request Processor 回归全通过；
- **状态**：`implementation-status: implemented`；`implemented-in-working-tree`（未提交、未合并、未发布、未生产部署）；ADR-021 保持 `accepted / implemented`（本处理器为其决定细节 1—19 的 Processor 消费端实施）；生产 composition root（DAT-11）与总事件路由（DAT-10）仍 not-started。
