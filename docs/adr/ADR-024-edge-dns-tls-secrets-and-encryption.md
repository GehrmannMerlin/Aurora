---
title: ADR-024：边缘、DNS、TLS、秘密与加密（CloudFront/Route 53/ACM、KMS/Secrets Manager/GitHub OIDC）
status: accepted
implementation-status: in-progress
approval-status: approved
owner: cloud/operations
date: 2026-08-07
last-reviewed: 2026-08-07
applies-to: Aurora 第一版边缘入口（CloudFront/ALB）、DNS 与 TLS（Route 53/ACM）、秘密与加密（KMS/Secrets Manager）以及跨账号部署身份（GitHub OIDC）的基础资源决策
related:
  - ../../AGENTS.md
  - ../../AURORA_RULES.md
  - '../../Aurora ADR 规范.md'
  - '../architecture/deployment.md'
  - '../architecture/aws-region-account-network-iac-foundation.md'
  - '../architecture/formalization-readiness.md'
  - '../adr/ADR-009-ingestion-transport-and-client-credential.md'
  - '../adr/ADR-013-ingestion-client-credential-storage-and-verification.md'
  - '../adr/ADR-014-ingestion-client-credential-lifecycle.md'
  - '../superpowers/specs/2026-07-28-aurora-testing-deployment-release-design.md'
  - '../superpowers/specs/2026-07-28-aurora-platform-backend-design.md'
supersedes: none
superseded-by: none
---

# ADR-024：边缘、DNS、TLS、秘密与加密（CloudFront/Route 53/ACM、KMS/Secrets Manager/GitHub OIDC）

## 元数据

- 状态：accepted
- 决策状态：accepted
- 实施状态：in-progress
- 审批状态：approved
- 日期：2026-08-07
- Owner：cloud/operations
- 适用范围：Aurora 第一版边缘入口（CloudFront/ALB）、DNS 与 TLS（Route 53/ACM）、秘密与加密（KMS/Secrets Manager）以及跨账号部署身份（GitHub OIDC）的基础资源决策
- 关联 PRD：[核心业务 PRD](../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md)
- 关联技术方案：[部署架构](../architecture/deployment.md)（approved）、[AWS 区域、账号、网络与 IaC 基础设施基础（OPS-04）](../architecture/aws-region-account-network-iac-foundation.md)（proposed）、[测试/部署/发布设计](../superpowers/specs/2026-07-28-aurora-testing-deployment-release-design.md)（approved）
- 关联 Issue：none
- 关联实现 PR：none
- 替代 ADR：none
- 被替代 ADR：none
- **评审域**：infra topology（cloud/operations）+ security（KMS/Secrets/OIDC）。本 ADR 把边缘/DNS/TLS（基础设施）与秘密/加密（安全）合为一份，对应已批准 TDR 候选 5（"AWS 运行与 IaC：账号/环境、CloudFront/S3、ECS/Fargate、RDS、ElastiCache、S3、网络与 CDK"是单一候选）。**评审门禁要求 cloud/operations 与 security 两域评审者均批准；若任一方无法联合批准，本 ADR 必须按 ADR 规范 7.2/7.7 拆分为边缘/DNS/TLS 与秘密/加密两份**（架构评审 Major #3；formalization-readiness §7"Owner、评审者、迁移/回滚边界不同的安全、数据、基础设施…决定必须拆分"）。

## 状态说明

本 ADR 于 2026-08-07 由 G16/OPS-04 前置门禁创建为 `proposed / not-started / awaiting-user-approval`。门禁确认：边缘拓扑、DNS/TLS、秘密与加密边界均有 approved 设计方向（CloudFront/ALB、Route 53/ACM、KMS/Secrets Manager/OIDC），但无 accepted 决策、无真实域名/证书/资源。本 ADR 只记录候选与推荐，**在用户批准前不得创建 CloudFront/ACM/Route 53 记录/KMS/Secrets，不得购买域名、不得申请真实生产证书**。

