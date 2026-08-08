---
title: Aurora 请求事件 Processor 核心第一增量
status: approved
implementation-status: implemented
approval-status: approved
owner: ingestion/backend
created: 2026-08-03
last-reviewed: 2026-08-03
applies-to: apps/ingestion-worker（@aurora/ingestion-worker）的请求事件 Processor 核心能力（createRequestEventProcessor 工厂、event-schema 解析、指标贡献、样本选择、样本持久化、结果映射）
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
  - ../architecture/request-sample-selection-policy.md
  - ../architecture/error-event-processor.md
  - ../architecture/formalization-readiness.md
  - ../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md
supersedes: none
review-cycle: request-event-processor-contract-or-release
---

# Aurora 请求事件 Processor 核心第一增量

## 1. 定位、效力与当前状态

本文冻结请求事件 Processor 核心能力第一增量，实施为 `apps/ingestion-worker`（包名 `@aurora/ingestion-worker`）内的 `createRequestEventProcessor` 工厂。它实现既有 `IngestionEventProcessor` 端口，接收 `ProcessIngestionEventInput`，只处理 `EventType.Request`，通过 `@aurora/event-schema` 包根解析 Request Event，通过注入的**分类端口**获取 `isFailure`/`isSlow`/`isAdditionalMonitoredStatus`，通过 `@aurora/processing-store` 包根调用 `persistRequestMetricContribution`（指标主路径）→ `decideRequestSampleSelection`（样本资格判断）→ `persistRequestEventSample`（有界安全样本），并把稳定结果映射到既有 Worker 处理结果（`processed`/`retry`/`dead-letter`）。

**批准状态**：本文由用户于 2026-08-03 预先批准（`status: approved`、`approval-status: approved`）。`implementation-status` 于 2026-08-03 更新为 `implemented`：`apps/ingestion-worker` 的请求事件 Processor 核心能力已实施并通过单元测试、Store fake 集成测试、真实 PostgreSQL 17.10 集成测试与全仓质量门禁。本文由 accepted ADR-004/005/006/012/015/016/017/018/019/020、approved 请求事件协议契约、请求指标聚合存储规格、请求安全样本存储规格、请求样本选择策略规格与既有错误事件 Processor 规格无歧义派生；自动审批依据见规格自检节。

**声明边界（阻塞记录）**：请求事件 Processor **核心能力**已在本增量实施，但**生产 composition root 接线继续 blocked**。**Request Processor Core 已实现不等于 production Worker 已能处理 Request 事件。** 阻塞原因是总事件路由（`EventType.Error`/`EventType.Request`/`EventType.Performance` 的最终路由选择）尚未形成 approved 规格或 accepted ADR；本增量不接入生产 `startIngestionWorker`、不创建生产 bin/start、不实现总事件路由器。

## 2. 元数据、Owner 和范围

- **Owner**：ingestion/backend
- **适用范围**：`apps/ingestion-worker` 的请求事件 Processor 核心能力：工厂、Request Event 解析、分类端口、指标贡献构造、样本选择调用、样本持久化、结果映射、单元测试、Store fake 集成测试、真实 PostgreSQL 17 集成测试、README、正式规格、ADR-019 实施证据。
- **明确非职责**：
  - 生产 composition root 接线、生产 bin/start、总事件路由器；
  - 真实项目配置 Repository / production 分类 adapter；
  - Request Metric Query、percentile、采样外推；
  - Performance Processor、Performance Store；
  - Issue 分组、fingerprint、Source Map、告警；
  - 数据保留与清理；
  - 修改 request-event-contract、ingestion-api、POST /v1/batches、Error processor、processing-store、Inbox、retry/backoff/replay。

## 3. 模块选择依据

