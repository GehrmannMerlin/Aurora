---
title: Aurora 请求样本选择策略第一增量
status: approved
implementation-status: implemented
approval-status: approved
owner: ingestion/backend
created: 2026-08-03
last-reviewed: 2026-08-03
applies-to: apps/ingestion-worker（@aurora/ingestion-worker）的请求安全样本选择策略（确定性纯函数、类别资格判断、优先级、稳定结果）
related:
  - ../../AGENTS.md
  - ../../AURORA_RULES.md
  - '../../Aurora 代码规范.md'
  - '../../Aurora 测试规范.md'
  - '../../Aurora 文档规范.md'
  - '../../Aurora ADR 规范.md'
  - ../adr/ADR-004-asynchronous-event-processing.md
  - ../adr/ADR-005-event-schema-source-of-truth.md
  - ../adr/ADR-006-one-way-dependencies.md
  - ../adr/ADR-012-ingestion-worker-runtime.md
  - ../adr/ADR-015-ingestion-worker-retry-budget-policy.md
  - ../adr/ADR-016-ingestion-worker-retry-backoff-schedule.md
  - ../adr/ADR-017-ingestion-dead-letter-manual-replay.md
  - ../adr/ADR-018-error-event-occurrence-processing-storage.md
  - ../adr/ADR-019-request-event-aggregation-and-bounded-diagnostic-sample-storage.md
  - ../adr/ADR-020-idempotent-request-metric-bucket-aggregation.md
  - ../protocol/request-event-contract.md
  - ../architecture/request-event-sample-processing-store.md
  - ../architecture/request-metric-aggregate-store.md
  - ../architecture/error-event-processor.md
  - ../architecture/formalization-readiness.md
  - ../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md
supersedes: none
review-cycle: request-sample-selection-policy-contract-or-release
---

# Aurora 请求样本选择策略第一增量

## 1. 定位、效力与当前状态

本文冻结请求样本选择策略第一增量，实施为 `apps/ingestion-worker`（包名 `@aurora/ingestion-worker`）内部的确定性纯函数。它承载 accepted ADR-019 的"样本类别有界性由未来样本选择策略执行器强制"语义：接收未来 Request Processor 解析和分类后的最小内部事实，按固定优先级判断该 Request 事件是否应保存为安全诊断样本（`store`）或跳过（`skip`），返回稳定可判别结果。

**批准状态**：本文由用户于 2026-08-03 预先批准（`status: approved`、`approval-status: approved`）。`implementation-status` 于 2026-08-03 更新为 `implemented`：`apps/ingestion-worker` 的请求样本选择策略已实施并通过单元测试、安全负例与全仓质量门禁。本文由 accepted ADR-004/005/006/012/015/016/017/018/019/020、approved 请求事件协议契约、请求安全样本存储规格、RULE-REQUEST-PERSISTENCE-20260803-002 与 PRD 5.1.2/5.1.3/5.1.5/5.1.6 无歧义派生；自动审批依据见规格自检节。

**声明边界**：本模块是**确定性的"样本资格判断"**，不是随机采样算法；不生成随机数、不按概率再次采样。SDK 和数据接入阶段已执行的采集与采样结果是本模块的上游事实，本模块不重新计算或补偿未观察数据。本模块只判断类别资格，**不**持久化样本、**不**更新指标、**不**返回 Worker 结果、**不**实现 Request Processor。

## 2. 元数据、Owner 和范围

- **Owner**：ingestion/backend
- **适用范围**：`apps/ingestion-worker` 内的请求样本选择策略：输入类型、判别联合输出、决策函数、优先级、单元测试、README、正式规格、ADR-019 实施证据。
- **明确非职责**：
  - 随机采样算法、概率采样、采样率、水位；
  - Request Processor、Performance Processor；
  - 样本持久化（`persistRequestEventSample`）；
  - 指标聚合（`persistRequestMetricContribution`）；
  - Request Metric Query、percentile、采样外推；
  - Event Processor Router、production composition root；
  - 读取项目配置、计算慢请求阈值、判断自定义状态码是否命中；
  - 解析 `event_inbox`、解析完整 `EventEnvelope`、解析 Request 正文；
  - retry/backoff、dead-letter、Worker 结果映射；
  - 数据保留与清理。

## 3. 模块选择依据

