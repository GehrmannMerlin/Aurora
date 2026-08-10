---
title: Aurora Issue 列表/详情 Query 与安全投影第一增量
status: approved
implementation-status: not-started
approval-status: approved
owner: platform/backend
created: 2026-08-10
last-reviewed: 2026-08-10
applies-to: packages/processing-store（@aurora/processing-store）的 Issue 只读 Query Repository；packages/platform-contract（@aurora/platform-contract）的 issuesListIssues/issuesGetIssueDetail 操作与 Schema（从 BLOCKED_OPERATIONS 移入稳定操作）；apps/platform-api 的项目级 Issue Query handler
related:
  - ../../AGENTS.md
  - ../../AURORA_RULES.md
  - '../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md'
  - '../../Aurora 代码规范.md'
  - '../../Aurora 测试规范.md'
  - '../../Aurora 文档规范.md'
  - '../../Aurora ADR 规范.md'
  - ../adr/ADR-026-platform-backend-runtime-and-contract-chain.md
  - ../adr/ADR-033-issue-aggregate-data-model.md
  - ../superpowers/specs/2026-07-30-aurora-platform-openapi-and-implementation-design.md
  - ../superpowers/specs/2026-07-27-aurora-frontend-ux-ui-design.md
  - ./request-metric-query-projection.md
  - ./performance-query-projection.md
  - ./issue-aggregate-representative-sample-store.md
  - ./issue-lifecycle-commands.md
  - ./formalization-readiness.md
supersedes: none
review-cycle: issue-query-or-projection-change
---

# Aurora Issue 列表/详情 Query 与安全投影第一增量

## 1. 定位、效力与当前状态

本文冻结 DAT-15（Issue 列表/详情 Query 与安全投影）第一增量。该增量提供 C3/C4 后续页面可真实消费的公开 Issue Query：`issuesListIssues`（列表）与 `issuesGetIssueDetail`（详情），复用 G02 已建立的分页、时间范围、项目授权、安全投影与错误语义，**不重新建立平行 Query 基础**。

**批准状态**：本文随 [G03 APPROVAL PACKAGE](../superpowers/g03-approval-package.md) 于 2026-08-10 由用户整体批准，`status: approved`、`approval-status: approved`；`implementation-status` 于计划执行后更新为 `implemented`。

**ADR 判断**：本增量**不创建新 ADR**。Issue 数据模型由 accepted [ADR-033](../adr/ADR-033-issue-aggregate-data-model.md)（用户 2026-08-10 批准）冻结；Query 只读投影复用 G02（DAT-16/17/20）已批准的契约模式与授权实现；无新增产品/架构/安全/隐私决策。

## 2. 元数据、Owner 和范围

- **Owner**：platform/backend
- **适用范围**：`@aurora/processing-store` 的 Issue 只读 Query Repository（列表/详情/样本/活动投影）、`@aurora/platform-contract` 的 `issuesListIssues`/`issuesGetIssueDetail` 操作与 Schema（从 `BLOCKED_OPERATIONS` 移入稳定操作注册表、OpenAPI 重新生成、漂移门禁）、`apps/platform-api` 的项目级 Issue Query handler（复用 DAT-16 `requireProjectAccess`）、单元测试、真实 PostgreSQL 17 集成测试、README、正式规格、ADR-033 实施证据。
- **明确非职责**：
  - Issue 生命周期 Command/活动/审计（DAT-14，独立规格）；
  - Issue 聚合/代表样本写侧（DAT-13，独立规格）；
  - Console 页面（G11）；
  - Source Map（DAT-18）、告警（DAT-19）、数据保留（SEC-02）；
  - 保存视图/持久化选择（GAP，非 Query）。

## 3. 操作与路径（冻结）

| 操作 | 路径 | 语义（UX 依据） |
|---|---|---|
| `issuesListIssues` | `GET /api/platform/v1/organizations/:organizationId/projects/:projectId/issues` | C3 问题列表：规范化查询、分页、过滤、安全摘要（UX §8.16/§9.16） |
| `issuesGetIssueDetail` | `GET /api/platform/v1/organizations/:organizationId/projects/:projectId/issues/:issueId` | C4 问题详情：Issue 聚合事实、代表样本、活动/备注（UX §8.17/§9.17） |

两个操作当前在 `@aurora/platform-contract` `BLOCKED_OPERATIONS` 注册（reason "C3/C4 processing-store Query contract absent"），DAT-15 移入稳定操作注册表并重新生成 OpenAPI/漂移门禁。

## 4. 授权与错误语义（冻结，复用 G02/G10）

