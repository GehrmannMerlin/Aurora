---
title: ADR-011：数据接入同步 HTTP 服务的运行时与应用边界
status: accepted
implementation-status: in-progress
approval-status: approved
owner: ingestion/backend
date: 2026-08-01
last-reviewed: 2026-08-01
applies-to: 数据接入同步 HTTP 服务的运行时（Fastify 5.10.0）、应用目录、CORS adapter、配置来源、测试方式与依赖方向
related:
  - ../../AURORA_RULES.md
  - '../../Aurora ADR 规范.md'
  - ../../docs/architecture/platform-backend.md
  - ../../docs/architecture/deployment.md
  - ../../docs/architecture/formalization-readiness.md
  - ../../docs/architecture/system-overview.md
  - ../../docs/adr/ADR-004-asynchronous-event-processing.md
  - ../../docs/adr/ADR-005-event-schema-source-of-truth.md
  - ../../docs/adr/ADR-008-ingestion-durable-buffering.md
  - ../../docs/adr/ADR-009-ingestion-transport-and-client-credential.md
  - ../../docs/adr/ADR-010-postgresql-access-and-migration-tooling.md
  - ../../docs/api/ingestion-openapi.md
  - ../../docs/architecture/ingestion-inbox-data-model.md
supersedes: none
superseded-by: none
---

# ADR-011：数据接入同步 HTTP 服务的运行时与应用边界

## 元数据

- 状态：accepted
- 决策状态：accepted
- 实施状态：in-progress
- 审批状态：approved
- 日期：2026-08-01
- Owner：ingestion/backend
- 适用范围：数据接入同步 HTTP 服务（`POST /v1/batches`）的运行时（Fastify 5.10.0）、应用目录、CORS adapter、配置来源、测试方式、PostgreSQL Pool 所有权与依赖方向
- 关联 PRD：[核心业务 PRD](../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md) 第 7 章
- 关联 OpenAPI：[数据接入 OpenAPI 机器契约](../../docs/api/ingestion-openapi.md)
- 关联 Inbox：[Inbox 数据模型正式规格](../../docs/architecture/ingestion-inbox-data-model.md)
- 关联 Issue：none
- 关联实现 PR：none
- 替代 ADR：none
- 被替代 ADR：none

## 状态说明

本 ADR 于 2026-08-01 由用户批准（`decision-status: accepted`、`approval-status: approved`），实施状态保持 `not-started`。批准授权数据接入同步 HTTP 服务的运行时与应用边界最终决定；批准不代表 HTTP 服务、真实凭证模块、Worker、CI、RDS 或 IaC 已经实现。

## 背景

Aurora 已接受 ADR-004（可靠接收与异步处理）、ADR-005（event-schema 单一来源）、ADR-008（数据接入可靠缓冲 = PostgreSQL 事务性 Inbox）、ADR-009（数据接入公开传输与客户端凭证）和 ADR-010（数据接入数据库访问与 Migration 工具链）。数据接入批次/接收结果协议、OpenAPI 机器契约与 Inbox 数据模型已实施。ADR-008 后续依赖链第 4 项是 "数据接入服务同步接收路径"。

此前数据接入 HTTP 服务运行时存在缺口：Fastify 只出现在管理平台后端设计且 `requires-accepted-adr`；平台决定不自动适用数据接入域（ADR-008/010 已证明数据接入独立选型）；Workspace Policy 无 `service` 层。本 ADR 于 2026-08-01 由用户直接审批批准，解除该阻塞。

## 决策驱动因素

- **公共传输端点稳定性**：`POST /v1/batches` 是 SDK 长期依赖的公开端点，运行时选择迁移成本高；
- **ACK 边界精确性**：服务必须能把 `persistBatch` 事务 COMMIT 精确映射为 `accepted`，框架不得引入隐式提交/缓冲；
- **CORS 语义精确性**：ADR-009 冻结的 CORS（禁 `*`、禁 Cookie credential、回显单一 Origin、`Vary: Origin`）必须可精确表达；
- **请求 ID/错误映射**：`X-Aurora-Request-Id`、`Retry-After`、全部 HTTP 状态码需可精确实现；
- **应用边界清晰**：服务应用与共享包（event-schema、ingestion-inbox）依赖方向须由 Workspace Policy 约束；
- **不引入未经批准生产框架**：本轮只冻结运行时决策，不实施。

## 现有约束

