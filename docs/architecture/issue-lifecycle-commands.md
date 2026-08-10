---
title: Aurora Issue 生命周期 Command、活动与审计第一增量
status: approved
implementation-status: not-started
approval-status: pending-g03-approval-package
owner: platform/backend
created: 2026-08-10
last-reviewed: 2026-08-10
applies-to: packages/processing-store（@aurora/processing-store）的 issue_activities/issue_notes 表与生命周期 Repository；packages/platform-contract（@aurora/platform-contract）的 issues-and-alerts Command 操作与 Schema；apps/platform-api 的 Issue 生命周期 Command handler 与授权/审计
related:
  - ../../AGENTS.md
  - ../../AURORA_RULES.md
  - '../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md'
  - '../../Aurora 代码规范.md'
  - '../../Aurora 测试规范.md'
  - '../../Aurora 文档规范.md'
  - '../../Aurora ADR 规范.md'
  - ../adr/ADR-026-platform-backend-runtime-and-contract-chain.md
  - ../adr/ADR-027-platform-contract-codegen-tooling.md
  - ../adr/ADR-028-platform-session-csrf-security.md
  - ../adr/ADR-029-platform-database-access-and-migration.md
  - ../adr/ADR-033-issue-aggregate-data-model.md
  - ../superpowers/specs/2026-07-30-aurora-platform-openapi-and-implementation-design.md
  - ../superpowers/specs/2026-07-27-aurora-frontend-ux-ui-design.md
  - ./issue-aggregate-representative-sample-store.md
  - ./formalization-readiness.md
supersedes: none
review-cycle: issue-command-or-authorization-change
---

# Aurora Issue 生命周期 Command、活动与审计第一增量

## 1. 定位、效力与当前状态

本文冻结 DAT-14（Issue 生命周期 Command、活动和审计）第一增量。该增量提供正式 Issue 生命周期 Command 与活动证据：状态/负责人/优先级更新、成员备注、问题合并与当前页批量操作，全部服务端强制权限、乐观并发、幂等、活动记录与安全审计。

**批准状态**：本文是 G03 正式化扫掠产物，纳入 [G03 APPROVAL PACKAGE](../superpowers/g03-approval-package.md) 统一批准。批准后 `status: approved`、`approval-status: approved`；`implementation-status` 于计划执行后更新为 `implemented`。

**ADR 判断**：本增量**不创建新 ADR**。Issue 数据模型（含 `issue_activities`/`issue_notes` 表）由 proposed [ADR-033](../adr/ADR-033-issue-aggregate-data-model.md)（待用户批准为 accepted）冻结；Command 语义（状态机、负责人、优先级、备注、批量、合并、再次出现重开）逐条由 approved PRD §10 与 UX C3/C4 派生；权限复用已实施 G10（accepted ADR-029/030 与 `@aurora/platform-identity`/`platform-organization`/`platform-project-governance`）；无新增产品/架构/安全/隐私决策。**ADR-033 accepted 前，本文不授权任何 Migration/实现。**

## 2. 元数据、Owner 和范围

- **Owner**：platform/backend
- **适用范围**：`@aurora/processing-store` 的 `issue_activities`/`issue_notes` Migration 与生命周期 Repository（状态/负责人/优先级/备注/合并/批量/活动）、`@aurora/platform-project-governance` 角色感知项目访问、`@aurora/platform-contract` 的 `issues-and-alerts` Command 操作与 Schema（OpenAPI 重新生成、漂移门禁）、`apps/platform-api` 的 7 个 Command handler 与授权/审计、单元测试、真实 PostgreSQL 17 集成测试、README、正式规格、ADR-033 实施证据。
- **明确非职责**：
  - Issue 聚合/代表样本（DAT-13，独立规格）；
  - Issue Query/read projection（DAT-15，独立规格）；
  - 再次出现自动重开的精确 `by_version`/`by_time` 匹配语义的最终细化（DAT-13 聚合侧实现存储与基础重开，DAT-14 冻结精确条件）；
  - Console UI（G11）；
  - Source Map（DAT-18）、告警（DAT-19）、数据保留（SEC-02）。

## 3. Command 清单（冻结，全部来自 approved PRD §10 / UX C3/C4 / OpenAPI 命名约定）

操作名遵循 OpenAPI 设计 §6.2 `domainVerbObject` 稳定格式，全部 `authLevel: 'session'`、`csrf: true`、`idempotency: true`（批量必须，单项建议）、路径固定 `/api/platform/v1/organizations/:organizationId/projects/:projectId`。

