# DAT-17 Performance Query Projection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the existing performance metric aggregate (`performance_metric_buckets`, ADR-021) as a formal, safe, project-scoped public Platform Query (`performanceListPages`) with honest project-level aggregates and `pages`/`percentiles` = `unavailable`.

**Architecture:** Contract-first. Add `performanceListPages` to `@aurora/platform-contract` (unblock, regenerate OpenAPI + drift); add one read-only query repo to `@aurora/processing-store`; add the project-scoped handler to `apps/platform-api` reusing DAT-16 `requireProjectAccess` and the already-wired `ProcessingStoreError` mapping.

**Tech Stack:** TypeScript, `pg`, `@aurora/event-schema` (`PerformanceMetricName`/`PerformanceMetricUnit`), `@aurora/platform-contract`, Fastify, Vitest + real PostgreSQL 17.10, node-pg-migrate (no new migration).

## 固定回读与权威边界

| 来源 | 用途 |
|---|---|
| `../../AGENTS.md` / `../../AURORA_RULES.md` | 任务路由、G02 边界、质量门禁 |
| `../architecture/performance-query-projection.md`（本文规格） | 模块唯一权威来源；字段/枚举/计算/边界以规格 §5 为准 |
| `../architecture/performance-metric-aggregate-and-bounded-sample-store.md` + ADR-021 | `performance_metric_buckets` 列与聚合键（只读） |
| `../architecture/performance-event-processor.md` | DAT-09：V1 不调用 `persistPerformanceEventSample`（样本未写入） |
| `../protocol/performance-event-contract.md` | `PerformanceMetricName`/`PerformanceMetricUnit`（lcp/inp/cls/page_load; millisecond/ratio） |
| DAT-16/DAT-20 已实施（`routes/requests.ts`/`routes/diagnostics.ts`、`_shared.ts`、`error-mapper.ts`） | `requireProjectAccess`/`queryResponse`/`ProcessingStoreError` 映射复用 |
| C6 UX（§9.19） | 项目查看权限、"只列实际有数据"、"部分页或总量缺失明确标记" |

**Module ID: DAT-17**（G02 第三叶子）。本计划**不得**实现 DAT-16/DAT-20、页面/路由维度、percentile、性能样本保存、Console 页面。

## Global Constraints

- 只公开服务端**真实存在**的数据：项目级性能聚合（`performance_metric_buckets`）来自真实 count/sum/max；`mean = value_sum / observed_count`；`pages`/`percentiles` 恒 `unavailable`，**不伪造页面列表或 percentile**。
- 缺失不是 0：无桶窗口 → `metrics` `empty`；指标按实际出现的 `(metric_name, unit)` 返回，不补零。
- 隐私硬边界：不返回原始事件、`performance_event_samples` 样本、Cookie/Authorization、内部列。
- 项目级查看权限：复用 DAT-16 `requireProjectAccess`；无权限 403 且不调用数据 Repository；跨 org 404。
- 只读 Repository、参数化 SQL、稳定 `ProcessingStoreError`；无新 Migration、无新依赖、不修改任何写侧 Repository/Processor/Worker/ingestion-api/Console/既有契约（含 DAT-16/DAT-20）。
- 无新 ADR；`performanceListPages` 从 `BLOCKED_OPERATIONS` 移入稳定操作注册表。
- 每 Task 目标验证：受影响 package `typecheck` + 该 Task 的 targeted tests + `git diff --check`；涉及 OpenAPI 时跑 `pnpm platform-contract:generate` + `openapi:platform:lint` + `platform-contract-drift`。

---

### Task 1: Contract operation + schema (unblock `performanceListPages`)

**Files:**
- Create: `packages/platform-contract/src/monitoring/performance.ts`
- Modify: `packages/platform-contract/src/registry/operations.ts`（加入稳定操作 + import；从 `BLOCKED_OPERATIONS` 删除 `performanceListPages`）
- Modify: `packages/platform-contract/src/index.ts`（导出操作常量与 schema）
- Test: `packages/platform-contract/test/monitoring/performance.test.ts`

