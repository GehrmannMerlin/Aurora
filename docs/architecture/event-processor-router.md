---
title: Aurora 事件处理器 Router（Event Processor Router）
status: approved
implementation-status: implemented
approval-status: approved
owner: ingestion/backend
created: 2026-08-07
last-reviewed: 2026-08-07
applies-to: apps/ingestion-worker（@aurora/ingestion-worker）的 EventType 路由与处理结果编排（createEventProcessorRouter 工厂）
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
  - ../protocol/event-envelope-v1.md
  - ../architecture/error-event-processor.md
  - ../architecture/request-event-processor.md
  - ../architecture/performance-event-processor.md
  - ../architecture/formalization-readiness.md
  - ../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md
supersedes: none
review-cycle: event-processor-router-contract-or-release
---

# Aurora 事件处理器 Router（DAT-10）

## 1. 定位、效力与当前状态

本文冻结事件处理器 Router 第一增量，实施为 `apps/ingestion-worker`（包名 `@aurora/ingestion-worker`）内的 `createEventProcessorRouter` 工厂。它实现既有 `IngestionEventProcessor` 端口，接收 `ProcessIngestionEventInput`，按 `EventType`（来自 `@aurora/event-schema` 唯一来源）把事件分发到 Error/Request/Performance 三个既有处理器之一，并把处理器结果**原样**传播为 Worker 结果。

**批准状态**：本文由用户 G01 联合模式授权审批（`status: approved`、`approval-status: approved`）。`implementation-status` 于 2026-08-07 更新为 `implemented`：`apps/ingestion-worker` 的 `createEventProcessorRouter` 已实施并通过单元测试与全仓质量门禁。本文由 accepted ADR-004/005/006/012/015/016、approved 性能/错误/请求事件协议契约、Error/Request/Performance Processor 规格无歧义派生；自动审批依据见规格自检节。

**声明边界**：Router 是**总事件路由的最终策略**（三个 processor 的局部前置条件已把非本类型事件交给未来路由策略）。Router 不实现业务处理、不访问数据库、不创建 Pool、不修改 lease。

## 2. 元数据、Owner 和范围

- **Owner**：ingestion/backend
- **适用范围**：`apps/ingestion-worker` 的事件处理器 Router：EventType 分发、Error/Request/Performance 路由、resource/unknown/deferred 类型稳定行为、结果传播、单元测试、文档、正式规格。
- **明确非职责**：
  - 生产 composition root 接线（DAT-11）；
  - retry budget、backoff、dead-letter、lease lost（属 Worker runtime / ADR-012/015/016）；
  - 业务处理（错误归一化、请求分类、性能聚合）；
  - 访问 Inbox Repository、数据库、Pool、环境变量；
  - 修改 event-schema、performance-event-contract、三个 processor 的公共接口；
  - Performance Query（DAT-17）。

## 3. 模块选择依据

- 三个 processor 源码的局部前置条件均注明"NOT the final routing policy (that remains blocked)"——Router 即该最终路由策略；
- Worker runtime 接受单个 `IngestionEventProcessor`（`BuildIngestionWorkerInput.processor`），生产 composition 需要单一处理器入口 → Router 作为该入口；
- batch baseline DAT-10 行："路由规格及 ADR 判断缺失"——本规格补齐；
- `EventType` 唯一来源是 `@aurora/event-schema`（`EventType.Error/Request/Performance/Resource`）。

## 4. 系统与模块位置

- 位于 `apps/ingestion-worker`（`aurora.layer: service`）；
- 新文件：`src/event-processor-router.ts`、`test/event-processor-router.test.ts`；
- 遵循既有 processor 工厂模式；
- 包根导出 `createEventProcessorRouter` 与相关类型。

## 5. 依赖方向

`event-processor-router.ts` → `./processor.ts`（端口）、`@aurora/event-schema` 包根（`EventType` 类型）、三个处理器工厂类型（`IngestionEventProcessor` 实例注入）。Router 不访问 `@aurora/processing-store`、`@aurora/ingestion-inbox`、数据库。

