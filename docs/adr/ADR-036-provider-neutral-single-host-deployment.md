---
title: ADR-036：Provider-Neutral Single-Host Deployment for Aurora v1
status: accepted
implementation-status: not-started
approval-status: approved
owner: cloud/operations
date: 2026-08-13
last-reviewed: 2026-08-13
applies-to: Aurora 第一版生产部署架构——以 provider-neutral 单主机 Docker Compose 替代 AWS-first managed stack（账号/区域/VPC/ECS/RDS/ElastiCache/CloudFront/CDK/Multi-AZ）
related:
  - ../../AGENTS.md
  - ../../AURORA_RULES.md
  - '../../Aurora ADR 规范.md'
  - '../../Aurora 架构规范.md'
  - ../architecture/deployment.md
  - ../architecture/formalization-readiness.md
  - ../architecture/aws-region-account-network-iac-foundation.md
  - ../releases/release-migration-and-rollback.md
  - ../operations/backup-and-recovery.md
  - ../operations/public-preview-single-host-deployment.md
  - ../adr/ADR-022-aws-account-region-network-and-iac.md
  - ../adr/ADR-023-managed-compute-and-managed-data-services.md
  - ../adr/ADR-024-edge-dns-tls-secrets-and-encryption.md
  - ../superpowers/specs/2026-07-28-aurora-testing-deployment-release-design.md
supersedes: ADR-022, ADR-023, ADR-024
superseded-by: none
---

# ADR-036：Provider-Neutral Single-Host Deployment for Aurora v1

## 元数据

- 状态：proposed
- 决策状态：proposed
- 实施状态：not-started
- 审批状态：awaiting-review
- 日期：2026-08-13
- Owner：cloud/operations
- 适用范围：Aurora 第一版生产部署架构——运行单元、网络、数据库、缓存、对象存储、秘密、备份/恢复与部署/回滚的物理承载形态
- 关联 PRD：[核心业务 PRD](../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md)
- 关联技术方案：[部署架构](../architecture/deployment.md)（approved，待本 ADR 生效后同步修订）、[备份与恢复](../operations/backup-and-recovery.md)（approved，待同步修订）、[发布、Migration 与回滚](../releases/release-migration-and-rollback.md)（approved，待同步修订）、[Public Preview 单主机部署桥接](../operations/public-preview-single-host-deployment.md)（temporary-operational-snapshot，本轮转正为 v1 正式路径）
- 关联 Issue：none
- 关联实现 PR：none
- 替代 ADR：[ADR-022](ADR-022-aws-account-region-network-and-iac.md)、[ADR-023](ADR-023-managed-compute-and-managed-data-services.md)、[ADR-024](ADR-024-edge-dns-tls-secrets-and-encryption.md)
- 被替代 ADR：none
- 评审域：cloud/operations + security + data（非作者评审，见 §13）

## 状态说明

本 ADR 于 2026-08-13 由用户明确批准架构方向后创建为 `proposed / not-started / awaiting-review`。它正式替代 ADR-022/023/024 关于 AWS-first 生产部署的最终结论。在本 ADR 被标记为 `accepted` 前，不修改 ADR-022/023/024 的状态；只有 accepted 后才按 [ADR 规范](../ADR%20规范.md) 7.9 把三份旧 ADR 标记为 `superseded` 并回链本 ADR。

## 背景

ADR-022/023/024 在 2026-08-11 将第一版生产部署方向固定为 AWS managed stack（双账号、`ap-southeast-1`、CDK TypeScript、ECS/Fargate、RDS Multi-AZ、CloudFront/ALB + Route 53 + ACM + KMS/Secrets Manager + GitHub OIDC）。该方向要求 AWS 账号、AWS CLI 凭据、VPC、托管数据库/计算与边缘服务作为第一版硬前置，导致 OPS-04 被 `provisioning-evidence-pending` 阻塞、OPS-05/06/07 的真实验收被 `PROVISIONING_EVIDENCE_PENDING` 阻塞、G08（ING-13/ING-12）被 "AWS/RDS 环境" 门禁阻塞，无法在当前已真实运行的服务器上闭环。

