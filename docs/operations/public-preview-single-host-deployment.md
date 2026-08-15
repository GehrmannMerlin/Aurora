---
title: Aurora 单主机部署（Provider-Neutral Single-Host）
status: approved
owner: operations
created: 2026-08-08
last-reviewed: 2026-08-15
applies-to: Aurora 临时公网预览桥接——现有阿里云单主机、Docker Compose、共享 nginx 边缘、固定 HTTPS 域名
related:
  - ../../AGENTS.md
  - ../../AURORA_RULES.md
  - ../architecture/deployment.md
  - ../architecture/formalization-readiness.md
  - ../architecture/ingestion-http-service.md
  - ../architecture/ingestion-worker-runtime.md
  - ../architecture/ingestion-inbox-data-model.md
  - ../releases/release-migration-and-rollback.md
  - ../testing/test-strategy.md
  - ../adr/ADR-008-ingestion-durable-buffering.md
  - ../adr/ADR-011-ingestion-http-service-runtime.md
  - ../adr/ADR-012-ingestion-worker-runtime.md
  - ../adr/ADR-022-aws-account-region-network-and-iac.md
supersedes: none
review-cycle: preview-lifecycle-or-replacement
---

# Aurora Public Preview 单主机部署桥接

## 1. 定位与效力

本文记录 **Aurora provider-neutral 单主机部署**（原 `public-preview` 单主机桥接）。它让当前已真实实现的 Aurora 应用（`apps/ingestion-api`、`apps/ingestion-worker`、`apps/console`）拥有一个真实公网运行环境，使用用户已有的阿里云 ECS 服务器与已绑定域名。

> **2026-08-13 转正（append-only）**：accepted [ADR-036](../adr/ADR-036-provider-neutral-single-host-deployment.md) 把本单主机部署从 `temporary-operational-snapshot` 转正为 **v1 正式部署路径**（`supersedes` ADR-022/023/024 的 AWS-first 方向）。"当前部署实例在阿里云" ≠ "架构绑定阿里云"；正式架构保持 provider-neutral，未来可迁移 AWS/其他云/托管数据库。第一版为 MVP/early-production single-host，不承诺 99.9% SLA / Multi-AZ / 自动故障转移 / 跨区域 DR。

**单主机早期生产定位（诚实记录）**：

- 单服务器、无 Multi-AZ、无正式 DR、无 99.9% production SLO；
- 不创建付费云资源（无 RDS、Redis、ALB、CDN、对象存储）；
- 只部署仓库中真实存在、真实 build/test 通过的应用；不创建 fake 服务；
- 由用户本地显式执行 `pnpm deploy:preview` 触发，不监听文件保存自动公网发布。

**替换条件（ADR-036 后更新）**：出现 ADR-036 重新评估条件（持续付费用户规模增长、单机资源逼近批准容量阈值、可用性需求升级、明确需要 Multi-AZ、数据驻留变化、单机故障造成不可接受业务影响、运营收入足以承担托管基础设施成本）时，经新 ADR 迁移到 managed/multi-node；否则本单主机部署保持 v1 正式路径。

## 2. 服务器部署边界

| 项            | 值                                                           |
| ------------- | ------------------------------------------------------------ |
| 服务器公网 IP | 47.238.145.24                                                |
| 主机名        | `iZj6c7vo9xptz3du2m0mx6Z`                                    |
| OS            | Ubuntu 24.04.4 LTS (x86_64)                                  |
| 资源          | 8 vCPU、14 GiB RAM（可用约 8.5 GiB）、根盘 99G（剩余约 48G） |
| Docker        | 29.6.2；Compose v5.3.1（enabled + running）                  |
| 部署目录      | `/opt/aurora-preview/{releases,current,shared,backups}`      |
| 环境标识      | `public-preview`（不是 production）                          |

`ecs-user` 位于 docker 组且有免密 sudo（`sudo -n` 验证通过）。SSH 使用既有密钥 `~/.ssh/lumina_ops_ed25519`。

## 3. 安全边界

- PostgreSQL 17 容器：private Docker network、**不映射公网 5432**、named volume 持久化；
- 强随机密码只存在于 `/opt/aurora-preview/shared/.env`（`chmod 600`）；不打印、不进 Git、不进镜像；
- Redis / 远程对象存储：**默认不提供**；只有当前真实 production path 需要时才评估；
- Worker 与数据库无公网端口；ingestion-api 仅经反向代理暴露；
- 公网只开放 TCP 80/443（经阿里云安全组）；SSH 22 保持现有访问方式；禁止公网 5432/6379/Worker 端口；
- 禁止上传 `.git`、`node_modules`、`coverage`、`.env`、secrets、本地凭证；
- 部署 manifest 记录 source checksum，避免把未验证源码上传公网。

## 4. 域名与 TLS

| 主机名                     | 用途                               | 类型  | 值            |
| -------------------------- | ---------------------------------- | ----- | ------------- |
| `aurora.ah.cn`             | Preview 状态页（Console 不存在时） | A     | 47.238.145.24 |
| `ingest.aurora.ah.cn`      | ingestion-api                      | A     | 47.238.145.24 |
| `www.aurora.ah.cn`（可选） | 仅在需要时                         | CNAME | aurora.ah.cn  |

TLS 使用宿主机 certbot（Let's Encrypt，http-01 webroot，已有 Lumina 续期机制）。**不使用自签名证书**。若未来真实 Console 存在，再切换 `aurora.ah.cn` 指向 Console。

### 4.1 共享 nginx 边缘（SERVER_CONFLICT 处置）

端口 80/443 由既有 Lumina 生产 nginx 容器（`lumina-prod-nginx-1`，Docker Compose 项目 `lumina-prod`，`/opt/lumina/app/deploy/compose.prod.yml`）持有，服务 `lumina.ac.cn`。这不是旧 Aurora Preview，是另一个正在运行的生产系统。

