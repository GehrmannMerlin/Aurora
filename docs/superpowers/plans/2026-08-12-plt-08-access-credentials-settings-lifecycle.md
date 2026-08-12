---
title: PLT-08 Access Credentials Settings and Project Lifecycle Implementation Plan
status: approved
owner: platform/console
created: 2026-08-12
last-reviewed: 2026-08-12
applies-to: C13—C16 公开机器契约解冻 + apps/platform-api handler + apps/console 真实页面（project.access / project.client-keys / project.settings / project.lifecycle）
related:
  - ../../../AGENTS.md
  - ../../../AURORA_RULES.md
  - ../../architecture/aurora-v1-remaining-module-batches.md
  - ../../superpowers/specs/2026-07-27-aurora-frontend-ux-ui-design.md
  - ../../superpowers/specs/2026-07-30-aurora-platform-openapi-and-implementation-design.md
  - ../../security/ingestion-client-credential-lifecycle.md
  - ../../security/ingestion-client-credential-storage-and-verification.md
  - ../../security/account-deletion-and-data-lifecycle.md
  - ../../../packages/platform-contract/src/registry/operations.ts
  - ../../../packages/platform-project-governance/src/repositories/projects.ts
  - ../../../packages/platform-project-governance/src/repositories/trash.ts
  - ../../../packages/ingestion-credentials/src/lifecycle-types.ts
supersedes: none
design-stage: implemented-in-feature-branch
---

# PLT-08 Access Credentials Settings and Project Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 解除 C13—C16 的公开服务端契约阻塞：把 G10/ADR-013/014 已存在的项目治理、成员、客户端上报密钥生命周期与审计能力正式化为 Platform Contract operations，补全缺失的少量 Repository，并接入 `apps/platform-api` handler 与 `apps/console` 真实页面。

**Architecture:** 全部复用既有服务端能力（`platform-project-governance` 的 `updateProjectStatus`/`trashProject`/`restoreProject`/`insertProjectMember`/`getProjectAccessRole`、`@aurora/ingestion-credentials` 的 create/disable/enable/revoke 一次性密钥、`insertAuditEvent` 审计），新增：① platform-contract 四份契约文件 + 注册表解冻；② 少量缺失 Repository（有效成员查询/改角色/移除、项目设置更新、环境 list/create、归档恢复、密钥 list）；③ platform-api 四个 handler 文件 + 一个共享权限函数；④ console 四个真实页面。不创建第二套权限/凭证/生命周期/审计模型。

**Tech Stack:** TypeScript、`@aurora/platform-contract`（schema builder + registry + OpenAPI 生成 + drift）、Fastify handler（`parseInput`/`serializeOutput`）、`@aurora/platform-project-governance`、`@aurora/ingestion-credentials`、Vue 3 SFC + `monitoring/` adapter、MSW、Playwright Chromium。

## 固定回读与权威边界

| Module ID | 完整回读文件 | 重点章节 | 本计划不得改变的业务逻辑 | 缺失门禁 |
| --------- | ------------ | -------- | ------------------------ | -------- |
| PLT-08 | `BASE-PRD`、`BASE-ARCH`、`BASE-IMPL`、`PLAT-DOMAINS`、`PLAT-UX`、`PLAT-STACK`、`PLAT-OAPI`、`ING-CREDENTIALS`、`SEC-A5`、`FORM` | PRD §4—5、§13、§17；UX/UI §7.28—7.30、§8.26—8.29、§9.26—9.29、§10.20—10.23、§11.3 | 组织继承只读、项目显式关系可操作；客户端上报密钥一次性交付且不提供再次查看；项目设置只改名称+可选网站地址、框架只读；archive/restore/永久删除严格区分且写审计；移入回收站仅 org manager；C15/C16 与账号删除（A5）分离 | 永久删除（trash 过期后台清理）属 SEC-02/worker 范畴，C16 不提供 UI 触发 |

## 契约阻塞快速审计结论（§6 A/B/C）

| 页面 | 核心操作 | 已有服务端能力（复用） | 缺失（本轮补） | 分类 |
|---|---|---|---|---|
| C13 | accessListEffectiveMembers / grant / change-role / remove | `listMembers`(org)、`getProjectAccessRole`、`insertProjectMember`、`insertAuditEvent` | `listProjectEffectiveMembers`/`changeProjectMemberRole`/`removeProjectMember` Repository | B（能力部分存在，补 Repository + 契约） |
| C14 | credentialsListClientKeys / create / disable / enable / revoke | `@aurora/ingestion-credentials` create/disable/enable/revoke/rotate + 一次性 secret + `insertAuditEvent` | `listIngestionClientCredentials`（metadata by project）Repository + 管理 HTTP API | A（生命周期已有）+B（list + 契约） |
| C15 | settingsGetProject / update / list-environments / create-environment | `getProjectById`、`project_environments` 表（B2 默认 production） | `updateProjectSettings`/`listProjectEnvironments`/`createProjectEnvironment` Repository | B |
| C16 | lifecycleArchive / restore-from-archive / move-to-trash | `updateProjectStatus`(archive)、`trashProject`、`restoreProject`(trash→active)、`insertAuditEvent` | `restoreFromArchive`（archive→active）Repository | A（archive/trash 已有）+B（restore-from-archive + 契约） |
| audit | 全部高风险操作 | `insertAuditEvent`（各 Repository 已写）+ `listSecurityAudit`（B7 已有） | 无 | A（复用） |

