---
title: ADR-023：托管计算与托管数据服务（ECS/Fargate、RDS PostgreSQL、Redis 边界）
status: accepted
implementation-status: in-progress
approval-status: approved
owner: cloud/operations
date: 2026-08-07
last-reviewed: 2026-08-07
applies-to: Aurora 第一版托管计算（ECS/Fargate）与托管数据服务（RDS PostgreSQL、ElastiCache Redis 提供边界）的基础资源决策
related:
  - ../../AGENTS.md
  - ../../AURORA_RULES.md
  - '../../Aurora ADR 规范.md'
  - '../architecture/deployment.md'
  - '../architecture/aws-region-account-network-iac-foundation.md'
  - '../architecture/formalization-readiness.md'
  - '../adr/ADR-010-postgresql-access-and-migration-tooling.md'
  - '../adr/ADR-011-ingestion-http-service-runtime.md'
  - '../adr/ADR-012-ingestion-worker-runtime.md'
  - '../superpowers/specs/2026-07-28-aurora-platform-backend-design.md'
supersedes: none
superseded-by: none
---

# ADR-023：托管计算与托管数据服务（ECS/Fargate、RDS PostgreSQL、Redis 边界）

## 元数据

- 状态：accepted
- 决策状态：accepted
- 实施状态：in-progress
- 审批状态：approved
- 日期：2026-08-07
- Owner：cloud/operations
- 适用范围：Aurora 第一版托管计算（ECS/Fargate）与托管数据服务（RDS PostgreSQL、ElastiCache Redis 提供边界）的基础资源决策
- 关联 PRD：[核心业务 PRD](../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md)
- 关联技术方案：[部署架构](../architecture/deployment.md)（approved）、[AWS 区域、账号、网络与 IaC 基础设施基础（OPS-04）](../architecture/aws-region-account-network-iac-foundation.md)（proposed）、[管理平台后端设计](../superpowers/specs/2026-07-28-aurora-platform-backend-design.md)（approved）
- 关联 Issue：none
- 关联实现 PR：none
- 替代 ADR：none
- 被替代 ADR：none
- **评审域**：infra compute/data（cloud/operations）+ database（ADR-010 复用边界）。本 ADR 把托管计算（ECS/Fargate）与托管数据服务（RDS/ElastiCache）合为一份，对应已批准 TDR 候选 5。**评审门禁要求 cloud/operations 与 data 评审者均批准；若任一方无法联合批准，本 ADR 必须按 ADR 规范 7.2/7.7 拆分**（架构评审 Major #3）。本 ADR 只冻结 engine family 与 RDS 基础资源边界，**不预决管理平台数据库访问层**（架构评审 Major #1）。

## 状态说明

本 ADR 于 2026-08-07 由 G16/OPS-04 前置门禁创建为 `proposed / not-started / awaiting-user-approval`。门禁确认：托管容器与托管数据服务方向已 approved（TDR §3.1 方案 A），但精确服务形态（ECS/Fargate、RDS、ElastiCache）、提供边界与生产资源授权均无 accepted 决策。本 ADR 只记录候选与推荐，**在用户批准前不得创建任何计算或数据资源**；不创建 ECS/RDS/ECR、不运行 `writing-plans`。

> **2026-08-11 用户批准（append-only）**：用户正式批准 G16/OPS-04 Cloud Decision Package 中 D8/D10 推荐方案，本 ADR 决策状态由 `proposed` 更新为 `accepted`，审批状态 `approved`。批准内容：**方案 A——ECS/Fargate 承载全部服务、RDS PostgreSQL 生产 Multi-AZ、ElastiCache（Redis Session/BullMQ/缓存）保留 integration boundary 但不立即 provision（等真实消费者 platform-api 存在 + 对应 backend ADR accepted 后落位）**。OPS-04 只创建 ECS cluster/ECR/任务角色/RDS 基础资源（IaC 定义），ECS Service 创建与部署设置属 OPS-05；本 ADR 不授权任何服务部署。实施状态由 OPS-04 实施进度承载（`in-progress`：IaC 基础工程已创建，实际资源与 OPS-05 部署仍 not-started）。

## 背景

Aurora 已批准 AWS 托管容器与托管数据服务模型、SPA=CloudFront+私有 S3、平台 API=ALB 后 ECS/Fargate、关系数据=RDS PostgreSQL Multi-AZ、Session/BullMQ/缓存=ElastiCache Redis、Source Map=私有 S3。数据库物理技术已由 ADR-010 收口为 PostgreSQL 17 + `pg` + `node-pg-migrate` + SQL-first。当前真实 workload 只有 `ingestion-api`（Fastify）与 `ingestion-worker`（Node.js 24），均无容器镜像、无 ECS 部署；`console`/`platform-api` 尚无真实实现。托管计算与托管数据服务的基础资源决策需要独立 ADR，才能为 OPS-05 提供部署目标并界定 Redis/对象存储的提供边界。

## 决策驱动因素

- 与已批准数据库技术选型一致（PostgreSQL 17，不重选）；
- 当前 workload 的真实形态（只有接入 API 与 Worker）；
- 未来 workload 边界（platform-api/platform-worker/SPA）与 YAGNI；
- 不可变制品部署与回滚；
- 成本（常开资源、NAT/ALB/RDS/ElastiCache）；
- 备份/恢复与删除保护；
- 无真实消费者不 provision 付费资源。

## 候选方案

### 方案 A：ECS/Fargate 承载全部服务 + RDS PostgreSQL（生产 Multi-AZ）+ 不立即 provision ElastiCache