- ADR-009：`POST /v1/batches`、`application/json`、`X-Aurora-Client-Key`/`X-Aurora-Environment`、Origin 匹配、完整 HTTP 状态映射、CORS 边界、`Retry-After`、`X-Aurora-Request-Id`；
- ADR-010：`pg` + `node-pg-migrate` + SQL-first（数据接入域独立数据库工具链）；
- ADR-008：`persistBatch` 事务 COMMIT = "已可靠接收"；批次部分成功不整批回滚；不承诺顺序；
- Workspace Policy：新增 `service` 层（本 ADR）；现有层 protocol/data/sdk-*/tooling。

## 最终决策

### 4.1 服务运行时

- 正式选择 **Fastify 5**；
- 第一增量精确锁定 `fastify@5.10.0`；
- 不使用原生 Node HTTP、Express、Hono；
- Fastify 是数据接入应用运行时，不进入 protocol、data 或 SDK 包；
- 不因为管理平台未来也可能使用 Fastify，就合并两个应用或故障域。

### 4.2 Node 24 兼容门禁

Fastify 5.10.0 必须在项目 Node v24.18.0 下新鲜验证：安装、TypeScript 编译、最小应用 `ready()`、`inject()`、JSON 请求/响应、error handler、`listen({ host: '127.0.0.1', port: 0 })`、`close()`、重复关闭、`onClose`。任一关键测试失败：不降低 Node 版本、不静默切换 Fastify 版本、停止并报告兼容缺口。通过后将结果作为项目自身的 Node 24 兼容证据记录；不得描述为 Fastify 官方已承诺 Node 24。

### 4.3 应用目录和包

- 目录：`apps/ingestion-api`；
- 包名：`@aurora/ingestion-api`；
- `"private": true`；
- 应用不作为 npm 公共包发布；
- 应用入口与可测试应用工厂分离；
- 不创建通用 services 框架；不创建平台后端应用。

### 4.4 Workspace Policy

新增 `service` 应用层：

- 允许：`service → protocol`、`service → data`、`service → tooling`（仅构建和测试允许的公共入口）；
- 禁止：`protocol → service`、`data → service`、SDK Core/Browser/插件 → service、`service → SDK Core/Browser/具体插件`、`service → event-schema 或 ingestion-inbox 私有路径`、OpenAPI tooling 进入生产运行时、service 应用之间隐式共享私有代码；
- `apps/ingestion-api` 只能从以下包根消费：`@aurora/event-schema`、`@aurora/ingestion-inbox`。

### 4.5 CORS

第一增量**不安装 `@fastify/cors`**。使用范围有限的显式 CORS adapter：

- 明确 OPTIONS 路由；明确 POST 响应 Header；不注册全局 wildcard CORS；不使用正则 Origin；不使用动态代码执行；不创建无限缓存；不允许 `*`；不允许 Cookie credential；不返回 `Access-Control-Allow-Credentials: true`。

预检语义：

1. OPTIONS 不携带真实客户端密钥；
2. 验证 Origin 存在且是规范化的 HTTP(S) origin；
3. 拒绝 `null`、带路径、查询、fragment、userinfo 的值；
4. 验证请求方法必须是 POST；
5. 验证请求 Header 只能是 `Content-Type`、`X-Aurora-Client-Key`、`X-Aurora-Environment`；
6. 成功返回 204；
7. 回显规范化后的单一 Origin；
8. 返回 `Vary: Origin`；
9. 预检成功只表示传输格式可尝试，不代表项目认证或项目 allowlist 已通过；
10. 不访问 Inbox，不产生 receipt，不构成可靠接收。

实际 POST 的项目级 Origin allowlist 必须由请求授权端口根据客户端密钥对应的项目策略校验。只有授权端口明确返回允许 Origin 时，POST 响应才设置 `Access-Control-Allow-Origin`、`Vary: Origin`、`Access-Control-Expose-Headers: X-Aurora-Request-Id, Retry-After`。未获授权的 Origin 不得由服务自行放行。

将"预检仅验证传输资格、POST 执行项目级授权"的澄清追加到 ADR-009，不改变其核心决策。

### 4.6 配置来源

正式采用"两阶段配置"：

1. `start.ts` 从环境变量读取不可信字符串；
2. `configuration.ts` 一次性校验并生成冻结的 typed config；
3. `buildIngestionApi` 只接受已验证配置和显式依赖；
4. 路由和业务模块不得直接访问 `process.env`。

第一增量不使用 dotenv 生产运行时加载、YAML/JSON 配置文件、远程配置中心、模块导入时读取环境变量。

必要配置项：`host`、`port`、`requestBodyLimitBytes`、`gracefulShutdownTimeoutMs`、`databaseUrl` 或外部 Pool、日志启用和级别。请求体字节上限不是产品承诺：必须由启动配置显式提供；不写入 OpenAPI 的固定业务限制；测试使用明确数值；缺失或非法时启动失败。

