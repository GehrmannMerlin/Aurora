# Aurora v1 单主机部署清单（2026-08-13）

> 本清单记录 Aurora v1 单主机部署的真实状态（accepted [ADR-036](../adr/ADR-036-provider-neutral-single-host-deployment.md) provider-neutral single-host）。第一版定位 MVP / early-production single-host，**不做 Multi-AZ、不做自动故障转移、不承诺 99.9% SLA**。任何测量值不得解释为生产容量/SLO/成本/最终推荐配置。

## 部署事实（2026-08-13）

- 服务器：47.238.145.24（阿里云 ECS，Ubuntu 24.04.4 LTS，8 vCPU / 14 GiB RAM）
- 环境：v1 single-host MVP（原 `public-preview` 桥接转正，见历史节）
- Docker：29.6.2；Compose v5.3.1；Node 24.18.0 / pnpm 11.17.0
- 域名：
  - `https://aurora.ah.cn/` → **Aurora Console Vue SPA（完整管理平台）**
  - `https://ingest.aurora.ah.cn/v1/batches` → ingestion-api
- 部署方式：受控 working-tree 部署（`pnpm deploy:preview` / 手动分步等价流程），Release ID 与 SHA 绑定
- **AURORA_RELEASE_SHA**：`31f8d47`（`fix/release-workflow-input` 分支，基于 `origin/main` `76b55ea` + 3 个部署修复 commit；尚未 merge 回 main）
- **Release ID**：`cd-31f8d47`（`/opt/aurora-preview/releases/cd-31f8d47`）
- `current` → `/opt/aurora-preview/releases/cd-31f8d47`
- **previous release / rollback target**：`cd-b3c10de`（`/opt/aurora-preview/releases/cd-b3c10de`）
- 部署时间：2026-08-13

## 已部署组件（cd-31f8d47，全部真实 build）

| 组件             | 镜像                                          | 状态    |
| ---------------- | --------------------------------------------- | ------- |
| postgres         | postgres:17.10-alpine（named volume）         | healthy |
| redis            | redis:7.4-alpine（in-memory）                 | healthy |
| migrate          | aurora-preview-migrate:cd-31f8d47             | completed（27 migrations） |
| ingestion-api    | aurora-preview-api:cd-31f8d47                 | healthy |
| ingestion-worker | aurora-preview-worker:cd-31f8d47              | up      |
| platform-api     | aurora-preview-platform-api:cd-31f8d47        | healthy |
| platform-worker  | aurora-preview-platform-worker:cd-31f8d47     | up      |
| console          | aurora-preview-console:cd-31f8d47（nginx SPA）| up      |

## 验证证据（2026-08-13，真实公网验收）

- PostgreSQL 17.10 真实运行，`pgmigrations` = **27**（含增量 13：processing-store fingerprint/issue/alert/symbolization + notifications + account-cleanup-steps + platform-admin ×2 + platform-policy ×3 + platform-releases；`error_event_occurrences` 存量行 backfill 为 `v1|js_error|:legacy|…`）；
- 全部 8 张平台新表存在（platform_admins、platform_audit_events、platform_resource_policies、organization_policy_overrides、project_policy_limits、releases、source_map_files、source_map_reparse_tasks）+ notifications、issues、alert_rules、account_cleanup_steps 等；
- `https://aurora.ah.cn/` → HTTP 200，返回当前 Release Console index.html（主 JS `index-D21m6M_Y.js`、CSS `index-2cnOryHH.css`，hash 与 cd-31f8d47 构建一致）；
- 真实 Chromium 公网验收：Vue 完整 boot、主导航可见、登录表单、注册表单（邮箱 3–320 / 密码 8–256 提示与 field 级错误）、SPA deep-link（/login、/register、/project/overview）均正常，无 fatal JS、无白屏、无 Invalid PrimeUI License banner；
- `POST /v1/batches` 无凭证 → HTTP 401（契约拒绝）；admission runtime 用代码默认值（maxEventsPerSecond=400、maxEventsPerBatch=50、body limit 1048576）；
- 公网端口：仅 80/443；PostgreSQL/Redis 无宿主端口映射（不公网暴露）；
- 部署后短日志：4 服务 running，无 fatal/panic/crash loop/migration failure。

## Git 工作区（部署时）

- branch：`fix/release-workflow-input`
- HEAD：`31f8d47`（`fix(deploy): declare @aurora/event-schema as runtime dep of data packages`）
- ancestry：`76b55ea`（origin/main，G15 78/0）→ `e78e8c1`（runner 补 platform-admin/policy/releases）→ `0c5bb1c`（checkOrder:false + fingerprint backfill）→ `31f8d47`（event-schema 依赖声明）
- **三个部署修复尚未 merge 回 main**（需用户后续决定合并）

## 限制声明

- 单服务器、无 Multi-AZ、无自动故障转移、无正式 DR、无 production 99.9% SLA 声明；
- 与 Lumina 共享 80/443 nginx 边缘（Aurora 仅维护 `aurora.ah.cn` + `ingest.aurora.ah.cn` vhost）；
- 非阻塞 debt：`LIVE_PUBLISH_CREDENTIAL_PENDING`、`LICENSE_PENDING`、`OFF_HOST_BACKUP_RECOMMENDED`、`KNOWN_BASELINE_DEBT`（main CI 测试隔离 42P07 / coverage / browser flake）、`REMOTE_INFRA_DEBT`、MVP recovery / production hardening；
- authenticated ingestion smoke / admission 429 smoke 未执行：服务器无 active client credential（`ingestion_client_credentials` 空），且 admission 校验在凭证校验之后（401 先返回）；复用 G08/ING-12 既有证据，不创建私人凭证。

---

## 历史（2026-08-08：Public Preview 桥接，已被 2026-08-13 v1 部署取代）

> 原清单内容，保留作历史。此桥接当时为 `temporary-operational-snapshot`，`aurora.ah.cn` 曾 serving Preview 状态页；2026-08-13 后 `aurora.ah.cn` 已由完整 Aurora Console 接管。

- Release ID：`20260808-012500`；`current` → `/opt/aurora-preview/releases/20260808-012500`；
- 8 个正式 Migration，`POST /v1/batches` 无凭证 401，error 事件 `pub-e2e-1` 端到端处理；
- TLS Let's Encrypt 证书（SAN `aurora.ah.cn` + `ingest.aurora.ah.cn`），续期已注册宿主机 certbot；
- Lumina nginx 共享边缘：`compose.aurora-override.yml` 只读挂载 Aurora vhost；Lumina 生产零停机。
