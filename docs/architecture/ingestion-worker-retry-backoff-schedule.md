---
title: Aurora Worker 重试退避调度策略第一增量
status: approved
implementation-status: implemented
approval-status: approved
owner: ingestion/backend
created: 2026-08-02
last-reviewed: 2026-08-02
applies-to: apps/ingestion-worker（@aurora/ingestion-worker，capped exponential backoff + equal jitter、entropy provider、crypto adapter、notBefore、稳定失败结果）
related:
  - ../../AGENTS.md
  - ../../AURORA_RULES.md
  - '../../Aurora 代码规范.md'
  - '../../Aurora 测试规范.md'
  - '../../Aurora 文档规范.md'
  - '../../Aurora ADR 规范.md'
  - ../adr/ADR-004-asynchronous-event-processing.md
  - ../adr/ADR-008-ingestion-durable-buffering.md
  - ../adr/ADR-012-ingestion-worker-runtime.md
  - ../adr/ADR-015-ingestion-worker-retry-budget-policy.md
  - ../adr/ADR-016-ingestion-worker-retry-backoff-schedule.md
  - ../architecture/ingestion-worker-runtime.md
  - ../architecture/ingestion-worker-retry-budget-policy.md
  - ../architecture/ingestion-inbox-processing-repository.md
  - ../architecture/formalization-readiness.md
supersedes: none
review-cycle: ingestion-worker-backoff-schedule-contract-or-release
---

# Aurora Worker 重试退避调度策略第一增量

## 1. 定位、效力与当前状态

本文冻结数据接入 Worker 重试退避调度策略第一增量，实施为 `apps/ingestion-worker` 的退避能力（扩展，不新建包）。它承载 accepted ADR-016 的机器语义：capped exponential backoff + equal jitter、可注入 entropy provider、Node.js crypto entropy adapter、可选 `notBefore` 下限、稳定失败结果与输入不变约束。ADR-015 已定义 retry budget 与自动死信；本文只冻结**退避时间计算**，不修改 ADR-015 的任何结论，也不激活任何具体 processor。

**批准状态**：本文于 2026-08-02 由用户预先批准（`status: approved`、`approval-status: approved`）。`implementation-status` 于 2026-08-02 更新为 `implemented`：`apps/ingestion-worker` 退避能力已实施（`computeRetryBackoffDelay`/`calculateRetryBackoffSchedule` 等）并通过单元测试、真实 PostgreSQL 17.10 retry 场景与 benchmark 定向韧性场景及全仓质量门禁。本文由 accepted ADR-004/008/012/015/016 与 approved Worker 运行时、retry budget 规格无歧义派生；自动审批依据见规格自检节。

**声明边界**：`initialDelayMs`/`maxDelayMs` 生产值保持 `requires-benchmark / not-selected`，调用者必须显式传入；不得从本地 benchmark 直接固定生产退避参数。

## 2. 背景

Aurora 已接受 ADR-004（失败重试次数和退避有上限）、ADR-012（Worker 运行时）与 ADR-015（retry budget：`maxProcessingAttempts`、`decideRetryDisposition`、budget 未耗尽 `scheduleRetry`、耗尽自动 dead-letter）。`apps/ingestion-worker` 已有 processor 端口与 retry budget 策略并通过真实 PostgreSQL 验证。当前缺口：没有统一、可测试的退避时间计算能力；未来具体 processor 各自计算 `availableAt` 会产生不同算法；没有抖动、上限、上游 not-before 提示和溢出处理的正式语义。ADR-015 明确把退避算法留作后续独立模块；ADR-016（accepted）选择 capped exponential backoff + equal jitter。

## 3. 与 ADR-015 的关系

- 本模块**不修改 ADR-015 任何结论**；
- processor 继续拥有 retry 结果的 `availableAt`；
- Worker 收到 processor 的 retry 结果后，仍使用该结果中的 `availableAt`，**不得二次计算或覆盖**；
- retry budget、budget exhausted 自动 dead-letter、processor exception、invalid retry、lease lost 行为**全部不变**；
- 退避能力是**显式调用的辅助策略**；Worker 主循环**不**隐式调用退避策略。