> **2026-08-11 用户批准（append-only）**：用户正式批准 G16/OPS-04 Cloud Decision Package 中 D4/D5/D6/D1 推荐方案，本 ADR 决策状态由 `proposed` 更新为 `accepted`，审批状态 `approved`。批准内容：**方案 A——CloudFront/ALB 边缘 + Route 53 + ACM（DNS 验证）+ KMS/Secrets Manager + GitHub OIDC 短期身份**。生产/staging 域名值仍由用户持有并提供（D4/D5/D6：生产与 Preview 域名分离、DNS ownership 明确、staging 独立子域与证书），OPS-04 用占位域名做边界契约、不购买域名、不写未知域名进正式配置、不创建真实 DNS/ACM/CloudFront 记录；每个公开入口（CloudFront/ALB 含 ingestion 公开 host）必须部署 WAF 与速率限制、HTTPS only + HSTS、TLS ≥1.2 优先 1.3；秘密进 Secrets Manager + KMS、非秘密配置进 Parameter Store/版本化部署配置；OIDC 角色按仓库 + environment 钉住 `sub`/`aud`、生产/非生产角色分离；生产账号启用 CloudTrail。实施状态由 OPS-04 实施进度承载（`in-progress`：IaC 基础工程已创建，真实域名/证书/资源与 OPS-05 部署仍 not-started）。

## 背景

Aurora 已批准最小公网面、仅必要入口公开、GitHub OIDC 短期凭据、配置与秘密分离、HTTPS 强制。数据接入公开传输与客户端上报密钥已由 ADR-009/013/014 收口（`POST /v1/batches`、`X-Aurora-Client-Key`/`X-Aurora-Environment`、Origin 匹配、密钥只存摘要）。但生产/staging 域名、DNS 归属、证书签发、边缘入口拓扑与秘密/加密边界均无 accepted 决策。当前真实公开服务只有 `ingestion-api`（`POST /v1/batches`）；`console`/`platform-api` 尚无真实实现。边缘/DNS/TLS/秘密与加密需要独立 ADR，才能为 OPS-05 提供可部署的公网入口与安全基础。

## 决策驱动因素

- 最小公网面与数据保护；
- 域名归属与证书生命周期；
- 秘密与加密边界（谁持有、谁轮换、谁可读）；
- 跨账号部署身份（OIDC 替代长期密钥）；
- 与已批准数据接入传输语义（ADR-009）一致；
- 日志与审计脱敏；
- 不购买域名、不泄露凭证。

## 候选方案

### 方案 A：CloudFront/ALB 边缘 + Route 53 + ACM + KMS/Secrets Manager + GitHub OIDC

- console：CloudFront + 私有 S3；console API：CloudFront `/api` → ALB → 未来 `platform-api`；ingestion：独立公开 hostname → `ingestion-api`；
- DNS：域名归用户所有，Route 53（或现有 DNS provider）承载记录，ACM DNS 验证签发证书；
- 秘密：Secrets Manager + KMS；配置：SSM Parameter Store/版本化部署配置；
- CI：GitHub OIDC 交换短期 AWS 凭据，生产角色与非生产角色分离，无长期 AWS Access Key。

优点：

- 与已批准部署/发布设计一致；不可变、可审计；
- OIDC 消除长期云密钥暴露面；
- 秘密与配置分离，密钥生命周期已有 ADR-013/014 语义。

缺点：

- 需要真实域名与 DNS 归属决策（用户输入）；
- ACM/CloudFront 证书区域注意（us-east-1）与 DNS 验证流程；
- OIDC 角色与信任策略需在 OPS-05 流水线落位。

### 方案 B：只走 ALB 不做 CloudFront / 直接暴露服务端口

优点：

- 更少组件。

缺点：

- SPA 静态缓存与 CDN 能力缺失，与已批准 SPA=CloudFront 方向不一致；
- 暴露面更大、无 CDN 防护；
- 不作为第一版候选。

### 方案 C：长期 AWS Access Key 存储在 CI / 明文环境

优点：

- 配置简单。

缺点：

- 与 deployment.md/TDR 已 approved 的 OIDC 短期凭据方向冲突；
- 泄露风险高；
- 明确不采用。

## 最终决策