## 6. 输入

`ProcessIngestionEventInput`（既有端口）。Router 只读取 `input.event.eventType` 用于分发。

## 7. 输出

`ProcessIngestionEventResult`（既有端口）。Router **原样传播** processor 结果，不做任何改写。

## 8. Router 定位

Router 是**纯分发器**：按 `eventType` 选择一个注入的 processor 实例并调用其 `process(input, signal)`，返回其结果。Router 不判断业务正确性、不合并/转换结果、不重试、不写回。

## 9. Router 输入必须匹配真实 IngestionEventProcessor port

- Router 实现 `IngestionEventProcessor`（`process(input, signal): Promise<ProcessIngestionEventResult>`）；
- 输入类型与 processor 完全一致（`ProcessIngestionEventInput`）；
- 输出类型与 processor 完全一致（`ProcessIngestionEventResult`）。

## 10. EventType 来源只能是 event-schema

- Router 从 `@aurora/event-schema` 包根导入 `EventType` 常量/类型；
- 不复制枚举、不散落魔法字符串；
- `eventType` 值：`error`/`request`/`performance`/`resource`。

## 11. Error 路由

- `eventType === EventType.Error` → 调用注入的 errorProcessor；
- 若无 errorProcessor 注入 → 返回 `{ outcome: 'dead-letter', errorCode: 'invalid_event_type' }`（配置缺陷的稳定失败，不静默忽略）。

## 12. Request 路由

- `eventType === EventType.Request` → 调用注入的 requestProcessor；
- 若无 → `dead-letter{invalid_event_type}`。

## 13. Performance 路由

- `eventType === EventType.Performance` → 调用注入的 performanceProcessor；
- 若无 → `dead-letter{invalid_event_type}`。

## 14. Resource/deferred 类型行为

- `eventType === EventType.Resource`：第一版无 Resource 正文（product scope deferred），Router 返回 `{ outcome: 'dead-letter', errorCode: 'invalid_event_type' }`（permanent rejection，不重试）；
- 不调用任何 processor。

## 15. 未知事件类型行为

- `eventType` 为未知值（非 event-schema 四值）：`parseEventEnvelope` 已把未知 eventType 视为非法（`invalid_enum`/`unknown_event_type`），但 Router 仍防御性返回 `{ outcome: 'dead-letter', errorCode: 'invalid_event_type' }`；
- 不抛出、不静默忽略。

## 16. 无效 envelope 行为

- Router 不解析 envelope（解析属各 processor）；若 `input.event` 缺少 `eventType` 或 eventType 非字符串，防御性返回 `dead-letter{invalid_event_type}`；
- 完整解析/校验由被路由到的 processor 负责。

## 17. processor result 原样或规范化传播规则

- Router **原样传播** processor 返回的 `ProcessIngestionEventResult`，不转换、不包装、不修改；
- 若 processor 抛异常，Router 不捕获（传播给 Worker runtime，按 ADR-015 处理器异常规则处理）。

## 18. 不在 Router 内实现 retry budget

- Router 不实现 `maxProcessingAttempts`/`decideRetryDisposition`（ADR-015 属 Worker 主循环）；
- Router 对 processor 返回的 `retry` 结果原样传播。

## 19. 不在 Router 内实现 backoff

- Router 不调用 `calculateRetryBackoffSchedule`；
- processor 已计算 `availableAt`，Router 原样传播。

## 20. 不在 Router 内访问 Inbox Repository

- Router 不导入 `@aurora/ingestion-inbox`，不调用 `claimAvailable`/`markProcessed`/`scheduleRetry`/`markDeadLettered`/`replayDeadLettered`。

## 21. 不在 Router 内访问具体数据库

- Router 不执行 SQL、不连接数据库、不读取配置表。

## 22. 不在 Router 内创建 Pool

- Router 不创建/关闭 PostgreSQL Pool；Pool 所有权归生产 composition root（DAT-11）。

