# Aurora Platform Email

## 模块定位

`@aurora/platform-email` 是管理平台身份、认证与邀请第一增量（PLT-03）的**数据层**包。它承载
spec
[platform-identity-authentication-invitation](../../docs/superpowers/specs/2026-08-09-platform-identity-authentication-invitation.md)
§6（EmailDeliveryPort 与 Outbox）的物理实现，以及 accepted
[ADR-031](../../docs/adr/ADR-031-platform-email-delivery.md)
（`EmailDeliveryPort` + 单供应商 + Outbox 记录；送达非承诺）与
[ADR-032](../../docs/adr/ADR-032-platform-outbox-tasks-cache-objects.md)
（通用事务性 Outbox；YAGNI——本叶子只建 PostgreSQL Outbox + 简单 Worker 轮询，不建 BullMQ/S3）的
异步边界。

本包已实现 `EmailDeliveryPort`、本地受控开发使用的 `ConsoleEmailAdapter`、阿里云 DirectMail
`SingleSendMail` 正式 API 的 `AliyunDirectMailAdapter`、官方 Node.js/TypeScript SDK 包装和可靠
`consumeOutboxEmails` Outbox 消费循环。**本包没有 DB Migration**——它**消费**
`@aurora/platform-identity` 创建的 `outbox` 表（spec §4.11 / ADR-032），因此没有 `migrate` 脚本。

## 职责

- **`EmailDeliveryPort` 端口契约**（ADR-031 §决定细节 1）：身份领域只依赖该端口，不依赖具体供应商；
- **`ConsoleEmailAdapter`**：`console` 模式只供本地受控开发，记录掩码诊断但**不发送**邮件；公网
  Preview/生产不得使用；
- **`AliyunDirectMailAdapter`**：渲染四类安全模板并调用 `SingleSendMail`；官方 SDK 使用默认凭据链，
  优先 ECS RAM 角色，不接收凭据参数；超时/网络/429/5xx 可重试，配置/权限/收件地址错误永久失败；
- **`consumeOutboxEmails`**：claim `pending`/`failed`/超时 `processing`，用 `claim_id` fencing 结算；
  `accepted` → `succeeded`，可重试失败按 capped exponential + equal jitter 延后，永久失败或预算耗尽
  → `dead_lettered`；所有终态都清理含链接 token 的 payload；
- **`OutboxRepository` 接口**：本包作为 data 层**不得**依赖同为 data 层的
  `@aurora/platform-identity`（Workspace Policy `data → {protocol}`），因此定义自己需要的 outbox
  Repository 子集接口，由 `consumeOutboxEmails` **参数注入**实现（`apps/platform-worker` composition root
  在 PLT-03 Task 8 注入真实实现）。

## 非职责

- 不实现 HTTP、Fastify、平台 API、Session、账号/密码/意图/邀请 Repository
  （`@aurora/platform-identity` / `@aurora/platform-session` / `apps/platform-api`）；
- 不实现 Worker 轮询循环（`apps/platform-worker`，PLT-03 Task 8）；
- 不创建 Redis/BullMQ 队列、S3/对象存储、CI、IaC 或云资源（ADR-032 YAGNI——本叶子无这些 consumer）；
- 不把 `accepted` 或 Outbox `queued` 表述为收件箱送达；供应商回执只证明 API 接受请求。

## 安全模型

- **绝不日志打印**：验证码/重置 token、完整收件人地址、邮件链接 URL 都不进入日志；`ConsoleEmailAdapter`
  只打印掩码地址；
- **送达非承诺**（ADR-031）：注册/重发的 `queued` 表示事务内可靠写入 Outbox；供应商
  `{status:'accepted'}` 表示 DirectMail API 接受请求，二者都**不代表收件箱**已经收到邮件；