**Interfaces:**
- Consumes: `../common/schema.js`、`../common/query.js`（`queryResponse`）、`../common/time.js`（`timeRange`/`utcTimestamp`）、`../common/identifiers.js`（`OrganizationId`/`ProjectId`）、`../common/section.js`（`sectionResult`）。
- Produces: `OPERATION_ID_LIST_PERFORMANCE_PAGES`、`performanceListPagesPathParams`、`performanceListPagesQuery`、`performanceListPagesResponse`；稳定操作注册表条目（op id `performanceListPages`、domain `monitoring-projections`、authLevel `session`、GET、path `/api/platform/v1/organizations/:organizationId/projects/:projectId/performance`、page `project.performance`、csrf false、idempotency false、errorCodes `['structural_error','authentication','authorization','not_found','rate_limited','authority_unavailable']`、tags `['monitoring','performance']`）。

- [ ] **Step 1: Write the failing contract test**

`packages/platform-contract/test/monitoring/performance.test.ts`（断言：稳定 op id `performanceListPages`；pathParams 必含两 id；query `timeRange` 可选；响应为 `queryResponse` 且含 `metrics`/`pages`/`percentiles` 三个区，`pages`/`percentiles` 的 `unavailable` 变体合法；`metricName`/`unit` 枚举闭包拒绝非法值）。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aurora/platform-contract test -- test/monitoring/performance.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write minimal contract module**

`packages/platform-contract/src/monitoring/performance.ts`，schema 逐字来自规格 §5.3：
```ts
const metricAggregate = obj({
  metricName: enum_(['lcp', 'inp', 'cls', 'page_load']),
  unit: enum_(['millisecond', 'ratio']),
  observedCount: num(0),
  valueSum: num(0),
  valueMax: num(0),
  mean: num(0),
});
const performanceMetricSummary = obj({
  metrics: arr(metricAggregate, 0, 16),
  dataThrough: optional(utcTimestamp),
  isPartial: bool(),
});
export const performanceListPagesResponse = queryResponse(
  obj({
    metrics: sectionResult(performanceMetricSummary),
    pages: sectionResult(obj({})),
    percentiles: sectionResult(obj({})),
  }),
);
```
在 `registry/operations.ts` 追加稳定操作、删除 blocked 条目；在 `index.ts` 导出。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @aurora/platform-contract test -- test/monitoring/performance.test.ts`
Expected: PASS.

- [ ] **Step 5: Regenerate OpenAPI + drift gate**

Run: `pnpm platform-contract:generate && pnpm openapi:platform:lint && pnpm --filter @aurora/platform-contract-drift test`
Expected: `performanceListPages` blocked→stable；lint + drift PASS。失败则修 registry/schema 至 PASS（不手改 yaml/manifest；若 generator/manifest pinning 测试因 blocked→stable 需要更新，最小化更新并纳入 commit）。

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm --filter @aurora/platform-contract typecheck && git diff --check`
```bash
git add packages/platform-contract/src/monitoring/performance.ts packages/platform-contract/test/monitoring/performance.test.ts packages/platform-contract/src/registry/operations.ts packages/platform-contract/src/index.ts docs/api/platform-openapi-v1.yaml docs/api/platform-openapi-v1.manifest.json
git commit -m "feat(contract): unblock performanceListPages performance query operation (DAT-17)"
```

---

### Task 2: Read-only performance query repository

**Files:**
- Create: `packages/processing-store/src/performance-metric-query-types.ts`
- Create: `packages/processing-store/src/performance-metric-query-repository.ts`
- Modify: `packages/processing-store/src/index.ts`
- Test: `packages/processing-store/test/performance-metric-query.unit.test.ts` + `packages/processing-store/test/integration/performance-metric-query.test.ts`

**Interfaces:**
- Consumes: `performance_metric_buckets`（列：project_id/bucket_start/metric_name/unit/observed_count/value_sum/value_max/updated_at）、`@aurora/event-schema` 的 `PerformanceMetricName`/`PerformanceMetricUnit` 常量、`ProcessingStoreError`。
- Produces（包根导出）：`queryPerformanceMetricSummary(pool, {projectId, startIso, endIso})` → `{ metrics: MetricAggregate[]; dataThrough: string | null }`。`MetricAggregate = { metricName: PerformanceMetricName; unit: PerformanceMetricUnit; observedCount: number; valueSum: number; valueMax: number; mean: number }`。

- [ ] **Step 1: Write the failing unit test**

`packages/processing-store/test/performance-metric-query.unit.test.ts`（组装/均值/未知 metric 拒绝纯逻辑测试；若均为 SQL 集成则以此为准）。

