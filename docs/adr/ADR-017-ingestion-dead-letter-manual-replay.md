---
title: ADR-017：数据接入 Worker 死信人工重放核心
status: accepted
implementation-status: not-started
approval-status: approved
owner: ingestion/backend
date: 2026-08-02
last-reviewed: 2026-08-02
applies-to: packages/ingestion-inbox 的死信人工重放核心能力（dead_lettered → pending、replayGeneration、attemptCount 重置、operationId 幂等、操作记录表）
related:
  - ../../AURORA_RULES.md
  - '../../Aurora ADR 规范.md'
  - ../../docs/architecture/formalization-readiness.md
  - ../../docs/architecture/ingestion-inbox-data-model.md
  - ../../docs/architecture/ingestion-inbox-processing-repository.md
  - ../../docs/architecture/ingestion-worker-runtime.md
  - ../../docs/architecture/ingestion-worker-retry-budget-policy.md
  - ../../docs/architecture/ingestion-worker-retry-backoff-schedule.md
  - ../../docs/adr/ADR-008-ingestion-durable-buffering.md
  - ../../docs/adr/ADR-010-postgresql-access-and-migration-tooling.md
  - ../../docs/adr/ADR-012-ingestion-worker-runtime.md
  - ../../docs/adr/ADR-015-ingestion-worker-retry-budget-policy.md
  - ../../docs/adr/ADR-016-ingestion-worker-retry-backoff-schedule.md
supersedes: none
superseded-by: none
---

# ADR-017：数据接入 Worker 死信人工重放核心

## 元数据

- 状态：accepted
- 决策状态：accepted
- 实施状态：not-started
- 审批状态：approved
- 日期：2026-08-02
- Owner：ingestion/backend
- 适用范围：`packages/ingestion-inbox` 的死信人工重放核心能力（`dead_lettered → pending`、`replayGeneration`、`attemptCount` 重置、`operationId` 幂等、操作记录表）
- 关联 PRD：[核心业务 PRD](../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md) 第 7 章
- 关联 Inbox：[Inbox 数据模型正式规格](../../docs/architecture/ingestion-inbox-data-model.md)、[Inbox 处理侧 Repository 正式规格](../../docs/architecture/ingestion-inbox-processing-repository.md)
- 关联 Issue：none
- 关联实现 PR：none
- 替代 ADR：none
- 被替代 ADR：none

## 状态说明

本 ADR 于 2026-08-02 由用户批准（`decision-status: accepted`、`approval-status: approved`），实施状态保持 `not-started`。批准授权数据接入 Worker 死信人工重放核心能力的最终决定；批准不代表人工重放实现、HTTP API、管理 UI、管理员授权、完整审计或 CI/RDS/IaC 已经存在。**本 ADR 不修改 ADR-008/012/015/016 的任何最终结论**：人工重放是 Inbox 内部运维能力，Worker 通过普通 claim 流程重新处理，不绕过 retry budget、不自动调用退避算法。

## 背景

Aurora 已接受 ADR-008（PostgreSQL 事务性 Inbox，重试计数达上限后标记死信、可人工重放）、ADR-010（PostgreSQL 17 + `pg` + `node-pg-migrate` + SQL-first）、ADR-012（Worker 运行时）、ADR-015（retry budget：`maxProcessingAttempts`、budget 耗尽自动 `markDeadLettered{retry_budget_exhausted}`）和 ADR-016（退避算法：capped exponential + equal jitter）。`@aurora/ingestion-inbox` 已有写侧（`persistBatch`）与处理侧（`claimAvailable`/`renewLease`/`markProcessed`/`scheduleRetry`/`markDeadLettered` + `lease_id` fencing），并通过真实 PostgreSQL 17.10 验证。

当前缺口：死信事件（`dead_lettered` 状态）没有人工重放核心能力。ADR-008 要求"死信可人工重放"，但没有任何代码或数据模型支撑。当前仍不存在：人工重放核心、人工重放 HTTP API、管理平台页面、平台管理员授权、完整平台审计、批量重放。本轮只补齐**核心能力**（Inbox 内部命令）。

