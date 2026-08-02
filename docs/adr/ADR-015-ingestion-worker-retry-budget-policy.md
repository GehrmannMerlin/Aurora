---
title: ADR-015：Worker 重试预算与自动死信策略
status: accepted
implementation-status: implemented
approval-status: approved
owner: ingestion/backend
date: 2026-08-02
last-reviewed: 2026-08-02
applies-to: apps/ingestion-worker 的重试预算与自动死信策略（maxProcessingAttempts、decideRetryDisposition、retry_budget_exhausted）
related:
  - ../../AURORA_RULES.md
  - '../../Aurora ADR 规范.md'
  - ../../docs/architecture/platform-backend.md
  - ../../docs/architecture/deployment.md
  - ../../docs/architecture/formalization-readiness.md
  - ../../docs/architecture/system-overview.md
  - ../../docs/architecture/ingestion-worker-runtime.md
  - ../../docs/architecture/ingestion-worker-retry-budget-policy.md
  - ../../docs/architecture/ingestion-inbox-data-model.md
  - ../../docs/architecture/ingestion-inbox-processing-repository.md
  - ../../docs/adr/ADR-004-asynchronous-event-processing.md
  - ../../docs/adr/ADR-008-ingestion-durable-buffering.md
  - ../../docs/adr/ADR-010-postgresql-access-and-migration-tooling.md
  - ../../docs/adr/ADR-011-ingestion-http-service-runtime.md
  - ../../docs/adr/ADR-012-ingestion-worker-runtime.md
supersedes: none
superseded-by: none
---

# ADR-015：Worker 重试预算与自动死信策略

## 元数据

- 状态：accepted
- 决策状态：accepted
- 实施状态：implemented
- 审批状态：approved
- 日期：2026-08-02
- Owner：ingestion/backend
- 适用范围：`apps/ingestion-worker` 的重试预算与自动死信策略（`maxProcessingAttempts`、`decideRetryDisposition`、`retry_budget_exhausted`）
- 关联 PRD：[核心业务 PRD](../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md) 第 6、7 章
- 关联 Issue：none
- 关联实现 PR：none
- 替代 ADR：none
- 被替代 ADR：none

## 状态说明

本 ADR 于 2026-08-02 由用户批准（`decision-status: accepted`、`approval-status: approved`），实施状态保持 `not-started`。批准授权 Worker 重试预算与自动死信策略的最终决定；批准不代表人工重放、具体 processor、容量 benchmark、CI、RDS 或 IaC 已经实现。

## 背景

Aurora 已接受 ADR-004（可靠接收与异步处理）、ADR-008（PostgreSQL 事务性 Inbox）、ADR-012（Worker 应用运行时）。`apps/ingestion-worker` 已实现运行时与处理器编排：processor 端口返回 `processed`/`retry`/`dead-letter` 三种结果，运行时分别调用 `markProcessed`/`scheduleRetry`/`markDeadLettered`。

当前真实缺口：processor 返回 `retry` 后，没有统一的最大处理尝试次数；retry 可能无限重复；没有 retry budget exhausted 的稳定死信语义；Worker policy 尚未形成正式规格和 ADR；人工重放尚未设计。本 ADR 于 2026-08-02 由用户批准，解除该阻塞。

## 决策驱动因素

- **防止无限重试**：没有统一预算时，processor 返回 retry 会导致事件无限重试；
- **稳定死信语义**：预算耗尽时需要一个稳定的错误码 `retry_budget_exhausted` 进入 `dead_lettered`；
- **processor 职责不变**：processor 仍负责判断单次失败是否值得 retry 并建议 availableAt；Worker policy 只负责校验 retry 结果、检查预算、决定继续 scheduleRetry 或自动 dead-letter；
- **不提前抽象**：策略只在 `apps/ingestion-worker` 内部，不创建通用重试框架；
- **最小 Schema**：不新增数据库列或状态，attemptCount 沿用 Inbox 既有语义。

## 现有约束