**结论：无 C 类 TRUE_PRODUCT_DECISION_MISSING；全部 A/B 类可实施。** 产品规则均有唯一权威来源（PRD §13/§17、UX/UI §7.28—7.30/§8.26—8.29、ADR-013/014）。C14 使用 `ingestion_client_credentials`（**真正**参与 SDK 上报认证，ingestion-api authorizer 验证）而非 `client_keys`（B2 默认密钥、C1 onboarding 展示，不参与上报认证）——产品语义 C14 = 客户端上报密钥。

## Global Constraints

- 只新增 PLT-08 必需 operations（16 个），不顺便扩展 Platform API；不创建第二套 access/credential/settings/lifecycle/audit 模型。
- C14 secret 一次性交付：`create`/`rotate` 返回的 `clientKey` 只出现在首次成功响应（`Cache-Control: no-store`），幂等重放返回 `SECRET_LOST_PLACEHOLDER` 语义；不进 Pinia/URL/localStorage/console/日志/截图。
- 危险操作独立确认：C16 archive/restore/move-to-trash 独立按钮 + 确认，不与 settings save 共用；move-to-trash 需精确输入当前权威项目名称（`resourceVersion` 乐观并发）。
- 权限：查看 = `requireProjectAccess`；C13/C14/C15 管理与 C16 archive/restore = org manager 或 `project_admin`（新增 `requireProjectAdminAccess`）；C16 move-to-trash = `requireOrgManager`。前端不隐藏按钮代替授权，服务端每次重鉴权。
- 状态诚实：`loading`/`empty`/`error`/`forbidden`/`processing`/`partial`/`stale`/`unavailable` 用 `monitoring/section.ts` 统一映射；缺失一律 `empty`/`unavailable`。
- 审计只消费真实服务端能力：C13/C14/C16 写操作在各 Repository 内 `insertAuditEvent`（或 handler 内），前端不伪造 audit entry。
- 不修改 PLT-07、不重复 SEC-01/SEC-02、不提前 G13、不修改 G04 服务端业务语义、不破坏 G16。
- 只正式化 PLT-08 必需 operations；`client_keys`（B2/C1）与 `ingestion_client_credentials` 的整合不一致属既有架构债务，本轮不重构（登记于报告）。

## File Structure

新增（platform-contract 契约）：

- `packages/platform-contract/src/project-governance/access.ts` — C13 4 操作
- `packages/platform-contract/src/credentials/client-keys.ts` — C14 5 操作
- `packages/platform-contract/src/project-governance/settings.ts` — C15 4 操作
- `packages/platform-contract/src/project-governance/lifecycle.ts` — C16 3 操作

新增（Repository 补全）：

- `packages/platform-project-governance/src/repositories/access.ts` — `listProjectEffectiveMembers`/`changeProjectMemberRole`/`removeProjectMember`
- `packages/platform-project-governance/src/repositories/settings.ts` — `updateProjectSettings`/`listProjectEnvironments`/`createProjectEnvironment`
- `packages/platform-project-governance/src/repositories/lifecycle.ts` — `restoreFromArchive`
- `packages/ingestion-credentials/src/credential-list.ts` — `listIngestionClientCredentials`

新增（platform-api handler）：

- `apps/platform-api/src/routes/access.ts` — C13 4 handler
- `apps/platform-api/src/routes/client-keys.ts` — C14 5 handler
- `apps/platform-api/src/routes/project-settings.ts` — C15 4 handler
- `apps/platform-api/src/routes/lifecycle.ts` — C16 3 handler

新增（console 页面 + adapter）：

- `apps/console/src/views/project/ProjectAccessView.vue` + `access-view-model.ts`
- `apps/console/src/views/project/ProjectClientKeysView.vue` + `client-keys-view-model.ts`
- `apps/console/src/views/project/ProjectSettingsView.vue` + `settings-view-model.ts`
- `apps/console/src/views/project/ProjectLifecycleView.vue` + `lifecycle-view-model.ts`

新增（测试）：