死信人工重放改变 dead-letter 状态恢复语义、`attemptCount` 重置方式和持久化操作记录，且存在多个合理方案（原行重置、保留 attemptCount、克隆新行），按 ADR 规范 7.2 属需要长期保留取舍依据的高迁移成本决策。本 ADR 于 2026-08-02 由用户直接审批批准。

## 决策驱动因素

- **与 ADR-008 一致**：ADR-008 明确"死信状态可人工重放"，本 ADR 提供其核心；
- **稳定 Inbox 身份**：重放应保留原 Inbox 行（同一 `id`、同一 EventEnvelope），不制造重复事件或新身份；
- **新处理代次**：人工重放开启新的"处理代次"（`replayGeneration`），`attemptCount` 重置，使 ADR-015 预算对新的代次重新生效；
- **不绕过 retry budget**：重放只是重新排队到 `pending`，Worker 仍按 `maxProcessingAttempts` 判断，预算耗尽仍会再次 dead-letter；
- **不自动退避**：人工重放立即重新排队（`availableAt = requestedAt`），不自动调用 ADR-016；processor 之后返回 retry 时才由 processor 显式使用退避；
- **操作证据**：保存最小操作记录（`operationId`、`replayGeneration`、`previousAttemptCount`、`previousErrorCode` 等），保留旧 dead-letter 证据，但不冒充完整平台审计；
- **幂等**：`operationId` 幂等，重复调用不重复修改事件；
- **单事件、内部能力**：一次调用处理一个事件，不接受数组，无 HTTP/UI/权限/审计。

## 现有约束

- ADR-004：失败重试次数和退避有上限；无法处理事件进入失败记录或死信；不静默丢失；
- ADR-008：`event_inbox` 事务提交 = "已可靠接收"；死信可人工重放；`(project_id, event_id)` 幂等键；批次部分成功不整批回滚；不承诺顺序；
- ADR-010：PostgreSQL 17 + `pg` + `node-pg-migrate` + SQL-first；`AURORA_TEST_DATABASE_URL` 测试隔离；已发布 Migration 只追加；
- ADR-012：Worker 运行时复用 `@aurora/ingestion-inbox` 公开处理 API；不修改 Inbox 状态集合、租约、fencing；
- ADR-015：`maxProcessingAttempts`、`decideRetryDisposition`、budget 未耗尽 `scheduleRetry`、耗尽自动 dead-letter；processor 异常/非法 retry/lease lost 行为冻结；不新增 Inbox 状态；
- ADR-016：退避是显式调用的辅助策略；Worker 主循环不隐式调用；
- Inbox 状态模型：`pending`/`leased`/`retry_waiting`/`processed`/`dead_lettered`；`processed`/`dead_lettered` 为终态（普通领取不允许）；
- 代码规范：严格 TypeScript、参数化 SQL、稳定结果、不暴露 SQLSTATE/约束名/SQL、敏感信息不入日志。

## 候选方案

### 方案 A：原行重新排队并重置 attemptCount + replay generation + 操作记录（推荐）

**行为**：对 `dead_lettered` 原 Inbox 行执行事务：`state = 'pending'`、`available_at = requestedAt`、`attempt_count = 0`、`replay_generation += 1`、清空 lease 字段与 `last_error_code`、`processed_at`/`dead_lettered_at` 按状态机清空；在 `event_inbox_replay_operations` 写入一条操作记录（`operationId`、`projectId`、`inboxId`、`eventId`、`replayGeneration`、`previousAttemptCount`、`previousErrorCode`、`requestedAt`、`createdAt`）。事务内 `SELECT ... FOR UPDATE` 锁定目标行，校验当前状态为 `dead_lettered`。

**优点**：

- 保留稳定 Inbox 身份（同一 `id`、同一 EventEnvelope），不制造重复事件或新身份；
- `replayGeneration` 明确开启新处理代次，`attemptCount` 重置使 ADR-015 预算重新生效；
- 操作记录保留旧 dead-letter 证据（`previousAttemptCount`/`previousErrorCode`）；
- `operationId` 幂等，事务 + 行锁保证并发安全；
- 与 ADR-008"死信可人工重放"、ADR-012"Worker 通过普通 claim 重新处理"完全一致。

