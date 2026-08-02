---
title: ADR-012：数据接入 Worker 应用运行时与应用边界
status: accepted
implementation-status: not-started
approval-status: approved
owner: ingestion/backend
date: 2026-08-01
last-reviewed: 2026-08-01
applies-to: 数据接入 Worker 应用（apps/ingestion-worker）的运行时（Node.js 24 原生异步）、并发控制、停止控制、定时与依赖方向
related:
  - ../../AURORA_RULES.md
  - '../../Aurora ADR 规范.md'
  - ../../docs/architecture/platform-backend.md
  - ../../docs/architecture/deployment.md
  - ../../docs/architecture/formalization-readiness.md
  - ../../docs/architecture/system-overview.md
  - ../../docs/architecture/ingestion-inbox-data-model.md
  - ../../docs/architecture/ingestion-inbox-processing-repository.md
  - ../../docs/architecture/ingestion-worker-runtime.md
  - ../../docs/adr/ADR-004-asynchronous-event-processing.md
  - ../../docs/adr/ADR-008-ingestion-durable-buffering.md
  - ../../docs/adr/ADR-009-ingestion-transport-and-client-credential.md
  - ../../docs/adr/ADR-010-postgresql-access-and-migration-tooling.md
  - ../../docs/adr/ADR-011-ingestion-http-service-runtime.md
supersedes: none
superseded-by: none
---

# ADR-012：数据接入 Worker 应用运行时与应用边界

## 元数据

- 状态：accepted
- 决策状态：accepted
- 实施状态：not-started
- 审批状态：approved
- 日期：2026-08-01
- Owner：ingestion/backend
- 适用范围：数据接入 Worker 应用（`apps/ingestion-worker`）的运行时（Node.js 24 原生异步）、并发控制、停止控制、定时与依赖方向
- 关联 PRD：[核心业务 PRD](../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md) 第 7 章
- 关联 Inbox：[Inbox 数据模型正式规格](../../docs/architecture/ingestion-inbox-data-model.md)、[Inbox 处理侧 Repository 正式规格](../../docs/architecture/ingestion-inbox-processing-repository.md)
- 关联 Worker 规格：[Worker 运行时与处理器编排第一增量正式规格](../../docs/architecture/ingestion-worker-runtime.md)
- 关联 Issue：none
- 关联实现 PR：none
- 替代 ADR：none
- 被替代 ADR：none

## 状态说明

本 ADR 于 2026-08-01 由用户批准（`decision-status: accepted`、`approval-status: approved`），实施状态保持 `not-started`。批准授权数据接入 Worker 应用运行时与应用边界的最终决定；批准不代表 Worker 应用、运行循环、处理器、CI、RDS 或 IaC 已经实现。

## 背景

Aurora 已接受 ADR-004（可靠接收与异步处理）、ADR-008（数据接入可靠缓冲 = PostgreSQL 事务性 Inbox）、ADR-010（数据接入数据库访问与 Migration 工具链）和 ADR-011（数据接入同步 HTTP 服务运行时）。ADR-008 后续依赖链第 5 项是 "Worker 租约消费、重试、死信和重放"。处理侧 Repository（`claimAvailable`/`renewLease`/`markProcessed`/`scheduleRetry`/`markDeadLettered` + `lease_id` fencing）已实施并通过真实 PostgreSQL 17.10 验证。

此前 Worker 应用运行时存在缺口：ADR-008 只决定物理缓冲是 PostgreSQL 事务性 Inbox，未决定 Worker 消费进程的运行时技术（Node 原生异步轮询 vs BullMQ/cron/调度框架）；ADR-011 只授权接入 HTTP 服务运行时，不覆盖 Worker。Worker 是数据接入链路的长期独立应用，运行时选择迁移成本较高，需要保留取舍依据。本 ADR 于 2026-08-01 由用户批准，解除该阻塞。

## 决策驱动因素

- **与 Inbox 租约模型匹配**：`@aurora/ingestion-inbox` 已提供原子领取（`FOR UPDATE SKIP LOCKED`）与 lease fencing，Worker 只需在 PostgreSQL 之上编排 claim/renew/write-back；
- **不引入未经批准中间件**：BullMQ 只适用于管理平台异步任务（ADR-004 第 112 行已明确），Redis/SQS/Kinesis 均需新决策；第一版按 ADR-008 复用 RDS PostgreSQL 与 Worker；
- **无重叠轮询与有界并发**：需要明确的 claim 循环（一轮结束再开始下一轮）与显式并发上限，避免无界任务与重叠轮询；
- **可测试性**：需要可注入 sleeper/timer 端口与 Promise 协调，避免依赖真实 wall-clock；
- **停机语义精确**：graceful shutdown 必须能停止新 claim、继续续租、等待 in-flight、Abort 超时任务、最后释放 Pool；
- **不把 Worker 做成通用任务框架**：本模块只做数据接入 Inbox 处理器编排。

