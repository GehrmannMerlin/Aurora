---
title: Aurora 生产 Worker composition root（Production Worker Composition Root）
status: approved
implementation-status: implemented
approval-status: approved
owner: ingestion/backend
created: 2026-08-07
last-reviewed: 2026-08-07
applies-to: apps/ingestion-worker（@aurora/ingestion-worker）的生产 Worker composition（真实 processor 注入、Router 注入、真实 PostgreSQL Pool、生产 bin/start 接线）
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
  - ../architecture/ingestion-worker-runtime.md
  - ../architecture/ingestion-worker-retry-budget-policy.md
  - ../architecture/ingestion-worker-retry-backoff-schedule.md
  - ../architecture/error-event-processor.md
  - ../architecture/request-event-processor.md
  - ../architecture/performance-event-processor.md
  - ../architecture/request-processing-rules-configuration-adapter.md
  - ../architecture/event-processor-router.md
  - ../architecture/formalization-readiness.md
  - ../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md
supersedes: none
review-cycle: production-worker-composition-contract-or-release
---

# Aurora 生产 Worker composition root（DAT-11）

## 1. 定位、效力与当前状态

本文冻结生产 Worker composition root 第一增量，实施为 `apps/ingestion-worker`（包名 `@aurora/ingestion-worker`）的生产接线：创建真实 PostgreSQL Pool、注入 Error/Request/Performance 三个真实 processor、注入 DAT-07 真实请求处理规则 adapter、注入 DAT-10 Router，把 Router 作为 `IngestionEventProcessor` 传给 `buildIngestionWorker`/`startIngestionWorker`。

**批准状态**：本文由用户 G01 联合模式授权审批（`status: approved`、`approval-status: approved`）。`implementation-status` 于 2026-08-07 更新为 `implemented`：`apps/ingestion-worker` 的 `createProductionIngestionWorker` 已实施并通过单元测试、真实 PostgreSQL 17.10 端到端集成测试与全仓质量门禁。本文由 accepted ADR-004/005/006/008/010/012/015/016、approved Error/Request/Performance Processor 规格、DAT-07 adapter 规格、DAT-10 Router 规格无歧义派生；自动审批依据见规格自检节。

**声明边界**：本模块**不得**使用 fake/noop processor；必须接入真实三类 processor；不得只接 Error/Request 而遗漏 Performance。

## 2. 元数据、Owner 和范围

- **Owner**：ingestion/backend
- **适用范围**：`apps/ingestion-worker` 的生产 composition：生产配置解析、Pool 创建/唯一所有权、三个 processor + adapter + Router 注入、生产 bin/start、真实 PostgreSQL 集成。
- **明确非职责**：
  - 修改 `startIngestionWorker`/`buildIngestionWorker`（既有 composition root 已存在）；
  - 修改 event-schema、performance-event-contract、ingestion-api、POST /v1/batches、OpenAPI；
  - 引入 Query（DAT-17）、告警、Issue；
  - 创建新基础设施（Redis、队列、对象存储、云资源）；
  - 修改数据保留规则。

## 3. 模块选择依据

- `startIngestionWorker` 已存在并接受显式 `processor`（`StartIngestionWorkerOptions.processor`），生产必须提供显式 processor composition；
- 三个 processor 已实现（Error/Request/Performance），各只处理本类型事件；
- DAT-07 adapter 已实现（`createRequestProcessingRulesAdapter`），是 Request Processor 分类端口的真实实现；
- DAT-10 Router 规格已形成（`createEventProcessorRouter`），是总事件路由的最终策略；
- G01 退出条件要求三类事件进入同一 Router，Router 被真实 production composition 使用。

## 4. 系统与模块位置

- 位于 `apps/ingestion-worker`（`aurora.layer: service`）；
- 新文件：`src/production-composition.ts`（或既有命名模式，如 `src/composition.ts`）、`test/production-composition.test.ts`、`test/integration/production-composition.test.ts`；
- 包根导出 `createProductionIngestionWorker` 或等价生产组合入口；
- 不创建生产 bin/start 若 `startIngestionWorker` 已覆盖；若创建，作为 `src/production.ts` CLI 入口。

## 5. 依赖方向

`production-composition.ts` → `./configuration.ts`（配置）、`./start.ts`（`startIngestionWorker`）、`./error-event-processor.ts`、`./request-event-processor.ts`、`./performance-event-processor.ts`、`./request-processing-rules-adapter.ts`、`./event-processor-router.ts`、`@aurora/processing-store` 包根（三个 persist 函数）、`@aurora/ingestion-inbox` 包根（由 start.ts 内部）。

## 6. build/start 两阶段边界

