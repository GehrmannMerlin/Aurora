---
title: Aurora 数据接入 Worker 死信人工重放核心第一增量
status: approved
implementation-status: implemented
approval-status: approved
owner: ingestion/backend
created: 2026-08-02
last-reviewed: 2026-08-02
applies-to: packages/ingestion-inbox（@aurora/ingestion-inbox，dead_lettered → pending、replayGeneration、attemptCount 重置、operationId 幂等、操作记录表）
related:
  - ../../AGENTS.md
  - ../../AURORA_RULES.md
  - '../../Aurora 代码规范.md'
  - '../../Aurora 测试规范.md'
  - '../../Aurora 文档规范.md'
  - '../../Aurora ADR 规范.md'
  - ../adr/ADR-008-ingestion-durable-buffering.md
  - ../adr/ADR-010-postgresql-access-and-migration-tooling.md
  - ../adr/ADR-012-ingestion-worker-runtime.md
  - ../adr/ADR-015-ingestion-worker-retry-budget-policy.md
  - ../adr/ADR-016-ingestion-worker-retry-backoff-schedule.md
  - ../adr/ADR-017-ingestion-dead-letter-manual-replay.md
  - ../architecture/ingestion-inbox-data-model.md
  - ../architecture/ingestion-inbox-processing-repository.md
  - ../architecture/ingestion-worker-runtime.md
  - ../architecture/formalization-readiness.md
supersedes: none
review-cycle: ingestion-replay-schema-or-contract-change
---

# Aurora 数据接入 Worker 死信人工重放核心第一增量

## 1. 定位、效力与当前状态

本文冻结数据接入 Worker 死信人工重放核心第一增量，实施为 `@aurora/ingestion-inbox` 的人工重放能力（扩展，不新建包）。它承载 accepted ADR-017 的机器语义：单事件 `dead_lettered → pending` 状态恢复、`replayGeneration` 新处理代次、`attemptCount` 重置、`operationId` 幂等、事务 + 行锁、项目隔离、最小操作记录表。它是 Inbox 内部运维命令，**不**提供 HTTP API、CLI、管理 UI、管理员权限、完整审计或批量重放；Worker 通过普通 claim 流程重新处理重放事件。

**批准状态**：本文于 2026-08-02 由用户预先批准（`status: approved`、`approval-status: approved`）。`implementation-status` 于 2026-08-02 更新为 `implemented`：`@aurora/ingestion-inbox` 人工重放能力已实施（`replayDeadLetteredEvent`/`replayDeadLettered`、Migration、`ReplayDeadLetteredEventResult` 稳定结果）并通过单元测试、真实 PostgreSQL 17.10 并发/Worker 回归与全仓质量门禁。本文由 accepted ADR-004/008/010/012/015/016/017 与 approved Inbox 数据模型、处理侧 Repository、Worker 规格无歧义派生；自动审批依据见规格自检节。

**声明边界**：人工重放不修改 ADR-008 ACK、ADR-012 Worker 生命周期、ADR-015 retry budget、ADR-016 退避算法；不修改 EventEnvelope；不新增 Inbox 状态枚举；不引入公开入口；`replayGeneration` 不设硬上限（每次由未来获授权调用方显式发起）。

## 2. 背景

Aurora 已接受 ADR-008（PostgreSQL 事务性 Inbox，明确"死信可人工重放"）、ADR-010（PostgreSQL 17 + `pg` + `node-pg-migrate` + SQL-first）、ADR-015（retry budget：`maxProcessingAttempts`、budget 耗尽自动 `markDeadLettered{retry_budget_exhausted}`）和 ADR-016（退避算法）。`@aurora/ingestion-inbox` 已有写侧（`persistBatch`）与处理侧（`claimAvailable`/`renewLease`/`markProcessed`/`scheduleRetry`/`markDeadLettered` + `lease_id` fencing），并通过真实 PostgreSQL 17.10 验证。