- `packages/platform-contract/test/project-governance/access.test.ts`、`client-keys.test.ts`、`settings.test.ts`、`lifecycle.test.ts`
- `packages/platform-project-governance/test/`（access/settings/lifecycle 单元 + 集成，视本地 infra）
- `apps/console/test/views/project/access-view-model.test.ts`、`client-keys-view-model.test.ts`、`settings-view-model.test.ts`、`lifecycle-view-model.test.ts`
- `apps/console/test/monitoring/access-commands.test.ts`、`client-keys-commands.test.ts`、`settings-commands.test.ts`、`lifecycle-commands.test.ts`
- `apps/console/test-browser/g12-access-settings-smoke.spec.ts`

修改：

- `packages/platform-contract/src/registry/operations.ts` — 注册 16 操作、从 `BLOCKED_OPERATIONS` 移除 4 个（`accessListEffectiveMembers`/`credentialsListClientKeys`/`settingsGetProject`/`lifecycleArchiveProject`）
- `packages/platform-contract/src/index.ts` — 导出新 contract 常量/类型
- `packages/platform-project-governance/src/index.ts` — 导出新 Repository
- `packages/ingestion-credentials/src/index.ts` — 导出 `listIngestionClientCredentials`
- `apps/platform-api/src/routes/_shared.ts` — 新增 `requireProjectAdminAccess`
- `apps/platform-api/src/app.ts` — 注册新 handler
- `apps/platform-api/src/operations.ts` — 自动包含（listServerOperations 从 registry 生成）
- `apps/console/src/monitoring/queries.ts` + `commands.ts` — 追加 C13—C16 typed consumers
- `apps/console/src/contracts/route-registry.ts` — C13—C16 路由接真实组件
- `apps/console/src/mocks/handlers.ts` — 追加 C13—C16 MSW 投影
- `apps/console/test/contracts/route-registry.test.ts` — C13—C16 加入 real set + 断言

## 数据契约速查（新 operations）

- **C13**：`accessListEffectiveMembers`(GET) → `queryResponse(sectionResult({items:[{accountId, maskedEmail, effectiveRole, sources:('org_inherited'|'project_member')[], projectRole?, allowedActions}]}))`；`accessGrantProjectMembership`/`accessChangeProjectRole`(POST, body `{accountId?, role, idempotencyKey}`) → `{data:{status, accountId, role}}`；`accessRemoveProjectMembership`(POST, body `{idempotencyKey}`) → `{data:{status, accountId, remainingSources}}`。
- **C14**：`credentialsListClientKeys`(GET) → `queryResponse(sectionResult({items:[{credentialId, keyId, status('active'|'disabled'|'revoked'), allowNonBrowser, expiresAt?, origins, environments, createdAt, updatedAt}]}))`；`credentialsCreateClientKey`(POST, body `{origins[], environments[], allowNonBrowser, expiresAt?, idempotencyKey}`) → `{data:{status, credentialId, keyId, clientKey, expiresAt?, origins, environments}}`（一次性）；`credentialsDisableClientKey`/`credentialsEnableClientKey`/`credentialsRevokeClientKey`(POST, body `{idempotencyKey}`) → `{data:{status, credentialId, keyId}}`。
- **C15**：`settingsGetProject`(GET) → `queryResponse({project:{projectId, name, frameworkType, websiteUrl?, lifecycle:{status, archivedAt?, trashedAt?, recoverableUntil?}, resourceVersion}})`；`settingsUpdateProject`(PATCH, body `{name, websiteUrl?, resourceVersion, idempotencyKey}`) → `{data:{status, projectId, name, websiteUrl?, resourceVersion}}`；`settingsListEnvironments`(GET) → `queryResponse(sectionResult({items:[{environmentId, name, isDefault, createdAt}]}))`；`settingsCreateEnvironment`(POST, body `{name, idempotencyKey}`) → `{data:{status, environmentId, name}}`。
- **C16**：`lifecycleArchiveProject`/`lifecycleRestoreProject`(POST, body `{idempotencyKey}`) → `{data:{status, projectId}}`；`lifecycleMoveToTrash`(POST, body `{resourceVersion, idempotencyKey}`) → `{data:{status:'trashed', projectId, trashedAt, recoverableUntil}}`。
- 权限错误统一 `authorization`；状态机冲突 `state_machine_conflict`；版本冲突 `version_conflict`；一次性 secret 重放 `idempotency_conflict`。

---

### Task 1: C13—C16 Platform Contract / OpenAPI unblocking

