# DAT-20 Ingestion Diagnosis Status Query Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the real ingestion state (`event_inbox` state machine + credential safe status + queryable processing evidence) as a formal, safe, project-scoped public Platform Query (`diagnosticsGetDataStatus`) with honest `accepted ≠ processed/queryable` and `rejected = unavailable` semantics.

**Architecture:** Contract-first. Add `diagnosticsGetDataStatus` to `@aurora/platform-contract` (unblock, regenerate OpenAPI + drift); add three read-only query repositories (ingestion-inbox, ingestion-credentials, processing-store); add the project-scoped handler to `apps/platform-api` reusing DAT-16 `requireProjectAccess` and wiring the two new data-layer error classes into the stable error mapper.

**Tech Stack:** TypeScript, `pg`, `@aurora/event-schema`, `@aurora/platform-contract`, Fastify, Vitest + real PostgreSQL 17.10, node-pg-migrate (no new migration).

## 固定回读与权威边界

| 来源 | 用途 |
|---|---|
| `../../AGENTS.md` / `../../AURORA_RULES.md` | 任务路由、G02 边界、质量门禁 |
| `../architecture/ingestion-diagnostics-status-query.md`（本文规格） | 模块唯一权威来源；字段/枚举/派生规则/边界以规格 §5 为准 |
| `../architecture/ingestion-inbox-data-model.md` + ADR-008/010 | `event_inbox` 五状态与列（只读） |
| `../architecture/ingestion-http-service.md` + ADR-009/011 | 接入 API 同步拒绝不持久化的事实 |
| `../architecture/ingestion-client-credential-storage-and-verification.md` + ADR-013 | `ingestion_client_credentials` 三状态与安全投影（只读） |
| `../architecture/request-metric-aggregate-store.md`/`error-event-occurrence-processing-store.md`/`performance-metric-aggregate-and-bounded-sample-store.md` | processing-store 三表（只读证据计数） |
| `../protocol/ingestion-batch-and-receipt-contract.md` | 稳定状态枚举语义 |
| DAT-16 已实施（`apps/platform-api/src/routes/requests.ts`、`_shared.ts`、`error-mapper.ts`、`packages/platform-contract/src/monitoring/request-metrics.ts`） | `requireProjectAccess`/`queryResponse`/稳定错误映射复用 |
| C7 UX（§9.20） | 权威诊断摘要/有限阶段事实/最近证据/拒绝原因/密钥证据/行动目标 |

**Module ID: DAT-20**（G02 第二叶子）。本计划**不得**实现 DAT-16/DAT-17、被拒绝批次日志表、环境维度、Console 页面。

## Global Constraints

- 只公开服务端**真实持久化**状态；`accepted ≠ processed/queryable`；被拒绝批次恒 `unavailable`；缺失恒 `empty`/`not_receiving`，**不得解释为 0 或"正常"**。
- 隐私硬边界：不返回 `event_inbox.envelope` 原文、request_id、batch_id、key_id、secret_digest、origin/environment 值、内部 lease、堆栈、日志。
- 项目级查看权限：复用 DAT-16 `requireProjectAccess`（org manager 或 `project_members`；跨 org 404 无存在性泄露）；无权限 403 且**不调用数据 Repository**。
- 三个新查询 Repository 只读、参数化 SQL、稳定错误；无新 Migration、无新依赖、不修改任何写侧 Repository/Worker/ingestion-api/Console/既有契约（含 DAT-16）。
- `IngestionInboxError`/`IngestionCredentialsError` 接入 `apps/platform-api` 稳定错误映射（400 invalid_input / 503 statement_failed+database_unavailable）。
- 无新 ADR；`diagnosticsGetDataStatus` 从 `BLOCKED_OPERATIONS` 移入稳定操作注册表。
- 每 Task 目标验证：受影响 package `typecheck` + 该 Task 的 targeted tests + `git diff --check`；涉及 OpenAPI 时跑 `pnpm platform-contract:generate` + `openapi:platform:lint` + `platform-contract-drift`。

---

### Task 1: Contract operation + schema (unblock `diagnosticsGetDataStatus`)

**Files:**
- Create: `packages/platform-contract/src/monitoring/diagnostics.ts`
- Modify: `packages/platform-contract/src/registry/operations.ts`（加入稳定操作 + import；从 `BLOCKED_OPERATIONS` 删除 `diagnosticsGetDataStatus`）
- Modify: `packages/platform-contract/src/index.ts`（导出操作常量与 schema）
- Test: `packages/platform-contract/test/monitoring/diagnostics.test.ts`

