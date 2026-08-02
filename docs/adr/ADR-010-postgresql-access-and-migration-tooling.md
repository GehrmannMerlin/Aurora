---
title: ADR-010：数据接入数据库访问与 Migration 工具链
status: accepted
implementation-status: implemented
approval-status: approved
owner: ingestion/data
date: 2026-08-01
last-reviewed: 2026-08-01
applies-to: event_inbox 数据模型的数据库访问方式、Migration 工具、PostgreSQL 主版本、SQL-first 边界、数据库包位置与真实 PostgreSQL 测试方式
related:
  - ../../AURORA_RULES.md
  - '../../Aurora ADR 规范.md'
  - ../../docs/architecture/platform-backend.md
  - ../../docs/architecture/deployment.md
  - ../../docs/architecture/formalization-readiness.md
  - ../../docs/operations/backup-and-recovery.md
  - ../../docs/releases/release-migration-and-rollback.md
  - ../../docs/adr/ADR-004-asynchronous-event-processing.md
  - ../../docs/adr/ADR-005-event-schema-source-of-truth.md
  - ../../docs/adr/ADR-008-ingestion-durable-buffering.md
  - ../../docs/adr/ADR-009-ingestion-transport-and-client-credential.md
  - ../../docs/protocol/ingestion-batch-and-receipt-contract.md
supersedes: none
superseded-by: none
---

# ADR-010：数据接入数据库访问与 Migration 工具链

## 元数据

- 状态：accepted
- 决策状态：accepted
- 实施状态：implemented
- 审批状态：approved
- 日期：2026-08-01
- Owner：ingestion/data
- 适用范围：`event_inbox` 数据模型的数据库访问方式、Migration 工具、PostgreSQL 主版本、SQL-first 边界、数据库包位置、Migration 目录/命名规则、测试数据库启动与 CI 真实 PostgreSQL 测试方式
- 关联 PRD：[核心业务 PRD](../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md) 第 7 章
- 关联 ADR：[ADR-008](../ADR-008-ingestion-durable-buffering.md)（数据接入可靠缓冲 = PostgreSQL 事务性 Inbox）、[ADR-009](../ADR-009-ingestion-transport-and-client-credential.md)（数据接入公开传输与客户端凭证）
- 关联 Issue：none
- 关联实现 PR：none
- 替代 ADR：none
- 被替代 ADR：none

## 状态说明

本 ADR 于 2026-08-01 由用户批准（`decision-status: accepted`、`approval-status: approved`），实施状态保持 `not-started`。批准授权数据接入数据库访问与 Migration 工具链的最终决定；批准不代表 Inbox Schema、Migration、Repository、接入服务、Worker、RDS 或 CI 已经实现。

## 背景

Aurora 已接受 ADR-004（可靠接收与异步处理）、ADR-005（event-schema 单一来源）、ADR-008（数据接入可靠缓冲 = PostgreSQL 事务性 Inbox）和 ADR-009（数据接入公开传输与客户端凭证）。数据接入批次/接收结果协议与 OpenAPI 机器契约已实施。ADR-008 后续依赖链第 3 项是 "Inbox 数据模型、状态机和 Migration——精确列名、分区键、索引和 `ON CONFLICT` 策略由数据模型规格冻结"。

本 ADR 冻结 `event_inbox` 数据模型与 Migration 的数据库工具链。此前该工具链存在缺失：ADR-008 只决定物理技术是 PostgreSQL 事务性 Inbox，未指定数据库访问库、Migration 工具或 PostgreSQL 主版本；release-migration 规范要求数据库 ADR accepted 前不能创建权威脚本。本 ADR 于 2026-08-01 由用户直接审批批准，解除该阻塞。

## 决策驱动因素

