---
title: ADR-008：数据接入可靠缓冲与异步处理的物理技术
status: accepted
implementation-status: in-progress
approval-status: approved
owner: backend
date: 2026-08-01
last-reviewed: 2026-08-01
applies-to: Aurora SDK 数据接入、可靠缓冲、异步事件处理、事件幂等事实和恢复
related:
  - ../../AURORA_RULES.md
  - ../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md
  - '../../Aurora 架构规范.md'
  - ../architecture/system-overview.md
  - ../architecture/platform-backend.md
  - ../architecture/deployment.md
  - ../testing/test-strategy.md
  - ../releases/release-migration-and-rollback.md
  - ../operations/backup-and-recovery.md
  - ../superpowers/specs/2026-07-28-aurora-testing-deployment-release-design.md
  - ../superpowers/specs/2026-07-29-aurora-topic-discussion-summary.md
  - ADR-002-five-system-boundaries.md
  - ADR-004-asynchronous-event-processing.md
  - ADR-005-event-schema-source-of-truth.md
supersedes: none
superseded-by: none
---

# ADR-008：数据接入可靠缓冲与异步处理的物理技术

## 元数据

- 状态：accepted
- 决策状态：accepted
- 实施状态：in-progress
- 审批状态：approved
- 日期：2026-08-01
- Owner：backend
- 适用范围：SDK 数据接入、可靠缓冲、异步事件处理、事件幂等事实和恢复
- 关联 PRD：[核心业务 PRD](../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md) 第 7 章
- 关联技术方案：[Aurora 架构规范](<../../Aurora 架构规范.md>)、[系统架构与模块边界](../architecture/system-overview.md)、[部署架构](../architecture/deployment.md)
- 关联 Issue：none
- 关联实现 PR：none
- 替代 ADR：none
- 被替代 ADR：none
- 实施状态：in-progress

## 状态说明

本 ADR 于 2026-08-01 由用户批准（`decision-status: accepted`、`approval-status: approved`），实施状态更新为 `in-progress`（批次/接收结果协议、数据接入 OpenAPI 与 Inbox 数据模型已实施）。批准只授权决策，不表示接入服务、Worker、容量/性能证据或 AWS 资源已经实现。

## 背景

Aurora 已接受 ADR-002（五大系统边界）和 ADR-004（可靠接收与异步处理）。ADR-004 确立了"同步必要校验 + 可靠缓冲 + 复杂处理异步执行"的行为语义，但明确留下未解决问题：**第一版可靠缓冲的具体技术、消费并发和顺序策略、死信保存和人工处理方式、处理延迟服务目标**。六专题总结在"尚未确认或尚无正式规格"中进一步列出：正式 HTTPS 接收路径、批次 Schema、响应结构、稳定错误码、API 主版本、可靠缓冲具体技术、分区键、顺序、并发、租约、确认和重放，以及批次/事件大小、批量数量、超时、采样、去重窗口、重试和死信保留数值。

当前仓库没有任何数据接入或处理的物理实现：没有接入服务、没有缓冲、没有消费者、没有 AWS 资源、没有容量证据。管理平台已批准的 PostgreSQL Outbox + Redis/BullMQ 组合只适用于管理平台异步任务，不能自动外推为数据接入或处理缓冲选型（ADR-004 第 112 行与追加记录已明确）。

本 ADR 是数据接入链路的高迁移成本长期决策：它决定 SDK 收到"已可靠接收"的真实边界、接收服务与处理之间的物理介质、故障恢复方式，以及后续数据接入 OpenAPI、批次协议和容量模型的设计基础。因此它必须由用户直接审批，不适用自动审批。

## 决策驱动因素

- **可靠接收语义**：SDK 何时能收到"已可靠接收"，必须与"已保存到不会因进程终止而丢失的介质"严格对应；
- **持久化边界**：可靠缓冲必须持久化，普通内存或非持久缓存不能冒充可靠接收边界；
- **第一版规模**：无真实容量证据，按清晰标记的保守假设区间设计，不虚构吞吐结论；
- **运维复杂度**：第一版小团队、独立开发者和小型前端团队，运维负担必须可控；
- **AWS 目标拓扑**：单主区域、生产 Multi-AZ、ElastiCache Redis（Session/BullMQ/缓存隔离）、RDS PostgreSQL Multi-AZ、私有 S3；
- **RPO/RTO**：现有 approved 目标为单区域多可用区 PostgreSQL `RPO ≤ 5 分钟`、`RTO ≤ 60 分钟`，区域级 `RPO ≤ 24 小时`、`RTO ≤ 8 小时`；接收确认的数据不能因进程重启丢失；
- **SLO**：数据接入月度可用性 99.9%，正常容量下已接收事件 95% 在 60 秒内、99% 在 5 分钟内可查询；
- **幂等与重复**：至少一次投递 + 幂等消费，同一 `(project_id, event_id)` 或等价租户作用域幂等键重复投递/消费结果幂等；
- **可测试性**：本地功能验证、故障注入、压力、重复投递、重放、AZ 故障、容量/成本、恢复演练都需要可复现路径；
- **后续契约需求**：批次 Schema、响应结构、稳定错误码、逐事件结果、容量模型都将建立在本次缓冲决策之上；
- **成本构成**：AWS 托管队列按请求/吞吐计费，PostgreSQL 按实例/RDS 计费，Redis 按节点/内存计费，需在候选间权衡。

## 现有约束