- **build**：`createProductionIngestionWorker(options)` 返回已接线的 `IngestionEventProcessor`（Router）与所需依赖，不创建 Pool、不启动；
- **start**：`startIngestionWorker({ config, processor })` 创建/拥有 Pool 并启动（既有行为，不修改）；
- 生产入口两阶段分离，便于测试注入 fake Pool。

## 7. 配置解析

- 复用 `loadIngestionWorkerConfig`（既有）；
- 新增生产配置项（若需要）必须显式冻结，缺失/非法启动失败。

## 8. PostgreSQL Pool 创建和唯一所有权

- Pool 由 `startIngestionWorker` 创建并唯一拥有（既有行为）；
- production composition 不创建第二个 Pool；
- Pool 关闭由 `startIngestionWorker` 的 `closePoolOnce` 保证（恰好一次）。

## 9. Inbox Repository 注入

- `startIngestionWorker` 内部 `createProcessingRepository(pool)` 已接线 Inbox Repository（既有行为）；
- production composition 不重复接线。

## 10. DAT-07 真实 adapter 注入

- production composition 用 `createRequestProcessingRulesAdapter({ rules: DEFAULT_REQUEST_PROCESSING_RULES })` 创建真实 adapter；
- 把 `adapter.classify` 作为 `ClassifyRequestEvent` 注入 Request Processor。

## 11. Error Processor 注入

- `createErrorEventProcessor({ persist: persistErrorEventOccurrence(pool, input), backoff, ... })`；
- 真实 `persistErrorEventOccurrence` 从 `@aurora/processing-store` 包根。

## 12. Request Processor 注入

- `createRequestEventProcessor({ persistMetric, persistSample, classify: adapter.classify, backoff, ... })`；
- `persistMetric`/`persistSample` 真实包根函数。

## 13. Performance Processor 注入

- `createPerformanceEventProcessor({ persistMetric: persistPerformanceMetricContribution(pool, input), backoff, ... })`；
- V1 不注入 `persistPerformanceEventSample`（不保存样本）。

## 14. DAT-10 Router 注入

- `createEventProcessorRouter({ errorProcessor, requestProcessor, performanceProcessor })`；
- Router 作为 `IngestionEventProcessor`。

## 15. Router 作为真实 IngestionEventProcessor

- production composition 把 Router 传给 `startIngestionWorker`/`buildIngestionWorker` 的 `processor`；
- Router 是唯一处理器入口。

## 16. Worker Runtime 注入

- `buildIngestionWorker`/`startIngestionWorker` 接收 Router 作为 processor（既有行为，不修改）。

## 17. retry budget

- `maxProcessingAttempts` 由配置提供（既有）；
- production composition 不硬编码。

## 18. backoff

- 三个 processor 各自接收 `RetryBackoffConfig`（生产值需显式提供）；
- production composition 提供统一 backoff 配置。

## 19. dead-letter

- Worker runtime 按 ADR-015 处理 dead-letter（既有，不修改）。

## 20. lease 续期

- Worker runtime 自动续期（既有，不修改）。

## 21. lease lost

- Worker runtime fencing 保证（既有，不修改）。

## 22. graceful shutdown

- `startIngestionWorker` 的 `close` 保证（既有，不修改）。

## 23. Pool 关闭一次

- `closePoolOnce` 保证（既有，不修改）。

## 24. 启动失败清理

- `startIngestionWorker` 启动失败时 `closePoolOnce` 关闭 Pool（既有，不修改）。

## 25. shutdown 重入

- `close` 幂等（既有，不修改）。

## 26. 真实 PostgreSQL 集成

- production composition 集成测试使用真实 PostgreSQL 17.10（`AURORA_TEST_DATABASE_URL`）；
- 覆盖 Error/Request/Performance 三类事件完整链。

## 27. Error 事件完整链

- 生产 worker + 真实 PG：写入 error 事件 → claim → Router 路由 Error Processor → `error_event_occurrences` 有行。

## 28. Request 事件完整链

- 写入 request 事件 → Router → Request Processor + DAT-07 adapter 分类 → `request_metric_buckets` 有行。

## 29. Performance 事件完整链

- 写入 performance 事件 → Router → Performance Processor → `performance_metric_buckets` 有行；`performance_event_samples` 无行（V1 不保存样本）。

## 30. 不能只接 Error/Request

- production composition 必须注入 Performance Processor；
- 测试断言三类事件都进入对应处理器/Store。

## 31. 不能使用生产 fake/noop processor

- production composition 注入真实 processor；
- 测试断言注入的是真实实现（通过真实 PG 行为证明）。

## 32. 不能创建新基础设施

- 不引入 Redis、队列、对象存储、云资源。

## 33. 不修改 Ingestion HTTP

- 不触碰 `apps/ingestion-api`、POST /v1/batches。

## 34. 不修改 event-schema