## 23. 不在 Router 内修改 lease

- Router 不接触 `leaseId`/`leaseExpiresAt`/`renewLease`；lease lost 由 Worker runtime fencing 保证。

## 24. 不在 Router 内吞掉 processor 异常

- processor 抛出的未知异常在 Router 中**不捕获、不转换**，原样传播给 Worker runtime（ADR-015 处理器异常规则）。

## 25. diagnostics 有界

- Router 可选诊断端口记录稳定 code：`routed_error`/`routed_request`/`routed_performance`/`routed_resource_deferred`/`routed_unknown_type`/`routed_missing_processor`/`routed_invalid_envelope`；
- 诊断**不得**包含事件正文、Token、Cookie、Authorization、数据库 URL、SQL、metric value、URL 或任何敏感字段；
- 诊断含 `inboxId`/`eventType`/`attemptCount` 最小标识。

## 26. 公共/私有导出边界

- 包根导出：`createEventProcessorRouter`、`CreateEventProcessorRouterInput`（类型）、`EventProcessorRouterDiagnostic(s)`（类型）；
- **不**导出私有分发 helper、仅测试使用的类型。

## 27. 三个 processor 的依赖方式

- Router 通过 `CreateEventProcessorRouterInput` **注入**三个 `IngestionEventProcessor` 实例（可选）；
- 不直接调用三个工厂（解耦，composition root 负责创建）；
- 未注入的处理器类型 → 稳定 `dead-letter{invalid_event_type}`。

## 28. 单元测试

直接调用 `createEventProcessorRouter({ errorProcessor, requestProcessor, performanceProcessor })`，覆盖：

- error 事件 → errorProcessor 被调用，结果原样传播；
- request 事件 → requestProcessor 被调用；
- performance 事件 → performanceProcessor 被调用；
- resource 事件 → 无 processor 被调用，返回 `dead-letter{invalid_event_type}`；
- 未知 eventType → `dead-letter{invalid_event_type}`；
- 缺失 eventType / 非字符串 eventType → `dead-letter{invalid_event_type}`；
- 未注入的处理器类型 → `dead-letter{invalid_event_type}`；
- processor 返回 `retry` → 原样传播（availableAt/errorCode 不变）；
- processor 返回 `dead-letter` → 原样传播；
- processor 抛异常 → Router 不捕获，异常传播；
- 诊断记录稳定 code，不含事件正文/敏感字段；
- Router 不调用 `Date.now`/`Math.random`/`process.env`/SQL；
- Router 不修改输入。

## 29. processor 隔离测试

- 用 fake processor（记录调用 + 返回预设结果）验证 Router 只调用对应类型的 processor，不调用其他；
- 三个 processor 互不干扰。

## 30. unsupported 类型测试

- Resource 事件（合法信封但无正文支持）→ `dead-letter{invalid_event_type}`，无 processor 调用。

## 31. deferred 类型测试

- 与 §30 相同：Resource 是当前 deferred 类型，Router 稳定拒绝。

## 32. DAT-11 消费契约

- DAT-11 production composition root 创建三个 processor，注入 Router，再把 Router 作为 `IngestionEventProcessor` 传给 `buildIngestionWorker`/`startIngestionWorker`；
- Router 保持 `IngestionEventProcessor` 签名，DAT-11 不修改 Router。

## 33. ADR 判断

**不需要新 ADR**。理由：

- Router 是 `apps/ingestion-worker` 内部新模块，实现既有 `IngestionEventProcessor` 端口，不改公共 API、不改变依赖方向（service → data/protocol 不变）、不新增基础设施；
- 不改变 event-schema、三个 processor、Worker runtime、Inbox、模块职责；
- 是三个 processor 已注释预期的"最终路由策略"的普通实现（已批准架构内的普通功能实现）；
- 按 ADR 规范 §7.2 的"已批准架构内的普通功能实现"例外，不触发 ADR 创建。

