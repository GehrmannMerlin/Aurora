---
title: ADR-016：数据接入 Worker 重试退避调度策略
status: accepted
implementation-status: not-started
approval-status: approved
owner: ingestion/backend
date: 2026-08-02
last-reviewed: 2026-08-02
applies-to: apps/ingestion-worker 的重试退避时间计算（capped exponential backoff + equal jitter、可注入 entropy、可选 notBefore、稳定失败结果）
related:
  - ../../AURORA_RULES.md
  - '../../Aurora ADR 规范.md'
  - ../../docs/architecture/platform-backend.md
  - ../../docs/architecture/formalization-readiness.md
  - ../../docs/architecture/ingestion-worker-runtime.md
  - ../../docs/architecture/ingestion-worker-retry-budget-policy.md
  - ../../docs/adr/ADR-004-asynchronous-event-processing.md
  - ../../docs/adr/ADR-008-ingestion-durable-buffering.md
  - ../../docs/adr/ADR-012-ingestion-worker-runtime.md
  - ../../docs/adr/ADR-015-ingestion-worker-retry-budget-policy.md
supersedes: none
superseded-by: none
---

# ADR-016：数据接入 Worker 重试退避调度策略

## 元数据

- 状态：accepted
- 决策状态：accepted
- 实施状态：not-started
- 审批状态：approved
- 日期：2026-08-02
- Owner：ingestion/backend
- 适用范围：`apps/ingestion-worker` 的重试退避时间计算（capped exponential backoff + equal jitter、可注入 entropy、可选 notBefore、稳定失败结果）
- 关联 PRD：[核心业务 PRD](../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md) 第 6、7 章
- 关联 Worker 规格：[Worker 运行时正式规格](../../docs/architecture/ingestion-worker-runtime.md)、[Worker retry budget 正式规格](../../docs/architecture/ingestion-worker-retry-budget-policy.md)
- 关联 Issue：none
- 关联实现 PR：none
- 替代 ADR：none
- 被替代 ADR：none

## 状态说明

本 ADR 于 2026-08-02 由用户批准（`decision-status: accepted`、`approval-status: approved`），实施状态保持 `not-started`。批准授权数据接入 Worker 重试退避调度策略的最终决定；批准不代表退避策略实现、具体 processor、生产退避参数或 CI/RDS/IaC 已经存在。**本 ADR 不修改 ADR-015**：processor 继续拥有 retry 结果的 `availableAt`，Worker 不二次计算或覆盖 processor 返回的可用时间；退避能力是显式调用的辅助策略，不激活任何具体 processor。

## 背景

Aurora 已接受 ADR-004（可靠接收与异步处理，要求失败重试次数和退避有上限）、ADR-008（数据接入可靠缓冲 = PostgreSQL 事务性 Inbox）、ADR-012（Worker 运行时，Node.js 24 原生异步）和 ADR-015（Worker 重试预算与自动死信：`maxProcessingAttempts`、`decideRetryDisposition`、budget 未耗尽 `scheduleRetry`、耗尽自动 `markDeadLettered{retry_budget_exhausted}`）。`apps/ingestion-worker` 已实现 processor 端口（`processed`/`retry`/`dead-letter`）与 retry budget 策略，并通过真实 PostgreSQL 17.10 验证。

当前缺口：没有统一、可测试的退避时间计算能力。未来具体 processor（错误/请求/性能）各自返回 retry 时若自行计算 `availableAt`，会产生不同算法；没有抖动、上限、上游 not-before 提示和溢出处理的正式语义；不能根据本地 benchmark 直接宣称生产配置已经确定。ADR-004 要求"失败重试次数和退避有上限"，ADR-015 明确把退避算法留作后续独立模块。

退避公式、抖动方式（固定 vs 无抖动指数 vs Equal Jitter）和长期 Worker 负载行为存在多个合理方案，按 ADR 规范 7.2 属需要长期保留取舍依据的高迁移成本决策。本 ADR 于 2026-08-02 由用户直接审批批准。

## 决策驱动因素

- **与 ADR-015 一致**：processor 继续拥有 `availableAt`；退避策略只提供**显式调用**的时间计算，Worker 主循环不得隐式调用；
- **统一算法**：避免未来多个具体 processor 各自实现退避，产生不可比、不可测的行为；
- **抖动**：无抖动的指数退避会在高并发重试时产生"惊群"（同批事件同刻重试），Equal Jitter 分散重试窗口；
- **上限**：`maxDelayMs` 封顶，避免无界等待与数值溢出；
- **第一次失败不产生零延迟**：`attemptCount = 1` 时仍有一定最小延迟，避免热点失败立即重放；
- **可测试性**：可注入 entropy，确定性测试；crypto adapter 用于服务器运行时；
- **不固定生产值**：`initialDelayMs`/`maxDelayMs` 由调用方显式传入，本轮不决定生产参数；
- **指数倍率固定**：倍率 2，不做可配置 multiplier，避免无实际需求的通用化。

