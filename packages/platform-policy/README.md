# Aurora Platform Policy

## 模块定位

`@aurora/platform-policy` 是管理平台 D2 平台资源策略的数据层包（ADR-035 最小分层方案 A）。它提供三张表的
Migration 与后续 Repository 的稳定错误表面：

- `platform_resource_policies`：平台默认策略（单行，版本化）；
- `organization_policy_overrides`：组织完整覆盖（每组织一行六项字段，版本化）；
- `project_policy_limits`：项目可选资源上限（每项目至多一行，仅 `resource_limit`，版本化）。

无覆盖 = 继承；生效值由服务端只读计算（平台默认 → 组织覆盖 → 项目上限），"配置值/来源/生效值"三者分离。
spec 见 [platform-resource-policy-data-model](../../docs/architecture/platform-resource-policy-data-model.md) 与
[ADR-035](../../docs/adr/ADR-035-platform-resource-policy-data-model.md)。

本包是 PLT-10b Task 1—3 的结果：包结构、构建/类型检查/migrate 入口、三张表的 Migration、稳定错误表面、三张表的
Repository（平台默认/组织覆盖/项目上限 CRUD + 乐观版本）、生效纯函数 `computeEffectivePolicy` 与目标搜索
`searchPolicyTargets`（D2 目标选择器只读前缀搜索，org/project 名称 ILIKE 前缀 + `%`/`_` 转义 + kind/status 过滤 +
每类有界 limit 默认 25 上限 50）已真实存在。

## 职责

- Migration：
  - `1786700000011_platform-resource-policies` — `platform_resource_policies`（`id` PK、`version` 默认 1、
    PRD §15.8 六字段、`policy_source` CHECK、`updated_by` FK → `accounts`、ratio CHECK）；
  - `1786700000012_organization-policy-overrides` — `organization_policy_overrides`（`organization_id` PK + FK →
    `organizations`，五字段 + ratio CHECK）；
  - `1786700000013_project-policy-limits` — `project_policy_limits`（`project_id` PK + FK → `projects`，
    仅 `resource_limit` CHECK > 0）；
- `PlatformPolicyError`（`invalid_input|database_unavailable|statement_failed`，不暴露 SQLSTATE）；
- `run-migrations.ts`：node-pg-migrate runner（`checkOrder: false`，`migrationsTable: pgmigrations`）。

## 非职责

- 不实现 HTTP handler（PLT-10b Task 5）、Session/CSRF、平台命令鉴权（`apps/platform-api` 强制）；
- 不实现收费、组织自助、申请扩容、套餐、账单、动态成本优化（PRD §15.10）；
- 不创建 Redis/BullMQ/S3/对象存储/云资源/CI/IaC（ADR-032 YAGNI）；
- 不修改 ADR-034/035 决策，不修改 `@aurora/platform-admin` 既有接口。

## 数据层边界

- 本包只依赖 `pg`（外部），不依赖任何 workspace 包（Workspace Policy `data → {protocol}`）；
- 三张表的 `accounts`/`organizations`/`projects` FK 由 platform-identity/platform-project-governance
  migrations 提供，共享集成测试库已应用；本包集成测试经 node-pg-migrate runner 只运行本包 migrations
  （`checkOrder: false`），这是 test-only 跨目录迁移执行，不是包依赖。

## 对外接口

包根 `index.ts` 导出（Repository 能力已落档）：

- `PlatformPolicyError` / `PlatformPolicyErrorKind` / `toStableError` / `isPostgresCheckViolation`（稳定错误表面，不暴露 SQLSTATE）；
- 类型：`PlatformPolicyFields` / `StoredPolicySource` / `PolicySource` / `PlatformDefaultPolicy` / `OrganizationOverride` / `ProjectLimit`；
- 平台默认：`getPlatformDefaultPolicy` / `setPlatformDefaultPolicy` / `bootstrapPlatformDefaultIfAbsent`（ADR-035 建议默认值）；
- 组织覆盖：`getOrganizationOverride` / `setOrganizationOverride` / `resetOrganizationOverride`；
- 项目上限：`getProjectLimit` / `setProjectLimit` / `clearProjectLimit`；
- 目标搜索：`searchPolicyTargets`（`{ organizations; projects }`，名称 ILIKE 前缀、`%`/`_` 字面、kind/status 过滤、每类 limit 默认 25 上限 50、按名称升序）;
- 生效纯函数：`computeEffectivePolicy`（配置值/来源/生效值三者分离，无默认时返回 `null`）；
- `pnpm migrate`：运行本包 Migration（需先应用 platform-identity / platform-project-governance migrations）。

## 命令

```bash
pnpm --filter @aurora/platform-policy typecheck        # TypeScript strict
pnpm --filter @aurora/platform-policy test             # 单元测试（不连数据库）
pnpm --filter @aurora/platform-policy test:integration # 真实 PostgreSQL 17 集成测试
pnpm --filter @aurora/platform-policy test:coverage    # 覆盖率
pnpm --filter @aurora/platform-policy test:package     # 构建 + 包入口验证
pnpm --filter @aurora/platform-policy build            # 构建 dist
pnpm --filter @aurora/platform-policy migrate          # 运行本包 Migration（AURORA_TEST_DATABASE_URL；需先运行 platform-identity migrations）
```

集成测试需要真实 PostgreSQL 17，通过 `AURORA_TEST_DATABASE_URL` 连接（目标必须是
`aurora_inbox_test` 测试库，`assertIsTestDatabase` 强制）；禁止以 SQLite/mock/PGlite 替代真实数据库证据。

## 关联文档

- [平台资源策略数据模型（正式规格）](../../docs/architecture/platform-resource-policy-data-model.md)
- [ADR-035 平台资源策略数据模型](../../docs/adr/ADR-035-platform-resource-policy-data-model.md)
- [PLT-10b 实施计划](../../docs/superpowers/plans/2026-08-12-plt-10b-platform-resource-policy.md)
