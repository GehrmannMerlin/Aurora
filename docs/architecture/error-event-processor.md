---
title: Aurora 具体错误事件 Processor 核心能力第一增量
status: approved
implementation-status: implemented
approval-status: approved
owner: ingestion/backend
created: 2026-08-03
last-reviewed: 2026-08-03
applies-to: apps/ingestion-worker（@aurora/ingestion-worker）的具体错误事件 Processor 核心能力（createErrorEventProcessor 工厂、结果映射、前置校验、处理存储集成）
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
  - ../adr/ADR-008-ingestion-durable-buffering.md
  - ../adr/ADR-010-postgresql-access-and-migration-tooling.md
  - ../adr/ADR-012-ingestion-worker-runtime.md
  - ../adr/ADR-015-ingestion-worker-retry-budget-policy.md
  - ../adr/ADR-016-ingestion-worker-retry-backoff-schedule.md
  - ../adr/ADR-018-error-event-occurrence-processing-storage.md
  - ../architecture/ingestion-worker-runtime.md
  - ../architecture/error-event-occurrence-processing-store.md
  - ../protocol/error-event-contract.md
  - ../architecture/formalization-readiness.md
supersedes: none
review-cycle: error-event-processor-contract-or-release
---

# Aurora 具体错误事件 Processor 核心能力第一增量

## 1. 定位、效力与当前状态

本文冻结具体错误事件 Processor 核心能力第一增量，实施为 `apps/ingestion-worker`（包名 `@aurora/ingestion-worker`）内的 `createErrorEventProcessor` 工厂。它实现 accepted ADR-018 的"后续 processor 衔接"：实现 `IngestionEventProcessor` 端口，接收 `ProcessIngestionEventInput`，只处理 `EventType.Error`，通过 `@aurora/processing-store` 包根调用 `persistErrorEventOccurrence`，并把存储稳定结果映射到既有 Worker 处理结果（`processed`/`retry`/`dead-letter`）。

**批准状态**：本文由用户于 2026-08-03 预先批准（`status: approved`、`approval-status: approved`）。`implementation-status` 于 2026-08-03 更新为 `implemented`：`createErrorEventProcessor` 核心能力已实施并通过单元测试、真实 PostgreSQL 17.10 集成测试与全仓质量门禁。本文由 accepted ADR-004/005/006/008/010/012/015/016/018 与 approved 错误事件协议契约、Worker 运行时、错误 occurrence 处理存储规格无歧义派生；自动审批依据见规格自检节。

**声明边界（阻塞记录）**：错误事件 Processor **核心能力**已在本增量实施，但**生产 composition root 接线继续 blocked**。阻塞原因是 `EventType.Request`/`EventType.Performance` 事件的处理存储和事件路由语义尚未形成 approved 规格或 accepted ADR。该阻塞**不影响**错误处理器本身的独立实现和测试；本增量不接入生产 `startIngestionWorker`，不创建生产 bin/start，不实现总事件路由器。

## 2. 元数据、Owner 和范围

- **Owner**：ingestion/backend
- **适用范围**：`apps/ingestion-worker` 的 `createErrorEventProcessor` 工厂、错误事件前置校验、结果映射、processing-store 集成、单元测试、真实 PostgreSQL 17 集成测试、README、正式规格、ADR-012/018 实施证据。
- **明确非职责**：
  - 生产 composition root 接线、生产 bin/start；
  - 总事件路由器；
  - 请求/性能事件处理器与 occurrence 存储；
  - 修改 `POST /v1/batches` 使其只接收错误事件；
  - 修改 request/performance 协议；
  - Issue 分组、fingerprint、Source Map、查询、告警；
  - 数据保留与清理。

## 3. 模块选择依据

- `packages/processing-store` 已实施 `error_event_occurrences` 表 + `persistErrorEventOccurrence` Repository（accepted ADR-018 / implemented），其正式规格第 31 节明确"未来具体错误事件 processor 实现 `IngestionEventProcessor` 端口；通过 `persistErrorEventOccurrence` 包根写 occurrence"；
- `apps/ingestion-worker` 已有 `IngestionEventProcessor` 端口（`ProcessIngestionEventInput`/`ProcessIngestionEventResult`）与 Worker 运行时（accepted ADR-012 / in-progress），但其 `startIngestionWorker` 是可测试 composition root 工厂，**无生产 bin/start**；
- 用户明确授权本模块为**处理器核心能力**（路径 A）：实现错误处理器工厂与测试，不接入生产 composition root；
- 非错误事件路由（request/performance）是**已记录阻塞**，非本模块职责。

## 4. 处理器构造与依赖方向