- 不触碰 `@aurora/event-schema`。

## 35. 不引入 Query

- 不实现 DAT-17 Query 投影。

## 36. 不引入告警

- 不实现告警计算。

## 37. 配置和秘密日志限制

- production composition 不打印 `databaseUrl` 完整值、不打印密钥；
- 配置解析错误不泄露 secret。

## 38. README 和运维说明

- README 记录生产启动命令、环境变量、Pool 所有权、graceful shutdown。

## 39. ADR-012 一致性

- 完全遵守 ADR-012 的 Worker 运行时边界（Node.js 24 原生异步、两阶段配置、build/start Pool 所有权）。

## 40. DAT-10 前置

- 依赖 accepted DAT-10 Router 规格与已验收 Router 实现。

## 41. 完成标准

- 生产 composition 实现并接线三个真实 processor + DAT-07 adapter + Router；
- 真实 PostgreSQL 集成覆盖三类事件完整链；
- 不修改 event-schema/ingestion-api/Worker runtime 公共接口；
- 无 fake/noop processor；
- README、正式规格、formalization-readiness、ADR-012 一致性同步；
- 全仓质量门禁通过；覆盖率满足 85/80/85/85。

## 42. PRD、协议、ADR、Store 和 Worker 追踪矩阵

| 权威来源 | 条款 | 本模块落实 |
| --- | --- | --- |
| ADR-012 | Worker 运行时、Pool 所有权、graceful shutdown | production composition 遵守 |
| ADR-008 | 可靠缓冲 | worker 消费 event_inbox |
| ADR-015/016 | retry budget/backoff | 由 Worker 主循环与 processor backoff 承担 |
| Error/Request/Performance Processor | 三类 processor | production composition 真实注入 |
| DAT-07 | 请求分类真实 adapter | production composition 注入 adapter.classify |
| DAT-10 | Router | production composition 注入 Router |
| PRD 5.1.9 | 性能主要进入聚合 | performance processor 真实注入 |

## 43. 规格自检

- **权威一致性**：三个 processor + DAT-07 adapter + Router 均为已 approved/implemented 模块的真实组合；不修改任何公共接口；
- **兼容性**：不新增跨包依赖（`@aurora/processing-store`/`@aurora/ingestion-inbox`/`@aurora/event-schema` 已存在）；无循环依赖；
- **安全和数据**：不打印 databaseUrl 完整值/密钥；不引入新采集；
- **范围控制**：只接线，不实现业务、Query、告警、新基础设施；
- **ADR 门禁**：无需新 ADR（既有 startIngestionWorker 已批准，本模块只是接线真实 processor）；
- **DAT-10 前置**：依赖 accepted DAT-10 Router。

自动审批依据：本文全部语义由 accepted ADR-004/005/006/008/010/012/015/016、approved Error/Request/Performance Processor 规格、DAT-07 adapter 规格、DAT-10 Router 规格无歧义派生；无新增产品/架构/安全/隐私/公共协议决策（只是把已批准模块接线到既有 composition root）；自检全部通过。

## 44. 实施记录（2026-08-07）

- **实现**：`apps/ingestion-worker` `src/production-composition.ts`（`ProductionCompositionOptions`/`ProductionIngestionWorker` 类型、`createProductionIngestionWorker` 工厂）：接线三个真实 processor（`createErrorEventProcessor`/`createRequestEventProcessor`/`createPerformanceEventProcessor`）、DAT-07 真实 adapter（`createRequestProcessingRulesAdapter` + `DEFAULT_REQUEST_PROCESSING_RULES`，`classify` 注入 Request Processor）、DAT-10 Router（`createEventProcessorRouter`），Router 作为 `IngestionEventProcessor` 返回；三个真实 persist 函数（`persistErrorEventOccurrence`/`persistRequestMetricContribution`/`persistRequestEventSample`/`persistPerformanceMetricContribution`）从 `@aurora/processing-store` 包根注入；**不创建/关闭 Pool（调用方拥有）**；`close` 幂等；不使用 fake/noop processor；Performance Processor V1 不调用 `persistPerformanceEventSample`；
- **测试**：单元测试（2 个：接线返回 Router、close 幂等不接触 Pool）+ 真实 PostgreSQL 17.10 端到端集成测试（3 个：Error 事件→`error_event_occurrences` 行、Request 事件→`request_metric_buckets` 行、Performance 事件→`performance_metric_buckets` 行且 `performance_event_samples` 无行），通过真实 claim 循环验证三类事件进入同一 Router 并被真实 Worker 处理；
- **状态**：`implementation-status: implemented`；`implemented-in-working-tree`（未提交、未合并、未发布、未生产部署）；Performance Query（DAT-17）仍 not-started；G01 三个处理器 + Router + production composition 完整接线。
