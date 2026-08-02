---
title: Aurora Worker 重试预算与自动死信策略第一增量
status: approved
implementation-status: implemented
approval-status: approved
owner: ingestion
created: 2026-08-02
last-reviewed: 2026-08-02applies-to: apps/ingestion-worker（@aurora/ingestion-worker，Worker retry budget 与自动死信策略）
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
  - ../adr/ADR-011-ingestion-http-service-runtime.md
  - ../adr/ADR-012-ingestion-worker-runtime.md
  - ../adr/ADR-015-ingestion-worker-retry-budget-policy.md
  - ../architecture/ingestion-worker-runtime.md
  - ../architecture/ingestion-inbox-processing-repository.md
  - ../architecture/ingestion-inbox-data-model.md
  - ../architecture/formalization-readiness.md
supersedes: none
review-cycle: ingestion-worker-policy-or-retry-semantic-change
---

# Aurora Worker 重试预算与自动死信策略第一增量

## 1. 定位、效力与当前状态

本文冻结 Worker 重试预算与自动死信策略第一增量，实施为 `apps/ingestion-worker` 的 policy 能力（扩展，不新建包）。它承载 ADR-015 的机器语义：`maxProcessingAttempts` 运行配置、`decideRetryDisposition` 纯函数决策、processor 返回 retry 时在预算未耗尽下 `scheduleRetry`、预算耗尽下自动 `markDeadLettered{retry_budget_exhausted}`、非法 retry 结果与 processor 异常的不写回语义，以及稳定诊断。ADR-004 要求失败重试有上限、无法处理进入死信；ADR-008 要求重试计数达上限后标记死信；本文只冻结 Worker policy，不修改 Inbox 状态集合、lease/fencing、attemptCount 语义或 processor 三种结果。

**批准状态**：本文于 2026-08-02 由用户预先批准（`status: approved`、`approval-status: approved`）。`implementation-status` 于 2026-08-02 更新为 `implemented`：`apps/ingestion-worker` retry budget 策略已实施（`decideRetryDisposition`、`maxProcessingAttempts` typed config、runtime 集成、稳定诊断）并通过真实 PostgreSQL 17.10 集成验证与全仓质量门禁。本文由 accepted ADR-004/008/012/015 与 approved Worker 运行时规格无歧义派生；自动审批依据见规格自检节。

## 2. 元数据、Owner 和范围

- **Owner**：ingestion
- **适用范围**：`apps/ingestion-worker` 的 `src/retry-policy.ts`（`decideRetryDisposition`）、`configuration.ts`（`maxProcessingAttempts`）、`worker-runtime.ts`（retry/dead-letter 分支集成）、`test/` 单元与 PostgreSQL 集成测试。
- **明确非职责**：
  - 人工重放、具体事件 processor、退避算法、容量 benchmark；
  - 数据处理存储、凭证管理 HTTP API、管理平台；
  - CI、RDS、IaC。

## 3. 模块选择依据

- `apps/ingestion-worker` 的 processor 端口返回 `retry` 时当前直接调用 `scheduleRetry`，无统一最大尝试次数，retry 可能无限重复；
- Inbox 处理侧 Repository 已有 `scheduleRetry`/`markDeadLettered` 与 attemptCount 语义（每次新领取 +1）；
- 本模块只做 Worker policy：校验 retry 结果、检查预算、决定继续 scheduleRetry 或预算耗尽自动 dead-letter；
- 不提前抽象多种 Worker，策略只在 ingestion-worker 内部。

## 4. 职责与非职责

### 4.1 职责

- `maxProcessingAttempts` 运行配置（必填、正整数、`Number.isSafeInteger`、无隐式生产默认值）；
- `decideRetryDisposition` 纯函数决策（`schedule-retry`/`dead-letter{retry_budget_exhausted}`/`invalid{processor_retry_result_invalid}`）；
- runtime 集成：budget 未耗尽→`scheduleRetry`（沿用 processor availableAt/errorCode）；耗尽→`markDeadLettered{retry_budget_exhausted}` 单次；
- 显式 dead-letter/processed 不受预算影响；processor exception 保持 leased；invalid retry 不写回；lease_lost 不二次写回；
- 稳定诊断：`retry_budget_exhausted`、`processor_retry_result_invalid`、`retry_policy_evaluation_failed`。