当前缺口：死信事件（`dead_lettered` 状态）没有人工重放核心能力。ADR-008 要求"死信可人工重放"，但没有任何代码或数据模型支撑。当前仍不存在：人工重放核心、HTTP API、管理平台页面、平台管理员授权、完整平台审计、批量重放。本轮只补齐核心能力。

## 3. 目标

- 为单个 `dead_lettered` Inbox 事件提供内部人工重放命令；
- 以事务方式重新进入 `pending`；
- 重新开始一次新的处理尝试周期（`replayGeneration` 增加、`attemptCount` 重置）；
- 保留上一轮死信的最小操作证据；
- 提供幂等 `operationId`；
- 保持项目租户隔离；
- 让现有 Worker 通过普通 claim 流程重新处理。

## 4. 非目标

- 不提供 HTTP API、CLI、管理平台页面；
- 不实现管理员权限、完整平台审计日志；
- 不实现批量重放、自动定时重放；
- 不重放 `pending`/`leased`/`retry_waiting`/`processed`；
- 不直接调用 Worker 或 processor；
- 不实现具体事件处理器；
- 不修改退避算法或 retry budget；
- 不新增队列、缓存、云资源。

## 5. 与 ADR-008/012/015/016 的关系

- **ADR-008**：ACK 边界不变（重放作用于已接收行）；`(project_id, event_id)` 幂等键不变；死信可人工重放由此承载；
- **ADR-012**：Worker 生命周期与 claim 语义不变；重放事件经普通 `claimAvailable` 重新领取；
- **ADR-015**：retry budget 不变；`attemptCount` 重置后 ADR-015 预算对新 generation 重新生效；不绕过 budget；
- **ADR-016**：退避算法不变；人工重放不自动调用退避（`availableAt = requestedAt`）；processor 之后返回 retry 时才由 processor 显式使用退避。

## 6. 允许的状态转换

只允许：

```text
dead_lettered → pending
```

以下状态全部拒绝（返回 `invalid_state` + 当前状态）：

- `pending`
- `leased`
- `retry_waiting`
- `processed`

## 7. 禁止的状态

- 不允许人工重放直接进入 `leased`（重放只设置 `pending`，由 Worker 后续 claim）；
- 不新增 Inbox 状态枚举（`pending`/`leased`/`retry_waiting`/`processed`/`dead_lettered` 不变）。

## 8. replayGeneration

- `event_inbox` 新增 `replay_generation`（integer not null default 0，非负 CHECK）；
- 每次成功重放 `replay_generation += 1`；
- 新 generation 从 1 开始（首次重放使 0 → 1）；
- 不设硬上限；每次由未来获授权调用方显式发起。

## 9. attemptCount 重置语义

- 重放时 `attempt_count = 0`；
- Worker 下一次成功 claim 后 `attempt_count` 重新变为 1（`claimAvailable` 的 `attempt_count = attempt_count + 1`）；
- ADR-015 的 `maxProcessingAttempts` 适用于新的 replay generation；
- 不修改 `maxProcessingAttempts`；不绕过 retry budget。

## 10. operationId 幂等

- 相同 `operationId` + 相同 `projectId`/`inboxId` → 返回 `already_replayed`（含当前 `replayGeneration` 与 `availableAt`），不再次修改事件；
- 相同 `operationId` + 不同目标（不同 `projectId` 或不同 `inboxId`）→ 返回 `operation_conflict`；
- 不得以"插入失败"或数据库约束文本作为公共结果；
- `operationId` 全局唯一（调用方须提供全局唯一标识，如 UUID）。

## 11. operation conflict

- `operation_conflict` 表示同一 `operationId` 已被用于不同目标；
- 稳定结果，不含 SQLSTATE/约束名/SQL。

## 12. PostgreSQL 事务

一个 PostgreSQL 事务内完成（从 Pool 获取同一 client 显式 BEGIN/COMMIT/ROLLBACK）：