**Interfaces:**
- Consumes: `../common/schema.js`、`../common/query.js`（`queryResponse`）、`../common/time.js`（`timeRange`/`utcTimestamp`）、`../common/identifiers.js`（`OrganizationId`/`ProjectId`）、`../common/section.js`（`sectionResult`）、`../common/navigation.js`（`routeTarget`）。
- Produces: `OPERATION_ID_GET_DATA_STATUS`、`diagnosticsGetDataStatusPathParams`、`diagnosticsGetDataStatusQuery`、`diagnosticsGetDataStatusResponse`；稳定操作注册表条目（op id `diagnosticsGetDataStatus`、domain `monitoring-projections`、authLevel `session`、GET、path `/api/platform/v1/organizations/:organizationId/projects/:projectId/data-status`、page `project.data-status`、csrf false、idempotency false、errorCodes `['structural_error','authentication','authorization','not_found','rate_limited','authority_unavailable']`、tags `['monitoring','diagnostics']`）。

- [ ] **Step 1: Write the failing contract test**

`packages/platform-contract/test/monitoring/diagnostics.test.ts`（断言：稳定 op id；pathParams 必含两 id；query 的 `timeRange` 可选；响应为 `queryResponse` 且含规格 §5.3 六个区 + actionTargets，其中 `rejection` 为 `unavailable` 变体时合法）。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aurora/platform-contract test -- test/monitoring/diagnostics.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write minimal contract module**

`packages/platform-contract/src/monitoring/diagnostics.ts`，schema 逐字来自规格 §5.3（`DiagnosisSummary.status` 五值枚举；`primaryCause` 四值可选枚举；`StageFact`；`CredentialSafeStatus` 三计数 + `latestCreatedAt?`；`QueryableEvidence` 三计数 + `latestProcessedAt?`；`RejectionEvidence` 恒不可用——响应 `rejection: sectionResult(obj({}))` 与其余区一致）。在 `registry/operations.ts` 追加稳定操作、删除 blocked 条目；在 `index.ts` 导出。

> **实现注意：** `routeTarget` 用于 `actionTargets` 数组；`sectionResult` 对 `summary`/`stages`/`recent`/`rejection`/`credential`/`queryable` 六个区；`timeRange` 可选。响应 `data` 结构必须与规格 §5.3 完全一致（六个区 + `actionTargets: arr(routeTarget, 0, 8)`）。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @aurora/platform-contract test -- test/monitoring/diagnostics.test.ts`
Expected: PASS.

- [ ] **Step 5: Regenerate OpenAPI + drift gate**

Run: `pnpm platform-contract:generate && pnpm openapi:platform:lint && pnpm --filter @aurora/platform-contract-drift test`
Expected: `diagnosticsGetDataStatus` blocked→stable；lint + drift PASS。失败则修 registry/schema 至 PASS（不手改 yaml/manifest）。

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm --filter @aurora/platform-contract typecheck && git diff --check`
```bash
git add packages/platform-contract/src/monitoring/diagnostics.ts packages/platform-contract/test/monitoring/diagnostics.test.ts packages/platform-contract/src/registry/operations.ts packages/platform-contract/src/index.ts docs/api/platform-openapi-v1.yaml docs/api/platform-openapi-v1.manifest.json
git commit -m "feat(contract): unblock diagnosticsGetDataStatus ingestion diagnosis operation (DAT-20)"
```

---

### Task 2: Read-only diagnostic repositories (three packages)

**Files:**
- Create: `packages/ingestion-inbox/src/diagnostics-types.ts`、`packages/ingestion-inbox/src/diagnostics-query.ts`
- Modify: `packages/ingestion-inbox/src/index.ts`
- Create: `packages/ingestion-credentials/src/credential-status-query.ts`
- Modify: `packages/ingestion-credentials/src/index.ts`
- Create: `packages/processing-store/src/queryable-evidence-query.ts`
- Modify: `packages/processing-store/src/index.ts`
- Test: 三包各加单元测试（纯逻辑，若有）+ 真实 PostgreSQL 集成测试（`test/integration/` 每包约定）