- ADR-004：失败重试次数和退避有上限；无法处理事件进入失败记录或死信；SDK 不重试永久拒绝；
- ADR-008：租约到期可重投；重试计数达上限后标记死信；不承诺处理顺序；
- ADR-012：Worker 运行时使用 `IngestionEventProcessor` 端口；运行时不在没有预算语义时自行决定 retry/dead-letter；
- Inbox 处理侧 Repository：`scheduleRetry`/`markDeadLettered` 只接受稳定 `IngestionErrorCode`；`attemptCount` 在每次新领取时递增（第一次为 1）；`renewLease` 不递增 attemptCount；
- Worker typed config：全部值显式配置；不提供隐式生产默认值；`requires-benchmark` 数值不写死。

## 最终决策

### 4.1 模块位置

不创建新 Workspace 包；在 `apps/ingestion-worker` 内部增加 Worker policy 能力（如 `src/retry-policy.ts`）。原因：策略只被 ingestion-worker 使用；不需要建立通用重试框架；不提前抽象多种 Worker；不让 data/protocol 包依赖 Worker policy。不得创建 `utils`/`helpers`/`common` 或通用 policy framework。

### 4.2 Processor 基础结果保持不变

继续使用 `processed`/`retry`/`dead-letter` 三种结果。不要求 processor 改成抛出框架专用异常。retry 结果继续提供 `availableAt` 与稳定、脱敏的 `errorCode`。本轮不设计退避算法。processor 仍负责判断该次失败是否值得 retry 并建议 availableAt；Worker policy 只负责校验 retry 结果、检查 retry budget、决定继续 scheduleRetry 或因为预算耗尽自动 dead-letter。

### 4.3 attemptCount 语义

继续使用 Processing Repository 既有语义：每次成功获得新 lease 时 `attemptCount + 1`；`renewLease` 不增加 attemptCount；同一 lease 内重复动作不增加 attemptCount；第一次处理时 attemptCount 为 1；Worker 不自行维护第二套计数器。

### 4.4 最大处理尝试次数

在 Worker typed config 中新增 `maxProcessingAttempts`：必填；正整数；`Number.isSafeInteger`；不提供隐式生产默认值；测试显式提供；环境变量 adapter 明确读取；具体生产值标记 `requires-benchmark`；不把测试值写成产品承诺。不增加数据库列。

### 4.5 retry budget 决策

processor 返回 retry 时：

- 允许继续重试：当 `attemptCount < maxProcessingAttempts`，调用 `scheduleRetry`，使用 processor 返回的 `availableAt` 与 `errorCode`；Worker 不得改写为另一套退避时间；
- 预算耗尽：当 `attemptCount >= maxProcessingAttempts`，不得再次调用 `scheduleRetry`，改为调用 `markDeadLettered`，稳定错误码固定为 `retry_budget_exhausted`；不覆盖或泄露原始 Error；可以在有界诊断中记录 processor 的稳定 errorCode；数据库存储的最终错误码使用 `retry_budget_exhausted`；不自动调用人工重放；不创建新的 Inbox 状态。

### 4.6 processed 与显式 dead-letter

processor 返回 `processed` 继续调用 `markProcessed`；返回 `dead-letter` 继续调用 `markDeadLettered`；显式 dead-letter 不受 retry budget 影响；Worker 不重新解释具体业务错误。

### 4.7 processor 抛出异常

保持现有已批准语义：不自动 scheduleRetry；不自动 markDeadLettered；不 markProcessed；记录有界、脱敏诊断；当前 lease 自然过期；之后可由 Worker 再次领取；不把未知异常计为一个额外 attempt；不记录原始 Error、stack 或 EventEnvelope body。本轮不得把异常自动分类成 retryable。

### 4.8 非法 retry 结果

如果 processor retry 结果存在非法 availableAt、availableAt 不满足 Repository 约束、空 errorCode、超长 errorCode 或非法类型：不调用 scheduleRetry；不自动 markDeadLettered；记录稳定诊断 `processor_retry_result_invalid`；让 lease 自然过期；不修改 Inbox 状态。不要通过宽松转换掩盖 processor bug。

