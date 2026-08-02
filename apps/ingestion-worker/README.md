# Aurora Ingestion Worker

## 模块定位

`@aurora/ingestion-worker` 是数据接入可靠缓冲 `event_inbox` 的 Worker 运行时与处理器编排第一增量（`apps/ingestion-worker`，`"private": true`）。它承载 ADR-008 Worker 波次第 2 个独立增量，由 accepted [ADR-012](../../docs/adr/ADR-012-ingestion-worker-runtime.md) 授权 Node.js 24 原生异步运行时；完全复用 `@aurora/ingestion-inbox` 公开处理侧 Repository（`claimAvailable`/`renewLease`/`markProcessed`/`scheduleRetry`/`markDeadLettered`）。

## 职责

- Worker 应用壳、typed 配置（`loadIngestionWorkerConfig`）；
- Worker 生命周期（`created`/`running`/`stopping`/`stopped`）与 claim 循环；
- 显式并发上限（`maxConcurrentHandlers`）与剩余容量计算；
- `IngestionEventProcessor` 处理器端口与编排（processed/retry/dead-letter）；
- retry budget 策略（`maxProcessingAttempts` + `decideRetryDisposition`：预算未耗尽 `scheduleRetry`、耗尽自动 `markDeadLettered{retry_budget_exhausted}`、非法 retry 结果不写回）；
- lease 自动续期（`renewLease`）与 lease lost 处理（Abort 处理器、不写回）；
- graceful shutdown（冻结顺序：停止新 claim → 续租 → 等 in-flight → Abort 超时 → 清理 → 关闭 Pool）；
- `buildIngestionWorker`（可测试工厂）与 `startIngestionWorker`（composition root，Pool 所有权）；
- 有界诊断（`WorkerDiagnostics`）；
- 单元测试与真实 PostgreSQL 17 集成测试。

## 非职责

- 不实现具体错误/请求/性能事件处理器；
- 不实现数据处理/查询存储、聚合、分组、索引；
- 不实现退避算法、人工重放；
- 不实现管理平台、HTTP 路由、客户端凭证；
- 不实现 SDK transport、Redis/BullMQ、SQS/Kinesis、调度框架；
- 不创建 CI、RDS、IaC、容量基准；
- 不修改 `@aurora/ingestion-inbox` 状态集合、租约或 fencing 语义。

## 对外接口

包根导出：`buildIngestionWorker`、`startIngestionWorker`、`loadIngestionWorkerConfig`、`decideRetryDisposition`、`WorkerDiagnostics` 及公共类型（`IngestionEventProcessor`、`ProcessIngestionEventInput`、`ProcessIngestionEventResult`、`WorkerRuntime`、`WorkerRuntimeStatus`、`IngestionWorkerConfig`、`RunningIngestionWorker`、`RetryDisposition`、`DecideRetryDispositionInput` 等）。

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

- `@aurora/ingestion-inbox`（包根，`data` 层）、`@aurora/event-schema`（包根，`protocol` 层）、`pg`；
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

- [Worker 运行时正式规格](../../docs/architecture/ingestion-worker-runtime.md)
- [Worker 重试预算与自动死信策略正式规格](../../docs/architecture/ingestion-worker-retry-budget-policy.md)
- [ADR-012 Worker 运行时](../../docs/adr/ADR-012-ingestion-worker-runtime.md)
- [ADR-015 Worker 重试预算与自动死信策略](../../docs/adr/ADR-015-ingestion-worker-retry-budget-policy.md)
- [Inbox 处理侧 Repository 正式规格](../../docs/architecture/ingestion-inbox-processing-repository.md)
- [Inbox 数据模型正式规格](../../docs/architecture/ingestion-inbox-data-model.md)
- [ADR-008 数据接入可靠缓冲](../../docs/adr/ADR-008-ingestion-durable-buffering.md)
- [ADR-010 数据库访问与 Migration 工具链](../../docs/adr/ADR-010-postgresql-access-and-migration-tooling.md)