- **授权**：复用 DAT-16 `requireProjectAccess`（org manager 或 `project_members`）；项目不存在/跨 org → 封闭 404（无存在性泄露）；无权限 403 且**不调用数据 Repository**；
- **查询权限**：项目查看权限即足够（列表/详情/样本/活动读取）；Command 处理权限不在此列（DAT-14）；
- **稳定错误码**：`structural_error`（400）、`authentication`（401）、`authorization`（403）、`not_found`（404，项目/问题不存在或跨 org）、`rate_limited`（429）、`authority_unavailable`（503，DB 不可用）；`ProcessingStoreError`→400/503 映射复用 `sendMappedError`；
- **诚实语义**：数据缺失一律 `empty`/`unavailable`，不得解释为 0；页面/环境/发布维度无协议数据 → 恒 `unavailable`（与 DAT-17 同口径）。

## 5. `issuesListIssues` Query（冻结）

### 5.1 Query 参数

- `timeRange`（`start`/`end`，RFC 3339，窗口上限 90 天，复用 DAT-16 校验）；
- 可选过滤：`status`（closed 枚举 `open`/`in_progress`/`resolved`/`ignored`，PRD §10.1）、`assigneeAccountId`、`priority`（`urgent`/`high`/`medium`/`low`）；
- `cursor`/`limit`（复用 G02 分页，`paginationMeta` 游标上限非破坏放宽先例）；`limit` 默认 50、上限 100；
- **搜索/排序**：UX 允许正式问题字段搜索/排序；v1 支持按 `lastSeenAt`/`occurrenceCount` 排序与标题/状态等安全字段过滤；自由文本搜索（保存视图/搜索契约）属 GAP，v1 不做自由全文搜索。

### 5.2 响应（`queryResponse` 结构，复用 G02）

- `data.issues`：`available`（当前页问题安全摘要列表）/ `empty`（无数据）/ `unavailable`（服务不可用）；
- 每条 Issue 安全摘要：`issueId`、`title`（安全投影标题）、`status`、`occurrenceCount`、`firstSeenAt`/`lastSeenAt`、`sampleCount`（已保留完整样本数，与 `occurrenceCount` 分离，PRD §9.3.6）、`assigneeAccountId?`、`priority?`、`version`（乐观并发版本）；
- `data.filters`：`available`（实际生效的过滤条件与合法过滤字段）或 `unavailable`（过滤能力受限原因）；
- `data.summary`：`available`（当前过滤下的总量/水位/完整性）或 `unavailable`；
- `data.environments`/`data.releases`：恒 `unavailable`（v1 错误契约无环境/发布字段，契约缺口，不伪造列表）；
- `meta`：`requestId`、`readAt`、`normalizedQuery`（URL 权威，UX §9.16）；
- `allowedActions`、`navigationTargets`（`project.issues`）。

## 6. `issuesGetIssueDetail` Query（冻结）

### 6.1 路径参数与 Query

- 路径：`organizationId`/`projectId`/`issueId`；
- Query：`samples` 区（代表样本筛选/分页或上限）、`activity` 区（活动/备注分页或上限）可选参数；`issueId` 为服务端不透明稳定字符串。

### 6.2 响应（`queryResponse` 结构）

- `data.issue`：`available`（Issue 聚合事实）/ `empty` / `unavailable`；
  - Issue 身份：`issueId`、`title`、`category`、`fingerprintVersion`；
  - 聚合事实：`occurrenceCount`、`sampleCount`、`firstSeenAt`、`lastSeenAt`（PRD §9.3.6 分离展示）；
  - 生命周期：`status`、`assigneeAccountId?`、`priority?`、`resolvedReason?`/`resolvedVersion?`/`resolvedAt?`、`ignoredUntil?`、`mergedIntoIssueId?`（跳转主问题投影，PRD §9.7）；
  - `version`（乐观并发版本，DAT-14 冲突检测）；
- `data.samples`：`available`（有界代表样本安全投影列表，≤ `DEFAULT_MAX_ISSUE_SAMPLES`）/ `empty`（无样本仍保留问题）/ `unavailable`；
  - 每条样本安全投影：`sampleId`、`occurredAt`、`sampleKind`（`first`/`latest`/`reappeared`/`regular`…）、`sampleBody`（受协议约束安全投影，DAT-13 §4.5 隐私边界）；**不返回完整错误事件/完整信封**；
- `data.activity`：`available`（`issue_activities` 不可编辑时间线 + `issue_notes` 安全投影）/ `empty` / `unavailable`；
  - 活动：`activityType`、`createdAt`、`actorAccountId`/`actorDisplayName`（安全作者摘要，**不暴露完整 email**）、`details`（安全结构化字段）；
  - 备注：`noteId`、`authorAccountId`/`authorDisplayName`、`createdAt`、`deletedAt?`；**`content` 只在备注未删除时返回**（管理员因敏感信息删除的备注在读取路径不返回内容，使敏感删除有效，PRD §10.6）；
- `meta`/`allowedActions`/`navigationTargets`（`project.issue-detail`）。

## 7. 隐私与安全投影（冻结）