### 4.9 策略接口

优先使用纯函数或最小不可变对象：

```ts
export interface DecideRetryDispositionInput {
  readonly attemptCount: number;
  readonly maxProcessingAttempts: number;
  readonly availableAt: Date;
  readonly errorCode: string;
}

export type RetryDisposition =
  | {
      readonly status: 'schedule-retry';
      readonly availableAt: Date;
      readonly errorCode: string;
    }
  | {
      readonly status: 'dead-letter';
      readonly errorCode: 'retry_budget_exhausted';
    }
  | {
      readonly status: 'invalid';
      readonly diagnosticCode: 'processor_retry_result_invalid';
    };

export function decideRetryDisposition(input: DecideRetryDispositionInput): RetryDisposition;
```

要求：不访问数据库/环境变量；不读取系统时间（除非现有 retry 结果验证明确需要）；不修改输入；不抛出用于正常分支的异常；不导出不需要的内部类型；不成为通用重试库。

### 4.10 并发和 lease 语义

策略计算不得改变现有 lease 规则。最终写回必须继续匹配 inboxId、state=leased、leaseId、当前租约有效。如果 scheduleRetry 或 markDeadLettered 返回 `lease_lost`：不重试旧 lease 写回；不尝试另一状态转换；记录有界诊断；不报告处理成功。策略不得绕过 Processing Repository。

### 4.11 诊断

新增稳定诊断至少评估：`retry_budget_exhausted`、`processor_retry_result_invalid`、`retry_policy_evaluation_failed`。诊断允许包含 operation、inboxId、eventType、attemptCount、maxProcessingAttempts、稳定 processor errorCode、disposition；禁止包含 EventEnvelope body、原始 Error、stack、SQL、SQLSTATE、constraint、数据库 URL、客户端密钥、用户输入。继续遵守每实例有界诊断和不可变规则。

## 结果与影响

### 正面影响

- 防止无限重试，预算耗尽自动死信；
- 稳定错误码 `retry_budget_exhausted`；
- processor 职责不变，仅 Worker policy 负责预算决策；
- 最小 Schema，无新增数据库列或状态；
- 现有 Worker 运行时与 Processing Repository 兼容。

### 负面影响与代价

- 人工重放仍未设计；
- 具体 processor 与容量 benchmark 仍缺失；
- 退避算法仍未设计（本轮不实现）。

### 未解决问题

- 人工重放（后续独立模块）；
- 具体事件 processor、错误分类；
- 退避算法；
- 容量 benchmark。

## 实施约束

- 完全遵守现有 Worker 运行时与 Inbox 语义；
- 不修改 Inbox 状态集合、lease/fencing、attemptCount 语义、processor 三种结果；
- 不固定生产 max attempts 数值（`requires-benchmark`）；
- 不增加退避算法；
- 不实现人工重放；
- 不新增数据库状态或修改 HTTP/OpenAPI。

## 迁移方案

本 ADR accepted 后：编写 Worker retry budget 正式规格 → writing-plans → 实施 `decideRetryDisposition` 纯函数、`maxProcessingAttempts` 配置、runtime 集成 → 真实 PostgreSQL 集成验证。

## 回滚方案

若策略在实施中发现缺陷，可在生产部署前替换实现（policy 纯函数与 config 可独立回滚）；不涉及新 Migration，Schema 不变。不得通过无限重试降级。

## 验证方式

- policy 单元测试（attempt 边界、availableAt/errorCode 保留、invalid、不抛异常）；
- 配置测试（缺失/0/负数/小数/非安全整数/合法正整数/冻结）；
- 真实 PostgreSQL 集成测试（budget 未耗尽→retry_waiting、耗尽→dead_lettered、exhausted 单次 markDeadLettered、attemptCount 不二次增加、explicit dead-letter/processed 不受影响、processor exception 保持 leased、invalid retry 不写回、lease lost 不二次写回、双 Worker 不重复）；
- 全仓质量门禁与覆盖率 85/80/85/85。