| 操作 | 语义（PRD/UX 依据） | 需要处理权限 |
|---|---|---|
| `issuesUpdateState` | 状态转移 `open`/`in_progress`/`resolved`/`ignored`（PRD §10.1）；开始处理时未分配自动分配给当前操作人（PRD §10.2）；解决携带 `resolvedVersion` 或 `resolvedAt` 依据（PRD §10.4）；忽略携带 `ignoredUntil`（NULL=永久，PRD §10.5） | 是 |
| `issuesUpdateAssignee` | 分配/转派/清空负责人（PRD §10.2）；返回权威状态 | 是 |
| `issuesUpdatePriority` | 设置优先级 `urgent`/`high`/`medium`/`low` 或清空（PRD §10.3）；人工值优先于系统建议 | 是 |
| `issuesCreateNote` | 添加 Markdown 备注（PRD §10.6）；发布后不可编辑 | 是 |
| `issuesDeleteNote` | 软删除：作者删自己的备注；项目管理员删含敏感信息的备注（PRD §10.6） | 作者或项目管理员 |
| `issuesMerge` | 问题合并：选择主问题；服务端重汇总、原问题标记已合并、记录活动（PRD §9.7）；旧链接跳主问题 | 是 |
| `issuesBatchUpdate` | 当前页批量（≤100）：状态/优先级/负责人/永久忽略/重新打开；逐项鉴权/校验并返回部分结果（PRD §10.7） | 每项对应处理权限 |

**明确不在 DAT-14**：保存视图/批量选择持久化（UX C3 显示为 GAP，非 Command）；后台批量/取消/重试/撤销（PRD §10.7）；批量解决/合并/修改解决依据（PRD §10.7）；备注附件/回复/提及（PRD §10.6）。

## 4. 授权模型（冻结，全部服务端强制）

- **查看（DAT-15 Query）**：org manager 或任何 `project_members` 角色（复用 G10 `checkProjectAccess`）。
- **处理（本增量 Command）**：org manager 或 `project_members` 角色为 `project_admin`/`developer`；`read_only` 与无成员行 **403**。**不依赖前端按钮隐藏**（`allowedActions` 纯展示投影，每次 Command 重新读取）。
- **作者/管理员边界**：`issuesDeleteNote`——作者可删自己的备注；org manager 或 `project_admin` 可删含敏感信息的备注（PRD §10.6）。
- **项目隔离**：`requireProjectAccess` 语义不变——项目不存在或跨 org → 封闭 404（无存在性泄露）；跨 org 项目不因 org manager 短路泄露。
- **事务内新鲜重读**：Command 在其事务上复用 `requireOrgManagerOnTransaction` 先例，重读处理权限后再写（关闭 TOCTOU）。
- **实现**：`@aurora/platform-project-governance` 新增角色感知读函数（`getProjectAccessRole`：返回 `allowed`+role 或 `forbidden`/`not_found`），供 Command handler 区分查看/处理；既有 `checkProjectAccess` 保持查看语义不变。

## 5. 状态机与语义（冻结，PRD §10.1—10.7）

### 5.1 状态转移

- 四状态：`open`→`in_progress`→`resolved`/`ignored`；`resolved`/`ignored` 可 `reopened`→`open`；
- **非法转移拒绝**：`resolved`→`in_progress` 不经 `open` 视为非法（closed 转移表由实现冻结，非法 422 `field_validation`）；
- **开始处理自动分配**（PRD §10.2）：`open` 未分配 → `in_progress` 时在同一事务内自动分配负责人为当前操作人并写 `assignee_changed`+`status_changed` 活动；已有负责人只改状态；
- 退回 `open` 不自动清空负责人；`resolved` 不自动清空负责人（PRD §10.2）。

### 5.2 解决与再次出现（PRD §10.4，评审落实）

- `resolved` 携带 `resolvedReason`：
  - `'by_time'`（带 `resolvedAt`）：解决时间之后真实发生的新事件 → 自动恢复 `open` 并写 `reappeared` 活动；解决时间之前发生但延迟到达的事件不算再次出现；
  - `'by_version'`（带 `resolvedVersion`）：**v1 不激活**。v1 错误事件契约不含发布/版本字段（契约缺口），`resolvedVersion` 无法与 occurrence 比较；`by_version` 重开语义（旧版本继续发生不自动重开、解决版本或后续版本再次发生自动重开）预留到发布字段契约扩展后实现。
- 精确匹配条件由本规格冻结（处理器侧实现；v1 只以 `resolvedAt` 与 occurrence 的 `occurredAt` 比较），作为 DAT-13 聚合侧自动重开的语义基准。

### 5.3 忽略（PRD §10.5）

- `ignored` 携带 `ignoredUntil`：NULL=永久忽略直到人工重开；时间戳=到期自动恢复 `open`；
- 忽略期间默认不出现在待处理列表、不触发针对该问题的普通通知、仍计入整体错误率和项目指标、仍保留少量代表样本。

### 5.4 负责人（PRD §10.2）

