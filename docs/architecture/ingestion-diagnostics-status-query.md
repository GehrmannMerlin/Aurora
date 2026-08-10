---
title: Aurora 接入诊断状态查询（Ingestion Diagnosis / Status Query）
status: approved
implementation-status: in-progress
approval-status: approved
owner: ingestion/backend
created: 2026-08-10
last-reviewed: 2026-08-10
applies-to: packages/ingestion-inbox（`@aurora/ingestion-inbox` 只读诊断查询）、packages/ingestion-credentials（`@aurora/ingestion-credentials` 只读安全状态查询）、packages/processing-store（`@aurora/processing-store` 只读可查询证据查询）、packages/platform-contract（`@aurora/platform-contract` `diagnosticsGetDataStatus` 操作）、apps/platform-api（平台公开 API 诊断 handler 与项目级授权）
related:
  - ../../AGENTS.md
  - ../../AURORA_RULES.md
  - '../../Aurora 代码规范.md'
  - '../../Aurora 测试规范.md'
  - '../../Aurora 文档规范.md'
  - '../../Aurora ADR 规范.md'
  - ../adr/ADR-008-ingestion-durable-buffering.md
  - ../adr/ADR-010-postgresql-access-and-migration-tooling.md
  - ../adr/ADR-013-ingestion-client-credential-storage-and-verification.md
  - ../architecture/ingestion-inbox-data-model.md
  - ../architecture/ingestion-inbox-processing-repository.md
  - ../architecture/ingestion-http-service.md
  - ../architecture/ingestion-worker-runtime.md
  - ../architecture/ingestion-worker-retry-budget-policy.md
  - ../protocol/ingestion-batch-and-receipt-contract.md
  - ../architecture/platform-contract-foundation.md
  - ../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md
supersedes: none
review-cycle: ingestion-diagnostics-query-schema-or-contract-change
---

# Aurora 接入诊断状态查询（DAT-20）

## 1. 定位、效力与当前状态

本文冻结接入诊断状态查询（DAT-20）第一增量：把数据接入链路的**真实持久化状态**（`event_inbox` 状态机、`ingestion_client_credentials` 安全状态、`@aurora/processing-store` 可查询证据）形成**正式、安全、项目隔离的公开 Query 投影**，暴露为平台公开 API 操作 `diagnosticsGetDataStatus`（C7 数据接收诊断页面 `project.data-status` Route Target）。它不建设任何写侧能力，只新增只读查询、契约操作与平台 handler。

**批准状态**：本文由用户于 2026-08-10 预先批准（`status: approved`）。`implementation-status` 将在 DAT-20 独立验收后更新为 `implemented`。本文由 accepted ADR-008/010/013、approved 数据接入批次与接收结果协议、approved C7 数据接收诊断 UX/UI 设计（§9.20）、G10 授权模型与平台 Query 通用约束无歧义派生；自动审批依据见规格自检节。

**声明边界**：诊断只暴露**安全投影**。**不**给浏览器 `event_inbox.envelope` 原文、Worker 内部 lease、密钥摘要、内部堆栈、原始日志或内部队列细节。**`HTTP accepted` 绝不等于"接入成功"**：只有 `event_inbox` 中可靠接收并最终进入处理/可查询状态的事件才是真实证据。**被拒绝批次未持久化**（接入 API 对 401/403/400 同步返回、不落库），因此"被拒绝"证据在 v1 一律以 `unavailable` 诚实表达，或由凭证安全状态（disabled/revoked）作为唯一可观察的拒绝原因。

## 2. 元数据、Owner 和范围

- **Owner**：ingestion/backend
- **适用范围**：
  - `packages/ingestion-inbox`：`queryProjectInboxDiagnostics` 只读查询（按状态计数 + 最近时间戳，无新 Migration）；
  - `packages/ingestion-credentials`：`queryProjectCredentialSafeStatus` 只读查询（active/disabled/revoked 计数，无秘密/摘要/keyId，无新 Migration）；
  - `packages/processing-store`：`queryProjectQueryableEvidence` 只读查询（error/request/performance 处理存储行数证据，无新 Migration）；
  - `packages/platform-contract`：`diagnosticsGetDataStatus` 操作定义、request/response schema、从 `BLOCKED_OPERATIONS` 移入稳定操作注册表、OpenAPI 生成与漂移门禁；
  - `apps/platform-api`：`GET /api/platform/v1/organizations/:organizationId/projects/:projectId/data-status` handler、项目级查看授权（复用 G10 授权模型与 DAT-16 `requireProjectAccess`）、错误映射与安全投影；
  - 正式规格、README、单元/真实 PostgreSQL 集成测试、全仓质量门禁与 OpenAPI/漂移门禁。
