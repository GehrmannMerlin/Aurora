---
title: Aurora 数据接入 Inbox 数据模型、状态机、Migration 与原子持久化边界第一增量
status: approved
implementation-status: implemented
approval-status: approved
owner: ingestion
created: 2026-08-01
last-reviewed: 2026-08-01
applies-to: packages/ingestion-inbox（event_inbox 表、Migration、原子批次持久化 Repository、真实 PostgreSQL 集成测试）
related:
  - ../../AGENTS.md
  - ../../AURORA_RULES.md
  - '../../Aurora 代码规范.md'
  - '../../Aurora 测试规范.md'
  - '../../Aurora 文档规范.md'
  - '../../Aurora ADR 规范.md'
  - ../adr/ADR-004-asynchronous-event-processing.md
  - ../adr/ADR-005-event-schema-source-of-truth.md
  - ../adr/ADR-008-ingestion-durable-buffering.md
  - ../adr/ADR-009-ingestion-transport-and-client-credential.md
  - ../adr/ADR-010-postgresql-access-and-migration-tooling.md
  - ../protocol/ingestion-batch-and-receipt-contract.md
  - ../api/ingestion-openapi.md
  - ../operations/backup-and-recovery.md
  - ../releases/release-migration-and-rollback.md
  - ../architecture/formalization-readiness.md
supersedes: none
review-cycle: ingestion-inbox-schema-or-compatibility-change
---

# Aurora 数据接入 Inbox 数据模型、状态机、Migration 与原子持久化边界第一增量

## 1. 定位、效力与当前状态

本文冻结数据接入 `event_inbox` 数据模型、状态机、Migration 与原子持久化边界第一增量，实施为真实私有包 `@aurora/ingestion-inbox`。它承载 ADR-008 后续依赖链第 3 项（Inbox 数据模型、状态机和 Migration）的机器语义，是数据接入服务同步接收路径（第 4 项）与 Worker 租约消费（第 5 项）的直接前置。

**批准状态**：本文于 2026-08-01 由用户预先批准（`status: approved`、`approval-status: approved`）。`implementation-status` 于 2026-08-01 更新为 `implemented`：`@aurora/ingestion-inbox` 已实施（`event_inbox` Migration、`persistBatch` Repository、状态/租约结构字段）并通过真实 PostgreSQL 17.10 集成测试与全仓质量门禁。本文由 accepted ADR-004/005/008/009/010 与 approved 批次/接收结果协议、OpenAPI 规格无歧义派生；自动审批依据见规格自检节。

**"已可靠接收"唯一边界**：`event_inbox` 事务成功 COMMIT 后，事件才映射为 `accepted`（或 `duplicate_accepted`）。事务回滚、连接断开或提交结果不确定时不得返回可靠接收；Redis、内存或进程队列不构成 ACK 边界。

## 2. 元数据、Owner 和范围

- **Owner**：ingestion
- **适用范围**：`event_inbox` 表结构、约束、索引、Migration、原子批次持久化 Repository、真实 PostgreSQL 集成测试。
- **明确非职责**：
  - Fastify 路由、HTTP 鉴权、Header/Origin/CORS/environment 校验、客户端密钥；
  - 接入服务编排、Worker 消费循环、实际重试调度、死信重放 API；
  - Redis/BullMQ、SQS/Kinesis、采样、限流；
  - RDS/CI/IaC、容量 benchmark、管理平台。

## 3. 模块选择依据

- ADR-008 选择 PostgreSQL 事务性 Inbox 作为可靠缓冲物理技术（方案 A，accepted）；
- ADR-010 冻结工具链：PostgreSQL 17 + `pg`（node-postgres）+ `node-pg-migrate` + SQL-first；
- 批次/接收结果协议与 OpenAPI 已实施，为 Repository 的逐事件结果与请求级 receipt 提供机器来源；
- 本模块只做 Inbox 数据模型与持久化，不做通用数据库框架。

## 4. 职责与非职责

### 4.1 职责