**Files:**
- Create: `packages/platform-contract/src/project-governance/access.ts`、`settings.ts`、`lifecycle.ts`
- Create: `packages/platform-contract/src/credentials/client-keys.ts`
- Create: `packages/platform-contract/test/project-governance/access.test.ts`、`settings.test.ts`、`lifecycle.test.ts`
- Create: `packages/platform-contract/test/credentials/client-keys.test.ts`
- Modify: `packages/platform-contract/src/registry/operations.ts`、`packages/platform-contract/src/index.ts`

**Interfaces:**
- Consumes: schema builders（`obj/str/num/enum_/optional/arr/bool/queryResponse/sectionResult/utcTimestamp`）、`idempotencyKey`、identifiers（`AccountId/OrganizationId/ProjectId/CredentialId/EnvironmentId`）、`navigationTargets`
- Produces: 16 个 `OPERATION_ID_*` 常量 + `*PathParams/*Body/*Response` schema；注册到 `PLATFORM_OPERATIONS`；从 `BLOCKED_OPERATIONS` 移除 4 个；`pnpm platform-contract:generate` 重生成 `docs/api/platform-openapi-v1.yaml`；drift 通过

- [ ] **Step 1: 创建 access.ts（C13 契约）**

```ts
import { arr, bool, enum_, obj, optional, str } from '../common/schema.js';
import { queryResponse } from '../common/query.js';
import { sectionResult } from '../common/section.js';
import { idempotencyKey } from '../common/command.js';
import { AccountId, OrganizationId, ProjectId } from '../common/identifiers.js';

export const OPERATION_ID_ACCESS_LIST = 'accessListEffectiveMembers' as const;
export const OPERATION_ID_ACCESS_GRANT = 'accessGrantProjectMembership' as const;
export const OPERATION_ID_ACCESS_CHANGE_ROLE = 'accessChangeProjectRole' as const;
export const OPERATION_ID_ACCESS_REMOVE = 'accessRemoveProjectMembership' as const;

export const PROJECT_ROLE_VALUES = ['project_admin', 'developer', 'read_only'] as const;

const effectiveMember = obj({
  accountId: AccountId,
  maskedEmail: str(1, 320),
  effectiveRole: enum_(PROJECT_ROLE_VALUES),
  sources: arr(enum_(['org_inherited', 'project_member']), 1, 2),
  projectRole: optional(enum_(PROJECT_ROLE_VALUES)),
  allowedActions: arr(enum_(['read', 'manage']), 1, 2),
});

export const accessListEffectiveMembersPathParams = obj({ organizationId: OrganizationId, projectId: ProjectId });
export const accessListEffectiveMembersResponse = queryResponse(sectionResult(obj({ items: arr(effectiveMember, 0, 200) })));

export const accessGrantProjectMembershipPathParams = obj({ organizationId: OrganizationId, projectId: ProjectId });
export const accessGrantProjectMembershipBody = obj({ accountId: AccountId, role: enum_(PROJECT_ROLE_VALUES), idempotencyKey });
export const accessGrantProjectMembershipResponse = obj({ data: obj({ status: enum_(['granted']), accountId: AccountId, role: enum_(PROJECT_ROLE_VALUES) }) });

export const accessChangeProjectRolePathParams = obj({ organizationId: OrganizationId, projectId: ProjectId, accountId: AccountId });
export const accessChangeProjectRoleBody = obj({ role: enum_(PROJECT_ROLE_VALUES), idempotencyKey });
export const accessChangeProjectRoleResponse = obj({ data: obj({ status: enum_(['changed']), accountId: AccountId, role: enum_(PROJECT_ROLE_VALUES) }) });

export const accessRemoveProjectMembershipPathParams = obj({ organizationId: OrganizationId, projectId: ProjectId, accountId: AccountId });
export const accessRemoveProjectMembershipBody = obj({ idempotencyKey });
export const accessRemoveProjectMembershipResponse = obj({
  data: obj({
    status: enum_(['removed']),
    accountId: AccountId,
    remainingSources: arr(enum_(['org_inherited', 'project_member']), 0, 2),
  }),
});
```
（`settings.ts` 的 `settingsGetProject`/`settingsUpdateProject`/`settingsListEnvironments`/`settingsCreateEnvironment`、`lifecycle.ts` 的 `lifecycleArchiveProject`/`lifecycleRestoreProject`/`lifecycleMoveToTrash`、`client-keys.ts` 的 5 个操作按同一模式与上述"数据契约速查"定义，`resourceVersion` 用 `str(1,64)`，`clientKey` 用 `str(20, 256)`，`keyId` 用 `str(8, 128)`。）

- [ ] **Step 2: 注册到 operations.ts + 解冻 BLOCKED**