- **明确非职责**：
  - 修改 `event_inbox`/`ingestion_client_credentials`/processing-store 表结构、Worker、ingestion-api、凭证生命周期或写侧 Repository；
  - 记录被拒绝批次（需独立 approved 规格：接入请求/访问日志表）；
  - 逐事件处理轨迹、完整载荷、密钥查看、内部队列浏览/重放、自动修复、无限轮询；
  - Console 业务页面（属 G11）、任何写操作、CSRF。

## 3. 模块选择依据

- C7 数据接收诊断 UX（§9.20）明确"权威诊断摘要 + 有限阶段事实 + 最近请求与成功证据 + 主要拒绝原因 + 密钥/来源/环境证据 + 获授权行动目标"由服务端组合投影，且"仓库尚无项目诊断、接收阶段、最近证据或行动映射的正式 API……不确定最终接口路径、字段、刷新策略、枚举或错误码"——具体契约正是本模块要正式化的对象；
- 写侧状态已稳定：`event_inbox` 状态机（ADR-008/010 implemented）、`ingestion_client_credentials`（ADR-013 implemented）、processing-store（ADR-018/020/021 implemented）均通过真实 PostgreSQL 17.10 验证；
- G10/DAT-16 已实现平台 Query 通用能力与项目级授权（`requireProjectAccess` 直接复用）；
- 用户 G02 指令明确：区分未收到/被拒绝/已可靠接收/processing/已进入可查询结果/failed-dead-letter where safely exposable；不得把 accepted 等同 processed/queryable；诊断只能暴露安全投影。

## 4. 数据来源与查询语义

查询在同一 PostgreSQL 数据库内只读三组表（平台与接入共享同一数据库）：

| 来源 | 用途 | 语义 |
|---|---|---|
| `event_inbox` | 接收/缓冲/处理/死信阶段事实 | `state` 五值（pending/leased/retry_waiting/processed/dead_lettered）；`received_at`/`processed_at`/`dead_lettered_at`/`attempt_count`/`last_error_code`。**可靠接收**=有 `received_at` 的行；**processing**=`pending|leased|retry_waiting`；**processed/queryable**=`processed`；**failed/dead-letter**=`dead_lettered`。`event_type` 可区分成功事件（error/request/performance） |
| `ingestion_client_credentials`（含 origins/environments 子表） | 密钥安全状态 | `status` 三值（active/disabled/revoked）；**只返回计数与最近时间，绝不返回 secret_digest/key_id/origin/environment 值** |
| `@aurora/processing-store` 处理表（`error_event_occurrences`/`request_metric_buckets`/`performance_metric_buckets`） | 已进入可查询结果证据 | 每表行数证明该类型数据已实际写入可查询存储 |

**关键查询语义**（严格遵守 C7/用户边界）：
1. **`accepted ≠ processed/queryable`**：`received`（有 `received_at`）与 `processed`（`state='processed'`）分别计数；"已进入可查询结果"同时要求 `event_inbox.processed` 与 processing-store 存在证据。
2. **被拒绝不可观察**：接入 API 对无效密钥/来源/批次同步返回 401/403/400 且不持久化，`rejection` 区一律 `{status:'unavailable'}`；唯一可观察的拒绝原因来自凭证安全状态（全部 disabled/revoked → `credential_inactive`）。
3. **缺失不是 0 / 不是正常**：无行/无凭证 → 明确 `empty`/`not_receiving`，不显示"正常接收"；数据源不可用 → `unavailable`。

## 5. 公开契约

### 5.1 操作

```
operationId: diagnosticsGetDataStatus
domain: monitoring-projections
authLevel: session
method: GET
path: /api/platform/v1/organizations/:organizationId/projects/:projectId/data-status
page: project.data-status
csrf: false
idempotency: false
tags: [monitoring, diagnostics]
```

### 5.2 请求

- `pathParams`：`organizationId: OrganizationId`、`projectId: ProjectId`；
- `query`：
  - `timeRange`（可选）：`start`/`end`（RFC 3339 UTC，`utcTimestamp`），默认最近 24 小时；窗口上限 7 天；`start < end`；`end` 不得明显晚于服务端当前时间（允许时钟偏差）。非法 → `structural_error`。

### 5.3 响应（200）

使用 `queryResponse` 模式（`data` + `meta.requestId/readAt/normalizedQuery` + `allowedActions` + `navigationTargets`）：