- [ ] **Step 2: Run to verify fail → implement**

实现 `performance-metric-query-repository.ts`：
```ts
export async function queryPerformanceMetricSummary(
  pool: Pool,
  input: { projectId: string; startIso: string; endIso: string },
): Promise<{ metrics: MetricAggregate[]; dataThrough: string | null }> {
  // SELECT metric_name, unit,
  //   SUM(observed_count)::bigint AS observed,
  //   SUM(value_sum) AS sum,
  //   MAX(value_max) AS max
  // FROM performance_metric_buckets
  // WHERE project_id = $1 AND bucket_start >= $2 AND bucket_start < $3
  // GROUP BY metric_name, unit ORDER BY metric_name, unit
  // + SELECT MAX(updated_at)::text FROM performance_metric_buckets WHERE project_id=$1 AND bucket_start>=$2 AND bucket_start<$3
  // mean = observed === 0 ? 0 : sum / observed（observed===0 行不返回，见规格）
  // metric_name/unit 用 PerformanceMetricName/PerformanceMetricUnit 常量校验，未知值 -> ProcessingStoreError('invalid_input')
}
```

- [ ] **Step 3: Write the failing real-PG integration test**

`packages/processing-store/test/integration/performance-metric-query.test.ts`（用 `persistPerformanceMetricContribution` 种子：同一 metric 多桶、多 metric、多 unit；断言分组/计数/和/最大/均值/`dataThrough`；空窗口 → `metrics: []`、`dataThrough: null`；project isolation）。

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter @aurora/processing-store test -- test/performance-metric-query.unit.test.ts` 与 `AURORA_TEST_DATABASE_URL=postgresql://aurora:aurora_test_pw@localhost:15432/aurora_inbox_test pnpm --filter @aurora/processing-store test:integration -- test/integration/performance-metric-query.test.ts`
Expected: PASS。

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @aurora/processing-store typecheck && git diff --check`
```bash
git add packages/processing-store/src/performance-metric-query-types.ts packages/processing-store/src/performance-metric-query-repository.ts packages/processing-store/src/index.ts packages/processing-store/test
git commit -m "feat(processing-store): performance metric query repository (DAT-17)"
```

---

### Task 3: Platform-api performance query handler

**Files:**
- Create: `apps/platform-api/src/routes/performance.ts`
- Modify: `apps/platform-api/src/app.ts`（注册路由）
- Test: `apps/platform-api/test/integration/performance-query.test.ts`

**Interfaces:**
- Consumes: Task 1 契约；Task 2 查询；`requireSession`/`effectivePermissions`/`requireProjectAccess`/`projectNavigation`（`_shared.ts`，DAT-16 已实现）；`sendMappedError`（`ProcessingStoreError` 已接入 DAT-16）。
- Produces：`handleListPerformancePages(request, reply, deps)`。

- [ ] **Step 1: Write the failing flow test**

`apps/platform-api/test/integration/performance-query.test.ts`（register/login → create org → create project → `persistPerformanceMetricContribution` 种子 → GET `/performance`）：
- manager 200：`metrics` 聚合正确（metricName/unit/observedCount/valueSum/valueMax/mean）、`dataThrough`、`isPartial`；`pages` 恒 `unavailable`；`percentiles` 恒 `unavailable`；
- member 200；非成员 403（响应无数据）；跨 org 404；
- 空项目 → `metrics` `empty`；
- `timeRange` 校验（start>end / 未来 / 超 7 天）→ 400；
- 隐私负例（响应不含原始样本/事件/内部列）。

- [ ] **Step 2: Minimal handler implementation**

`routes/performance.ts` `handleListPerformancePages`：parseInput → requireUuidParams → requireSession → effectivePermissions → requireProjectAccess → `queryPerformanceMetricSummary` → 组装 `metrics`（`metrics.length===0 → {status:'empty'}`；否则 `{status:'available', data:{metrics, dataThrough, isPartial: dataThrough!==null && dataThrough<end}}`）、`pages`（恒 `{status:'unavailable', reason:'page dimension not in performance data (deferred)'}`）、`percentiles`（恒 `{status:'unavailable', reason:'percentiles deferred (ADR-021)'}`）→ serializeOutput。`app.ts` 注册 `GET '/api/platform/v1/organizations/:organizationId/projects/:projectId/performance'`。

- [ ] **Step 3: Run tests to verify pass**

Run: `AURORA_TEST_DATABASE_URL=postgresql://aurora:aurora_test_pw@localhost:15432/aurora_inbox_test AURORA_TEST_REDIS_URL=redis://localhost:16379 pnpm --filter @aurora/platform-api test:integration -- test/integration/performance-query.test.ts` 与 `pnpm --filter @aurora/platform-api typecheck`
Expected: PASS（共享本地测试 DB 若被前一 suite 污染，先重置 schema 再跑）。