- 工厂签名：`createErrorEventProcessor(input: CreateErrorEventProcessorInput): IngestionEventProcessor`；
- `CreateErrorEventProcessorInput` 接收：
  - `persist: PersistErrorEventOccurrenceFn`（`@aurora/processing-store` 包根的 `persistErrorEventOccurrence` 或其兼容注入）；
  - `backoff: RetryBackoffConfig`（`initialDelayMs`/`maxDelayMs`，来自 `@aurora/ingestion-worker` 内部 `retry-backoff-types`）；
  - `calculateBackoff?: CalculateRetryBackoffScheduleFn`（默认 `calculateRetryBackoffSchedule`）；
  - `entropyProvider?: RetryBackoffEntropyProvider`（默认 `createNodeCryptoEntropyProvider`）；
  - `now?: () => Date`（可注入时钟，默认 `new Date`）；
  - `diagnostics?: ErrorEventProcessorDiagnostics`（可选，有界诊断端口）。
- 依赖方向：`error-event-processor.ts` → `@aurora/processing-store` 包根、`@aurora/event-schema` 包根、`./processor.ts`（端口类型）、`./retry-backoff-*`（内部）、`./diagnostics.ts`；
- 处理器**不**创建或关闭 Pool；**不**访问 `process.env`；**不**直接执行 occurrence INSERT；**不**复制 retry budget/backoff/lease fencing/processing-store 逻辑。

## 5. 输入与输出

### 5.1 输入

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

### 5.2 输出

`ProcessIngestionEventResult`（既有端口）：

```ts
export type ProcessIngestionEventResult =
  | { readonly outcome: 'processed' }
  | { readonly outcome: 'retry'; readonly availableAt: Date; readonly errorCode: IngestionErrorCode }
  | { readonly outcome: 'dead-letter'; readonly errorCode: IngestionErrorCode };
```

### 5.3 结果映射（冻结）

| processing-store 结果 | Worker 结果 | 语义 |
| --- | --- | --- |
| `inserted` | `{ outcome: 'processed' }` | 首次插入成功 |
| `duplicate` | `{ outcome: 'processed' }` | 幂等成功 |
| `invalid_input` | `{ outcome: 'dead-letter', errorCode: 'invalid_event_type' }` | 永久失败，SDK 不得重试 |
| `temporarily_unavailable` | `{ outcome: 'retry', availableAt: <backoff 计算>, errorCode: 'service_temporarily_unavailable' }` | 暂时失败，有界退避 |

`retry` 的 `availableAt` 由 `calculateRetryBackoffSchedule` 计算（`attemptCount` 来自输入，`now` 来自可注入时钟，`entropy` 来自 entropyProvider）；`maxProcessingAttempts`/budget 判断由 Worker runtime 的 `decideRetryDisposition` 负责（ADR-015），处理器不复制。

若 `calculateRetryBackoffSchedule` 返回非 `success`（如 `invalid_config`，表示调用方配置的程序缺陷），处理器抛出一个稳定的 `Error`（信息不含配置值/事件正文），由 Worker runtime 按 ADR-015 处理器异常规则处理（不 markProcessed、不自动 retry/dead-letter、有界诊断、lease 自然过期）；**不**把无效配置静默降级为业务 retry。

## 6. 前置校验（只处理 EventType.Error）

- 处理器读取 `input.event.eventType`；
- 若 `eventType !== EventType.Error`：返回 `{ outcome: 'dead-letter', errorCode: 'invalid_event_type' }` 作为**处理器局部前置条件**；
- 该拒绝**不得**被解释为非错误事件的最终处理策略，也**不得**被接入生产 Worker 用于决定 request/performance 事件命运；
- 非 error 事件的最终路由属于已记录阻塞（生产 composition root 接线 blocked）。

## 7. 未知异常

- 若 `persistErrorEventOccurrence` 或 backoff 计算抛出**未知异常**（非稳定结果），处理器**不捕获**，让异常传播给 Worker runtime；
- Worker runtime 按 ADR-015 既有规则处理：不自动 retry/dead-letter、不 `markProcessed`、记录有界诊断、lease 自然过期后可重新领取；
- 处理器不把未知异常转换为 retry 或 dead-letter。

## 8. lease lost 与并发

- 处理器本身不执行写回，不涉及 lease；lease lost 处理完全由 Worker runtime 的 `lease_id` fencing 保证（ADR-012/ADR-018 不修改）；
- occurrence 幂等由 `(project_id, event_id)` 唯一约束保证（processing-store）；并发重复处理最多产生一个 occurrence，重复调用返回 `duplicate` → `processed`。

## 9. 日志、诊断与隐私边界

- 处理器不写日志；
- 可选 `ErrorEventProcessorDiagnostics` 端口接收稳定诊断事件：`code`（`occurrence_persisted`/`occurrence_duplicate`/`permanently_rejected_invalid_input`/`temporarily_unavailable`）、`inboxId`、`eventType`、`attemptCount`；
- 诊断**不得**包含完整事件正文、Token、Cookie、Authorization、数据库 URL、SQL、SQLSTATE；
- 处理器不修改输入对象。

## 10. composition root 接线（明确排除）

