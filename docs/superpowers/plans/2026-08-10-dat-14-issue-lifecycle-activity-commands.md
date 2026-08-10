# DAT-14 Issue Lifecycle Activity Commands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide the formal Issue lifecycle Commands (state/assignee/priority, member notes, merge, page-scoped batch) with server-enforced project handle authorization, optimistic version conflict handling, immutable activity evidence, and security audit — per approved DAT-14 spec + accepted ADR-033.

**Architecture:** Data-model-first + contract-first. Add `issue_activities`/`issue_notes` Migration and lifecycle/activity/notes/merge/batch Repositories to `@aurora/processing-store` (ADR-033 decision details 5c/5d); add role-aware project access to `@aurora/platform-project-governance`; register 7 Command operations + schemas in `@aurora/platform-contract` (new `issues-and-alerts` domain, OpenAPI regen + drift); add 7 handlers to `apps/platform-api` reusing G10 session/CSRF/idempotency/audit patterns.

**Tech Stack:** TypeScript, `pg` + node-pg-migrate, `@aurora/processing-store`, `@aurora/platform-project-governance`, `@aurora/platform-contract` (`/server` adapters), `@aurora/platform-identity` (`insertAuditEvent`), Fastify, Vitest + real PostgreSQL 17.10.

## 固定回读与权威边界

| 来源 | 用途 |
|---|---|
| `../../AGENTS.md` / `../../AURORA_RULES.md` | 任务路由、G03 边界、质量门禁 |
| `../architecture/issue-lifecycle-commands.md`（本文规格） | 7 个 Command、授权模型、状态机、活动/审计、并发/幂等的唯一权威来源（§3—§8） |
| `../adr/ADR-033-issue-aggregate-data-model.md`（accepted） | `issue_activities`/`issue_notes` 表结构（决定细节 5c/5d）、乐观 `version`（决定细节 3/4） |
| `../architecture/issue-aggregate-representative-sample-store.md`（approved，DAT-13） | `issues` 生命周期列存储形态、`by_time` 重开（只读） |
| `../superpowers/specs/2026-07-30-aurora-platform-openapi-and-implementation-design.md` | 操作命名约定 `domainVerbObject`、Route Target、Query/Command 通用约束 |
| `../superpowers/specs/2026-07-27-aurora-frontend-ux-ui-design.md` §9.16/§9.17 | C3/C4 页面 Command 语义（问题标识/版本、批量逐项结果） |
| G10 实现（`apps/platform-api/src/authorization.ts`、`routes/_shared.ts`、`idempotency.ts`、`@aurora/platform-identity` audit） | `effectivePermissions`/`requireSession`/`requireOrgManagerOnTransaction`/`runIdempotentCommand`/`insertAuditEvent` 复用 |
| `../adr/ADR-029/030` | 数据库工具链、Session/CSRF 物理参数 |

**Module ID: DAT-14**（G03 第三叶子）。本计划**不得**实现 DAT-15（Issue Query）、Console UI（G11）、Source Map（DAT-18）、告警（DAT-19）、数据保留（SEC-02）、保存视图/持久化选择。

## Global Constraints

- **服务端强制授权**：项目处理权限 = org manager 或 `project_members` 角色 `project_admin`/`developer`；`read_only`/非成员 403；不依赖前端按钮隐藏（`allowedActions` 纯展示投影，每次 Command 重新读取）。新增 `getProjectAccessRole`（platform-project-governance）返回项目角色供 handler 区分查看/处理。
- **项目隔离**：项目不存在/跨 org → 封闭 404（无存在性泄露）；无权限 403 且不调用数据 Repository。
- **乐观并发**：每个 Command 携带 `version`；`UPDATE issues SET ... WHERE id=$n AND version=$expected` 影响行数 0 → 409 `conflict`；成功 `version+1`。处理器自动重开也递增 `version`（DAT-13 已实现）。
- **幂等**：Command 复用 `runIdempotentCommand`/`requestDigest`（`idempotencyKey`）；重放返回首次结果、不重复写活动/审计。
- **活动不可编辑/删除**：`issue_activities` 每次成功 Command 写一条；`details` 只含安全结构化字段；actor projection 不暴露完整 email。
- **审计**：状态/负责人/优先级/合并/批量/管理员删备注写 `security_audit_events`（platform-api handler 在 Command 事务内经 `@aurora/platform-identity` `insertAuditEvent` 执行；processing-store 不写该表）。
- **隐私**：备注正文不进活动/审计 details；不暴露 token/secret/完整 email。
- 每 Task 目标验证：受影响 package `typecheck` + targeted tests + `git diff --check`；涉及 Migration 跑真实 PG；涉及 OpenAPI 跑 `platform-contract:generate` + `openapi:platform:lint` + `platform-contract-drift`。

---

### Task 1: `issue_activities`/`issue_notes` Migration + lifecycle repositories

