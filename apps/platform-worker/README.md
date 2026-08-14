# Aurora Platform Worker

## 模块定位

`@aurora/platform-worker` 是管理平台**后台 Worker**（service 层，`aurora.layer: service`），承载 PLT-03
邮箱 Outbox 的消费：轮询 `outbox` 表（spec §4.11 / accepted ADR-032 通用事务性 Outbox）中的
`pending` + `available_at <= now()` 行，通过 `@aurora/platform-email` 的 `consumeOutboxEmails`
调用 `EmailDeliveryPort`，并把行结算为 `succeeded`（入队成功）/ `failed`（预算内重试）/
`dead_lettered`（超限或 payload 非法）。

**YAGNI（ADR-032 实施约束）**：本叶子有真实 consumer（邮箱验证/重置/邀请），因此只需
PostgreSQL Outbox + 简单 Worker 轮询。**不创建** Redis/BullMQ 独立队列、S3/对象存储或任何无
consumer 的基础设施；Redis 仅由 `apps/platform-api` 的 Session（ADR-030）使用，与本 Worker 无关。

## 职责

- `buildPlatformWorker`：可测试的轮询循环工厂。每个 `pollIntervalMs` 调用一次
  `consumeOutboxEmails({ pool, port, outboxRepo, now, limit, maxAttempts, processingTimeoutMs,
retryBaseDelayMs, retryMaxDelayMs })`；
  `AbortController` + 可注入 `SleeperPort` 控制停止与节奏（镜像 `apps/ingestion-worker` 的
  sleeper/timer 端口模式）；
- `src/index.ts` 组合根：注入真实 outbox Repository（来自 `@aurora/platform-identity`，service 层
  `service → {protocol, data, tooling, contract}` 允许 data→data 接线）与 env 选择的邮件端口
  （本地 `ConsoleEmailAdapter` 或正式 `AliyunDirectMailAdapter`）；
- `startPlatformWorker`：创建并拥有 PostgreSQL Pool、启动 Worker、注册 SIGTERM/SIGINT 优雅关闭
  （先停轮询循环，再结束 Pool 恰好一次）；
- `loadPlatformWorkerConfig`：读取并冻结 `DATABASE_URL` / `EMAIL_DELIVERY_MODE` /
  `OUTBOX_POLL_INTERVAL_MS` / `OUTBOX_BATCH_LIMIT` / `OUTBOX_MAX_ATTEMPTS` /
  `GRACEFUL_SHUTDOWN_TIMEOUT_MS`。

## 邮件配置

公网 Preview/生产必须显式设置 `EMAIL_DELIVERY_MODE=aliyun`；`console` 仅用于本地受控开发且不发送邮件。
Worker 接受以下非秘密配置：

- `ALIYUN_DIRECT_MAIL_ACCOUNT_NAME`（aliyun 模式必填）、`ALIYUN_DIRECT_MAIL_FROM_ALIAS`（默认 `Aurora`）；
- `ALIYUN_DIRECT_MAIL_REGION_ID`（默认 `cn-hangzhou`）、可选 `ALIYUN_DIRECT_MAIL_ENDPOINT`；
- `EMAIL_PROVIDER_TIMEOUT_MS`（默认 `10000`）；
- `EMAIL_OUTBOX_PROCESSING_TIMEOUT_MS`（默认 `300000`，必须长于供应商超时）；
- `EMAIL_OUTBOX_RETRY_BASE_DELAY_MS`（默认 `1000`）；
- `EMAIL_OUTBOX_RETRY_MAX_DELAY_MS`（默认 `300000`）。

凭据不属于 `PlatformWorkerConfig`。官方 SDK 使用默认凭据链，优先 ECS RAM 角色；受保护的
`ALIBABA_CLOUD_ACCESS_KEY_ID`/`ALIBABA_CLOUD_ACCESS_KEY_SECRET` 仅是部署 fallback，绝不进入仓库。

## 非职责

- 不实现 HTTP、Fastify、平台 API、Session、账号/密码/意图/邀请 Repository
  （`@aurora/platform-identity` / `@aurora/platform-session` / `apps/platform-api`）；
- 不在 Worker 内实现供应商协议；适配器由 `@aurora/platform-email` 提供并在组合根选择；
- 不创建 Redis/BullMQ/S3/CI/IaC/云资源（ADR-032 YAGNI）；
- 不实现 SEC-01 账号注销删除交接（A5 删除编排是 SEC-01 叶子，不在本 Task 范围）。

## 安全模型

- **绝不日志打印**：验证码/重置 token、完整收件人地址、邮件链接 URL 都不进入 Worker 日志；
  `ConsoleEmailAdapter` 只打印掩码地址；Worker 的 poll 失败日志只记录有界错误消息（≤200 字符）；
- **送达非承诺**：业务 `queued` 和供应商 `accepted` 都**不代表**收件箱到达；
- **payload 暂存语义**（spec §4.11）：Outbox payload 暂存的一次性 token 是短期 + 单次使用 + 高熵随机，
  封装在 `mailLinkUrl` 内，随发送完成即清理；
- **crash/停止语义**：`claim → deliver → settle` 使用 `claim_id` fencing；超出
  `EMAIL_OUTBOX_PROCESSING_TIMEOUT_MS` 的 `processing` 会由新 claim 回收，旧 Worker 的结算返回
  `stale_claim`，不能覆盖新处理者。优雅关闭等待当前轮完成；重试按可用时间调度，最大尝试次数后死信；
- **终态清理**：成功、永久失败、过期或重试预算耗尽都清理 token/payload，仅保留稳定错误码和供应商请求 ID。

## 命令

```bash
cd apps/platform-worker
pnpm install                 # 链接工作区依赖
pnpm typecheck               # 严格 TypeScript 检查
pnpm test                    # 单元测试（不连 PostgreSQL）
AURORA_TEST_DATABASE_URL=postgresql://aurora:aurora_test_pw@localhost:15432/aurora_inbox_test \
pnpm test:integration        # 真实 PostgreSQL 17 集成测试（describeDb，未设置时自动跳过）
AURORA_TEST_DATABASE_URL=postgresql://aurora:aurora_test_pw@localhost:15432/aurora_inbox_test \
pnpm test:coverage           # v8 覆盖率（含集成，阈值 branches 75 / functions 80 / lines 80 / statements 80）
cd ../.. && pnpm check:boundaries   # Workspace Policy 单向依赖门禁
```

集成测试直接对 `outbox` 表插入/消费（自包含建表，避免跨包迁移依赖），但 Worker 本身注入的是
`@aurora/platform-identity` 的**真实** outbox Repository——这验证了 service 层的真实接线。禁止以
mock/内存替代真实 PostgreSQL 证据。

## 关联文档

- [PLT-03 正式规格](../../docs/superpowers/specs/2026-08-09-platform-identity-authentication-invitation.md)
- [PLT-03 实施计划](../../docs/superpowers/plans/2026-08-09-platform-identity-authentication-invitation.md)
- [ADR-031 管理平台邮件发送责任、端口与供应商](../../docs/adr/ADR-031-platform-email-delivery.md)
- [ADR-032 管理平台 Outbox、任务、缓存与对象存储基础设施](../../docs/adr/ADR-032-platform-outbox-tasks-cache-objects.md)
- [阿里云 DirectMail 邮箱验证交付 Runbook](../../docs/operations/aliyun-direct-mail-email-verification.md)