- **可靠接收 ACK 边界**：Inbox 事务提交 = "已可靠接收"（ADR-008），数据库访问层必须能表达事务提交边界；
- **幂等**：`(project_id, event_id)` 唯一范围，需要 `ON CONFLICT` 或等价机制；
- **并发领取**：Worker 后续需要 `FOR UPDATE SKIP LOCKED` 或等价租约语义（结构字段本轮实施，领取逻辑后续）；
- **类型安全 vs 原生能力**：SQL-first 提供最直接的原生 PostgreSQL 表达（JSONB、`ON CONFLICT`、`FOR UPDATE SKIP LOCKED`、事务边界）；
- **Migration 治理**：发布/迁移规范要求确定性、版本稳定、可审计、可回滚验证；
- **真实 PostgreSQL 测试**：约束必须用真实 PostgreSQL 验证，不能 mock 冒充；
- **不引入未经批准生产数据库技术栈**：本轮只冻结工具链决策，不实施。

## 现有约束

- ADR-008：`event_inbox` 表、`(project_id, event_id)` 幂等键、批次部分成功不整批回滚、不承诺处理顺序、ACK 绑定事务提交；
- ADR-005：event-schema 是事件 Schema 唯一来源；数据库层不重定义事件 Schema；
- ADR-009：不存客户端密钥/敏感 Header；SQL 参数化；不输出 SQL/正文/凭证到日志；
- release-migration 规范：Migration 确定性、版本稳定、可审计；
- 部署架构：RDS PostgreSQL Multi-AZ、PITR、35 天备份；
- platform-backend 设计：管理平台域 Kysely 方向独立，不自动适用于数据接入域。

## 最终决策

### 4.1 PostgreSQL 基线

- 第一版数据库兼容基线为 **PostgreSQL 17**；
- 本地和 CI 验证必须运行 PostgreSQL 17.x；
- 生产 RDS 使用 AWS 当时可用的受支持 PostgreSQL 17 小版本；
- 不在应用代码中依赖某个特定 17.x patch 才存在的非必要行为；
- PostgreSQL 18 升级属于未来独立兼容与 Migration 验证；
- 本 ADR 不创建 RDS 或 IaC。

### 4.2 数据库访问

- 正式选择 **`pg`（node-postgres）**；
- **SQL-first**；
- 不引入 Kysely、Prisma、Drizzle、TypeORM、Sequelize 或通用 ORM；
- 使用 `Pool` 管理连接；
- 事务必须通过从 Pool 获取的同一个 client 显式执行；
- 所有包含不可信数据的 SQL 必须参数化；禁止字符串拼接参数；
- 禁止让 `pg` 类型或错误泄露到公共协议层；
- `pg` 是 `@aurora/ingestion-inbox` 的生产运行时依赖；
- 精确 npm 版本在实施时检查 Node.js v24 兼容性、选择当前稳定版本、固定到 lockfile、不使用 prerelease，并在规格、计划和完成报告中记录实际版本。

### 4.3 Migration

- 正式选择 **`node-pg-migrate`**；
- 作为开发依赖和 Migration 执行工具；
- 使用程序化 API或项目脚本包装，不让业务模块依赖 CLI 输出文本；
- 默认事务 Migration；
- 使用工具提供的 Migration 锁；
- 禁止应用启动时自动执行生产 Migration；Migration 必须由显式命令执行；
- 已发布 Migration 只能追加，不能原地修改；
- 生产回滚优先向前修复和 expand/contract；destructive down 不能作为生产默认回滚方案；
- 精确 npm 版本在实施时选择当前稳定、兼容 Node 24 和 PostgreSQL 17 的版本，固定到 lockfile，不使用 alpha/beta/RC，并记录实际版本；
- 不得自研 Migration 执行器。

### 4.4 包和目录