## 4. 目标和非目标

### 目标

- 提供统一、可测试的退避时间计算（capped exponential + equal jitter）；
- 提供可注入 entropy provider 与 Node crypto adapter；
- 支持可选 `notBefore` 下限（未来 processor 尊重上游 Retry-After 或外部恢复时间）；
- 稳定失败结果（显式可辨识联合类型，不通过正常控制流抛异常）；
- 输入不变、结果只读；
- 单元测试、真实 PostgreSQL retry 场景、benchmark 定向韧性验证。

### 非目标

- 不实现具体错误/请求/性能 processor；
- 不让 Worker 主循环自动生成 retry 时间；
- 不修改 `IngestionEventProcessor` 结果契约；
- 不修改 retry budget 或 `maxProcessingAttempts`；
- 不实现人工重放、管理 API、处理存储、问题聚合、Source Map、告警；
- 不创建 CI、RDS、IaC；
- 不决定生产配置。

## 5. attemptCount 语义

沿用当前 Inbox/Worker 语义：

- 每次成功 claim 后 `attemptCount` 增加（第一次 = 1）；
- 第一次失败产生的下一次退避使用指数 0；
- 不增加第二套 attempt/retry 计数；
- 退避函数接收 `attemptCount` 作为输入，不自行维护计数器。

## 6. 配置

退避函数接收显式配置，不提供生产默认值：

- `initialDelayMs`：必须为正的安全整数；
- `maxDelayMs`：必须为正的安全整数且 `>= initialDelayMs`。

要求：

- 不读取环境变量；
- 不修改 `IngestionWorkerConfig`；
- 不在本轮决定生产值；
- 调用者必须显式传入。

指数倍率固定为 2，不做可配置 multiplier。

## 7. 指数公式

设 `attempt = attemptCount`：

```text
exponentialDelay = initialDelayMs × 2^(attempt - 1)
cappedDelay      = min(exponentialDelay, maxDelayMs)
```

要求：

- `exponentialDelay` 计算必须饱和处理（幂计算不得产生 `Infinity` 或不安全整数；达到 `maxDelayMs` 后不再增长）；
- 实现不得依赖浮点幂直接运算后不加保护（应使用安全整数幂，幂结果达到或超过 `maxDelayMs` 时直接取 `maxDelayMs`）。

## 8. equal jitter 公式

设 `entropy ∈ [0, 1)` 为有限数值：

```text
lowerBound = ceil(cappedDelay / 2)
delayMs    = lowerBound + floor(entropy × (cappedDelay - lowerBound + 1))
```

要求：

- `delayMs >= ceil(cappedDelay / 2)`；
- `delayMs <= cappedDelay`；
- 第一次失败不产生零延迟；
- 达到 `maxDelayMs` 后不再增长；
- `cappedDelay` 为 1 或 2 的极小值时，公式仍返回合法非零值（`ceil(1/2)=1`、`ceil(2/2)=1` 等）。

## 9. 饱和与溢出

- 指数计算饱和：`exponentialDelay` 超过 `maxDelayMs` 或产生不安全数值时，`cappedDelay` 直接等于 `maxDelayMs`；
- `now + delayMs` 的时间加法：若结果超出 `Date` 可表示范围，返回 `date_out_of_range` 稳定失败；
- 不使用浮点幂产生未受控值。

## 10. entropy provider

提供可注入的 entropy provider：

```ts
export interface RetryBackoffEntropyProvider {
  next(): number;
}
```

要求：

- 返回 `>= 0` 且 `< 1` 的有限数值；
- 非法返回值返回稳定失败结果 `invalid_entropy`；
- 不得抛到调用方（provider 异常也映射为稳定失败）；
- 禁止 `Math.random`；
- 禁止全局可变随机状态；
- 不把 seed、随机原始值或内部状态记录到日志。

