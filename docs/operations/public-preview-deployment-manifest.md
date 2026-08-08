# Aurora Public Preview — 部署清单（2026-08-08）

> 本清单记录 Public Preview 单主机桥接的真实部署状态。任何测量值不得解释为生产容量/SLO/成本/最终推荐配置。

## 部署事实

- 服务器：47.238.145.24（阿里云 ECS，Ubuntu 24.04.4 LTS，8 vCPU / 14 GiB RAM）
- 环境：`public-preview`（非 production）
- Docker：29.6.2；Compose v5.3.1；Node 24.18.0 / pnpm 11.17.0
- 域名：`aurora.ah.cn`（Preview 状态页）、`ingest.aurora.ah.cn`（ingestion-api）
- 部署方式：受控 working-tree 部署（`pnpm deploy:preview`），非 CI/CD

## 已部署组件（全部真实 build/test 通过）

| 组件             | 镜像                                   | 状态                      |
| ---------------- | -------------------------------------- | ------------------------- |
| postgres         | postgres:17.10-alpine                  | healthy                   |
| ingestion-api    | aurora-preview-api:20260808-012500     | healthy                   |
| ingestion-worker | aurora-preview-worker:20260808-012500  | up                        |
| migrate          | aurora-preview-migrate:20260808-012500 | completed（8 migrations） |

- Release ID：`20260808-012500`（`/opt/aurora-preview/releases/20260808-012500`）
- `current` → `/opt/aurora-preview/releases/20260808-012500`

## 验证证据

- PostgreSQL 17.10 真实运行，8 个正式 Migration 全部执行（inbox×3 + credentials×1 + processing-store×4），`pgmigrations` 记录完整；
- 全部 12 张数据表 + pgmigrations 存在；
- `POST /v1/batches` 无有效凭证 → HTTP 401（契约拒绝）；
- 端到端处理：error 事件 → inbox `processed` → `error_event_occurrences`（`error_category=javascript`）；
- SIGTERM → API 优雅退出（ExitCode 0）；
- `restart: unless-stopped` 已配置（服务器重启自动恢复）。

## Git 工作区

- branch：main
- HEAD：`de85663`
- dirty：true（含未提交 G01 实现，本轮用户明确授权同步 working tree）
- changed files：101

## 限制声明

- 单服务器、无 Multi-AZ、无正式 DR、无 production 99.9% 声明；
- 与 Lumina 共享 80/443 nginx 边缘；
- 本桥接不是 OPS-04 completed、不是 G16 completed；G16 状态 `started / temporary-preview-bridge-active`；
- 完成/剩余叶子计数不因本桥接改变。

## 公网 HTTPS 状态（2026-08-08，已上线）

- 部署栈：**已上线并健康**（postgres / migrate / api / worker，真实 PostgreSQL 验证通过）；
- 公网 URL（可访问）：
  - `https://aurora.ah.cn/` → **200**，明确标注的 Preview 状态页（非假 Console）；
  - `https://ingest.aurora.ah.cn/v1/batches` → **401**（契约拒绝，无有效凭证）；
  - HTTP → HTTPS 301 重定向正常；
- TLS：Let's Encrypt 证书已签发（SAN 覆盖 `aurora.ah.cn` + `ingest.aurora.ah.cn`），有效期至 2026-11-05，续期已注册到宿主机 certbot；
- 共享边缘：Lumina nginx 经 `compose.aurora-override.yml` 只读挂载 Aurora vhost + 状态页；**Lumina 生产零停机**（`lumina.ac.cn` 200，nginx healthy）；`--no-deps` 只重建 nginx，其它容器未动；
- 端到端验证：error 事件 `pub-e2e-1` → inbox `processed` → `error_event_occurrences`（`error_category=javascript`）；
- 端口审计：仅公网 80/443；无公网 5432/8080/6379；
- Worker：`running`，restart=0（无 crash loop）；DB accepting connections；
- 重启恢复：`restart: unless-stopped` 已配置并验证（容器可自动恢复）。

> 说明：Lumina 下次 `deploy.sh` 重建 nginx 会移除 Aurora vhost，需重新应用 `compose.aurora-override.yml`（记录于 `public-preview-single-host-deployment.md`）。
