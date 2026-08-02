---
title: Aurora 数据接入 Inbox 处理侧 Repository、租约与状态转换第一增量
status: approved
implementation-status: implemented
approval-status: approved
owner: ingestion
created: 2026-08-01
last-reviewed: 2026-08-01
applies-to: packages/ingestion-inbox 处理侧能力（原子领取、lease fencing、续租、完成/重试/死信、并发测试）
related:
  - ../../AGENTS.md
  - ../../AURORA_RULES.md
  - '../../Aurora 代码规范.md'
  - '../../Aurora 测试规范.md'
  - '../../Aurora 文档规范.md'
  - '../../Aurora ADR 规范.md'
  - ../adr/ADR-004-asynchronous-event-processing.md
  - ../adr/ADR-008-ingestion-durable-buffering.md
  - ../adr/ADR-010-postgresql-access-and-migration-tooling.md
  - ../architecture/ingestion-inbox-data-model.md
  - ../architecture/ingestion-http-service.md
  - ../architecture/formalization-readiness.md
supersedes: none
review-cycle: ingestion-inbox-processing-contract-or-release
---

# Aurora 数据接入 Inbox 处理侧 Repository、租约与状态转换第一增量

## 1. 定位、效力与当前状态

本文冻结 `@aurora/ingestion-inbox` 处理侧能力第一增量：原子领取（`FOR UPDATE SKIP LOCKED`）、lease fencing（`lease_id`）、续租、标记完成、安排重试、标记死信，以及对应状态转换与并发/事务集成测试。它是 ADR-008 Worker 波次的第一个独立增量，为未来 `apps/ingestion-worker` 提供处理侧 Repository 基础；**不**实现 Worker 运行循环、业务处理器或固定策略数值。

**批准状态**：本文于 2026-08-01 由用户预先批准（`status: approved`、`approval-status: approved`）。`implementation-status` 于 2026-08-01 更新为 `implemented`：`@aurora/ingestion-inbox` 处理侧能力第一增量已实施（`lease_id` fencing Migration、`claimAvailable`/`renewLease`/`markProcessed`/`scheduleRetry`/`markDeadLettered`）并通过真实 PostgreSQL 17.10 并发/租约/状态转换集成测试与全仓质量门禁。本文由 accepted ADR-004/008/010 与 approved Inbox 数据模型规格无歧义派生；自动审批依据见规格自检节。

## 2. 模块选择依据

按真实仓库核验：`@aurora/ingestion-inbox` 当前只有写侧 `persistBatch` 与 `claimableWhereClause`/`expiredLeaseWhereClause` SQL 辅助；**不存在**公开原子领取 API、lease token/fencing、续租、标记完成、安排重试、标记死信 API，也**没有**并发 Worker 集成测试。故选择本模块（处理侧 Repository 增量）。若这些能力已完整存在并有真实 PostgreSQL 证据，则停止报告，不重复实现。

## 3. 职责与非职责

### 3.1 职责

- Inbox 可领取记录原子查询（`FOR UPDATE SKIP LOCKED`）；
- 原子租约领取（`claimAvailable`）；
- lease fencing token（`lease_id`，UUID opaque）；
- 租约续期（`renewLease`）；
- 标记处理完成（`markProcessed`）；
- 安排稍后重试（`scheduleRetry`）；
- 标记死信（`markDeadLettered`）；
- 已过期租约重新领取；过期/失效 Worker 写回拒绝（`lease_lost`）；
- 处理侧稳定内部结果；
- 增量 Migration（`lease_id` 字段 + 约束 + 索引）；
- 并发与事务集成测试（真实 PostgreSQL 17）；
- 包入口、Workspace Policy 与文档证据。

### 3.2 非职责

- `apps/ingestion-worker`、Worker 轮询循环、具体事件处理器、数据处理/查询存储；
- 最大重试次数、退避算法、固定租约时间、固定领取批量、定时调度器、人工重放 API；
- 管理平台、HTTP 路由、客户端凭证；
- Redis/BullMQ、SQS/Kinesis、CI、RDS、IaC。