**缺点**：

- 需要新增 `replay_generation` 列与操作记录表 Migration；
- 需处理 `operationId` 幂等与 `operation_conflict` 语义。

**选择结论**：采用。

### 方案 B：原行重新排队但保留 attemptCount（被拒绝）

**行为**：`dead_lettered → pending`，`available_at = requestedAt`，但**保留** `attempt_count`。

**被拒绝理由**：

- 已耗尽预算（`attempt_count >= maxProcessingAttempts`）的事件重放后仍 `attempt_count` 达到上限，Worker 再次 claim 后 processor 返回 retry 会立即被 ADR-015 判定 budget exhausted 再次 dead-letter，人工重放毫无意义；
- 无法表达"新处理代次"语义，`replayGeneration` 失去意义；
- 与 ADR-008"重试计数达上限后标记死信、可人工重放"的意图（重放后能重新处理）不符。

### 方案 C：克隆一条新的 Inbox 事件记录（被拒绝）

**行为**：保留旧记录为 `dead_lettered`，插入一条新的 `pending` Inbox 行，复制 EventEnvelope。

**被拒绝理由**：

- 制造新的 Inbox 身份（新 `id`），破坏 `(project_id, event_id)` 幂等唯一约束——同一事件出现两条记录；
- 重复事件/重复处理风险：原记录与新记录都可能被 claim，处理事实重复；
- 幂等键冲突处理复杂，与 ADR-008 幂等键语义冲突；
- 保留稳定身份是核心价值，克隆破坏它。

### 候选比较

| 维度                 | A：原行重置 + generation | B：原行保留 attemptCount | C：克隆新行     |
| -------------------- | ------------------------ | ------------------------ | --------------- |
| 稳定 Inbox 身份      | 是                       | 是                       | 否（新 id）     |
| 新处理代次           | 是（replayGeneration）   | 否                       | 否（无法表达）  |
| attemptCount 重置    | 是（0）                  | 否（保留）               | 新行从 0 开始   |
| 预算重生效           | 是                       | 否（立即再次 dead-letter）| 是（但重复身份）|
| 旧死信证据           | 是（操作记录）           | 部分（保留计数）         | 是（旧行保留）  |
| 幂等唯一约束         | 不受影响                 | 不受影响                 | 冲突风险       |
| 重复处理风险         | 无                       | 无                       | 有             |
| 与 ADR-008 一致      | 是                       | 部分                     | 否             |

## 最终决策

**最终选择方案 A：原行重新排队并重置 attemptCount + replay generation + 操作记录。**

### 决定细节（全部在本 ADR 冻结）

1. **模块位置**：不创建新包；扩展 `packages/ingestion-inbox`（`data` 层）。
2. **允许的状态转换**：只允许 `dead_lettered → pending`。`pending`/`leased`/`retry_waiting`/`processed` 全部拒绝（`invalid_state` + 当前状态）。
3. **replayGeneration**：`event_inbox` 新增 `replay_generation`（integer not null default 0，非负 CHECK）；每次成功重放 `replay_generation += 1`。
4. **attemptCount 重置**：重放时 `attempt_count = 0`；Worker 下一次成功 claim 后 `attempt_count` 重新变为 1；ADR-015 的 `maxProcessingAttempts` 适用于新的 replay generation；不修改 `maxProcessingAttempts`；不绕过 retry budget。
5. **立即重新排队**：`available_at = requestedAt`（服务端提供的请求时间）；不自动调用 ADR-016；重放后 processor 再次返回 retry 才由 processor 显式使用退避；不允许人工重放直接进入 `leased`。
6. **状态更新**：`state = 'pending'`、`available_at = requestedAt`、`attempt_count = 0`、`replay_generation += 1`、`lease_id = NULL`、`lease_owner = NULL`、`lease_expires_at = NULL`、`processed_at` 清空、`dead_lettered_at` 清空、`last_error_code` 在写入操作记录后清空；EventEnvelope、projectId、eventId、eventType、protocolVersion 不得修改。
7. **operationId 幂等**：
   - 相同 `operationId` + 相同 `projectId`/`inboxId` → 返回 `already_replayed`（含 `replayGeneration` 与 `availableAt`），不再次修改事件；
   - 相同 `operationId` + 不同目标 → 返回 `operation_conflict`；
   - 不得以"插入失败"或数据库约束文本作为公共结果。