把 16 个 `OperationDef` 追加到 `PLATFORM_OPERATIONS`（参照 `releases.ts`/`alerts.ts` 条目：`domain`/`authLevel:'session'`/`method`/`path`/`request`（写操作 `csrf:true`、`idempotency:true`；update 加 `versioned:true`）/`responses`/`page`/`tags`）；从 `BLOCKED_OPERATIONS` 删除 `accessListEffectiveMembers`/`credentialsListClientKeys`/`settingsGetProject`/`lifecycleArchiveProject`。在 `src/index.ts` 导出新常量与 schema。

- [ ] **Step 3: 写契约测试（failing）**

在四个测试文件中断言：每个操作有合法 request/response 样本；`client-keys` create/disable/enable/revoke 响应含一次性 `clientKey` 且 schema 通过；`lifecycleMoveToTrash` 含 `resourceVersion`；非法 role/空 recipients → `structural_error`。运行见 Task 4 命令 A。

- [ ] **Step 4: 重新生成 OpenAPI + drift**

Run: `pnpm platform-contract:generate && pnpm platform-contract:drift`
Expected: 无未提交差异；drift 全 PASS（16 新操作进入 `docs/api/platform-openapi-v1.yaml`）。

- [ ] **Step 5: Commit**

```bash
git add packages/platform-contract/src packages/platform-contract/test docs/api/platform-openapi-v1.yaml docs/api/platform-openapi-v1.manifest.json
git commit -m "feat(contract): PLT-08 C13-C16 access/credentials/settings/lifecycle operations unblocked"
```

---

### Task 2: access + credentials workspace（C13/C14 Repository + handler + console）

**Files:**
- Create: `packages/platform-project-governance/src/repositories/access.ts`
- Create: `packages/ingestion-credentials/src/credential-list.ts`
- Create: `apps/platform-api/src/routes/access.ts`、`apps/platform-api/src/routes/client-keys.ts`
- Create: `apps/console/src/views/project/ProjectAccessView.vue`、`access-view-model.ts`、`ProjectClientKeysView.vue`、`client-keys-view-model.ts`
- Create: `apps/console/test/views/project/access-view-model.test.ts`、`client-keys-view-model.test.ts`、`apps/console/test/monitoring/access-commands.test.ts`、`client-keys-commands.test.ts`
- Modify: `packages/platform-project-governance/src/index.ts`、`packages/ingestion-credentials/src/index.ts`、`apps/platform-api/src/routes/_shared.ts`、`apps/platform-api/src/app.ts`、`apps/console/src/monitoring/queries.ts`、`apps/console/src/monitoring/commands.ts`、`apps/console/src/mocks/handlers.ts`

**Interfaces:**
- Consumes: `listMembers`(org)、`getProjectAccessRole`、`insertProjectMember`、ingestion-credentials lifecycle functions、`requireProjectAccess`/`requireProjectHandleAccess`（复用语义）、`maskEmail`
- Produces: `listProjectEffectiveMembers(pool, {orgId, projectId})`、`changeProjectMemberRole(pool, {orgId, projectId, accountId, role, actorId})`、`removeProjectMember(pool, {orgId, projectId, accountId, actorId})`、`listIngestionClientCredentials(pool, {projectId})`；console: `fetchEffectiveMembers`/`grantProjectMembership`/`changeProjectRole`/`removeProjectMembership`、`fetchClientKeys`/`createClientKey`/`disableClientKey`/`enableClientKey`/`revokeClientKey`

- [ ] **Step 1: 写 access Repository（platform-project-governance）**

`listProjectEffectiveMembers`：一条 SQL 按人聚合 —— org 成员（带 org role）+ 该项目 `project_members` 行（带 project role），`effectiveRole = org manager ? 'project_admin' : projectRole`，`sources` 为命中来源，`allowedActions = effectiveRole === 'project_admin' ? ['read','manage'] : ['read']`。`changeProjectMemberRole`/`removeProjectMember`：`UPDATE`/`DELETE project_members`（org 继承行不可被 remove 影响），各写 `project.member_role_changed`/`project.member_removed` 审计。

- [ ] **Step 2: 写 credential-list Repository（ingestion-credentials）**

`listIngestionClientCredentials(pool, {projectId})`：`SELECT` `ingestion_client_credentials` 行 + join `origins`/`environments`，返回 `CredentialMetadata` 数组（不含 digest/secret），按 `created_at DESC`。

- [ ] **Step 3: 新增 requireProjectAdminAccess（_shared.ts）**

复制 `requireProjectAlertManageAccess` 语义：org manager（owner/admin）或 `project_members.role === 'project_admin'` 允许，否则 403；同时提供 `requireProjectAdminAccessOnTransaction`。把 `requireProjectAlertManageAccess` 的调用改为复用新函数（或保留，二者等价）。

- [ ] **Step 4: 写 C13/C14 handler**