## 4. 状态模型（不变）

继续使用现有状态，**不新增同义状态**：

- `pending`、`leased`、`retry_waiting`、`processed`、`dead_lettered`

允许的处理侧状态转换（冻结）：

```text
pending → leased
retry_waiting 且 available_at 已到期 → leased
leased 且租约已过期 → leased（新 lease，attempt_count 递增）
leased 且当前 lease 有效 → leased（续租，attempt_count 不递增）
leased 且当前 lease 有效 → processed
leased 且当前 lease 有效 → retry_waiting
leased 且当前 lease 有效 → dead_lettered
```

禁止：`processed`/`dead_lettered` 重新进入普通领取；未持有当前有效租约的 Worker 更新记录；普通流程把记录从 `processed`/`dead_lettered` 改回 `pending`；在本轮实现人工重放（后续独立能力）。

## 5. 数据库时间

- 租约与可领取时间统一使用 **PostgreSQL `now()`** 作为权威来源；
- 不依赖不同 Worker 主机系统时钟一致；不把客户端时间当作租约依据；
- 测试通过数据库操作或受控 SQL 构造过期场景（如 `now() - interval`）；
- 不在生产 API 暴露任意 `now` 参数。

## 6. 原子领取

`claimAvailable` 使用 PostgreSQL 并发安全机制：

1. 选择候选记录；
2. `FOR UPDATE SKIP LOCKED`；
3. 同一事务更新为 `leased`（设置 `lease_id`、`lease_owner`、`lease_expires_at`）；
4. 返回本次实际领取的记录。

领取条件：

- `pending`；
- `retry_waiting` 且 `available_at <= database_now`；
- `leased` 且 `lease_expires_at <= database_now`（过期重领）。

不得领取：`processed`、`dead_lettered`、未到期的 `retry_waiting`、有效租约中的记录。

要求：

- `limit` 必须由调用方显式提供并做有界校验（`1..maxClaimLimit`，`maxClaimLimit` 为普通实施常量）；
- `leaseDurationMs` 必须由调用方显式提供并做有界校验；
- 不硬编码产品默认值；
- `attempt_count` 只在成功获得新处理租约时递增；
- 并发 Worker 不能同时获得同一 lease epoch（`lease_id` 保证）；
- 一个 Worker 事务失败不得留下半领取状态（事务原子性）。

可使用确定性扫描条件便于测试（如 `ORDER BY id`），但不得把扫描顺序描述为产品顺序保证。

## 7. lease fencing

- 采用独立不可预测的 `lease_id`（UUID opaque token）；
- 不只依赖 `lease_owner`（同一 Worker 标识可能在不同时间领取同一记录；旧处理结果不能覆盖新租约；owner 不能充当唯一租约代次）；
- 现有表无 `lease_id`，本轮通过**向前兼容增量 Migration** 添加（`VARCHAR(36)` 或 `UUID` 可空，默认 NULL）；
- 所有处理结果操作（renew/markProcessed/scheduleRetry/markDeadLettered）必须同时匹配：
  - Inbox 内部记录 `id`；
  - 当前 `state = 'leased'`；
  - `lease_id`；
  - 租约仍有效（`lease_expires_at > database_now`）；
- 失效 lease 的结果返回稳定 `lease_lost`，不得静默成功；
- 不把 `lease_id` 暴露到 HTTP、event-schema 或公开 receipt。

## 8. 处理侧 Repository API

冻结最小公共 API（命名遵循 `ingestion-inbox` 现有风格）：

```ts
export interface IngestionInboxProcessingRepository {
  claimAvailable(input: ClaimAvailableInboxEventsInput): Promise<ClaimAvailableInboxEventsResult>;

  renewLease(input: RenewInboxLeaseInput): Promise<InboxLeaseMutationResult>;

  markProcessed(input: MarkInboxEventProcessedInput): Promise<InboxLeaseMutationResult>;

  scheduleRetry(input: ScheduleInboxEventRetryInput): Promise<InboxLeaseMutationResult>;

  markDeadLettered(input: MarkInboxEventDeadLetteredInput): Promise<InboxLeaseMutationResult>;
}
```

