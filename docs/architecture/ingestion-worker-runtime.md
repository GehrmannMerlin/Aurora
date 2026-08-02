---
title: Aurora 数据接入 Worker 运行时与处理器编排第一增量
status: approved
implementation-status: implemented
approval-status: approved
owner: ingestion
created: 2026-08-01
last-reviewed: 2026-08-02
applies-to: apps/ingestion-worker（@aurora/ingestion-worker，Node.js 24 原生异步 Worker 运行时与处理器编排）
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
  - ../architecture/ingestion-inbox-data-model.md
  - ../architecture/ingestion-inbox-processing-repository.md
  - ../architecture/ingestion-http-service.md
  - ../architecture/formalization-readiness.md
supersedes: none
review-cycle: ingestion-worker-runtime-contract-or-release
---

# Aurora 数据接入 Worker 运行时与处理器编排第一增量

## 1. 定位、效力与当前状态

本文冻结数据接入 Worker 运行时与处理器编排第一增量，实施为 `apps/ingestion-worker`（包名 `@aurora/ingestion-worker`，`"private": true`）。它承载 ADR-008 后续依赖链第 5 项（Worker 租约消费）中"运行循环"部分，完全复用 `@aurora/ingestion-inbox` 公开处理侧 Repository（`claimAvailable`/`renewLease`/`markProcessed`/`scheduleRetry`/`markDeadLettered`），在真实 PostgreSQL `event_inbox` 之上建立 Worker 应用壳、typed 配置、生命周期、claim 循环、显式并发上限、每条事件处理器编排、lease 自动续期、lease lost 处理、graceful shutdown、PostgreSQL Pool 与 Repository 组合、有界诊断、单元测试与真实 PostgreSQL 并发/续租/关闭/双 Worker 集成测试。

**批准状态**：本文于 2026-08-01 由用户预先批准（`status: approved`、`approval-status: approved`）。`implementation-status` 于 2026-08-01 更新为 `implemented`：`apps/ingestion-worker` 已实施并通过真实 PostgreSQL 17.10 并发/续租/关闭/双 Worker 集成测试与全仓质量门禁。本文由 accepted ADR-004/008/010/011/012 与 approved Inbox 数据模型、处理侧 Repository 规格无歧义派生；自动审批依据见规格自检节。

**运行时授权**：Worker 应用运行时由 accepted [ADR-012](../adr/ADR-012-ingestion-worker-runtime.md) 授权（Node.js 24 原生 async/Promise；不引入 BullMQ、Redis、SQS、Kinesis 或第三方调度框架）。本模块实现该 ADR 的 `accepted / not-started` 增量（实施后 ADR-012 更新为 `in-progress`），但不扩大 ADR-012 范围，也不固定任何 benchmark/policy 数值。

## 2. 元数据、Owner 和范围

- **Owner**：ingestion
- **适用范围**：`apps/ingestion-worker` 的 Worker 应用壳、typed 配置、`buildIngestionWorker`/`startIngestionWorker` 两层、Worker 生命周期、claim 循环、并发上限、处理器端口与编排、lease 自动续期、lease lost、graceful shutdown、Pool/Repository 组合、有界诊断、单元测试、真实 PostgreSQL 集成测试、Workspace Policy、README、正式规格与 ADR-012 证据。
- **明确非职责**：
  - 具体错误、请求、性能事件处理器；
  - 数据查询与处理存储、聚合、分组、索引；
  - 最大重试次数、退避算法、自动判定 retry 或 dead-letter、人工重放；
  - 管理平台、HTTP 路由、客户端凭证；
  - SDK transport、Redis/BullMQ、SQS/Kinesis、调度框架；
  - CI、RDS、IaC、容量基准。

## 3. 模块选择依据

- ADR-008 已接受"Worker 租约消费"作为后续依赖链第 5 项；处理侧 Repository（`claimAvailable`/`renewLease`/`markProcessed`/`scheduleRetry`/`markDeadLettered` + `lease_id` fencing）已实现并通过真实 PostgreSQL 17.10 验证；
- 仓库不存在任何 Worker 应用、运行循环或处理器编排；ADR-008 明确"是否独立 `ingestion-worker` 部署单元"由实施规格决定，本模块选择独立 `apps/ingestion-worker`（与 `apps/ingestion-api` 同层 `service`，应用边界独立、可独立验收与故障隔离）；
- Worker 运行时决策（Node 原生 async vs BullMQ/cron/调度框架）属于需要长期保留取舍依据的应用运行时决策，由 accepted ADR-012 收口；
- 本模块只做 Worker 运行时与处理器编排，不做具体业务处理器或 Worker policy。

