---
title: PLT-04 Platform Workspace, Organization and Project Governance
status: approved
owner: platform/organization
created: 2026-08-09
last-reviewed: 2026-08-09
applies-to: 管理平台组织与项目治理第一增量——B1 工作空间/项目、B2 创建项目、B3 组织成员/邀请、B4 组织时区、B5 资源用量（前端 unavailable）、B6 私密管理令牌、B7 安全审计、B8 项目回收站；基于 accepted ADR-029/030/031/032 与 approved UX/PRD
related:
  - ../../adr/ADR-029-platform-database-access-and-migration.md
  - ../../adr/ADR-030-platform-session-csrf-password-physical-parameters.md
  - ../../adr/ADR-032-platform-outbox-tasks-cache-objects.md
  - ../superpowers/g10-approval-package.md
  - ../superpowers/specs/2026-08-09-platform-identity-authentication-invitation.md
  - ../../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md
  - ../superpowers/specs/2026-07-27-aurora-frontend-ux-ui-design.md
  - ../superpowers/specs/2026-07-28-aurora-platform-backend-design.md
supersedes: none
superseded-by: none
---

# PLT-04 Platform Workspace, Organization and Project Governance — 正式规格

## 1. 定位与效力

本规格是 G10 叶子 **PLT-04**（`feature/g10-identity-organization-governance` 分支，实施状态 42/36 目标）的正式实施依据。它把已批准的产品规则、accepted ADR-029/030/031/032、G10 APPROVAL PACKAGE approved product rules、approved UX/PRD 与真实 `@aurora/platform-contract` 契约基础形式化为可执行规格。PLT-03（身份/认证/邀请）已关闭（41/37），本规格构建于其 `organizations`/`organization_members`/`organization_invitations`/`project_members`/`security_audit_events` 表之上。

**已批准决策（本规格不重新询问）：**

| 决策 | 来源 |
|---|---|
| PostgreSQL 17 + Kysely + node-pg-migrate + SQL-first；data → {protocol} 边界 | ADR-029（accepted） |
| Argon2id/Session/CSRF 物理参数；B6 私密令牌参数口径并入本 ADR 范围 | ADR-030（accepted）+ G10 §六 |
| EmailDeliveryPort + Outbox；YAGNI 约束 | ADR-031/032（accepted） |
| 回收站恢复安全规则：恢复后告警不自动重启、已撤销令牌/失效密钥不恢复、成员/角色按当前组织状态重算、不复活删除清理状态 | G10 APPROVAL PACKAGE（approved product rule） |
| B5 `usageGetSummary` 保持 blocked（DAT-21 缺失），前端 `unavailable`，不造假 | G10 coherence audit |

**本规格不实现**：SEC-01（账号注销 A5 编排）、G11-G13、B5 真实 Usage Query、`identityDeleteAccountPreflight`/`identityDeleteAccount`。

## 2. 目标与非目标

### 目标

1. B1 工作空间/项目列表（`/workspace`）；
2. B2 创建项目（`organizationCreateProject`，原子创建项目+默认环境+默认客户端密钥+onboarding+审计）；
3. B3 组织成员与邀请（`organizationListMembers`/`organizationInviteMember` + 撤销/重发/改角色/移除成员/转让所有权 Command）；
4. B4 组织业务时区（`organizationUpdateTimezone`）；
5. B6 私密管理令牌（`credentialsListPrivateTokens`/`credentialsCreatePrivateToken`，一次性明文交付）；
6. B7 安全审计（`auditListSecurityAudit`，只读时间线）；
7. B8 项目回收站（`projectGovernanceListTrash`/`projectGovernanceRestoreProject`，G10 恢复安全规则）；
8. B5 资源用量页 `unavailable`（真实 operation 保留，前端 unavailable，不 fake）；
9. 真实 PostgreSQL 数据模型 + Migration + Repository + Command/Query + Platform API + Console 页面；
10. 全量测试：unit/migration/integration（真实 PG + Redis）/browser/security-negative/coverage。

### 非目标