- `event_inbox` 表（列、约束、最小索引）；
- `(project_id, event_id)` 租户作用域幂等唯一约束；
- EventEnvelope 持久化表示（JSONB）；
- 最小处理状态模型与 Worker 后续租约所需结构字段；
- 原子批次持久化 Repository（事务内插入、返回可映射到 `IngestionRequestReceipt` 的内部结果）；
- 真实 PostgreSQL 集成测试与 Migration 执行入口；
- 包入口、Workspace Policy、架构边界与 README。

### 4.2 非职责

- 不实现 HTTP 服务、鉴权、Origin/CORS/environment 校验、客户端密钥；
- 不实现 Worker 消费循环、重试调度、死信重放；
- 不实现队列/Redis/BullMQ/SQS/Kinesis、采样、限流；
- 不创建 RDS、CI、IaC；
- 不重新定义事件 Schema（event-schema 是唯一来源）。

## 5. 数据库工具与包边界

- **PostgreSQL 17**：第一版数据库兼容基线；本地/CI 验证运行 PostgreSQL 17.x；生产 RDS 用 AWS 支持的 PostgreSQL 17 小版本。
- **`pg`（node-postgres）**：生产运行时依赖；`Pool` 管理连接；事务通过从 Pool 获取的同一 client 显式执行；所有含不可信数据的 SQL 参数化；禁止字符串拼接参数。
- **`node-pg-migrate`**：开发依赖与 Migration 执行工具；默认事务 Migration；使用工具 Migration 锁；应用启动不自动迁移生产数据库；已发布 Migration 只追加。
- **包**：`packages/ingestion-inbox`，包名 `@aurora/ingestion-inbox`，Migration 目录 `migrations/`，结构 `src/`、`migrations/`、`test/`、`test/integration/`、`README.md`。
- **测试数据库**：`AURORA_TEST_DATABASE_URL`；只用于测试；测试确认目标是测试数据库；每次测试独立 Schema 或唯一命名空间；清理失败显式报错；禁止以 SQLite/mock/PGlite 替代真实 PostgreSQL 完成证据。
- **SQL 校验**：第一增量不引入独立 SQL linter；通过参数化、SQL 模块单一职责、Migration 空库执行、真实 PostgreSQL 解析执行、Schema/约束/索引断言、事务回滚集成测试、Workspace Policy 危险模式检查与代码评审保证。

## 6. ACK 事务边界

- 只有包含 Inbox 插入结果的数据库事务成功 COMMIT，才能映射为 `accepted`；
- BEGIN 后异常、ROLLBACK、连接中断或 COMMIT 结果不确定时不得返回 accepted；
- Repository 不生成 HTTP 响应；
- 普通缓存/Session Redis 不得作为可靠接收边界；
- 数据接入服务（后续模块）把 Repository 结果映射为 `IngestionRequestReceipt`。

## 7. 表结构

`event_inbox` 第一增量表结构（列名在 Migration 发布后冻结，具有迁移成本）：