## 现有约束

- ADR-004：SDK 不重试永久拒绝；失败重试次数和退避有上限；无法处理事件进入失败记录或死信；
- ADR-008：租约到期可重投；重试计数达上限后标记死信；不承诺处理顺序；
- ADR-012：Worker 运行时使用 `IngestionEventProcessor` 端口；不把 Worker 做成通用任务框架；
- ADR-015：processor 返回 `processed`/`retry`/`dead-letter`；retry 携带 `availableAt` 与稳定 `errorCode`；Worker 负责预算判断；budget 未耗尽调用 `scheduleRetry`（沿用 processor 的 `availableAt`）；耗尽自动 `markDeadLettered{retry_budget_exhausted}`；不实现退避算法；不新增 Inbox 状态或 Schema；
- Inbox 处理侧 Repository：`scheduleRetry` 只接受调用方显式提供的 `availableAt`；`attemptCount` 每次新领取递增（第一次为 1）；
- 代码规范：严格 TypeScript、不修改输入、不通过正常控制流抛异常、敏感信息不入日志。

## 候选方案

### 方案 A：固定间隔

**行为**：每次 retry 使用固定延迟（如固定 `delayMs`），不做指数增长、不做抖动。

**优点**：实现最简单、行为可预测、测试最容易。
**缺点**：无法反映失败严重程度随时间的合理增长；连续失败时不收敛；固定间隔对瞬时热点与长期故障区分度差；不满足"退避有上限、能分散重试窗口"的合理负载行为；重试风暴下所有事件同刻重试。
**选择结论**：不采用。

### 方案 B：无抖动的 capped exponential backoff

**行为**：`delayMs = min(initialDelayMs × 2^(attempt-1), maxDelayMs)`，无随机抖动。

**优点**：延迟随失败次数指数增长，有明确上限，符合指数退避直觉。
**缺点**：同一批失败事件在同一时刻重试，产生"惊群"效应；高并发下周期性突发；无随机性分散。
**选择结论**：作为中间候选记录，不采用。

### 方案 C：capped exponential backoff + equal jitter（推荐）

**行为**：

```text
exponentialDelay = initialDelayMs × 2^(attempt - 1)
cappedDelay      = min(exponentialDelay, maxDelayMs)
lowerBound       = ceil(cappedDelay / 2)
delayMs          = lowerBound + floor(entropy × (cappedDelay - lowerBound + 1))
```

其中 `entropy ∈ [0, 1)` 为有限数值（可注入 provider 或 Node crypto）。

**优点**：

- 延迟随失败指数增长并封顶（`maxDelayMs`），符合 ADR-004 退避有上限；
- Equal Jitter 让每次重试在 `[ceil(cappedDelay/2), cappedDelay]` 区间内均匀抖动，分散高并发重试窗口，避免惊群；
- 第一次失败（`attemptCount = 1`，指数 0）的延迟落在 `[ceil(initialDelayMs/2), initialDelayMs]`，不会产生零延迟；
- 抖动由可注入 entropy 控制，确定性测试可行；
- 可选 `notBefore` 让未来 processor 尊重上游 Retry-After 或外部服务恢复时间，但本轮不读取 HTTP Header；
- 纯函数：只计算时间，不 sleep、不访问数据库、不调用 `scheduleRetry`/`markDeadLettered`、不决定 retry budget、不修改 `errorCode`。

**缺点**：

- 比固定间隔略复杂；
- Equal Jitter 引入随机性，单次结果不可预测（但分布可预测、可注入熵确定）。

**选择结论**：采用。

### 候选比较

| 维度             | A：固定间隔   | B：无抖动 capped exponential | C：capped exponential + equal jitter |
| ---------------- | ------------ | ---------------------------- | ------------------------------------ |
| 指数增长         | 无           | 有                           | 有                                   |
| 封顶             | 是（固定）   | 是                           | 是                                   |
| 抖动             | 无           | 无                           | 有（Equal Jitter）                   |
| 分散重试窗口     | 无           | 无                           | 有                                   |
| 第一次失败延迟   | 固定         | `initialDelayMs`             | `[ceil(initialDelayMs/2), initialDelayMs]` |
| 可测试性         | 最高         | 高                           | 高（可注入 entropy）                 |
| 实现复杂度       | 最低         | 低                           | 中                                   |
| 满足"退避有上限" | 部分         | 满足                         | 满足                                 |