## 现有约束

- ADR-008：Worker 以租约轮询/分批拉取待处理事件；幂等消费；租约到期可重投；重试计数达上限进死信；不承诺处理顺序；扩展方式为增加 Worker 并发消费者；
- ADR-004：SDK 不重试永久拒绝；失败重试次数和退避有上限；无法处理事件进入失败记录或死信；
- ADR-010：PostgreSQL 17 + `pg` + `node-pg-migrate` + SQL-first（数据接入域独立数据库工具链）；
- ADR-011：数据接入域 `service` 层（`service → protocol`、`service → data`；禁反向）；
- Inbox 处理侧 Repository：`claimAvailable`/`renewLease`/`markProcessed`/`scheduleRetry`/`markDeadLettered` + 稳定结果（`success`/`lease_lost`/`not_found`、`claimed`/`nothingToClaim`）；状态集合不变；
- 管理平台 PostgreSQL Outbox + Redis/BullMQ 只适用于管理平台异步任务，不能外推为数据接入/处理缓冲（ADR-004/008）。

## 候选方案

### 方案 A：Node.js 原生异步运行时（推荐）

**行为**：`apps/ingestion-worker` 使用 Node.js 24 原生 async/Promise 实现 claim 循环；`AbortController`/`AbortSignal` 控制停止；可注入 sleeper/timer 端口用于测试；每次 claim 循环结束后再开始下一轮（不用 `setInterval` 驱动重叠轮询）；并发由显式配置（`maxConcurrentHandlers`）控制；所有定时通过可注入端口抽象。

优点：

- 零额外运行时依赖，与 ADR-008"复用 RDS 与 Worker、运维负担最小"一致；
- 直接调用 `@aurora/ingestion-inbox` 公开处理 API，ACK/租约/fencing 语义完全由 Inbox 保证；
- 并发、续租、停机语义完全可控且可测试；
- 不引入未经批准中间件（BullMQ/Redis/SQS/Kinesis）。

缺点：

- 不提供内置重试/退避/死信调度（本模块本来不实现这些，属后续 Worker policy）；
- 需要自己实现有界并发与停机编排（本模块范围）。

### 方案 B：BullMQ Worker + Redis（被拒绝）

**行为**：用 BullMQ Worker 消费 Redis 队列。

被拒绝理由：ADR-004/008 明确管理平台 BullMQ 不自动适用于数据接入/处理边界；引入 Redis 增加故障域与运维面；ADR-008 已接受 PostgreSQL Inbox 方案 A；且 Inbox 已提供租约/fencing，BullMQ 的作业语义与现有 `lease_id` fencing 重复且需要额外迁移。

### 方案 C：第三方调度框架（cron/scheduler，被拒绝）

**行为**：用 node-cron、Bree 等调度 Worker 轮询。

被拒绝理由：Worker 是持续运行的消费进程而非定时任务，调度框架与 Inbox 租约语义不匹配；引入额外依赖与生命周期复杂度；无 approved 来源；第一版无需。

### 候选比较

| 维度                   | A：Node 原生异步        | B：BullMQ + Redis       | C：第三方调度框架       |
| ---------------------- | ----------------------- | ----------------------- | ----------------------- |
| 与 Inbox 租约匹配      | 直接调用处理 API        | 需作业语义迁移          | 不匹配                 |
| 额外依赖/基础设施      | 无                      | Redis + BullMQ          | cron 依赖              |
| 并发/停机控制          | 完全可控                | 由 BullMQ 管理          | 部分                   |
| 运维复杂度             | 最小                    | 中（Redis）             | 中                     |
| 是否经 approved/ADR    | 本 ADR                  | 被拒绝（ADR-004/008）   | 无来源                 |

## 最终决策

**最终选择方案 A：Node.js 24 原生异步运行时。**

决定细节：