- accepted ADR-019 决定细节 3 批准允许保存详细安全样本的类别（网络失败、请求超时、HTTP 429、HTTP 500—599、项目配置明确纳入请求问题的额外 HTTP 状态码、已经通过 SDK 和服务端采样规则的慢请求）；决定细节 4 批准默认不保存的类别（普通成功、用户主动取消、普通 400—428、普通 430—499）；决定细节 14 明确"样本类别（网络失败/超时/429/5xx/慢请求）有界性由未来'样本选择策略执行器'强制"；
- `apps/ingestion-worker` 已有纯 policy 模式：`retry-policy.ts`（`decideRetryDisposition`）、`retry-backoff-policy.ts`（`calculateRetryBackoffSchedule`）都是确定性纯函数、稳定可判别结果、不修改输入、不抛出普通控制流异常；本模块复用同一模式；
- `@aurora/processing-store` 的 `request_event_samples` 与 `request_metric_buckets`/`request_metric_event_applications` 已实施（ADR-019/020），其规格明确"样本类别判断由未来样本选择策略执行器负责，本 Repository 只持久化已由上游选中的合法 Request 事件"；
- 用户已批准本提示词第一节的决策表、优先级与边界。

## 4. 系统与模块位置

- 本模块位于 `apps/ingestion-worker`（`@aurora/ingestion-worker`，`aurora.layer: service`）；
- 遵循既有 `retry-policy.ts`/`retry-backoff-policy.ts` 纯 policy 组织模式；
- **不**新建 package；**不**放入 `@aurora/event-schema`、`@aurora/processing-store`、`@aurora/ingestion-inbox`、`apps/ingestion-api` 或任何 SDK 包；
- 默认不扩大 `@aurora/ingestion-worker` 包根公共 API；不新增跨包依赖；不创建新的 public export（与 `retry-policy.ts` 内部定位一致）；
- 允许从 `@aurora/event-schema` 包根导入真实 `RequestOutcome` 类型；禁止深层导入。

## 5. 输入类型

本模块只接收未来 Request Processor 已经解析和分类后的最小内部事实，不接收请求体、响应体、Header、Cookie、Authorization、完整 URL、Query 参数、页面文本、用户信息、完整 Request Event JSON、PostgreSQL Row、`request_event_samples` 或 `request_metric_buckets`。

```ts
export interface RequestSampleSelectionInput {
  readonly outcome: RequestOutcome; // @aurora/event-schema 包根 RequestOutcome（五值）
  readonly statusCode?: number; // 事件领域语义中的真实可空状态码（协议解析后的可选字段）
  readonly isSlow: boolean; // 由未来 Request Processor 按项目慢请求阈值判定
  readonly isAdditionalMonitoredStatus: boolean; // 由未来 Request Processor 解析项目配置后传入
}
```

### 5.1 outcome

- 必填，只允许 `@aurora/event-schema` 包根 `RequestOutcome` 的五个值：`success`、`http_error`、`network_error`、`timeout`、`canceled`；
- 从 `@aurora/event-schema` 包根导入真实类型，不复制枚举、不散落魔法字符串。

### 5.2 statusCode

- 可选；存在时必须是 `100..599` 的安全整数（与 `REQUEST_EVENT_LIMITS` 一致）；
- 使用**事件领域语义中的真实可空状态码**，不是数据库 `status_code = 0` 哨兵（0 哨兵是 ADR-020 指标桶的持久化表示，不是本策略输入）；
- 网络失败、超时、取消通常不提供状态码。

### 5.3 isSlow

- 必填布尔；
- 由未来 Request Processor 按项目慢请求阈值判定；本策略不计算阈值、不读取配置；
- 语义：该请求已判定为慢请求。

### 5.4 isAdditionalMonitoredStatus

- 必填布尔；
- 由未来 Request Processor 解析项目配置后传入；本策略不读取项目配置、不定义配置存储格式、不决定额外状态码范围如何持久化；
- 语义：该项目配置明确将当前状态码纳入监控。

## 6. 输出判别联合

```ts
export type RequestSampleSelectionDecision =
  | {
      readonly decision: 'store';
      readonly reason:
        | 'network_failure'
        | 'timeout'
        | 'http_429'
        | 'http_5xx'
        | 'configured_status'
        | 'slow_request';
    }
  | {
      readonly decision: 'skip';
      readonly reason: 'cancelled' | 'successful_not_slow' | 'unmonitored_status';
    }
  | {
      readonly decision: 'invalid';
      readonly diagnosticCode: 'invalid_request_sample_selection_input';
    };
```

- `store`：应保存为安全诊断样本；
- `skip`：不应保存为安全诊断样本；
- `invalid`：输入非法（未知 outcome、statusCode 越界、布尔非布尔）；普通控制流不抛出，与 `decideRetryDisposition`/`calculateRetryBackoffSchedule` 模式一致。

