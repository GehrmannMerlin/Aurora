# Aurora Public Preview（单主机部署桥接）

本目录定义 Aurora 临时公网预览桥接（`public-preview`）的部署资产。它让当前已真实实现的 Aurora 应用（`apps/ingestion-api`、`apps/ingestion-worker`、`apps/platform-api`、`apps/platform-worker`、`apps/console`）在用户现有阿里云单主机上运行并暴露到公网固定 HTTPS 域名。

**这不是正式生产架构，不是 OPS-04 completed，不是 G16 completed。** 详细运行边界见 [docs/operations/public-preview-single-host-deployment.md](../../docs/operations/public-preview-single-host-deployment.md)。

## 内容

| 文件                          | 用途                                                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `compose.yaml`                | Docker Compose：postgres + migrate + redis + ingestion-api + ingestion-worker + platform-api + platform-worker + console |
| `Dockerfile.ingestion-api`    | ingestion-api 多阶段生产镜像（Node 24.18、非 root、最小生产依赖）                                                        |
| `Dockerfile.ingestion-worker` | ingestion-worker 多阶段生产镜像                                                                                          |
| `Dockerfile.platform-api`     | platform-api（G10 平台 HTTP 服务）多阶段生产镜像                                                                         |
| `Dockerfile.platform-worker`  | platform-worker（平台 Outbox 邮件消费者）多阶段生产镜像                                                                  |
| `Dockerfile.migrate`          | Migration 运行器镜像（合并正式 Migration）                                                                               |
| `entry/`                      | 部署专用薄入口（plain ESM，非包构建产物）                                                                                |
| `.env.example`                | 服务器共享环境变量示例                                                                                                   |

## 拓扑

- `postgres`：PostgreSQL 17，named volume，private network，无公网端口；
- `redis`：ADR-030 Session 权威存储，内存态（`appendonly no`），仅 private network，无公网端口；重启会清空 Session（预览桥接可接受）；
- `migrate`：动态发现 `apps/*`、`packages/*`、`tooling/*` 下的全部正式 Migration；执行前在同一 advisory lock 内校验冻结生产账本与严格单调的新迁移；
- `ingestion-api`：经共享 Lumina nginx 边缘反代（`ingest.aurora.ah.cn`）；
- `ingestion-worker`：无公网端口，私有网络消费 Inbox；
- `platform-api`：G10 平台 HTTP 服务（`/api/platform/v1/...`），与 Console 同源经共享 Lumina nginx 边缘反代，无公网端口；
- `platform-worker`：无公网端口，私有网络消费平台 Outbox；公网 Preview 必须显式使用阿里云 DirectMail；
- `console`：Vue SPA（nginx 静态服务），经共享 Lumina nginx 边缘反代（`aurora.ah.cn`）。

**共享边缘**：端口 80/443 由既有 Lumina 生产 nginx 持有。Aurora 不单独占用公网端口；TLS 由宿主机 certbot（Let's Encrypt）签发，Lumina nginx 反代 Aurora vhost。不使用 Caddy（避免冗余二次代理）。

## 命令

在仓库根目录执行：

```bash
pnpm deploy:preview          # 本地质量门禁 → 同步 → 远程构建 → 迁移 → 启动 → smoke test
pnpm deploy:preview:rollback # 回滚到上一成功 release
```

不监听文件保存；只有显式执行 `deploy:preview` 才更新公网 Preview。

## 服务器布局

```
/opt/aurora-preview/
  releases/<release-id>/     # 每次部署的不可变源码副本
  current -> releases/<release-id>
  shared/.env                # 服务器受限环境变量（chmod 600，不进 Git）
  backups/
```

数据库数据存于 Docker named volume `aurora-preview-postgres-data`。

## 安全

- 不映射公网 5432/6379；Worker/Redis/数据库无公网端口；
- 强随机 DB 密码只在服务器 `shared/.env`（chmod 600），不打印、不进 Git、不进镜像；
- 不上传 `.git`、`node_modules`、`.env`、secrets、本地凭证；
- 只部署真实 build/test 通过的应用；不创建 fake 服务、不伪造 Console。

## DirectMail 配置

先按[阿里云 DirectMail 邮箱验证交付 Runbook](../../docs/operations/aliyun-direct-mail-email-verification.md)
完成域名、发信地址和 RAM 权限。把 `.env.example` 中的非秘密邮件配置加入服务器
`/opt/aurora-preview/shared/.env`；部署与回滚脚本通过 `--env-file` 读取该受限文件。公网必须显式设置
`EMAIL_DELIVERY_MODE=aliyun`，没有控制台配置时部署应失败，不能回退到假成功的 `console`。

优先 ECS RAM 角色/官方 SDK 默认凭据链。只有无法使用角色时，才把
`ALIBABA_CLOUD_ACCESS_KEY_ID`/`ALIBABA_CLOUD_ACCESS_KEY_SECRET` 加入 `shared/.env`（`chmod 600`）；
这些变量只传给 `platform-worker`，不传给 Platform API、Console 镜像或浏览器 bundle。
