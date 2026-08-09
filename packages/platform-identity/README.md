# Aurora Platform Identity

## 模块定位

`@aurora/platform-identity` 是管理平台身份、认证与邀请第一增量（PLT-03）的数据层包。它承载 spec
[platform-identity-authentication-invitation](../../docs/superpowers/specs/2026-08-09-platform-identity-authentication-invitation.md)
§4 的数据模型：`accounts`、`account_credentials`、`email_verification_intents`、
`password_reset_intents`、`organizations`、`organization_members`、`organization_invitations`、
`project_members`、`security_audit_events`、`idempotency_records`、`outbox`（11 张表）。

本包是 PLT-03 Task 2 + Task 3 的结果：包结构、构建/类型检查/migrate 入口、11 表 Migration、
Repository 层、Argon2id 密码包装与一次性 intent token 均已真实存在。

## 职责

- 11 表数据模型 Migration（`migrations/1786233600000_create-platform-identity-tables.ts`），
  uuid PK `gen_random_uuid()`、`timestamptz` 默认 `now()`、CHECK 约束、唯一/部分唯一索引；
- `accounts.email`/`email_normalized` 均以规范化形式存储且唯一（防枚举匹配键）；
- `organization_invitations` 上 `(organization_id, invited_email) WHERE status='pending'` 部分唯一索引；
- intent/invitation `token_digest` 只存一次性 token 的 SHA-256 摘要，绝不存原始 token（ADR-030）；
- `project_members.project_id` 为纯 uuid（无 FK）——`projects` 表由 PLT-04 创建，本叶子只建接受写入；
- `security_audit_events` 不做 FK——身份事件可引用尚不存在的 actor/org 行，`details` 绝不包含密码/token/完整邮箱；
- `outbox`（ADR-032 通用 Outbox）无 FK，`status` pending/processing/succeeded/failed/dead_lettered，
  `attempt_count`/`available_at` 支持 Worker 租约与重试。

## 非职责

- 不实现 Session/CSRF（`@aurora/platform-session`）、EmailDeliveryPort（`@aurora/platform-email`）；
- 不实现 HTTP、Fastify、管理平台 UI、管理员授权、完整审计；
- 不实现 PLT-04（B1-B8）、SEC-01（A5 删除编排）、G11-G13；
- 不创建 Redis/BullMQ/S3/对象存储/云资源/CI/IaC（ADR-032 YAGNI）。

## 安全模型

- 密码绝不存储明文；本包只建 `password_hash`（Argon2id 编码串）列；
- `hashPassword` 用 Argon2id（`m=19456, t=2, p=1`，每密码唯一 CSPRNG 盐），`verifyPassword` 失败路径统一返回 `false`，绝不抛错；
- `token_digest` 只存摘要；`details`/`payload` 绝不记录密码、一次性 token 或完整邮箱；
- 防枚举：公开结果不随账号是否存在而变化（由上层操作实现）；
- 数据层只依赖 `pg`/`argon2`（外部），不依赖 `@aurora/platform-contract`（contract 层，Workspace Policy `data → {protocol}`）。

## 对外接口

包根导出：

- `hashPassword` / `verifyPassword`（Argon2id）；
- `createIntentToken` / `normalizeEmail`（一次性 token + SHA-256 摘要、邮箱规范化）；
- `PlatformIdentityError` / `PlatformIdentityErrorKind`（稳定错误表面）；
- Repository：`createAccount`、`findAccountByEmailNormalized`、`getAccountById`、`updateAccountVerifiedAt`、`incrementSecurityVersion`、`upsertAccountCredential`；`insertEmailVerificationIntent`、`insertPasswordResetIntent`、`findEmailVerificationIntentByDigest`、`findPasswordResetIntentByDigest`、`consumeIntent`；`createPersonalOrganization`、`insertOrganizationMembership`、`insertProjectMembership`、`createInvitation`、`findInvitationByDigest`、`updateInvitationStatus`、`findOrganizationById`；`insertAuditEvent`；`createIdempotencyRecord`、`findIdempotencyRecord`、`updateIdempotencyResult`；`insertOutboxRow`、`claimOutboxRows`、`markOutboxResult`；
- 对应输入/结果类型（`AccountRow`、`IntentRow`、`InvitationRow`、`OutboxRow`、`ConsumeIntentResult` 等）。

