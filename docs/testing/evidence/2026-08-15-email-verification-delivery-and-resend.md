# Aurora 邮箱验证真实交付与历史账号重发实施证据（2026-08-15）

> 当前状态：`deployed / complete`。本证据记录功能实现、自动化门禁、公网部署和用户真实收件验收；不包含完整邮箱、验证链接、token、邮件正文、AccessKey 或供应商原始错误体。

## 实施范围

- 新注册账号在身份事务中创建验证意图并可靠写入 PostgreSQL Outbox；
- 已登录未验证账号通过 Session 保护的 Command 重发，执行 60 秒冷却和滚动 24 小时最多 5 次配额；
- 重发幂等、确认/重发竞争和最新验证链接唯一有效；确认后账号激活；
- Outbox 支持失败重试、过期 `processing` 回收、claim fencing、有界最大尝试次数，并在终态清除敏感 token/payload；
- 阿里云 DirectMail `SingleSendMail` adapter 使用官方 Node.js/TypeScript SDK 与默认凭据链；自动化测试只注入假的 DirectMail client；
- `/verify-email` 与重发页面从服务端 Session 恢复状态，不依赖注册页面浏览器内存；
- Preview 配置强制 `EMAIL_DELIVERY_MODE=aliyun`，不允许以 Console fake transport 冒充交付；不兼容 Outbox schema 的回滚会 fail closed。

## 验证环境

- PostgreSQL：17.10（隔离的 identity、email、API、worker 测试数据库）；
- Redis：7.4.8；
- 浏览器门禁：本地 Chromium；
- Windows linked worktree；根 lint/完整门禁使用 `NODE_OPTIONS=--max-old-space-size=4096`。

## 验证结果

| 范围            | 命令或门禁                                                                            | 结果                                                                      |
| --------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 身份事务        | `pnpm --filter @aurora/platform-identity test:integration`                            | 8 files / 68 tests 通过                                                   |
| 邮件 Outbox     | `pnpm --filter @aurora/platform-email test:integration`                               | 1 file / 7 tests 通过                                                     |
| Platform API    | `pnpm --filter @aurora/platform-api test:integration`                                 | 28 files / 164 tests 通过；验证路由日志不记录 token                       |
| Platform Worker | `pnpm --filter @aurora/platform-worker test:integration`                              | 隔离测试数据库按 CI 语义重建后 3 files / 8 tests 通过                     |
| 契约            | `pnpm openapi:check`                                                                  | 两份 Redocly 规格、ingestion 40 项与 platform 19 项漂移检查通过           |
| 全仓静态门禁    | `pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm check:boundaries`           | 通过                                                                      |
| 全仓测试与构建  | `pnpm test`、`pnpm test:coverage`、`pnpm build`                                       | 通过；Console 320 tests，语句 86.74%、分支 75.00%、函数 90.03%、行 87.97% |
| 包入口          | platform-contract、event-schema、core、browser、三个采集插件与 Console `test:package` | 全部通过                                                                  |
| 浏览器          | browser、三个采集插件与 Console `test:browser`                                        | 分别 19、5、9、7、31 项通过                                               |
| 部署配置        | Compose config、Bash rollback syntax、worker 文档/配置测试                            | 通过；回滚 schema marker 不兼容时拒绝切换                                 |
| 代码评审        | contract、事务顺序、并发、重试、fencing、终态清理、日志脱敏、Vue timer 与部署安全     | 独立评审发现均已修复并复测                                                |

完整最终门禁在证据提交前再次运行：

```powershell
$env:NODE_OPTIONS='--max-old-space-size=4096'
pnpm check
git diff --check
git diff --cached --check
```

跟踪文件 AccessKey 模式扫描无命中；终态 Outbox 测试断言不保留原始验证链接或 token。

## 实施提交

- `d942afd`—`0011751`：契约、身份/Outbox/API、DirectMail adapter、Worker composition、Console 与运维 Runbook；
- `ab13918`—`d313d3d`：请求日志脱敏、有界 Outbox 尝试、重发配额与 replay 语义修复；
- `3b4dc96`—`2efe365`：部署回滚安全、仓库门禁、Console 覆盖率与 linked-worktree/Chromium fixture 修复；
- 本文件及当前状态快照由后续证据提交记录。

## 公网部署与用户验收

- 公网 Preview 已部署 release `20260815-132409`，对应提交 `d6700af`；线上 Console、Platform API、Ingestion API、PostgreSQL 和 Redis 健康检查通过；
- 用户于 2026-08-15 确认已收到真实 DirectMail 交付邮件，并明确授权把本增量标记为完成；不在证据中保存收件地址、token、邮件正文或供应商原始响应；
- 用户明确取消原人工步骤中的费用/发送预警配置。当前低使用量阶段暂不配置预警是已接受的运营取舍，不再是部署或完成阻塞；
- 原两条公网 Smoke 保留为未来可选回归步骤，不再作为本次验收门禁；相关新注册、历史重发、旧链接失效、最新链接激活、配额和 Session 行为已有真实 PostgreSQL/Redis 与浏览器自动化覆盖；
- 最终状态：`deployed / complete`。