- Worker 应用使用 Node.js 原生 async/Promise；
- 使用 `AbortController`/`AbortSignal` 控制停止与 lease lost 通知；
- 使用可注入 sleeper/timer 端口进行测试；
- 不使用 `setInterval` 驱动重叠轮询；每次 claim 循环结束后再开始下一轮；
- 并发由显式配置控制（`maxConcurrentHandlers`）；
- 不创建无界 Promise、数组或任务队列；
- 不把 Worker 运行时做成通用任务框架（只做数据接入 Inbox 处理器编排）；
- 不引入 BullMQ、Redis、SQS、Kinesis、cron 或第三方调度框架。

## 应用边界

- 目录：`apps/ingestion-worker`；
- 包名：`@aurora/ingestion-worker`；
- `"private": true`；
- `"type": "module"`；Node.js 24（`engines` `">=24.18.0 <25"`）；
- 应用入口（`start.ts`）与可测试应用工厂（`app.ts` 或等价）分离；
- 两阶段配置：`start.ts` 从环境变量读取，`configuration.ts` 一次性校验并生成冻结 typed config；普通模块不得直接读取 `process.env`；
- Workspace Policy `aurora.layer: service`；允许 `service → protocol`、`service → data`；禁止 `data/protocol → service`、`HTTP service → worker 私有实现`、`SDK 包 → worker`、`worker → Browser/Core/插件`、`worker → Inbox 私有路径`、`worker → OpenAPI tooling 运行时`、`worker → 管理平台`；
- 应用只从 `@aurora/ingestion-inbox` 与 `@aurora/event-schema`（仅当处理器公共输入确实需要其包根类型时）包根消费。

## build/start 两层与 Pool 所有权

- **`buildIngestionWorker`**：接受已验证配置、外部 Processing Repository、处理器、可注入 timer/sleeper、diagnostic 和 ID provider 等测试端口；构建运行时；不创建 PostgreSQL Pool；不关闭调用方依赖；适合单元和集成测试。
- **`startIngestionWorker`**：composition root；从环境变量读取并验证配置；创建 PostgreSQL Pool；创建 Processing Repository；创建 Worker 运行时；启动；注册 SIGTERM/SIGINT；明确拥有并释放它创建的资源；启动失败时回滚；Pool 只能关闭一次。
- 生产启动必须显式提供处理器 composition；不得提供永远成功、丢弃事件或空操作的生产默认处理器；测试可以注入 fake processor。

## 结果与影响

### 正面影响

- Worker 应用获得确定运行时与应用边界；
- 与 Inbox 租约/fencing 语义完全匹配，ACK 边界不变；
- 零额外运行时依赖，运维负担最小；
- 并发/续租/停机语义可控且可测试。

### 负面影响与代价

- 需要自建有界并发与停机编排（本模块范围）；
- 内置重试/退避/死信调度留给后续 Worker policy；
- 不提供跨语言/跨团队通用任务框架能力（非目标）。

### 未解决问题

- 精确并发、批量、租约、退避数值（`requires-benchmark`，Worker policy 后续决定）；
- 最大重试次数与死信业务规则（后续 Worker policy）；
- 是否复用 `platform-worker` 部署单元（部署 ADR 后续决定；本 ADR 只决定应用边界）。

## 实施约束

- Worker 应用运行时已 accepted，可实施数据接入 Worker 运行时与处理器编排第一增量；
- 完全复用 `@aurora/ingestion-inbox` 公开处理 API；不修改 Inbox 状态集合、租约或 fencing 语义；
- 不修改 event-schema、OpenAPI 或 HTTP 服务；
- 不固定 policy/benchmark 数值；不实现具体事件处理器；
- 不引入 BullMQ、Redis、SQS、Kinesis 或调度框架；不创建云资源。

## 迁移方案

本 ADR accepted 后：编写 Worker 运行时正式规格 → writing-plans → 实施 `apps/ingestion-worker`（Worker 运行时与处理器编排第一增量）→ 真实 PostgreSQL 并发/续租/关闭/双 Worker 验证。

## 回滚方案

若 Worker 运行时在实施中发现缺陷，可在生产部署前替换运行时实现（应用工厂与处理器端口抽象则迁移成本低）；发布后遵循向前修复。不得通过静默丢弃事件降级。

## 验证方式

- Worker 定向单元测试（配置/生命周期/claim 循环/并发/续租/停机）；
- 真实 PostgreSQL 17 集成测试（claim/processed/retry/dead-letter/并发上限/续租/lease lost/停机/双 Worker）；
- 应用边界与私有路径负例、Workspace Policy `service` 层；
- 敏感信息扫描；
- 全仓质量门禁。