`access.ts`：4 个 handler —— `authorizeProjectAdmin`（session + org membership + project 查看 + admin 管理）；list 用 `listProjectEffectiveMembers`；grant/change/remove 在 `runIdempotentCommand` 事务内 re-read admin 权限 + 调用 Repository + `insertAuditEvent`（grant/change/remove 各写 `project.member_granted`/`member_role_changed`/`member_removed`）。`client-keys.ts`：5 个 handler —— list 用 `listIngestionClientCredentials`；create 用 `createIngestionClientCredential`（一次性 `clientKey` 只附首次成功响应，`Cache-Control: no-store`，幂等重放返回 `SECRET_LOST_PLACEHOLDER` 语义，参照 `private-tokens.ts` 的 `SECRET_LOST_PLACEHOLDER` 模式）；disable/enable/revoke 用对应 lifecycle 函数 + 审计（`client_key.disabled`/`enabled`/`revoked`）。所有 handler 用 `parseInput`/`serializeOutput`/`sendMappedError`。

- [ ] **Step 5: 注册 handler 到 app.ts**

在 `apps/platform-api/src/app.ts` import 并注册 9 个新 handler（参照既有 routes 注册方式）。

- [ ] **Step 6: 写 console adapter + view-model + views**

`monitoring/queries.ts` 追加 `fetchEffectiveMembers`/`fetchClientKeys`；`monitoring/commands.ts` 追加 7 个命令（grant/change/remove/create/disable/enable/revoke，带 CSRF + idempotency；create 捕获一次性 `clientKey`）。`access-view-model.ts`：`buildAccessView({loading, error, members})` → `SectionView` + 行级 `allowedActions` 投影 + `sourcesLabel`（组织继承/项目成员）。`client-keys-view-model.ts`：`buildClientKeysView` + `CreateKeyPhase`（一次性 secret 显示态：`secret-revealed`→"现在保存，关闭后无法再次查看"+ 复制按钮 + 离开即清空）。`ProjectAccessView.vue`（成员清单 + 授予/改角色/移除，org 继承行只读）/`ProjectClientKeysView.vue`（列表 + 创建表单 + 一次性 secret 面板 + disable/enable/revoke）。

- [ ] **Step 7: 写 console 测试（failing）**

`access-view-model.test.ts`：org-inherited 行只读、sources 分离、remove 后 remainingSources；`client-keys-view-model.test.ts`：一次性 secret 只在创建后显示、离开清空、revoke 不可逆提示；`access-commands/client-keys-commands.test.ts`：operationId/body/CSRF/一次性 clientKey 透传。运行见 Task 4 命令 B。

- [ ] **Step 8: mocks/handlers.ts 追加 C13/C14 MSW**

`mockEffectiveMembers()`（org-inherited + project_member 行）+ `mockClientKeys()`（active/disabled/revoked 各 1）+ create 返回一次性 `clientKey` + disable/enable/revoke 状态；递增 `handlerControls` 计数。

- [ ] **Step 9: 机械检查**（typecheck 片段；机械错误最小修复一次）

- [ ] **Step 10: Commit**

```bash
git add packages/platform-project-governance/src packages/ingestion-credentials/src apps/platform-api/src apps/console/src apps/console/test apps/console/src/mocks/handlers.ts
git commit -m "feat(api+console): PLT-08 C13 access + C14 client-key workspaces"
```

---

### Task 3: settings + lifecycle workspace（C15/C16）

**Files:**
- Create: `packages/platform-project-governance/src/repositories/settings.ts`、`lifecycle.ts`
- Create: `apps/platform-api/src/routes/project-settings.ts`、`apps/platform-api/src/routes/lifecycle.ts`
- Create: `apps/console/src/views/project/ProjectSettingsView.vue`、`settings-view-model.ts`、`ProjectLifecycleView.vue`、`lifecycle-view-model.ts`
- Create: `apps/console/test/views/project/settings-view-model.test.ts`、`lifecycle-view-model.test.ts`、`apps/console/test/monitoring/settings-commands.test.ts`、`lifecycle-commands.test.ts`
- Modify: `packages/platform-project-governance/src/index.ts`、`apps/platform-api/src/app.ts`、`apps/console/src/monitoring/queries.ts`、`apps/console/src/monitoring/commands.ts`、`apps/console/src/mocks/handlers.ts`

**Interfaces:**
- Consumes: `getProjectById`、`updateProjectStatus`、`trashProject`、`restoreProject`、`insertAuditEvent`、`requireOrgManager`、`requireProjectAdminAccess`
- Produces: `updateProjectSettings(pool, {orgId, projectId, name, websiteUrl?, expectedVersion, actorId})`、`listProjectEnvironments(pool, {orgId, projectId})`、`createProjectEnvironment(pool, {orgId, projectId, name, actorId})`、`restoreFromArchive(pool, {orgId, projectId, expectedVersion, actorId})`；console: `fetchProjectSettings`/`updateProjectSettings`/`fetchEnvironments`/`createEnvironment`、`archiveProject`/`restoreProject`/`moveProjectToTrash`

