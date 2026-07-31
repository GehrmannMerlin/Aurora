---
title: Aurora 第一版部署架构
status: approved
owner: cloud/operations
last-reviewed: 2026-07-29
applies-to: Aurora 第一版环境、AWS 账号、网络、运行单元、配置、秘密和制品拓扑
related:
  - ../../AURORA_RULES.md
  - ../../Aurora 架构规范.md
  - system-overview.md
  - platform-backend.md
  - ../testing/test-strategy.md
  - ../releases/release-migration-and-rollback.md
  - ../operations/backup-and-recovery.md
  - ../adr/README.md
  - ../superpowers/specs/2026-07-28-aurora-testing-deployment-release-design.md
supersedes: none
review-cycle: infrastructure-or-release-change
---

# Aurora 第一版部署架构

## 1. 当前效力

本文正式承载 approved AWS 单主云部署设计。它不证明 AWS 账号、VPC、ECS、数据库、Redis、Bucket、DNS、证书、KMS、秘密或 IaC 已经创建。主区域、精确拓扑、容量和成本为 `deferred`/`requires-benchmark`；AWS/IaC 长期选择为 `requires-accepted-adr`。

## 2. 环境与账号

| 环境 | 用途 | 隔离要求 |
|---|---|---|
| 本地/临时 | 开发、契约和有限集成 | 不连接生产数据、秘密或账号 |
| CI | 可重复构建、测试和制品生成 | 短期身份、最小权限、任务结束清理 |
| 预发布 | 生产前验证、Migration/E2E/恢复烟雾 | 与生产同类服务和配置形态，不共享生产数据 |
| 生产 | 第一版真实业务 | 独立生产账号、VPC、KMS、秘密和数据；受保护人工批准 |

至少隔离非生产与生产 AWS 账号。是否增加管理、日志/备份专用账号属于 `requires-accepted-adr`；任何环境都不能共享生产数据库、Session Redis、BullMQ、对象 Bucket 或加密密钥。

第一版采用单主区域、生产多可用区，不承诺跨区域主动流量。主区域取决于目标用户地域、数据驻留、服务可用性、延迟和成本，当前为 `deferred`。区域级恢复依靠跨区域备份与重建，不宣称自动故障转移。

## 3. 运行拓扑

- 管理平台 SPA：私有 S3 源＋CloudFront；
- 平台 API：ALB 后的 ECS/Fargate `platform-api`；
- 后台任务：独立 ECS/Fargate `platform-worker`；
- 平台关系数据：RDS PostgreSQL Multi-AZ；
- Session、BullMQ 与普通缓存：ElastiCache Redis，但使用隔离角色/命名空间、容量和故障边界；
- Source Map 等私密对象：私有 S3；
- 数据接入和处理：逻辑边界已批准，物理队列/存储和扩缩容仍为 `requires-accepted-adr`。

推荐 CloudFront 同一管理平台主机承载 SPA，并将 `/api/*` 转发到受控 ALB；API 响应不得被 CDN 缓存。SDK 数据接入使用独立公开主机和客户端上报密钥，不共享浏览器 Session。

## 4. 网络与安全边界

- 只有 CloudFront/ALB 等必要入口公开；数据库、Redis、Worker 和私密对象保持私网/受控端点；
- 生产任务使用最小 IAM 角色，人与工作负载身份分离；跨账号部署使用 GitHub OIDC 短期凭据，不保存长期云密钥；
- 配置与秘密分离：普通配置进入版本化部署配置或 Parameter Store，秘密/签名/Pepper/外部凭据进入 Secrets Manager 与 KMS；
- Session、队列、缓存、对象和数据库不能因便利共享凭据或故障域；
- 资源命名与标签至少包含系统、环境、Owner、数据分类和成本归属；
- 生产删除保护、保留策略和高风险 IAM 变化需要独立审批。

实际子网、Security Group、WAF、端点和 KMS 策略属于 `implementation-detail`，必须由 accepted ADR 与 IaC 评审产生。

## 5. 制品与供应链

API/Worker 容器在 ECR 中按 digest 晋级；SPA 使用内容哈希和版本前缀；SDK npm 包使用 SemVer、精确文件清单和打包后导出/体积/安装验证。生产只能部署已在预发布验证的同一不可变制品，不从生产分支重新构建。

发布清单必须能追溯提交、构建、SBOM、来源证明、镜像/包摘要、Schema/协议兼容和数据库 Migration。签名/来源验证失败、SBOM 缺失或存在未豁免高危问题时阻止晋级。

## 6. 可观测性与运行门禁

部署设计要求覆盖 Edge/API、PostgreSQL、Redis/BullMQ、处理链路、S3、产品不变量和前端发布版本信号。无所有者组织、重复任务、删除/策略传播停滞、审计失败和一次性秘密异常重显属于产品不变量告警。

实际阈值、告警渠道、值班 Owner、生产批准者和成本预算为 `deferred`；运行资源和演练不存在，不能宣称可部署或满足 SLO。