- `@aurora/processing-store` 已实施 `request_metric_buckets`/`request_metric_event_applications` + `persistRequestMetricContribution`（accepted ADR-020 / implemented），其规格第 28 节明确"未来 Request Processor 通过 `persistRequestMetricContribution` 包根提交贡献，显式提供 `isFailure`/`isSlow`"；
- `@aurora/processing-store` 已实施 `request_event_samples` + `persistRequestEventSample`（accepted ADR-019 / implemented），其规格第 30 节明确"未来 Request Processor 通过 `persistRequestEventSample` 包根写样本"；
- `apps/ingestion-worker` 已实施 `decideRequestSampleSelection`（request-sample-selection-policy，approved + implemented），规格第 17 节明确"未来 Request Processor 在解析并分类请求事件后调用本策略"；
- `apps/ingestion-worker` 已有 `createErrorEventProcessor` 工厂（approved + implemented），展示处理器核心能力的既有模式：实现 `IngestionEventProcessor` 端口、注入 store 函数、映射稳定结果、未知异常传播、不接生产 composition root；
- 用户已批准本提示词第一节的处理器编排语义。

## 4. 系统与模块位置

- 本模块位于 `apps/ingestion-worker`（`aurora.layer: service`）；
- 新文件：`src/request-event-processor.ts`、`test/request-event-processor.test.ts`、`test/integration/request-event-processor.test.ts`；
- 遵循 `createErrorEventProcessor` 的文件组织与命名模式；
- **不**创建新的 processor framework、base class 或通用 orchestration package；
- `@aurora/ingestion-worker` 已作为 worker 包根导出 `createErrorEventProcessor`/`mapPersistResultToWorkerResult`，README 将 Processor Factory 视为公共组合入口 → 按同一最小模式从包根导出 `createRequestEventProcessor`；
- **不**导出私有分类 helper、仅测试使用的类型；
- **不**扩大 `@aurora/processing-store` 公共 API；**不**修改 `@aurora/event-schema`。

## 5. 依赖方向

`request-event-processor.ts` → `@aurora/event-schema` 包根（`parseRequestEventEnvelope`、`RequestOutcome`、`RequestMethod`、`EventType` 类型）、`@aurora/processing-store` 包根（`persistRequestMetricContribution`、`persistRequestEventSample` 类型与结果类型）、`./processor.ts`（端口类型）、`./request-sample-selection-policy.ts`（`decideRequestSampleSelection`）、`./retry-backoff-policy.ts`（`calculateRetryBackoffSchedule`）、`./retry-backoff-entropy.ts`（`createNodeCryptoEntropyProvider`）、`./retry-backoff-types.ts`（`RetryBackoffConfig`/`RetryBackoffEntropyProvider`）、`./diagnostics.ts`（可选诊断端口）。

处理器**不**创建或关闭 Pool；**不**直接执行 SQL；**不**访问 `process.env`；**不**复制 retry budget/backoff/lease/processing-store 逻辑。

## 6. 输入

`ProcessIngestionEventInput`（既有端口）：

```ts
export interface ProcessIngestionEventInput {
  readonly inboxId: number;
  readonly projectId: string;
  readonly eventId: string;
  readonly event: EventEnvelope;
  readonly attemptCount: number;
  readonly leaseId: string;
  readonly leaseExpiresAt: Date;
}
```

## 7. 输出

`ProcessIngestionEventResult`（既有端口）：

```ts
export type ProcessIngestionEventResult =
  | { readonly outcome: 'processed' }
  | {
      readonly outcome: 'retry';
      readonly availableAt: Date;
      readonly errorCode: IngestionErrorCode;
    }
  | { readonly outcome: 'dead-letter'; readonly errorCode: IngestionErrorCode };
```

## 8. event-schema 解析