- Workspace 包目录：`packages/ingestion-inbox`；
- 包名：`@aurora/ingestion-inbox`；
- Migration 目录：`packages/ingestion-inbox/migrations`；
- 包内建议结构：`src/`、`migrations/`、`test/`、`test/integration/`、`README.md`；
- Migration 文件使用稳定时间戳前缀和 `kebab-case` 描述；
- Migration 使用 TypeScript 或工具当前稳定支持、且能被现有构建链确定性执行的格式；具体扩展名由计划阶段根据当前 `node-pg-migrate` 稳定版本冻结；
- 数据库包只负责 Inbox 数据模型和持久化，不作为通用数据库基础框架。

### 4.5 测试数据库

- 集成测试连接变量为 `AURORA_TEST_DATABASE_URL`；
- 变量只用于测试和本地验证；不把凭证写入代码、文档示例、日志或快照；
- 测试必须确认连接目标是测试数据库；测试不得对非测试数据库执行清理；
- 每次测试使用独立数据库、独立 Schema 或唯一命名隔离空间；
- 清理失败必须显式报错；
- 禁止以 SQLite、mock、PGlite 或内存实现替代真实 PostgreSQL 完成证据；
- 本地测试支持：用户提供的 PostgreSQL 17 实例、Docker/Podman PostgreSQL 17 容器、其他明确指向临时 PostgreSQL 17 的连接 URL；但 Docker/Podman 不是应用运行时依赖，也不是本轮必须创建的基础设施；
- CI 最终使用 PostgreSQL 17 service container，并注入 `AURORA_TEST_DATABASE_URL`；本轮只创建可被未来 CI 调用的脚本和测试；除非现有 CI 模块已存在并允许修改，否则不创建完整 CI 工作流。

### 4.6 SQL 校验

- 第一增量不额外引入 SQLFluff 或其他语言生态 SQL linter；
- SQL 质量通过以下门禁保证：所有动态值参数化；SQL 模块集中且单一职责；禁止字符串插值不可信数据；Migration dry-run 或生成 SQL 检查；空库执行全部 Migration；真实 PostgreSQL 解析并执行；Schema、约束和索引断言；事务和回滚集成测试；Workspace Policy/ESLint 检查危险数据库模式；代码评审可读性要求；
- 如后续 SQL 规模显著增加，再独立评估 SQL 静态工具。

## 候选方案（已评审）

### 方案 A：SQL-first + 轻量 PostgreSQL client（已选定）

- 访问：`pg`（node-postgres），SQL 参数化手写；
- Migration：`node-pg-migrate`；
- Migration 是数据库结构权威变更记录，应用启动不隐式改表；
- 优点：原生 PostgreSQL 能力最直接（`ON CONFLICT`、`FOR UPDATE SKIP LOCKED`、JSONB、事务边界完全掌控）；依赖体积最小；无隐式类型映射层；
- 缺点：手写 SQL 无编译期类型安全；行映射需手动收窄；SQL 风格需代码评审保证。

### 方案 B：类型安全 Query Builder（被拒绝）

- 访问：Kysely（平台域候选方向）；Migration：`node-pg-migrate` 或 `kysely-ctl`；
- 被拒绝理由：JSONB/`ON CONFLICT`/`FOR UPDATE SKIP LOCKED` 需要类型化 helper 或原生 SQL 回退；引入类型生成与运行时依赖；管理平台域选择不自动适用数据接入域；对本模块的幂等/租约/JSONB 核心需求收益有限。

### 方案 C：完整 ORM（被拒绝）

- 访问：Prisma 或 Drizzle；
- 被拒绝理由：`ON CONFLICT`/`FOR UPDATE SKIP LOCKED` 支持受限；生成模型与事件协议 Schema 存在双来源风险；依赖体积大；与 ADR-005 "数据库不得反向成为事件协议权威" 治理边界需额外防护。

### 候选比较