## 重新评估条件

- 需要退避算法或更复杂重试策略；
- 需要人工重放；
- 具体 processor 需要不同预算语义；
- 容量 benchmark 揭示预算值需调整。

## 追加记录

本 ADR 的评审、状态、实施和替代变化只能追加在本节之后。

### 2026-08-02：用户批准与最终决定

- 决策状态更新为 `accepted`，实施状态保持 `not-started`，审批状态 `approved`；
- 用户批准本消息中的精确决定：策略位于 ingestion-worker；不创建新包；processor 结果保持 processed/retry/dead-letter；`maxProcessingAttempts` 为必填运行配置；attemptCount 使用 Inbox 既有语义；budget 未耗尽时沿用 processor availableAt；budget 耗尽时自动 dead-letter；最终错误码 `retry_budget_exhausted`；processor 异常不自动 retry/dead-letter；不实现退避算法；不实现人工重放；不新增 Inbox 状态或 Schema；
- 本次批准不代表人工重放、具体 processor、容量 benchmark、CI、RDS 或 IaC 已经实现。

### 2026-08-02：Worker 重试预算与自动死信策略第一增量实施证据

- 实施状态更新为 `implemented`：`apps/ingestion-worker` retry budget 策略已实施并通过真实 PostgreSQL 17.10 集成验证与全仓质量门禁；人工重放、具体 processor 与容量 benchmark 仍未实现；
- 实施内容：`decideRetryDisposition` 纯函数（`schedule-retry`/`dead-letter{retry_budget_exhausted}`/`invalid{processor_retry_result_invalid}`，不访问数据库/环境变量/系统时间、不修改输入、不抛正常分支异常）；`maxProcessingAttempts` typed config（必填、正整数、`Number.isSafeInteger`、环境变量 adapter `MAX_PROCESSING_ATTEMPTS`、无隐式生产默认值）；runtime 集成（`attemptCount < maxProcessingAttempts` → `scheduleRetry` 用 processor availableAt/errorCode；`attemptCount >= maxProcessingAttempts` → `markDeadLettered{retry_budget_exhausted}` 单次；显式 dead-letter/processed 不受预算影响；processor exception 保持 leased；invalid retry 不写回；scheduleRetry/markDeadLettered 返回 lease_lost 不二次写回）；稳定诊断（`retry_budget_exhausted`/`processor_retry_result_invalid`/`retry_policy_evaluation_failed`）；
- 未修改 Inbox 状态集合、lease/fencing、attemptCount 语义、processor 三种结果；未新增数据库列或状态；
- 测试：policy 单元测试（attempt 1/max 3→schedule-retry、attempt 2/max 3→schedule-retry、attempt 3/max 3→dead-letter、attempt>max→dead-letter、availableAt/errorCode 保留、exhausted 用 retry_budget_exhausted、invalid、输入不被修改、不抛异常）+ 配置测试 + 真实 PostgreSQL 17.10 集成测试（budget 未耗尽→retry_waiting、耗尽→dead_lettered、exhausted 不调用 scheduleRetry、exhausted 调用 markDeadLettered 一次、attemptCount 不二次增加、explicit dead-letter 不受影响、processed 不受影响、processor exception 保持 leased、invalid retry 不写入、lease lost 不二次写回、双 Worker 不重复）+ 回归（ingestion-worker 原有全部、ingestion-inbox、ingestion-api、ingestion-credentials）；
- 验证命令：`pnpm --filter @aurora/ingestion-worker test/test:integration/test:coverage/typecheck/lint/build`、全仓门禁全部 exit 0；
- 实施 Commit：none（未提交）；
- Issue/PR：none；
- 未实现：人工重放、具体事件 processor、数据处理存储、凭证管理 HTTP API、管理平台、CI、RDS、IaC、容量 benchmark。