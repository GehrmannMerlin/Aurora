# Aurora Platform Credentials

## 模块定位

`@aurora/platform-credentials` 是管理平台组织与项目治理第一增量（PLT-04 B6 私密管理令牌）的数据层包。它承载
spec [platform-workspace-organization-governance](../../docs/superpowers/specs/2026-08-09-platform-workspace-organization-governance.md)
§4.5 的 `private_tokens` 表与 Repository：一次性明文交付、SHA-256 摘要存储、不可逆撤销。

本包是 PLT-04 Task 4 的结果：包结构、构建/类型检查/migrate 入口、`private_tokens` Migration 与
Repository 层均已真实存在。

## 职责

- Migration：`private_tokens` 表（spec §4.5：token_id uuid PK、organization_id/created_by FK、
  name、token_digest 唯一、scopes jsonb、expires_at/revoked_at/last_used_at、created_at）；up/down 完全可逆；
- `createPrivateToken`：原子 {元数据 + SHA-256 摘要 + 审计} 同事务；明文 `aurora_pt_<tokenId>_<secret>`
  由 node:crypto CSPRNG 生成一次，**只出现在创建响应中**（一次性交付），数据库只存摘要；
- `listPrivateTokens`：组织作用域的元数据投影（tokenId/name/scopes/expiresAt/revokedAt/lastUsedAt/createdAt），
  **绝不返回 digest 或明文**；
- `revokePrivateToken`：不可逆（`revoked_at` 设置后永不激活），撤销 + 审计同事务；
  重复撤销幂等（仍 success，无重复审计）；未知 tokenId 返回 `not_found`；
- `verifyTokenScope` / `isPrivateTokenScope`：固定公共 scope allowlist（`PRIVATE_TOKEN_SCOPES`，
  冻结：`source_maps.upload`、`releases.write`）；未知或空 scopes → `invalid_input`；
- `getTokenStatus` / `isExpired`：令牌状态投影（active/expired/revoked，revoked 优先）；
  `expires_at` 已过视为过期/无效；
- 高风险管理 Command（创建/撤销）同事务写入 `security_audit_events`
  （action：`credentials.private_token.created`/`credentials.private_token.revoked`）；
  审计 `details` 绝不包含明文、摘要或任何秘密（仅 tokenId）。

## 非职责

- 不实现令牌校验端点或任何 HTTP（Task 6，`apps/platform-api`）；
- 不实现 Session/CSRF（`@aurora/platform-session`）、组织/成员/邀请（`@aurora/platform-organization`）、
  项目/回收站（`@aurora/platform-project-governance`）、审计读取（`@aurora/platform-audit`）；
- 不实现 SEC-01（A5 删除编排）、G11-G13、B5 真实 Usage Query；
- 不创建 Redis/BullMQ/S3/对象存储/云资源/CI/IaC（ADR-032 YAGNI）。

## 数据层边界

- 本包只依赖 `pg`（外部），不依赖 `@aurora/platform-identity`/`@aurora/platform-contract` 或任何
  workspace data 包（Workspace Policy `data → {protocol}`）。`createPrivateTokenValue` 为
  PLT-03 `createIntentToken`-style CSPRNG 的本地副本。
- 集成测试经 node-pg-migrate runner 先运行 `packages/platform-identity/migrations`（PLT-03 表）
  与 `packages/platform-organization/migrations`（settings_version）再运行本包 migrations；
  这是 test-only 跨目录 migration 执行，不是包依赖。

## 对外接口

包根导出：

- `PRIVATE_TOKEN_PREFIX` / `PRIVATE_TOKEN_SCOPES`（固定 allowlist）；
- `verifyTokenScope` / `isPrivateTokenScope` / `getTokenStatus` / `isExpired`；
- `PlatformCredentialsError` / `PlatformCredentialsErrorKind`（稳定错误表面）；
- `createPrivateToken` / `listPrivateTokens` / `revokePrivateToken`；
- 对应输入/结果类型（`CreatePrivateTokenInput`、`CreatePrivateTokenResult`、
  `PrivateTokenRow`、`RevokePrivateTokenInput`、`RevokePrivateTokenResult` 等）。

不暴露数据库行、pg 错误、SQLSTATE、token 明文（一次性明文只在首次成功创建响应中出现）、token 摘要、
内部路径。

## 命令

```bash
pnpm --filter @aurora/platform-credentials typecheck        # TypeScript strict
pnpm --filter @aurora/platform-credentials test             # 单元测试（不连数据库）
pnpm --filter @aurora/platform-credentials test:integration # 真实 PostgreSQL 17 集成测试
pnpm --filter @aurora/platform-credentials test:coverage    # 覆盖率
pnpm --filter @aurora/platform-credentials test:package     # 构建 + 包入口验证
pnpm --filter @aurora/platform-credentials build            # 构建 dist
pnpm --filter @aurora/platform-credentials migrate          # 运行本包 Migration（AURORA_TEST_DATABASE_URL；需先运行 platform-identity/platform-organization migrations）
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