## 4. 职责与非职责

### 4.1 职责

- Worker 应用壳（`apps/ingestion-worker`，包名 `@aurora/ingestion-worker`，`"private": true`）；
- typed 配置（全部值显式配置，启动 adapter 读取，运行时只接收已验证冻结配置）；
- Worker 生命周期（`created`/`running`/`stopping`/`stopped`）；
- claim 循环（一轮结束再开始下一轮；不重叠轮询）；
- 显式并发上限（`maxConcurrentHandlers`，claim 不超过剩余容量）；
- 每条事件的处理器调用（`IngestionEventProcessor` 端口）；
- lease 自动续期（每 in-flight 独立控制，`renewLease`，不递增 attempt_count）；
- lease lost 处理（Abort 处理器、不写回、有界诊断、继续其他事件）；
- 处理成功后的 `markProcessed`；处理器明确要求重试时 `scheduleRetry`；处理器明确要求死信时 `markDeadLettered`；
- graceful shutdown（冻结顺序：停止新 claim → 继续续租 → 等 in-flight ≤ shutdownGracePeriodMs → 宽限期后 Abort → 停止续租 → 清理 timer → 关闭 Worker → composition root 最后关闭 Pool）；
- PostgreSQL Pool 与 Processing Repository 组合；
- 有界诊断（冻结诊断字段，不记录 EventEnvelope/原始 Error/SQL/凭证）；
- 单元测试、真实 PostgreSQL 集成测试、双 Worker 并发测试、Workspace Policy、README、正式规格与 ADR-012 证据。

### 4.2 非职责

- 具体错误、请求、性能事件处理器；
- 数据查询与处理存储、聚合、分组、索引；
- 最大重试次数、退避算法、自动决定 retry 或 dead-letter；
- 人工重放；
- 管理平台、HTTP 路由、客户端凭证；
- SDK transport、Redis/BullMQ、SQS/Kinesis、调度框架；
- CI、RDS、IaC、容量基准。

## 5. 应用位置、包与依赖

- 应用目录：`apps/ingestion-worker`；包名：`@aurora/ingestion-worker`；`"private": true`；`"type": "module"`；
- Node.js 24（`engines` `">=24.18.0 <25"`）；
- 只从以下包根消费：`@aurora/ingestion-inbox`、`@aurora/event-schema`（仅当处理器公共输入确实需要其包根类型时）；
- 生产依赖：`pg`（`@aurora/ingestion-inbox` 依赖声明于包内，本应用通过包根使用 Processing Repository，自身只直接依赖 `@aurora/ingestion-inbox` 与 `@aurora/event-schema`）；应用自身不直接依赖 `pg`，除非实现 composition root 需要显式类型引用（若需要则 `pg` 列入生产依赖）；
- 不安装 BullMQ、Redis 客户端、队列、cron 或第三方调度框架；
- Workspace Policy `aurora.layer: service`（允许 `service → protocol`、`service → data`；禁止 `data/protocol → service`、`HTTP service → worker 私有实现`、`SDK 包 → worker`、`worker → Browser/Core/插件`、`worker → Inbox 私有路径`、`worker → OpenAPI tooling 运行时`、`worker → 管理平台`）。

## 6. Node 原生运行时（accepted ADR-012）

- 使用 Node.js 原生 async/Promise；
- 使用 `AbortController`/`AbortSignal` 控制停止与 lease lost 通知；
- 使用可注入 sleeper/timer 端口进行测试；
- 不使用 `setInterval` 驱动重叠轮询；每次 claim 循环结束后再开始下一轮；
- 并发由显式配置控制；不创建无界 Promise、数组或任务队列；
- 不把 Worker 运行时做成通用任务框架（只做数据接入 Inbox 处理器编排）。

## 7. 配置