- ADR-002：数据接入只做鉴权、限制、校验、过滤和可靠接收，不执行复杂异步处理；五个逻辑系统不等于五个部署单元，但代码边界不能合并；
- ADR-004：已接收只表示可靠缓冲，不等于问题已生成；一批单条失败不导致整批回滚；SDK 不重试永久拒绝；重试、退避、死信有上限；不静默丢失；
- ADR-005：所有外部输入视为不可信并运行时校验；事件类型、限制、版本、运行时 Schema 的唯一来源是 `event-schema`；批次/接收协议仍未规格化；
- 部署架构：RDS PostgreSQL Multi-AZ、ElastiCache Redis（Session/BullMQ/缓存隔离角色、容量和故障边界）、私有 S3 对象；数据接入使用独立公开主机和客户端上报密钥，不共享浏览器 Session；数据接入物理队列/存储和扩缩容为 `requires-accepted-adr`；
- 备份与恢复：PostgreSQL PITR 与 35 天初始备份；Redis/BullMQ 故障由 PostgreSQL Outbox 和权威失败记录重投，消费者必须幂等；普通缓存可清空重建，不进入业务 RPO；
- SLO 与容量：数据接入 99.9% 月度可用性；已接收事件 95%/60s、99%/5min 可查询；真实吞吐和事件大小模型尚不存在，标记为 `requires-benchmark`；
- 六专题总结 §5.2：一个批次允许部分事件成功、部分事件永久拒绝或暂时失败；单条失败不回滚已可靠写入的合法事件；永久拒绝不重试，暂时失败使用有上限退避；
- 管理平台 PostgreSQL Outbox + Redis/BullMQ 只适用于管理平台异步任务，不能外推为数据接入/处理缓冲。

## 候选方案

### 方案 A：PostgreSQL 事务性 Inbox（推荐）

**数据流**：SDK 批次 → 数据接入服务同步完成鉴权、来源/环境、大小、协议 Schema、隐私过滤、去重窗口检查、限流（当前不实施采样）→ 在一个 RDS PostgreSQL 事务中写入 `event_inbox` 表（事件编号唯一约束、幂等键、状态、租约、重试计数、死信标记）→ 事务提交成功才返回"已可靠接收"及逐事件结果 → `platform-worker`（或独立 `ingestion-worker`）以租约轮询/分批拉取待处理事件 → 幂等消费 → 写入事件事实/聚合/存储 → 更新 Inbox 状态或删除/归档。复用部署中的 RDS PostgreSQL 与平台 Worker，不新增 AWS 托管队列。

**ACK 边界**：PostgreSQL 事务提交即 ACK。进程在任何时刻终止，未提交事务回滚、已提交事件仍在 Inbox 中，不会丢失。
**持久化位置**：RDS PostgreSQL Multi-AZ 的 `event_inbox` 表。
**故障恢复**：实例重启或 AZ 故障时，未处理事件仍在 Inbox，恢复后按租约重新拉取；PostgreSQL PITR 与 35 天备份覆盖缓冲数据。
**幂等**：`(project_id, event_id)` 或等价租户作用域幂等键作为唯一约束，重复投递被唯一索引拒绝；消费者对重复幂等键幂等。
**顺序**：第一版不承诺跨事件、批次内或租户内处理顺序；Inbox 主键、入队时间和批次索引只用于追踪、诊断和确定性测试；如未来需要顺序保证，必须新建或替代 ADR。
**重试和死信**：租约到期可重投；重试计数达上限后标记死信，保留于 `event_dead_letter` 或 Inbox 死信状态，可人工重放。
**扩容方式**：Worker 增加并发消费者；Inbox 表按时间/事件编号分区；后续可升级到 SQS/Kinesis 而无协议变化。
**运维复杂度**：中低。复用已计划 RDS 与 Worker，不新增服务；但需监控 Inbox 积压年龄、死信和租约。
**AWS 成本构成**：RDS 实例与存储、PITR/备份存储；无单独队列计费。低并发下成本最低。
**对本地开发和测试的影响**：本地可用 PostgreSQL 容器或嵌入式等效；Inbox 行为可在集成测试中用真实 PostgreSQL 验证。
**对 OpenAPI、数据模型和 Migration 的影响**：需要 `event_inbox` 表 Migration；数据接入 OpenAPI 的逐事件结果与批次 Schema 仍独立设计，但接收确认绑定 Inbox 写入成功。
**主要风险**：RDS 写入成为接收路径瓶颈；高吞吐下 Inbox 表增长与索引维护；轮询延迟影响 95%/60s 目标；单库成为处理吞吐上限。
**退出和迁移路径**：Inbox 表是独立租约模型，可从轮询平滑迁移到 SQS/Kinesis 消费者而不改变接收语义；数据接入 OpenAPI 和批次协议不受影响。

### 方案 B：AWS 托管队列（SQS 或 Kinesis）

