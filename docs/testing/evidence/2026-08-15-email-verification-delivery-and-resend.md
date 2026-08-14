# Aurora 邮箱验证真实交付与历史账号重发实施证据（2026-08-15）

> 当前状态：`implemented-in-feature-branch / deployment-blocked`。本证据证明功能分支实现和本地自动化门禁，不证明阿里云公网邮件已送达，也不包含完整邮箱、验证链接、token、邮件正文、AccessKey 或供应商原始错误体。

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

## 部署阻塞与人工检查点

仍需拥有阿里云账号控制台权限的人员完成：

1. 开通 DirectMail，添加 `notifications.aurora.ah.cn`，按控制台提供的精确记录配置 DNS 并等待验证；
2. 审核发信地址 `support@notifications.aurora.ah.cn`；
3. 为运行平台的 ECS 绑定最小权限 RAM 角色，使官方 SDK 默认凭据链优先使用角色；仅当运行环境不支持角色时，才通过服务端部署 secret 提供长期 AccessKey；
4. 配置用量/费用告警并部署 `EMAIL_DELIVERY_MODE=aliyun`；
5. 执行两条受控公网 smoke：新注册验证、历史未验证账号重发；确认旧链接失败、最新链接激活账号，并检查受限/正常工作空间切换、Outbox 终态清理及日志脱敏。

上述检查点完成前，不得把状态更新为 deployed 或声称真实邮件交付完成。