配置由启动 adapter（`start.ts`）从环境变量读取不可信字符串，`configuration.ts` 一次性校验并生成冻结 typed config；运行时（`buildIngestionWorker`）只接收已验证的冻结配置；普通模块不得直接读取 `process.env`。配置项全部显式配置，不提供产品默认值，不把任何值写成产品承诺。

| 配置项                        | 类型     | 约束                                                             |
| ----------------------------- | -------- | ---------------------------------------------------------------- |
| `workerId`                    | string   | 必填，非空；命名空间化（`ingestion-worker:<id>`）                 |
| `claimBatchSize`              | number   | 正整数，`1..MAX_CLAIM_LIMIT`（100）                              |
| `maxConcurrentHandlers`       | number   | 正整数，`<= claimBatchSize`（本规格不证明可更大）                 |
| `leaseDurationMs`             | number   | 正整数；`leaseRenewIntervalMs < leaseDurationMs`                 |
| `leaseRenewIntervalMs`        | number   | 正整数；`< leaseDurationMs`                                      |
| `idlePollIntervalMs`          | number   | 正整数；空队列等待间隔                                           |
| `infrastructureFailureDelayMs`| number   | 正整数；Repository 暂时失败后的 claim 重试延迟                   |
| `shutdownGracePeriodMs`       | number   | 正整数；等待 in-flight 任务完成的宽限期                          |
| `databaseUrl`                 | string   | 必填（composition root 使用；不打印完整值）                      |
| `logEnabled`                  | boolean  | 可选，默认 false                                                 |

验证要求：

- 全部值显式配置；缺失或非法时启动失败（抛错）；
- 验证正整数及安全上限（`Number.isSafeInteger` 且为正）；
- `leaseRenewIntervalMs < leaseDurationMs`；
- `maxConcurrentHandlers <= claimBatchSize`；
- 这些数值是 `implementation configuration` 与 `requires-benchmark`，不是产品承诺；测试使用明确值。

## 8. build/start 两层与 Pool 所有权

### 8.1 `buildIngestionWorker`

- 接受已验证配置、外部 Processing Repository、处理器、可注入 timer/sleeper、diagnostic 和 ID provider 等测试端口；
- 构建运行时对象；不创建 PostgreSQL Pool；不关闭调用方依赖；
- 适合单元和集成测试。

### 8.2 `startIngestionWorker`

- composition root；
- 从环境变量读取并验证配置（调用 `loadIngestionWorkerConfig`）；
- 创建 PostgreSQL Pool；
- 创建 Processing Repository（`@aurora/ingestion-inbox` 处理侧函数组合）；
- 创建 Worker 运行时；
- 启动；
- 注册 SIGTERM/SIGINT；
- 明确拥有并释放它创建的资源；
- 启动失败时回滚（关闭已创建 Pool）；
- Pool 只能关闭一次；
- 生产启动必须显式提供处理器 composition；不得提供永远成功、丢弃事件或空操作的生产默认处理器；测试可以注入 fake processor。

## 9. 处理器端口

定义最小内部处理器端口（命名遵循仓库规范）：

```ts
export interface IngestionEventProcessor {
  process(
    input: ProcessIngestionEventInput,
    signal: AbortSignal,
  ): Promise<ProcessIngestionEventResult>;
}

export interface ProcessIngestionEventInput {
  readonly inboxId: number;        // Inbox 内部 ID（ClaimedInboxEvent.id）
  readonly projectId: string;
  readonly eventId: string;
  readonly event: EventEnvelope;   // @aurora/event-schema 包根类型
  readonly attemptCount: number;
  readonly leaseId: string;
  readonly leaseExpiresAt: Date;
}

export type ProcessIngestionEventResult =
  | { readonly outcome: 'processed' }
  | { readonly outcome: 'retry'; readonly availableAt: Date; readonly errorCode: IngestionErrorCode }
  | { readonly outcome: 'dead-letter'; readonly errorCode: IngestionErrorCode };
```

输入只包含处理所需的稳定数据：Inbox 内部 ID、`projectId`、`eventId`、`EventEnvelope`、`attemptCount`、`leaseId`、`leaseExpiresAt`。