### 4.2 非职责

- 不实现退避算法、人工重放、具体事件 processor；
- 不修改 Inbox 状态集合、lease/fencing、attemptCount 语义、processor 三种结果；
- 不新增数据库列或状态；不修改 HTTP/OpenAPI。

## 5. attemptCount 语义

继续使用 Processing Repository 既有语义：

- 每次成功获得新 lease 时 `attemptCount + 1`；
- `renewLease` 不增加 attemptCount；
- 同一 lease 内重复动作不增加 attemptCount；
- 第一次处理时 attemptCount 为 1；
- Worker 不自行维护第二套计数器。

## 6. maxProcessingAttempts

在 Worker typed config 中新增 `maxProcessingAttempts`：

- 必填；
- 正整数；
- `Number.isSafeInteger`；
- 不提供隐式生产默认值；
- 测试显式提供；
- 环境变量 adapter 明确读取（`MAX_PROCESSING_ATTEMPTS`）；
- 具体生产值标记 `requires-benchmark`；
- 不把测试值写成产品承诺。

不增加数据库列。

## 7. Processor 结果

保持 `processed`/`retry`/`dead-letter` 三种结果。retry 结果提供 `availableAt` 与稳定、脱敏的 `errorCode`。不要求 processor 改成抛出框架专用异常。processor 仍负责判断该次失败是否值得 retry 并建议 availableAt；Worker policy 只负责校验 retry 结果、检查预算、决定继续 scheduleRetry 或预算耗尽自动 dead-letter。

## 8. retry budget 决策

processor 返回 retry 时：

- 允许继续重试：当 `attemptCount < maxProcessingAttempts`，调用 `scheduleRetry`，使用 processor 返回的 `availableAt` 与 `errorCode`；Worker 不得改写为另一套退避时间；
- 预算耗尽：当 `attemptCount >= maxProcessingAttempts`，不得再次调用 `scheduleRetry`，改为调用 `markDeadLettered`，稳定错误码固定为 `retry_budget_exhausted`；不覆盖或泄露原始 Error；可以在有界诊断中记录 processor 的稳定 errorCode；数据库存储的最终错误码使用 `retry_budget_exhausted`；不自动调用人工重放；不创建新的 Inbox 状态。

## 9. budget exhausted

- 稳定错误码 `retry_budget_exhausted`；
- 不调用 `scheduleRetry`；
- 调用 `markDeadLettered` 一次；
- 不覆盖原始 Error；
- 不自动人工重放；
- 不创建新 Inbox 状态。

## 10. 非法 retry 结果

如果 processor retry 结果存在非法 availableAt、availableAt 不满足 Repository 约束、空 errorCode、超长 errorCode 或非法类型：

- 不调用 scheduleRetry；
- 不自动 markDeadLettered；
- 记录稳定诊断 `processor_retry_result_invalid`；
- 让 lease 自然过期；
- 不修改 Inbox 状态。

不要通过宽松转换掩盖 processor bug。

## 11. Processor 异常

保持现有已批准语义：不自动 scheduleRetry；不自动 markDeadLettered；不 markProcessed；记录有界、脱敏诊断；当前 lease 自然过期；之后可由 Worker 再次领取；不把未知异常计为一个额外 attempt；不记录原始 Error、stack 或 EventEnvelope body。本轮不得把异常自动分类成 retryable。

## 12. Lease lost

如果 scheduleRetry 或 markDeadLettered 返回 `lease_lost`：不重试旧 lease 写回；不尝试另一状态转换；记录有界诊断；不报告处理成功。策略不得绕过 Processing Repository。

## 13. 策略接口

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

## 14. typed config