| 列名               | 类型                                  | 必填         | 用途                                                                               | 谁写入            | 谁读取             | 生命周期       |
| ------------------ | ------------------------------------- | ------------ | ---------------------------------------------------------------------------------- | ----------------- | ------------------ | -------------- |
| `id`               | `BIGINT GENERATED ALWAYS AS IDENTITY` | 是           | 内部主键，仅追踪/诊断/确定性测试                                                   | Repository        | Worker/诊断        | Inbox 生命周期 |
| `project_id`       | `UUID`（或项目稳定标识）              | 是           | 项目作用域；幂等键组成部分                                                         | Repository        | Repository/Worker  | 与项目一致     |
| `event_id`         | `VARCHAR(128)`                        | 是           | 事件标识；幂等键组成部分；长度 = `EVENT_SCHEMA_LIMITS.maxEventIdLength`            | Repository        | Repository/Worker  | 与事件一致     |
| `event_type`       | `VARCHAR`                             | 是           | 事件类型（`error`/`request`/`performance`），诊断/分域                             | Repository        | Worker/诊断        | 与事件一致     |
| `protocol_version` | `INTEGER`                             | 是           | 事件协议版本（当前 `1`）                                                           | Repository        | Worker/兼容判断    | 与事件一致     |
| `envelope`         | `JSONB`                               | 是           | 完整 `EventEnvelope`（已通过 event-schema 解析器），保留机器协议信息               | Repository        | Worker（反序列化） | Inbox 生命周期 |
| `request_id`       | `VARCHAR`                             | 否           | 来源请求追踪（对应 `X-Aurora-Request-Id`）                                         | 接入服务（后续）  | 诊断               | 诊断期         |
| `batch_id`         | `VARCHAR`                             | 否           | 接收批次追踪 ID（未来接入服务生成）                                                | 接入服务（后续）  | 诊断               | 诊断期         |
| `batch_index`      | `INTEGER`                             | 否           | 批次内索引，仅追踪/确定性测试                                                      | Repository        | 诊断/测试          | Inbox 生命周期 |
| `received_at`      | `TIMESTAMPTZ`                         | 是           | SDK 批次准备时间（`IngestionBatchRequest.receivedAt` 或服务端接收时间），追踪/诊断 | Repository        | Worker/诊断        | Inbox 生命周期 |
| `state`            | `VARCHAR`（check 约束枚举）           | 是           | 处理状态                                                                           | Repository/Worker | Worker             | Inbox 生命周期 |
| `available_at`     | `TIMESTAMPTZ`                         | 是           | 该记录最早可领取时间；待处理=received_at；重试等待=退避后时间                      | Repository/Worker | Worker             | 待处理/重试期  |
| `lease_owner`      | `VARCHAR`                             | 否           | 领取该记录的 Worker 标识                                                           | Worker（后续）    | Worker             | 租约持有期     |
| `lease_expires_at` | `TIMESTAMPTZ`                         | 否           | 租约到期时间；过期后可重新领取                                                     | Worker（后续）    | Worker             | 租约持有期     |
| `attempt_count`    | `INTEGER`                             | 是（默认 0） | 尝试次数；用于重试/死信判定（数值由后续 Worker 规格冻结）                          | Repository/Worker | Worker             | Inbox 生命周期 |
| `processed_at`     | `TIMESTAMPTZ`                         | 否           | 处理完成时间                                                                       | Worker（后续）    | 诊断               | 完成标记       |
| `dead_lettered_at` | `TIMESTAMPTZ`                         | 否           | 死信标记时间                                                                       | Worker（后续）    | 诊断/死信操作      | 死信期         |
| `last_error_code`  | `VARCHAR`                             | 否           | 最后一次稳定错误码（`IngestionErrorCode`）                                         | Worker（后续）    | 诊断               | 重试/死信期    |
| `created_at`       | `TIMESTAMPTZ`                         | 是           | 创建时间                                                                           | Repository        | 诊断               | Inbox 生命周期 |
| `updated_at`       | `TIMESTAMPTZ`                         | 是           | 更新时间                                                                           | Repository/Worker | 诊断               | Inbox 生命周期 |

**字段决策**：

- `id` 内部主键加入：确定性测试与追踪需要稳定标识；
- `event_type`/`protocol_version` 独立列加入：诊断与未来兼容判断需要，避免解析 JSONB；
- `request_id`/`batch_id` 保留可选：未来接入服务写入，第一增量 Repository 可为 null；
- `lease_owner`/`lease_expires_at`/`attempt_count`/`processed_at`/`dead_lettered_at`/`last_error_code` 结构性加入：Worker 后续领取所需，本轮只建结构不实现领取；
- `envelope` JSONB 完整保留机器协议信息，不在数据库层重新定义事件 Schema。

**明确禁止写入**：`X-Aurora-Client-Key`、密钥 secret/摘要、Cookie、Authorization、请求 Header、Browser Session、完整 allowlist、SQL 错误/堆栈、未批准用户身份信息。

## 8. 幂等

- 唯一范围严格为 `(project_id, event_id)`：唯一索引 `uq_event_inbox_project_event`；
- 不建立全局裸 `event_id` 唯一；不同项目可用相同 eventId；
- 同项目并发提交相同 eventId 只形成一条记录（`ON CONFLICT (project_id, event_id)`）；
- 已存在记录映射为 `duplicate_accepted`；
- 不向上层暴露 SQLSTATE、约束名或 SQL 文本；
- 第一增量 `event_id` 长度上限 128（`EVENT_SCHEMA_LIMITS.maxEventIdLength`）。