## 11. crypto entropy adapter

提供 Node.js crypto 实现用于服务器运行时：

```ts
export function createNodeCryptoEntropyProvider(): RetryBackoffEntropyProvider;
```

- 使用 `node:crypto` 的随机字节派生 `[0, 1)` 有限数值；
- 不依赖全局可变状态；
- 与可注入 provider 同接口，可在测试中替换。

## 12. notBefore

输入包含可选 `notBefore`：

```ts
readonly notBefore?: Date;
```

行为：

- `calculatedAvailableAt = now + delayMs`；
- 存在有效 `notBefore` 时：`availableAt = max(calculatedAvailableAt, notBefore)`；
- `notBefore` 用于未来 processor 尊重上游 Retry-After 或外部服务恢复时间；
- 本模块不读取 HTTP Header，也不解释业务错误；
- 无效 `notBefore`（非 Date、NaN 时间）返回 `invalid_not_before`。

## 13. 成功和失败结果

显式可辨识联合类型，不通过正常控制流抛异常：

```ts
export type RetryBackoffResult =
  | {
      readonly status: 'success';
      readonly delayMs: number;
      readonly availableAt: Date;
      readonly cappedDelayMs: number;
    }
  | { readonly status: 'invalid_config' }
  | { readonly status: 'invalid_attempt_count' }
  | { readonly status: 'invalid_now' }
  | { readonly status: 'invalid_not_before' }
  | { readonly status: 'invalid_entropy' }
  | { readonly status: 'date_out_of_range' };
```

要求：

- 成功结果至少包含 `delayMs`、`availableAt`、`cappedDelayMs`；
- 结果对象冻结或保证只读；
- 输入 `Date`、配置对象不得被修改。

## 14. 输入不变

- 函数不修改调用方传入的配置对象、Date 或任何输入；
- 返回新对象，不共享可变状态。

## 15. 错误和诊断边界

- 稳定失败结果替代异常：调用方通过判别 `status` 处理，不依赖 `throw`；
- 退避策略不记录 EventEnvelope、错误堆栈、SQL、数据库 URL、客户端密钥；
- 不产生未受限日志；
- 允许（但不要求）调用方把稳定失败结果写回有界诊断。

## 16. Worker runtime 非集成边界

退避策略：

- 只计算时间；
- 不 `setTimeout`、不 `sleep`；
- 不访问数据库；
- 不调用 `scheduleRetry`、不调用 `markDeadLettered`；
- 不决定 retry budget；
- 不修改 `errorCode`；
- 不创建后台任务；
- Worker 主循环**不**隐式调用退避策略。

## 17. benchmark 验证

- 扩展现有 benchmark 的专门 retry 韧性场景；
- synthetic processor 显式调用退避策略；
- 第一次失败产生 `retry_waiting`；
- `available_at` 落在计算区间；
- 到期前不能重新 claim；
- 到期后可以 claim；
- 最终 processed；
- budget exhausted 场景仍使用 ADR-015；
- 无残留 leased/retry_waiting；
- Schema 和 Pool 完整清理；
- 该场景不计入 local-baseline 吞吐结果；
- 本轮无需重新运行耗时完整 local-baseline（实现未改变 HTTP/claim/Worker 并发/benchmark profile）；
- 必须运行：benchmark smoke、定向 retry resilience 场景、Worker 真实 PostgreSQL 集成测试。

## 18. 单元测试

至少覆盖：

- attemptCount = 1；
- attemptCount = 2；
- 大 attemptCount 饱和；
- `initialDelayMs = maxDelayMs`；
- entropy = 0；
- entropy 接近 1；
- cappedDelay 奇数和偶数；
- cappedDelay 极小值（1/2）；
- notBefore 早于计算结果；
- notBefore 晚于计算结果；
- 无效 attemptCount；
- 无效配置（非安全整数、0、负数、`maxDelayMs < initialDelayMs`）；
- NaN、Infinity 和非安全整数；
- 无效 Date；
- entropy 非法（>=1、NaN、Infinity）；
- entropy provider 抛异常；
- Date 越界（`date_out_of_range`）；
- 输入不变；
- 结果只读或冻结；
- 不使用 `Math.random`；
- 不创建 timer；
- 不访问数据库。