## 34. deferred

- 生产 composition root 接线（DAT-11）；
- Resource 事件正文（product scope deferred）；
- 未知新 EventType 的扩展（需新协议 + ADR）；
- 告警、Query、Issue。

## 35. out-of-scope

- DAT-11 production composition root；
- DAT-17 Performance Query；
- 平台 UI、告警、Issue；
- event-schema 修改、新基础设施；
- 业务处理逻辑（错误归一化、请求分类、性能聚合）。

## 36. 完成标准

- `createEventProcessorRouter` 工厂实现并导出；
- EventType 分发（error/request/performance/resource/unknown）；
- 结果原样传播；
- 异常传播、无数据库/Pool/lease/retry 访问；
- 诊断有界；
- 单元测试覆盖 §28—§31 全部场景；
- 既有 Error/Request/Performance Processor 测试回归通过；
- 包根导出、README、正式规格、formalization-readiness 同步；
- 全仓质量门禁通过；覆盖率满足 85/80/85/85。

## 37. PRD、协议、ADR、Worker 追踪矩阵

| 权威来源 | 条款 | 本模块落实 |
| --- | --- | --- |
| 架构规范 §2.3.3 | 数据处理与存储系统消费待处理事件 | Router 分发已可靠接收事件 |
| Worker Runtime §9—16 | 单 processor 端口、lease、retry 写回 | Router 作为单入口，不实现这些 |
| ADR-012 | Worker 运行时边界 | Router 不改 Worker runtime |
| ADR-015/016 | retry budget/backoff 属 Worker 主循环 | Router 不实现 |
| event-schema | EventType 唯一来源 | Router 从包根导入 EventType |
| Error/Request/Performance Processor | 各 processor 局部前置条件 | Router 是该前置条件指向的最终策略 |

## 38. 规格自检

- **权威一致性**：EventType 来自 event-schema 包根；结果原样传播使用既有端口类型；不复制 processor/Worker/Inbox 逻辑；
- **兼容性**：不新增跨包依赖；无循环依赖；无私有深导入；Worker runtime 公共接口不变；
- **安全和数据**：不记录事件正文/凭据/数据库 URL；不执行 SQL；不创建 Pool；不访问环境变量；
- **范围控制**：只实现纯分发；不实现业务处理、retry、composition；
- **ADR 门禁**：无需新 ADR（已批准架构内的普通功能实现）；
- **DAT-09/11 边界**：Router 消费三个 processor 但不在本模块创建；composition root（DAT-11）不在本模块。

自动审批依据：本文全部语义由 accepted ADR-004/005/006/012/015/016、approved 事件协议契约、Error/Request/Performance Processor 规格无歧义派生；无新增产品/架构/安全/隐私/公共协议决策（Router 是纯分发器，业务规则全在已批准 processor）；自检全部通过。

## 39. 实施记录（2026-08-07）

- **实现**：`apps/ingestion-worker` `src/event-processor-router.ts`（`EventProcessorRouterDiagnostic(s)` 诊断端口、`CreateEventProcessorRouterInput` 注入类型、`createEventProcessorRouter` 工厂）：实现 `IngestionEventProcessor` 端口，按 `eventType`（唯一来源 `@aurora/event-schema`）分发到注入的 error/request/performance processor，结果**原样传播**；`resource`（product deferred）与未知类型稳定返回 `dead-letter{invalid_event_type}`；未注入的处理器类型同样稳定拒绝；processor 异常不捕获、传播给 Worker runtime；
- **测试**：单元测试（11 个：error/request/performance 路由、retry/dead-letter 原样传播、resource 拒绝、未知类型拒绝、缺失 processor 拒绝、异常传播、类型隔离、诊断不含事件正文）；既有 Error/Request/Performance Processor 测试回归全通过；
- **状态**：`implementation-status: implemented`；`implemented-in-working-tree`（未提交、未合并、未发布、未生产部署）；生产 composition（DAT-11）与生产接线仍 not-started。