- 处理器读取 `input.event`，先校验 `eventType === EventType.Request`；若非 Request Event，返回 `{ outcome: 'dead-letter', errorCode: 'invalid_event_type' }` 作为**处理器局部前置条件**（与 `createErrorEventProcessor` 一致），不得返回 processed、不得无限 retry、不得静默忽略；
- 通过 `@aurora/event-schema` 包根 `parseRequestEventEnvelope` 解析完整 Request Event；
- 解析失败 → 返回 `{ outcome: 'dead-letter', errorCode: 'invalid_event_type' }`（permanent rejection）；
- 解析成功 → 从 `RequestEventEnvelope` 提取 `eventId`、`occurredAt`、`body.method`、`body.outcome`、`body.statusCode?`、`body.durationMs`；
- 处理器**不得**重新定义 `RequestOutcome`/`RequestMethod`/Request Event Schema；只使用 `@aurora/event-schema` 包根常量与类型。

## 9. 分类端口

内部最小端口（实际命名以真实代码为准，语义冻结）：

```ts
export interface RequestEventClassification {
  readonly isFailure: boolean;
  readonly isSlow: boolean;
  readonly isAdditionalMonitoredStatus: boolean;
}

export type ClassifyRequestEvent = (
  input: RequestEventClassificationInput,
) => Promise<RequestEventClassification>;
```

- `RequestEventClassificationInput` 只携带处理器已经解析的安全最小事实（如 `outcome`、`statusCode?`、`durationMs`、`method`），**不**接收完整 Inbox Row、`status_code = 0` 数据库哨兵、请求体、响应体、Header、Cookie、Authorization、完整 URL、Query 参数、页面文本或用户信息；
- 分类端口不修改输入、不写数据库、不记录原始事件；
- 本轮只使用确定 fake，不实现真实配置 Repository 或 production adapter；
- 分类端口抛出未知异常时：不伪造 processed、不转成 invalid event、让异常传播给 Worker runtime（遵守现有 Processor 未知异常传播规则）。

## 10. metric contribution 构造

每个合法 Request Event **先**应用 Request Metric Contribution：

```ts
const contribution: RequestMetricContributionInput = {
  projectId: input.projectId,
  eventId: envelope.eventId,
  occurredAt: envelope.occurredAt,
  method: envelope.body.method,
  outcome: envelope.body.outcome,
  statusCode: envelope.body.statusCode, // 可选，缺省由 Store 映射 0 哨兵
  durationMs: envelope.body.durationMs,
  isFailure: classification.isFailure,
  isSlow: classification.isSlow,
};
```

处理器不硬编码 `slowRequestThreshold = 3000`、额外状态码、采样率、环境或发布规则；`isFailure`/`isSlow`/`isAdditionalMonitoredStatus` 全部来自分类端口。

## 11. metric Repository 结果映射

| 结果                      | Worker 结果                                                   | 语义                                      |
| ------------------------- | ------------------------------------------------------------- | ----------------------------------------- |
| `applied`                 | 继续                                                          | 首次贡献成功，进入样本选择                |
| `duplicate`               | 继续                                                          | 幂等成功（retry/replay 后），进入样本选择 |
| `invalid_input`           | `{ outcome: 'dead-letter', errorCode: 'invalid_event_type' }` | 永久失败，SDK 不得重试                    |
| `temporarily_unavailable` | `retry`（ADR-016 backoff）                                    | 暂时失败，有界退避                        |
| 未知异常                  | 传播给 Worker runtime                                         | 不伪造 processed、不转 invalid            |

`invalid_input` 时**不**调用 Sample Store。

## 12. sample selection 调用

metric 结果 `applied` 或 `duplicate` 后，调用 `decideRequestSampleSelection`：

```ts
const selection = decideRequestSampleSelection({
  outcome: envelope.body.outcome,
  statusCode: envelope.body.statusCode,
  isSlow: classification.isSlow,
  isAdditionalMonitoredStatus: classification.isAdditionalMonitoredStatus,
});
```

- `selection.decision === 'skip'`：**不**调用 `persistRequestEventSample`，返回 `{ outcome: 'processed' }`；
- `selection.decision === 'store'`：调用 `persistRequestEventSample`；
- `selection.decision === 'invalid'`：程序缺陷（processor 传入的分类/状态码非法），不静默降级——按处理器未知/程序缺陷规则处理（不伪造 processed），由 Worker runtime 按 ADR-015 处理器异常规则处理。