- 列表/详情**不返回**：完整 error 事件、原始 message/stack 全文（仅安全标题/样本白名单）、Cookie、Authorization、token、secret、完整 URL 查询、内部 DB 标识、完整 email、Session；
- `sampleBody` 复用 DAT-13 受协议约束安全投影；`title` 只含归一化占位符；
- 跨 org/不存在问题 → 封闭 404，无存在性泄露；无权 → 403 且不调用 Repository。

## 8. 实现位置与依赖方向

- `@aurora/processing-store`（`data` 层）：新增只读 Query Repository（`queryIssueListPage`/`queryIssueDetail`/`queryIssueSamples`/`queryIssueActivity`，只读、无写侧复用、无新 Migration——复用 DAT-13/DAT-14 建的表）+ 包根导出；
- `@aurora/platform-contract`（`contract` 层）：`issues-and-alerts` 领域目录新增 `issuesListIssues`/`issuesGetIssueDetail` 操作与 Schema；从 `BLOCKED_OPERATIONS` 移入稳定操作；OpenAPI 重新生成、`openapi:platform:lint`、`platform-contract-drift` 通过；
- `apps/platform-api`（`service` 层）：2 个 Query handler，复用 DAT-16 `requireProjectAccess`/`normalizeBracketQuery`/`parseInput`/`serializeOutput`/`sendMappedError` 模式；
- 依赖方向：`processing-store → event-schema`（既有）；`platform-api → platform-contract/server`、`processing-store`（既有）；无循环依赖、无私有深导入。

## 9. 单元测试

- 契约：`issuesListIssues`/`issuesGetIssueDetail` 操作注册、Schema 形状、合法/非法输入；
- Query Repository：列表分页/过滤/排序、详情聚合、样本/活动投影、空与 unavailable 语义、输入不变；
- 隐私：列表/详情/样本/活动投影不含原始敏感值；`title`/`sampleBody` 为安全投影。

## 10. 真实 PostgreSQL 集成测试（只测高风险行为）

- 列表真实 PG：分页/游标、状态/负责人/优先级过滤、时间范围；
- 详情真实 PG：聚合事实、样本安全投影、活动/备注时间线；
- 项目权限负例：跨项目 404、无权 403 且不返回数据；
- 隐私负例：样本/标题不含原始敏感值；
- 复用 `AURORA_TEST_DATABASE_URL` 真实 PostgreSQL 17.10；**不运行 Console 全量、不运行 Chromium**。

## 11. 覆盖率与质量门禁

`packages/processing-store`、`packages/platform-contract`、`apps/platform-api` 维持既有覆盖率阈值；不得降低门槛、不得删除失败测试。

实施必须新鲜运行：受影响 package `typecheck`、单元测试、targeted 真实 PG 集成测试、OpenAPI 重新生成 + lint + drift、Lint、构建、包入口、Workspace 边界、`git diff --check`。

## 12. 文档与 ADR 同步

- `packages/processing-store/README.md`、`packages/platform-contract/README.md`、`apps/platform-api/README.md` 更新；
- `docs/architecture/formalization-readiness.md`、`docs/README.md` 更新 Issue Query 状态；
- ADR-033：状态按用户批准结果更新；本规格同步实施证据；
- `AGENTS.md` 与 `AURORA_RULES.md`：全部门禁实际通过后才更新阶段快照；
- G03 计数：DAT-15 独立验收通过后 `completed 49→50 / remaining 29→28`。

## 13. 明确排除范围

- Console UI（G11）；Issue 生命周期 Command（DAT-14）；写侧聚合（DAT-13）；
- Source Map（DAT-18）、告警（DAT-19）、数据保留（SEC-02）；
- 保存视图/持久化选择/自由全文搜索（GAP）；
- 页面/环境/发布维度（v1 错误契约无字段，恒 `unavailable`）；
- 完整逐错误历史/完整事件时间线。

## 14. 规格自检

- 两个 Query 操作逐条来自 approved UX C3/C4 与 Platform OpenAPI 设计命名约定；
- 复用 G02 分页/时间范围/项目授权/安全投影/错误语义，未建立平行 Query 基础；
- 授权无存在性泄露、无权不调用 Repository；
- 诚实语义：页面/环境/发布维度恒 `unavailable`，数据缺失不解释为 0；
- 隐私：不返回完整事件/敏感值/完整 email；
- 实现位置与依赖方向符合分层约束，无循环依赖；
- 测试覆盖列表/详情真实 PG、权限负例、分页/过滤、样本/活动安全投影；
- 无占位/TBD，全部常量与类型签名冻结。

自动审批依据：本文语义全部由 approved UX C3/C4、approved Platform OpenAPI 设计、G02（DAT-16/17/20）已实施 Query 模式与 **accepted ADR-033**（用户 2026-08-10 批准）派生；无新增产品/架构/安全/隐私决策；不创建新 ADR。已随 G03 APPROVAL PACKAGE 于 2026-08-10 由用户批准为 approved。
