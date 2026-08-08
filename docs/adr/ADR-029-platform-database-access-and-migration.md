---
title: ADR-029：管理平台数据库访问与 Migration 工具链
status: accepted
decision-status: accepted
implementation-status: not-started
approval-status: approved
owner: backend/data
date: 2026-08-08
last-reviewed: 2026-08-09
applies-to: 管理平台 platform-api/platform-worker 的 PostgreSQL 物理数据模型、数据库访问层、Migration 工具与 DDL 权威；不改变已 accepted ADR-026 的 Kysely 查询构建层决策
related:
  - ../../AURORA_RULES.md
  - '../../Aurora ADR 规范.md'
  - ../architecture/formalization-readiness.md
  - ./ADR-026-platform-backend-runtime-and-contract-chain.md
  - ./ADR-028-platform-session-csrf-security.md
  - ../superpowers/specs/2026-07-28-aurora-platform-backend-design.md
  - ../superpowers/specs/2026-07-30-aurora-platform-openapi-and-implementation-design.md
  - ../superpowers/specs/2026-07-28-aurora-testing-deployment-release-design.md
supersedes: none
superseded-by: none
---

# ADR-029：管理平台数据库访问与 Migration 工具链

## 元数据

- 状态：proposed
- 决策状态：proposed
- 实施状态：not-started
- 审批状态：awaiting-review
- 日期：2026-08-08
- Owner：backend/data
- 适用范围：管理平台 `platform-api`/`platform-worker` 的 PostgreSQL 物理数据模型、数据库访问层、Migration 工具与 DDL 权威；不改变已 accepted ADR-026 的 Kysely 查询构建层决策
- 关联 PRD：[核心业务 PRD](../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md)（§4 账号/组织、§13 权限、§17 项目生命周期、§5.4 私密令牌）
- 关联技术方案：[管理平台后端设计](../../docs/superpowers/specs/2026-07-28-aurora-platform-backend-design.md)（approved，BACKEND-001=A）
- 关联 ADR：[ADR-026](../../docs/adr/ADR-026-platform-backend-runtime-and-contract-chain.md)（accepted）、[ADR-028](../../docs/adr/ADR-028-platform-session-csrf-security.md)（accepted，物理参数 defer 到 G10）
- 关联 Issue：none
- 关联实现 PR：none
- 替代 ADR：无
- 被替代 ADR：无

## 状态说明

本 ADR 于 2026-08-08 创建为 `proposed`。创建依据：formalization-readiness §7 候选队列第 5 项"平台数据库与访问/Migration"；accepted ADR-026 §决定细节 5/10"本 ADR 保留物理数据模型、PostgreSQL 版本、Migration 执行与 DDL 的权威，具体数据库 DDL 由后续数据库 ADR 承载"；release-migration 规范"数据库 ADR accepted 前不得创建权威 SQL/Migration"；平台后端设计 §16"管理平台 PostgreSQL 数据库、Migration 与真实访问层需 accepted ADR"。**在用户批准（accepted）前，不得创建平台权威 Schema、Migration、Repository、Kysely 查询代码或进入 `writing-plans`。**

## 背景

G10（身份、组织治理与账号注销）三个叶子 PLT-03/PLT-04/SEC-01 都需要真实 PostgreSQL 数据模型：identity（账号、密码摘要、验证意图、重置意图）、organization/membership/project（组织、成员、角色、项目、权限关系）、credentials（私密令牌、客户端密钥）、audit（安全审计摘要）、account-deletion（注销申请、冷静期状态、清理交接）与 recycle-bin 生命周期。当前没有任何已接受 ADR 冻结平台数据库访问方式、Migration 工具、PostgreSQL 主版本或 DDL 权威。accepted ADR-026 已冻结 Kysely 查询构建层与"数据库 ADR accepted 前不得创建权威 SQL/Migration"，但物理模型/版本/Migration 执行仍是开放决策。没有本 ADR，G10 任何叶子都无法安全创建表结构。

## 决策驱动因素

- **类型安全与迁移治理**：管理平台域有复杂关系模型（组织→成员→项目→权限），需要可追溯、版本稳定、可审计的 Migration；
- **与 accepted ADR-026 一致**：ADR-026 冻结 Kysely 查询构建层，本 ADR 不得重开该决策，只决定物理层；
- **真实 PostgreSQL 验证**：约束必须用真实 PostgreSQL 验证，不能 mock 冒充；
- **发布/回滚纪律**：Migration 必须确定性、可回滚验证、与部署晋级一致；
- **与数据接入域一致性**：ADR-010（ingestion）已冻结 PostgreSQL 17 + SQL-first + node-pg-migrate；平台域需要决定是复用同一工具链还是独立选择；
- **安全敏感数据**：账号密码摘要（Argon2id）、私密令牌摘要、审计记录，需要正确的列类型与访问边界。