`IngestionWorkerConfig` 新增 `maxProcessingAttempts: number`（必填、正整数、`Number.isSafeInteger`）。`loadIngestionWorkerConfig` 从 `MAX_PROCESSING_ATTEMPTS` 读取并校验；缺失/0/负数/小数/非安全整数抛错。普通运行时不读取 `process.env`。

## 15. 诊断

新增稳定诊断至少评估：`retry_budget_exhausted`、`processor_retry_result_invalid`、`retry_policy_evaluation_failed`。诊断允许包含 operation、inboxId、eventType、attemptCount、maxProcessingAttempts、稳定 processor errorCode、disposition；禁止包含 EventEnvelope body、原始 Error、stack、SQL、SQLSTATE、constraint、数据库 URL、客户端密钥、用户输入。继续遵守每实例有界诊断和不可变规则。

## 16. 单元测试

覆盖：

- 配置：缺少 `MAX_PROCESSING_ATTEMPTS`、0、负数、小数、非安全整数抛错；合法正整数冻结；运行时不读 `process.env`；
- policy：attempt 1/max 3→schedule-retry；attempt 2/max 3→schedule-retry；attempt 3/max 3→dead-letter；attempt 大于 max→dead-letter；availableAt/errorCode 原样保留；exhausted 用 `retry_budget_exhausted`；输入不被修改；非法 retry 结果返回 invalid；不抛出正常控制流异常。

## 17. PostgreSQL 集成测试

真实 PostgreSQL 17 验证：

- budget 未耗尽→retry_waiting；
- budget 耗尽→dead_lettered；
- exhausted 不调用 scheduleRetry；
- exhausted 调用 markDeadLettered 一次；
- attemptCount 不被 Worker 二次增加；
- explicit dead-letter 不受 budget 影响；
- processed 不受 budget 影响；
- processor exception 保持 leased，等待过期；
- invalid retry result 不写入 retry/dead-letter；
- lease lost 不执行第二种写回；
- 两个 Worker 不重复完成同一 lease；
- shutdown 语义不变；
- 测试 Schema 完整清理。

## 18. 覆盖率与质量门禁

- 包维持 TypeScript strict；覆盖率不低于 lines 85%、branches 80%、functions 85%、statements 85%；
- 包入口/应用入口、私有路径负例、Workspace Policy、敏感信息扫描；
- 回归：ingestion-worker 原有全部、ingestion-inbox 处理测试、ingestion-api、ingestion-credentials、event-schema、Browser/插件、Chromium 门禁。

## 19. requires-benchmark

- `maxProcessingAttempts` 具体生产值保持 `requires-benchmark`；
- 退避算法、重试数值、容量 benchmark 保持 blocked/not-started。

## 20. 人工重放后续衔接

- 人工重放为后续独立能力；本文不实现；
- 具体事件 processor 与错误分类为后续模块；
- 退避算法为后续独立设计。

## 21. 排除范围

- 人工重放、具体事件 processor、退避算法；
- 数据处理存储、凭证管理 HTTP API、管理平台；
- CI、RDS、IaC、容量 benchmark。

## 22. 规格自检

- **权威一致性**：Inbox 状态集合不变；lease/fencing 不变；attemptCount 语义不变；processor 三种结果不变；不固定生产 max attempts；不增加退避算法；不实现 replay；
- **兼容性**：Processing Repository 公共 API 不变；Worker build/start 边界不变；HTTP、OpenAPI、credentials 不变；无新循环依赖或私有路径；现有 Worker 行为回归通过；
- **计划质量**：每项策略有 Task 和测试；配置、类型、诊断和结果全文一致；每个 Task 有 TDD 闭环；无占位；无 replay、具体 processor 或 benchmark 实现；
- **安全和可靠性**：budget exhausted 不无限重试；lease lost 不写回；processor 异常不被误分类；不记录 EventEnvelope 或数据库秘密；测试使用隔离 PostgreSQL。

自动审批依据：本文全部语义由 accepted ADR-004/008/012/015 与 approved Worker 运行时规格无歧义派生；无新增产品/架构/安全/隐私决策；不修改 Inbox 状态集合、lease/fencing、attemptCount 语义或 processor 三种结果；自检全部通过。