- **payload 暂存语义**（spec §4.11）：邮件链接必须携带一次性 token（用户点击），而发送是异步的，因此原始
  token 必须经 Outbox 到达 Worker 以渲染邮件；权威意图表只存 SHA-256 摘要；Outbox payload 暂存的一次性
  token 是短期 + 单次使用 + 高熵随机；`succeeded`/`dead_lettered` 等终态立即清理 payload。本包把该
  token 封装在 `mailLinkUrl` 内，请求
  **不携带**独立 token 字段；
- **data → {protocol} 强制**：`package.json` 不声明任何 `@aurora/*` 工作区依赖（仅外部 `pg`）；Outbox
  Repository 通过接口注入，绝不 import `@aurora/platform-identity`；
- 供应商 secret 只存在于服务端默认凭据链。不得写入 Git、日志、文档示例、测试或前端；长期 AccessKey
  仅作受保护部署 secret 的降级选择，优先 ECS RAM 角色。

## 对外接口

包根导出：

- 类型：`EmailDeliveryPort`、`EmailDeliveryRequest`、`EmailDeliveryResult`、`EmailIntentType`；
- 值：`ConsoleEmailAdapter`、`AliyunDirectMailAdapter`、`createAliyunDirectMailClient`、
  `renderTransactionalEmail`、`calculateEmailRetryDelay`；
- 值：`consumeOutboxEmails({ pool, port, outboxRepo, now, limit?, maxAttempts? })` →
  `Promise<{ consumed: number; failed: number }>`（默认 `limit=20`、`maxAttempts=5`）；
- 类型：`OutboxRepository`、`OutboxRow`、`OutboxStatus`、`ClaimOutboxRowsInput/Result`、
  `MarkOutboxResultInput/Result`、`InsertOutboxRowInput/Result`、`OutboxEmailPayload`、
  `ConsumeOutboxEmailsInput/Result`、`DirectMailClientPort`；
- 常量：`PLATFORM_EMAIL_PACKAGE`、`PLATFORM_EMAIL_VERSION`。

`EmailIntentType = 'email_verification' | 'password_reset' | 'organization_invitation' |
'deletion_confirmation'`。

不暴露 `pg` 连接、内部 payload 解析、raw token、完整地址或内部路径。

## 命令

```bash
pnpm --filter @aurora/platform-email typecheck         # TypeScript strict
pnpm --filter @aurora/platform-email test              # 单元测试（不连 PostgreSQL）
pnpm --filter @aurora/platform-email test:integration  # 真实 PostgreSQL 集成测试（AURORA_TEST_DATABASE_URL）
pnpm --filter @aurora/platform-email test:coverage     # 覆盖率（含集成）
pnpm --filter @aurora/platform-email test:package      # 构建 + 包入口验证
pnpm --filter @aurora/platform-email build             # 构建 dist
```

集成测试需要真实 PostgreSQL（本地容器 `aurora-test-postgres`，
`AURORA_TEST_DATABASE_URL=postgresql://aurora:aurora_test_pw@localhost:15432/aurora_inbox_test`）；
未设置该环境变量时集成测试自动跳过。禁止以 mock/内存替代真实 PostgreSQL 证据。测试直接对 `outbox` 表
插入/消费（自包含建表，避免跨包迁移依赖），不 import `@aurora/platform-identity`。

## 关联文档

- [PLT-03 正式规格](../../docs/superpowers/specs/2026-08-09-platform-identity-authentication-invitation.md)
- [PLT-03 实施计划](../../docs/superpowers/plans/2026-08-09-platform-identity-authentication-invitation.md)
- [ADR-031 管理平台邮件发送责任、端口与供应商](../../docs/adr/ADR-031-platform-email-delivery.md)
- [ADR-032 管理平台 Outbox、任务、缓存与对象存储基础设施](../../docs/adr/ADR-032-platform-outbox-tasks-cache-objects.md)
- [阿里云 DirectMail 邮箱验证交付 Runbook](../../docs/operations/aliyun-direct-mail-email-verification.md)