## 13. sample Repository 结果映射

| 结果                      | Worker 结果                                                   | 语义                        |
| ------------------------- | ------------------------------------------------------------- | --------------------------- |
| `inserted`                | `{ outcome: 'processed' }`                                    | 首次样本插入成功            |
| `duplicate`               | `{ outcome: 'processed' }`                                    | 幂等成功（retry/replay 后） |
| `invalid_input`           | `{ outcome: 'dead-letter', errorCode: 'invalid_event_type' }` | 永久失败                    |
| `temporarily_unavailable` | `retry`（ADR-016 backoff）                                    | 暂时失败，有界退避          |
| 未知异常                  | 传播给 Worker runtime                                         | 不伪造 processed            |

## 14. duplicate 语义

- metric `duplicate` 是幂等成功，**不能**进入 retry 或 dead-letter；
- sample `duplicate` 是幂等成功，**不能**进入 retry 或 dead-letter；
- 下一节的重试收敛依赖两 Store 各自的数据库幂等性（`(project_id, event_id)` 唯一约束 + `ON CONFLICT DO NOTHING`）。

## 15. retry 语义

- 仅当 metric 或 sample 返回 `temporarily_unavailable` 时进入 retry；
- retry 的 `availableAt` 复用 `calculateRetryBackoffSchedule`（ADR-016），`attemptCount` 来自 `ProcessIngestionEventInput`，`now` 来自可注入时钟，`entropy` 来自 `createNodeCryptoEntropyProvider`；
- 若 `calculateRetryBackoffSchedule` 返回非 `success`（非法 backoff 配置，程序缺陷），**不静默降级**为业务 retry——抛稳定 Error（信息不含配置值/事件正文），由 Worker runtime 按 ADR-015 处理器异常规则处理（与 `createErrorEventProcessor` 一致）。

## 16. unknown exception

- 分类端口、metric Repository、sample Repository、backoff 计算抛出的**未知异常**，处理器不捕获，传播给 Worker runtime；
- Worker runtime 按 ADR-015 既有规则处理：不自动 retry/dead-letter、不 `markProcessed`、记录有界诊断、lease 自然过期后可重新领取；
- 处理器不把未知异常转换为 retry 或 dead-letter。

## 17. backoff

- retry 必须使用现有 retry-backoff 配置（`RetryBackoffConfig`）和 `calculateRetryBackoffSchedule`，不复制退避算法；
- `createRequestEventProcessor` 注入 `backoff: RetryBackoffConfig`、`calculateBackoff?`、`entropyProvider?`、`now?`（与 `createErrorEventProcessor` 完全一致的注入形态）。

## 18. cross-store partial progress

- 指标已 `applied`、样本 `temporarily_unavailable` 时：返回 `retry`；
- 下一次执行时：指标 `duplicate`（不重复增加计数），仍继续尝试样本；
- 样本成功（`inserted`）后返回 `processed`；
- 该收敛完全依赖两 Store 各自的数据库幂等性，无跨 Store 事务。

## 19. retry 后收敛

- 指标 `observed_count`/`failure_count`/`slow_count`/`duration_sum_ms`/`duration_max_ms` 不因 retry 重复增加（`request_metric_event_applications` 幂等）；
- 样本最多一行（`request_event_samples` 的 `(project_id, event_id)` 唯一约束）；
- 最终结果 `processed`。

## 20. 无跨 Store 事务

- 处理器**不得**建立跨 Store 的新数据库事务 API；
- metric 和 sample 是两次独立持久化调用，各自原子；
- 收敛通过 retry + 各自幂等实现，不引入 Store 间事务协调。

## 21. 无生产接线

- 不修改 `startIngestionWorker` 的默认处理器组合；
- 不创建生产 bin/start；
- 不实现总事件路由器；
- `@aurora/ingestion-worker` 的 `package.json` **不新增**任何依赖（`@aurora/processing-store` 与 `@aurora/event-schema` 已存在）。