| 维度                   | A：SQL-first + 轻量 client | B：Kysely Query Builder      | C：Prisma/Drizzle ORM        |
| ---------------------- | -------------------------- | ---------------------------- | ---------------------------- |
| Migration              | node-pg-migrate            | node-pg-migrate / kysely-ctl | Prisma migrate / drizzle-kit |
| 类型安全               | 手动收窄                   | 编译期类型化                 | 自动生成                     |
| 原生 PostgreSQL        | 最直接                     | helper/原生回退              | 受限                         |
| ON CONFLICT            | 原生                       | 类型化/回退                  | 受限                         |
| FOR UPDATE SKIP LOCKED | 原生                       | helper/回退                  | 受限                         |
| JSONB                  | 原生                       | 类型化                       | 受限                         |
| 事务边界               | 显式                       | 显式                         | 隐式/显式                    |
| 测试（真实 PG）        | 直接                       | 直接                         | 需测试客户端                 |
| 构建/依赖体积          | 最小                       | 中                           | 大                           |
| 可维护性               | 高（少抽象）               | 高                           | 中（生成物管理）             |
| 退出/迁移路径          | 易换 client                | 需类型层迁移                 | 生成层重写                   |

## 推荐方案（最终决定）

**最终选择方案 A：PostgreSQL 17 + `pg`（node-postgres）+ `node-pg-migrate` + SQL-first。**

核心理由：

1. **Inbox 是单一租约模型 + 幂等唯一约束**，`ON CONFLICT`、`FOR UPDATE SKIP LOCKED`、JSONB 和事务边界是核心需求，SQL-first 提供最直接、最可控的原生表达；
2. **ACK 边界必须精确绑定事务提交**，手写 SQL 的事务边界最清楚，无 ORM 隐式提交陷阱；
3. **依赖体积与运维复杂度最小**，符合第一版小团队/独立开发者规模；
4. **不引入事件协议双来源**：数据库层只做行映射，不生成事件 Schema，符合 ADR-005；
5. **退出路径清晰**：轻量 client 可平滑换 Kysely 或其他查询层而不改 Migration。

管理平台域若后续单独 accepted Kysely，不影响本决策；两域数据库工具可以不同，因为数据接入 Inbox 与平台 Outbox 故障域、职责和迁移面分离。

## 结果与影响

### 正面影响

- Inbox 数据模型与 Migration 获得确定工具链前置；
- 原生 PostgreSQL 能力（幂等、租约、JSONB、事务）最直接；
- 依赖体积最小，运维负担低；
- 不引入事件协议双来源。

### 负面影响与代价

- 手写 SQL 需人工代码评审与静态检查；
- 行映射需手动类型收窄；
- 测试需本地/CI 真实 PostgreSQL 17 环境。

### 未解决问题

- 精确 `pg` 与 `node-pg-migrate` npm 版本（实施时验证并固定到 lockfile）；
- Migration 文件扩展名（计划阶段根据当前 `node-pg-migrate` 稳定版本冻结）；
- 测试数据库启动方式在当前环境（Docker daemon 当前不可达；`AURORA_TEST_DATABASE_URL` 当前未设置）。

## 实施约束

- 数据库 ADR 已 accepted，可以创建权威 Migration 脚本；
- Inbox 数据模型规格只能在工具链确定后编写（已确定）；
- `pg` 与 `node-pg-migrate` 精确版本实施时验证并固定；
- 真实 PostgreSQL 17 测试方式必须可用后才能把实现标为 implemented。

## 迁移方案

本 ADR accepted 后：编写 Inbox 数据模型正式规格 → writing-plans → 实施 `event_inbox` Migration 与原子持久化 Repository → 真实 PostgreSQL 17 验证。

## 回滚方案

若工具链在实施中发现缺陷，可在 Migration 发布前更换 client/Migration 执行器（`event_inbox` 表结构不变则成本低）；Migration 发布后遵循向前修复和 expand/contract。

## 验证方式

- 真实 PostgreSQL 17 上运行全部 Migration；
- `(project_id, event_id)` 唯一约束；
- 并发幂等、部分成功、事务回滚测试；
- Schema 版本检测；
- 包入口、私有路径负例、Workspace Policy、SQL 参数化检查。

## 重新评估条件