API 约束：

- 一个 API 一个明确职责；
- 不暴露 pg client、SQLSTATE、constraint 或数据库行；
- 不接受 HTTP Header、客户端密钥、Origin 或 environment；
- 不返回 HTTP 状态码；
- 不修改 EventEnvelope；
- 不执行实际业务处理；
- 所有操作参数化；
- 所有结果稳定可判别；
- 数据库暂时失败映射为内部稳定错误（复用 `IngestionInboxError` 或等价）；
- `lease_lost` 与"记录不存在"可区分（`lease_lost` vs `not_found`）。

`claimAvailable` 结果每行至少包含：Inbox 内部标识、`projectId`、`eventId`、EventEnvelope、`attemptCount`、`leaseId`、`leaseExpiresAt`。不返回不需要的数据库内部字段。

## 9. 续租（renewLease）

- 仅当前有效 lease 可执行；
- 使用同一 `leaseId`；
- 从数据库当前时间计算新过期时间；新过期时间必须晚于数据库当前时间；
- `leaseDurationMs` 有界；
- 不递增 `attemptCount`；不改变 EventEnvelope；
- 不允许过期 Worker 复活已失效 lease（返回 `lease_lost`）；
- `processed`/`dead_lettered`/`retry_waiting` 不可续租（`lease_lost` 或 `invalid_state`）。

## 10. 完成处理（markProcessed）

- 仅当前有效 lease 可执行；
- 原子设置 `state='processed'`；
- 设置 `processed_at`；
- 清空 `lease_owner`、`lease_id`、`lease_expires_at`；
- 清空不再适用的 retry 字段（`last_error_code`）；
- 不删除 EventEnvelope；
- 重复旧 lease 调用不得返回成功（`lease_lost`）；
- 处理成功后不可普通领取。

## 11. 安排重试（scheduleRetry）

- 仅当前有效 lease 可执行；
- 调用方显式提供下一次 `availableAt`（绝对时间戳，由调用方受控计算）；
- 不在 Repository 内发明退避算法；
- 设置 `state='retry_waiting'`；
- 清空 lease 字段（`lease_owner`/`lease_id`/`lease_expires_at`）；
- 保留 `attemptCount`；
- 允许记录稳定、脱敏的内部错误码（`last_error_code`，用 `IngestionErrorCode`）；
- 不存堆栈、SQL、事件正文或任意错误对象；
- `availableAt` 必须晚于数据库当前时间；
- 到期前不可领取。

## 12. 标记死信（markDeadLettered）

- 仅当前有效 lease 可执行；
- 设置 `state='dead_lettered'`；
- 设置 `dead_lettered_at`；
- 清空 lease 字段；
- 保留 `attemptCount`；
- 只允许稳定、脱敏的内部错误码；
- 不进入普通领取；
- 不实现重放。

## 13. Migration、约束和索引

新增增量 Migration（**不编辑已有初始 Migration**）：

- 添加 `lease_id` 列（可空，`UUID` 或 `VARCHAR(36)`）；
- 添加 lease 字段一致性 check constraint：
  - `leased` 状态必须具备 `lease_owner`、`lease_id`、`lease_expires_at`；
  - 非 `leased` 状态不得残留 lease token（`lease_id IS NULL`）；
  - `retry_waiting` 必须有 `available_at`（已由 NOT NULL 保证）；
  - `processed` 必须有 `processed_at`；
  - `dead_lettered` 必须有 `dead_lettered_at`；
- 评估并只增加必要索引：claim 查询所需 `(state, available_at)` 部分索引（已有）、过期租约查询 `(state, lease_expires_at)`（已有 `lease_expires_at` 索引）；若 `lease_id` 用于操作匹配则现有主键已覆盖。

禁止：JSONB 正文 GIN 索引；过早分区；无证据的大量索引；固定生产批量和时间参数；修改已发布 Migration；破坏性删除现有列。

