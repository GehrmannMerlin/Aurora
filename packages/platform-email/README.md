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

本包是 PLT-03 Task 5 的结果：`EmailDeliveryPort` 端口契约、本地/Preview 的
`ConsoleEmailAdapter`（env-gated，绝不泄露 raw token / 完整地址 / 邮件链接 URL）与
`consumeOutboxEmails` Outbox 消费循环均已真实存在。**本包没有 DB Migration**——它**消费**
`@aurora/platform-identity` 创建的 `outbox` 表（spec §4.11 / ADR-032），因此没有 `migrate` 脚本。

## 职责

- **`EmailDeliveryPort` 端口契约**（ADR-031 §决定细节 1）：身份领域只依赖该端口，不依赖具体供应商；
- **`ConsoleEmailAdapter`**（本地/Preview 路径）：`EMAIL_DELIVERY_MODE` 未设置或为 `'console'` 时解析
  `{status:'enqueued'}` 并只打印 `[email] queued <intentType> to <masked>`；任何其他模式值 fail-closed
  返回 `EMAIL_PROVIDER_CREDENTIAL_ACTION_REQUIRED`（真实供应商适配器是未来、用户授权的增量，ADR-031 §6.3）；
- **`consumeOutboxEmails`**（ADR-032 通用 Outbox 消费）：claim `pending` + `available_at <= now()` →
  逐行 `port.deliver` → `succeeded`（入队成功）/ `failed`（预算内重试）/ `dead_lettered`（超限或 payload 非法）；
- **`OutboxRepository` 接口**：本包作为 data 层**不得**依赖同为 data 层的
  `@aurora/platform-identity`（Workspace Policy `data → {protocol}`），因此定义自己需要的 outbox
  Repository 子集接口，由 `consumeOutboxEmails` **参数注入**实现（`apps/platform-worker` composition root
  在 PLT-03 Task 8 注入真实实现）。

## 非职责

- 不实现 HTTP、Fastify、平台 API、Session、账号/密码/意图/邀请 Repository
  （`@aurora/platform-identity` / `@aurora/platform-session` / `apps/platform-api`）；
- 不实现 Worker 轮询循环（`apps/platform-worker`，PLT-03 Task 8）；
- 不创建 Redis/BullMQ 队列、S3/对象存储、CI、IaC 或云资源（ADR-032 YAGNI——本叶子无这些 consumer）；
- 不使用 fake email 冒充真实交付；真实供应商适配器等待用户授权注册。

## 安全模型

- **绝不日志打印**：验证码/重置 token、完整收件人地址、邮件链接 URL 都不进入日志；`ConsoleEmailAdapter`
  只打印掩码地址；
- **送达非承诺**（ADR-031）：`{status:'enqueued'}` 只表示发送请求已可靠入 Outbox，**不代表**收件箱到达；
- **payload 暂存语义**（spec §4.11）：邮件链接必须携带一次性 token（用户点击），而发送是异步的，因此原始
  token 必须经 Outbox 到达 Worker 以渲染邮件；权威意图表只存 SHA-256 摘要；Outbox payload 暂存的一次性
  token 是短期 + 单次使用 + 高熵随机，随发送完成即清理。本包把该 token 封装在 `mailLinkUrl` 内，请求
  **不携带**独立 token 字段；
- **data → {protocol} 强制**：`package.json` 不声明任何 `@aurora/*` 工作区依赖（仅外部 `pg`）；Outbox
  Repository 通过接口注入，绝不 import `@aurora/platform-identity`；
- 供应商 API secret 只存在于服务端部署环境，绝不进入 Git/日志/前端（ADR-031 实施约束）。

## 对外接口

包根导出：

- 类型：`EmailDeliveryPort`、`EmailDeliveryRequest`、`EmailDeliveryResult`、`EmailIntentType`；
- 值：`ConsoleEmailAdapter`（构造参数 `{ mode?, log? }` 可注入，默认读 `EMAIL_DELIVERY_MODE`）；
- 值：`consumeOutboxEmails({ pool, port, outboxRepo, now, limit?, maxAttempts? })` →
  `Promise<{ consumed: number; failed: number }>`（默认 `limit=20`、`maxAttempts=5`）；
- 类型：`OutboxRepository`、`OutboxRow`、`OutboxStatus`、`ClaimOutboxRowsInput/Result`、
  `MarkOutboxResultInput/Result`、`InsertOutboxRowInput/Result`、`OutboxEmailPayload`、
  `ConsumeOutboxEmailsInput/Result`；
- 常量：`PLATFORM_EMAIL_PACKAGE`、`PLATFORM_EMAIL_VERSION`。

`EmailIntentType = 'email_verification' | 'password_reset' | 'organization_invitation'`。

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