- B5 真实 Usage Query（DAT-21 缺失，前端 unavailable）；
- SEC-01 账号注销编排（A5）；
- G11-G13 监控/发布/告警等下游页面（B 页完成后仍 unavailable）；
- 责任小组、邀请拒绝/历史/审批、自定义角色、成员本地时区切换、手动立即永久删除、批量恢复/删除；
- 不创建无 consumer 的基础设施（ADR-032 YAGNI）。

## 3. 系统边界与包结构

### 3.1 依赖方向（accepted ADR-002/006 + Workspace Policy）

```
apps/console (console 层) → packages/platform-contract (contract 层, client)
apps/platform-api (service 层)
  → packages/platform-contract (contract 层, server)
  → packages/platform-identity (data 层)  — PLT-03 已存在
  → packages/platform-session (data 层)   — PLT-03 已存在
  → packages/platform-email (data 层)     — PLT-03 已存在
  → packages/platform-organization (data 层)   — 本叶子新增
  → packages/platform-project-governance (data 层) — 本叶子新增
  → packages/platform-credentials (data 层)    — 本叶子新增
  → packages/platform-audit (data 层)          — 本叶子新增
apps/platform-worker (service 层) → ...（无新增）
```

- **`data` 层只允许依赖 `protocol` 层**（Workspace Policy `graph.ts`）。新增 4 个 data 包（organization/project-governance/credentials/audit）不依赖 `@aurora/platform-contract` 或彼此；跨 data 协作通过 service 层 handler 注入（PLT-03 已验证该模式）。
- `apps/platform-api` 是唯一消费契约 + 全部 data 包的 service 层；新 handler 沿用 PLT-03 的 `parseInput`/`serializeOutput`、Session/CSRF/Origin 插件、全局 RFC 9457 error handler。

### 3.2 新包（真实创建，镜像 PLT-03 data 包结构）

| 包 | 层 | 职责 |
|---|---|---|
| `packages/platform-organization` | data | organizations/members/invitations 的生命周期 Repository（创建项目外）、时区 Repository |
| `packages/platform-project-governance` | data | projects/client_keys/project_onboarding/project_members 生命周期 Repository（创建、回收站、归档状态） |
| `packages/platform-credentials` | data | private_tokens 表 + Repository（摘要存储、一次性交付、撤销） |
| `packages/platform-audit` | data | security_audit_events 读取 Repository（PRD §13.3 高风险事件、1y 保留、Tombstone） |

> **不新增应用**：B 页全部通过 `apps/platform-api`（已有）提供；`apps/platform-worker` 无新增职责。复用 PLT-03 的 Session/CSRF/Origin 插件与 idempotency/rate-limit 工具。

## 4. 数据模型（基于 ADR-029；PLT-03 已建表之上新增）

### 4.1 `projects` 表（B1/B2/B8；新增）

| 列 | 类型 | 约束 |
|---|---|---|
| `project_id` | uuid PK | `gen_random_uuid()` |
| `organization_id` | uuid FK | → `organizations.organization_id`，`NOT NULL` |
| `name` | text | `NOT NULL`，trim 2-50 字符（同 org 允许重名） |
| `framework_type` | text | `NOT NULL` CHECK IN ('javascript','react','vue','other') |
| `website_url` | text | NULL（可选生产网站地址） |
| `status` | text | `NOT NULL DEFAULT 'active'` CHECK IN ('active','archived','trash','deleting') |
| `created_by` | uuid FK | → `accounts.account_id`，`NOT NULL` |
| `archived_at` | timestamptz | NULL |
| `trashed_at` | timestamptz | NULL（进入回收站时间） |
| `recoverable_until` | timestamptz | NULL（默认 7 天） |
| `deletion_started_at` | timestamptz | NULL |
| `created_at` / `updated_at` | timestamptz | `NOT NULL DEFAULT now()` |

### 4.2 `client_keys` 表（B2 创建时原子生成；新增）

| 列 | 类型 | 约束 |
|---|---|---|
| `client_key_id` | uuid PK | `gen_random_uuid()` |
| `project_id` | uuid FK | → `projects.project_id`，`NOT NULL` |
| `public_identifier` | text | `NOT NULL` UNIQUE（`aurora_key_<...>` 公开标识，可进浏览器代码） |
| `key_digest` | text | `NOT NULL` UNIQUE（SHA-256，服务端只存摘要） |
| `enabled` | boolean | `NOT NULL DEFAULT true` |
| `allowed_origins` | jsonb | `NOT NULL DEFAULT '[]'` |
| `allowed_environments` | jsonb | `NOT NULL DEFAULT '[]'` |
| `last_used_at` | timestamptz | NULL |
| `created_at` / `updated_at` | timestamptz | |