## 22. 日志与隐私

- 处理器不写日志；
- 可选诊断端口（复用 `ErrorEventProcessorDiagnostics` 模式）接收稳定诊断事件：`metric_applied`/`metric_duplicate`/`sample_inserted`/`sample_duplicate`/`permanently_rejected_invalid_input`/`temporarily_unavailable` 等，含 `inboxId`/`eventType`/`attemptCount`；
- 诊断**不得**包含完整事件正文、Token、Cookie、Authorization、数据库 URL、SQL、SQLSTATE；
- 处理器不修改输入对象；
- 分类端口输入只含安全最小事实，不含请求体/响应体/Header/Cookie/Authorization/完整 URL/Query/页面文本/用户信息。

## 23. 公共 API 边界

- 包根导出：`createRequestEventProcessor`、`mapRequestPersistResultsToWorkerResult`（或等价最小结果映射函数，与 `mapPersistResultToWorkerResult` 模式一致）、`RequestEventProcessorDiagnostics`（类型）与 `RequestEventClassification`/`ClassifyRequestEvent`（类型，供注入）；
- **不**导出私有分类 helper、仅测试使用的 fake、`RequestEventClassificationInput` 内部投影类型（若为私有）；
- 包根 `package-entry.test.ts` 追加断言。

## 24. 单元测试

直接调用 `createRequestEventProcessor(...)` 工厂返回的处理器，注入 fake store 函数与 fake 分类端口，覆盖：

- 合法 Request Event + metric `applied` + selection `skip` → `processed`（Sample Store 不调用）；
- metric `duplicate` + selection `skip` → `processed`；
- metric `invalid_input` → `dead-letter{invalid_event_type}`（Sample Store 不调用）；
- metric `temporarily_unavailable` → `retry{service_temporarily_unavailable}`（Sample Store 不调用）；
- metric 未知异常 → 异常传播；
- metric `applied` + selection `store` + sample `inserted` → `processed`；
- metric `duplicate` + sample `duplicate` → `processed`；
- sample `invalid_input` → `dead-letter{invalid_event_type}`；
- sample `temporarily_unavailable` → `retry`；
- sample 未知异常 → 异常传播；
- selection `skip` 时 Sample Store 调用次数为 0；
- cancelled → selection `skip`；network failure/timeout/429/5xx/configured/slow → selection `store`（通过分类端口驱动，验证传给 `decideRequestSampleSelection` 的输入正确）；
- metric `applied` + sample `temporarily_unavailable` → retry；第二次 metric `duplicate` + sample `inserted` → processed；指标不重复、样本一行；
- 分类端口 fake 收到的输入不含请求体/Header/Cookie/Authorization；
- 处理器不硬编码 3000ms、不读取项目配置、不调用 `Date.now`/`Math.random`；
- 处理器不修改输入；
- backoff 非法时不静默降级（抛稳定 Error）；
- 非 Request Event → `dead-letter{invalid_event_type}`；
- diagnostics 不包含事件正文/敏感字段；
- 不导入 Store 私有路径。

## 25. Store fake 集成测试

- 使用注入 fake（`persistRequestMetricContribution`/`persistRequestEventSample` 的兼容 fake）验证处理器编排逻辑，不连数据库；
- 验证跨 Store 收敛（metric applied + sample temporary → retry → metric duplicate + sample inserted → processed）。

## 26. 真实 PostgreSQL 测试

在真实 PostgreSQL 17.10 上验证（`AURORA_TEST_DATABASE_URL`；隔离/清理）：

- metric `applied` + sample `skip`：`request_metric_buckets` 计数 +1，`request_event_samples` 无行；
- metric `applied` + sample `inserted`：两表都有记录；
- replay 后 metric `duplicate` + sample `duplicate`：指标不重复增加、样本一行；
- sample 暂时失败后的重试收敛：先注入失败 store（或制造暂时不可用）→ retry → 恢复后 metric duplicate + sample inserted；
- Error Processor 回归、Sample Store 回归、Metric Store 回归；
- Inbox/Schema/Pool 完整隔离与清理。

