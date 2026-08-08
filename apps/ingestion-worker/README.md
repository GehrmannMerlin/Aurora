# Aurora Ingestion Worker

## 模块定位

`@aurora/ingestion-worker` 是数据接入可靠缓冲 `event_inbox` 的 Worker 运行时与处理器编排第一增量（`apps/ingestion-worker`，`"private": true`）。它承载 ADR-008 Worker 波次第 2 个独立增量，由 accepted [ADR-012](../../docs/adr/ADR-012-ingestion-worker-runtime.md) 授权 Node.js 24 原生异步运行时；完全复用 `@aurora/ingestion-inbox` 公开处理侧 Repository（`claimAvailable`/`renewLease`/`markProcessed`/`scheduleRetry`/`markDeadLettered`）。

## 职责

- Worker 应用壳、typed 配置（`loadIngestionWorkerConfig`）；
- Worker 生命周期（`created`/`running`/`stopping`/`stopped`）与 claim 循环；
- 显式并发上限（`maxConcurrentHandlers`）与剩余容量计算；
- `IngestionEventProcessor` 处理器端口与编排（processed/retry/dead-letter）；
- retry budget 策略（`maxProcessingAttempts` + `decideRetryDisposition`：预算未耗尽 `scheduleRetry`、耗尽自动 `markDeadLettered{retry_budget_exhausted}`、非法 retry 结果不写回）；
- 重试退避调度策略（`calculateRetryBackoffSchedule`：capped exponential backoff + equal jitter、可注入 entropy、Node crypto entropy adapter、可选 `notBefore` 下限、稳定失败结果）；退避是**显式调用的辅助策略**，Worker 主循环不隐式调用，也不覆盖 processor 返回的 `availableAt`（ADR-016）；
- 具体错误事件 Processor 核心能力（`createErrorEventProcessor`：只处理 `EventType.Error`，通过 `@aurora/processing-store` 包根持久化 occurrence，把 `inserted`/`duplicate`/`invalid_input`/`temporarily_unavailable` 映射到既有 Worker 结果）；
- 请求样本选择策略（`decideRequestSampleSelection`：确定性纯函数，按 ADR-019 优先级判断是否把已解析请求事件保存为安全诊断样本；store/skip/invalid 稳定判别联合；无随机、无副作用、不读取配置/阈值）；
- 具体请求事件 Processor 核心能力（`createRequestEventProcessor`：只处理 `EventType.Request`，经 `@aurora/event-schema` 包根解析、注入分类端口获取 isFailure/isSlow/isAdditionalMonitoredStatus、指标主路径 `persistRequestMetricContribution`、样本选择 `decideRequestSampleSelection`、有界安全样本 `persistRequestEventSample`、跨 Store retry 收敛，把稳定结果映射到既有 Worker 结果）；
- 请求处理规则/配置 adapter（`createRequestProcessingRulesAdapter`：`RequestProcessingRules` 配置模型 + `DEFAULT_REQUEST_PROCESSING_RULES` 默认慢阈值 3000ms/失败状态码 429+500—599/额外状态码默认空 + 确定性分类 isFailure/isSlow/isAdditionalMonitoredStatus + 不可变冻结快照 + 非法配置抛稳定 `RequestProcessingRulesAdapterError{invalid_rules}`；作为 `ClassifyRequestEvent` 端口的真实规则实现，供 Request Processor 注入）；
- 具体性能事件 Processor 核心能力（`createPerformanceEventProcessor`：只处理 `EventType.Performance`，经 `@aurora/event-schema` 包根 `parsePerformanceEventEnvelope` 解析，聚合主路径 `persistPerformanceMetricContribution`，把 `applied`/`duplicate`/`invalid_input`/`temporarily_unavailable` 映射到既有 Worker 结果；**V1 不调用 `persistPerformanceEventSample`（不保存性能诊断样本，样本选择策略 deferred）**；无服务器侧二次采样，SDK 10% 采样与服务端聚合是分离关注点）；
- 事件处理器 Router（`createEventProcessorRouter`：实现 `IngestionEventProcessor` 端口，按 `eventType`（唯一来源 `@aurora/event-schema`）分发到 Error/Request/Performance 处理器并原样传播结果；`resource`/未知类型稳定 `dead-letter{invalid_event_type}`；纯分发器，不实现 retry/backoff/lease/数据库访问，不吞异常）；
- 生产 Worker composition（`createProductionIngestionWorker`：接线三个真实 processor + DAT-07 真实 adapter + Router 作为 `IngestionEventProcessor`，不创建/关闭 Pool、close 幂等、无 fake/noop processor）；
- lease 自动续期（`renewLease`）与 lease lost 处理（Abort 处理器、不写回）；
- graceful shutdown（冻结顺序：停止新 claim → 续租 → 等 in-flight → Abort 超时 → 清理 → 关闭 Pool）；
- `buildIngestionWorker`（可测试工厂）与 `startIngestionWorker`（composition root，Pool 所有权）；
- 有界诊断（`WorkerDiagnostics`）；
- 单元测试与真实 PostgreSQL 17 集成测试。