不得包含：PostgreSQL row、SQL、客户端密钥、HTTP Header、Origin、Session、数据库连接。

结果只允许：`processed`、`retry`、`dead-letter`。`retry` 必须由处理器显式提供 `availableAt` 与稳定、脱敏的内部 `errorCode`（`IngestionErrorCode`）；`dead-letter` 必须显式提供稳定、脱敏的内部 `errorCode`。

运行时不得自行决定：最大尝试次数、哪些错误应该重试、退避时间、哪些错误应该死信。这些属于后续 Worker policy 或具体处理器。

## 10. 处理结果编排

- 处理器正常返回 `processed` → 调用 `markProcessed({ id, leaseId })`；
- 返回 `retry` → 调用 `scheduleRetry({ id, leaseId, availableAt, errorCode })`；
- 返回 `dead-letter` → 调用 `markDeadLettered({ id, leaseId, errorCode })`；
- 处理器抛出或 rejected → 视为未分类运行时失败：记录有界、脱敏诊断；不自动决定 retry 或 dead-letter；不调用 `markProcessed`；不伪造成功；允许当前 lease 自然过期后重新领取；不记录 EventEnvelope 或原始 Error 对象；继续处理其他独立事件；
- Repository 暂时失败（`IngestionInboxError`）→ 不把结果标记成功；记录有界诊断；使用显式 `infrastructureFailureDelayMs` 后再次尝试 claim；不创建无限快速循环；不重新实现数据库重试库。

## 11. claim 与容量控制

运行时必须：

- 计算当前剩余并发容量（`maxConcurrentHandlers - inFlightCount`）；
- 只有容量大于 0 时调用 `claimAvailable`；
- claim `limit` 不超过：`剩余容量`、`claimBatchSize` 二者最小值；
- 每条领取记录最多创建一个 in-flight 任务；in-flight 集合必须有界；
- 任务结束后立即释放容量；
- 没有领取到事件时等待 `idlePollIntervalMs`；
- 停止信号后不再领取新事件。

不得：预取无限批次；把事件复制到第二个内存队列；承诺处理顺序；依赖 claim 返回顺序实现业务语义。

## 12. lease 自动续期

- 每个 in-flight 处理任务拥有独立续租控制；
- 使用当前 `leaseId` 调用 `renewLease`；
- 按 `leaseRenewIntervalMs` 调度；`renewLease` 返回 `success` 表示所有权仍有效（数据库 `lease_expires_at` 已由 `renewLease` 内部延长）；`@aurora/ingestion-inbox` 的 `renewLease` 公共接口**不返回**新的 `leaseExpiresAt`，Worker 本地以领取时的 `leaseExpiresAt` 为已知过期信息，租约状态以数据库为权威；
- 不增加 `attemptCount`（`renewLease` 语义保证）；
- 处理结束后立即停止续租；不允许续租任务泄漏；多次停止必须幂等；
- 续租与最终状态写入不能并发产生竞态（最终写回只使用当前有效的 `leaseId`，且续租停止先于写回发起）；
- 若续租返回 `lease_lost`：标记该任务失去所有权；通过 `AbortSignal` 通知处理器；不再调用 processed/retry/dead-letter；不尝试用旧 lease 写回；记录有界诊断；继续处理其他事件；
- 若续租发生暂时数据库故障：不立即假设 lease lost；记录诊断；在租约仍可能有效的范围内按保守策略重试（最多一次重试）；无法确认所有权时停止写回（保守不写回）。

**竞态处理（冻结）**：当最终写回（processed/retry/dead-letter）的结果为 `lease_lost` 时，运行时把该任务视为失去所有权，不重试写回、不伪造成功、记录诊断。测试用真实 PostgreSQL 覆盖：续租 `lease_lost` → Abort 处理器 → 无最终写回。

## 13. graceful shutdown

冻结关闭顺序：

1. 接收 shutdown 信号；
2. 停止新的 claim；
3. 继续为当前 in-flight 事件续租；
4. 等待处理中任务结束，最长 `shutdownGracePeriodMs`；
5. 正常结束的任务允许完成最终状态写入；
6. 宽限期到期后 Abort 未完成处理器；
7. 停止续租；
8. 不强制将未完成项改为 retry 或 dead-letter（让 lease 自然过期并由后续 Worker 重新领取）；
9. 清理 timer；
10. 关闭 Worker；
11. composition root 最后关闭 PostgreSQL Pool。