## 最终决策

**最终选择方案 C：capped exponential backoff + equal jitter。**

### 决定细节（全部在本 ADR 冻结）

1. **模块位置**：不创建新包；扩展 `apps/ingestion-worker`，新增职责文件（命名遵循仓库风格，如 `src/retry-backoff-types.ts`、`src/retry-backoff-policy.ts`、`src/retry-backoff-entropy.ts`）。退避策略不放入 event-schema、ingestion-inbox 或 tooling。
2. **attemptCount 语义**：沿用当前 Inbox/Worker 语义——每次成功 claim 后 `attemptCount` 增加；第一次处理 `attemptCount = 1`；第一次失败产生的下一次退避使用指数 0；不增加第二套计数。
3. **配置**：退避函数接收显式配置，不提供生产默认值；`initialDelayMs`、`maxDelayMs` 必须为正的安全整数且 `maxDelayMs >= initialDelayMs`；不读取环境变量；不修改 `IngestionWorkerConfig`；调用者必须显式传入。
4. **公式**：
   - `exponentialDelay = initialDelayMs × 2^(attempt - 1)`；
   - `cappedDelay = min(exponentialDelay, maxDelayMs)`；
   - `lowerBound = ceil(cappedDelay / 2)`；
   - `delayMs = lowerBound + floor(entropy × (cappedDelay - lowerBound + 1))`；
   - 指数计算必须饱和处理，不允许 `Infinity` 或不安全整数；达到 `maxDelayMs` 后不再增长。
5. **entropy**：可注入 provider（返回 `[0,1)` 有限数值）；Node.js `crypto` 实现用于服务器运行时；禁止 `Math.random`；禁止全局可变随机状态；不把 seed/随机原始值记录到日志；非法 entropy 返回稳定失败。
6. **availableAt**：输入至少包含 `attemptCount`、`now`、可选 `notBefore`；`calculatedAvailableAt = now + delayMs`；存在有效 `notBefore` 时 `availableAt = max(calculatedAvailableAt, notBefore)`。
7. **结果语义**：显式可辨识联合类型，不通过正常控制流抛异常；稳定失败至少区分 `invalid_config`、`invalid_attempt_count`、`invalid_now`、`invalid_not_before`、`invalid_entropy`、`date_out_of_range`；成功结果至少包含 `delayMs`、`availableAt`、`cappedDelayMs`；结果冻结或保证只读；输入不被修改。
8. **运行边界**：退避策略只计算时间；不 `setTimeout`/`sleep`；不访问数据库；不调用 `scheduleRetry`/`markDeadLettered`；不决定 retry budget；不修改 `errorCode`；不记录 EventEnvelope；不产生未受限日志；不创建后台任务。

### 与 ADR-015 的关系（冻结）

- 本 ADR **不修改 ADR-015 的任何最终结论**；
- processor 继续拥有 retry 结果的 `availableAt`；
- Worker 收到 processor 的 retry 结果后，仍使用该结果中的 `availableAt`，**不得二次计算或覆盖**；
- retry budget（`maxProcessingAttempts`）、budget exhausted 自动 dead-letter、processor exception、invalid retry、lease lost 行为**全部不变**；
- 退避策略是**显式调用的辅助策略**；未来具体 processor 可选择调用它以生成 `availableAt`，但本 ADR 不激活任何具体 processor，也不让 Worker 主循环隐式调用。

## 结果与影响

### 正面影响

- 统一、可测试的退避时间计算能力，避免多个 processor 各自实现；
- 指数增长 + 封顶满足 ADR-004 退避有上限；
- Equal Jitter 分散高并发重试窗口，避免惊群；
- 第一次失败不产生零延迟；
- 可注入 entropy + crypto adapter，确定性测试与服务器运行时分离；
- 不固定生产参数，数值由调用方显式传入。

### 负面影响与代价

- 比固定间隔略复杂；
- Equal Jitter 引入随机性（分布可预测）；
- 未激活任何具体 processor，退避策略暂时只有 benchmark 定向场景消费。

### 未解决问题

