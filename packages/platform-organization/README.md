# Aurora Platform Organization

## 模块定位

`@aurora/platform-organization` 是管理平台工作空间与组织治理第一增量（PLT-04 B1-B8 的数据层部分）的数据层包。它承载
spec [platform-workspace-organization-governance](../../docs/superpowers/specs/2026-08-09-platform-workspace-organization-governance.md)
§4 的数据模型扩展与 Repository：在 PLT-03 的 `organizations`/`organization_members`/
`organization_invitations`/`security_audit_events` 表之上提供成员/邀请/时区的生命周期 Repository。

本包是 PLT-04 Task 2 的结果：包结构、构建/类型检查/migrate 入口、`settings_version` Migration 与
Repository 层均已真实存在。

## 职责

- Migration：`organizations.settings_version`（integer NOT NULL DEFAULT 0，B4 时区更新乐观并发版本）；
  确保 `organization_invitations` 的 `(organization_id, invited_email) WHERE status='pending'` 部分唯一索引存在；
- `organizations`：`getOrganizationById`、`findMembership`；
- `members`：`listMembers`、`changeOrganizationRole`、`removeMember`、`transferOwnership`
  （**owner 唯一不变量在 Repository 层事务内强制**：org 行 `FOR UPDATE` 串行化所有成员变更；
  不得 derote 唯一 owner、不得经 ChangeRole 制造第二个 owner、TransferOwnership 提交后恰有一个 owner）；
- `invitations`：`inviteMember`（原子邀请 + 审计；pending 重复冲突 / 已是成员冲突；
  **orgRole 限 `admin | member`，拒绝 `owner`**——owner 只能经 `transferOwnership` 变更）、
  `revokeInvitation`、`resendInvitation`（新 token+摘要+有效期，保持 pending，一次性明文返回）、
  `listPendingInvitations`；
- `timezone`：`getOrganizationSettings`、`updateOrganizationTimezone`（乐观并发 → `version_conflict`，
  审计 old/new）；
- 高风险管理 Command（邀请/撤销/重发/改角色/移除/转让所有权/时区更新）同事务写入
  `security_audit_events`（PRD §13.3）；审计 `details` 绝不包含密码/token/完整邮箱。

## 非职责

- 不实现 Session/CSRF（`@aurora/platform-session`）、EmailDeliveryPort（`@aurora/platform-email`）；
- 不实现 HTTP、Fastify、管理平台 UI、权限投影（service 层 `apps/platform-api`）；
- 不创建项目/客户端密钥/回收站（`@aurora/platform-project-governance`）、私密令牌
  （`@aurora/platform-credentials`）、审计读取（`@aurora/platform-audit`）；
- 不实现 SEC-01（A5 删除编排）、G11-G13、B5 真实 Usage Query；
- 不创建 Redis/BullMQ/S3/对象存储/云资源/CI/IaC（ADR-032 YAGNI）。

## 数据层边界

- 本包只依赖 `pg`（外部），不依赖 `@aurora/platform-identity`/`@aurora/platform-contract` 或任何
  workspace data 包（Workspace Policy `data → {protocol}`）。`normalizeEmail`/`createIntentToken`/
  `maskEmail` 为 PLT-03 helper 的本地副本。
- 集成测试经 node-pg-migrate runner 先运行 `packages/platform-identity/migrations`（PLT-03 表）再运行
  本包 migrations；这是 test-only 跨目录 migration 执行，不是包依赖。

## 对外接口

包根导出：

- `createIntentToken` / `normalizeEmail` / `maskEmail`（本地副本）；
- `PlatformOrganizationError` / `PlatformOrganizationErrorKind`（稳定错误表面）；
- `getOrganizationById`、`findMembership`；
- `listMembers`、`changeOrganizationRole`、`removeMember`、`transferOwnership`；
- `inviteMember`、`revokeInvitation`、`resendInvitation`、`listPendingInvitations`；
- `getOrganizationSettings`、`isValidTimezone`、`updateOrganizationTimezone`；
- 对应输入/结果类型（`MemberRow`、`InvitationRow`、`TransferOwnershipResult`、
  `UpdateTimezoneResult` 等）。

不暴露数据库行、pg 错误、SQLSTATE、token 明文（`resendInvitation` 返回的一次性明文只在首次成功时
交付给 service 用于邮件）、内部路径。

## 命令

```bash
pnpm --filter @aurora/platform-organization typecheck        # TypeScript strict
pnpm --filter @aurora/platform-organization test             # 单元测试（不连数据库）
pnpm --filter @aurora/platform-organization test:integration # 真实 PostgreSQL 17 集成测试
pnpm --filter @aurora/platform-organization test:coverage    # 覆盖率
pnpm --filter @aurora/platform-organization test:package     # 构建 + 包入口验证
pnpm --filter @aurora/platform-organization build            # 构建 dist
pnpm --filter @aurora/platform-organization migrate          # 运行本包 Migration（AURORA_TEST_DATABASE_URL；需先运行 platform-identity migrations）
```

集成测试需要真实 PostgreSQL 17，通过 `AURORA_TEST_DATABASE_URL` 连接（目标必须是
`aurora_inbox_test` 测试库，`assertIsTestDatabase` 强制）；禁止以 SQLite/mock/PGlite 替代真实数据库证据。

## 关联文档

- [PLT-04 正式规格](../../docs/superpowers/specs/2026-08-09-platform-workspace-organization-governance.md)
- [PLT-04 实施计划](../../docs/superpowers/plans/2026-08-09-platform-workspace-organization-governance.md)
- [PLT-03 正式规格](../../docs/superpowers/specs/2026-08-09-platform-identity-authentication-invitation.md)
- [ADR-029 平台数据库访问与 Migration](../../docs/adr/ADR-029-platform-database-access-and-migration.md)
- [ADR-030 平台 Session/CSRF/密码物理参数](../../docs/adr/ADR-030-platform-session-csrf-password-physical-parameters.md)
- [ADR-032 平台 Outbox/任务/缓存/对象存储](../../docs/adr/ADR-032-platform-outbox-tasks-cache-objects.md)