与此同时，仓库已存在一个真实、可运行的单主机部署（[public-preview-single-host-deployment.md](../operations/public-preview-single-host-deployment.md)，`deploy/preview/` + `pnpm deploy:preview`），在用户已有的阿里云 Linux 主机（47.238.145.24）上以 Docker Compose 运行 PostgreSQL 17.10 + migration + `ingestion-api` + `ingestion-worker`，并经共享 nginx 边缘 + certbot 承载 HTTPS。该部署不依赖任何阿里云专有 SDK/API，全部使用 Linux + Docker + Compose + PostgreSQL 协议 + Redis 协议 + HTTP/TLS 标准能力。

用户 2026-08-13 明确批准：**Aurora v1 不再把 AWS 账号、AWS RDS、ECS/Fargate、CloudFront、ElastiCache、AWS CDK 或 Multi-AZ 作为第一版硬前置**；第一版改为 provider-neutral 单主机 MVP/early-production 部署；"当前部署实例在阿里云" ≠ "架构绑定阿里云"，正式架构必须保持 provider-neutral，未来可迁移到 AWS、其他云或托管数据库。

本 ADR 收口该决策，解除 G16/G08 的错误 AWS/RDS 硬门禁，并保持业务代码、可靠接收语义、事件协议、权限/隐私与数据生命周期规则不变。

## 决策驱动因素

- 当前真实业务规模（MVP/early-production）与 AWS managed stack 的运维/成本/账号/基础设施复杂度不匹配；
- 已存在真实可运行的单主机部署证据（`deploy/preview/` 已在真实主机验证），避免无谓的重建与运维负担；
- provider-neutral 原则：不绑定任何单一云供应商，未来迁移无需重写业务代码；
- 第一版仍必须满足可部署、可回滚、可备份、可恢复、数据删除重放、基本指标与告警、最小容量验证；
- 诚实记录 SLA/HA 降级，不宣称 99.9% SLA / Multi-AZ / 自动故障转移 / 跨区域 DR；
- 不修改任何业务规则（可靠接收、Inbox、Worker lease/fencing、事件协议、权限/隐私、账号删除语义、SEC-02 durable deletion intent、Source Map 私密语义、credential one-time secret、Issue/Alert/Notification）。

## 候选方案

### 方案 A：原 AWS managed production stack（ADR-022/023/024 方向）

双 AWS 账号 + `ap-southeast-1` + CDK TypeScript；ECS/Fargate 承载全部服务 + RDS PostgreSQL Multi-AZ + ElastiCache（deferred）；CloudFront/ALB + Route 53 + ACM + KMS/Secrets Manager + GitHub OIDC。

优点：

- 高可用、托管能力、长期扩展性强；
- 权限/成本/故障域隔离清晰；
- 与 IaC 可审查、可重复、可回滚的工程范式一致。

缺点：

- 当前阶段运维/成本/账号/基础设施复杂度过高；
- 依赖 AWS 账号与 AWS CLI 凭据，成为第一版可运行与验收的硬阻塞；
- 生产资源与部署流水线尚未真实 provisioning，无法闭环 G16 验收。

### 方案 B：Provider-neutral single-host Docker Compose（本轮选择）

当前部署实例为用户已有的阿里云 Linux 主机，但架构不依赖阿里云专有 API。运行组件为 Nginx + Aurora Console + `platform-api`/`ingestion-api` + worker + PostgreSQL + Redis + private storage adapter + backup/restore tooling，全部以 Docker Compose 编排。

优点：

- 与当前真实可运行部署一致（`deploy/preview/` 已在真实主机验证），闭环成本最低；
- provider-neutral：只依赖 Linux、Docker、Compose、filesystem/network、PostgreSQL 协议、Redis 协议、标准 HTTP/TLS，未来迁移云供应商无需重写业务代码；
- 第一版 MVP/early-production 规模下运维简单、成本可控；
- 仍满足可部署、可回滚、可备份、可恢复、删除重放、基本指标告警与最小容量验证。