1. `SELECT ... FOR UPDATE` 锁定目标 Inbox 行（同时限定 `projectId` 与 `inboxId`）；
2. （加锁后）检查幂等 operation（加锁前检查 + 加锁后重新检查，避免 TOCTOU 竞态）；
3. 校验当前状态为 `dead_lettered`；
4. 写入 replay operation；
5. 更新 `event_inbox` 状态；
6. COMMIT。

任一步失败整体回滚。

## 13. SELECT FOR UPDATE

- 使用 `SELECT ... FOR UPDATE` 锁定目标 Inbox 行；
- 加锁后重新检查幂等，避免两个并发同 `operationId`+目标调用都通过加锁前检查；
- operation INSERT 命中 `operation_id` 唯一冲突时，捕获并重读映射为 `already_replayed`（同目标）或 `operation_conflict`（不同目标），不以插入失败作为公共结果。

## 14. 项目隔离

所有重放查询和更新必须同时限定：

- `projectId`
- `inboxId`

不得只按 `inboxId` 更新。跨 project 的 `inboxId` 查询必须返回 `not_found` 或 `invalid_state`（由真实实现决定，不得跨项目更新）。

## 15. Inbox 字段不变范围

成功重放时：

- `state = 'pending'`；
- `available_at = requestedAt`；
- `attempt_count = 0`；
- `replay_generation += 1`；
- `lease_id = NULL`；
- `lease_owner = NULL`；
- `lease_expires_at = NULL`；
- `processed_at` 清空（按状态机要求）；
- `dead_lettered_at` 清空；
- `last_error_code` 在写入 replay operation 后清空；
- **EventEnvelope、projectId、eventId、eventType、protocolVersion 不得修改**。

字段名以真实 Migration 为准（真实实现使用 `replay_generation`、`attempt_count` 等 snake_case 列名）。

## 16. 操作记录

创建 `event_inbox_replay_operations` 表，字段至少：

- `operation_id`（唯一）；
- `project_id`（复用 event_inbox.project_id 定义）；
- `inbox_id`（类型与 event_inbox.id 完全一致）；
- `event_id`（复用 event_inbox.event_id 定义与长度）；
- `replay_generation`（> 0，存储新代次值）；
- `previous_attempt_count`（>= 0）；
- `previous_error_code`；
- `requested_at`；
- `created_at`。

约束与边界：

- `operation_id` 唯一；
- `replay_generation > 0`；`previous_attempt_count >= 0`；
- 不保存 EventEnvelope；
- 不保存密钥、数据库 URL；
- 不保存自由文本原因；
- 不新增用户或管理员外键；
- 生命周期跟随 Inbox 数据保留，不冒充一年期平台审计；
- 索引只按真实查询建立（至少 `operation_id` 唯一索引；如需按 inbox_id 查询操作记录可评估，不提前创建大量索引）。

## 17. Repository API

命名遵循仓库现有风格，语义等价：

```ts
export interface ReplayDeadLetteredEventInput {
  readonly projectId: string;
  readonly inboxId: number;
  readonly operationId: string;
  readonly requestedAt: Date;
}

export type ReplayDeadLetteredEventResult =
  | {
      readonly status: 'replayed';
      readonly replayGeneration: number;
      readonly availableAt: Date;
    }
  | {
      readonly status: 'already_replayed';
      readonly replayGeneration: number;
      readonly availableAt: Date;
    }
  | { readonly status: 'not_found' }
  | {
      readonly status: 'invalid_state';
      readonly currentState: string;
    }
  | { readonly status: 'operation_conflict' };

export interface IngestionInboxReplayRepository {
  replayDeadLettered(
    input: ReplayDeadLetteredEventInput,
  ): Promise<ReplayDeadLetteredEventResult>;
}
```