## 7. 完整决策表

| #   | 条件                                                                                                   | decision | reason                                                                         |
| --- | ------------------------------------------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------ |
| 1   | outcome = `canceled`                                                                                   | skip     | `cancelled`                                                                    |
| 2   | outcome = `network_error`                                                                              | store    | `network_failure`                                                              |
| 3   | outcome = `timeout`                                                                                    | store    | `timeout`                                                                      |
| 4   | outcome = `http_error` 且 statusCode = `429`                                                           | store    | `http_429`                                                                     |
| 5   | outcome = `http_error` 且 statusCode ∈ `500..599`                                                      | store    | `http_5xx`                                                                     |
| 6   | outcome = `http_error` 且 isAdditionalMonitoredStatus = true                                           | store    | `configured_status`                                                            |
| 7   | outcome = `http_error` 且 isSlow = true                                                                | store    | `slow_request`                                                                 |
| 8   | outcome = `http_error` 且 statusCode = `200`（合法但不属于任何受监控类别）                             | store    | `slow_request`（若 isSlow = true）或 `unmonitored_status`（若 isSlow = false） |
| 9   | outcome = `success` 且 isSlow = true                                                                   | store    | `slow_request`                                                                 |
| 10  | outcome = `success` 且 isSlow = false                                                                  | skip     | `successful_not_slow`                                                          |
| 11  | outcome = `http_error`、statusCode 未命中 429/5xx、isAdditionalMonitoredStatus = false、isSlow = false | skip     | `unmonitored_status`                                                           |
| 12  | 输入非法（未知 outcome / statusCode 越界 / 布尔非法）                                                  | invalid  | `invalid_request_sample_selection_input`                                       |

### 7.1 决策优先级（固定）

```text
cancelled
→ network failure
→ timeout
→ HTTP 429
→ HTTP 500—599
→ configured status
→ slow request
→ skip
```

同一输入调用任意次数必须返回完全一致的结果（确定性、无随机、无隐藏状态）。

## 8. 每个 reason 的语义

| reason                | decision | 语义                                                                                                                |
| --------------------- | -------- | ------------------------------------------------------------------------------------------------------------------- |
| `cancelled`           | skip     | 用户主动取消的请求；即使 isSlow=true 或 isAdditionalMonitoredStatus=true，只要真实 outcome 是 `canceled`，仍然 skip |
| `network_failure`     | store    | 网络失败（`network_error`），保存安全样本供诊断；即使 isSlow=true 也优先                                            |
| `timeout`             | store    | 请求超时（`timeout`），保存安全样本供诊断；即使 isSlow=true 也优先                                                  |
| `http_429`            | store    | HTTP 429，保存安全样本供诊断；即使 isSlow=true 也优先                                                               |
| `http_5xx`            | store    | HTTP 500—599，保存安全样本供诊断；即使 isSlow=true 也优先                                                           |
| `configured_status`   | store    | 项目配置明确纳入监控的额外状态码（isAdditionalMonitoredStatus=true）；本策略不读取项目配置                          |
| `slow_request`        | store    | 已由未来 Processor 按项目慢请求阈值判定为慢请求（isSlow=true），未命中更高优先级类别                                |
| `successful_not_slow` | skip     | 普通成功且不慢                                                                                                      |
| `unmonitored_status`  | skip     | 默认不监控的普通 4xx 等未命中任何受监控类别且不慢                                                                   |

## 9. Request outcome 到决策的映射

| outcome         | 默认处理                                                                                         | 说明                                     |
| --------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| `success`       | 慢则 store/`slow_request`，否则 skip/`successful_not_slow`                                       | PRD 5.1.3：慢请求保存最小定位信息        |
| `http_error`    | 按 statusCode 命中 429/5xx → store；配置监控 → store；慢 → store；否则 skip/`unmonitored_status` | PRD 5.1.2/5.1.3、ADR-019 决定细节 3/4    |
| `network_error` | store/`network_failure`                                                                          | PRD 5.1.1、ADR-019 决定细节 3            |
| `timeout`       | store/`timeout`                                                                                  | PRD 5.1.1、ADR-019 决定细节 3            |
| `canceled`      | skip/`cancelled`                                                                                 | PRD 5.1.2、ADR-019 决定细节 4；永远 skip |

## 10. statusCode 边界