```text
data:
  summary: sectionResult(DiagnosisSummary)
  stages: sectionResult(StageFacts)
  recent: sectionResult(RecentEvidence)
  rejection: sectionResult(RejectionEvidence)
  credential: sectionResult(CredentialSafeStatus)
  queryable: sectionResult(QueryableEvidence)
  actionTargets: arr(RouteTarget, 0, 8)
meta, allowedActions, navigationTargets
```

- `DiagnosisSummary`（`summary` 的 `data`）：
  - `status`: `enum_(['receiving','processing','blocked','not_receiving','unknown'])`；
  - `primaryCause`: `optional(enum_(['credential_inactive','no_credential','no_received_events','processing_backlog']))`；
  - `asOf`: `utcTimestamp`（服务端组合时刻）。
  - 派生规则（优先级从高到低）：(1) 有凭证且全部非 active → `blocked`/`credential_inactive`；(2) 无凭证 → `not_receiving`/`no_credential`；(3) 有凭证但窗口内 `receivedCount === 0` → `not_receiving`/`no_received_events`；(4) `processingCount > 0` → `processing`/`processing_backlog`；(5) `processedCount > 0` → `receiving`（primaryCause 省略）；(6) 其他 → `unknown`。
- `StageFacts`（`stages` 的 `data`）：
  - `received`: `StageFact`（`count`/`latestAt?`）；
  - `processing`: `StageFact`（`count`/`latestAt?`）；
  - `processed`: `StageFact`（`count`/`latestAt?`）；
  - `deadLetter`: `StageFact`（`count`/`latestAt?`/`lastErrorCode?`）。
  - `StageFact = { count: num(0), latestAt: optional(utcTimestamp) }`（`deadLetter` 另含 `lastErrorCode: optional(str(1,64))`）。
- `RecentEvidence`（`recent` 的 `data`）：
  - `latestReceivedAt`: `optional(utcTimestamp)`；`receivedCount`: `num(0)`；
  - `latestProcessedAt`: `optional(utcTimestamp)`；`processedCount`: `num(0)`；
  - `environmentBreakdown`: `sectionResult` 恒 `{status:'unavailable', reason:'environment not persisted (deferred)'}`（`event_inbox` 无 environment 列，不伪造）。
- `RejectionEvidence`（`rejection` 的 `data` 永不出现，区恒为 `{status:'unavailable', reason:'rejected batches are not persisted (deferred)'}`）。
- `CredentialSafeStatus`（`credential` 的 `data`）：`activeCount`/`disabledCount`/`revokedCount`: `num(0)`；`latestCreatedAt`: `optional(utcTimestamp)`。**绝不包含 secret_digest/key_id/origin/environment 值**。
- `QueryableEvidence`（`queryable` 的 `data`）：`errorOccurrences`/`requestMetricBuckets`/`performanceMetricBuckets`: `num(0)`；`latestProcessedAt`: `optional(utcTimestamp)`。
- `actionTargets`: `arr(routeTarget, 0, 8)`，从封闭映射生成：`blocked/credential_inactive` → `project.client-keys`；`not_receiving/no_credential` 或 `no_received_events` → `project.onboarding`（获授权时）；`processing_backlog`/正常 → `project.requests`/`project.performance`（获授权时）。不含无权目标。

### 5.4 错误

`structural_error`、`authentication`、`authorization`、`not_found`（org/project 不存在或项目不属于该 org，不泄露存在性）、`rate_limited`、`authority_unavailable`。

## 6. 授权与隐私

- **项目级查看权限**：handler 复用 G10 `requireSession` + `effectivePermissions` + DAT-16 `requireProjectAccess`（org manager 或 `project_members`；跨 org 404 无存在性泄露）；无权限 → 403 且**不调用数据 Repository**。
- **隐私硬边界**：不返回 `event_inbox.envelope` 原文、request_id、batch_id、密钥摘要/keyId/origin/environment 值、内部 lease、堆栈、日志；`last_error_code` 为稳定错误码（来自 Worker 写回，安全）；缺失一律 `empty`/`unavailable`/`not_receiving`，不伪造 0 或"正常"。
- **错误映射**：新增三个数据源错误接入 `apps/platform-api` 稳定错误映射（`ProcessingStoreError` 已在 DAT-16 接入；`IngestionInboxError`/`IngestionCredentialsError` 同类接入 → 400/503 稳定错误）。

## 7. 包位置与包结构