## 9. 部分成功

- 合法事件与永久无效事件在进入 Repository 前已经由接入层区分；Repository 处理已通过公共 Schema 校验的事件；
- 重复事件不得导致整个批次事务回滚；
- 一个事件的冲突不能撤销其他成功插入；
- PostgreSQL 临时失败不能伪装为 accepted；
- 实现优先使用参数化批量插入 + `ON CONFLICT (project_id, event_id) DO NOTHING`，单条冲突不回滚整批；
- 不以逐事件独立事务破坏批次原子持久化边界（本规格未证明需要）。

## 10. 状态模型

从 ADR-008（租约轮询/分批拉取、租约到期可重投、重试计数达上限进死信、幂等消费）唯一推导最小状态模型：

| state           | 语义                 | 领取条件                                                        | 转换                                                       |
| --------------- | -------------------- | --------------------------------------------------------------- | ---------------------------------------------------------- |
| `pending`       | 待处理               | `available_at <= now()` 且未被租约持有                          | → `leased`（Worker）→ `processed` / `dead_lettered`        |
| `leased`        | 已被 Worker 租约领取 | 仅 `lease_owner` 且 `lease_expires_at > now()` 的 Worker 可处理 | → `pending`（租约过期重投）→ `processed` / `dead_lettered` |
| `retry_waiting` | 等待重试             | `available_at <= now()` 才可重新领取                            | → `leased`（重试）                                         |
| `processed`     | 已完成               | 不可普通领取                                                    | 终态                                                       |
| `dead_lettered` | 死信终止             | 不可普通消费                                                    | 终态                                                       |

**实现形式选择**：单一 `state` 字段 + `available_at` + `lease_owner`/`lease_expires_at` + `attempt_count`（组合，非时间戳推导）。

理由：

- ADR-008 需要区分"租约过期可重投"与"重试等待中不可提前领取"，`state + available_at + lease_*` 直接表达；
- `attempt_count` 与 `last_error_code` 支撑重试上限与死信判定（数值由后续 Worker 规格冻结）；
- `processed`/`dead_lettered` 为终态，不允许普通流程重新领取；
- 精确最大重试次数、退避数值保持后续 Worker/benchmark 决策，本轮不引入无限重试默认值；
- 状态转换由 Repository API 与数据库约束（check 约束 + 明确更新语句）保护。

## 11. 约束

- `PRIMARY KEY (id)`；
- `UNIQUE (project_id, event_id)`；
- `CHECK (state IN ('pending','leased','retry_waiting','processed','dead_lettered'))`；
- `CHECK (available_at IS NOT NULL)`（必填）；
- `CHECK (attempt_count >= 0)`；
- 可选 `CHECK (length(event_id) <= 128)`、`CHECK (length(event_type) > 0)`；
- `NOT NULL` 约束按 §7 表结构。

## 12. 索引

第一增量最小索引：

| 索引                            | 用途              | 依据             |
| ------------------------------- | ----------------- | ---------------- |
| `UNIQUE (project_id, event_id)` | 幂等唯一          | ADR-008 幂等键   |
| `(state, available_at)`         | Worker 待领取查询 | ADR-008 租约轮询 |
| `(received_at)`                 | 积压/诊断排序     | ADR-008 背压信号 |
| `(lease_expires_at)`            | 租约过期重投      | ADR-008 租约恢复 |

**明确不做**：

- 正文任意字段 GIN 索引（第一增量不按事件正文内容查询）；
- 无容量证据的大量索引；
- 过早分区；
- 把估算性能写成实测（全部性能结论标记 `requires-benchmark`）。

## 13. EventEnvelope 表示