## 重新评估条件

- Worker 需要分区、顺序或流处理能力；
- 处理吞吐超过单 PostgreSQL Worker 能力且需要升级到 SQS/Kinesis（ADR-008 迁移路径已定义）；
- 现有 Node 原生运行时无法满足 SLO 或运维目标。

## 追加记录

本 ADR 的评审、状态、实施和替代变化只能追加在本节之后。

### 2026-08-01：用户批准与最终决定

- 决策状态更新为 `accepted`，实施状态保持 `not-started`，审批状态 `approved`；
- 用户批准方案 A，批准内容以用户 2026-08-01 消息的精确决定为准；
- 最终决定：**Node.js 24 原生异步运行时**；`AbortController`/`AbortSignal` 控制停止；可注入 sleeper/timer 端口；不使用 `setInterval` 驱动重叠轮询；一次 claim 循环结束后再开始下一轮；并发由显式配置控制；不创建无界 Promise/数组/任务队列；不把 Worker 运行时做成通用任务框架；
- 应用边界：`apps/ingestion-worker`、包名 `@aurora/ingestion-worker`、`private`、Node 24、两阶段配置、`service` 层、`buildIngestionWorker`/`startIngestionWorker` Pool 所有权分离；
- 本次批准不代表 Worker 应用、运行循环、处理器、CI、RDS 或 IaC 已经实现。

### 2026-08-01：Worker 运行时与处理器编排第一增量实施证据

- 实施状态更新为 `in-progress`：`apps/ingestion-worker` 数据接入 Worker 运行时与处理器编排第一增量已实施并通过真实 PostgreSQL 17.10 集成测试与全仓质量门禁；具体事件处理器、Worker retry/dead-letter policy、人工重放与完整数据接入链路仍未实现，故不进入 `implemented`；
- 实施内容：`buildIngestionWorker`（可测试工厂，接受外部依赖，不创建 Pool）与 `startIngestionWorker`（composition root，创建并只关闭一次 Pool，注册 SIGTERM/SIGINT，启动失败回滚）；`loadIngestionWorkerConfig`（typed 配置，全部值显式配置，`leaseRenewIntervalMs < leaseDurationMs`、`maxConcurrentHandlers <= claimBatchSize`）；`IngestionEventProcessor` 端口与结果编排（processed/retry/dead-letter）；claim 循环（一轮结束再开始下一轮、剩余容量计算、claim 上限、idle/infrastructure 等待）；lease 自动续期（`renewLease`，`success` 表示数据库已延长，`lease_lost`/`not_found` → Abort 处理器且不写回）；graceful shutdown（冻结顺序：停止 claim → 续租 → 等 in-flight → 宽限期 Abort → 清理 → 关闭 Pool）；`WorkerDiagnostics` 有界诊断；
- 完全复用 `@aurora/ingestion-inbox` 公开处理 API；未修改 Inbox 状态集合、租约、fencing、ACK/幂等/receipt；未修改 event-schema、OpenAPI 或 HTTP 服务；
- 实际依赖：`@aurora/ingestion-inbox`、`@aurora/event-schema`、`pg` 8.22.0（生产）；`node-pg-migrate` 9.0.0（开发，集成测试 Migration）；
- 测试：60 个单元测试（配置/处理器端口/诊断/timers/生命周期/claim 循环/编排/renew/shutdown/start）+ 13 个真实 PostgreSQL 17.10 集成测试（claim→processed/retry/dead-letter、处理器异常不标记成功且不阻塞、并发上限、idle 等待、renewLease 触发与停止、lease lost Abort 且不写回、grace 内完成、宽限期 Abort 不强制改状态、双 Worker 不重复处理、重复 stop 幂等）；覆盖率 lines 98 / statements 94.41 / branches 90.38 / functions 85.41；
- 验证命令：`pnpm --filter @aurora/ingestion-worker test`、`test:integration`、`test:coverage`、`typecheck`、`lint`、`build`、`pnpm check:boundaries`、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm test:coverage`、`pnpm build`、`pnpm check:ci` 分段、`git diff --check` 全部 exit 0；`@aurora/ingestion-inbox` 38 个与 `@aurora/ingestion-api` 5 个真实 PG 集成测试回归通过；
- 实施 Commit：none（未提交）；
- Issue/PR：none；
- 未实现：具体事件处理器、Worker retry/dead-letter policy、退避算法、人工重放、凭证模块、CI、RDS、IaC。
