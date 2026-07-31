---
title: Aurora 管理平台后端架构与公开能力边界
status: approved
owner: backend
last-reviewed: 2026-07-30
applies-to: Aurora 第一版管理平台 API、Worker、领域模块、Session、事务、任务、对象与跨系统能力
related:
  - ../../AURORA_RULES.md
  - ../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md
  - ../../Aurora 架构规范.md
  - ../prd/platform-product-domains.md
  - platform-frontend.md
  - ../security/account-deletion-and-data-lifecycle.md
  - ../testing/test-strategy.md
  - ../adr/README.md
  - ../superpowers/specs/2026-07-28-aurora-platform-backend-design.md
  - ../superpowers/specs/2026-07-30-aurora-platform-openapi-and-implementation-design.md
supersedes: none
review-cycle: backend-contract-or-release
---

# Aurora 管理平台后端架构与公开能力边界

## 1. 定位与实现状态

本文是 approved 管理平台后端设计的长期正式承载，定义领域所有权、公开能力语义和跨系统边界。页面需求来自[管理平台产品业务域](../prd/platform-product-domains.md)及完整 UX/UI；公共契约与实现门禁来自已批准的[总体 OpenAPI 与实现约束设计](../superpowers/specs/2026-07-30-aurora-platform-openapi-and-implementation-design.md)；A5 删除规则来自[账号注销与数据生命周期](../security/account-deletion-and-data-lifecycle.md)。

批准设计方向为 TypeScript/Node.js 模块化单体＋独立 Worker、Fastify、PostgreSQL/Kysely、Zod/OpenAPI；平台异步任务使用 PostgreSQL Outbox＋Redis/BullMQ，私密对象使用 S3 兼容存储，第一版不引入独立搜索；Session 使用 Redis 权威不透明会话、同步 CSRF 和短期内部能力令牌。总体公开契约采用“统一公开契约、内部按领域模块化、生成单一 Platform OpenAPI”的方案 A。这些长期技术选择均受 `requires-accepted-adr` 约束；仓库仍没有机器 OpenAPI、可执行数据模型、Migration 或管理平台实现。

## 2. 运行单元与领域模块

`platform-api` 负责浏览器公开 Query/Command、鉴权和同步事务；`platform-worker` 负责 Outbox relay、邮件/通知、策略传播、Source Map 后续任务和删除编排。两者可以复用纯领域、用例和公开契约，但不得共享任意全局可变状态。

| 领域模块 | 权威职责 |
|---|---|
| identity | 账号、验证/重置意图、密码、Session 和账号生命周期 |
| organization | 组织、成员、邀请、角色、所有权和业务时区 |
| project-governance | 项目、环境、显式成员、设置、归档、回收站和删除 |
| credentials | 客户端上报密钥与私密管理令牌的分离能力模型 |
| releases | 发布、部署、Source Map 元数据和处理任务投影 |
| issues-and-alerts | 问题协作 Command、告警规则/实例和通知 |
| usage-and-policy | 用量投影、平台/组织/项目策略和传播状态 |
| audit | 组织安全审计及未来经规则批准的平台审计 |
| operations | 幂等、Operation Result、Outbox 和后台任务恢复；不成为用户任务中心 |

模块不是九个服务。HTTP handler 不得直接拼接多模块表写入；跨模块事务由明确应用用例拥有，模块间只调用公开应用接口。

## 3. 数据所有权

- PostgreSQL 权威保存平台账号、组织、项目、治理、凭据摘要、发布元数据、规则、通知、审计、幂等、Operation 和 Outbox；
- Redis Session 与普通缓存、BullMQ 必须隔离故障域、凭据和淘汰策略；Session 不保存角色权威；
- 数据处理与存储系统权威拥有原始/规范事件、问题聚合、代表样本、接口/页面指标、接收状态、告警评估和实例证据；平台只经公开 Query/Command 使用；
- S3 兼容对象存储只保存私密 Source Map 等对象，数据库保存元数据、摘要和状态；上传完成不等于对象已激活或处理完成；
- 第一版不建立独立搜索；是否增加分析库或搜索属于 `requires-benchmark` 与 `requires-accepted-adr`。

## 4. 公开能力语义