### 4.7 PostgreSQL Pool 所有权

明确区分：

- **`buildIngestionApi`**：接受外部依赖；不创建 Pool；不关闭调用方提供的 Pool；适合 `inject`、单元和集成测试。
- **`startIngestionApi`**：composition root；根据已验证配置创建 Pool；创建 Inbox Repository 依赖；构建应用；启动监听；注册关闭处理；明确拥有它创建的 Pool；Fastify 停止接收新请求并完成进行中请求后关闭 Pool；Pool 只能关闭一次；启动失败必须回滚并关闭已创建资源。

不得在普通 route handler 中创建或关闭 Pool。

### 4.8 测试方式

- 路由和协议测试主要使用 Fastify `inject()`；
- PostgreSQL 集成测试继续使用真实 PostgreSQL 17；
- 增加真实 loopback 冒烟测试：host `127.0.0.1`、port `0`、不使用固定端口、验证 listen/请求/close/Pool 释放；
- 不向公网接口发请求；不依赖测试执行顺序；不使用 mock 数据库替代 PostgreSQL 集成证据。

## 候选方案（已评审）

### 方案 A：Fastify（已选定）

- 使用 Fastify 5.10.0 + 显式 CORS adapter（不装 `@fastify/cors`）；
- 优点：路由/序列化/错误映射成熟；`inject` 测试无需真实端口；类型安全；
- 缺点：引入第三方运行时依赖；需独立 accepted ADR 授权。

### 方案 B：原生 Node HTTP（被拒绝）

- 零第三方依赖、CORS 完全自控；但路由/解析/序列化/错误处理手写且易错，测试需自建 inject。

### 方案 C：其他候选（Express/Hono 等，被拒绝）

- 均未在任何 approved 文档中出现，不引入。

### 候选比较

| 维度           | A：Fastify         | B：原生 Node HTTP | C：Express/Hono 等 |
| -------------- | ------------------ | ----------------- | ------------------ |
| 公共端点稳定   | 高                 | 高                | 中                 |
| ACK 边界自控   | 中（显式 handler） | 高                | 中                 |
| CORS 精确表达  | 显式 adapter       | 完全自控          | 需中间件核对       |
| inject 测试    | 内置               | 自建              | supertest          |
| 运行时依赖体积 | 中                 | 最小              | 中/大              |
| 类型安全       | 高                 | 中                | 中                 |
| 与平台域一致性 | 平台候选 Fastify   | 不一致            | 不一致             |

## 推荐方案（最终决定）

**最终选择方案 A：Fastify 5.10.0 + 显式 CORS adapter。**

核心理由：

1. 路由、序列化、错误映射与 `inject` 测试成熟，降低公共传输端点实现风险；
2. 不装 `@fastify/cors`，用显式 CORS adapter 精确表达 ADR-009 语义（有完整测试，不放宽策略）；
3. 平台域若后续 accepted Fastify，两域共享 HTTP 适配模式（但依赖方向与故障域仍分离）；
4. ACK 边界由显式 handler 控制，不引入框架隐式缓冲。

## 结果与影响

### 正面影响

- 数据接入 HTTP 服务获得确定运行时与应用边界；
- 公共传输端点实现风险降低（成熟框架 + inject 测试）；
- 依赖方向由 Workspace Policy `service` 层约束。

### 负面影响与代价

- 引入 Fastify 第三方运行时依赖；
- 显式 CORS adapter 需完整测试；
- 应用目录与平台域的关系需明确。

### 未解决问题

- Fastify 精确主版本实施时验证 Node 24 兼容并固定（本 ADR 锁定 5.10.0）；
- 服务配置来源（已定两阶段配置：env adapter + typed config injection）。

## 实施约束

- Fastify 服务框架已 accepted，可实施数据接入同步 HTTP 服务；
- CORS 必须严格符合 ADR-009 与本 ADR，不得放宽策略；
- 生产启动缺少 authorizer 实现时必须拒绝启动；测试必须显式注入。

## 迁移方案

本 ADR accepted 后：验证 Fastify 5.10.0/Node 24 兼容 → 编写数据接入同步 HTTP 服务正式规格 → writing-plans → 实施 `POST /v1/batches` 服务 → 真实 PostgreSQL 集成测试。

## 回滚方案

若服务运行时在实施中发现缺陷，可在公共端点发布前更换运行时（应用工厂与路由抽象则迁移成本低）；发布后遵循向前修复。

## 验证方式