### 4.3 `project_environments` 表（B2 默认 production；新增）

| 列 | 类型 | 约束 |
|---|---|---|
| `environment_id` | uuid PK | `gen_random_uuid()` |
| `project_id` | uuid FK | → `projects.project_id`，`NOT NULL` |
| `name` | text | `NOT NULL`（默认 `production`；内置 prod/staging/test/dev + 自定义） |
| `is_default` | boolean | `NOT NULL DEFAULT false` |
| `created_at` | timestamptz | |

### 4.4 `project_onboarding` 表（B2 创建时生成；新增）

| 列 | 类型 | 约束 |
|---|---|---|
| `project_id` | uuid PK/FK | → `projects.project_id` |
| `status` | text | `NOT NULL DEFAULT 'not_started'` CHECK IN ('not_started','in_progress','completed') |
| `current_step` | integer | `NOT NULL DEFAULT 0` |
| `first_request_at` | timestamptz | NULL |
| `completed_at` | timestamptz | NULL |
| `created_at` / `updated_at` | timestamptz | |

### 4.5 `private_tokens` 表（B6；新增，接 ADR-030 参数口径）

| 列 | 类型 | 约束 |
|---|---|---|
| `token_id` | uuid PK | `gen_random_uuid()` |
| `organization_id` | uuid FK | → `organizations.organization_id`，`NOT NULL` |
| `created_by` | uuid FK | → `accounts.account_id`，`NOT NULL` |
| `name` | text | `NOT NULL`（非敏感标识） |
| `token_digest` | text | `NOT NULL` UNIQUE（SHA-256，**绝不存明文**） |
| `scopes` | jsonb | `NOT NULL`，固定 allowlist（如 `['source_maps.upload','releases.write']`） |
| `expires_at` | timestamptz | NULL（无 = 永不过期；可设） |
| `revoked_at` | timestamptz | NULL（撤销不可逆） |
| `last_used_at` | timestamptz | NULL |
| `created_at` | timestamptz | |

### 4.6 `security_audit_events` 扩展（B7；PLT-03 已建表）

PLT-03 §4.9 表已存在（event_id/organization_id/actor_account_id/action/target_account_id/occurred_at/details）。PLT-04 通过 Migration 增加：`project_id`（nullable FK 或 tombstone 引用）、`result`（text，如 succeeded/failed/blocked）。details jsonb 继续禁止密码/token/完整邮箱。

> **Tombstone 语义**：项目永久删除后，audit 行保留最小非监控摘要（action/target 类型/时间/操作者），`project_id` 引用清空为 tombstone 标记（`deleted_project_id` 保留 uuid，不重建 FK 指向已删行）。

### 4.7 复用 PLT-03 表（不重建）

`organizations`（含 timezone 默认 UTC，B4 更新此列）、`organization_members`（owner 唯一不变量）、`organization_invitations`（7 天默认、partial unique pending）、`project_members`（project_admin/developer/read_only）。

## 5. 操作与契约（从 BLOCKED → PLATFORM_OPERATIONS stable）

### 5.1 解锁 11 个操作

