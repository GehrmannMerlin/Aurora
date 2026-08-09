# Aurora Platform Project Governance

## 模块定位

`@aurora/platform-project-governance` 是管理平台项目治理第一增量（PLT-04 B1/B2/B8）的数据层包。它承载
spec [platform-workspace-organization-governance](../../docs/superpowers/specs/2026-08-09-platform-workspace-organization-governance.md)
§4.1-§4.4 的数据模型扩展与 Repository：在 PLT-03 的 `accounts`/`organizations`/`project_members`/
`security_audit_events` 表之上提供 `projects`/`client_keys`/`project_environments`/`project_onboarding`
的生命周期 Repository（创建、归档、回收站恢复）。

本包是 PLT-04 Task 3 的结果：包结构、构建/类型检查/migrate 入口、`project-governance` Migration 与
Repository 层均已真实存在。

## 职责

- Migration：`projects`、`client_keys`、`project_environments`、`project_onboarding` 四张表（spec §4.1-4.4），
  up/down 完全可逆（子表先删）；**不**给 `project_members.project_id` 加 FK（PLT-03 §4.8 保持无 FK）；
- `projects`：`createProject`（**原子**：项目 + 默认 production 环境 + 默认客户端密钥 + onboarding 行 +
  审计同事务；任一步失败 → 无部分行）、`listProjects`（spec §6 有效权限投影）、`getProjectById`、
  `updateProjectStatus`（archive）、`insertProjectMember`（project_admin/developer/read_only 角色校验）；
- `client-keys`：默认客户端密钥 = `public_identifier = 'aurora_key_<base64url(8)>'`（公开，可进浏览器代码）
  - `key_digest = sha256(secret)`（密钥只生成一次，**绝不持久化**，只存摘要；本包任何函数不返回密钥明文）；
    `revokeClientKey`（不可逆禁用，本包无重启用路径）；
- `onboarding`：`getOnboarding`、`updateOnboardingStatus`（not_started → in_progress → completed，
  completed 时写入 `completed_at`）；
- `trash`：`trashProject`（active/archived → trash，写 `trashed_at` + 7 天 `recoverable_until`，
  **禁用所有启用中的客户端密钥**，审计 `project.trashed`）、`listTrash`、`restoreProject`
  （执行 G10 APPROVED B8 恢复安全规则，见下）；
- 高风险管理 Command（创建/归档/回收/恢复/撤销密钥）同事务写入 `security_audit_events`（PRD §13.3）；
  审计 `details` 绝不包含密码/token/客户端密钥明文/完整邮箱。

### B8 回收站恢复安全规则（G10 APPROVED product rule，`restoreProject`）

1. **状态由服务端决定**：只对 `status='trash'` 且仍在 `recoverable_until` 内的项目恢复；
   `deleting`/`deleted`/过期窗口拒绝，返回判别结果（`state_machine_conflict` + 当前权威状态）供 service 映射 409；
2. **告警不自动重启**：本包不拥有 alert 行，恢复不触达（注释记录该边界）；
3. **已撤销私密令牌不恢复**：私密令牌属 `@aurora/platform-credentials`，本包不触碰（注释记录该边界）；
4. **失效客户端密钥不恢复**：项目入回收站时密钥已禁用，恢复**不**重新启用；
5. **成员/角色按当前组织状态重算**：恢复时删除已离开组织的账号的项目成员行，不恢复历史失效权限快照；
6. **不复活删除清理状态**：`trash → active` 只对仍在恢复窗口的 `trash` 生效。

## 非职责

- 不实现 Session/CSRF（`@aurora/platform-session`）、EmailDeliveryPort（`@aurora/platform-email`）；
- 不实现 HTTP、Fastify、管理平台 UI、权限投影（service 层 `apps/platform-api`）；
- 不创建私密令牌（`@aurora/platform-credentials`）、审计读取（`@aurora/platform-audit`）；
- 不实现 SEC-01（A5 删除编排）、G11-G13、B5 真实 Usage Query；
- 不创建 Redis/BullMQ/S3/对象存储/云资源/CI/IaC（ADR-032 YAGNI）。

## 数据层边界

- 本包只依赖 `pg`（外部），不依赖 `@aurora/platform-contract` 或任何 workspace data 包
  （Workspace Policy `data → {protocol}`）。
- 集成测试经 node-pg-migrate runner 先运行 `packages/platform-identity/migrations`（PLT-03 表）再运行
  本包 migrations；这是 test-only 跨目录 migration 执行，不是包依赖。

## 对外接口

包根导出：

- `PlatformProjectGovernanceError` / `PlatformProjectGovernanceErrorKind`（稳定错误表面）；
- `createProject` / `listProjects` / `getProjectById` / `updateProjectStatus` / `insertProjectMember`；
- `revokeClientKey`；
- `getOnboarding` / `updateOnboardingStatus`；
- `listTrash` / `trashProject` / `restoreProject`；
- 对应输入/结果类型（`CreateProjectResult`、`RestoreProjectResult`、`ProjectRow` 等）。

不暴露数据库行、pg 错误、SQLSTATE、客户端密钥明文/摘要、内部路径。

## 命令

```bash
pnpm --filter @aurora/platform-project-governance typecheck        # TypeScript strict
pnpm --filter @aurora/platform-project-governance test             # 单元测试（不连数据库）
pnpm --filter @aurora/platform-project-governance test:integration # 真实 PostgreSQL 17 集成测试
pnpm --filter @aurora/platform-project-governance test:coverage    # 覆盖率
pnpm --filter @aurora/platform-project-governance test:package     # 构建 + 包入口验证
pnpm --filter @aurora/platform-project-governance build            # 构建 dist
pnpm --filter @aurora/platform-project-governance migrate          # 运行本包 Migration（AURORA_TEST_DATABASE_URL；需先运行 platform-identity migrations）
```

集成测试需要真实 PostgreSQL 17，通过 `AURORA_TEST_DATABASE_URL` 连接（目标必须是
`aurora_inbox_test` 测试库，`assertIsTestDatabase` 强制）；禁止以 SQLite/mock/PGlite 替代真实数据库证据。

## 关联文档

- [PLT-04 正式规格](../../docs/superpowers/specs/2026-08-09-platform-workspace-organization-governance.md)
- [PLT-03 正式规格](../../docs/superpowers/specs/2026-08-09-platform-identity-authentication-invitation.md)
- [ADR-029 平台数据库访问与 Migration](../../docs/adr/ADR-029-platform-database-access-and-migration.md)
- [ADR-030 平台 Session/CSRF/密码物理参数](../../docs/adr/ADR-030-platform-session-csrf-password-physical-parameters.md)
- [ADR-032 平台 Outbox/任务/缓存/对象存储](../../docs/adr/ADR-032-platform-outbox-tasks-cache-objects.md)