- Fastify 5.10.0/Node 24 兼容门禁（inject、ready、close、onClose、listen port 0）；
- Fastify `inject` 测试覆盖全部 HTTP 状态、CORS、request ID、Retry-After；
- OpenAPI 路径/Header/状态码漂移测试；
- 真实 PostgreSQL 集成测试（accepted/duplicate/rollback）；
- loopback 随机端口冒烟测试；
- Workspace Policy `service` 层负例。

## 重新评估条件

- 公共传输端点需要不同运行时能力；
- 平台域 accepted 不同 HTTP 框架且需要共享模式；
- 服务运行时产生不可接受的依赖或运维负担。

## 追加记录

本 ADR 的评审、状态、实施和替代变化只能追加在本节之后。

### 2026-08-01：创建（proposed）

- 状态 `proposed / not-started / awaiting-user-approval`；
- 由 2026-08-01 数据接入同步 HTTP 服务前置门禁创建；
- 门禁确认 Fastify、服务应用目录、`@fastify/cors`、配置来源、测试方式、依赖方向均无 accepted 来源；平台 Fastify 决定只适用管理平台域且 `requires-accepted-adr`；
- 未调用 writing-plans、未安装服务框架、未创建应用；
- 等待用户审批，不自动批准、不实施。

### 2026-08-01：用户批准与最终决定

- 决策状态更新为 `accepted`，实施状态保持 `not-started`，审批状态 `approved`；
- 用户批准方案 A，批准内容以用户 2026-08-01 消息的精确决定为准；
- 最终决定：**Fastify 5.10.0**；Node 24 本地兼容门禁；不使用 `@fastify/cors`；显式 CORS adapter（OPTIONS 仅验证传输资格、POST 执行项目级授权）；`apps/ingestion-api` + 包名 `@aurora/ingestion-api`（private）；Workspace Policy `service` 层（service → protocol/data，禁反向）；两阶段配置（env adapter + typed config injection）；`buildIngestionApi`/`startIngestionApi` Pool 所有权分离；`inject()` + 随机端口 loopback 冒烟测试；
- 本次批准不代表 HTTP 服务、真实凭证模块、Worker、CI、RDS 或 IaC 已经实现。

### 2026-08-01：数据接入同步 HTTP 服务第一增量实施证据

- 实施状态更新为 `in-progress`：`apps/ingestion-api` 数据接入同步 HTTP 服务第一增量已实施并通过真实 PostgreSQL 17.10 集成测试与全仓质量门禁；真实凭证模块、Worker 与接入服务完整链路仍未实现，故不进入 `implemented`；
- 实施内容：Fastify 5.10.0 应用工厂 `buildIngestionApi`（接受外部依赖，不创建/关闭 Pool）与启动入口 `startIngestionApi`（composition root，拥有并释放 Pool）；`POST /v1/batches` 路由（严格符合 approved OpenAPI：operationId `ingestionSubmitBatch`、`application/json`、`X-Aurora-Client-Key`/`X-Aurora-Environment`/Origin）；OPTIONS/CORS adapter（不装 `@fastify/cors`，禁 `*`、禁 Cookie credential、回显单一 Origin、`Vary: Origin`）；请求 ID（`globalThis.crypto.randomUUID()`）；`IngestionRequestAuthorizer`/`IngestionAdmissionPolicy` 端口；event-schema 批次解析；`@aurora/ingestion-inbox` `persistBatch` 调用；receipt 与 HTTP 状态映射（200/400/401/403/413/415/429/500/503）；`Retry-After` 整数秒；生命周期与 Pool 释放；
- Fastify 5.10.0 / Node 24.18.0 兼容门禁（新鲜验证）：安装、TypeScript 编译、`ready()`、`inject()`、JSON 请求/响应、error handler、`listen({ host: '127.0.0.1', port: 0 })`、`close()`、重复关闭、`onClose` 全部通过；作为项目自身 Node 24 兼容证据；
- 测试：55 个单元/inject/OpenAPI 漂移测试 + 5 个真实 PostgreSQL 17.10 集成测试（HTTP accepted → Inbox 记录、duplicate 不新增、跨项目同 eventId、语句失败 503 无 accepted、loopback 随机端口关闭与 Pool 释放）；
- 实际依赖：`fastify` 5.10.0、`pg` 8.22.0、`@aurora/event-schema`、`@aurora/ingestion-inbox`；
- 验证命令：`pnpm --filter @aurora/ingestion-api test/test:integration/typecheck/lint/build`、`pnpm check:boundaries` 全部 exit 0；
- 实施 Commit：none（未提交）；
- Issue/PR：none；
- 未实现：真实客户端凭证模块、Worker、采样、真实限流、CI、RDS、IaC。