| operationId | 方法/路径 | authLevel | CSRF | idempotency | page | domain |
|---|---|---|---|---|---|---|
| `organizationListProjects` | GET `/api/platform/v1/organizations/:organizationId/projects` | session | 否 | 否 | workspace.home | organization |
| `organizationCreateProject` | POST `/api/platform/v1/organizations/:organizationId/projects` | session | 是 | 是 | organization.project-create | project-governance |
| `organizationListMembers` | GET `/api/platform/v1/organizations/:organizationId/members` | session | 否 | 否 | organization.members | organization |
| `organizationInviteMember` | POST `/api/platform/v1/organizations/:organizationId/invitations` | session | 是 | 是 | organization.members | organization |
| `organizationRevokeInvitation` | POST `/api/platform/v1/organizations/:organizationId/invitations/:invitationId/revoke` | session | 是 | 否 | organization.members | organization |
| `organizationResendInvitation` | POST `/api/platform/v1/organizations/:organizationId/invitations/:invitationId/resend` | session | 是 | 否 | organization.members | organization |
| `organizationChangeRole` | POST `/api/platform/v1/organizations/:organizationId/members/:accountId/role` | session | 是 | 否 | organization.members | organization |
| `organizationRemoveMember` | POST `/api/platform/v1/organizations/:organizationId/members/:accountId/remove` | session | 是 | 否 | organization.members | organization |
| `organizationTransferOwnership` | POST `/api/platform/v1/organizations/:organizationId/ownership` | session | 是 | 是 | organization.members | organization |
| `organizationUpdateTimezone` | PATCH `/api/platform/v1/organizations/:organizationId/settings/timezone` | session | 是 | 否 | organization.settings | organization |
| `projectGovernanceListTrash` | GET `/api/platform/v1/organizations/:organizationId/trash` | session | 否 | 否 | organization.trash | project-governance |
| `projectGovernanceRestoreProject` | POST `/api/platform/v1/organizations/:organizationId/trash/:projectId/restore` | session | 是 | 是 | organization.trash | project-governance |
| `credentialsListPrivateTokens` | GET `/api/platform/v1/organizations/:organizationId/private-tokens` | session | 否 | 否 | organization.tokens | credentials |
| `credentialsCreatePrivateToken` | POST `/api/platform/v1/organizations/:organizationId/private-tokens` | session | 是 | 是 | organization.tokens | credentials |
| `credentialsRevokePrivateToken` | POST `/api/platform/v1/organizations/:organizationId/private-tokens/:tokenId/revoke` | session | 是 | 否 | organization.tokens | credentials |
| `auditListSecurityAudit` | GET `/api/platform/v1/organizations/:organizationId/audit` | session | 否 | 否 | organization.audit | audit |

> 注：注册表现有 `organizationCreateProject`/`organizationListProjects`/`organizationListMembers`/`organizationInviteMember`/`organizationUpdateTimezone`/`credentialsListPrivateTokens`/`credentialsCreatePrivateToken`/`auditListSecurityAudit`/`projectGovernanceListTrash`/`projectGovernanceRestoreProject` 为 blocked 占位。**B3 的撤销/重发/改角色/移除成员/转让所有权 与 B6 撤销、B2 额外动作在注册表没有 blocked 占位** —— 本规格新增这些 operationId（命名遵循 `/^[a-z][A-Za-z0-9]+$/` 与现有语义），从 PLATFORM_OPERATIONS 直接新增为 stable。`usageGetSummary` 保持 blocked。

### 5.2 关键请求/响应形状（草案，实施计划精化）

- `organizationListProjectsResponse`: `{ projects: [{projectId, name, frameworkType, status, lifecycle}], allowedActions, navigationTargets }`；
- `organizationCreateProjectRequest`: `{ name, frameworkType, websiteUrl?, idempotencyKey }`；`organizationCreateProjectResponse`: `{ projectId, clientKeyPublicIdentifier, defaultEnvironment, onboardingStatus, navigationTargets }`（**不返回 client key 明文**——客户端密钥可进浏览器但只上报；私密令牌才一次性明文）；
- `organizationInviteMemberRequest`: `{ email, orgRole, projectGrants?: [{projectId, projectRole}], idempotencyKey }`；`organizationInviteMemberResponse`: `{ invitationId, invitedEmailMasked, expiresAt, status }`；
- `organizationUpdateTimezoneRequest`: `{ timezone, resourceVersion }`；`organizationUpdateTimezoneResponse`: `{ organizationId, timezone, resourceVersion }`；
- `credentialsCreatePrivateTokenRequest`: `{ name, scopes, expiresAt?, idempotencyKey }`；`credentialsCreatePrivateTokenResponse`: `{ tokenId, tokenPlaintext, scopes, expiresAt }`（**tokenPlaintext 只在首次成功响应出现一次**，cache-prohibited）；
- `credentialsListPrivateTokensResponse`: `{ tokens: [{tokenId, name, scopes, expiresAt, revokedAt, lastUsedAt}] }`（**绝不返回 digest/明文**）；
- `projectGovernanceRestoreProjectRequest`: `{ resourceVersion, idempotencyKey }`；`projectGovernanceRestoreProjectResponse`: `{ projectId, status: 'active', lifecycle }`；
- `auditListSecurityAuditResponse`: `{ events: [{eventId, action, occurredAt, result, actorMasked, targetProjectRef?}] , pagination }`（只读红action 摘要）。