## 非职责

- 不实现性能事件处理器（not-started）与错误/请求/性能 occurrence 存储（错误/请求已由既有处理器承担）；
- 不实现总事件路由器（blocked：Request/Performance 事件的处理存储和事件路由语义尚未形成 approved 规格或 accepted ADR）；
- 不把错误/请求/性能处理器接入生产 composition root（blocked）；不创建生产 bin/start；
- 不实现请求样本持久化执行器、指标贡献提交与 Request Processor（请求样本选择策略只判断类别资格，不持久化、不聚合、不返回 Worker 结果）；
- 不实现真实项目配置存储/Repository、配置管理 HTTP API、Request Metric Query、Request Event Router；请求事件 Processor 核心与请求处理规则 adapter 不接生产 composition root；
- 性能事件 Processor V1 不调用 `persistPerformanceEventSample`（不保存性能诊断样本，样本选择策略 deferred）；不实现 percentile/直方图/采样率执行；
- 不实现数据处理/查询存储、聚合、分组、索引；
- 不实现人工重放；
- 不实现管理平台、HTTP 路由、客户端凭证；
- 不实现 SDK transport、Redis/BullMQ、SQS/Kinesis、调度框架；
- 不创建 CI、RDS、IaC、容量基准；
- 不修改 `@aurora/ingestion-inbox` 状态集合、租约或 fencing 语义；
- 不在 Worker 主循环自动生成 retry 时间（退避仅供具体 processor 显式调用）。

## 对外接口

包根导出：`buildIngestionWorker`、`startIngestionWorker`、`loadIngestionWorkerConfig`、`decideRetryDisposition`、`calculateRetryBackoffSchedule`、`createNodeCryptoEntropyProvider`、`createErrorEventProcessor`、`mapPersistResultToWorkerResult`、`createRequestEventProcessor`、`mapMetricResultToContinuation`、`mapSampleResultToWorkerResult`、`createRequestProcessingRulesAdapter`、`DEFAULT_REQUEST_PROCESSING_RULES`、`createPerformanceEventProcessor`、`mapPerformanceMetricResultToWorkerResult`、`createEventProcessorRouter`、`createProductionIngestionWorker`、`WorkerDiagnostics` 及公共类型（`IngestionEventProcessor`、`ProcessIngestionEventInput`、`ProcessIngestionEventResult`、`WorkerRuntime`、`WorkerRuntimeStatus`、`IngestionWorkerConfig`、`RunningIngestionWorker`、`RetryDisposition`、`DecideRetryDispositionInput`、`RetryBackoffConfig`、`RetryBackoffEntropyProvider`、`RetryBackoffResult`、`CreateErrorEventProcessorInput`、`ErrorEventProcessorDiagnostics`、`CreateRequestEventProcessorInput`、`RequestEventClassification`、`ClassifyRequestEvent`、`RequestEventProcessorDiagnostics`、`RequestProcessingRules`、`RequestProcessingRulesAdapter`、`CreateRequestProcessingRulesAdapterInput`、`RequestProcessingRulesAdapterError`、`RequestProcessingRulesAdapterErrorKind`、`CreatePerformanceEventProcessorInput`、`PerformanceEventProcessorDiagnostics`、`PersistPerformanceMetricFn`、`CreateEventProcessorRouterInput`、`EventProcessorRouterDiagnostics`、`ProductionCompositionOptions`、`ProductionIngestionWorker` 等）。

`request-sample-selection-policy.ts` 是 worker 内部模块，**不**从包根导出（与 `retry-policy.ts` 内部定位一致），供未来同包 Request Processor 相对导入。

```ts
export interface IngestionEventProcessor {
  process(
    input: ProcessIngestionEventInput,
    signal: AbortSignal,
  ): Promise<ProcessIngestionEventResult>;
}

export type ProcessIngestionEventResult =
  | { readonly outcome: 'processed' }
  | { readonly outcome: 'retry'; readonly availableAt: Date; readonly errorCode: IngestionErrorCode }
  | { readonly outcome: 'dead-letter'; readonly errorCode: IngestionErrorCode };
```

## 输入与输出

- 输入：已验证冻结配置 + 外部 Processing Repository + 处理器 + 可注入 timer/sleeper 端口；
- 输出：`WorkerRuntime`（`start`/`stop`/`status`/`diagnostics`）；`startIngestionWorker` 返回 `RunningIngestionWorker`（`close`）；
- 处理器结果映射：`processed` → `markProcessed`、`retry` → `scheduleRetry`、`dead-letter` → `markDeadLettered`；
- 处理器异常 → 未分类失败：有界诊断、不伪造成功、lease 自然过期后重领。