**数据流**：SDK 批次 → 数据接入服务同步校验 → 写入 AWS 托管队列（SQS FIFO 或标准、Kinesis Data Streams）→ 返回"已可靠接收" → 消费者从队列拉取 → 幂等消费 → 写事件事实/存储。
**ACK 边界**：SQS 生产端 ACK 是 `SendMessage`/`SendMessageBatch` 成功；Kinesis 生产端 ACK 是 `PutRecord`/`PutRecords` 成功。可见性超时、消息删除和消费者检查点属于消费端确认、重试和恢复机制，不属于生产端"已可靠接收"边界。
**持久化位置**：AWS 托管队列（SQS 默认保留 4–14 天；Kinesis 默认保留 24 小时，可扩至 365 天）。
**故障恢复**：AWS 托管队列自身冗余；消费者恢复后继续消费。
**幂等**：依赖事件编号 + 消费者幂等；SQS FIFO 提供严格一次群组内顺序，标准 SQS 只提供至少一次。
**顺序**：SQS FIFO 按消息组 ID 保序；标准 SQS 无序；Kinesis 按分区键保序。
**重试和死信**：SQS 可见性超时 + DLQ；Kinesis 需要自建重试/死信。
**扩容方式**：SQS 自动扩展；Kinesis 按分片扩展（吞吐与分片数绑定）。
**运维复杂度**：低（SQS 无服务器），中（Kinesis 需分片管理）。
**AWS 成本构成**：SQS 按请求量计费；Kinesis 按分片小时 + 数据量计费。高吞吐下成本可预测，低吞吐下 SQS 成本极低。
**对本地开发和测试的影响**：本地需 localstack/测试容器模拟；SQS/Kinesis 语义与真实服务在确认/顺序/重试上存在差异，需真实集成测试。
**对 OpenAPI、数据模型和 Migration 的影响**：接收确认绑定队列写入成功；数据接入 OpenAPI 的逐事件结果独立设计；无 PostgreSQL Inbox 表 Migration，但需队列权限与 DLQ 配置。
**主要风险**：SQS 标准无序 + 至少一次（需更强调幂等）；Kinesis 分片容量规划需基准；托管队列的"已接收"边界依赖队列持久化语义（SQS 标准可能有重复/乱序，需额外处理）；区域故障下队列数据保留依赖 AWS 服务 RPO。
**退出和迁移路径**：可从托管队列迁回 Inbox 或换队列服务，但接收确认边界会变，需协议/OpenAPI 兼容评估。

### 方案 C：Redis/BullMQ 优先（消息代理 + 作业队列）

**数据流**：SDK 批次 → 数据接入服务同步校验 → 写入 Redis Stream/BullMQ 队列 → 返回"已可靠接收" → BullMQ Worker 消费 → 幂等消费 → 写事件事实/存储。
**ACK 边界**：BullMQ 作业确认/Redis Stream 确认即视为已可靠接收。
**持久化位置**：ElastiCache Redis（取决于配置：AOF/持久化；Redis 本质上是内存优先，持久化语义与 PostgreSQL/SQS 不同）。
**故障恢复**：Redis 高可用 + 持久化；故障后由 PostgreSQL Outbox 或权威失败记录重投（备份与恢复文档第 3 节），消费者必须幂等。
**幂等**：事件编号 + 消费者幂等；BullMQ 不提供严格一次。
**顺序**：Redis Stream 按消费者组内分区顺序；BullMQ 不承诺全局顺序。
**重试和死信**：BullMQ 内置重试/退避/死信；Redis Stream 需自建。
**扩容方式**：增加 Worker 实例；Redis 分片/集群；但单 Redis 节点吞吐受内存和 CPU 限制。
**运维复杂度**：中。BullMQ 提供丰富作业语义，但 Redis 需要容量、淘汰、持久化和故障边界管理，且 ElastiCache 按节点计费。
**AWS 成本构成**：ElastiCache 节点内存/计费；成本随缓冲深度和吞吐线性增长；需要为缓冲容量预留内存。
**对本地开发和测试的影响**：本地可用 Redis 容器；BullMQ 语义可在集成测试验证。
**对 OpenAPI、数据模型和 Migration 的影响**：接收确认绑定 Redis 写入成功；但 Redis 持久化边界弱于 PostgreSQL/SQS，若 Redis 数据丢失，已确认事件丢失 → 违背"已接收不得静默丢失"。
**主要风险**：**Redis 持久化边界不满足"已可靠接收后不丢失"的强承诺**（Redis 内存优先，故障窗口内可能丢最近数据）；管理平台 BullMQ 已批准用于平台任务，若再用于事件缓冲，会扩大 BullMQ 职责并混淆故障域；单节点吞吐上限；需要独立 ElastiCache 实例以避免与 Session/缓存共享故障域。
**退出和迁移路径**：可从 Redis 迁回 PostgreSQL Inbox 或 SQS，但接收确认边界会变，需协议/OpenAPI 兼容评估。

### 方案比较矩阵

| 维度                     | A：PostgreSQL Inbox               | B：AWS 托管队列（SQS/Kinesis）        | C：Redis/BullMQ              |
| ------------------------ | --------------------------------- | ------------------------------------- | ---------------------------- |
| 可靠接收持久化边界       | 强（事务提交即 ACK）              | 生产端 `SendMessage`/`PutRecord` 成功 | 弱（Redis 内存优先）         |
| 已确认事件不丢失         | 满足                              | SQS 标准至少一次/可能重复；FIFO 满足  | 故障窗口可能丢最近数据       |
| 顺序承诺                 | 不承诺处理顺序；仅追踪/诊断用主键 | FIFO 群组保序；标准无序               | Stream 分区内保序            |
| 幂等实现                 | 唯一约束 + 消费者幂等             | 消费者幂等 + FIFO 可选                | 消费者幂等                   |
| 重试/死信                | 租约 + 计数 + 死信表              | SQS DLQ；Kinesis 自建                 | BullMQ 内置                  |
| 运维复杂度               | 中低（复用 RDS/Worker）           | 低（SQS）；中（Kinesis）              | 中（Redis 容量/持久化）      |
| 本地开发/测试            | PostgreSQL 容器                   | localstack/真实集成                   | Redis 容器                   |
| AWS 成本构成             | RDS 实例/存储/PITR                | SQS 请求量；Kinesis 分片小时          | ElastiCache 节点内存         |
| 对接收路径的瓶颈         | RDS 写入吞吐                      | 队列写入吞吐                          | Redis 写入吞吐               |
| 与现有平台 Outbox 一致性 | 复用同一 PostgreSQL，职责清晰     | 独立服务，与平台 Outbox 无关          | 复用 BullMQ 有职责扩大风险   |
| 迁移路径                 | 可平滑升级到 SQS/Kinesis          | 可迁回 Inbox/换队列，需兼容评估       | 可迁回 Inbox/SQS，需兼容评估 |