**Interfaces:**
- Consumes: 三包现有表结构、`pg` `Pool`、各包稳定错误类。
- Produces（包根导出）：
  - `@aurora/ingestion-inbox`：`queryProjectInboxDiagnostics(pool, {projectId, startIso, endIso})` → `{ byState: { pending: number; leased: number; retry_waiting: number; processed: number; dead_lettered: number }; latestReceivedAt: string | null; latestProcessedAt: string | null; latestDeadLetteredAt: string | null; lastErrorCode: string | null }`（窗口内 `received_at` 过滤；`lastErrorCode` 取最新 dead_lettered 行的 `last_error_code`）。
  - `@aurora/ingestion-credentials`：`queryProjectCredentialSafeStatus(pool, {projectId})` → `{ activeCount: number; disabledCount: number; revokedCount: number; latestCreatedAt: string | null }`（**只查 status/created_at，不读 secret_digest/key_id**）。
  - `@aurora/processing-store`：`queryProjectQueryableEvidence(pool, {projectId})` → `{ errorOccurrences: number; requestMetricBuckets: number; performanceMetricBuckets: number }`（三表行数）。
  - 每个 Repository 数据库错误一律映射各自稳定错误（`IngestionInboxError`/`IngestionCredentialsError`/`ProcessingStoreError`），不泄露内部细节。

- [ ] **Step 1: Write the failing unit test (each package)**

- `packages/ingestion-inbox/test/diagnostics-query.unit.test.ts`（若含纯逻辑则测；否则以集成为主）。
- 集成测试（三包 `test/integration/`，`AURORA_TEST_DATABASE_URL=postgresql://aurora:aurora_test_pw@localhost:15432/aurora_inbox_test`，`describe.skip` 守卫，种子用各包写侧 Repository 或 INSERT）：
  - `ingestion-inbox`：写入 5 行（2 processed、1 pending、1 retry_waiting、1 dead_lettered）→ `byState` 计数正确、latest 时间正确、`lastErrorCode` 来自 dead_lettered；另一 projectId 隔离。
  - `ingestion-credentials`：创建 3 凭证（1 active、1 disabled、1 revoked）→ 计数正确、latestCreatedAt 正确、不暴露任何 secret/key 字段（负例）。
  - `processing-store`：向三表各写 1 行 → 三计数正确；空项目 → 全 0；另一 projectId 隔离。

- [ ] **Step 2: Run tests to verify they fail**

Run（逐包）：`pnpm --filter @aurora/ingestion-inbox test:integration -- test/integration/diagnostics-query.test.ts`（同 credentials/processing-store）
Expected: FAIL — 函数未导出/表未接。

- [ ] **Step 3: Minimal implementation（三包各自文件）**

`diagnostics-query.ts`：
```ts
export async function queryProjectInboxDiagnostics(
  pool: Pool,
  input: { projectId: string; startIso: string; endIso: string },
): Promise<ProjectInboxDiagnostics> {
  // SELECT state, COUNT(*)::bigint AS cnt FROM event_inbox
  //   WHERE project_id = $1 AND received_at >= $2 AND received_at < $3 GROUP BY state
  // + SELECT MAX(received_at)::text, MAX(processed_at)::text, MAX(dead_lettered_at)::text,
  //        (SELECT last_error_code FROM event_inbox WHERE project_id=$1 AND state='dead_lettered'
  //           AND received_at>=$2 AND received_at<$3 ORDER BY dead_lettered_at DESC LIMIT 1) AS last_error
  //   FROM event_inbox WHERE project_id=$1 AND received_at>=$2 AND received_at<$3
  // 组装 byState（缺失状态 = 0 是"事实计数"，允许）；latest 时间 null 当无行；未知状态按 invalid_input。
}
```
`credential-status-query.ts`：
```ts
export async function queryProjectCredentialSafeStatus(pool, input): Promise<ProjectCredentialSafeStatus> {
  // SELECT status, COUNT(*)::bigint AS cnt FROM ingestion_client_credentials
  //   WHERE project_id = $1 GROUP BY status
  // + SELECT MAX(created_at)::text FROM ingestion_client_credentials WHERE project_id = $1
}
```
`queryable-evidence-query.ts`：
```ts
export async function queryProjectQueryableEvidence(pool, input): Promise<ProjectQueryableEvidence> {
  // SELECT (SELECT COUNT(*)::bigint FROM error_event_occurrences WHERE project_id=$1) AS error,
  //        (SELECT COUNT(*)::bigint FROM request_metric_buckets WHERE project_id=$1) AS request,
  //        (SELECT COUNT(*)::bigint FROM performance_metric_buckets WHERE project_id=$1) AS performance
}
```

> **实现注意：** 三查询全部参数化；状态只接受 `event_inbox` 五值；`IngestionInboxError`/`IngestionCredentialsError`/`ProcessingStoreError` 稳定错误；不泄露 DB 细节。