- 原生 PostgreSQL 能力无法满足时换 Query Builder/ORM；
- 管理平台域 accepted 不同数据库工具且需要共享模式；
- 测试数据库环境长期不可用。

## 追加记录

本 ADR 的评审、状态、实施和替代变化只能追加在本节之后。

### 2026-08-01：创建（proposed）

- 状态 `proposed / not-started / awaiting-user-approval`；
- 由 2026-08-01 数据接入 Inbox 数据模型前置门禁创建；
- 门禁确认数据库访问、Migration 工具、PostgreSQL 主版本、SQL-first/QueryBuilder/ORM 边界、数据库包位置、测试数据库启动、CI 真实 PostgreSQL 测试全部缺失 approved/accepted 来源；
- 直接阻塞依据：`release-migration-and-rollback.md` 第 46 行"数据库 ADR accepted 前不能创建权威脚本"；
- 未调用 writing-plans、未创建数据库包、未创建 Migration、未安装任何数据库工具；
- 等待用户审批，不自动批准、不实施。

### 2026-08-01：用户批准与最终决定

- 决策状态更新为 `accepted`，实施状态保持 `not-started`，审批状态 `approved`；
- 用户批准方案 A，批准内容以用户 2026-08-01 消息的精确决定为准；
- 最终工具链：**PostgreSQL 17 + `pg`（node-postgres）+ `node-pg-migrate` + SQL-first**；
- 决定细节：第一版数据库兼容基线 PostgreSQL 17；`pg` 为 `@aurora/ingestion-inbox` 生产运行时依赖；`node-pg-migrate` 为开发依赖与 Migration 执行工具；包目录 `packages/ingestion-inbox`、包名 `@aurora/ingestion-inbox`、Migration 目录 `migrations/`；集成测试变量 `AURORA_TEST_DATABASE_URL`；未来 CI 使用 PostgreSQL 17 service container；第一增量不引入独立 SQL linter；
- 包、Migration 与测试边界以本消息规定为准；
- 本次批准不代表 Inbox Schema、Migration、Repository、接入服务、Worker、RDS 或 CI 已经实现。

### 2026-08-01：Inbox 数据模型第一增量实施证据

- 实施状态更新为 `implemented`：`@aurora/ingestion-inbox` 包已实施并通过真实 PostgreSQL 17.10 集成测试与全仓质量门禁；
- 实际依赖版本：`pg` 8.22.0（生产）、`node-pg-migrate` 9.0.0、`@types/pg` 8.20.0（开发）；`@types/pg` 采用 8.20.0 因 8.20.2/8.20.3 未满 pnpm `minimumReleaseAge` 24h 门禁；
- 实施内容：`event_inbox` 表 Migration（`(project_id, event_id)` 唯一 + 状态 check + attempt_count check + 最小索引）、`persistBatch` 原子批次持久化（事务内 `ON CONFLICT DO NOTHING`，区分 `inserted`/`duplicate`）、状态/租约查询 helper、`node-pg-migrate` 显式执行入口；
- 真实 PostgreSQL 验证：本地 PostgreSQL 17.10（`aurora_inbox_test` 专用测试库，`aurora_test` 非 superuser 角色）；21 个集成测试覆盖空库 Migration、版本检测、down/up 对称、`(project_id, event_id)` 唯一、跨项目同 eventId、并发/混合批次、事务回滚无 accepted 残留、EventEnvelope JSONB 原样保存、状态/租约约束、Schema 隔离与清理；
- 测试连接：`AURORA_TEST_DATABASE_URL`（仅本地测试，不含仓库文件）；
- 验证命令：`pnpm --filter @aurora/ingestion-inbox test`（18 单测）、`test:integration`（21 集成）、`typecheck`、`lint`、`check:boundaries`、`build` 全部 exit 0；
- 实施 Commit：none（未提交）；
- Issue/PR：none；
- 未实现：Fastify 路由、接入服务、Worker、CI、RDS、IaC。