8. **项目隔离**：所有重放查询和更新必须同时限定 `projectId` 与 `inboxId`；不得只按 `inboxId` 更新。
9. **单事件边界**：一次调用只处理一个 Inbox 事件；不接受数组；不实现搜索条件；不实现"重放全部死信"；不实现后台批量任务。
10. **事务边界**：一个 PostgreSQL 事务内完成——锁定目标 Inbox 行（`SELECT ... FOR UPDATE`）→ **（加锁后）**检查幂等 operation（加锁前检查 + 加锁后重新检查，避免 TOCTOU 竞态）→ 校验当前状态 → 写入 replay operation（若 operation INSERT 命中唯一冲突，捕获并重读映射为 `already_replayed`/`operation_conflict`，不以插入失败作为公共结果）→ 更新 `event_inbox` 状态 → COMMIT；任一步失败整体回滚。
11. **不增加 replay 次数硬上限**：因本轮无公开 HTTP/UI；每一次必须由未来获授权调用方显式发起；`replayGeneration` 与 operation 记录提供可观察证据；权限/限频/审批属未来管理入口。
12. **操作记录表**：`event_inbox_replay_operations`，字段至少 `operation_id`、`project_id`、`inbox_id`、`event_id`、`replay_generation`、`previous_attempt_count`、`previous_error_code`、`requested_at`、`created_at`；`operation_id` 唯一；`inbox_id` 类型与 `event_inbox.id` 完全一致；`event_id` 复用真实定义；`project_id` 复用真实定义；`replay_generation > 0`；`previous_attempt_count >= 0`；不保存 EventEnvelope、密钥、数据库 URL、自由文本原因、用户/管理员外键；生命周期跟随 Inbox 数据保留，不冒充一年期平台审计。

## 结果与影响

### 正面影响

- 死信事件获得人工重放核心能力，符合 ADR-008"死信可人工重放"；
- 稳定 Inbox 身份，不制造重复事件；
- `replayGeneration` + `attemptCount` 重置使新处理代次清晰、预算重新生效；
- `operationId` 幂等 + 事务 + 行锁保证并发安全；
- 操作记录保留旧 dead-letter 证据；
- 单事件、内部能力，不扩大公开面。

### 负面影响与代价

- 需要新增 `replay_generation` 列与操作记录表 Migration；
- 操作记录表需要与 Inbox 数据保留同步的生命周期管理（后续数据生命周期规则）；
- HTTP API、UI、权限、审计仍缺失（本轮非职责）。

### 未解决问题

- 人工重放 HTTP API（后续独立模块）；
- 管理平台重放 UI、平台管理员授权、完整平台审计；
- 批量重放、自动定时重放；
- 操作记录清理与 Inbox 数据生命周期同步。

## 实施约束

- 完全遵守 ADR-004/008/010/012/015/016；不修改 `persistBatch`/`claimAvailable`/`renewLease`/`markProcessed`/`scheduleRetry`/`markDeadLettered` 签名与语义；
- 不修改 `event_inbox` 状态集合（不新增状态）；`dead_lettered → pending` 是状态恢复，不新增状态枚举；
- 不修改 EventEnvelope、event-schema、HTTP、OpenAPI；
- 不修改 `maxProcessingAttempts`、退避算法、Worker 主循环；
- 不新增队列、缓存、云资源；
- Migration 为追加式，可 up/down，不自动执行于应用启动；
- 参数化 SQL；不暴露 SQLSTATE/约束名/SQL；稳定结果；
- 不记录 EventEnvelope、密钥、数据库 URL、自由文本原因。

## 迁移方案

本 ADR accepted 后：编写人工重放正式规格 → writing-plans → 实施 `@aurora/ingestion-inbox` 人工重放能力（Migration + Repository + operationId 幂等 + 稳定结果）→ 单元测试 + 真实 PostgreSQL 并发/Worker 回归验证。