## 候选方案

### 方案 A：PostgreSQL 17 + Kysely（查询）+ node-pg-migrate（Migration）+ SQL-first（推荐）

**行为**：PostgreSQL 17 为第一版兼容基线；Kysely 承担类型安全查询构建（accepted ADR-026）；Migration 用 node-pg-migrate（与 ADR-010 一致），DDL 以 SQL 文件为权威；访问层封装 Repository，禁止散落裸 SQL；平台域与 ingestion 域共享同一套数据库工具链约定。

**优点**：与 accepted ADR-026（Kysely）和 ADR-010（PostgreSQL 17 + node-pg-migrate）直接一致；SQL-first 提供最直接的原生 PostgreSQL 表达（JSONB、事务、`FOR UPDATE`）；平台与 ingestion 共享 PostgreSQL 17 + node-pg-migrate + SQL-first DDL 约定（查询层不同：Kysely vs `pg`，各自域内一致），降低运维成本。

**缺点**：Kysely 的类型映射与复杂 JSONB/递归查询仍需人工维护类型；平台域首次建立数据模型工作量集中在初期。

**选择结论**：推荐。

### 方案 B：PostgreSQL 17 + Prisma ORM（不采用）

**行为**：Prisma 作为 ORM 管理 Schema 与查询。

**优点**：Schema-first 声明式；迁移生成自动。

**缺点**：与 accepted ADR-026（Kysely 查询构建层）冲突，需要重开已批准决策；Prisma 对 JSONB/复杂事务/`FOR UPDATE SKIP LOCKED` 表达受限；与 ingestion 域工具链不一致。

**选择结论**：不采用。

### 方案 C：PostgreSQL 17 + Drizzle ORM（不采用）

**行为**：Drizzle 作为轻量 ORM 管理 Schema 与查询。

**优点**：SQL 风格接近原生；类型生成较好。

**缺点**：与 accepted ADR-026（Kysely）冲突，需要重开已批准决策；Drizzle 迁移/DDL 生态较新，复杂约束表达需要验证；与 ingestion 域不一致。

**选择结论**：不采用。

### 候选比较

| 维度 | A：Kysely+node-pg-migrate | B：Prisma | C：Drizzle |
|---|---|---|---|
| 与 accepted ADR-026 一致 | 是 | 否（重开决策） | 否（重开决策） |
| 与 ADR-010（ingestion）一致 | 是 | 否 | 否 |
| 复杂 JSONB/事务表达 | 直接 | 受限 | 接近 |
| 平台域首建成本 | 中 | 低 | 中 |

## 最终决策（proposed）

**方案 A：PostgreSQL 17 + Kysely 查询构建层 + node-pg-migrate + SQL-first。**

### 决定细节（proposed）

1. **PostgreSQL 基线**：第一版平台数据库兼容基线为 PostgreSQL 17（与 ingestion 域一致，生产 RDS 使用当时可用受支持 17 小版本）；
2. **查询构建层**：Kysely（accepted ADR-026 冻结），仅用于类型安全查询构建，不替代 SQL 权威；所有含不可信数据的 SQL 必须参数化（Kysely 默认参数化），禁止字符串拼接参数，不输出 SQL/正文/凭证到日志（沿用 ADR-010 §4.2 约束）；
3. **Migration 工具**：node-pg-migrate（与 ADR-010 一致），DDL 以 SQL 文件为权威；Migration 确定性、版本稳定、可回滚验证；
4. **访问边界**：平台 Repository 封装所有数据库访问；禁止从 `apps/console`、`platform-api` handler 或领域 service 散落裸 SQL；
5. **Schema 命名与隔离**：平台域 Migration 使用独立 Schema/前缀约定（与 ingestion 域 `event_inbox` 隔离），避免跨域表名冲突；
6. **数据模型首建**：本 ADR 冻结工具链，不冻结具体表结构；具体列名/约束/索引由各叶子规格冻结；
7. **测试边界**：Repository 集成测试必须运行真实 PostgreSQL 17（沿用 ingestion 域 `AURORA_TEST_DATABASE_URL` 模式），禁止 mock 冒充；
8. **最小权限数据库角色**：accepted ADR-026 §决定细节 4 要求的最小权限数据库角色（api vs worker vs migration）由部署/运维规格承载，本 ADR 记录其 Owner 并作为 G10 未决门禁项跟踪，不在本 ADR 内假定已解决。

## 结果与影响

### 正面影响