**Files:**
- Create: `packages/processing-store/migrations/1722500000009_issue-activities-notes.ts`
- Create: `packages/processing-store/src/issue-lifecycle-types.ts`
- Create: `packages/processing-store/src/issue-lifecycle-repository.ts`
- Modify: `packages/processing-store/src/index.ts`
- Test: `packages/processing-store/test/issue-lifecycle-repository.test.ts`（输入校验单测）、`test/integration/issue-lifecycle.integration.test.ts`

**Migration（ADR-033 决定细节 5c/5d）：**
- `issue_activities`：`id bigserial PK`、`issue_id bigint NOT NULL REFERENCES issues(id) ON DELETE NO ACTION`、`project_id uuid NOT NULL`、`actor_account_id uuid NULL`、`activity_type varchar(32) NOT NULL`（closed 枚举 CHECK：`status_changed`/`assignee_changed`/`priority_changed`/`marked_resolved`/`reappeared`/`ignored`/`reopened`/`merged`/`note_added`/`note_deleted`）、`details jsonb NOT NULL`、`created_at`；索引 `(issue_id, created_at)`。
- `issue_notes`：`id bigserial PK`、`issue_id bigint NOT NULL REFERENCES issues(id) ON DELETE NO ACTION`、`project_id uuid NOT NULL`、`author_account_id uuid NOT NULL`、`content varchar NOT NULL`、`created_at`、`deleted_at timestamptz NULL`、`deleted_by_account_id uuid NULL`；索引 `(issue_id, created_at)`。

**Repositories（DAT-14 规格 §5—§8）：**
- `updateIssueState(client, input)`：`{ issueId, projectId, status, version, actorAccountId, resolution?{reason:'by_version',version?}|{reason:'by_time',resolvedAt?}, ignoredUntil? }`——closed 转移校验（`open`→`in_progress`→`resolved`/`ignored`；`resolved`/`ignored`→`open` 重开）；开始处理自动分配（`open` 未分配 → `in_progress` 同事务设负责人为 actor）；`UPDATE ... WHERE id AND version` 影响 0 → 冲突；成功 `version+1`；写 `status_changed`（+`assignee_changed` if auto-assigned，+`marked_resolved`/`ignored`/`reopened`）活动。
- `updateIssueAssignee(client, input)`：`{ issueId, projectId, assigneeAccountId|null, version, actorAccountId }`——`UPDATE ... version`；写 `assignee_changed`。
- `updateIssuePriority(client, input)`：`{ issueId, projectId, priority|null, version, actorAccountId }`——写 `priority_changed`。
- `createIssueNote(client, input)`：`{ issueId, projectId, authorAccountId, content }`（content 长度 ≤ `maxNoteLength=4096`）——INSERT note；写 `note_added` 活动。
- `deleteIssueNote(client, input)`：`{ issueId, projectId, noteId, actorAccountId, canDeleteSensitive }`——软删除（作者或管理员）；写 `note_deleted`。
- `mergeIssues(client, input)`：`{ issueId, primaryIssueId, projectId, version, actorAccountId }`——主问题计数/首末次重汇总、原问题 `merged_into_issue_id`、写 `merged` 活动。
- `batchUpdateIssues(client, input)`：`{ projectId, items: [{issueId, action, target, version}], actorAccountId }`（≤100）——逐项 `updateIssueState/Assignee/Priority` 的复用，逐项独立校验，返回每项成功/失败与原因。
- `appendIssueActivity(client, input)`：内部 helper，`issue_activities` INSERT（安全 details）。

**稳定错误**：`invalid_input`（非法转移/非法状态/非法优先级/超长备注/非法 version）、`conflict`（版本冲突）、`not_found`（issue 不存在或跨项目）、`temporarily_unavailable`。

- [ ] **Step 1: 写失败单测**（输入校验：非法状态/优先级/转移/超长备注/version 非整数；纯函数转移表）
- [ ] **Step 2: 运行失败**
- [ ] **Step 3: 实现 Migration + repositories + exports**
- [ ] **Step 4: 真实 PG 集成**（状态转移+自动分配事务、版本冲突 409、备注创建/软删除、合并重汇总、批量逐项部分结果、活动/备注表 Migration）+ typecheck + `git diff --check`

### Task 2: `getProjectAccessRole` + Platform Contract Command operations

**Files:**
- Modify: `packages/platform-project-governance/src/repositories/projects.ts`（新增 `getProjectAccessRole`）
- Modify: `packages/platform-project-governance/src/index.ts`
- Create: `packages/platform-contract/src/issues-and-alerts/issue-commands.ts`
- Modify: `packages/platform-contract/src/registry/operations.ts`（注册 7 个 Command 操作）
- Modify: `packages/platform-contract/src/index.ts`
- Modify: `docs/api/platform-openapi-v1.yaml`（重新生成）
- Test: `packages/platform-project-governance/test/...`、`packages/platform-contract/test/issues-and-alerts/issue-commands.test.ts`