- 每问题最多一名负责人；支持分配/转派/清空；负责人离开项目后历史保留、当前负责人自动清空（该规则由 G10 成员变更路径触发，DAT-14 提供清空访问器）。

### 5.5 优先级（PRD §10.3）

- `urgent`/`high`/`medium`/`low`；人工设置值以人工值为准；清空=恢复无人工优先级。

### 5.6 备注（PRD §10.6）

- 内容为纯文本或 Markdown，长度上限冻结（`maxNoteLength = 4096`，计划锁定）；发布后不可编辑；作者可软删除；管理员可删除含敏感信息备注；无附件/回复/提及。

### 5.7 批量（PRD §10.7）

- 仅当前页、≤100 项；动作限状态/优先级/负责人/永久忽略/重新打开；
- 逐项独立鉴权/校验/版本检查；返回成功与失败数量及每项结果（`batch_partial` 语义）；
- 幂等键必填；不建设后台批量任务/取消/重试/撤销；不支持跨页/全选结果。

### 5.8 合并（PRD §9.7）

- 用户选择主问题；服务端重汇总（occurrence_count/first_seen/last_seen 并入主问题）；原问题 `merged_into_issue_id` 标记；写 `merged` 活动；旧链接解析到主问题（DAT-15 提供跳转投影）；
- 不提供复杂拆分与 24 小时撤销（PRD §9.7）。

## 6. 并发与幂等（冻结）

- **乐观并发**：每个 Command 携带 `version`；事务内 `UPDATE issues SET ... WHERE id=$n AND version=$expected`；影响行数为 0 → 409 `conflict`（UX “问题已被其他成员更新”）；成功则 `version+1`；
- **幂等**：Command 复用 G10 `runIdempotentCommand`/`requestDigest` 模式（`idempotencyKey` 排除在外）；重放返回首次结果、不重复写活动/审计；
- **事务原子性**：状态/负责人/活动/审计同事务（写 `issue_activities` 与状态更新同事务）；失败整体回滚。

## 7. 活动证据与审计（冻结）

### 7.1 `issue_activities`（PRD §10.6，不可编辑/删除）

- 每次成功 Command 写一条活动：`status_changed`/`assignee_changed`/`priority_changed`/`marked_resolved`/`ignored`/`reopened`/`merged`/`note_added`/`note_deleted`；系统自动重开写 `reappeared`（`actor_account_id` NULL）；
- `details` 只含安全结构化字段（from/to 状态、旧/新负责人 id、版本、优先级、resolution/ignore 依据），**禁止** token/secret/完整 email/备注正文；
- **actor projection**：活动响应/查询返回安全作者摘要（`actorAccountId` + 可显示名），**不暴露完整 email**（复用 G10 email-mask 先例）。

### 7.2 `issue_notes`（PRD §10.6）

- 发布后不可编辑；作者软删除（`deleted_at`/`deleted_by_account_id`）；管理员删除含敏感信息备注；
- 备注正文**不进活动 details、不进审计 details**（隐私）。

### 7.3 安全审计（`security_audit_events`）

- 状态/负责人/优先级/合并/批量/管理员删除备注等 Command 写安全审计事件（`organizationId`、`actorAccountId`、`action` 如 `issue_status_changed`、`details` 含 projectId/issueId/目标值，**不含** token/secret/完整 email/备注正文）；
- **审计写归属**：`security_audit_events` 表由 `@aurora/platform-identity` 所有；`@aurora/processing-store`（`data → protocol` 只允许依赖 protocol）**不得**写该表。审计写由 `apps/platform-api` handler 在 Command 事务内经 `@aurora/platform-identity` 既有 `insertAuditEvent` 执行（platform-api 已依赖 platform-identity）；不重复造审计表。

## 8. 输入/输出与稳定错误（冻结）

- 全部 Command 输入经 `@aurora/platform-contract` 运行时校验（`parseInput`）；输出经 `serializeOutput`；
- 稳定错误码：`structural_error`（400）、`authentication`（401）、`authorization`（403）、`not_found`（404，项目/问题不存在或跨 org）、`conflict`（409，版本冲突）、`idempotency_conflict`（409）、`field_validation`（422，非法转移/非法状态/非法优先级/超长备注）、`rate_limited`（429）、`authority_unavailable`（503，Session/DB 不可用）；
- 问题属于当前项目但 `read_only` 角色执行 Command → 403；问题不属于当前项目 → 404（无存在性泄露）。

## 9. 实现位置与依赖方向