- `initialDelayMs`/`maxDelayMs` 生产值：`requires-benchmark / not-selected`（不得从本地 benchmark 直接固定）；
- 具体事件 processor 是否以及何时调用退避策略：`not-started`；
- 是否由 Worker policy 自动决定何时使用退避：本 ADR 明确不自动调用。

## 实施约束

- 完全遵守 ADR-004/008/012/015；不修改 processor retry 结果结构；
- 不修改 `IngestionWorkerConfig`、`IngestionEventProcessor`、`decideRetryDisposition`、`RetryDisposition`；
- 不修改 Inbox 状态集合、租约、fencing、`scheduleRetry`/`markDeadLettered` 签名；
- 不修改 event-schema、HTTP 或 OpenAPI；
- 不使用 `Math.random`；不创建 timer/后台任务；不访问数据库；
- 不决定生产退避参数；不激活具体 processor；
- benchmark 工具只通过 `@aurora/ingestion-worker` 包根使用退避能力。

## 迁移方案

本 ADR accepted 后：编写退避正式规格 → writing-plans → 实施 `apps/ingestion-worker` 退避能力（capped exponential + equal jitter、entropy provider、crypto adapter、notBefore、稳定结果）→ 单元测试 + 真实 PostgreSQL retry 场景 + benchmark 定向韧性场景验证。

## 回滚方案

退避能力是纯函数辅助策略，与 Worker 主循环解耦。若实施中发现缺陷，可替换策略实现而不影响 processor 端口、retry budget 或 Inbox 语义；不涉及新 Migration 或 Schema。不得通过静默丢弃事件降级。

## 验证方式

- 单元测试：attempt 1/2/大值饱和、`initialDelayMs = maxDelayMs`、entropy 0/接近 1、cappedDelay 奇偶、notBefore 早/晚于计算、无效配置/attemptCount/now/notBefore/entropy、NaN/Infinity/非安全整数、无效 Date、Date 越界、输入不变、结果只读、不使用 `Math.random`、不创建 timer、不访问数据库；
- Worker 回归：retry budget 不变、`scheduleRetry` 仍使用 processor 返回的 `availableAt`、budget exhausted 自动 dead-letter、processor exception/invalid retry/lease lost 行为不变、Worker 主循环无隐式调用退避；
- 真实 PostgreSQL：synthetic processor 显式调用退避，第一次失败产生 `retry_waiting`、`available_at` 落在计算区间、到期前不可 claim、到期后可 claim、最终 processed、budget exhausted 仍用 ADR-015、无残留 leased/retry_waiting、Schema/Pool 清理；
- benchmark smoke + 定向 retry 韧性场景；
- 全仓质量门禁与覆盖率 85/80/85/85。

## 重新评估条件

- 需要不同抖动算法（如 full jitter 或 decorrelated jitter）；
- 需要可配置指数倍率；
- 具体 processor 需要不同退避语义；
- 容量/成本 benchmark 揭示退避参数需调整。

## 追加记录

本 ADR 的评审、状态、实施和替代变化只能追加在本节之后。

### 2026-08-02：创建（proposed）

- 状态 `proposed / not-started / awaiting-user-approval`；
- 由 2026-08-02 Worker 退避前置门禁创建；
- 门禁确认退避公式、抖动方式、entropy、notBefore、溢出处理和统一算法均无 approved 来源；ADR-015 明确把退避算法留作后续独立模块；ADR-004 要求退避有上限；
- 未调用 writing-plans、未实施代码、未固定生产参数；
- 等待用户审批，不自动批准、不实施。

### 2026-08-02：用户批准与最终决定

- 决策状态更新为 `accepted`，实施状态保持 `not-started`，审批状态 `approved`；
- 用户批准本消息中的精确决定：capped exponential backoff + equal jitter；`initialDelayMs`/`maxDelayMs` 显式传入且不提供生产默认值；指数倍率固定 2；attemptCount 沿用 Inbox 语义（第一次 = 1，指数 0）；可注入 entropy provider + Node crypto adapter；禁止 `Math.random`；可选 `notBefore` 下限（`availableAt = max(now + delayMs, notBefore)`）；稳定失败结果（`invalid_config`/`invalid_attempt_count`/`invalid_now`/`invalid_not_before`/`invalid_entropy`/`date_out_of_range`）；成功结果含 `delayMs`/`availableAt`/`cappedDelayMs`；输入不变、结果只读；退避只计算时间不 sleep/访问数据库/调用 scheduleRetry 或 markDeadLettered；**不修改 ADR-015**（processor 继续拥有 availableAt、Worker 不二次覆盖）；不激活具体 processor；不固定生产退避参数；
- 本次批准不代表退避策略实现、具体 processor、生产退避参数、CI、RDS 或 IaC 已经实现。