实现以真实函数 `replayDeadLettered`（或等价命名）在 `@aurora/ingestion-inbox` 包根导出。真实 `inboxId` 类型为 `number`（`event_inbox.id` bigserial）。

## 18. 稳定结果类型

`ReplayDeadLetteredEventResult` 是显式可辨识联合类型：

- `replayed`：成功，含 `replayGeneration`（新代次）与 `availableAt`；
- `already_replayed`：同 `operationId`+目标已处理，含当前 `replayGeneration` 与 `availableAt`；
- `not_found`：目标行不存在（或跨 project）；
- `invalid_state`：目标行状态不是 `dead_lettered`，含 `currentState`；
- `operation_conflict`：同一 `operationId` 用于不同目标。

## 19. 数据库错误映射

- 数据库错误映射为稳定内部错误（复用 `IngestionInboxError`：`invalid_input`/`database_unavailable`/`statement_failed`）；
- 不暴露 SQLSTATE、约束名、表名或 SQL 文本。

## 20. Worker 自然重新 claim

- 重放后事件进入 `pending`，`available_at = requestedAt`；
- 现有 Worker 通过普通 `claimAvailable`（`state IN ('pending','retry_waiting') AND available_at <= now()`）自然重新领取；
- Worker 运行时不需要任何修改。

## 21. retry budget 行为

- `attempt_count` 重置为 0，新 claim 后变 1；
- ADR-015 的 `maxProcessingAttempts` 对新 generation 重新生效；
- 预算耗尽仍自动 `markDeadLettered{retry_budget_exhausted}`；
- 不绕过 retry budget。

## 22. backoff 非自动调用边界

- 人工重放立即重新排队：`availableAt = requestedAt`；
- 不自动调用 ADR-016 退避算法；
- 重放后若 processor 再次返回 retry，才由 processor 显式使用退避策略；
- 不允许人工重放直接进入 `leased`。

## 23. 并发重放

- `SELECT ... FOR UPDATE` 行锁保证两个并发重放同一行串行化；
- 相同 `operationId`+目标并发：只有一个执行更新，另一个 `already_replayed`；
- 不同 `operationId` 并发重放同一行：只有一个成功（第一个把状态改为 `pending`，第二个 `invalid_state`）；
- `operation_id` 唯一冲突捕获后重读映射为稳定结果。

## 24. 重复请求

- 相同 `operationId` + 相同目标重复调用 → `already_replayed`（幂等）；
- 相同 `operationId` + 不同目标 → `operation_conflict`。

## 25. 安全和敏感数据

- 不记录 EventEnvelope、密钥、数据库 URL、SQLSTATE、约束名、SQL；
- 操作记录不保存 EventEnvelope、密钥、自由文本原因；
- 操作记录不冒充完整平台审计（不新增用户/管理员外键）；
- 不允许跨项目重放；
- 不允许批量重放。

## 26. 日志边界

- Repository 不产生普通日志；
- 稳定结果供调用方决定是否记录；
- 若记录，只允许有界诊断（operation、稳定结果码、projectId、inboxId、replayGeneration），禁止 EventEnvelope、SQL、数据库 URL、密钥。

## 27. 测试策略

### 单元测试

至少覆盖：

- `dead_lettered` 成功重放；
- `pending`/`leased`/`retry_waiting`/`processed` 拒绝；
- 不存在；
- 错误 projectId；
- 相同 operationId 相同目标 → `already_replayed`；
- 相同 operationId 不同目标 → `operation_conflict`；
- attemptCount 重置为 0；
- replayGeneration 增加；
- EventEnvelope 不变；
- eventId/projectId/eventType/protocolVersion 不变；
- lease 字段清空；
- lastErrorCode 保存到 operation 后清空；
- requestedAt 非法；
- operationId 非法；
- 输入对象不变；
- 返回对象只读或冻结；
- 数据库错误不泄露 SQLSTATE/约束/SQL；
- 不记录敏感数据。