- [ ] **Step 4: Run tests to verify they pass**

Run（逐包）：单元 + 集成 + `typecheck`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/ingestion-inbox/src/diagnostics-types.ts packages/ingestion-inbox/src/diagnostics-query.ts packages/ingestion-inbox/src/index.ts packages/ingestion-inbox/test packages/ingestion-credentials/src/credential-status-query.ts packages/ingestion-credentials/src/index.ts packages/ingestion-credentials/test packages/processing-store/src/queryable-evidence-query.ts packages/processing-store/src/index.ts packages/processing-store/test
git commit -m "feat(data): ingestion diagnosis read repositories (inbox + credential + queryable evidence) (DAT-20)"
```

---

### Task 3: Platform-api handler + error mapping

**Files:**
- Modify: `apps/platform-api/src/error-mapper.ts`（接入 `IngestionInboxError`/`IngestionCredentialsError`）
- Create: `apps/platform-api/src/routes/diagnostics.ts`
- Modify: `apps/platform-api/src/app.ts`（注册路由）
- Test: `apps/platform-api/test/error-mapper.test.ts`（追加两类错误映射）+ `apps/platform-api/test/integration/diagnostics-query.test.ts`

**Interfaces:**
- Consumes: Task 1 契约；Task 2 三查询；`requireSession`/`effectivePermissions`/`requireProjectAccess`/`projectNavigation`（均来自 `_shared.ts`，DAT-16 已实现）；`sendMappedError`。
- Produces：`handleGetDataStatus(request, reply, deps)`；稳定错误映射含 `IngestionInboxError`/`IngestionCredentialsError`。

- [ ] **Step 1: Write the failing error-mapper test**

`apps/platform-api/test/error-mapper.test.ts` 追加：
```ts
it('maps IngestionInboxError invalid_input to 400 structural_error', () => {
  const r = mapErrorToProblem('req', new IngestionInboxError('invalid_input', 'x'));
  expect(r.status).toBe(400); expect(r.problem.code).toBe('structural_error');
});
it('maps IngestionCredentialsError database_unavailable to 503 authority_unavailable', () => {
  const r = mapErrorToProblem('req', new IngestionCredentialsError('database_unavailable', 'x'));
  expect(r.status).toBe(503); expect(r.problem.code).toBe('authority_unavailable');
});
```
Expected: FAIL（未接入）。

- [ ] **Step 2: Minimal error-mapper change**

`error-mapper.ts`：import `IngestionInboxError`、`IngestionCredentialsError`，加入 `isStableDataError` 的 union 与 `instanceof` 检查（`mapStableErrorKind` 已处理三种 kind）。

- [ ] **Step 3: Write the failing flow test**

`apps/platform-api/test/integration/diagnostics-query.test.ts`（复用 flow-helpers：register/login → create org → create project → 种子三包数据 → GET `/data-status`）：
- manager 200：summary/stages/recent/credential/queryable/actionTargets 结构与真实数据一致；`rejection` 恒 `unavailable`；
- 项目成员 200；非成员 403（且响应无数据）；跨 org 项目 404；
- 空项目 → summary `not_receiving`/`no_credential`，stages/credential/queryable `empty`（或 available+零计数，按实现确定并锁定）；
- 凭证全 disabled → summary `blocked`/`credential_inactive`，actionTargets 含 `project.client-keys`；
- 死信存在 → stages.deadLetter 计数 + lastErrorCode；
- 隐私负例：响应不含 `envelope`/`request_id`/`batch_id`/`key_id`/`secret`/`origin`/`environment`/`digest`/`lease`。

- [ ] **Step 4: Minimal handler implementation**

`routes/diagnostics.ts` `handleGetDataStatus`：parseInput → requireUuidParams → requireSession → effectivePermissions → requireProjectAccess → 组合 `queryProjectInboxDiagnostics`/`queryProjectCredentialSafeStatus`/`queryProjectQueryableEvidence` → 按规格 §5.3 派生 `summary`（优先级规则）与 `actionTargets`（封闭映射）→ serializeOutput。空/无凭证语义按规格 §5.3；`rejection` 恒 `{status:'unavailable', reason}`。`app.ts` 注册 `GET '/api/platform/v1/organizations/:organizationId/projects/:projectId/data-status'`。

- [ ] **Step 5: Run tests to verify pass**

Run: `pnpm --filter @aurora/platform-api test -- test/error-mapper.test.ts` 与 `AURORA_TEST_DATABASE_URL=... AURORA_TEST_REDIS_URL=redis://localhost:16379 pnpm --filter @aurora/platform-api test -- test/integration/diagnostics-query.test.ts`；`pnpm --filter @aurora/platform-api typecheck`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add apps/platform-api/src/error-mapper.ts apps/platform-api/src/routes/diagnostics.ts apps/platform-api/src/app.ts apps/platform-api/test
git commit -m "feat(platform-api): diagnosticsGetDataStatus handler with project authorization (DAT-20)"
```

---

### Task 4: Contract integration, verification + docs

**Files:**
- Modify: `packages/platform-contract/README.md`、`packages/ingestion-inbox/README.md`、`packages/ingestion-credentials/README.md`、`packages/processing-store/README.md`、`apps/platform-api/README.md`（能力一行）
- Modify: `docs/architecture/ingestion-diagnostics-status-query.md`（`implementation-status: implemented`、独立验收证据）
- Test: 复用已生成契约（`pnpm --filter @aurora/platform-contract test:package`）+ 受影响验证

**Interfaces:**
- Consumes: Task 1-3 全部产出。

- [ ] **Step 1: Package-entry + generated contract integration test**

Run: `pnpm --filter @aurora/platform-contract build && pnpm --filter @aurora/platform-contract test:package && pnpm platform-contract:generate && pnpm openapi:platform:lint && pnpm --filter @aurora/platform-contract-drift test`
Expected: PASS（client/server 适配器含 `diagnosticsGetDataStatus`；包入口无 `ERR_PACKAGE_PATH_NOT_EXPORTED`）。

- [ ] **Step 2: Affected-verification sweep**

Run:
```
pnpm --filter @aurora/ingestion-inbox test && pnpm --filter @aurora/ingestion-inbox typecheck
pnpm --filter @aurora/ingestion-credentials test && pnpm --filter @aurora/ingestion-credentials typecheck
pnpm --filter @aurora/processing-store test && pnpm --filter @aurora/processing-store typecheck
pnpm --filter @aurora/platform-contract typecheck && pnpm --filter @aurora/platform-api typecheck
git diff --check
```
Expected: 全 PASS（不跑 Browser/Console/root coverage/ingestion 全套）。

- [ ] **Step 3: Update docs**

- `ingestion-diagnostics-status-query.md`：`implementation-status: in-progress → implemented`，§1 记录独立验收证据（测试数、命令、结果）。
- 五个 README 各加一行能力说明。

- [ ] **Step 4: Commit**

```bash
git add docs/architecture/ingestion-diagnostics-status-query.md packages/platform-contract/README.md packages/ingestion-inbox/README.md packages/ingestion-credentials/README.md packages/processing-store/README.md apps/platform-api/README.md
git commit -m "docs: DAT-20 ingestion diagnostics query implemented"
```
（`AGENTS.md`/`AURORA_RULES.md` 叶子计数由 controller 在独立验收后更新。）

---

## Plan Self-Review

- **approved spec coverage**：规格 §5 契约、§6 授权/隐私、§7 结构、§9 测试全部映射到 Task 1-4；无遗漏。
- **file reality**：三数据包新增文件与既有仓库模式一致（`*types.ts`/`*-repository.ts` 或 `*-query.ts`）；`platform-contract/src/monitoring/` 沿用 DAT-16。
- **no placeholder**：SQL 骨架显式；无 TBD/TODO。
- **API/Schema consistency**：`queryResponse`/`sectionResult`/`routeTarget`/`timeRange`/`OrganizationId`/`ProjectId` 均为既有导出；操作 path 与 RouteTarget `project.data-status` 一致。
- **authorization**：复用 DAT-16 `requireProjectAccess`；无权限不查数据；跨 org 404。
- **privacy**：不返回 envelope/request_id/batch_id/key_id/secret/origin/environment/lease；`last_error_code` 为稳定错误码。
- **SQL/query semantics**：窗口 = `received_at` 半开区间；`byState` 缺失状态计数为 0（事实计数，非数据缺失）；latest 时间 null 当无行。
- **no fake data**：`rejection` 恒 unavailable；环境维度 unavailable；缺失恒 empty/not_receiving。
- **no UI scope leak**：无 Console、无图表。
- **no unnecessary tests**：每 Task 1-2 targeted 测试 + 必要 typecheck/diff；真实 DB 只验必要状态（accepted vs processing、rejected/failed、project isolation）。
- **task count reasonable**：4 个 meaningful Task。
