---
title: ADR-026：管理平台后端运行时与契约链
status: proposed
decision-status: proposed
implementation-status: not-started
approval-status: awaiting-user-approval
owner: platform/backend
date: 2026-08-08
last-reviewed: 2026-08-08
applies-to: 管理平台后端工程基线：Node.js 严格 TypeScript 模块化单体 platform-api＋独立 platform-worker、Fastify、PostgreSQL/Kysely＋SQL Migration、Zod/OpenAPI 契约链
related:
  - ../../AURORA_RULES.md
  - '../../Aurora ADR 规范.md'
  - ../../docs/architecture/platform-backend.md
  - ../../docs/architecture/formalization-readiness.md
  - ../../docs/superpowers/specs/2026-07-28-aurora-platform-backend-design.md
  - ../../docs/superpowers/specs/2026-07-30-aurora-platform-openapi-and-implementation-design.md
  - ../../docs/architecture/platform-contract-foundation.md
  - ../../docs/adr/ADR-001-use-monorepo.md
  - ../../docs/adr/ADR-002-five-system-boundaries.md
  - ../../docs/adr/ADR-005-event-schema-source-of-truth.md
  - ../../docs/adr/ADR-007-workspace-package-and-task-tooling.md
  - ../../docs/adr/ADR-010-postgresql-access-and-migration-tooling.md
  - ../../docs/adr/ADR-011-ingestion-http-service-runtime.md
  - ../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md
supersedes: none
superseded-by: none
---

# ADR-026：管理平台后端运行时与契约链

## 元数据

- 状态：proposed
- 决策状态：proposed
- 实施状态：not-started
- 审批状态：awaiting-user-approval
- 日期：2026-08-08
- Owner：platform/backend
- 适用范围：管理平台后端工程基线——Node.js 严格 TypeScript 模块化单体 `platform-api`＋独立 `platform-worker`、Fastify、PostgreSQL/Kysely＋版本化 SQL Migration、Zod/OpenAPI 契约链（与 PLT-01 `@aurora/platform-contract` 协作）
- 关联 PRD：[核心业务 PRD](../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md)
- 关联技术方案：[平台后端设计](../../docs/superpowers/specs/2026-07-28-aurora-platform-backend-design.md)（approved，BACKEND-001）、[总体 OpenAPI 与实现约束设计](../../docs/superpowers/specs/2026-07-30-aurora-platform-openapi-and-implementation-design.md)（approved）、[管理平台后端架构](../../docs/architecture/platform-backend.md)（approved）、[管理平台契约基础（PLT-01）](../../docs/architecture/platform-contract-foundation.md)（draft）
- 关联 Issue：none
- 关联实现 PR：none
- 替代 ADR：none
- 被替代 ADR：none

## 状态说明

本 ADR 于 2026-08-08 创建为 `proposed`。创建依据：G09（PLT-01/PLT-02）实施门禁；平台后端设计 §16"至少需要在实施前形成并 accepted 的长期决策：管理平台后端主运行时、模块化单体/Worker、Fastify、PostgreSQL/Kysely 和 Zod/OpenAPI 技术基线"；formalization-readiness §7 候选队列第 4 项"管理平台服务形态与后端栈"；总体 OpenAPI 设计 §20"正式实现前至少需要 accepted ADR 覆盖：Node.js/Fastify 模块化单体、PostgreSQL/Kysely 和 Zod/OpenAPI 契约链"。用户已于 2026-07-28 确认后端设计（BACKEND-001=A），本 ADR 将该已批准设计升格为正式技术决策并冻结运行时/契约链边界。**在用户批准（accepted）前，不得创建 `apps/platform-api`、`apps/platform-worker`、数据库模型、Migration 或进入 `writing-plans`。**

## 背景

Aurora 管理平台后端需为 31 个页面提供公开 Query/Command 能力，具备重新鉴权、事务、幂等、并发、审计、错误、不确定结果和异步状态的一致规则。平台后端设计已于 2026-07-28 经用户确认方案 A（BACKEND-001=A）：Node.js 模块化单体 `platform-api`＋独立 `platform-worker`，Fastify、PostgreSQL/Kysely、Zod/OpenAPI 契约链。但该确认是设计层确认，未锁定运行时/契约链边界，也未升格为 accepted ADR。后端运行时、HTTP 适配、数据访问与契约链共同构成长期、高迁移成本技术基线，按 ADR 规范 7.2 需创建独立 ADR。数据接入已由 ADR-011 接受 Fastify 5.10.0（仅限接入域）；本 ADR 为管理平台后端域建立独立决策。

## 决策驱动因素

- **业务复杂度**：主要来自业务权限、事务、公开契约、异步状态和数据解释，而不是极限 CPU 计算；
- **单一公开边界**：Vue SPA 只调用 `platform-api`；`platform-api` 只通过数据接入/处理存储正式公开契约组合数据；
- **类型与运行时校验**：严格 TypeScript 类型不能代替运行时校验、数据库约束和权限检查；
- **契约优先**：Zod 注册表生成 OpenAPI、Client、Server 校验适配器，避免多套权威来源；
- **数据访问边界**：版本化 SQL Migration 是数据库结构权威变更记录，应用启动不得隐式改表；不使用 ORM 隐藏 SQL；
- **部署单元**：模块化单体＋独立 Worker 以两个明确部署单元控制运维成本，保留领域隔离和未来按证据拆分的路径；
- **与前端一致性**：与已批准 TypeScript 前端、Zod/OpenAPI 契约链最一致；
- **高迁移成本**：运行时/框架/数据访问/契约链一旦铺开，替换成本高，需要长期保留取舍依据。