### 真实 PostgreSQL 集成测试

至少覆盖：

1. dead-lettered → replay → pending；
2. replay 后 Worker 能 claim；
3. claim 后 attemptCount = 1；
4. replay 后 processor processed；
5. replay 后再次 retry，ADR-015/016 行为正常；
6. retry budget 耗尽后再次 dead-letter；
7. 相同 operation 并发调用只有一次更新；
8. 不同 operation 并发重放只有一个成功；
9. operation conflict；
10. 跨 project 拒绝；
11. 事务中途失败完全回滚；
12. Migration up/down/up；
13. Schema 和连接池完整清理；
14. 无残留 leased/retry_waiting 测试数据。

### 回归

证明：

- `persistBatch`/`claimAvailable`/`renewLease`/`markProcessed`/`scheduleRetry`/`markDeadLettered` 不变；
- retry budget 不变；
- retry backoff 不变；
- Worker runtime 不自动调用人工重放；
- ingestion-api 不获得重放入口；
- OpenAPI 不新增重放路径。

覆盖率维持关键模块门禁：lines >= 85%、branches >= 80%、functions >= 85%、statements >= 85%。

## 28. Migration

- 在现有 `@aurora/ingestion-inbox` Migration 链中追加 Migration（时间戳晚于现有 `1722500000001_event-inbox-processing.ts`）；
- 新增 `event_inbox.replay_generation`（integer not null default 0，非负 CHECK）；
- 创建 `event_inbox_replay_operations` 表；
- 可 up、可 down、不自动执行于应用启动、不修改旧 Migration；
- 通过真实 PostgreSQL 17 测试。

## 29. 回滚

- Migration 发布前缺陷：可直接修改未发布 Migration；
- Migration 发布后：向前修复与 expand/contract；destructive down 不作为生产默认回滚；
- Repository 实现与 Worker 主循环解耦，可替换而不影响写侧/处理侧 API。

## 30. 重新评估条件

- 需要公开 HTTP/UI 或管理员授权；
- 需要批量重放或自动定时重放；
- 需要重放次数硬上限；
- 操作记录需要与平台审计合并；
- Inbox 数据保留规则落地后需要同步操作记录生命周期。

## 31. 排除范围

- HTTP API、CLI、管理平台 UI；
- 平台管理员权限、完整平台审计；
- 批量重放、自动定时重放；
- 具体事件处理器、处理/查询存储；
- 修改 ADR-008/012/015/016 结论、EventEnvelope、OpenAPI、HTTP 服务；
- CI、RDS、IaC。

## 32. 规格自检

- **权威一致性**：只允许 `dead_lettered → pending`；不改变 ADR-008 ACK、ADR-012 Worker 生命周期、ADR-015 retry budget、ADR-016 backoff；不修改 event-schema/OpenAPI；不新增平台权限规则；不实现批量任务；
- **兼容性**：现有 Inbox API 保持兼容；现有 Worker API 保持兼容；Migration 为追加式；无循环依赖、无私有深导入、无跨项目更新；原事件正文不变；Worker 通过原 claim 流程重新处理；
- **计划质量**：规格每项要求都有对应 Task；类型、字段和结果名称一致；每个 Task 有真实 TDD；无占位；无第二模块内容；零上下文执行者可直接执行；
- **安全与数据**：不记录 EventEnvelope、凭证、数据库 URL；不接受自由文本原因；不建立公开入口；操作记录不冒充完整平台审计；不允许跨项目/批量重放。

自动审批依据：本文全部语义由 accepted ADR-004/008/010/012/015/016/017 与 approved Inbox 数据模型、处理侧 Repository、Worker 规格无歧义派生；无新增产品/架构/安全/隐私决策；不修改 ADR-008/012/015/016 结论或 EventEnvelope；用户已预先批准本消息中的精确人工重放设计（含独立审查修正的幂等竞态处理）；自检全部通过。