## 回滚方案

人工重放是 Inbox 内部能力，与 Worker 主循环解耦。若实施中发现缺陷，可替换 Repository 实现而不影响写侧/处理侧 API 或 Worker 语义；Migration 发布后遵循向前修复与 expand/contract，destructive down 不作为生产默认回滚。不得通过静默丢弃事件降级。

## 验证方式

- 单元测试：dead_lettered 成功、pending/leased/retry_waiting/processed 拒绝、不存在、错误 projectId、operationId 幂等/冲突、attemptCount 重置、replayGeneration 增加、EventEnvelope/字段不变、lease 清空、lastErrorCode 保存后清空、输入不变、结果只读、数据库错误不泄露 SQLSTATE/约束/SQL；
- 真实 PostgreSQL：dead-lettered → replay → pending；Worker 能 claim；claim 后 attemptCount=1；replay 后 processor processed；replay 后再 retry 的 ADR-015/016 行为；budget 耗尽再次 dead-letter；相同/不同 operation 并发；operation conflict；跨 project 拒绝；事务中途失败完全回滚；Migration up/down/up；Schema/Pool 清理；
- **并发幂等竞态必须覆盖**：两个并发相同 `operationId`+目标调用只更新一次（第二个映射为 `already_replayed`）；`operation_id` 唯一冲突捕获后重读映射为稳定结果，不以插入失败作为公共结果；
- 回归：persistBatch/claimAvailable/renewLease/markProcessed/scheduleRetry/markDeadLettered 不变；retry budget/backoff 不变；Worker runtime 不自动调用人工重放；ingestion-api 不获得重放入口；OpenAPI 不新增重放路径；
- 全仓质量门禁与覆盖率 85/80/85/85。

## 重新评估条件

- 需要公开 HTTP/UI 或管理员授权；
- 需要批量重放或自动定时重放；
- 需要重放次数硬上限；
- 操作记录需要与平台审计合并；
- Inbox 数据保留规则落地后需要同步操作记录生命周期。

## 追加记录

本 ADR 的评审、状态、实施和替代变化只能追加在本节之后。

### 2026-08-02：创建（proposed）

- 状态 `proposed / not-started / awaiting-user-approval`；
- 由 2026-08-02 死信人工重放前置门禁创建；
- 门禁确认人工重放核心能力、状态恢复语义、attemptCount 重置、operationId 幂等、持久化操作记录均无 approved 来源；ADR-008 明确"死信可人工重放"但无实现；
- 未调用 writing-plans、未实施代码、未创建 Migration；
- 等待用户审批，不自动批准、不实施。

### 2026-08-02：用户批准与最终决定

- 决策状态更新为 `accepted`，实施状态保持 `not-started`，审批状态 `approved`；
- 用户批准本消息中的精确决定：方案 A（原行重新排队并重置 attemptCount + replay generation + 操作记录）；只允许 `dead_lettered → pending`，其余状态拒绝；`replayGeneration` 增加、`attemptCount` 重置为 0、Worker 重新 claim 后为 1；`available_at = requestedAt` 立即重新排队、不自动调用 ADR-016、不允许直接进入 leased；保留旧 dead-letter 证据（最小操作记录：operationId/projectId/inboxId/eventId/replayGeneration/previousAttemptCount/previousErrorCode/requestedAt/createdAt）；operationId 幂等（相同目标 → already_replayed、不同目标 → operation_conflict、不以插入失败为公共结果）；项目隔离（同时限定 projectId 与 inboxId）；单事件边界；事务 + `SELECT ... FOR UPDATE`；状态更新字段冻结；不增加 replay 次数硬上限；本 ADR 不修改 ADR-008/012/015/016 结论；
- 本次批准不代表人工重放实现、HTTP API、管理 UI、管理员授权、完整审计、CI、RDS 或 IaC 已经实现。

### 2026-08-02：独立非作者审查（真实审查结论）