### 2026-08-02：独立非作者审查（真实审查结论）

- 独立审查 subagent（只读，未修改任何文件）完成非作者审查；
- 审查确认：与 approved 规范（PRD/架构/代码/测试/文档/ADR 规范）及 accepted ADR-004/008/012/015 无冲突；不修改 processor retry 结果结构、retry budget、`maxProcessingAttempts`、Inbox 状态或 Worker 主循环语义；退避为显式辅助策略，Worker 主循环无隐式调用；本 ADR 由用户消息明确批准，正当承接 ADR-015 显式留出的退避算法模块；
- 公式数学自洽：attempt=1 非零延迟、上界封闭、指数饱和收敛、attemptCount 与 Inbox 语义一致（第一次=1、指数 0）；
- 候选方案真实、比较矩阵公平；迁移/回滚/验证/重新评估完整；范围控制干净；
- 审查提出的非阻塞改进建议：比较矩阵措辞略偏 C（不改变结论）；验证清单建议补 `cappedDelay` 极小值（cap=1/2）用例；
- 审查结论：**可接受进入 writing-plans 与正式代码实施**。

### 2026-08-02：退避策略第一增量实施证据

- 实施状态更新为 `implemented`：`apps/ingestion-worker` 退避能力已实施并通过单元测试、真实 PostgreSQL 17.10 retry 场景、benchmark smoke 与全仓质量门禁；具体事件 processor、生产退避参数与完整数据接入链路仍未实现，故不扩大范围；
- 实施内容：`src/retry-backoff-types.ts`（`RetryBackoffConfig`、`RetryBackoffEntropyProvider`、`RetryBackoffResult` 可辨识联合类型）、`src/retry-backoff-policy.ts`（`calculateRetryBackoffSchedule`：capped exponential backoff + equal jitter、饱和指数、`notBefore` 下限、`date_out_of_range` 溢出防护、输入不变、成功结果冻结）、`src/retry-backoff-entropy.ts`（`createNodeCryptoEntropyProvider`：`randomBytes(4)` → `[0,1)` 有限值，不用 `Math.random`、无全局可变状态）；包根 `index.ts` 导出最小公共 API；
- 公式：`exponentialDelay = initialDelayMs × 2^(attempt-1)`；`cappedDelay = min(exponentialDelay, maxDelayMs)`；`lowerBound = ceil(cappedDelay/2)`；`delayMs = lowerBound + floor(entropy × (cappedDelay - lowerBound + 1))`；`availableAt = max(now + delayMs, notBefore?)`；
- attemptCount 语义不变（第一次=1、指数 0）；未修改 ADR-015 结论、`IngestionEventProcessor` 契约、`decideRetryDisposition`、retry budget、Inbox 状态或 Worker 主循环语义；退避为显式调用的辅助策略，Worker 主循环不隐式调用；
- 测试：22 个退避单元测试（attempt 1/2/大值饱和、`initialDelayMs=maxDelayMs`、entropy 0/接近 1、cappedDelay 奇偶/极小值、notBefore 早/晚、无效 config/attemptCount/now/entropy/notBefore、NaN/Infinity/非安全整数、Date 越界、输入不变、结果冻结、crypto adapter 200 次抽样）+ 6 个真实 PostgreSQL 17.10 退避 retry 集成测试（processor 显式调用退避 → `retry_waiting` 且 `available_at` 落在计算区间、可 claim、notBefore 提高 availableAt、budget exhausted 仍走 ADR-015 dead-letter、无残留 leased、清理）+ 包入口与安全负例（无 `Math.random`/timer）；
- Worker 覆盖率 lines 97.74 / statements 95.08 / branches 91.39 / functions 87.93（≥ 85/80/85/85）；
- 验证命令：`pnpm --filter @aurora/ingestion-worker test`（101）、`test:integration`（27）、`test:coverage`、`typecheck`、`lint`、`build`、`pnpm benchmark:ingestion:smoke`、`pnpm check:ci` 全部 exit 0；`git diff --check` 通过；
- 实施 Commit：none（未提交）；
- Issue/PR：none；
- 未实现：具体事件 processor、人工重放、处理存储、凭证管理 HTTP API、管理平台、CI、RDS、IaC；`initialDelayMs`/`maxDelayMs` 生产值保持 `requires-benchmark / not-selected`。