**`getProjectAccessRole`**：`{ organizationId, projectId, accountId }` → `{ outcome:'allowed', role } | { outcome:'forbidden' } | { outcome:'not_found' }`（org manager → `project_admin`；project_members 返回其 role；跨 org/不存在 → `not_found`）。

**7 个 Command 操作（spec §3 + OpenAPI 命名约定 `domainVerbObject`，全部 `authLevel:'session'`、`csrf:true`、`idempotency:true`、路径 `/api/platform/v1/organizations/:organizationId/projects/:projectId`）：**
- `issuesUpdateState`：POST `.../issues/:issueId/state`，body `{ status, version, resolution?, ignoredUntil?, idempotencyKey }`
- `issuesUpdateAssignee`：POST `.../issues/:issueId/assignee`，body `{ assigneeAccountId?, version, idempotencyKey }`
- `issuesUpdatePriority`：POST `.../issues/:issueId/priority`，body `{ priority?, version, idempotencyKey }`
- `issuesCreateNote`：POST `.../issues/:issueId/notes`，body `{ content, idempotencyKey }`
- `issuesDeleteNote`：POST `.../issues/:issueId/notes/:noteId/delete`，body `{ idempotencyKey }`
- `issuesMerge`：POST `.../issues/:issueId/merge`，body `{ primaryIssueId, version, idempotencyKey }`
- `issuesBatchUpdate`：POST `.../issues/batch`，body `{ items: [...] , idempotencyKey }`

**错误码**：`structural_error`(400)/`authentication`(401)/`authorization`(403)/`not_found`(404)/`conflict`(409)/`idempotency_conflict`(409)/`field_validation`(422)/`rate_limited`(429)/`authority_unavailable`(503)。

- [ ] **Step 1: 写失败契约测试**（7 个操作注册、Schema 形状、合法/非法 body）
- [ ] **Step 2: 运行失败**
- [ ] **Step 3: 实现 getProjectAccessRole + contract 模块 + 注册表**
- [ ] **Step 4: OpenAPI 重新生成 + `openapi:platform:lint` + `platform-contract-drift` 通过 + typecheck + `git diff --check`**

### Task 3: platform-api Command handlers + authorization + integration

**Files:**
- Create: `apps/platform-api/src/routes/issues.ts`（7 个 handler）
- Modify: `apps/platform-api/src/routes/_shared.ts`（新增 `requireProjectHandleAccess`）
- Modify: `apps/platform-api/src/operations.ts`（7 个操作注册）
- Test: `apps/platform-api/test/issues.test.ts`（授权正反例/状态转移/版本冲突/审计投影）

**Handlers（复用 G10 模式）：**
- `parseInput` + `requireUuidParams` + `requireSession` + `effectivePermissions` + `requireProjectAccess`（查看）→ `requireProjectHandleAccess`（处理，基于 `getProjectAccessRole`：`project_admin`/`developer` 或 org manager）；
- Command 事务：`withTransaction` + `runIdempotentCommand` + `requireOrgManagerOnTransaction` 先例 → 事务内 `updateIssueState`（等 repository）+ `insertAuditEvent`（`@aurora/platform-identity`）；
- 稳定错误映射 `sendMappedError`/`sendProblem`；CSRF/Origin/Session 由既有插件；
- 响应：权威 issue 状态/活动摘要（actor 安全投影，不暴露完整 email）。

**审计 action**：`issue_status_changed`/`issue_assignee_changed`/`issue_priority_changed`/`issue_merged`/`issue_batch_updated`/`issue_note_deleted`（details 含 projectId/issueId/目标值，不含 token/secret/完整 email/备注正文）。

- [ ] **Step 1: 写失败 API 测试**（授权正例 developer、`read_only` 403、跨项目 404、版本冲突 409、状态转移+自动分配、审计投影）
- [ ] **Step 2: 运行失败**
- [ ] **Step 3: 实现 handler + `requireProjectHandleAccess`**
- [ ] **Step 4: 真实 PG 集成测试绿 + OpenAPI/drift + typecheck + `git diff --check`；无 UI、无 Chromium**

### Task 4: Docs sync + leaf verification

**Files:**
- Docs: `packages/processing-store/README.md`、`packages/platform-contract/README.md`、`apps/platform-api/README.md`、`docs/architecture/formalization-readiness.md`、`docs/README.md`、`docs/adr/ADR-018/033`、`AGENTS.md`、`AURORA_RULES.md`

- [ ] **Step 1: 文档/ADR 同步**（`issue_activities`/`issue_notes` 表、7 个 Command 操作、审计；ADR-033 追加 DAT-14 证据）
- [ ] **Step 2: 最终验证**（受影响 package typecheck、unit、targeted real-PG、OpenAPI/drift、lint、build、`git diff --check`）
- [ ] **Step 3: 独立 leaf reviewer** → ACCEPT → `completed 48→49 / remaining 30→29`，leaf-close commit