## 推荐方案

**推荐方案 A：PostgreSQL 事务性 Inbox。**

核心理由：

1. **可靠接收语义最严格**：ACK 与 PostgreSQL 事务提交严格绑定，进程终止、实例重启或 AZ 故障都不会丢失已确认事件，直接满足"已可靠接收后不得静默丢失"和 RPO≤5 分钟/RTO≤60 分钟目标；
2. **符合第一版规模与运维能力**：复用已计划部署的 RDS PostgreSQL Multi-AZ 与 `platform-worker`，不新增 AWS 托管队列服务，运维负担最小，适合独立开发者/小团队；
3. **不扩大 BullMQ 职责**：避免把已批准用于管理平台任务队列的 Redis/BullMQ 扩大到事件缓冲，保持故障域、凭据和淘汰策略隔离（部署架构、备份恢复、ADR-004 均要求）；
4. **为后续契约提供干净边界**：数据接入 OpenAPI 的逐事件结果、批次 Schema、稳定错误码都可绑定 Inbox 写入结果设计；"已可靠接收"在协议层有唯一权威语义；
5. **迁移路径清晰**：Inbox 采用独立租约模型，后续事件量增长时可平滑升级到 SQS/Kinesis 消费者而不改变接收语义、OpenAPI 或批次协议；
6. **成本可控**：低吞吐阶段无单独队列成本，RDS 已存在。

方案 B 在事件量极高或需要强顺序时是更优选择，但第一版无容量证据，引入托管队列增加运维面且"已接收"边界依赖队列生产端写入成功语义。方案 C 的 Redis 持久化边界不满足"已确认事件不丢失"的强承诺，且扩大 BullMQ 职责，不采用。

**批准**：方案 A 已由用户于 2026-08-01 批准（`decision-status: accepted`），批准以本消息规定的六项校正为准；方案 B 保留为未来容量升级候选，不改变本轮方案 A 的最终选择。

## 推荐方案数据流（精确）

```text
SDK 上报批次
→ 数据接入服务（同步路径）
    1. 鉴权：客户端上报密钥、项目、来源、运行环境、项目生命周期
    2. 限制：请求/事件大小、批次数量、字符串/数组/对象深度、时间戳、协议版本、禁止字段
    3. 协议 Schema 校验（event-schema 唯一来源）
    4. 服务端隐私过滤
    5. 去重窗口检查（租户作用域幂等键）
    6. 限流（PRD 15.3 阈值）；当前接收路径不实施采样
    7. 在一个 RDS PostgreSQL 事务中批量写入 event_inbox（唯一约束 + 幂等键 + 状态 + 租约 + 重试计数）
       → 事务提交成功
→ 返回请求级 + 逐事件结果（已接收 / 拒绝 + 稳定错误码）
→ platform-worker / ingestion-worker（异步路径）
    1. 以租约轮询/分批拉取待处理事件
    2. 幂等消费：写事件事实/聚合/存储，更新 Inbox 状态或删除/归档
    3. 重试、退避、死信、人工重放
```

**采样说明**：当前接收路径不实施采样。采样算法、采样配置和执行位置仍是独立 blocked 决策；本 ADR 可以为未来采样保留扩展点，但不得改变 ACK 边界（"已可靠接收"仍唯一等于 Inbox 事务提交成功）。

**ACK 边界**：`event_inbox` 事务提交成功 = "已可靠接收"。任何返回该结果的路径都保证事件已持久化到 PostgreSQL Multi-AZ。
**持久化边界**：`event_inbox` 表（RDS PostgreSQL Multi-AZ），受 PITR 与 35 天备份保护。
**普通缓存/Session Redis 不得作为可靠接收边界**：它们只存可重建投影，不进入业务 RPO（部署架构、备份恢复约束）。

## 可靠接收语义

- "已可靠接收" = 事件已写入 `event_inbox` 且事务已提交，不表示问题已生成或指标可查询；
- 事件写入 Inbox 后，即使接入服务进程终止、实例重启或单 AZ 故障，已确认事件按 Multi-AZ 设计恢复并继续可被异步处理（不宣称绝对零丢失）；
- SDK 永久拒绝（密钥无效、来源不允许、格式错误、超限、命中隐私）不重试；暂时失败（系统不可用、限流带等待时间）使用有上限退避；
- 一批内允许部分成功、部分永久拒绝、部分暂时失败；单条失败不整批回滚；
- 已确认事件不得静默丢弃（ADR-004 实施约束）；
- **批次部分成功的事务约束**：所有事件先独立完成同步校验；合法事件才进入 Inbox 写入集合；重复事件使用 `ON CONFLICT`、预查询、保存点或其他不会使整批事务回滚的等价机制；单条重复、永久拒绝或暂时失败不能回滚其他已成功持久化事件；精确 SQL 设计留给数据模型规格。