缺点：

- 单点故障，无 Multi-AZ、无自动故障转移、无跨区域 DR；
- 单机本地备份不能抵御整机丢失（标记 `OFF_HOST_BACKUP_RECOMMENDED`，非本轮 blocker）；
- 不承诺高可用基础设施 SLA。

### 方案 C：Kubernetes / multi-node provider-neutral

Kubernetes 或多节点 provider-neutral 编排，实现跨节点调度与部分自愈。

优点：

- 适合长期规模增长与多节点编排；
- 保持 provider-neutral。

缺点：

- 明显超出第一版规模与运维能力（同 ADR-023 对 EKS 的判断）；
- 引入额外控制面与运维复杂度，与 MVP/early-production 定位不符；
- 记录为未来扩展方案，第一版不采用。

## 最终决策

**Aurora v1 采用方案 B：provider-neutral、single-host、Docker Compose based deployment。**

当前真实目标为用户的阿里云 Linux 服务器（47.238.145.24）。核心运行组件：Nginx（共享边缘 + TLS 终止）、Aurora Console（静态 SPA）、`platform-api` / `ingestion-api`、worker、PostgreSQL 17、Redis、private storage adapter、backup/restore tooling。关键理由：与已真实验证的单主机部署一致、闭环成本最低、provider-neutral 且未来可迁移，同时诚实满足第一版可部署/回滚/备份/恢复/删除重放/基本观测/最小容量验证。

第一版明确**不要求**：AWS account、AWS CLI、VPC、ECS/Fargate、RDS、ElastiCache、CloudFront、AWS CDK、Multi-AZ。

## 结果与影响

### 正面影响

- 解除 OPS-04/05/06/07 与 G08 的 AWS/RDS 硬门禁，G16 可在当前真实服务器闭环；
- provider-neutral，未来迁移 AWS/其他云/托管数据库无需重写业务代码；
- 复用已真实验证的 `deploy/preview/` 单主机部署证据，不重复建设；
- 运维与成本与 MVP/early-production 定位匹配。

### 负面影响与代价

- 第一版不具备高可用基础设施：无 99.9% SLA、无 Multi-AZ、无自动故障转移、无跨区域 DR；
- 单点故障与整机丢失风险（本地备份不能抵御整机丢失，标记 `OFF_HOST_BACKUP_RECOMMENDED`）；
- 放弃 ADR-022/023/024 已规划的托管能力与长期扩展底座，未来规模化需重新评估。

### 未解决问题

- 单机容量上限与扩容时机（G08 ING-13 在目标环境实测）；
- off-host 备份目标（OSS/S3-compatible/另一主机，本轮不实现，未来接入）；
- 正式生产域名与 DNS/TLS 归属（当前 `aurora.ah.cn`/`ingest.aurora.ah.cn` 为 Preview 域名，用户决定生产域名）。

## 实施约束

- **provider-neutral**：生产代码不得依赖 Aliyun SDK、Alibaba metadata API、Alibaba 专有 queue/database API；部署只依赖 Linux、Docker、Docker Compose、filesystem/network、PostgreSQL 协议、Redis 协议、标准 HTTP/TLS；
- 秘密不入库、不进 Git、不进镜像；`.env` 只存在于主机受保护目录（`chmod 600`）；客户端上报密钥只存摘要、一次性返回（ADR-013/014，不重开）；
- **单机秘密存储降级显式记录**：AWS 栈原用 Secrets Manager + KMS 静态加密，单机场景改用受保护主机目录 `.env`（无 KMS 静态加密），作为 early-production 最小方案；该降级可见、可由重新评估条件（成本/合规升级）覆盖；
- **边缘/传输安全底线以 provider-neutral 形式承接**（不因脱离 ADR-024 而弱化）：HTTPS only + HTTP 重定向 + HSTS，TLS ≥1.2 优先 1.3；nginx 层速率限制/`fail2ban` 等限流防护；日志不得包含秘密/请求体/凭据，发布流水线执行秘密扫描与日志脱敏检查；
- PostgreSQL 与 Redis 不直接暴露公网（private Docker network，公网仅 80/443，禁止公网 5432/6379/Worker 端口）；
- persistent volumes、restart policy、服务网络隔离、nginx vhost 归属必须明确；
- 与共享主机上其他系统共存时，只修改 Aurora 自己的 compose project/容器/目录/nginx vhost/volume，禁止 `docker system prune`、全局 nginx 覆盖、删除其他 compose project/volume、修改无关防火墙、停止其他服务；
- 业务规则不得因基础设施迁移而改变：可靠接收语义、PostgreSQL Inbox、Worker lease/fencing、事件协议、权限/隐私、账号删除语义、SEC-02 durable deletion intent、Source Map 私密语义、credential one-time secret、Issue/Alert/Notification 规则均不变。

