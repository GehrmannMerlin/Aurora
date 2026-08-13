---
title: Aurora 第一版部署架构
status: approved
owner: cloud/operations
last-reviewed: 2026-08-13
applies-to: Aurora 第一版 provider-neutral 单主机部署——运行单元、网络、配置、秘密与制品拓扑
related:
  - ../../AURORA_RULES.md
  - ../../Aurora 架构规范.md
  - system-overview.md
  - platform-backend.md
  - ../testing/test-strategy.md
  - ../releases/release-migration-and-rollback.md
  - ../operations/backup-and-recovery.md
  - ../operations/public-preview-single-host-deployment.md
  - ../adr/ADR-036-provider-neutral-single-host-deployment.md
  - ../adr/README.md
supersedes: none
review-cycle: infrastructure-or-release-change
---

# Aurora 第一版部署架构

## 1. 当前效力

本文正式承载 Aurora 第一版 **provider-neutral 单主机 Docker Compose** 部署设计（由 accepted [ADR-036](../adr/ADR-036-provider-neutral-single-host-deployment.md) 收口，`supersedes` ADR-022/023/024 的 AWS-first 方向）。当前真实目标为用户已有的 Linux 云主机（阿里云 ECS，47.238.145.24），但架构不依赖阿里云专有 API；生产代码只依赖 Linux、Docker、Docker Compose、filesystem/network、PostgreSQL 协议、Redis 协议与标准 HTTP/TLS，未来迁移 AWS/其他云/托管数据库无需重写业务代码。

第一版为 **MVP/early-production single-host**，不承诺高可用基础设施 SLA（无 99.9% SLA、无 Multi-AZ、无自动故障转移、无跨区域 DR）。第一版明确**不要求** AWS account、AWS CLI、VPC、ECS/Fargate、RDS、ElastiCache、CloudFront、AWS CDK 或 Multi-AZ。

> **历史（append-only）**：ADR-022/023/024 曾将第一版方向固定为 AWS managed stack；2026-08-13 由 ADR-036 正式替代。`tooling/aws-infra`（CDK）与 `tooling/aurora-release` 作为历史实现保留、不再作为 v1 部署路径（不删除）。

## 2. 环境

| 环境 | 用途 | 隔离要求 |
|---|---|---|
| 本地/临时 | 开发、契约和有限集成 | 不连接生产数据、秘密或账号 |
| CI | 可重复构建、测试和制品生成 | 短期身份、最小权限、任务结束清理 |
| 预发布/Preview | 生产前验证、Migration/恢复烟雾 | 与生产同类服务形态，不共享生产数据 |
| 生产 | 第一版真实业务 | 独立主机、独立 `.env`、独立 volume 与数据库 |

单主机承载全部运行组件；不要求多账号隔离。数据库、Redis、对象与备份凭据不因便利共享。

## 3. 运行拓扑（Docker Compose 单主机）

- 边缘：宿主机 Nginx（与共享主机其他系统共存时，只叠加 Aurora vhost，只 reload 不 recreate 其他容器）＋ certbot（Let's Encrypt，http-01 webroot）终止 TLS；
- `console`：Vue 3 SPA 静态构建，经 Nginx 反代，无 DB/API 依赖；
- `platform-api` / `ingestion-api`：Fastify 服务，仅经 Nginx 反代，不映射公网端口；
- worker：`ingestion-worker` / `platform-worker`，无公网端口；
- `postgres`：PostgreSQL 17 容器，named volume 持久化，private Docker network；
- `redis`：Redis 7（Session 权威，in-memory，`--appendonly no`），private network；
- 私密对象：private storage adapter（本地受保护目录；off-host 对象存储为 future，本轮不实现新云对象存储）；
- `migrate`：单次执行，合并正式 Migration；
- backup/restore tooling：本地加密/私有备份 + 明确备份目录与保留策略。

## 4. 网络与安全边界

- 公网仅开放 TCP 80/443；禁止公网 5432/6379/Worker 端口；
- PostgreSQL/Redis/Worker/私密对象只存在于 private Docker network；
- 秘密不入库、不进 Git、不进镜像；`.env` 只存在于主机受保护目录（`chmod 600`）；客户端上报密钥只存摘要、一次性返回（ADR-013/014，不重开）；
- 单机场景无 KMS 静态加密，`.env` 为受保护目录最小方案（显式降级记录，见 ADR-036）；
- HTTPS only + HTTP 重定向 + HSTS，TLS ≥1.2 优先 1.3；Nginx 层速率限制/`fail2ban` 等限流防护；日志不得包含秘密/请求体/凭据，发布流水线执行秘密扫描与日志脱敏检查；
- persistent volumes、restart policy（服务 `unless-stopped`，migrate `no`）与 nginx vhost 归属必须明确；
- 与共享主机上其他系统共存时，只修改 Aurora 自己的 compose project/容器/目录/nginx vhost/volume，禁止 `docker system prune`、全局 nginx 覆盖、删除其他 compose project/volume、修改无关防火墙、停止其他服务。

## 5. 制品与供应链

API/Worker/Console 使用多阶段最小生产镜像（非 root、不复制 `.env`/`.git`/本地凭证、信号正确传播），按 RELEASE_ID/digest 晋级；SDK npm 包使用 SemVer、精确文件清单和打包后导出/体积/安装验证。生产只能部署已在预发布验证的同一不可变制品，不从生产分支重新构建。发布清单必须能追溯提交、构建、SBOM、来源证明、镜像摘要、Schema/协议兼容和数据库 Migration。

## 6. 可观测性与运行门禁

部署设计要求覆盖 Edge/API、PostgreSQL、Redis、处理链路、产品不变量和前端发布版本信号：service/container health、ingestion health、worker health、PostgreSQL health、processing/error 日志与基础应用 metric。产品告警（DAT-19）与运行告警（OPS-06）严格分离。实际阈值、告警渠道、值班 Owner 与成本预算为 `deferred`；运行资源与演练不存在时不能宣称满足生产 SLO。