未来浏览器 API 使用版本化 HTTPS REST/JSON，公共主版本路径为 `/api/platform/v1`。目标 `platform-contract` 契约源码按领域模块维护，通过唯一操作注册表确定性生成单一 OpenAPI、浏览器 Client、Fastify 输入/输出适配、MSW 契约样本和兼容差异报告；生成制品禁止手工修改。浏览器只调用 `platform-api`，`platform-api` 只通过下游正式公开 Query/Command 协作。

Query 返回获授权数据及按需的版本、时区、规范化查询、分页、总量、水位、完整性、采样、降级、`allowedActions` 和受约束 `navigationTargets`；组合页面允许次要分区 `partial`、`stale` 或 `unavailable`，但身份/项目权威失败时整体失败。`navigationTargets` 使用封闭 Route Target，不允许任意 URL。

Command 必须重新鉴权；非天然幂等操作使用规范化请求摘要和幂等上下文；并发修改使用权威版本或 ETag；不确定结果通过 Operation Result 或资源 Query 恢复。创建秘密的成功响应禁止缓存，明文只出现一次。

错误遵守 RFC 9457 并提供稳定机器错误码、请求标识和安全恢复信息，不泄露堆栈、SQL、内部队列/主机、对象键、秘密或账号存在性。这里描述的是已批准契约设计，不是已有端点；精确领域 Schema、操作路径和机器 OpenAPI 仍为 `deferred`/absent。

## 5. 权限与安全

- 第一版角色保持组织所有者、组织管理员、项目管理员和普通成员，不增加自定义角色；
- 组织继承与项目显式关系分别保存并计算有效权限；所有写入重新读取当前关系、资源版本和生命周期；
- 项目进入回收站后只由组织所有者/管理员按 B8 管理，不依赖删除前项目角色；
- D2 只接受正式平台管理员身份；其来源、授予/撤销和平台级审计仍为 `deferred`，不能从组织角色推导；
- Redis Session 故障时受保护请求失败关闭；Cookie、CSRF、期限、轮换和密钥托管为 `requires-accepted-adr`；
- 下游能力令牌必须短期、最小资源/动作范围并绑定可信工作负载身份，不放入无关 PII。

A5 注销受理后全部 Session 立即终止、组织关系冻结和删除规则以正式安全文档为准；后端设计中旧的“待产品规则”不再是产品阻塞，但仍需要机器契约和安全 ADR。

## 6. 事务、任务与一致性

注册、邀请接受、所有权转让、项目创建、私密令牌创建和本地生命周期变化在单一 PostgreSQL 事务维护本地不变量。跨系统动作不使用分布式事务：领域写入与 Outbox 同事务，Worker 以租约、有限重试、幂等消费者和 PostgreSQL 权威失败记录执行。

Redis/BullMQ Job 状态不直接成为用户业务状态。缓存只存可重建投影，权限、秘密、删除状态和 Operation Result 不得仅由普通缓存回答。Source Map 替换只有在对象校验和元数据切换成功后生效，旧对象在此之前保持有效。

租约、并发、退避、死信期限、资源上限和缓存 TTL 属于 `implementation-detail`/`requires-benchmark`；基础设施组合属于 `requires-accepted-adr`。

## 7. 审计、隐私与删除

高风险组织操作写入 B7 安全审计；普通问题活动、认证安全日志和未来平台级审计保持不同权限模型。日志、审计、任务和对象均不得保存密码、Cookie、令牌明文、Source Map 内容或非必要监控数据。

项目和账号永久删除使用可续跑、幂等、逐系统确认的编排，不能因部分成功宣称完成。账号删除、匿名化、一年审计和 35 天备份语义以正式 A5 文档为准；项目回收站恢复后的完整状态仍为 `deferred`。

## 8. 真实阻塞

- `requires-accepted-adr`：后端运行时/框架、PostgreSQL/Kysely、Session/CSRF、Outbox/BullMQ/S3 及部署安全；
- `deferred`：机器 Platform OpenAPI 与 `platform-contract` 实现、精确领域 Schema、数据库模型/Migration、处理 Query/Command 和 D2 平台治理；
- `implementation-detail`：精确密码/会话期限、限频、缓存 TTL、任务重试和日志字段；
- `requires-benchmark`：容量、复杂查询、Outbox/Worker、Redis 故障、删除编排和恢复。

这些阻塞不改变 approved 领域设计，但阻止代码实施和发布声明。