## 27. replay 和并发语义

- 处理器不执行写回，不涉及 lease；lease lost 处理完全由 Worker runtime 的 `lease_id` fencing 保证（ADR-012/018 不修改）；
- metric 幂等由 `request_metric_event_applications` 唯一约束保证；sample 幂等由 `request_event_samples` 唯一约束保证；
- 并发重复处理：metric 最多应用一次、样本最多一行，重复调用返回 `duplicate` → `processed`。

## 28. 回滚

- 处理器是 `apps/ingestion-worker` 内部独立模块，与 Worker runtime/processing-store/Inbox 解耦；
- 回滚只需移除 `request-event-processor.ts` 及其导出、测试与 README 条目，不影响任何既有模块；
- 不涉及新 Migration；不修改任何公共 API（除新增 `createRequestEventProcessor` 导出外）。

## 29. 文档影响

- `apps/ingestion-worker/README.md`：增加请求事件 Processor 职责与接口；
- 本规格 `implementation-status` → implemented；
- `docs/README.md`：模块表新增一行；
- `docs/architecture/formalization-readiness.md`：状态记录更新；
- ADR-019 追加实施证据（request event processor core implemented），保持 `accepted / in-progress`；
- ADR-020 保持 `accepted / implemented`；
- `AGENTS.md`/`AURORA_RULES.md`：仅在代码和完整门禁实际通过后更新阶段快照；
- `docs/adr/README.md`：如需同步 ADR-019 状态。

## 30. 后续配置 adapter 和 production composition 阻塞

- 真实项目配置 Repository / production 分类 adapter：not-started（后续独立模块）；
- Request Metric Query：not-started；
- Request Event Router：not-started / blocked；
- production worker composition：not-started / blocked；
- Performance Processor/Store、Issue/fingerprint、查询、告警、保留：not-started。

## 31. 规格自检

- **权威一致性**：Request Event 字段完全来自 event-schema 包根；指标贡献构造逐字段映射 `RequestMetricContributionInput`；样本选择调用逐字段映射 `RequestSampleSelectionInput`；结果映射使用既有 `IngestionEventProcessor` 端口类型与既有 `IngestionErrorCode` 值；不复制 processing-store/event-schema/retry-budget/lease 逻辑；不改变 Inbox/Worker runtime/processing-store/OpenAPI；
- **兼容性**：新依赖只通过 `@aurora/processing-store` 与 `@aurora/event-schema` 包根；无循环依赖、无私有深导入；Worker runtime 公共接口不变；`apps/ingestion-worker` 为 `service` 层（允许 `service → data | protocol`）；
- **计划质量**：规格每项要求都有 Task；映射表/类型/错误码全文一致；每个 Task 有 TDD 闭环；无占位；零上下文实施者可直接执行；
- **安全和数据**：不记录事件正文/凭据/数据库 URL；不修改输入；不执行 SQL（只调用包根）；分类端口输入不含敏感字段；诊断不含事件正文；
- **跨 Store 收敛**：metric/sample 各自独立持久化、各自幂等、retry 收敛；无跨 Store 事务；
- **范围控制**：只实现请求处理器核心能力；生产 composition root 接线与总事件路由明确 blocked；不扩大到 Performance/Query/config adapter；
- **ADR 门禁**：组合 ADR-019/020 已批准能力；无需新 ADR；ADR-019 保持 in-progress、ADR-020 保持 implemented。

自动审批依据：本文全部语义由 accepted ADR-004/005/006/012/015/016/017/018/019/020、approved 请求事件协议契约、请求指标/样本存储规格、请求样本选择策略规格与既有错误事件 Processor 规格无歧义派生；用户已通过本模块提示词明确批准处理器编排语义（第一节）；无新增产品/架构/安全/隐私/公共协议决策（分类依据由注入端口提供、配置 adapter 明确后续）；自检全部通过。