**已批准（2026-08-11，Decision Package D4/D5/D6/D1）。** 用户批准方案 A：**CloudFront/ALB 边缘 + Route 53 + ACM（DNS 验证）+ KMS/Secrets Manager + GitHub OIDC 短期身份**。生产域名值由用户持有并在 OPS-05 provisioning 前提供（占位契约，不购买/不写死未知域名）；staging 使用独立子域与独立证书，与生产记录/证书分离；每个公开入口部署 WAF 与速率限制；HTTPS only + HTTP 重定向 + HSTS，TLS ≥1.2 优先 1.3；秘密进 Secrets Manager + KMS，非秘密配置进 Parameter Store/版本化部署配置；CI 使用 GitHub OIDC 短期凭据（按仓库 + environment 钉住 `sub`/`aud`，生产/非生产角色分离），无长期云密钥；生产账号启用 CloudTrail。OPS-04 建立边缘/安全边界与 IaC 基础，真实域名、证书、DNS 记录与边缘资源由 OPS-05 provisioning 落位。

## 结果与影响

### 正面影响

- 公网入口受控、可回滚、可审计；
- 证书与秘密生命周期明确；
- 无长期云密钥。

### 负面影响与代价

- 需要用户提供域名与 DNS 归属（不能由 Claude 购买或擅自决定）；
- OIDC 与 ACM 运维需在 OPS-05 落位。

### 未解决问题

- 生产/staging 域名具体值（用户决策）；
- DNS provider 与委托方式（用户决策）；
- 精确 HSTS/证书头策略（安全评审与 IaC 评审产生）。

## 实施约束

- 只有 CloudFront/ALB 等必要入口公开；数据库/Redis/Worker/私密对象无公网入口；
- **每个公开入口（CloudFront/ALB，含 ingestion 公开 host）必须部署 WAF 与速率限制，ingestion 入口终止于 ALB/CloudFront，不直接暴露 ECS target**（来自已批准 TDR §4.3"公共入口的 DDoS/WAF、速率限制、CSP/HSTS、TLS 和安全头参数需在安全评审中锁定"）；
- HTTPS only、HTTP 重定向、HSTS；ACM 证书 DNS 验证；**最低 TLS ≥1.2，优先 1.3**；
- 秘密进 Secrets Manager + KMS，非秘密配置进 SSM Parameter Store/版本化部署配置；秘密不写入镜像/仓库/构建日志/前端资源；
- CI 不保存长期 AWS access key，使用 GitHub OIDC 短期凭据，生产角色与非生产角色分离；**OIDC 信任策略必须按仓库 + environment 钉住 `sub`、钉住 `aud`，环境范围最小化（安全评审 Minor #6）**；
- 客户端上报密钥只存摘要、一次性返回（ADR-013/014 语义，不重开）；
- 日志不得包含秘密/请求体/凭据；发布流水线执行秘密扫描与日志脱敏检查；
- 生产账号启用 CloudTrail（全区域，含 S3/Secrets Manager 数据事件）与安全告警（安全评审 Minor #3）；SPA 私有 S3 仅通过 CloudFront OAC 可达（安全评审 Minor #2）。
- 不购买域名、不把用户未知域名写成正式配置。

## 迁移方案

先由用户提供域名与 DNS 归属；在目标账号/区域用 IaC 创建 ACM 证书（DNS 验证）、CloudFront/ALB、Route 53 记录与 OIDC 角色；再把 `ingestion-api` 作为第一批公网 workload 接入；`console`/`platform-api` 实现后接入同一边缘拓扑。

## 回滚方案

边缘/证书/记录均由 IaC 管理，可整体重建；生产证书过期与 DNS 故障有独立 Runbook；回滚不得改变数据接入传输语义（ADR-009）。

## 验证方式

- HTTPS only/重定向/HSTS 通过外部探测验证；
- OIDC 角色按环境隔离，生产角色无长期密钥；
- 秘密扫描与日志脱敏在 CI 生效；
- 公网面最小化通过网络可达性验证。

## 重新评估条件

- 出现新的公开服务形态（SSR、独立客户端）；
- 域名/合规要求变化；
- 数据接入传输语义变化；
- 证书或 DNS 可靠性问题。
