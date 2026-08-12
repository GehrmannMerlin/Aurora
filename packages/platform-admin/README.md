# Aurora Platform Admin

## 模块定位

`@aurora/platform-admin` 是管理平台 D2 平台资源策略的前置基础数据层包：**平台管理员身份**与**平台级审计**。
它提供：

- `platform_admins` 表：显式账号级平台管理员能力（ADR-034），与任何 org/project 角色完全解耦；
- `platform_audit_events` 表：独立于 B7 `security_audit_events` 的平台级审计时间线，平台命令同事务写入，
  仅平台管理员可读，保留 1 年。

spec 见 [platform-admin-and-platform-audit](../../docs/security/platform-admin-and-platform-audit.md) 与
[ADR-034](../../docs/adr/ADR-034-platform-admin-and-platform-audit.md)。

本包是 PLT-10a Task 1 的结果：包结构、构建/类型检查/migrate 入口与两张表（`platform_admins`、
`platform_audit_events`）的 Migration 已真实存在；Repository（Task 2/3）在后续任务落档。

## 职责

- Migration：
  - `1786700000001_platform-admins` — `platform_admins`（`account_id` PK + FK → `accounts`、
    `granted_by` FK → `accounts`、`granted_at` 默认 `now()`）；
  - `1786700000002_platform-audit-events` — `platform_audit_events`（`event_id` 默认 `gen_random_uuid()`、
    `actor_account_id` FK → `accounts`、`action` CHECK 覆盖全部规划值、`target` 受约束 jsonb、`result`
    CHECK `succeeded|rejected`、`occurred_at` 默认 `now()`、`request_id` 可空、`(occurred_at DESC)` 索引）；
- `PlatformAdminError`（`invalid_input|database_unavailable|statement_failed`，不暴露 SQLSTATE）；
- `run-migrations.ts`：node-pg-migrate runner（`checkOrder: false`，`migrationsTable: pgmigrations`）。

## 非职责

- 不实现 HTTP handler（Task 5）、Session/CSRF、平台命令鉴权（`apps/platform-api` 强制）；
- 不实现自动 break-glass（v1 以 bootstrap ≥2 管理员缓解）、企业 IdP 组映射、云控制面身份直连；
- 不创建 Redis/BullMQ/S3/对象存储/云资源/CI/IaC（ADR-032 YAGNI）；
- 不修改 ADR-028/029/030（Session/CSRF/数据库工具链沿用）。

## 数据层边界

- 本包只依赖 `pg`（外部），不依赖 `@aurora/platform-contract` 或任何 workspace data 包（Workspace
  Policy `data → {protocol}`）；
- `platform_admins`/`platform_audit_events` 的 `accounts` FK 由 platform-identity migrations 提供，
  共享集成测试库已应用；本包集成测试经 node-pg-migrate runner 只运行本包 migrations（`checkOrder: false`），
  这是 test-only 跨目录迁移执行，不是包依赖。

## 对外接口

Task 1 仅提供错误表面与可执行迁移：

- `PlatformAdminError` / `PlatformAdminErrorKind`（稳定错误表面，不暴露 SQLSTATE）；
- `pnpm migrate`：运行本包 Migration（需先应用 platform-identity migrations）。

包根 `index.ts` 导出（Repository 能力）在 Task 2/3 落档。

## 命令

```bash
pnpm --filter @aurora/platform-admin typecheck        # TypeScript strict
pnpm --filter @aurora/platform-admin test             # 单元测试（不连数据库）
pnpm --filter @aurora/platform-admin test:integration # 真实 PostgreSQL 17 集成测试
pnpm --filter @aurora/platform-admin test:coverage    # 覆盖率
pnpm --filter @aurora/platform-admin test:package     # 构建 + 包入口验证
pnpm --filter @aurora/platform-admin build            # 构建 dist
pnpm --filter @aurora/platform-admin migrate          # 运行本包 Migration（AURORA_TEST_DATABASE_URL；需先运行 platform-identity migrations）
```

集成测试需要真实 PostgreSQL 17，通过 `AURORA_TEST_DATABASE_URL` 连接（目标必须是
`aurora_inbox_test` 测试库，`assertIsTestDatabase` 强制）；禁止以 SQLite/mock/PGlite 替代真实数据库证据。

## 关联文档

- [平台管理员与平台级审计（正式规格）](../../docs/security/platform-admin-and-platform-audit.md)
- [ADR-034 平台管理员与平台级审计](../../docs/adr/ADR-034-platform-admin-and-platform-audit.md)
- [PLT-10a 实施计划](../../docs/superpowers/plans/2026-08-12-plt-10a-platform-admin-and-audit.md)