## 幂等、重试、死信和重放

- **幂等键**：`(project_id, event_id)` 或正式文档中等价的租户作用域幂等键作为唯一范围；不使用全局裸 `event_id` 唯一作为最终承诺；精确列名仍由后续数据模型规格冻结；
- **重试**：消费者失败按上限重试（次数、退避、资源上限），配置为 `implementation-detail`/`requires-benchmark`；
- **死信**：重试达上限进入死信状态/`event_dead_letter`，可人工重放；死信保留期限和查看方式为 `implementation-detail`；
- **重放**：Inbox 状态支持从任意记录点重放；A5 注销重放语义以账号注销文档为准；恢复演练按备份恢复第 5 节重放注销事实。

## 背压和容量行为

- 接收路径在同步校验后写入 Inbox；Inbox 积压（最老年龄、数量、处理水位）作为容量信号；
- 限流按组织、项目、客户端上报密钥、来源地址执行（PRD 15.3）；
- 接近额度/限流上限时按 PRD 15.4 降级：优先保留新问题、再次出现、高严重级别样本；
- Worker 基于服务延迟、并发、CPU/内存和队列年龄扩缩容；禁止只以 CPU 作为积压唯一信号（TDR §9.3）；
- 容量耗尽时接收路径按 PRD 拒绝结果返回（"已接收"/拒绝结果与额度状态映射），不无限接受。

## 故障模型

| 故障场景                    | 行为                                                                      |
| --------------------------- | ------------------------------------------------------------------------- |
| 单实例（接入/Worker）故障   | 未提交事务回滚；已提交 Inbox 事件由其他 Worker 租约拉取；接入无状态可重启 |
| 进程终止                    | 已确认事件按 Multi-AZ 设计恢复，不被应用主动或静默丢弃                    |
| PostgreSQL 主节点故障       | Multi-AZ 自动故障转移；RPO≤5 分钟/RTO≤60 分钟；PITR 恢复                  |
| AZ 故障                     | Multi-AZ 冗余恢复；已确认事件按 RPO≤5 分钟目标恢复，不宣称绝对零丢失      |
| 区域故障                    | 跨区域备份重建；受 approved 区域级 RPO≤24 小时/RTO≤8 小时约束             |
| 普通缓存/Session Redis 故障 | 缓存可清空重建；Session 可要求重登；均不得作为已接收边界                  |

**持久性语言**：已确认事件不得被应用主动或静默丢弃；单实例、进程和单 AZ 故障按 Multi-AZ 设计恢复；区域灾难恢复仍受 approved 区域级 `RPO ≤ 24 小时`、`RTO ≤ 8 小时` 约束；本 ADR 不得声称任何灾难场景绝对零数据丢失。

## 安全和数据生命周期

- `event_inbox` 事件正文按事件类型允许列表，禁止字段（凭据、Cookie、Authorization、请求/响应体、表单、DOM、IP）不进入；
- Inbox 表访问受最小 IAM 角色与私网约束；事件正文不进入日志、审计或普通缓存；
- 事件保留/清理遵循 A5 与 PRD 数据生命周期；Inbox 事件在处理后删除/归档，不在 Inbox 无限保留；
- 加密：RDS 加密、备份加密、传输 TLS；精确 KMS 与密钥托管为 `requires-accepted-adr`。

## 部署、Migration 和回滚

- `event_inbox` 表 Migration 使用全局互斥/版本前置，重复运行幂等或安全失败（TDR §10）；
- 部署先预发布运行 E2E、Migration、回滚/恢复烟雾；生产只部署已验证的同一不可变制品；
- 回滚：暂停消费者、保留 Inbox 数据，回滚 Worker 版本后继续处理；不通过返回成功后丢弃数据来降级（ADR-004 回滚方案）；
- Migration 失败立即停止后续部署，保留错误证据并恢复。

## 容量模型

当前没有真实容量证据。以下为**假设区间**（非实测结果），全部标记 `requires-benchmark`，实施前必须在目标区域建立合成但可复现的容量模型。

| 变量             | 保守假设（第一版）                           | 来源/说明                                           |
| ---------------- | -------------------------------------------- | --------------------------------------------------- |
| 每秒事件数量     | 平均 10–100，峰值 200–1000                   | 假设：小团队/独立开发者规模；requires-benchmark     |
| 平均事件大小     | 0.5–2 KB（JSON 信封 + 正文）                 | 假设：错误/请求/性能事件；requires-benchmark        |
| P95/P99 事件大小 | 4–16 KB                                      | 假设：含 Source Map 栈帧/上下文；requires-benchmark |
| 批次大小         | 1–50 事件/请求                               | 假设；六专题未锁定数值                              |
| 峰值倍数         | 平均的 5–20 倍                               | 假设；夜间/发版窗口                                 |
| 平均处理延迟     | 60 秒内 95%、5 分钟内 99% 可查询             | approved SLO 目标                                   |
| 缓冲保留时间     | 正常 5 分钟内消费；积压时最长数小时          | 假设；取决于 Worker 容量                            |
| 重试放大系数     | 1.1–1.5（有界退避）                          | 假设；requires-benchmark                            |
| 单租户和全局限额 | 项目/组织/来源限流阈值（PRD 15.3）           | 假设；implementation-detail                         |
| 数据增长量       | 每日 5–50 GB Inbox 写入（取决于事件率/大小） | 假设；requires-benchmark                            |
| 网络和存储成本   | RDS 存储/IOPS/PITR；按实际基准               | 假设；requires-benchmark                            |

