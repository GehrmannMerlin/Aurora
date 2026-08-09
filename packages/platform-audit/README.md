# Aurora Platform Audit

## 模块定位

`@aurora/platform-audit` 是管理平台 B7 安全审计（只读时间线）的数据层包。它在 PLT-03 的
`security_audit_events` 表之上提供**只读** Repository：以脱敏摘要（action/result/occurredAt/
actorMasked/targetProjectRef）返回某一组织的高风险操作时间线，带游标分页与 B7 1 年保留窗口。
spec 见 [platform-workspace-organization-governance](../../docs/superpowers/specs/2026-08-09-platform-workspace-organization-governance.md)
§4.6/§5.2/§6。

本包是 PLT-04 Task 5 的结果：包结构、构建/类型检查/migrate 入口、`security_audit_events` 扩展
Migration（`project_id` + `result` + `(organization_id, occurred_at DESC)` 索引）与只读
Repository 均已真实存在。

## 职责

- Migration：在 PLT-03 `security_audit_events` 上增加 `project_id`（uuid，可空，**tombstone 引用，
  不是指向 `projects` 的 FK**——审计行必须存活于项目永久删除之后）、`result`（text，可空，契约枚举
  `succeeded|failed|blocked` + CHECK）与 `(organization_id, occurred_at DESC)` 时间线索引；up/down
  完全可逆；
- `listAuditEvents`：按 `organization_id` 读取脱敏审计时间线（最新优先），游标分页（base36 微秒 +
  uuid，≤64 字符），`from`/`to` 时间窗过滤；**默认 1 年保留**：未显式给 `from` 时仅返回
  `occurred_at >= now - 365 days` 的事件；
- **脱敏**：投影永远不返回完整 `details` jsonb、完整邮箱、密码、token 明文/摘要；`actorMasked` 由
  `actor_account_id` 派生（uuid 前 8 位十六进制 + `…`，无 actor 时返回稳定标签 `system`），绝不返回
  完整账号 id 或邮箱；
- **Tombstone**：`project_id` 为裸 uuid 且没有对应 `projects` 行（项目已永久删除）时，事件仍返回，
  `targetProjectRef: { projectId }` 携带该裸 uuid——读取路径不依赖 `projects` 行存在；
- `result` 为 NULL 时映射为契约要求的稳定默认 `succeeded`（文档化）；`AUDIT_RESULT_VALUES` 冻结枚举。

## 非职责

- **只读**：本包**绝不写入**审计事件。`insertAuditEvent` 由 PLT-03/PLT-04 管理包拥有，且只在管理
  Command 同事务内调用（PRD §13.3）；本包没有任何 insert 消费方；
- 不实现 HTTP handler（Task 6）、Session/CSRF、权限投影（B7 仅 org owner/admin 可见，权限在
  service 层 `apps/platform-api` 强制，本数据层只按 orgId 读取）；
- 不实现 SEC-01（A5 删除编排）、G11-G13、B5 真实 Usage Query；
- 不创建 Redis/BullMQ/S3/对象存储/云资源/CI/IaC（ADR-032 YAGNI）。

## 数据层边界

- 本包只依赖 `pg`（外部），不依赖 `@aurora/platform-contract` 或任何 workspace data 包（Workspace
  Policy `data → {protocol}`）；
- 集成测试经 node-pg-migrate runner 先运行 `packages/platform-identity/migrations`（PLT-03 表）再运行
  本包 migrations；这是 test-only 跨目录 migration 执行，不是包依赖。

## 对外接口

包根导出：

- `PLATFORM_AUDIT_PACKAGE` / `PLATFORM_AUDIT_VERSION`（稳定包标记）；
- `PlatformAuditError` / `PlatformAuditErrorKind`（稳定错误表面：`invalid_input` /
  `database_unavailable` / `statement_failed`，不暴露 SQLSTATE）；
- `listAuditEvents`（只读 B7 时间线）+ `AuditEventSummary` / `AuditPagination` /
  `ListAuditEventsInput` / `ListAuditEventsResult`；
- 纯函数：`maskActor` / `normalizeAuditResult` / `encodeAuditCursor` / `decodeAuditCursor`；
- 常量：`AUDIT_RESULT_VALUES` / `AUDIT_RESULT_DEFAULT` / `AUDIT_RETENTION_MS` /
  `DEFAULT_AUDIT_PAGE_SIZE` / `MAX_AUDIT_PAGE_SIZE` / `AUDIT_MASKED_UNKNOWN_ACTOR`。

不暴露数据库行、pg 错误、SQLSTATE、完整 `details`、邮箱、token 摘要/明文、内部路径。

## 命令

```bash
pnpm --filter @aurora/platform-audit typecheck        # TypeScript strict
pnpm --filter @aurora/platform-audit test             # 单元测试（不连数据库）
pnpm --filter @aurora/platform-audit test:integration # 真实 PostgreSQL 17 集成测试
pnpm --filter @aurora/platform-audit test:coverage    # 覆盖率
pnpm --filter @aurora/platform-audit test:package     # 构建 + 包入口验证
pnpm --filter @aurora/platform-audit build            # 构建 dist
pnpm --filter @aurora/platform-audit migrate          # 运行本包 Migration（AURORA_TEST_DATABASE_URL；需先运行 platform-identity migrations）
```

集成测试需要真实 PostgreSQL 17，通过 `AURORA_TEST_DATABASE_URL` 连接（目标必须是
`aurora_inbox_test` 测试库，`assertIsTestDatabase` 强制）；禁止以 SQLite/mock/PGlite 替代真实数据库证据。

## 关联文档

- [PLT-04 正式规格](../../docs/superpowers/specs/2026-08-09-platform-workspace-organization-governance.md)
- [PLT-04 实施计划](../../docs/superpowers/plans/2026-08-09-platform-workspace-organization-governance.md)
- [PLT-03 正式规格](../../docs/superpowers/specs/2026-08-09-platform-identity-authentication-invitation.md)
- [ADR-029 平台数据库访问与 Migration](../../docs/adr/ADR-029-platform-database-access-and-migration.md)
- [ADR-032 平台 Outbox/任务/缓存/对象存储](../../docs/adr/ADR-032-platform-outbox-tasks-cache-objects.md)