## 候选方案

### 方案 A：Node.js 严格 TypeScript 模块化单体 platform-api＋platform-worker，Fastify，PostgreSQL/Kysely＋SQL Migration，Zod/OpenAPI 契约链（推荐）

**行为**：`platform-api` 为按领域模块化的可部署应用；`platform-worker` 为独立部署单元（Outbox relay、邮件/通知、策略传播、Source Map 后续任务、删除编排）；Fastify 仅负责 HTTP/路由/请求上下文/序列化/传输层错误映射；Kysely 表达类型化 SQL；版本化 SQL Migration 为结构权威；`@aurora/platform-contract` 契约源码生成 OpenAPI 与 Client/Server 适配。

**优点**：与已批准前端技术栈（Zod/OpenAPI）最一致；两个部署单元控制运维成本；领域隔离与未来拆分路径保留；类型化 SQL 保留 SQL 控制力；契约优先消除多套权威来源；数据接入已由 ADR-011 验证 Fastify 可用性。

**缺点**：TypeScript 类型不能代替运行时校验；CPU 密集处理不得占用 API 事件循环；模块边界必须由公开出口、依赖规则、契约测试和架构检查强制执行；需要维护契约组合、代码生成与兼容检查工具。

**选择结论**：推荐。

### 方案 B：NestJS 模块化单体（不采用）

**行为**：NestJS 提供模块化容器、依赖注入和装饰器驱动的 HTTP 层。

**优点**：结构规整；DI/模块系统现成。

**缺点**：引入框架抽象与额外运行时，与"Fastify 仅做 HTTP 适配、领域层不依赖 Fastify 类型"的边界冲突；装饰器驱动的契约与 approved Zod 注册表/生成链不一致；用户已确认方案 A，改变会造成已批准设计的反向修改。

**选择结论**：不采用。

### 方案 C：JVM/Spring Boot 模块化单体（不采用）

**行为**：Kotlin/Java Spring Boot 单体。

**优点**：企业级成熟；线程模型/运维生态丰富。

**缺点**：双语言契约和工程成本高；与 TypeScript 前端和 Zod/OpenAPI 契约链不一致；当前无性能/合规证据抵消 Node.js 方案收益；用户已确认方案 A。

**选择结论**：不采用。

### 候选比较

| 维度 | A：Node/Fastify/Kysely | B：NestJS | C：JVM/Spring |
|---|---|---|---|
| 与已批准设计一致 | 是 | 否（抽象冲突） | 否 |
| 契约链 | Zod 注册表→OpenAPI/生成 | 装饰器驱动（不匹配） | 独立契约链 |
| 数据访问 | Kysely 类型化 SQL | TypeORM/Prisma（不匹配） | JDBC/ORM |
| 运维成本 | 低（两个部署单元） | 中 | 高 |
| 与前端一致性 | 高（同 TS/Zod） | 中 | 低 |

## 最终决策

**最终选择方案 A：Node.js 严格 TypeScript 模块化单体 `platform-api`＋独立 `platform-worker`，Fastify 为 HTTP 适配层，PostgreSQL/Kysely＋版本化 SQL Migration 为数据访问，Zod/OpenAPI 契约链（与 `@aurora/platform-contract` 协作）。**

### 决定细节

1. **运行时**：Node.js（实施时仍受支持的 Active LTS，与 Monorepo 基线一致）；严格 TypeScript 编译与类型检查；
2. **服务形态**：`platform-api` 是按领域模块化的可部署应用；第一版不按领域拆微服务、不增加浏览器 BFF；`platform-worker` 是独立进程/部署单元，不向浏览器暴露业务 API；
3. **HTTP 适配**：Fastify 仅负责 HTTP、路由、请求上下文、限流挂点、序列化与传输层错误映射；领域和应用层不得依赖 Fastify 类型；不使用 `@fastify/cors` 之外的默认 CORS 策略（显式 CORS adapter 遵循 ADR-011 先例）；精确版本实施时锁定；
4. **平台业务数据**：使用独立逻辑 PostgreSQL 平台数据库和最小权限数据库角色，不与事件明细/聚合存储共享表或私有模型；
5. **数据访问**：Kysely 表达类型化 SQL；版本化 SQL Migration 是数据库结构权威变更记录；应用启动不得隐式改表；不使用 ORM 隐藏 SQL；禁止创建权威 SQL/Migration 前未达数据库 ADR 门禁；
6. **公开契约**：REST/JSON、OpenAPI 契约优先、RFC 9457 问题详情；Zod 注册表（`@aurora/platform-contract`）生成或校验 JSON Schema/OpenAPI；具体 `zod`/`zod/mini` 入口与生成器技术选型归 ADR-027；
7. **浏览器边界**：Vue SPA 只消费正式 `platform-api`；不共享数据库模型、Kysely 类型、领域实体或内部能力令牌；
8. **跨系统边界**：`platform-api` 只能通过数据接入/处理存储的正式公开服务接口组合监控数据，不能直连其数据库或队列；
9. **领域模块**：identity/organization/project-governance/credentials/releases/issues-and-alerts/usage-and-policy/audit/operations 职责分区；模块间只调用公开应用接口；跨模块事务由明确应用用例拥有，HTTP handler 不得直接拼接多模块表写入；
10. **本 ADR 冻结决策**：Node/Fastify/Kysely/Zod-OpenAPI 契约链基线；不锁定精确依赖版本、数据库具体 DDL、BullMQ/Redis/S3 基础设施（后续 ADR）、Session 物理参数（ADR-028）、Outbox 任务细节或容量基准。