所有上表变量在目标区域完成合成负载、故障和成本基准前，不得作为对外容量承诺。

## 验证和 benchmark 计划

本轮只设计验证计划，不创建 benchmark 实现。

1. **本地功能验证**：接入服务 + 真实 PostgreSQL 容器 + Worker 的端到端：鉴权、校验、Inbox 写入、逐事件结果、消费、状态更新；
2. **故障注入**：进程终止（各阶段）、实例重启、PostgreSQL 主节点故障转移、租约到期重投，验证"只有 Inbox 提交后才确认接收"和已确认事件不丢失；
3. **压力测试**：事件速率/批次大小/并发梯度下量化接收延迟、吞吐、Inbox 积压、水位、限流公平性和降级；
4. **重复投递验证**：同事件编号重复投递被唯一约束拒绝；消费者重复消费幂等；
5. **重放验证**：从任意 Inbox 记录点重放，验证问题聚合/指标/告警/删除事实不重复；
6. **AZ 故障验证**：Multi-AZ 故障转移下已确认事件可继续处理，RPO/RTO 达标；
7. **容量和成本验证**：合成负载模型量化 RDS 实例/存储/IOPS/PITR 成本、Worker 扩容曲线和积压年龄；
8. **恢复演练**：PostgreSQL PITR 恢复 + Inbox 重放 + 注销事实重放，验证 RPO/RTO 与业务不变量；
9. **进入生产前的通过门槛**：上述验证通过、SLO 目标可复现、容量假设有实测支撑、死信/重放/删除 Runbook 存在、Migration 回滚演练通过；否则不声称可部署。

## 结果与影响

### 正面影响

- 可靠接收语义最严格，ACK 与事务提交绑定；
- 复用已批准 RDS PostgreSQL 与 Worker，运维和成本最低；
- 不扩大 BullMQ 职责，故障域清晰；
- 为数据接入 OpenAPI、批次协议和容量模型提供干净边界；
- 可平滑迁移到托管队列。

### 负面影响与代价

- RDS 写入成为接收路径潜在瓶颈，高吞吐需分区/升级；
- Inbox 表需要 Migration、索引维护和积压监控；
- 轮询消费延迟需要满足 95%/60s 目标；
- 单库可能成为处理吞吐上限。

### 未解决问题

- Inbox 表精确 Schema、分区键和索引设计（实施规格）；
- 轮询 vs 批量拉取的精确并发与批量大小；
- 死信保留期限和人工重放 UI；
- 精确重试/退避/租约数值；
- 是否独立 `ingestion-worker` 或复用 `platform-worker` 部署单元。

## 实施约束

- 接收成功前必须完成必要鉴权、限制、运行时校验和 Inbox 可靠写入（ADR-004）；
- 返回成功不等待 Source Map、分组、聚合和告警；
- 同一 `(project_id, event_id)` 或等价租户作用域幂等键重复消费结果幂等；
- 一批单条失败不导致整批回滚；
- 失败重试次数和退避有上限；
- 无法处理事件进入失败记录或死信；
- 队列/Inbox 积压、处理延迟和失败率可监控；
- SDK 不重试永久拒绝；
- 普通缓存、Session Redis 和平台 BullMQ 不得作为事件可靠缓冲；
- 事件正文不进入日志、审计或普通缓存。

## 迁移方案

ADR accepted 后，先定义接收结果、事件状态和幂等编号，再建立 `event_inbox` Migration，实现接入写入、消费者、失败记录和监控，最后连接存储、问题聚合和告警。接入成功测试必须覆盖从可靠接收到问题生成。

## 回滚方案

如果异步处理上线失败，可暂停消费者并保留 Inbox 数据，回滚消费者版本后继续处理。不得通过返回成功后丢弃数据来降级。若决定回到同步模型，必须创建新 ADR 并重新定义 SDK 和接入语义。

## 验证方式

- 接收成功后强制重启进程，事件仍可处理；
- 重复投递不重复创建事件、问题计数或告警；
- Source Map 和聚合延迟不增加接入响应时间；
- 消费失败按上限重试并进入失败记录；
- Inbox 积压和处理延迟有监控；
- 接入页面正确区分已接收、处理中、成功和失败；
- 端到端测试证明测试问题最终生成。

## 重新评估条件

- 处理延迟长期超过产品可接受范围；
- 缓冲成本或运维复杂度显著超过收益；
- 事件规模需要分区、顺序或流处理能力；
- 数据法规要求改变持久化边界；
- 现有可靠缓冲停止维护或无法扩展；
- 真实容量基准显示 PostgreSQL Inbox 无法满足 SLO 或成本目标。

## Consequences

- **对数据接入 OpenAPI**：逐事件结果、"已接收"边界、稳定错误码将绑定 Inbox 写入结果；
- **对批次协议**：批次 Schema 可引用 Inbox 写入的逐事件结果；
- **对处理系统**：消费者从 Inbox 拉取，幂等消费写事件事实；
- **对管理平台**：平台 Query/Command 使用处理系统公开接口，不直接读 Inbox；
- **对备份/恢复**：Inbox 纳入 RDS PITR 与 35 天备份；恢复重放覆盖 Inbox 与注销事实；
- **对部署**：`event_inbox` Migration 进入发布清单；Worker 部署单元复用或新增。