## 迁移方案

把 `public-preview-single-host-deployment.md` 的单主机部署从 `temporary-operational-snapshot` 转正为 v1 正式部署路径；同步修订 deployment.md、backup-and-recovery.md、release-migration-and-rollback.md 与 OPS-04/05/06/07 规格，删除 AWS account/region/RDS-only/CDK/Multi-AZ 硬前置，替换为 target deployment host、target PostgreSQL/Redis、target private storage、single-host network、Docker Compose、real deployment evidence。`tooling/aws-infra`（CDK）与 `tooling/aurora-release` 作为历史实现保留，不再作为 v1 部署路径（不删除）。

## 回滚方案

回滚仅涉及文档与门禁修订，不改变业务代码；若本 ADR 需撤销，恢复 ADR-022/023/024 为 accepted 并回退对应文档修订。部署层回滚沿用 `pnpm deploy:preview:rollback`（回退到上一成功 release，不自动回退破坏性 Migration，向后不兼容时停止并报告）。

## 验证方式

- `docker compose config` 可解析（single-host manifest 合法）；
- 当前真实服务器可重复 deploy（`pnpm deploy:preview`）并通过 health smoke；
- PostgreSQL/Redis 无公网暴露、秘密不入库、persistent volumes 与 restart policy 明确；
- 最小 ingestion smoke（`POST /v1/batches`，专用 staging 测试凭证 + 最小安全 fixture）；
- focused PostgreSQL backup/restore 与 SEC-02 delete-replay bridge PASS；
- 基础 observability/health smoke 可用；
- G08 ING-13 使用当前真实目标 PostgreSQL 记录 CPU/RAM/版本/参数并真实测量容量，不用开发机 PostgreSQL 冒充目标服务器。

## 重新评估条件

出现以下任一条件时，重新评估 managed/multi-node 方向（可能新增 ADR）：

- 持续真实付费用户规模增长；
- 单机资源逼近批准容量阈值；
- 可用性需求升级；
- 明确需要 Multi-AZ；
- 数据驻留要求变化；
- 单机故障造成不可接受业务影响；
- 运营收入足以承担托管基础设施成本。

## 评审与状态记录

> **2026-08-13 非作者评审（lightweight，仅评本 ADR）**：结论 **ACCEPT，无 blocking**。逐项 PASS（模板符合性、AWS-first→single-host 方向改变表达、安全/隐私无倒退、migration/rollback 合理、重新评估条件明确、supersede 关系正确）。两条非阻塞改进建议已并入 §实施约束：(1) 边缘/传输安全底线（HTTPS/HSTS/TLS 最低版本/限流/日志脱敏+秘密扫描）以 provider-neutral 形式承接；(2) 单机秘密存储降级（无 KMS 静态加密的 `.env`）显式记录。

> **2026-08-13 用户批准（append-only）**：用户于 2026-08-13 明确批准 "Provider-Neutral Single-Host MVP" 架构方向，本 ADR 决策状态由 `proposed` 更新为 `accepted`、审批状态 `approved`、实施状态 `not-started`（实施状态由 OPS-04/05/06/07 与 G08 迁移进度承载）。ADR-022/023/024 据此标记为 `superseded by ADR-036`。