- [ ] **Step 1: 写 settings Repository（platform-project-governance）**

`updateProjectSettings`：`SELECT ... FOR UPDATE` 项目行，校验 `expectedVersion`（项目 `updated_at` ISO 键，参照 `restoreProject` 的 `isoVersionKey`），更新 `name`（2—50 字符）+ `website_url`（可选），写 `project.settings_updated` 审计，返回新版本；`version_conflict`/`not_found`/`state_machine_conflict`（非 active 项目）稳定结果。`listProjectEnvironments`：`SELECT` `project_environments` 行（`environmentId`/`name`/`is_default`/`created_at`）。`createProjectEnvironment`：校验名称唯一（project 内）与格式（1—32 字符），`INSERT`，写 `project.environment_created` 审计。

- [ ] **Step 2: 写 lifecycle Repository（platform-project-governance）**

`restoreFromArchive`：`SELECT ... FOR UPDATE`，仅 `archived` → `active`（清 `archived_at`），写 `project.restored_from_archive` 审计，`expectedVersion` 乐观并发；`state_machine_conflict`（非 archived）稳定结果。**不**复用 `restoreProject`（那是 trash→active 带回收站窗口语义）。

- [ ] **Step 3: 写 C15/C16 handler**

`project-settings.ts`：4 个 handler —— get（project 查看权限，`settingsGetProject` 返回 project + lifecycle 摘要 + `resourceVersion`）；update（org manager 或 project_admin，`versioned:true`，`version_conflict`→412）；list-environments（查看权限）；create-environment（admin 权限，`state_machine_conflict`/`field_validation` 映射）。`lifecycle.ts`：3 个 handler —— archive/restore（admin 权限）；move-to-trash（`requireOrgManager`，`resourceVersion` 校验，`state_machine_conflict`→409，成功返回 `trashedAt`/`recoverableUntil`）。

- [ ] **Step 4: 注册 handler 到 app.ts**

- [ ] **Step 5: 写 console adapter + view-model + views**

`ProjectSettingsView.vue`：双标签 `?tab=general|environments`（URL 权威，默认 general，参照 C10 模式）；general = 名称 + 可选网站地址（框架只读），保存用 `updateProjectSettings`（`version_conflict` → 提示刷新）；environments = 列表 + 创建表单（创建后不可改名/删除说明）。`ProjectLifecycleView.vue`：生命周期摘要（status/archivedAt/trashedAt/recoverableUntil + `resourceVersion`）+ 三个独立危险动作区 —— archive（确认）/ restore-from-archive（确认）/ move-to-trash（**输入当前权威项目名称确认** + `resourceVersion`）；move-to-trash 仅 org manager 可见入口（服务端仍重鉴权）。`lifecycle-view-model.ts`：`buildLifecycleView` + `TrashConfirmState`（名称匹配校验）。

- [ ] **Step 6: 写 console 测试（failing）**

`settings-view-model.test.ts`：general/environments 双标签、框架只读、save 版本冲突；`lifecycle-view-model.test.ts`：archive/restore/move-to-trash 分离、trash 名称确认匹配、state_machine_conflict 映射；命令测试：operationId/body/CSRF。运行见 Task 4 命令 B。

- [ ] **Step 7: mocks/handlers.ts 追加 C15/C16 MSW**

`mockProjectSettings()`（active + production env）、`mockLifecycleStatus()`；POST archive/restore/move-to-trash 返回对应状态；递增 `handlerControls`。

- [ ] **Step 8: 机械检查**

- [ ] **Step 9: Commit**

```bash
git add packages/platform-project-governance/src apps/platform-api/src apps/console/src apps/console/test apps/console/src/mocks/handlers.ts
git commit -m "feat(api+console): PLT-08 C15 settings + C16 lifecycle workspaces"
```

---

### Task 4: routing / focused acceptance / docs-status

**Files:**
- Modify: `apps/console/src/contracts/route-registry.ts`（C13—C16 接真实组件）、`apps/console/test/contracts/route-registry.test.ts`
- Create: `apps/console/test-browser/g12-access-settings-smoke.spec.ts`
- Modify: `AGENTS.md`、`AURORA_RULES.md`（ledger 同步 67/11→68/10）

**Interfaces:**
- Consumes: Task 1—3 全部契约与页面
- Produces: C13—C16 路由真实可达；ledger 更新；G12 状态记录

- [ ] **Step 1: route-registry 接线**