- 解除 G10 最大实施阻塞（无数据库 ADR 不得创建权威 SQL/Migration）；
- 与 accepted ADR-026/ADR-010 一致，无重开决策；
- 一套数据库约定覆盖平台与 ingestion 域，降低运维成本。

### 负面影响与代价

- Kysely 类型映射需要人工维护；
- 平台域数据模型首建工作量集中初期。

### 未解决问题

- 具体平台表结构（identity/organization/membership/project/audit/deletion）由各叶子规格冻结；
- 数据库连接池参数、RDS 实例规格、PITR/复制策略由部署与运维规格承载（requires-accepted-adr 或 implementation-detail）。

## 实施约束

- 数据库 ADR accepted 前不得创建权威 SQL/Migration；
- Migration 确定性、版本稳定、可审计；
- 不把数据库行类型泄漏到 `apps/console`（console 层禁止依赖 data 层）；
- Repository 集成测试用真实 PostgreSQL 17。

## 迁移方案

- 平台域首次引入 Migration 目录（`packages/<platform-data>/migrations/`），沿用 ingestion 域命名/顺序约定；
- 后续 Schema 变更通过新增 Migration，不修改已发布 Migration。

## 回滚方案

- node-pg-migrate 支持 down；部署晋级与回滚与 release-migration 规范一致；
- 平台域与 ingestion 域隔离，平台 Migration 回滚不影响 ingestion 数据。

## 验证方式

- Repository 集成测试（真实 PostgreSQL 17）；
- 全仓质量门禁（lint/typecheck/boundaries/build/test:coverage）；
- Migration up/down 幂等验证。

## 重新评估条件

- 平台域出现 Kysely 无法表达的高复杂度查询模式；
- PostgreSQL 版本升级（17 → 18）需要新兼容验证；
- 数据模型复杂度使 SQL-first 维护成本失衡。

## 追加记录

本 ADR 的评审、状态、实施和替代变化只能追加在本节之后。

### 2026-08-08：创建（proposed）

- 状态 `proposed / not-started / awaiting-review`；
- 由 G10 三个叶子（PLT-03/PLT-04/SEC-01）实施门禁创建；
- 依据 formalization-readiness §7 候选第 5 项、accepted ADR-026 §10、release-migration 规范与平台后端设计 §16；
- 未调用 writing-plans、未创建权威 Schema/Migration/Repository、未进入实施；
- 等待独立评审与用户正式批准，不自动批准、不实施。

### 2026-08-08：独立评审（security + architecture subagents，记录用，不代替正式批准）

> 评审意见用于改进决策材料，不改变 ADR 状态；正式接受必须由用户完成。

- **安全评审**：`ACCEPT`（无 blocking）。已按非阻断观察修订：N1 状态说明引用修正为 ADR-026 §决定细节 5/10；N2 新增决定细节 2 的参数化/日志约束（沿用 ADR-010 §4.2）；N3 新增决定细节 8（最小权限数据库角色，命名 Owner 并作为 G10 未决门禁项跟踪）；N4 方案 A 优点措辞修正（平台与 ingestion 共享 PostgreSQL 17 + node-pg-migrate + SQL-first DDL，查询层各自域内一致）。
- **架构交叉评审**：`ACCEPT`（无 blocking）。候选 A/B/C 与 formalization §7 项 5 一致；不重开 Kysely 决策；工具链冻结、表结构由叶子规格冻结的边界正确。

### 2026-08-09：用户正式批准（accepted）

- 用户已于 2026-08-09 对本 ADR 作出明确正式批准，批准范围（逐条）：
  1. PostgreSQL 17 为第一版平台数据库兼容基线；
  2. Kysely 作为类型安全查询构建层（不重开 accepted ADR-026 决策）；
  3. node-pg-migrate 作为 Migration 工具，DDL 以 SQL 文件为权威；
  4. SQL-first 与 Repository 封装访问边界；
  5. 平台数据模型与 Migration 的正式实现边界（本 ADR 冻结工具链，具体表结构由叶子规格冻结）。
- 批准仅适用于本 ADR 已记录并经过评审修订的决策范围；不扩大公共 API、不改变已批准 ADR 核心决策、不授权在对应的实施开始前创建权威 Schema/Migration/Repository；
- 状态更新：`status: accepted`、`decision-status: accepted`、`approval-status: approved`、`implementation-status: not-started`；
- 原 proposed 历史记录完整保留（"创建（proposed）"与"独立评审"各节均未删除或覆盖）；
- 实施状态保持 `not-started`，直到 PLT-03 正式实施真正开始；本 ADR 不得在此时标记为 implemented 或 in-progress。