- [ ] **Step 4: Commit**

```bash
git add apps/platform-api/src/routes/performance.ts apps/platform-api/src/app.ts apps/platform-api/test/integration/performance-query.test.ts
git commit -m "feat(platform-api): performanceListPages handler with project authorization (DAT-17)"
```

---

### Task 4: Contract integration, verification + docs

**Files:**
- Modify: `packages/platform-contract/README.md`、`packages/processing-store/README.md`、`apps/platform-api/README.md`（能力一行）
- Modify: `docs/architecture/performance-query-projection.md`（`implementation-status: implemented`、独立验收证据）
- Test: 复用已生成契约 + 受影响验证

**Interfaces:**
- Consumes: Task 1-3 全部产出。

- [ ] **Step 1: Package-entry + generated contract integration test**

Run: `pnpm --filter @aurora/platform-contract build && pnpm --filter @aurora/platform-contract test:package && pnpm platform-contract:generate && pnpm openapi:platform:lint && pnpm --filter @aurora/platform-contract-drift test`
Expected: PASS（client/server 适配器含 `performanceListPages`；包入口无 `ERR_PACKAGE_PATH_NOT_EXPORTED`）。

- [ ] **Step 2: Affected-verification sweep**

Run: `pnpm --filter @aurora/processing-store test && pnpm --filter @aurora/processing-store typecheck && pnpm --filter @aurora/platform-contract typecheck && pnpm --filter @aurora/platform-api typecheck && git diff --check`
Expected: 全 PASS（不跑 Browser/Console/root coverage/ingestion 全套）。

- [ ] **Step 3: Update docs**

- `performance-query-projection.md`：`implementation-status: in-progress → implemented`，§1 记录独立验收证据（测试数、命令、结果）。
- 三个 README 各加一行能力说明。

- [ ] **Step 4: Commit**

```bash
git add docs/architecture/performance-query-projection.md packages/platform-contract/README.md packages/processing-store/README.md apps/platform-api/README.md
git commit -m "docs: DAT-17 performance query implemented"
```
（`AGENTS.md`/`AURORA_RULES.md` 叶子计数由 controller 在独立验收后更新。）

---

## Plan Self-Review

- **approved spec coverage**：规格 §5 契约、§6 授权/隐私、§7 结构、§9 测试全部映射到 Task 1-4；无遗漏。
- **file reality**：`platform-contract/src/monitoring/performance.ts` 沿用 DAT-16/DAT-20 模式；`processing-store` 沿用既有 repository 模式；`platform-api/src/routes/performance.ts` 沿用 audit/DAT-16 模式。
- **no placeholder**：SQL 骨架显式；无 TBD/TODO。
- **API/Schema consistency**：`queryResponse`/`sectionResult`/`timeRange`/`OrganizationId`/`ProjectId`/`bool` 均为既有导出；`metricName`/`unit` 枚举与 event-schema 常量一致；操作 path 与 RouteTarget `project.performance` 一致。
- **authorization**：复用 DAT-16 `requireProjectAccess`；无权限不查数据；跨 org 404。
- **privacy**：只返回聚合计数/求和/最大/均值与时间水位；无原始事件/样本。
- **SQL/query semantics**：窗口 = `bucket_start` 半开区间；`mean = value_sum / observed_count`（observed>0 行才返回）；`dataThrough` = `MAX(updated_at)`。
- **no fake data**：`pages`/`percentiles` 恒 unavailable；无 percentile 伪造；缺失恒 empty。
- **no UI scope leak**：无 Console、无图表、无页面列表伪造。
- **no unnecessary tests**：每 Task 1-2 targeted 测试 + 必要 typecheck/diff。
- **task count reasonable**：4 个 meaningful Task。