全部响应是 closed object（strict zod），不泄漏 token 明文/摘要/密码/客户端密钥明文。

## 6. 权限与授权（backend §7.1 + G10）

- **组织角色**：owner/admin/member；**项目角色**：project_admin/developer/read_only（PLT-03 已建表）。
- **有效权限**：query 时计算 = 组织继承（owner/admin 默认所有项目）+ 项目显式关系；`allowedActions` 只是 UI 投影，每个 Command 重新读取当前 membership/resource 版本/lifecycle。
- **唯一 Owner 不变量**：`TransferOwnership` 事务锁 org + 相关成员，post-commit 恰有一个 owner；普通 `ChangeOrganizationRole` 不得制造第二 owner 或无 owner。
- **B3 权限**：owner/admin 管理成员/邀请；`ChangeOrganizationRole` 不得把 owner 改为非 owner（必须走 Transfer）；`RemoveMember` 不得移除唯一 owner。
- **B8 权限**：回收站只看 org owner/admin，不依赖删除前项目角色。
- **B2 权限**：仅 org owner/admin 可创建项目；成员 403。
- **B6 权限**：owner/admin 可创建/撤销私密令牌；未验证邮箱禁止创建（PRD §4.1）。
- **B7 权限**：仅 org owner/admin 可见审计时间线；其余角色 forbidden 且不泄漏任何元数据。

## 7. B6 私密令牌物理参数（G10 §六，并入 ADR-030）

- **格式**：`aurora_pt_<tokenId>_<secret>` 一次性明文；服务端只存 SHA-256 摘要（`token_digest`）。
- **一次性交付**：明文只在首次成功创建响应出现；响应 `Cache-Control: no-store`；后续任何 Query/Operation Result 不重新显示。
- **secret_lost**：页面刷新/离开后无法恢复 → 识别元数据 → revoke → recreate。
- **scope allowlist**：固定公共 allowlist（如 `source_maps.upload`/`releases.write`）；服务端最终校验 caller 可授予这些 scope。
- **撤销不可逆**：`revoked_at` 设置后永不激活/恢复。
- **绝不进入**：URL、日志、前端 Store、Playwright trace、MSW fixture、错误报告。

## 8. B8 回收站恢复安全规则（G10 APPROVED product rule）

`projectGovernanceRestoreProject` 恢复后：

1. **状态由服务端决定**：只对 `trash`（recoverable_until 内）恢复；`deleting`/`deleted` 拒绝并返回当前权威状态；
2. **告警不自动重启**：恢复后 alert 规则保持关闭，管理员手动启用；
3. **已撤销私密令牌不恢复**（回收站放入时已撤销）；
4. **失效客户端密钥不恢复**（删除时已失效）；
5. **成员/角色按当前组织状态重算**：不恢复历史失效权限快照；
6. **不复活删除清理状态**：`trash → active` 只对仍在恢复窗口的 `trash` 生效。

恢复 Command：每次调用重新鉴权 + 校验仍可恢复 + idempotent + concurrency + CSRF + audit；任一步失败无假成功。

## 9. 失败语义与错误映射（RFC 9457 + accepted ADR-028）

沿用 PLT-03 §9：400 structural_error / 401 authentication / 403 authorization / 404 not_found（防枚举）/ 409 business_validation|state_machine_conflict|idempotency_conflict / 412 version_conflict / 422 field_validation / 429 rate_limited / 503 authority_unavailable|downstream_partial_failure。

**B 页专属**：
- B2 创建项目无权限 → 403 + 安全返回 B1（不泄漏可创建性）；
- B3 邀请唯一性冲突（同 org+email pending 已存在）→ 409 business_validation；
- B4 时区版本冲突 → 412 version_conflict（用服务端值重确认）；
- B6 创建令牌 scope 非法 → 422 field_validation；idempotency 同键不同请求 → 409 idempotency_conflict；
- B8 恢复窗口过期 → 409 state_machine_conflict + 当前状态。