- 只接受 `100..599`（与 `REQUEST_EVENT_LIMITS.minStatusCode`/`maxStatusCode` 一致）的安全整数；
- `429` 是独立类别；`500..599` 是独立类别；
- 其他 4xx（如 400—428、430—499）默认 `unmonitored_status`（skip），除非 isAdditionalMonitoredStatus=true 或 isSlow=true；
- `200` 等成功状态码不命中任何受监控类别；在 `http_error` 或 `success` outcome 下按 isSlow 决定；
- **不使用** `status_code = 0` 数据库哨兵；缺失 statusCode 以 `undefined` 表达（网络失败/超时/取消通常无状态码）。

## 11. isSlow 的上游责任

- `isSlow` 由未来 Request Processor 按项目慢请求阈值（PRD 5.1.3 默认 3000ms，可配置）判定；
- 本策略不计算阈值、不读取配置、不比较 durationMs；
- 本策略只消费已经判定好的布尔事实。

## 12. isAdditionalMonitoredStatus 的上游责任

- `isAdditionalMonitoredStatus` 由未来 Request Processor 解析项目配置后传入；
- 本策略不读取项目配置、不定义配置存储格式、不决定额外状态码范围如何持久化；
- 本策略只消费已经解析好的布尔事实。

## 13. 确定性

- 同一输入调用任意次数返回完全一致的结果；
- 不生成随机数、不按概率采样、无隐藏可变状态、无全局状态、无时钟依赖；
- 输出对象可冻结（`Object.freeze`），不修改输入对象。

## 14. 无副作用

本模块不得产生副作用：

- 不写数据库；
- 不调用 `persistRequestEventSample`；
- 不调用 `persistRequestMetricContribution`；
- 不修改输入；
- 不记录原始事件；
- 不发送日志；
- 不读取当前时间（`Date.now()`/`new Date()`）；
- 不读取环境变量（`process.env`）；
- 不访问网络；
- 不访问文件系统。

## 15. 隐私和日志边界

- 输入不含请求体/响应体/Header/Cookie/Authorization/完整 URL/Query/页面文本/用户信息；
- 决策结果不含敏感字段；
- 不写日志、不回显输入值；
- 测试数据使用固定合成项目 ID 与合成状态码，不含真实敏感信息。

## 16. 依赖方向

- 依赖 `@aurora/event-schema` 包根（仅类型 `RequestOutcome`；`RequestEventBody`/`RequestOutcome` 常量作为唯一枚举来源）；
- 依赖 worker 内部 `./retry-policy.ts` 或 `./retry-backoff-policy.ts` 的纯函数模式（仅风格参考，不 import）；
- `apps/ingestion-worker` 为 `aurora.layer: service`，允许 `service → {protocol, data, tooling}`；本模块不新增任何跨包依赖；
- 不访问 `@aurora/processing-store`、`@aurora/ingestion-inbox`、`@aurora/event-schema/src` 或任何私有路径；
- 不产生循环依赖。

## 17. 未来 Request Processor 的调用方式

未来 Request Processor 在解析并分类请求事件后调用：

```ts
const decision = decideRequestSampleSelection({
  outcome,
  statusCode,
  isSlow,
  isAdditionalMonitoredStatus,
});

if (decision.decision === 'store') {
  // 仅当策略判定 store 时才调用 persistRequestEventSample
}
```

本模块不定义 Processor 的事务边界、指标提交顺序或 Worker 结果映射；这些属于后续 Request Processor 模块。

## 18. 测试矩阵

至少覆盖：

1. `canceled` + isSlow=false → skip/`cancelled`；
2. `canceled` + isSlow=true → skip/`cancelled`；
3. `canceled` + isAdditionalMonitoredStatus=true → skip/`cancelled`；
4. `network_error` → store/`network_failure`；
5. `network_error` + isSlow=true → store/`network_failure`；
6. `timeout` → store/`timeout`；
7. `http_error` + 429 → store/`http_429`；
8. `http_error` + 429 + isSlow=true → store/`http_429`；
9. `http_error` + 500 → store/`http_5xx`；
10. `http_error` + 599 → store/`http_5xx`；
11. `http_error` + 499 + isAdditionalMonitoredStatus=false + isSlow=false → skip/`unmonitored_status`；
12. `http_error` + 404 + isAdditionalMonitoredStatus=true → store/`configured_status`；
13. `http_error` + 404 + isAdditionalMonitoredStatus=false + isSlow=true → store/`slow_request`；
14. `success` + isSlow=true → store/`slow_request`；
15. `success` + isSlow=false → skip/`successful_not_slow`；
16. 同一输入调用 100 次结果一致；
17. 输入对象未被修改；
18. 全部真实 `RequestOutcome` 五值穷尽（`success`/`http_error`/`network_error`/`timeout`/`canceled`）；
19. 不依赖数据库 `status_code=0`；
20. 不调用 `persistRequestEventSample`；
21. 不调用 `persistRequestMetricContribution`；
22. 不产生日志或敏感信息；
23. 未知 outcome → invalid；
24. statusCode 越界（<100、>599、非整数）→ invalid；
25. 布尔非法 → invalid。