## Risks

- **RDS 写入瓶颈**：高吞吐下 Inbox 写入成为接收路径瓶颈；缓解：分区、批量写入、预留容量基准；
- **Inbox 表增长**：未处理事件积压导致表膨胀；缓解：积压监控、死信、分区归档；
- **轮询延迟**：影响 95%/60s 目标；缓解：批量拉取、短轮询周期、基准验证；
- **单库吞吐上限**：处理吞吐受单 PostgreSQL 限制；缓解：后续升级到 SQS/Kinesis（迁移路径已定义）。

## Deferred decisions

- 精确 Inbox Schema、分区键、索引和 Migration（实施规格）；
- 轮询/批量拉取并发、批量大小、租约、退避数值；
- 死信保留期限、人工重放 UI 和权限；
- 是否独立 `ingestion-worker` 部署单元；
- 精确容量/成本基准结果；
- 客户端上报密钥物理格式、来源匹配规范、环境标识（独立决策）。

## Follow-up dependency chain

本 ADR accepted 后，以下决策按顺序推进（均等待各自 approved 规格/ADR，不自动开始）：

1. **`event-schema` 数据接入批次与接收结果协议**——ADR-005 要求 `event-schema` 是公共协议单一来源；本增量定义批次请求、请求级/逐事件接收结果、稳定状态枚举和稳定错误码；
2. **数据接入 OpenAPI**——必须引用或映射已经批准的批次与接收结果协议；OpenAPI 不得成为第二套批次 Schema 权威来源；
3. **Inbox 数据模型、状态机和 Migration**——精确列名、分区键、索引和 `ON CONFLICT` 策略由数据模型规格冻结；
4. **数据接入服务同步接收路径**——鉴权、限制、校验、隐私过滤、去重、Inbox 写入和逐事件结果返回；
5. **Worker 租约消费、重试、死信和重放**——精确并发、批量大小、退避数值由实施基准锁定；
6. **容量、故障与成本 benchmark**——requires-benchmark；
7. **客户端上报密钥安全决策**——独立安全决策（C14）。

## Approval record

**用户批准（2026-08-01）**：用户批准 ADR-008 的推荐方案 A（PostgreSQL 事务性 Inbox），`decision-status: accepted`、`implementation-status: not-started`、`approval-status: approved`。

批准以以下六项校正为准：

1. 接收路径当前不实施采样；采样算法、配置和执行位置仍是独立 blocked 决策，仅保留未来扩展点且不改变 ACK 边界；
2. 幂等唯一范围为 `(project_id, event_id)` 或等价租户作用域幂等键，不使用全局裸 `event_id` 唯一作为最终承诺；
3. 批次部分成功使用 `ON CONFLICT`、预查询、保存点或其他不使整批事务回滚的机制，单条重复/永久拒绝/暂时失败不回滚其他已持久化事件；
4. 第一版不承诺跨事件、批次内或租户内处理顺序；
5. 持久性表述按 Multi-AZ 恢复与 approved 区域级 RPO≤24 小时/RTO≤8 小时约束，不宣称任何灾难场景绝对零丢失；
6. 候选方案 B 的 SQS/Kinesis 生产端 ACK 为 `SendMessage`/`PutRecord` 成功，可见性超时/删除/检查点属于消费端机制；方案 B 保留为未来容量升级候选。

本次批准**不代表**数据库、Migration、OpenAPI、服务、Worker 或 AWS 资源已经实现。

## 追加记录

本 ADR 的评审、状态、实施和替代变化只能追加在本节之后。

### 2026-08-01：用户批准与六项校正

- 决策状态更新为 `accepted`，实施状态保持 `not-started`，审批状态 `approved`；
- 用户批准推荐方案 A（PostgreSQL 事务性 Inbox），批准以六项校正为准：采样不进入接收路径、幂等范围租户化、批次部分成功不回滚整批、不承诺处理顺序、持久性按 Multi-AZ 与区域 RPO/RTO 表述、方案 B 生产端 ACK 语义修正；
- 批准不代表数据库、Migration、OpenAPI、服务、Worker 或 AWS 资源已经实现。

### 2026-08-01：批次与接收结果协议实施证据（后续依赖链第 1 项）

- 决策状态保持 `accepted`，实施状态保持 `not-started`；
- 后续依赖链第 1 项 [`event-schema` 数据接入批次与接收结果协议](../protocol/ingestion-batch-and-receipt-contract.md) 已实施为 `@aurora/event-schema` 的真实协议增量：批次请求正文、请求级/逐事件接收结果、稳定状态枚举（`accepted`/`duplicate_accepted`/`permanently_rejected`/`temporarily_failed`）、稳定错误码与三个解析器；
- "已可靠接收"严格对应本 ADR 的 `event_inbox` 事务提交成功；协议层不实现 Inbox 写入、数据库、OpenAPI、采样、限流、队列或 Worker；
- 验证命令：`pnpm --filter @aurora/event-schema typecheck/test/test:coverage/test:package`、`pnpm check:boundaries`、`pnpm check:ci`，全部 exit 0；
- 实施 Commit：none（如本轮产生真实 Commit，则只把该真实哈希写入本行）；
- Issue/PR：none