- `@aurora/ingestion-inbox`（`data` 层，无新 Migration）新增：
  - `src/diagnostics-types.ts`、`src/diagnostics-query.ts`：`queryProjectInboxDiagnostics(pool, {projectId, startIso, endIso})` → `{ byState: {pending, leased, retry_waiting, processed, dead_lettered}, latestReceivedAt, latestProcessedAt, latestDeadLetteredAt, lastErrorCode }`（参数化 SQL，稳定 `IngestionInboxError`）；
  - 包根 `index.ts` 导出。
- `@aurora/ingestion-credentials`（`data` 层，无新 Migration）新增：
  - `src/credential-status-query.ts`：`queryProjectCredentialSafeStatus(pool, {projectId})` → `{ activeCount, disabledCount, revokedCount, latestCreatedAt }`（只计数与时间，不读 secret_digest/key_id/origin/environment）；
  - 包根 `index.ts` 导出。
- `@aurora/processing-store`（`data` 层，无新 Migration）新增：
  - `src/queryable-evidence-query.ts`：`queryProjectQueryableEvidence(pool, {projectId})` → `{ errorOccurrences, requestMetricBuckets, performanceMetricBuckets }`；
  - 包根 `index.ts` 导出。
- `@aurora/platform-contract`（`contract` 层）：
  - `src/monitoring/diagnostics.ts`（操作常量、pathParams/query/response schema）；
  - `src/registry/operations.ts`（从 `BLOCKED_OPERATIONS` 移除、加入稳定操作）；
  - OpenAPI 重新生成 + 漂移门禁通过。
- `apps/platform-api`（`service` 层）：
  - `src/routes/diagnostics.ts`（handler：requireSession → effectivePermissions → requireProjectAccess → 组合三个查询 → 派生 summary/actionTargets → serializeOutput）；
  - `src/error-mapper.ts`（接入 `IngestionInboxError`/`IngestionCredentialsError`）；`src/app.ts` 注册路由。

## 8. 明确不暴露（deferred / blocked）

- 被拒绝批次记录（需接入请求/访问日志表，独立 approved 规格）；
- 环境/来源维度证据（`event_inbox` 无 environment 列，deferred）；
- 逐事件处理轨迹、内部 lease、队列内部、完整载荷；
- 密钥摘要/keyId/origin/environment 值、凭证管理 UI；
- 自动修复、无限轮询、专家系统。

## 9. 测试策略

- 单元测试（状态派生规则、actionTargets 映射、时间范围校验）；
- 真实 PostgreSQL 17.10 集成测试（`AURORA_TEST_DATABASE_URL`）必要状态：
  - **accepted vs processing**：写入并处理部分事件 → `received`/`processed` 计数正确、`processing` 区分 pending/leased/retry_waiting；
  - **rejected/failed**：`dead_lettered` 事件 → `deadLetter` 计数与 `lastErrorCode`；`rejection` 恒 `unavailable`；凭证 disabled/revoked → summary `blocked/credential_inactive`；
  - **project isolation**：两项目数据互不串扰；
  - summary 派生优先级各分支；actionTargets 映射；空项目 → `not_receiving`/empty；
- 契约测试（操作注册、OpenAPI 生成、漂移门禁）；
- 授权集成测试（manager/member/403/404，无权限不查数据）；
- 隐私负例（响应不含 envelope/request_id/batch_id/key_id/secret/origin/environment）；
- 全仓质量门禁 + `openapi:check`。

## 10. 非目标与回归约束

- 不修改 `event_inbox`/`ingestion_client_credentials`/processing-store 写侧、Worker、ingestion-api、凭证生命周期；
- 不新增依赖、不新增 Migration；
- 不修改 DAT-16 已实施契约（`requestsListEndpoints` 保持）；
- 无新 ADR（`diagnosticsGetDataStatus` 已在 `BLOCKED_OPERATIONS` 预留，契约定义为附加式公开能力）。

## 11. 规格自检

- **占位符扫描**：无 TBD/TODO；所有字段、枚举、派生规则、错误码、测试路径已冻结；
- **内部一致性**：`summary` 派生与 `stages`/`credential`/`queryable` 数据一一对应；`rejection` 恒 unavailable 与 §4 语义 2 一致；
- **范围检查**：单模块（三个只读查询 + 契约 + handler + 授权 + 错误映射），可一次实施；无写侧、无 UI、无新 Migration；
- **歧义检查**："被拒绝不可观察"已显式（§1/§4/§5.3）；环境维度 deferred 已显式；summary 派生优先级已冻结。