要求：重复关闭幂等；启动失败回滚；关闭后禁止重新 start 同一实例（单实例停止后不可重启，测试覆盖）；不在进程退出前留下未处理 Promise；不调用 `process.exit()` 跳过清理。

## 14. 生命周期状态

运行时状态至少表达：

```text
created → running → stopping → stopped
```

必须定义并测试：

- `start`；
- 重复 `start`（拒绝）；
- `stop`；
- 重复 `stop`（幂等）；
- `start` 期间 `stop`；
- 启动失败；
- `stopped` 后是否允许重启（本规格选择：单实例停止后不可重启）；
- run loop 异常（记录诊断，不退出进程、不终止其他任务）；
- Pool 关闭顺序（composition root 最后关闭；Pool 只关闭一次）。

## 15. 异常与失败语义

- 处理器正常返回 → 按第 10 节编排；
- 处理器抛出/rejected → 未分类运行时失败：有界诊断；不自动重试/死信；不 markProcessed；不伪造成功；允许 lease 自然过期后重新领取；不记录 EventEnvelope 或原始 Error 对象；继续处理其他独立事件；
- Repository 暂时失败 → 有界诊断；`infrastructureFailureDelayMs` 后再次 claim；无无限快速循环；
- run loop 内部异常 → 记录诊断，按延迟策略回到 claim 循环，不退出进程、不破坏其他 in-flight 任务。

## 16. 诊断与隐私

允许诊断字段（冻结）：

- 稳定 code；
- operation（`claim`/`process`/`renew`/`write-back`/`shutdown` 等）；
- workerId；
- Inbox 内部 ID；
- eventType；
- attemptCount；
- 是否 lease lost；
- 有界时间信息。

禁止记录：

- EventEnvelope 正文；
- 原始 Error 对象；
- SQL、SQLSTATE、constraint 名；
- 数据库 URL（完整值）；
- 客户端密钥；
- HTTP Header；
- 完整堆栈；
- 用户输入。

诊断要求：

- 每实例有界（环形缓冲或固定容量数组）；
- 冻结或不可变；
- 单条长度有上限；
- 处理器异常不能破坏主循环。

## 17. 单元测试（无数据库）

覆盖：

- typed 配置读取与校验（缺失/非法/越界/`leaseRenewIntervalMs >= leaseDurationMs`/`maxConcurrentHandlers > claimBatchSize` 抛错；合法冻结）；
- 生命周期状态转换（created/running/stopping/stopped；重复 start 拒绝；重复 stop 幂等；stopped 后不可重启）；
- claim 循环逻辑（容量计算、claim 上限、空队列等待、停止后不再 claim）；
- timer/sleeper 端口可注入（不依赖真实时间）；
- lease 续租调度与停止（fake clock）；
- 处理器结果映射（processed/retry/dead-letter → 对应 Repository 调用）；
- 处理器异常处理（不标记成功、不伪造成功、继续其他事件、有界诊断）；
- shutdown 顺序（barrier 协调、grace 到期 Abort、不强制改状态）；
- 诊断有界与字段冻结。

## 18. 真实 PostgreSQL 集成测试

必须使用真实 PostgreSQL 17 验证（`AURORA_TEST_DATABASE_URL`；测试确认目标是测试数据库；独立 Schema/命名空间隔离；清理失败显式报错）：

- claim 后调用处理器；
- `processed` 结果写入 `processed`；
- `retry` 结果写入 `retry_waiting`；
- `dead-letter` 结果写入 `dead_lettered`；
- 并发不超过配置值；
- claim 不超过剩余容量；
- 空队列按 idle interval 等待；
- 停止后不再 claim；
- 长任务触发 `renewLease`；
- 处理完成后停止 renew；
- lease lost 中止处理器；
- lease lost 不执行最终写回；
- 处理器异常不标记成功；
- 处理器异常不阻塞其他事件；
- Repository 暂时失败不会 busy loop；
- shutdown grace 内任务可以完成；
- grace 超时后 Abort；
- 被 Abort 的任务不强制改状态；
- lease 最终可过期并被另一个 Worker 领取；
- 两个 Worker 并发运行不重复处理同一 lease；
- Pool 最后释放；
- 重复 stop 幂等；
- timer 和 Promise 无泄漏；
- 测试 Schema 完整清理。

