# Aurora Ingestion Inbox

## 模块定位

`@aurora/ingestion-inbox` 是数据接入可靠缓冲 `event_inbox` 数据模型、Migration 与原子持久化边界第一增量，以及处理侧 Repository、租约与状态转换第一增量。它承载 ADR-008 后续依赖链第 3 项与 Worker 波次第一个独立增量，是数据接入服务同步接收路径与 Worker 租约消费的直接前置。

## 职责

- `event_inbox` 表结构与 `(project_id, event_id)` 租户作用域幂等唯一约束；
- EventEnvelope JSONB 持久化表示（已通过 `@aurora/event-schema` 公共解析器）；
- 最小处理状态模型与 Worker 后续租约所需结构字段；
- 原子批次持久化 `persistBatch`：事务内插入 + `ON CONFLICT DO NOTHING`，区分 `inserted`/`duplicate`；
- 原子领取 `claimAvailable`（`FOR UPDATE SKIP LOCKED`）、lease fencing（`lease_id`）、`renewLease`、`markProcessed`、`scheduleRetry`、`markDeadLettered`；
- 死信人工重放 `replayDeadLettered`：单事件 `dead_lettered → pending`、`replay_generation` 新处理代次、`attemptCount` 重置、`operationId` 幂等、事务 + 行锁、项目隔离、最小操作记录表；
- `node-pg-migrate` Migration 执行入口（显式命令，应用启动不自动迁移）；
- 真实 PostgreSQL 17 集成测试（写侧 + 处理侧并发/租约/状态转换 + 人工重放）。

## 非职责

- 不实现 Fastify 路由、HTTP 鉴权、Origin/CORS/environment 校验、客户端密钥；
- 不实现接入服务编排、Worker 运行循环、业务处理器、重试策略；
- 不提供人工重放 HTTP API、CLI、管理 UI、权限、审计、批量重放（仅核心 Inbox 命令）；
- 不固定租约时长、领取批量、重试次数、退避数值（`requires-benchmark`）；
- 不实现队列/Redis/BullMQ/SQS/Kinesis、采样、限流；
- 不创建 RDS、CI、IaC；
- 不重新定义事件 Schema（`@aurora/event-schema` 是唯一来源）。

## 对外接口

包根导出：`persistBatch`、`claimAvailable`、`renewLease`、`markProcessed`、`scheduleRetry`、`markDeadLettered`、`replayDeadLettered`、`IngestionInboxError`、`eventEnvelopeToJson`/`jsonToEventEnvelope`、`claimableWhereClause`/`expiredLeaseWhereClause`、`CLAIMABLE_STATES` 及公共类型。

```ts
export interface IngestionInboxRepository {
  persistBatch(input: PersistIngestionBatchInput): Promise<PersistIngestionBatchResult>;
}

export interface IngestionInboxProcessingRepository {
  claimAvailable(input: ClaimAvailableInboxEventsInput): Promise<ClaimAvailableInboxEventsResult>;
  renewLease(input: RenewInboxLeaseInput): Promise<InboxLeaseMutationResult>;
  markProcessed(input: MarkInboxEventProcessedInput): Promise<InboxLeaseMutationResult>;
  scheduleRetry(input: ScheduleInboxEventRetryInput): Promise<InboxLeaseMutationResult>;
  markDeadLettered(input: MarkInboxEventDeadLetteredInput): Promise<InboxLeaseMutationResult>;
}
```

## 输入与输出

- 输入：`PersistIngestionBatchInput`（可信 project 上下文 + 已通过 event-schema 校验的 EventEnvelope）；处理侧输入含调用方提供的 `limit`/`leaseDurationMs`/`availableAt`；
- 输出：`PersistIngestionBatchResult`（逐事件 `inserted`/`duplicate`）；处理侧稳定结果（`success`/`lease_lost`/`not_found`、`claimed`/`nothingToClaim`）；
- 数据库错误映射为稳定内部失败（`database_unavailable`/`statement_failed`），不泄露 SQL/SQLSTATE/约束名/EventEnvelope。

## 依赖边界

- `pg`（生产依赖）、`@aurora/event-schema`（包根）、`node-pg-migrate`/`@types/pg`（开发依赖）；
- 只从 `@aurora/event-schema` 包根导入；不访问 `src`/`internal`；
- 不依赖 Browser、Core 或任何 SDK 插件；`aurora.layer: data`。

## 命令

```bash
pnpm --filter @aurora/ingestion-inbox test               # 单元测试（不连数据库）
pnpm --filter @aurora/ingestion-inbox test:integration   # 真实 PostgreSQL 17 集成测试
AURORA_TEST_DATABASE_URL=... pnpm --filter @aurora/ingestion-inbox migrate  # 显式执行 Migration
```

集成测试需要真实 PostgreSQL 17，通过 `AURORA_TEST_DATABASE_URL` 连接；禁止以 SQLite/mock/PGlite 替代真实数据库证据。

## 关联文档

- [Inbox 数据模型正式规格](../../docs/architecture/ingestion-inbox-data-model.md)
- [Inbox 处理侧 Repository 正式规格](../../docs/architecture/ingestion-inbox-processing-repository.md)
- [死信人工重放核心正式规格](../../docs/architecture/ingestion-dead-letter-manual-replay.md)
- [ADR-017 死信人工重放核心](../../docs/adr/ADR-017-ingestion-dead-letter-manual-replay.md)
- [数据接入批次与接收结果协议](../../docs/protocol/ingestion-batch-and-receipt-contract.md)
- [ADR-008 数据接入可靠缓冲](../../docs/adr/ADR-008-ingestion-durable-buffering.md)
- [ADR-010 数据库访问与 Migration 工具链](../../docs/adr/ADR-010-postgresql-access-and-migration-tooling.md)