不暴露数据库行、pg 错误、SQLSTATE、密码摘要、token 明文或内部路径。

## 数据库表

11 张表见 spec §4.1-4.11：

- `accounts`：`account_id`（uuid PK）、`email`/`email_normalized`（唯一）、`verified_at`、`security_version`、`status`（active/pending_verification/deletion_cooling/terminated）、`created_at`/`updated_at`；
- `account_credentials`：`account_id`（uuid PK/FK→accounts）、`password_hash`、`password_version`、`changed_at`；
- `email_verification_intents`：`intent_id`（uuid PK）、`account_id`（FK）、`token_digest`（唯一）、`expires_at`、`consumed_at`、`created_at`；
- `password_reset_intents`：同验证意图结构；
- `organizations`：`organization_id`（uuid PK）、`name`、`kind`（personal/organization）、`timezone`（默认 UTC）、`created_at`/`updated_at`；
- `organization_members`：`(organization_id, account_id)` 复合 PK、`role`（owner/admin/member）、`created_at`；
- `organization_invitations`：`invitation_id`（uuid PK）、`organization_id`（FK）、`invited_email`、`org_role`、`token_digest`（唯一）、`expires_at`（默认 7 天）、`status`（pending/accepted/revoked/expired）、`accepted_at`、`created_at`；`(organization_id, invited_email) WHERE status='pending'` 部分唯一；
- `project_members`：`(project_id, account_id)` 复合 PK（`project_id` 无 FK）、`role`（project_admin/developer/read_only）、`created_at`；
- `security_audit_events`：`event_id`（uuid PK）、`organization_id`/`actor_account_id`/`target_account_id`（可空、无 FK）、`action`、`occurred_at`、`details`（jsonb 默认 `{}`）；
- `idempotency_records`：`idempotency_key`（text PK）、`operation`、`request_digest`、`status`（processing/succeeded/failed）、`result_data`、`created_at`/`updated_at`；
- `outbox`：`outbox_id`（uuid PK）、`aggregate_type`、`aggregate_id`、`payload`（jsonb）、`status`、`attempt_count`（默认 0）、`available_at`、`created_at`/`updated_at`。

## 命令

```bash
pnpm --filter @aurora/platform-identity typecheck        # TypeScript strict
pnpm --filter @aurora/platform-identity test             # 单元测试（不连数据库）
pnpm --filter @aurora/platform-identity test:integration # 真实 PostgreSQL 17 集成测试
pnpm --filter @aurora/platform-identity test:coverage    # 覆盖率
pnpm --filter @aurora/platform-identity test:package     # 构建 + 包入口验证
pnpm --filter @aurora/platform-identity build            # 构建 dist
pnpm --filter @aurora/platform-identity migrate          # 运行 Migration（AURORA_TEST_DATABASE_URL）
```

集成测试需要真实 PostgreSQL 17，通过 `AURORA_TEST_DATABASE_URL` 连接（目标必须是
`aurora_inbox_test` 测试库，`assertIsTestDatabase` 强制）；禁止以 SQLite/mock/PGlite 替代真实数据库证据。

## 关联文档

- [PLT-03 正式规格](../../docs/superpowers/specs/2026-08-09-platform-identity-authentication-invitation.md)
- [PLT-03 实施计划](../../docs/superpowers/plans/2026-08-09-platform-identity-authentication-invitation.md)
- [ADR-029 平台数据库访问与 Migration](../../docs/adr/ADR-029-platform-database-access-and-migration.md)
- [ADR-030 平台 Session/CSRF/密码物理参数](../../docs/adr/ADR-030-platform-session-csrf-password-physical-parameters.md)
- [ADR-031 平台邮件交付](../../docs/adr/ADR-031-platform-email-delivery.md)
- [ADR-032 平台 Outbox/任务/缓存/对象存储](../../docs/adr/ADR-032-platform-outbox-tasks-cache-objects.md)