## 14. 并发与一致性测试（真实 PostgreSQL 17）

必须测试：

- 两个并发 Worker 领取相同候选集合，结果互不重叠；
- 同一记录同一时刻只存在一个有效 lease；
- `pending` 可领取；到期 `retry_waiting` 可领取；未到期 `retry_waiting` 不可领取；
- 有效 `leased` 不可被其他 Worker 领取；过期 `leased` 可重新领取并生成新 `leaseId`；
- 新 lease 获得后，旧 lease 无法完成/续租/安排重试/标记死信（`lease_lost`）；
- 续租延长过期时间且不增加 `attemptCount`；新领取增加 `attemptCount`；
- `markProcessed` 清理 lease；`scheduleRetry` 清理 lease 并设置 `availableAt`；`markDeadLettered` 清理 lease；
- `processed`/`dead_lettered` 不可再次领取；
- 事务回滚不留下 `leased` 状态；
- 数据库错误不泄露 SQL、SQLSTATE 或约束名；
- EventEnvelope 保持不变；不同项目记录互不影响；
- 测试 Schema 完整隔离和清理。

不使用 `sleep` 作为主要同步方式；优先并发事务、明确 barrier、Promise 协调和数据库状态断言。

## 15. 隐私与日志

- 不记录 EventEnvelope 正文、SQL、SQLSTATE、约束名、数据库 URL 或客户端密钥；
- `lease_id` 是内部 opaque token，不进入公共协议/HTTP/receipt；
- 错误映射为稳定内部结果，不泄露数据库细节。

## 16. 覆盖率与质量门禁

- `packages/ingestion-inbox` 维持 lines ≥85 / branches ≥80 / functions ≥85 / statements ≥85；
- 处理侧定向测试 + 真实 PostgreSQL 并发集成测试；
- 包入口、私有路径负例、Workspace Policy（data→protocol 允许）、敏感字段/SQL 日志扫描。

## 17. requires-benchmark 项

- 租约时长、领取批量、重试次数、退避数值均保持 `requires-benchmark`，不由本模块固定；
- 本模块只提供结构性与操作语义，调用方显式传入 `leaseDurationMs`/`limit`/`availableAt`。

## 18. Worker 后续衔接

- 未来 `apps/ingestion-worker` 调用 `IngestionInboxProcessingRepository`：`claimAvailable` 领取、`renewLease` 续租、`markProcessed`/`scheduleRetry`/`markDeadLettered` 完成/重试/死信；
- 具体事件处理、退避算法、最大重试次数由未来 Worker policy/benchmark 决定；
- 人工重放为后续独立能力，本模块不实现。

## 19. 排除范围

- Worker 运行循环、业务处理器、数据处理/查询存储、重试策略、人工重放、管理平台、HTTP 路由、客户端凭证、Redis/BullMQ、SQS/Kinesis、CI/RDS/IaC。

## 20. 规格自检

- 状态集合没有变化；ACK 边界没有变化；幂等边界没有变化；没有顺序承诺；没有固定租约/批量/重试/保留数值；没有采样；不违反 ADR-004/008/010；
- `persistBatch` 行为与公共接口不被破坏；`apps/ingestion-api` 不需要修改公共语义；event-schema 与 OpenAPI 不变；新 API 只通过 `@aurora/ingestion-inbox` 包根导出；无私有路径/循环依赖；
- 每项状态转换均有 Task 和测试；SQL、列名、类型和结果全文一致；无占位；无 Worker 循环/处理器/benchmark 内容；
- 使用数据库时间；claim 原子；使用 `FOR UPDATE SKIP LOCKED`；存在 fencing；旧 lease 无法写回；SQL 参数化；不记录 EventEnvelope/SQL/凭证；测试数据库隔离。

自动审批依据：本文全部语义由 accepted ADR-004/008/010 与 approved Inbox 数据模型规格无歧义派生；无新增产品/架构/安全/隐私决策；状态集合与 ACK/幂等边界不变；自检全部通过。