## 结果与影响

### 正面影响

- 与已批准前端技术栈、Zod/OpenAPI 契约链一致；
- 两个明确部署单元控制运维成本；
- 领域隔离与未来按证据拆分的路径保留；
- 类型化 SQL 保留 SQL 控制力；
- 契约优先消除多套权威来源。

### 负面影响与代价

- TypeScript 类型不能代替运行时校验、数据库约束和权限检查；
- CPU 密集处理不得占用 API 事件循环；
- 模块边界必须由公开出口、依赖规则、契约测试和架构检查强制执行；
- 需要维护契约组合、代码生成与兼容检查工具；
- 数据库 Migration/DDL 仍未可执行（后续模块）。

### 未解决问题

- 精确依赖版本与兼容组合（实施计划锁定）；
- 数据库物理模型/Migration（后续模块，需数据库 ADR）；
- Redis Session/BullMQ/S3 基础设施（ADR-028 与后续 ADR）；
- Outbox/BullMQ 精确租约、重试、死信保留、并发和资源上限（requires-benchmark）；
- 容量/成本基准（requires-benchmark）。

## 实施约束

- 浏览器只调用 `platform-api`；`platform-api` 只通过处理存储公开契约组合数据；
- `platform-contract` 不能依赖 Fastify、Kysely、数据库模型、BullMQ、Redis 客户端、页面组件或 Pinia；
- 数据库行、领域实体和下游响应必须显式映射为公开投影，不得透传；
- 版本化 SQL Migration 为结构权威；应用启动不得隐式改表；
- HTTP handler 只做契约适配、认证上下文建立和错误映射，不直接拼接多领域表写入；
- 领域模块不依赖 Fastify Request/Reply、OpenAPI 生成器或浏览器 Route Target 拼装实现；
- 严格 TypeScript；所有外部输入、数据库行和下游响应在边界运行时验证；
- 不暴露 SQLSTATE/约束名/SQL/堆栈/内部队列/主机/对象键/秘密。

## 迁移方案

本 ADR accepted 后：PLT-01（契约基础）先实施 → 后续模块按批准顺序实施 `platform-api` 领域模块与 `platform-worker`。数据接入 ADR-011 先例（Fastify 5.10.0、两阶段配置、build/start Pool 所有权分离）复用但不自动覆盖管理平台域。

## 回滚方案

- 契约/适配实现与业务 handler 解耦（通过 `@aurora/platform-contract` 生成适配），可回退不影响既有 ingestion-api；
- 未发布 Migration 可直接修改；已发布 Migration 使用 expand/contract 向前修复；
- 领域模块与 Worker 主循环解耦，可替换而不影响既有公开接口。

## 验证方式

- TypeScript 严格类型检查、ESLint、构建；
- 契约单元测试、生成一致性测试、OpenAPI 漂移检测（PLT-01 门禁）；
- 服务端请求/响应一致性测试（公开路由都在 OpenAPI；每个操作有实际 handler 或明确未启用构建门禁）；
- 权限、字段级披露、幂等、ETag、CSRF 和 Operation 恢复集成测试；
- 真实 PostgreSQL 集成验证（数据库 ADR 后）；
- Workspace Policy 依赖边界检查。

## 重新评估条件

- 单一 `platform-api` 出现独立扩缩容、隔离、团队所有权或发布瓶颈；
- 契约生成链长期产生无法控制的错误、性能或维护成本；
- 新客户端形态需要不同认证/传输协议；
- 容量/成本证据显示 Node/Fastify 无法满足目标；
- 安全、隐私、法律或数据驻留要求改变公开边界。

## 追加记录

本 ADR 的评审、状态、实施和替代变化只能追加在本节之后。

### 2026-08-08：创建（proposed）

- 状态 `proposed / not-started / awaiting-user-approval`；
- 由 G09（PLT-01/PLT-02）实施门禁创建；
- 依据 approved 平台后端设计（BACKEND-001=A）、总体 OpenAPI 设计 §20、formalization-readiness §7 候选第 4 项；
- 未调用 writing-plans、未创建 `apps/platform-api`/`apps/platform-worker`、未创建数据库模型/Migration、未实施代码；
- 等待独立评审与用户正式批准，不自动批准、不实施。