## 依赖边界

- `@aurora/ingestion-inbox`（包根，`data` 层）、`@aurora/event-schema`（包根，`protocol` 层）、`@aurora/processing-store`（包根，`data` 层，错误处理器依赖）、`pg`；
- 只从包根导入；不访问 `src`/`internal`/私有路径；
- 不依赖 Browser、Core 或任何 SDK 插件；`aurora.layer: service`；
- 不引入 BullMQ、Redis、SQS、Kinesis、cron 或第三方调度框架。

## 配置

全部值显式配置（缺失或非法启动失败；不固定产品默认值）：

| 配置项 | 类型 | 约束 |
| --- | --- | --- |
| `WORKER_ID` | string | 必填，非空 |
| `CLAIM_BATCH_SIZE` | number | 正整数，`≤100` |
| `MAX_CONCURRENT_HANDLERS` | number | 正整数，`≤ CLAIM_BATCH_SIZE` |
| `LEASE_DURATION_MS` | number | 正整数 |
| `LEASE_RENEW_INTERVAL_MS` | number | 正整数，`< LEASE_DURATION_MS` |
| `IDLE_POLL_INTERVAL_MS` | number | 正整数 |
| `INFRASTRUCTURE_FAILURE_DELAY_MS` | number | 正整数 |
| `SHUTDOWN_GRACE_PERIOD_MS` | number | 正整数 |
| `MAX_PROCESSING_ATTEMPTS` | number | 必填，正整数（retry budget；生产值 requires-benchmark） |
| `DATABASE_URL` | string | 必填（不打印完整值） |
| `LOG_ENABLED` | boolean | 可选，默认 false |

## 命令

```bash
pnpm --filter @aurora/ingestion-worker typecheck      # TypeScript strict
pnpm --filter @aurora/ingestion-worker test           # 单元测试（不连数据库）
pnpm --filter @aurora/ingestion-worker test:integration  # 真实 PostgreSQL 17 集成测试
pnpm --filter @aurora/ingestion-worker test:coverage  # 覆盖率（85/80/85/85）
pnpm --filter @aurora/ingestion-worker build          # 构建 dist
```

集成测试需要真实 PostgreSQL 17，通过 `AURORA_TEST_DATABASE_URL` 连接（目标必须是 `aurora_inbox_test` 测试库）；禁止以 SQLite/mock/PGlite 替代真实数据库证据。

## 关联文档

- [生产 Worker composition root 正式规格](../../docs/architecture/production-worker-composition-root.md)
- [事件处理器 Router 正式规格](../../docs/architecture/event-processor-router.md)
- [性能事件 Processor 核心能力正式规格](../../docs/architecture/performance-event-processor.md)
- [性能指标聚合与有界诊断样本存储正式规格](../../docs/architecture/performance-metric-aggregate-and-bounded-sample-store.md)
- [请求处理规则/配置 adapter 正式规格](../../docs/architecture/request-processing-rules-configuration-adapter.md)
- [请求事件 Processor 核心能力正式规格](../../docs/architecture/request-event-processor.md)
- [请求样本选择策略正式规格](../../docs/architecture/request-sample-selection-policy.md)
- [错误事件 Processor 核心能力正式规格](../../docs/architecture/error-event-processor.md)
- [错误事件 occurrence 处理存储正式规格](../../docs/architecture/error-event-occurrence-processing-store.md)
- [Worker 运行时正式规格](../../docs/architecture/ingestion-worker-runtime.md)
- [Worker 重试预算与自动死信策略正式规格](../../docs/architecture/ingestion-worker-retry-budget-policy.md)
- [Worker 重试退避调度策略正式规格](../../docs/architecture/ingestion-worker-retry-backoff-schedule.md)
- [ADR-012 Worker 运行时](../../docs/adr/ADR-012-ingestion-worker-runtime.md)
- [ADR-015 Worker 重试预算与自动死信策略](../../docs/adr/ADR-015-ingestion-worker-retry-budget-policy.md)
- [ADR-016 Worker 重试退避调度策略](../../docs/adr/ADR-016-ingestion-worker-retry-backoff-schedule.md)
- [ADR-018 错误事件 occurrence 处理存储](../../docs/adr/ADR-018-error-event-occurrence-processing-storage.md)
- [Inbox 处理侧 Repository 正式规格](../../docs/architecture/ingestion-inbox-processing-repository.md)
- [Inbox 数据模型正式规格](../../docs/architecture/ingestion-inbox-data-model.md)
- [ADR-008 数据接入可靠缓冲](../../docs/adr/ADR-008-ingestion-durable-buffering.md)
- [ADR-010 数据库访问与 Migration 工具链](../../docs/adr/ADR-010-postgresql-access-and-migration-tooling.md)