- `@aurora/processing-store`（`data` 层）：新增 `issue_activities`/`issue_notes` Migration（ADR-033 决定细节 5b/5c）+ 生命周期 Repository（`updateIssueState`/`updateIssueAssignee`/`updateIssuePriority`/`createIssueNote`/`deleteIssueNote`/`mergeIssues`/`batchUpdateIssues`/`appendIssueActivity`）+ 包根导出；
- `@aurora/platform-project-governance`（`data` 层）：新增 `getProjectAccessRole` 角色感知读函数；
- `@aurora/platform-contract`（`contract` 层）：新增 `issues-and-alerts` 领域目录，注册 7 个 Command 操作与 Schema；OpenAPI 重新生成、漂移门禁通过；
- `apps/platform-api`（`service` 层）：7 个 Command handler，复用 `requireSession`/`effectivePermissions`/`requireProjectAccess`/`requireOrgManagerOnTransaction`/`runIdempotentCommand`/`sendMappedError` 模式；在 Command 事务内经 `@aurora/platform-identity` `insertAuditEvent` 写安全审计（§7.3 归属）；
- 依赖方向：`processing-store → event-schema`（既有）；`platform-api → platform-contract/server`、`processing-store`、`platform-organization`、`platform-project-governance`、`platform-identity`（既有 + 新增）；无循环依赖、无私有深导入。

## 10. 单元测试

- 状态机：四状态合法/非法转移矩阵、开始处理自动分配（同事务）、退回 open 不清负责人、resolved 不自动清负责人；
- 解决/忽略：`by_version`/`by_time` 依据校验、忽略到期自动恢复、永久忽略；
- 备注：创建长度边界、不可编辑、作者软删除、管理员删除；
- 批量：≤100、逐项鉴权/校验/部分结果、幂等；
- 合并：重汇总、原问题标记、活动；
- 版本冲突：并发写 `version` 冲突 → 409、重放不重复写活动/审计；
- 隐私：活动/审计 details 不含 token/secret/完整 email/备注正文；actor projection 不暴露完整 email。

## 11. 真实 PostgreSQL 集成测试（只测高风险行为）

- 授权正例/反例：处理权限通过、`read_only` 403、跨项目 404；
- 状态转移 + 自动分配事务原子性；版本冲突并发；合并重汇总；备注软删除；批量部分结果；
- Migration up/down/up；Schema/Pool 清理；复用 `AURORA_TEST_DATABASE_URL` 真实 PostgreSQL 17.10。

## 12. 覆盖率与质量门禁

`packages/processing-store`、`packages/platform-project-governance`、`packages/platform-contract`、`apps/platform-api` 维持既有覆盖率阈值；不得降低门槛、不得删除失败测试。

实施必须新鲜运行：受影响 package `typecheck`、单元测试、targeted 真实 PG 集成测试、OpenAPI 重新生成 + `openapi:platform:lint` + `platform-contract-drift`、Lint、构建、包入口、Workspace 边界、`git diff --check`。**无 UI、无 Chromium、不运行 Console 全量。**

## 13. 文档与 ADR 同步

- `packages/processing-store/README.md`、`packages/platform-contract/README.md`、`apps/platform-api/README.md` 更新；
- `docs/architecture/formalization-readiness.md`、`docs/README.md` 更新 Issue Command/Query 状态；
- ADR-033：状态按用户批准结果更新；本规格同步实施证据；
- `AGENTS.md` 与 `AURORA_RULES.md`：全部门禁实际通过后才更新阶段快照；
- G03 计数：DAT-14 独立验收通过后 `completed 48→49 / remaining 30→29`。

## 14. 明确排除范围

- Issue Query（DAT-15）；Console UI（G11）；Source Map（DAT-18）；告警（DAT-19）；数据保留（SEC-02）；
- 保存视图/持久化选择；后台批量/撤销系统；批量解决/合并；备注附件/回复/提及；
- 影响用户估算、自定义 fingerprint、页面/环境/发布维度。

## 15. 规格自检

- Command 清单逐条来自 approved PRD §10/UX C3/C4/OpenAPI 命名约定，未发明操作名；
- 授权全部服务端强制，不依赖按钮隐藏；项目隔离无存在性泄露；
- 状态机/负责人/优先级/备注/批量/合并逐条对应 PRD §10；
- 并发（乐观 `version`）与幂等（`runIdempotentCommand` 先例）覆盖冲突与重放；
- 活动不可编辑/删除、actor projection 不暴露完整 email；
- 审计复用 G10 模式，details 隐私边界明确；
- 隐私：不暴露完整 email/Session/Token/secret；
- 实现位置与依赖方向符合分层约束，无循环依赖；
- 测试覆盖授权正反例、状态转移、版本冲突、合并、批量、审计投影；
- 无占位/TBD，全部常量与类型签名冻结。

自动审批依据：本文语义全部由 approved PRD §10、approved UX C3/C4、approved OpenAPI 设计、已实施 G10 授权/审计模式与 **proposed ADR-033**（待用户批准为 accepted）派生；无新增产品/架构/安全/隐私决策；不创建新 ADR。**批准顺序：ADR-033 先经用户批准为 accepted，本文再随 G03 APPROVAL PACKAGE 生效为 approved。**