- `envelope` JSONB 保存完整 `EventEnvelope`（已通过 `parseEventEnvelope` 等公共解析器）；
- 不修改 EventEnvelope；不由数据库生成或改写 eventId；
- 不把 OpenAPI Schema 作为事件语义来源（event-schema 是唯一来源）；
- 精确列拆分只基于索引/幂等/处理需求（`event_type`、`protocol_version`、`event_id`、`project_id`），不重复所有正文属性。

## 14. Repository API

最小公共 API（命名遵循仓库现有命名与结果类型模式）：

```ts
export interface IngestionInboxRepository {
  persistBatch(input: PersistIngestionBatchInput): Promise<PersistIngestionBatchResult>;
}
```

输入：

```ts
export interface PersistIngestionBatchInput {
  readonly projectId: string;
  readonly events: readonly InboxEventInput[];
  readonly receivedAt?: number; // Unix epoch ms，可选
  readonly requestId?: string; // 可选，未来接入服务写入
  readonly batchId?: string; // 可选，未来接入服务写入
}

export interface InboxEventInput {
  readonly batchIndex: number; // 批次内索引
  readonly event: EventEnvelope; // 已通过 event-schema 公共解析器
}
```

结果：

```ts
export interface PersistIngestionBatchResult {
  readonly perEventResults: readonly InboxEventPersistResult[];
}

export interface InboxEventPersistResult {
  readonly eventId: string;
  readonly outcome: 'inserted' | 'duplicate';
  // 可由未来接入服务映射到 IngestionEventReceipt（state=accepted / duplicate_accepted）
}
```

API 约束：

- 接受已通过 event-schema 校验的 EventEnvelope；接受可信 project 上下文；
- 不接受客户端密钥；不负责 Header/Origin/environment 校验；不生成 HTTP 状态码/CORS；不执行 Worker；
- 返回内部结果，可由未来接入服务映射到 `IngestionRequestReceipt`；
- 区分 `inserted` 与 `duplicate`；
- 对暂时数据库失败返回稳定内部失败（不泄露 PostgreSQL 细节）；
- 不修改输入；
- `project_id` 等列名不是公共 HTTP API，但 Migration 发布后具有迁移成本，必须冻结。

错误映射：数据库错误（连接失败、语句失败）映射为稳定内部失败结果，不外泄 SQL、参数、约束名、SQLSTATE。

## 15. Migration 策略

- 使用 `node-pg-migrate` 确定性 Migration；
- 文件名稳定时间戳前缀 + `kebab-case`；
- Migration 默认事务执行；无法事务化时显式说明；
- 不依赖运行时网络；不生成不确定数据；
- 第一增量不做破坏性数据删除；
- 已发布 Migration 只追加，不原地修改；
- Migration 状态可审计（`pgmigrations` 表）；应用或检查命令能检测缺失 Migration；
- 应用启动不自动迁移生产数据库（显式命令执行）；
- 生产回滚优先向前修复和 expand/contract；destructive down 不作为生产默认回滚；本地测试可验证 down。

## 16. 回滚策略

- Migration 发布前缺陷：可直接修改未发布 Migration；
- Migration 发布后：向前修复（新增 Migration），遵循 expand/contract；
- 本地测试可执行 down 验证 up/down 对称性，但生产不默认执行破坏性 down。

## 17. 测试数据库

- `AURORA_TEST_DATABASE_URL`：集成测试连接变量；
- 测试确认连接目标是测试数据库（校验 database name 前缀或隔离 Schema）；
- 每次测试独立 Schema 或唯一命名空间；
- 清理失败显式报错；
- 禁止 SQLite/mock/PGlite 替代真实 PostgreSQL 完成证据；
- CI 未来使用 PostgreSQL 17 service container 注入 `AURORA_TEST_DATABASE_URL`；本轮不创建完整 CI 工作流。

## 18. 真实 PostgreSQL 测试

测试至少覆盖：

- 空库执行全部 Migration；
- Migration 版本状态检测；
- 测试环境 down/重新 up；
- Schema、表、列、约束和索引存在；
- `(project_id, event_id)` 唯一；
- 不同 project 相同 eventId；
- 同一 project 并发重复提交；
- 混合新事件与重复事件；
- 部分成功不回滚其他事件；
- 事务失败不产生 accepted 记录；
- EventEnvelope 原样保存；
- 无凭证或敏感 Header 字段；
- 状态约束；
- 非法状态转换；
- lease 字段一致性；
- retry available-at 约束；
- processed/dead-lettered 不可普通领取；
- 时间字段使用；
- 清理后测试数据库隔离。