- 独立审查 subagent（只读，未修改任何文件）完成非作者审查；
- 审查确认：与 approved 规范及 accepted ADR-008/010/012/015/016 无冲突；不修改 ACK 边界、Worker 生命周期/claim 语义、retry budget、退避算法；`dead_lettered → pending` 是显式内部命令而非普通领取，与"终态不允许普通领取"约束不冲突；不新增 Inbox 状态枚举；方案 A 稳定 Inbox 身份、方案 B 预算耗尽立即再次 dead-letter、方案 C 制造重复身份且违反 `(project_id, event_id)` 唯一约束（不可行）；
- 审查发现的中等问题已在决定细节 10 修正：**并发幂等 TOCTOU 竞态**——两个并发同 `operationId`+目标调用可能都通过加锁前幂等检查，需在获取 `FOR UPDATE` 锁后重新检查幂等，并在 operation INSERT 命中唯一冲突时捕获重读映射为 `already_replayed`/`operation_conflict`；
- 审查提出的次要建议：规格中固定操作记录存储的 `replay_generation`（新代次值）语义、`operationId` 全局唯一（UUID）、操作记录表 FK 与 Inbox 生命周期同步；
- 审查结论：**可接受进入 writing-plans 与正式代码实施**（需在规格中落实幂等竞态处理）。

### 2026-08-02：人工重放核心第一增量实施证据

- 实施状态更新为 `implemented`：`@aurora/ingestion-inbox` 人工重放能力已实施并通过单元测试、真实 PostgreSQL 17.10 并发/Worker 回归与全仓质量门禁；HTTP API、管理 UI、权限、完整审计、批量重放与具体事件处理器仍未实现，故不扩大范围；
- 实施内容：`src/replay-types.ts`（`ReplayDeadLetteredEventInput`/`ReplayDeadLetteredEventResult` 可辨识联合类型/`IngestionInboxReplayRepository`）、`src/replay.ts`（`replayDeadLettered`：`SELECT ... FOR UPDATE` 锁定、加锁后重查幂等避免 TOCTOU、状态校验、operation 插入 `ON CONFLICT DO NOTHING` + 重读映射、attempt_count 重置、replay_generation 递增、lease/processed_at/dead_lettered_at/last_error_code 清空、EventEnvelope 不变）、Migration `1722500000002_event-inbox-replay.ts`（`replay_generation` 列 + 非负 CHECK + `event_inbox_replay_operations` 表 + operation_id 唯一）；包根 `index.ts` 导出；
- 语义：只允许 `dead_lettered → pending`；`replay_generation` 新处理代次；`attempt_count = 0`（Worker 重新 claim 后为 1）；`available_at = requestedAt` 立即重新排队、不自动调用 ADR-016；`operationId` 幂等（同目标 `already_replayed`、异目标 `operation_conflict`）；项目隔离（同时限定 projectId + inboxId）；事务 + 行锁；操作记录保留 `previous_attempt_count`/`previous_error_code` 证据；
- 未修改 ADR-008 ACK、ADR-012 Worker 生命周期、ADR-015 retry budget、ADR-016 backoff；未修改 `persistBatch`/`claimAvailable`/`renewLease`/`markProcessed`/`scheduleRetry`/`markDeadLettered`；未新增 Inbox 状态枚举；未提供 HTTP/UI/权限/审计/批量；
- 测试：8 个单元测试（输入校验/结果形状/输入不变）+ 14 个真实 PostgreSQL 17.10 集成测试（dead-lettered → replay → pending、操作记录、四状态拒绝、跨 project、operationId 幂等/冲突、并发同/异 operation、Worker claim attempt=1、replay 后 retry/budget 耗尽再 dead-letter、回滚、清理）+ 包入口与安全负例；`@aurora/ingestion-worker` 回归 101 单测 + 27 集成全绿；
- 验证命令：`pnpm --filter @aurora/ingestion-inbox test`（40）、`test:integration`（52）、`typecheck`、`lint`、`build`、`pnpm benchmark:ingestion:smoke`、`pnpm check:ci` 全部 exit 0；`git diff --check` 通过；
- 实施 Commit：none（未提交）；
- Issue/PR：none；
- 未实现：人工重放 HTTP API、管理平台 UI、管理员授权、完整审计、批量重放、自动定时重放、具体事件处理器、CI、RDS、IaC。