## 10. 验收门禁（verification-before-completion）

| 类别 | 门禁 |
|---|---|
| unit | 各包 vitest：权限投影、owner 唯一、邀请状态机、时区校验、token 摘要/一次性、回收站恢复规则、审计 redaction |
| migration | node-pg-migrate up/down 幂等（真实 PostgreSQL 17） |
| real PostgreSQL integration | organization/project/credentials/audit Repository（真实 PG） |
| HTTP integration | `apps/platform-api`：B1-B8 全流程（真实 PG+Redis）；权限 403、owner 唯一、邀请原子、token 一次性、回收站恢复规则 |
| contract/codegen | OpenAPI lint、drift、manifest stable 列表更新 |
| package-entry | 各新包 test:package + platform-contract test:package |
| Console | vitest + Playwright（真实浏览器）+ axe；B1-B8 页面 + B5 unavailable |
| security-negative | token 明文不落日志/URL/Store、一次性不可重显、防枚举、CSRF 负例、Session 撤销负例、Redis down→503 |
| coverage | 各包阈值 |
| root | format/lint/typecheck/boundaries/build/git diff --check |

## 11. 完成定义

PLT-04 completed 当且仅当：

1. 16 个 B 操作从 blocked/新增 → stable，OpenAPI/client/server 真实生成，drift 门禁通过（`usageGetSummary` 保持 blocked）；
2. PostgreSQL Migration 真实存在（projects/client_keys/project_environments/project_onboarding/private_tokens + audit 扩展 + project_members FK 补全），up/down 幂等；
3. 权限模型（org + project 有效权限、owner 唯一、B8 只看 owner/admin）真实实现并测试；
4. 审计写入高风险管理 Command 同事务（PRD §13.3），B7 只读时间线 + 1y 保留 + Tombstone；
5. 私密令牌一次性明文交付 + 摘要存储 + 撤销不可逆（G10 §六 + ADR-030）；
6. 回收站恢复执行 G10 approved 安全规则（告警不重启/令牌密钥不恢复/成员角色重算/不复活清理状态）；
7. B5 资源用量页真实 `unavailable`（不 fake）；
8. Console 8 个真实页面通过 Playwright + axe；
9. 全部门禁新鲜通过（unit/migration/integration/browser/security-negative/coverage/boundaries）；
10. **独立验收通过**（verification-before-completion）；
11. 叶子计数 41/37 → **42/36**。

## 12. 与相邻叶子的边界

- **SEC-01**：账号注销 A5 编排与 deletion 状态机表保持 blocked；本叶子只做项目生命周期（active/archived/trash/deleting）的回收站恢复侧。
- **B5**：`usageGetSummary` 保持 blocked；本叶子前端 `unavailable`。
- **PLT-03**：本叶子复用其表与 Session/CSRF/Origin/idempotency/rate-limit 基础，不重建。
- **G11-G13**：监控/发布/告警等 C/D 页保持 unavailable，不实现。

## 13. 固定回读与权威边界

本规格是 PLT-04 的唯一实施依据，合并以下权威：

- PRD §4.2-4.6、§5.4、§12.3、§13、§15.4-15.8（B5 只读边界）、§16、§17；
- UX §7.8-7.15、§8.6-8.13、§9.6-9.13、§10.3-10.7；
- backend design §4/§6 B1-B8/§7.1/§8/§13；
- ADR-029/030/031/032（accepted）；G10 APPROVAL PACKAGE approved product rules；
- PLT-03 正式规格与真实实现基础；
- 真实 `packages/platform-contract` 契约基础与 `apps/console`/`apps/platform-api` 壳层。

**不变量（任何实现不得违反）**：

- token 明文/摘要/客户端密钥明文/密码绝不进入日志、URL、前端 Store、MSW fixture、Playwright trace；
- B5 用量绝不 fake（真实 operation 保留，前端 unavailable）；
- owner 唯一不变量任何 Command 不得破坏（无 owner 或双 owner）；
- 审计绝不由用户直接追加（只由管理 Command 同事务写入）；
- 恢复只对 `trash` 生效，不复活删除清理状态；
- 不实现 SEC-01/G11-G13 能力。