用户批准共享边缘方案：**不动 Lumina 的其它容器与服务，只在 nginx 上叠加 Aurora vhost**。

- Lumina nginx 镜像把 `default.conf` 烧进只读镜像，仅挂载 `/etc/letsencrypt` 与 `/var/www/certbot`；
- 因此叠加 Aurora vhost 采用：宿主机新增 `deploy/nginx/conf.d/` 只读挂载 + `docker compose up -d --no-deps nginx` 重建该 nginx 容器（同一镜像，不触碰 Lumina 其它容器）；
- 操作前先 `nginx -t` 预验证；仅当验证通过才生效；
- Lumina 继续服务 `lumina.ac.cn`，零停机；未知域名仍返回 444 / `ssl_reject_handshake`。

**nginx ownership 修复（2026-08-08）**：Lumina `deploy.sh` 重建 nginx 时原本只使用 `compose.prod.yml`，会把 Aurora vhost 挂载丢掉。已对 `/opt/lumina/app/deploy/scripts/deploy.sh` 做最小修改：新增 `AURORA_OVERRIDE`/`AURORA_COMPOSE`（含 `/opt/aurora-preview/deploy/compose.aurora-override.yml`），并让 nginx `up -d` 使用 `AURORA_COMPOSE`。Lumina 业务部署行为不变；备份为 `deploy.sh.bak-20260808`。这样 Aurora vhost ownership 独立于 Lumina 下次 deploy，不会因另一应用部署而下线。

Aurora vhost 路由：

- `aurora.ah.cn` → 明确标注的 Preview 状态页（不是产品 UI，不冒充 Console）；
- `ingest.aurora.ah.cn` → Aurora ingestion-api（Caddy 内网反代）。

## 5. 应用与反向代理

Docker Compose 编排真实存在的：

| 服务               | 镜像             | 公网端口 | 说明                                                                             |
| ------------------ | ---------------- | -------- | -------------------------------------------------------------------------------- |
| `postgres`         | PostgreSQL 17.10 | 无       | named volume、private network、healthcheck                                       |
| `migrate`          | 单次执行         | 无       | 动态发现并合并全部 workspace Migration；同一 advisory lock 内校验账本后执行      |
| `ingestion-api`    | 多阶段构建       | 无       | 只经共享 Lumina nginx 反代；加入 `aurora-preview` 与 `lumina-prod-internal` 网络 |
| `ingestion-worker` | 多阶段构建       | 无       | 无公网端口                                                                       |

**反向代理（共享 Lumina nginx 边缘）**：TLS 终止由宿主机 certbot（Let's Encrypt，http-01 webroot）与 Lumina nginx 承担；`ingest.aurora.ah.cn` → `ingestion-api:8080`（同 `lumina-prod-internal` 网络），`aurora.ah.cn` → 明确标注的 Preview 状态页。**不使用 Caddy**：共享边缘已由 Lumina nginx + 宿主机 certbot 完成 TLS 终止与反代，再引入 Caddy 会造成冗余二次代理；当未来独立部署时再评估独立边缘。

Node 版本由仓库真实 `engines`/`.node-version` 得出（`>=24.18.0 <25`，`.node-version` = 24.18.0）。镜像为 multi-stage 最小生产依赖、非 root、不复制 `.env`/`.git`/本地凭证、信号正确传播。

## 6. 更新工作流

```
本地 working tree
→ 本地质量门禁（pnpm check 适用项）
→ 受控源码同步（rsync over SSH，仅新 release 目录使用 --delete）
→ 服务器 release 目录
→ Docker build
→ Compose up
→ 顺序：database ready → migration → ingestion-api → worker → Caddy
→ 内网/公网 smoke test
→ 成功才原子切换 current
→ 输出部署 URL + release ID
```

单命令入口：

```bash
pnpm deploy:preview          # 显式触发公网更新
pnpm deploy:preview:rollback # 回滚到上一成功 release
```

不自动监听文件保存；只有显式执行 `deploy:preview` 才更新公网 Preview。回滚不直接回退破坏性 DB Migration（向后不兼容时停止并报告）。

## 7. 已知限制

- 单点故障，无 Multi-AZ、无正式 DR、无 production 99.9% 声明；
- 与 Lumina 共享 80/443 nginx 边缘，存在共同故障面；
- Preview 状态页仅说明部署环境在线，不是产品 UI；
- 容量/SLO/成本测量不适用于生产解释；
- 服务器重启后依赖 Docker `restart: unless-stopped` 自动恢复（需验证）。

## 8. 退出条件与未来替换

- **OPS-04**：不因本桥接标记 completed；G16 只记录为 `started / temporary-preview-bridge-active`；
- **完成/剩余叶子计数**不因本桥接改变；
- **替换条件**：G14 OPS-01 + G16 OPS-05 建立 approved CI/CD + 不可变制品流水线后，替换本桥接并重新评估正式 G16 基础设施架构；
- **AWS proposed ADR（ADR-022/023/024）**：保留 `proposed / not-started`。本桥接不表示用户拒绝 AWS 正式架构，也不表示接受；正式 G16 基础设施架构继续 deferred。

## 9. 临时例外记录

- owner：operations
- scope：public-preview only
- end condition：OPS-05 approved 部署流水线替换它
- security floor：不变（公网最小面、私密密钥、无公网数据库）
- privacy floor：不变（不采集请求/响应体、凭据、表单、完整 DOM/文本、完整行为轨迹、指纹或完整 IP）

本桥接作为临时部署路径记录，不创建多余 ADR；正式 G16 基础设施继续由 ADR-022/023/024（proposed）与 OPS-05 承载。