关键重试模块覆盖率维持 lines >= 85%、branches >= 80%、functions >= 85%、statements >= 85%。

不得为了覆盖率编写无断言价值测试。

## 19. PostgreSQL 集成测试

真实 PostgreSQL 17 验证（`AURORA_TEST_DATABASE_URL`；独立 Schema/命名空间隔离；清理失败显式报错）：

- synthetic processor 显式调用退避策略返回 retry；
- 第一次失败产生 `retry_waiting`；
- `available_at` 落在计算区间（`[now + ceil(capped/2), now + capped]`）；
- 到期前不可 claim；
- 到期后可 claim；
- 最终 processed；
- budget exhausted 场景仍走 ADR-015（`dead_lettered` + `retry_budget_exhausted`）；
- Worker 回归：`scheduleRetry` 仍使用 processor 返回的 `availableAt`（当 processor 直接返回时不被退避改写）；
- 无残留 leased/retry_waiting；
- Schema 与 Pool 完整清理。

## 20. 安全与隐私

- 不使用 `Math.random`；
- entropy 可控（可注入 + crypto adapter）；
- 无无限延迟和数值溢出；
- 无 timer 或后台任务；
- 不记录事件正文、密钥、SQL 或数据库 URL；
- 不把本机 benchmark 解释成生产参数。

## 21. 可观测性

- 退避策略本身不产生日志；稳定失败结果供调用方决定是否记录；
- 若调用方记录，只允许有界诊断（operation、稳定失败码、attemptCount、initialDelayMs/maxDelayMs），禁止 EventEnvelope、原始 Error、SQL、数据库 URL、客户端密钥。

## 22. 生产配置仍未决定

- `initialDelayMs`/`maxDelayMs` 生产值：`requires-benchmark / not-selected`；
- 不得依据本地 benchmark 固定生产参数；
- 调用方显式传入配置。

## 23. 重新评估条件

- 需要不同抖动算法（full jitter / decorrelated jitter）；
- 需要可配置指数倍率；
- 具体 processor 需要不同退避语义；
- 容量/成本 benchmark 揭示退避参数需调整。

## 24. 排除范围

- 具体事件 processor、数据处理与查询存储、聚合、分组、索引；
- 人工重放、管理 API、Source Map、告警；
- 修改 `IngestionEventProcessor` 结果契约、retry budget、`maxProcessingAttempts`；
- 修改 HTTP/OpenAPI、Inbox 状态或 Schema；
- CI、RDS、IaC、生产配置推荐。

## 25. 规格自检

- **权威一致性**：ADR-015 结论不变；processor 仍拥有 `availableAt`；Worker 不二次计算；不修改 event-schema/HTTP/OpenAPI；不激活具体 processor；不固定生产退避参数；
- **兼容性**：Worker 现有公共接口不被破坏；Inbox Repository 未变化；benchmark 只通过包根导入；无循环依赖；无私有路径访问；原有 Worker 测试全部通过；
- **计划质量**：规格每项要求都有对应 Task；类型、字段、失败码和公式全文一致；每个 Task 有完整 TDD；无占位；无第二模块内容；零上下文实施者可直接执行；
- **安全与可靠性**：不使用 `Math.random`；entropy 可控；无无限延迟和数值溢出；无 timer 或后台任务；不记录事件正文、密钥或数据库 URL；不把本机 benchmark 解释成生产参数。

自动审批依据：本文全部语义由 accepted ADR-004/008/012/015/016 与 approved Worker 运行时、retry budget 规格无歧义派生；无新增产品/架构/安全/隐私决策；不修改 ADR-015 结论或 processor 契约；用户已预先批准本消息中的精确退避设计；自检全部通过。