## 19. 隐私与日志

- 不存客户端密钥、secret、摘要、Cookie、Authorization、请求 Header、Browser Session、完整 allowlist、SQL 错误/堆栈、未批准用户身份信息；
- 不输出 SQL、参数、事件正文或凭证到普通日志；
- 错误映射为稳定内部失败，不泄露 PostgreSQL 细节。

## 20. 性能与 requires-benchmark

- Worker 批量领取数量、租约时长、最大重试次数、退避、死信保留、Inbox 在线保留、分区阈值、Vacuum/索引维护、生产容量均 `requires-benchmark`；
- 第一增量不硬编码虚假默认值冒充批准结论；
- 索引只建最小必要集合，性能结论均标记 `requires-benchmark`。

## 21. 覆盖率与质量门禁

- 包维持 TypeScript strict；单元测试覆盖 Repository 纯逻辑与类型收窄；真实 PostgreSQL 集成测试覆盖约束与事务语义；
- 包入口、私有路径负例、Workspace Policy（`aurora.layer: data` 或等价，零 Browser/Core/插件依赖）、ESLint 危险数据库模式检查；
- `pg` 类型/错误不泄露到公共协议层。

## 22. 文档与 ADR

- `packages/ingestion-inbox/README.md`；
- `docs/architecture/ingestion-inbox-data-model.md`（本文）；
- `docs/architecture/formalization-readiness.md`：数据接入链路状态更新；
- ADR-008：追加 Inbox 数据模型实施证据（若真实实现）；
- ADR-010：追加 Inbox 实施证据（若真实实现）。

## 23. 明确排除范围

- 接入 HTTP 服务、鉴权、Origin/CORS/environment 校验、客户端密钥；
- Worker 消费循环、重试调度、死信重放；
- Redis/BullMQ、SQS/Kinesis、采样、限流；
- RDS/CI/IaC、容量 benchmark、管理平台。

## 24. 接入服务和 Worker 后续衔接

- 数据接入服务同步接收路径（第 4 项）：调用 `persistBatch` 获得逐事件 `inserted`/`duplicate` 结果，映射为 `IngestionRequestReceipt`（`accepted`/`duplicate_accepted`），并对 `temporarily_failed` 的暂时数据库失败返回稳定错误；
- Worker 租约消费（第 5 项）：按 `(state, available_at)` 领取、`lease_owner`/`lease_expires_at` 租约、`attempt_count`/`last_error_code` 重试、`processed_at`/`dead_lettered_at` 终态；
- 两者均只消费 `@aurora/ingestion-inbox` 包根公共接口。

## 25. 规格自检

- ACK 只对应事务 COMMIT；幂等范围是 `(project_id, event_id)`；不承诺顺序；不引入采样；无新保留期限；无新重试数值；
- 不改变 event-schema、receipt 或 OpenAPI；数据库工具符合 ADR-010（PostgreSQL 17 + pg + node-pg-migrate + SQL-first）；
- event-schema 公共 API 不被修改；OpenAPI 不成为数据库权威；SDK/插件不受影响；
- 数据库包不依赖 Browser/Core/插件；只从 event-schema 包根导入；无循环依赖和私有路径；
- 每个字段有用途；SQL、列名、状态和 TypeScript 类型一致；无占位；无 HTTP 服务或 Worker 内容；
- 不存密钥和敏感 Header；SQL 参数化；错误不泄露 SQL 或约束名；输入已通过 event-schema；输入不被修改；Migration 无隐式破坏性操作；测试数据库安全隔离。

自动审批依据：本文全部语义由 accepted ADR-004/005/008/009/010 与 approved 批次/接收结果协议、OpenAPI 规格无歧义派生，无新增产品/架构/安全/隐私决策；状态模型由 ADR-008 租约/重试/死信语义唯一推导；自检全部通过。
