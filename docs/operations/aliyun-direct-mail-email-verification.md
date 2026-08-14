# 阿里云 DirectMail 邮箱验证交付 Runbook

## 1. 状态与边界

代码状态为 **implemented-in-feature-branch / deployment-blocked**。在阿里云控制台完成域名、发信地址、
RAM 权限并通过两条受控公网验证前，不得声明真实邮件交付完成。注册/重发响应的 `queued` 只表示事务内
可靠写入 Outbox；DirectMail `accepted` 只表示供应商 API 接受请求，都不代表收件箱已收到邮件。

自动化测试只注入假 `DirectMailClientPort`，禁止对公网真实发信。不得把 AccessKey、验证 token、完整收件
地址、完整邮件正文或供应商原始错误体放入 Git、工单、聊天、日志或测试证据。

## 2. 用户持有的阿里云控制台步骤

以下操作需要 Aurora 阿里云账号控制台权限，代码仓库不能代替：

1. 开通 DirectMail，并确认账号、区域、计费方式和发送限额；
2. 添加发信域名 `notifications.aurora.ah.cn`；
3. 在权威 DNS 服务中逐条添加**阿里云控制台当时显示的准确 DNS 记录**，包括控制台要求的域名验证、
   SPF、DKIM、DMARC 或其他记录。不要从本文猜测记录值；等待控制台验证全部通过；
4. 创建并等待审核/生效发信地址 `support@notifications.aurora.ah.cn`，发件人显示名使用 `Aurora`；
5. 优先给运行 `platform-worker` 的 ECS 实例绑定最小权限 RAM 角色，让官方 SDK 使用默认凭据链；权限只
   允许所需的 DirectMail `SingleSendMail` 能力。不要把角色或权限授予 Console/Platform API；
6. 若运行环境确实不能使用 ECS RAM 角色，才在服务器受限 secret 中设置长期 AccessKey；创建专用最小
   权限 RAM 用户并规划轮换。不要在聊天中发送凭据；
7. 在阿里云费用中心设置 DirectMail 预算/费用告警，并为发送量、拒绝、退信、限流和鉴权失败配置运营告警。

## 3. Worker 配置

公网 Preview/生产配置写入服务器 `/opt/aurora-preview/shared/.env`（权限 `0600`），并只注入
`platform-worker`：

| 变量                                 | 建议值/约束                                               |
| ------------------------------------ | --------------------------------------------------------- |
| `EMAIL_DELIVERY_MODE`                | 必须显式为 `aliyun`；`console` 只用于本地受控开发且不发送 |
| `ALIYUN_DIRECT_MAIL_ACCOUNT_NAME`    | `support@notifications.aurora.ah.cn`                      |
| `ALIYUN_DIRECT_MAIL_FROM_ALIAS`      | `Aurora`                                                  |
| `ALIYUN_DIRECT_MAIL_REGION_ID`       | 默认 `cn-hangzhou`，按控制台实际区域确认                  |
| `ALIYUN_DIRECT_MAIL_ENDPOINT`        | 可选；省略时由官方 SDK 使用区域默认 endpoint              |
| `EMAIL_PROVIDER_TIMEOUT_MS`          | 默认 `10000`，必须短于 processing timeout                 |
| `EMAIL_OUTBOX_PROCESSING_TIMEOUT_MS` | 默认 `300000`                                             |
| `EMAIL_OUTBOX_RETRY_BASE_DELAY_MS`   | 默认 `1000`                                               |
| `EMAIL_OUTBOX_RETRY_MAX_DELAY_MS`    | 默认 `300000`，不得更大                                   |

可选 secret fallback 名称为 `ALIBABA_CLOUD_ACCESS_KEY_ID` 和
`ALIBABA_CLOUD_ACCESS_KEY_SECRET`。示例和文档必须保持空值；优先 ECS RAM 角色/默认凭据链。配置完成后在
仓库根目录用非秘密占位的数据库/发布变量执行 Compose 解析检查，并确认这些变量没有进入 `console` 服务：

```powershell
$env:PREVIEW_DB_PASSWORD='config-check-only'
$env:RELEASE_ID='config-check'
docker compose --env-file deploy/preview/.env.example -f deploy/preview/compose.yaml config --quiet
```

## 4. 部署前检查

1. 运行邮件包、Worker、Platform API、Console 以及真实 PostgreSQL/Redis 集成门禁；
2. 检查 `EMAIL_DELIVERY_MODE=aliyun`、发信地址已审核、RAM 角色已绑定；
3. 确认 provider timeout 小于 processing timeout，retry max 不超过五分钟；
4. 搜索本次差异，确认没有真实 AccessKey、完整收件地址、token、链接或供应商原始错误体；
5. 先部署 Migration，再部署能识别 `superseded`/`claim_id`/诊断列的新 Platform API 和 Worker。

## 5. 两条受控公网 Smoke

只使用测试人员控制的收件箱，证据中记录掩码地址、稳定 request ID/状态和时间，不记录 token 或邮件正文。

1. **新注册链路**：注册新账号；确认 API 返回 `deliveryStatus=queued`；等待真实邮件；使用最新链接验证；
   刷新 `/verify-email`，确认 Session 显示已验证且账号为 active；
2. **历史账号重发链路**：登录历史未验证账号；刷新 `/verify-email`（不得依赖注册内存）；执行重发；确认
   60 秒冷却和滚动 24 小时最多 5 次；连续重发后确认旧链接失效、最新链接成功并激活账号。

同时检查 Outbox：成功/永久失败/预算耗尽等终态 payload 已清理；重试使用未来 `available_at`；超时
processing 可回收；旧 claim 的 fencing 结算不能覆盖新 claim。只有两条 Smoke 都真实收信并完成验证，
才可把部署状态从 `deployment-blocked` 更新为真实交付完成。

## 6. 故障处置与回滚

- 鉴权/权限/发信地址错误属于永久配置失败：暂停 Worker，修复控制台或 RAM 配置后再恢复；不要盲目重试；
- 超时、网络、429、5xx 由 Outbox 有界退避处理；超过最大尝试次数进入 dead-lettered，payload 已清理；
- 回滚到不能识别新 Outbox 状态/列的旧代码前，必须先**停止 platform-worker**，确认没有 processing claim，
  再评估数据库向后兼容；自动回滚只允许
  `deploy/preview/email-outbox-schema-compatibility` 标记相同的两个版本，并在切换 release 指针前停止当前
  Worker；标记缺失或不同必须 fail closed。不要运行会破坏已写入新状态的 down migration；
- 代码回滚不等于业务数据回滚。绝不回滚已经 `verified` 的账号，也绝不恢复已经 `consumed` 的 intent；
  不得重新生成或从日志恢复 token；
- 若只需停止真实发送，可停止 Worker 保留 Outbox，再部署修复；不得把公网切回会报告假成功的 console 模式。

## 7. 关联依据

- [邮箱验证真实交付与历史账号重发设计](../superpowers/specs/2026-08-14-email-verification-delivery-and-resend-design.md)
- [邮箱验证真实交付与历史账号重发实施计划](../superpowers/plans/2026-08-14-email-verification-delivery-and-resend.md)
- [ADR-031 平台邮件交付](../adr/ADR-031-platform-email-delivery.md)
- [ADR-032 平台 Outbox](../adr/ADR-032-platform-outbox-tasks-cache-objects.md)