本模块很小，以实现 100% lines/functions/branches 为目标，但不通过修改或降低全局覆盖率门槛实现。项目最低门槛保持 lines ≥ 85%、branches ≥ 80%、functions ≥ 85%、statements ≥ 85%。

## 19. 文档影响

- `apps/ingestion-worker/README.md`：增加请求样本选择策略职责与接口；
- 本规格 `implementation-status` 更新为 `implemented`；
- `docs/README.md`：增加一行模块条目；
- `docs/architecture/formalization-readiness.md`：更新状态记录；
- ADR-019 追加实施记录：样本选择策略核心能力证据，保持 `accepted / in-progress`；
- ADR-020 保持 `accepted / implemented`；
- `AGENTS.md`/`AURORA_RULES.md`：仅在代码和完整门禁实际通过后更新阶段快照；
- `docs/adr/README.md` 如需同步 ADR-019 状态。

## 20. 回滚

- 本模块是 `apps/ingestion-worker` 内部独立纯函数模块，与 Worker 运行时、processing-store、event-schema、Inbox 解耦；
- 回滚只需移除 `request-sample-selection-policy.ts` 及其测试与 README 条目，不影响任何既有模块；
- 不涉及 Migration；不修改任何公共 API。

## 21. ADR-019 关联

- 本模块是 ADR-019 已批准产品语义（决定细节 3/4/9/14）的普通纯函数实现；
- 不改变系统边界、数据库、公共事件协议、隐私或项目配置长期模型；
- **不需要新 ADR**；不创建 ADR-021；
- ADR-019 保持 `accepted / in-progress`；ADR-020 保持 `accepted / implemented`；
- 在 ADR-019 追加实施记录中关联本模块。

## 22. 明确排除的后续模块

- Request Processor（not-started）；
- Performance Processor（not-started）；
- 样本持久化执行器（把 `store` 决策转换为 `persistRequestEventSample` 调用，属于 Request Processor）；
- 指标贡献提交（`persistRequestMetricContribution`，属于 Request Processor）；
- Event Processor Router（not-started / blocked）；
- production composition root（not-started / blocked）；
- Request Metric Query、percentile、采样外推（not-started）；
- Issue 分组、fingerprint、Source Map、告警（not-started）；
- 数据保留与清理（not-started）。

## 23. 规格自检

- **权威一致性**：outcome 五值来自 event-schema 包根；statusCode 边界来自 `REQUEST_EVENT_LIMITS`；决策表/优先级逐条映射 ADR-019 决定细节 3/4、PRD 5.1.2/5.1.3/5.1.5/5.1.6 与 RULE-REQUEST-PERSISTENCE-20260803-002；不创建第二套 Schema；不改变 Inbox/Worker/processing-store/event-schema/OpenAPI；
- **兼容性**：不新增跨包依赖；无循环依赖；无私有深导入；不扩大 worker 包根公共 API；既有模块回归不受影响；
- **计划质量**：规格每项要求都有 Task；输入/输出/决策表/优先级全文一致；每个 Task 有真实 TDD；无占位；零上下文实施者可直接执行；
- **安全和数据**：不接收/记录请求体、响应体、Header、Cookie、Authorization、完整 URL、Query、页面文本、用户信息；不写数据库；不写日志；不读取时间/环境变量；测试数据合成；
- **确定性**：同一输入结果一致；无随机、无隐藏状态；
- **范围控制**：只实现样本资格判断；不实现随机采样、Processor、Store、Query、Router、production composition root；
- **ADR 门禁**：无需新 ADR；ADR-019 保持 in-progress；ADR-020 保持 implemented。

自动审批依据：本文全部语义由 accepted ADR-019（决定细节 3/4/9/14）、PRD 5.1.2/5.1.3/5.1.5/5.1.6、RULE-REQUEST-PERSISTENCE-20260803-002 与请求事件协议契约无歧义派生；用户已通过本模块提示词明确批准决策表、优先级与边界；无新增产品/架构/安全/隐私决策（isSlow/isAdditionalMonitoredStatus 由未来 Request Processor 负责，本模块只消费布尔事实；不读取项目配置）；自检全部通过。