- 本模块**不**修改 `startIngestionWorker` 的默认处理器组合；
- 本模块**不**创建生产 bin/start；
- `apps/ingestion-worker` 的 `package.json` **新增** `@aurora/processing-store` 依赖（仅作为错误处理器的可注入依赖，供测试与未来接线使用；不在生产 composition root 中自动激活）；
- 生产 composition root 接线继续 blocked（见第 1 节阻塞记录）。

## 11. 单元测试

直接调用 `createErrorEventProcessor(...)` 工厂返回的处理器，覆盖：

- 合法错误事件首次插入 → `processed`（store 返回 inserted）；
- duplicate → `processed`（store 返回 duplicate）；
- invalid_input → `dead-letter{invalid_event_type}`；
- temporarily_unavailable → `retry{service_temporarily_unavailable}` 且 `availableAt` 落在 backoff 计算区间；
- store 抛出未知异常 → 异常传播（不被处理器捕获）；
- backoff 计算失败（非法配置）→ 处理器对该次返回稳定 retry 或按端口语义处理（见计划）；
- 非 Error 输入（request/performance 信封）→ 返回 `dead-letter{invalid_event_type}` 作为局部前置条件（不测试其在生产 Worker 中的最终命运）；
- 多次调用与并发重复事件 → 每次结果稳定可判别；
- 诊断不泄露完整事件正文/敏感字段；
- 输入对象不被修改。

## 12. 真实 PostgreSQL 集成测试

- Worker 集成测试基建增加 processing-store migration 目录（与 inbox migration 共享 `pgmigrations` 表）；
- 在真实 PostgreSQL 17.10 上：插入合法错误事件 → processor 调用 → `error_event_occurrences` 插入一行 → Inbox 可 `markProcessed`；
- duplicate：同 project/eventId 再次处理 → occurrence 不重复插入、处理器返回 `processed`；
- invalid_input：非 error 事件直接调用处理器 → `dead-letter`（局部前置条件，不接生产）；
- temporarily_unavailable：store 连接失败（注入失败 store）→ `retry`；
- 并发：两个并发处理器调用同一事件 → 一个 inserted、一个 duplicate；
- Schema 与 Pool 完整清理。

## 13. 文档与状态同步

- `apps/ingestion-worker/README.md` 增加错误处理器职责与接口；
- 本规格 `implementation-status` → implemented；
- `docs/README.md`、`docs/architecture/formalization-readiness.md`、`AGENTS.md`、`AURORA_RULES.md` 同步状态；
- ADR-012 追加实施记录（in-progress 推进，不标记 implemented）；ADR-018 追加 processor 核心能力衔接证据。

## 14. 回滚

- 处理器是 `apps/ingestion-worker` 内部独立模块，与 Worker runtime/processing-store 解耦；
- 回滚只需移除 `error-event-processor.ts` 及其导出与测试，不影响 runtime/Inbox/processing-store/OpenAPI；
- 不涉及新 Migration（复用 processing-store 既有 Migration）。

## 15. 明确排除的后续模块

- 生产 composition root 接线（blocked）；
- 总事件路由器（blocked）；
- 请求事件处理器与 occurrence 存储（not-started）；
- 性能事件处理器与 occurrence 存储（not-started）；
- Issue 分组、fingerprint、Source Map、查询、搜索、告警（not-started）；
- 数据保留与清理（not-started）。

## 16. 规格自检

- **权威一致性**：错误事件字段完全来自 event-schema；结果映射使用既有 `IngestionEventProcessor` 端口类型与既有 `IngestionErrorCode` 值（`invalid_event_type`/`service_temporarily_unavailable`）；不复制 processing-store/event-schema/retry-budget/lease 逻辑；不改变 Inbox/Worker runtime/processing-store/OpenAPI；
- **兼容性**：新依赖只通过 `@aurora/processing-store` 与 `@aurora/event-schema` 包根；`apps/ingestion-worker` 为 `service` 层（允许 `service → data | protocol`）；无循环依赖、无私有深导入；Worker runtime 公共接口不变；
- **计划质量**：规格每项要求都有 Task；映射表/类型/错误码全文一致；每个 Task 有 TDD 闭环；无占位；零上下文实施者可直接执行；
- **安全和数据**：不记录事件正文/凭据/数据库 URL；不修改输入；不执行 occurrence INSERT（只调用包根）；不把非错误事件路由伪装为已授权；
- **范围控制**：只实现错误处理器核心能力；生产 composition root 接线与总事件路由明确 blocked；不扩大到 request/performance。

自动审批依据：本文全部语义由 accepted ADR-004/005/006/008/010/012/015/016/018 与 approved 错误事件协议契约、Worker 运行时、错误 occurrence 处理存储规格无歧义派生；无新增产品/架构/安全/隐私决策（非错误事件路由为已记录阻塞，不在本模块内决策）；用户已预先授权路径 A（处理器核心能力，不接生产 composition root）；自检全部通过。