- 服务运行在 ECS/Fargate，镜像存 ECR，按 digest 晋级；
- RDS PostgreSQL 生产 Multi-AZ、删除保护、自动备份 35 天、PITR；
- ElastiCache（Redis Session/BullMQ 的批准载体）**不立即 provision**，等真实消费者（platform-api）存在后经对应 backend ADR accepted 再落位；
- ingestion-api / ingestion-worker 为第一批部署 workload。

优点：

- 避免管理 EC2 集群；与不可变制品模型一致；
- 数据库沿用已批准 PostgreSQL 17 工具链；
- 不为尚无实现的 workload 预置付费资源（YAGNI）。

缺点：

- 需要建立 ECR/ECS 运维与健康/回滚机制（OPS-05 落位）；
- RDS 常开是主要持续成本来源之一。

### 方案 B：自管 EC2 + 自装数据库 / ECS on EC2

优点：

- 对实例与容量控制力更强。

缺点：

- 补丁、扩容、健康与备份全部自管，运维与安全复杂度显著上升；
- 与 approved"托管容器与托管数据服务"方向不一致；
- 不作为第一版候选。

### 方案 C：Kubernetes（EKS）或托管 Serverless（App Runner/Lambda）

优点：

- EKS 适合大规模容器编排；App Runner/Lambda 少运维。

缺点：

- EKS 明显超出第一版规模与运维能力（TDR 明确第一版不采用 K8s 平台）；
- App Runner/Lambda 与已批准 ECS/Fargate 设计方向不一致、冷启动与长连接 Worker 不匹配；
- 不作为第一版候选。

## 最终决策

**已批准（2026-08-11，Decision Package D10/D8）。** 用户批准方案 A：**ECS/Fargate 承载全部服务**（镜像存 ECR、按 digest 晋级、`awsvpc` 网络模式、私有子网、最小权限 task role）；**RDS PostgreSQL 生产 Multi-AZ**（`publicly_accessible=false`、卷加密、删除保护、自动备份 35 天 + PITR）；**ElastiCache Redis 保留 integration boundary 但不立即 provision**（真实消费者 platform-api + backend ADR accepted 后落位）；**私有 S3（Source Map 等）同样 defer 至真实消费者**。OPS-04 只建立 ECS cluster/ECR/任务角色/RDS 等基础资源（IaC 定义，供 OPS-05 作为部署目标）；ECS Service 创建、健康阈值、最小健康比例与部署熔断属 OPS-05。

## 结果与影响

### 正面影响

- 计算与数据服务形态统一、可回滚；
- 数据库选型稳定复用，不重选；
- 无真实消费者不创建付费 Redis/对象资源。

### 负面影响与代价

- ECS 运维、镜像与健康/回滚机制需在 OPS-05 建立；
- RDS 常开成本。

### 未解决问题

- 生产/非生产实例规格与容量（ING-13 生产基准后锁定）；
- ElastiCache 精确拓扑、持久化与备份（真实消费者 + backend ADR 后）；
- autoscaling 边界（容量证据后锁定）。

## 实施约束

- 数据库 engine family 复用 PostgreSQL 17 + `pg` + `node-pg-migrate` + SQL-first（ADR-010，**适用于数据接入/处理数据库**）；**管理平台数据库的 ORM/Query Builder 是独立待决决策（formalization-readiness §7 候选 5：approved Kysely 方向），本 ADR 不预决**（架构评审 Major #1）；
- 数据接入/处理数据与未来管理平台数据必须物理/逻辑隔离（独立逻辑数据库 + 独立凭据，或独立实例；架构评审 Major #2）；
- ECS 服务使用 `awsvpc` 网络模式、私有子网、健康检查与最小权限 task role；
- 镜像按 digest 晋级，禁止浮动 `latest` 作为发布依据；
- RDS `publicly_accessible=false`、卷加密、删除保护、自动备份；
- 生产精确容量不得拿本地 benchmark 猜（ING-13 提供证据）；
- 无真实消费者的 ElastiCache/Source Map bucket 不 provision；
- **OPS-04 只创建 ECS cluster/ECR/任务角色等基础资源；ECS Service 创建与部署设置（healthThreshold/minimumHealthyPercent/circuit breaker）属 OPS-05 所有**。

## 迁移方案

OPS-04 先把 ECS/Fargate 集群、ECR 仓库、任务角色与 RDS 基础资源作为**未来部署目标**建立；`ingestion-api`/`ingestion-worker` 在 OPS-05 使用不可变镜像部署到该目标；`platform-api`/`platform-worker`/SPA 在各自模块实现与 backend ADR accepted 后接入同一运行基座。**本 ADR 不授权任何服务部署**（运维评审 Minor #9）。

## 回滚方案

ECS 服务使用健康阈值、最小健康比例与部署熔断，失败回滚到上一已验证 task definition/digest（release-migration-and-rollback.md §4）；RDS 由自动备份 + PITR 保护；回滚必须兼容已执行的 expand Migration。

## 验证方式

- 真实 PostgreSQL 17.10 集成验证持续通过；
- 不可变镜像部署到 ECS 并通过健康检查（OPS-05 门禁）；
- 生产 RDS 删除保护/备份/加密通过 IaC 断言；
- 无真实消费者的 Redis/对象资源保持 absent（断言为 0 个）。

## 重新评估条件

- 事件量/规模超出第一版，需要扩缩容或分区；
- Redis/BullMQ 成为认证关键基础设施后无法达到可靠性/成本目标；
- 需要跨区域主动流量或双活；
- 托管服务方向因成本或能力变化被重新评估。