新增 `projectAccessView`/`projectClientKeysView`/`projectSettingsView`/`projectLifecycleView` lazy import；四条路由 `lazy` 换真实组件、`unavailableReason: null`（`project.lifecycle` 保持 parent `project.settings`）。`route-registry.test.ts` 的 `realViewRoutes` set 加入四条 + 断言。

- [ ] **Step 2: g12-access-settings-smoke.spec.ts**

参考 PLT-07 smoke：`primeApp` + `setMockScope('project')`；一条链路：`/access` → `project-access-view` 可见 → `/client-keys` → `project-client-keys-view` 可见 → `/settings` → `project-settings-view`（双标签）可见 → `/settings/lifecycle` → `project-lifecycle-view` 可见 → 无 pageerror、无 `capability-not-provided`。不执行真实危险动作。

- [ ] **Step 3: 运行预算测试（A/B/C/D）**

A（Contract/API）:
```
pnpm --filter @aurora/platform-contract exec vitest run test/project-governance/access.test.ts test/project-governance/settings.test.ts test/project-governance/lifecycle.test.ts test/credentials/client-keys.test.ts
pnpm platform-contract:drift
```
Expected: 全 PASS；覆盖 authorization/success/forbidden/lifecycle-conflict/one-time secret 结构与 drift 无差异。（若本地 Docker infra 可用，追加一条 `apps/platform-api` 的 C13—C16 handler targeted 集成测试；不可用则记录 `LOCAL_PG_REDIS_UNAVAILABLE`。）

B（Console）:
```
pnpm --filter @aurora/console exec vitest run test/views/project/access-view-model.test.ts test/views/project/client-keys-view-model.test.ts test/views/project/settings-view-model.test.ts test/views/project/lifecycle-view-model.test.ts test/monitoring/access-commands.test.ts test/monitoring/client-keys-commands.test.ts test/monitoring/settings-commands.test.ts test/monitoring/lifecycle-commands.test.ts test/contracts/route-registry.test.ts
```
Expected: 全 PASS；覆盖 access permission state、one-time secret、settings load/save、archive/delete confirmation。

C（Chromium smoke）:
```
pnpm --filter @aurora/console build:test && pnpm --filter @aurora/console exec playwright test test-browser/g12-access-settings-smoke.spec.ts --project=chromium
```
Expected: PASS；Access/Credentials/Settings/Lifecycle 真实可达、无 fatal error。不执行真实永久删除。

D（最终门禁）:
```
pnpm --filter @aurora/console typecheck
pnpm --filter @aurora/console build
git diff --check
```
Expected: 全 PASS；机械错误最小修复一次。

- [ ] **Step 4: 入口同步 + Commit**

更新 `AGENTS.md`/`AURORA_RULES.md`：PLT-08 completed（若验收通过）、ledger 67→68/10、G12 状态；若 G04 未 merge 记录 `G12_G04_MAIN_INTEGRATION_PENDING`。

```bash
git add apps/console/src apps/console/test apps/console/test-browser AGENTS.md AURORA_RULES.md
git commit -m "feat(console): PLT-08 route wiring + acceptance; docs(status): G12 ledger 67->68/10"
```

---

## Self-Review

**1. Spec coverage：**
- C13 有效访问清单/来源分离/授予改移除：Task 2 ✓（UX/UI §7.28/§8.26）。
- C14 密钥列表/一次性交付/启停/撤销：Task 2 ✓（UX/UI §7.29/§8.27、ADR-013/014）。
- C15 基本设置 + 运行环境双标签：Task 3 ✓（UX/UI §7.30/§8.28）。
- C16 archive/restore/delete 区分 + 独立确认：Task 3 ✓（UX/UI §8.29/§10.23、PRD §17）。
- 契约解冻 + OpenAPI + drift：Task 1 ✓。
- routing/state/acceptance：Task 4 ✓。

**2. Placeholder scan：** 无 TBD；每步有具体文件、签名与代码。

**3. Type consistency：** `listProjectEffectiveMembers`/`changeProjectMemberRole`/`removeProjectMember`、`updateProjectSettings`/`listProjectEnvironments`/`createProjectEnvironment`、`restoreFromArchive`、`listIngestionClientCredentials` 与 16 个 operationId 在 Task 1—3 间一致；console query/command 名与 contract operationId 一致。

**缺陷修正：** C16 永久删除（trash 过期后台清理）属 SEC-02/worker 范畴，C16 只提供"移入回收站"，计划明确不提供 UI 触发永久删除。C14 用 `ingestion_client_credentials`（真实上报认证密钥）而非 `client_keys`（B2/C1 展示密钥），计划在 Global Constraints 明确并登记为既有架构债务。`requireProjectAdminAccess` 语义复用 `requireProjectAlertManageAccess`（org manager 或 project_admin），避免重复逻辑。