### 2026-08-01：数据接入 OpenAPI 机器契约实施证据（后续依赖链第 2 项）

- 决策状态保持 `accepted`，实施状态保持 `not-started`（Inbox、接入服务与 Worker 仍未实施）；
- 后续依赖链第 2 项[数据接入 OpenAPI 机器契约第一增量](../api/ingestion-openapi.md)已实施：`docs/api/ingestion.openapi.yaml`（OpenAPI 3.1.0，`POST /v1/batches` + `ClientIngestionKey` security scheme + 完整 HTTP 状态映射 + `Retry-After`/`X-Aurora-Request-Id`）与 `tooling/ingestion-openapi-contract` 漂移门禁（40 个测试自动比对 `@aurora/event-schema` 枚举/required/限制/样本/`retryable`/`retryAfterMs`/安全）；前置决策由 accepted ADR-009 批准；
- "已可靠接收"仍严格对应本 ADR 的 `event_inbox` 事务提交成功；OpenAPI 层不实现 Inbox 写入、数据库、Migration、采样、限流、队列或 Worker；HTTP 层 `accepted`/`duplicate_accepted` 不表示问题已生成或指标可查询；
- 验证命令：`pnpm openapi:lint`、`pnpm --filter @aurora/ingestion-openapi-contract test/typecheck/build`、`pnpm check:boundaries`、`pnpm lint`，全部 exit 0；
- 实施 Commit：none（如本轮产生真实 Commit，则只把该真实哈希写入本行）；
- Issue/PR：none

### 2026-08-01：Inbox 数据模型与原子持久化边界实施证据（后续依赖链第 3 项）

- 决策状态保持 `accepted`，实施状态更新为 `in-progress`：`event_inbox` 数据模型、Migration 与原子持久化 Repository 已实施并通过真实 PostgreSQL 17.10 验证；接入服务与 Worker 仍未实施，故不进入 `implemented`；
- 后续依赖链第 3 项[Inbox 数据模型正式规格](../architecture/ingestion-inbox-data-model.md)已实施为 `@aurora/ingestion-inbox`：`event_inbox` 表（`(project_id, event_id)` 唯一 + 状态/attempt_count check + 最小索引）、`persistBatch`（事务内 `ON CONFLICT DO NOTHING`，区分 `inserted`/`duplicate`）、状态/租约查询 helper、`node-pg-migrate` 显式执行入口；
- "已可靠接收"严格对应本 ADR 的 `event_inbox` 事务提交成功：`persistBatch` 仅当事务 COMMIT 成功才返回 `inserted`；回滚/连接中断不产生 accepted 记录；
- 数据库工具链由 accepted ADR-010 批准（PostgreSQL 17 + `pg` + `node-pg-migrate` + SQL-first）；实际版本 `pg` 8.22.0、`node-pg-migrate` 9.0.0、`@types/pg` 8.20.0；
- 真实 PostgreSQL 验证：本地 PostgreSQL 17.10 专用测试库；21 个集成测试（空库 Migration、版本检测、down/up、幂等、部分成功、事务回滚、EventEnvelope 保存、状态/租约约束、Schema 隔离）；
- 验证命令：`pnpm --filter @aurora/ingestion-inbox test/test:integration/typecheck/lint/build`、`pnpm check:boundaries` 全部 exit 0；
- 实施 Commit：none（未提交）；
- Issue/PR：none；
- 未实现：接入服务同步路径（第 4 项）、Worker 租约消费（第 5 项）、容量/成本基准（第 6 项）、凭证数据模型（第 7 项）。

### 2026-08-01：Inbox 处理侧 Repository、租约与状态转换第一增量实施证据（Worker 波次第 1 个独立增量）

- 决策状态保持 `accepted`，实施状态保持 `in-progress`；处理侧 Repository 第一增量已实施并通过真实 PostgreSQL 17.10 并发/租约/状态转换集成测试；Worker 应用仍未实施；
- 实施内容：`@aurora/ingestion-inbox` 处理侧能力——`lease_id` fencing 增量 Migration（UUID + `ck_event_inbox_lease_consistency` 约束）、原子领取 `claimAvailable`（`FOR UPDATE SKIP LOCKED`）、`renewLease`、`markProcessed`、`scheduleRetry`、`markDeadLettered`；`IngestionInboxProcessingRepository` 接口与稳定结果（`success`/`lease_lost`/`not_found`、`claimed`/`nothingToClaim`）；状态集合不变（pending/leased/retry_waiting/processed/dead_lettered）；
- 租约时长、领取批量、重试次数、退避数值均保持 `requires-benchmark`，由未来 Worker policy 决定，本模块不固定；
- 真实 PostgreSQL 验证：17 个处理侧集成测试（5 Migration + 6 claim 并发/SKIP LOCKED/租约重领 + 6 fencing/状态转换），覆盖并发 Worker 不重叠领取、lease fencing（旧 lease 无法写回）、续租不递增 attempt_count、processed/retry/dead-letter 清理 lease、事务回滚无 leased 残留、EventEnvelope 不变、跨项目隔离；
- 验证命令：`pnpm --filter @aurora/ingestion-inbox test/test:integration/typecheck/lint/build`、`pnpm check:boundaries` 全部 exit 0；
- 实施 Commit：none（未提交）；
- Issue/PR：none；
- 未实现：Worker 应用（第 5 项）、容量/成本基准（第 6 项）、凭证数据模型（第 7 项）。