不使用真实长时间 sleep；使用可控 fake clock/timer port、Promise barrier、明确 deferred、数据库状态断言。真实 PostgreSQL 测试只使用短租约和可控协调，不依赖不稳定 wall-clock 等待。

## 19. Workspace 边界

允许：`worker app → data`、`worker app → protocol`、`worker app → approved Node 运行时依赖`。

禁止：`data/protocol → worker app`、`HTTP service → worker 私有实现`、`SDK 包 → worker app`、`worker → Browser/Core/插件`、`worker → Inbox 私有路径`、`worker → OpenAPI tooling 运行时`、`worker → 管理平台`。

应用只从以下包根消费：`@aurora/ingestion-inbox`、`@aurora/event-schema`（仅当处理器公共输入确实需要其包根类型时）。

## 20. 覆盖率与质量门禁

- 包维持 TypeScript strict；覆盖率不低于 lines 85%、branches 80%、functions 85%、statements 85%；
- 单元测试 + 真实 PostgreSQL 集成测试（含双 Worker）；
- 包入口/应用入口、私有路径负例、Workspace Policy `service` 层负例、ESLint 危险模式检查；
- 敏感信息扫描：src/test 不含 `console.log` 原始 Error/EventEnvelope/SQLSTATE/数据库 URL 模式（documentation-contract/security-negative 测试）。

## 21. requires-benchmark 项

- `claimBatchSize`、`maxConcurrentHandlers`、`leaseDurationMs`、`leaseRenewIntervalMs`、`idlePollIntervalMs`、`infrastructureFailureDelayMs`、`shutdownGracePeriodMs` 均为 `implementation configuration` / `requires-benchmark`；
- 不把任何值写成产品承诺；不在规格中伪造生产默认值；
- 最大重试次数、退避算法、死信业务规则保持 blocked（后续 Worker policy/benchmark）。

## 22. 后续 policy 和具体处理器衔接

- 具体事件处理器（错误/请求/性能）实现 `IngestionEventProcessor` 端口，未来由 Worker policy 或处理器组合注入；
- Worker retry/dead-letter policy（最大重试次数、退避、错误分类）为后续独立模块；
- 人工重放为后续独立能力；
- `apps/ingestion-worker` 消费 `@aurora/ingestion-inbox` 包根公共接口，不访问私有路径。

## 23. 排除范围

- 具体事件处理器、数据处理与查询存储、聚合、分组、索引；
- Worker retry/dead-letter policy、退避算法、人工重放；
- 管理平台、HTTP 路由、客户端凭证；
- SDK transport、Redis/BullMQ、SQS/Kinesis、调度框架；
- CI、RDS、IaC、容量基准。

## 24. 规格自检

- **权威一致性**：不改 Inbox 状态集合与 lease/fencing 语义（完全复用 `@aurora/ingestion-inbox` 公共处理 API）；不改 ACK/幂等/receipt；不固定 policy/benchmark 数值；不引入新队列技术；不违反 ADR-004/008/010/011/012；
- **兼容性**：Processing Repository 公共 API 不变；`apps/ingestion-api` 回归通过；event-schema 与 OpenAPI 不变；新应用只通过包根依赖；无私有路径或循环依赖；不影响 SDK 包；
- **计划质量**：每项规格有 Task；配置、状态、结果和接口全文一致；每个 Task 有 TDD 闭环；无占位；无具体处理器或 policy；实施者能只凭计划执行；
- **安全和并发**：并发有界；无第二内存队列；使用 `leaseId` fencing；lease lost 后不写回；shutdown 不强改状态；不记录 EventEnvelope 或数据库秘密；测试使用隔离数据库。

自动审批依据：本文全部语义由 accepted ADR-004/008/010/011/012 与 approved Inbox 数据模型、处理侧 Repository 规格无歧义派生；无新增产品/架构/安全/隐私决策；Inbox 状态集合与 ACK/幂等边界不变；自检全部通过。
