# DAT-16 Request Metric Query Projection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the existing request metric aggregate + bounded safe-sample data as a formal, safe, project-scoped public Platform Query (`requestsListEndpoints`) with honest `partial`/`unavailable` semantics.

**Architecture:** Contract-first. Add `requestsListEndpoints` to `@aurora/platform-contract` (unblock from `BLOCKED_OPERATIONS`, regenerate OpenAPI + drift gate); add read-only query repositories to `@aurora/processing-store` over `request_metric_buckets` and `request_event_samples`; add the first project-scoped route to `apps/platform-api` reusing G10 org authorization plus a new project-access check.

**Tech Stack:** TypeScript, `pg`, `@aurora/event-schema` (`RequestMethod`/`RequestOutcome`), `@aurora/platform-contract` (contract schemas + server adapters), Fastify, Vitest + real PostgreSQL 17.10, node-pg-migrate (no new migration).

## 固定回读与权威边界

| 来源 | 用途 |
|---|---|
| `../../AGENTS.md` / `../../AURORA_RULES.md` | 任务路由、G02 边界、质量门禁 |
| `../architecture/request-metric-query-projection.md`（本文规格） | 模块唯一权威来源；所有字段/语义/错误/边界以规格 §5 为准 |
| `../architecture/request-metric-aggregate-store.md` + ADR-020 | `request_metric_buckets` 列与桶语义（只读） |
| `../architecture/request-event-sample-processing-store.md` + ADR-019 | `request_event_samples` 列与 `sample_body` 六字段白名单（只读） |
| `../protocol/request-event-contract.md` | `RequestMethod`/`RequestOutcome`/安全 URL 语义（只读） |
| `../architecture/platform-contract-foundation.md` | 操作注册、OpenAPI 生成、漂移门禁机制 |
| G10 授权实现（`apps/platform-api/src/authorization.ts`、`routes/_shared.ts`、`platform-project-governance`） | `effectivePermissions`/`requireSession`/项目访问守卫复用 |
| C5 UX（§7.20/§8.18/§9.18） | 项目查看权限、"接口列表只列实际有数据"、"部分页或总量缺失明确标记" |

**Module ID: DAT-16**（G02 第一叶子）。本计划**不得**实现 DAT-20/DAT-17、percentile、环境/发布/页面维度、接口路由维度写侧、Console 页面。

## Global Constraints

- 只公开服务端**真实存在**的数据；`isPartial`/`dataThrough`/`completeness` 语义必须与规格 §1/§4/§5.3 完全一致；缺失一律 `empty`/`unavailable`，**不得解释为 0**。
- 隐私硬边界：不返回请求/响应正文、Cookie、Authorization、完整查询字符串、内部 DB 标识；`url` 只来自协议安全投影。
- 项目级查看权限：org manager 看 org 下全部项目，普通成员只看 `project_members` 存在的项目；无权限 403 且**不调用数据 Repository**；项目不属于 org → 404。
- 不新增 Migration、不新增依赖、不修改任何写侧 Repository/Worker/ingestion-api/Console/既有契约。
- 无新 ADR；`requestsListEndpoints` 从 `BLOCKED_OPERATIONS` 移入稳定操作注册表。
- 每 Task 目标验证：受影响 package `typecheck` + 该 Task 的 targeted tests + `git diff --check`；涉及 OpenAPI 时跑 `pnpm platform-contract:generate` + `openapi:platform:lint` + `platform-contract-drift`。

---

### Task 1: Contract operation + schema (unblock `requestsListEndpoints`)

**Files:**
- Create: `packages/platform-contract/src/monitoring/request-metrics.ts`
- Modify: `packages/platform-contract/src/registry/operations.ts`（加入稳定操作 + import；从 `BLOCKED_OPERATIONS` 删除 `requestsListEndpoints`）
- Modify: `packages/platform-contract/src/index.ts`（导出操作常量与 schema，供平台使用方引用）
- Test: `packages/platform-contract/test/monitoring/request-metrics.test.ts`

**Interfaces:**
- Consumes: `../common/schema.js`（`obj`/`arr`/`str`/`num`/`enum_`/`optional`）、`../common/query.js`（`queryResponse`）、`../common/pagination.js`（`pageResult`/`paginationMeta`）、`../common/time.js`（`utcTimestamp`）、`../common/identifiers.js`（`OrganizationId`/`ProjectId`）、`../common/section.js`（`sectionResult`/`sectionStatus`）、`../common/authorization.js`（`allowedActions`）、`../common/navigation.js`（`navigationTargets`）、`@aurora/event-schema`（`RequestMethod`/`RequestOutcome` 类型与公共常量）。
- Produces: `OPERATION_ID_LIST_REQUEST_ENDPOINTS`、`requestsListEndpointsPathParams`、`requestsListEndpointsQuery`、`requestsListEndpointsResponse`；稳定操作注册表条目（op id `requestsListEndpoints`、`authLevel: 'session'`、`method: 'GET'`、`path: '/api/platform/v1/organizations/:organizationId/projects/:projectId/requests'`、`page: 'project.requests'`、`csrf: false`、`idempotency: false`、`errorCodes: ['structural_error','authentication','authorization','not_found','rate_limited','authority_unavailable']`）。

- [ ] **Step 1: Write the failing contract test**

`packages/platform-contract/test/monitoring/request-metrics.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { obj, enum_ } from '../../src/common/schema.js';
import {
  OPERATION_ID_LIST_REQUEST_ENDPOINTS,
  requestsListEndpointsPathParams,
  requestsListEndpointsQuery,
  requestsListEndpointsResponse,
} from '../../src/monitoring/request-metrics.js';

describe('requestsListEndpoints contract', () => {
  it('pins the stable operation id', () => {
    expect(OPERATION_ID_LIST_REQUEST_ENDPOINTS).toBe('requestsListEndpoints');
  });
  it('requires organizationId and projectId path params', () => {
    // zod-compiled shape check: both keys present and non-optional.
    const schema = requestsListEndpointsPathParams.zod;
    expect(schema.safeParse({ organizationId: 'a'.repeat(36), projectId: 'b'.repeat(36) }).success).toBe(true);
    expect(schema.safeParse({ organizationId: 'a'.repeat(36) }).success).toBe(false);
  });
  it('pins query shape: required timeRange, optional cursor, defaulted limit', () => {
    const schema = requestsListEndpointsQuery.zod;
    const ok = schema.safeParse({
      timeRange: { start: '2026-08-01T00:00:00.000Z', end: '2026-08-02T00:00:00.000Z' },
      limit: 50,
    });
    expect(ok.success).toBe(true);
    const missingRange = schema.safeParse({ limit: 50 });
    expect(missingRange.success).toBe(false);
  });
  it('pins the response as a queryResponse with summary/endpoints/percentiles sections', () => {
    // zod types must be structurally present (parses a valid projection)
    const schema = requestsListEndpointsResponse.zod;
    const valid = schema.safeParse({
      data: {
        summary: { status: 'empty', reason: 'no request data in window' },
        endpoints: { status: 'empty', reason: 'no samples in window' },
        percentiles: { status: 'unavailable', reason: 'percentiles deferred (ADR-020)' },
      },
      meta: {
        requestId: 'req_' + '1'.repeat(20),
        readAt: '2026-08-02T00:00:00.000Z',
        normalizedQuery: { timeRange: '2026-08-01T00:00:00.000Z..2026-08-02T00:00:00.000Z' },
      },
      allowedActions: ['read'],
      navigationTargets: [{ routeId: 'project.requests', pathParams: { organizationId: 'o', projectId: 'p' }, query: {} }],
    });
    expect(valid.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aurora/platform-contract test -- test/monitoring/request-metrics.test.ts`
Expected: FAIL — `Cannot find module '../../src/monitoring/request-metrics.js'`.

- [ ] **Step 3: Write minimal contract module**

Create `packages/platform-contract/src/monitoring/request-metrics.ts`:

```ts
import { arr, bool, num, obj, optional, str } from '../common/schema.js';
import { queryResponse } from '../common/query.js';
import { pageResult } from '../common/pagination.js';
import { timeRange, utcTimestamp } from '../common/time.js';
import { OrganizationId, ProjectId } from '../common/identifiers.js';
import { sectionResult } from '../common/section.js';

export const OPERATION_ID_LIST_REQUEST_ENDPOINTS = 'requestsListEndpoints' as const;

export const requestsListEndpointsPathParams = obj({
  organizationId: OrganizationId,
  projectId: ProjectId,
});

export const requestsListEndpointsQuery = obj({
  timeRange,
  cursor: optional(str(1, 512)),
  limit: optional(num(1, 100)),
});

const methodAggregate = obj({
  method: str(1, 16),
  observedCount: num(0),
  failureCount: num(0),
  slowCount: num(0),
  durationSumMs: num(0),
  durationMaxMs: num(0),
  outcomes: arr(obj({ outcome: str(1, 32), count: num(0) }), 0, 16),
});

const requestAggregateSummary = obj({
  methods: arr(methodAggregate, 0, 100),
  dataThrough: optional(utcTimestamp),
  isPartial: bool(),
});

const requestEndpointSummary = obj({
  endpointId: str(1, 64),
  method: str(1, 16),
  url: str(1, 2048),
  sampleCount: num(0),
  outcomeCounts: arr(obj({ outcome: str(1, 32), count: num(0) }), 0, 16),
  dataThrough: optional(utcTimestamp),
  isPartial: bool(),
  completeness: obj({ source: str(1, 32), bounded: bool() }),
});

export const requestsListEndpointsResponse = queryResponse(
  obj({
    summary: sectionResult(requestAggregateSummary),
    endpoints: sectionResult(pageResult(requestEndpointSummary)),
    percentiles: sectionResult(obj({})),
  }),
);
```

> **实现注意（实现者必读）：** `bool()` 是 `schema.js` 的布尔原语；`utcTimestamp` 用于时间戳；`pageResult` 内嵌 `items`/`pagination`。`queryResponse` 已包含 `meta`/`allowedActions`/`navigationTargets`，**不要**在 data 中重复。契约不 import `allowedActions`/`navigationTargets`（由 `queryResponse` 内部引用）。

在 `registry/operations.ts`：
- 顶部 import `OPERATION_ID_LIST_REQUEST_ENDPOINTS` 与三个 schema；
- 在稳定操作数组 `OPERATIONS`（含 `auditListSecurityAudit` 的操作数组）末尾追加 operation 定义（authLevel `'session'`、GET、上述 path、`page: 'project.requests'`、`tags: ['monitoring', 'requests']`、errorCodes 数组）；
- 从 `BLOCKED_OPERATIONS` 数组删除 `requestsListEndpoints` 条目。

在 `packages/platform-contract/src/index.ts` 追加导出：操作常量 + pathParams/query/response。

- [ ] **Step 4: Run contract test to verify it passes**

Run: `pnpm --filter @aurora/platform-contract test -- test/monitoring/request-metrics.test.ts`
Expected: PASS.

- [ ] **Step 5: Regenerate OpenAPI + drift gate**

Run:
```
pnpm platform-contract:generate
pnpm openapi:platform:lint
pnpm --filter @aurora/platform-contract-drift test
```
Expected: yaml/manifest regenerated with `requestsListEndpoints` moved from blocked → stable; lint + drift PASS. If drift reports `requestsListEndpoints` still blocked or schema mismatch, fix the registry/schema until PASS.

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm --filter @aurora/platform-contract typecheck && git diff --check`
Expected: PASS. Then:
```bash
git add packages/platform-contract/src/monitoring/request-metrics.ts packages/platform-contract/test/monitoring/request-metrics.test.ts packages/platform-contract/src/registry/operations.ts packages/platform-contract/src/index.ts docs/api/platform-openapi-v1.yaml docs/api/platform-openapi-v1.manifest.json
git commit -m "feat(contract): unblock requestsListEndpoints request metric query operation (DAT-16)"
```

---

### Task 2: Query repositories over request metric + sample stores

**Files:**
- Create: `packages/processing-store/src/request-metric-query-types.ts`
- Create: `packages/processing-store/src/request-metric-query-repository.ts`
- Modify: `packages/processing-store/src/index.ts`（导出查询 API）
- Test: `packages/processing-store/test/request-metric-query.unit.test.ts`、`packages/processing-store/test/request-metric-query.integration.test.ts`

**Interfaces:**
- Consumes: `request_metric_buckets`/`request_event_samples` 表结构（只读）、`@aurora/event-schema` 的 `RequestMethod`/`RequestOutcome` 常量、`pg` `Pool`、现有 `ProcessingStoreError`。
- Produces（包根导出）：
  - `queryRequestMetricSummary(pool, { projectId, startIso, endIso }) → Promise<{ methods: MethodAggregate[]; dataThrough: string | null }>`
  - `queryRequestEndpointPage(pool, { projectId, startIso, endIso, cursor?, limit }) → Promise<{ items: RequestEndpointSummary[]; nextCursor: string | null; totalCount: number }>`
  - 类型：`MethodAggregate`（`method: RequestMethod`、`observedCount`/`failureCount`/`slowCount`: number、`durationSumMs`/`durationMaxMs`: number、`outcomes: { outcome: RequestOutcome; count: number }[]`）、`RequestEndpointSummary`（`endpointId`、`method`、`url`、`sampleCount`、`outcomeCounts`、`dataThrough: string | null`、`isPartial: true`、`completeness: { source: 'diagnostic_samples'; bounded: true }`）。

- [ ] **Step 1: Write the failing unit test**

`packages/processing-store/test/request-metric-query.unit.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { encodeEndpointCursor, decodeEndpointCursor, endpointIdOf } from '../src/request-metric-query-repository.js';

describe('request metric query helpers', () => {
  it('endpointIdOf is a deterministic 64-char hex id', () => {
    const a = endpointIdOf('GET', 'https://api.example.test/orders');
    const b = endpointIdOf('GET', 'https://api.example.test/orders');
    const c = endpointIdOf('POST', 'https://api.example.test/orders');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
  it('cursor round-trips method+url keyset', () => {
    const cursor = encodeEndpointCursor('GET', 'https://api.example.test/orders');
    const decoded = decodeEndpointCursor(cursor);
    expect(decoded).toEqual({ method: 'GET', url: 'https://api.example.test/orders' });
  });
  it('decodeEndpointCursor rejects malformed input with ProcessingStoreError invalid_input', () => {
    expect(() => decodeEndpointCursor('!!!not-base64url!!!')).toThrow();
  });
});
```

- [ ] **Step 2: Run unit test to verify it fails**

Run: `pnpm --filter @aurora/processing-store test -- test/request-metric-query.unit.test.ts`
Expected: FAIL — module/function missing.

- [ ] **Step 3: Minimal implementation (types + helpers + repositories)**

`request-metric-query-types.ts`（类型 + 稳定输入）与 `request-metric-query-repository.ts` 关键实现：

```ts
// request-metric-query-repository.ts
import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { RequestMethod, RequestOutcome } from '@aurora/event-schema';
import { ProcessingStoreError } from './errors.js';
import type {
  MethodAggregate, RequestEndpointSummary, RequestEndpointPage, RequestMetricQueryWindow,
} from './request-metric-query-types.js';

export function endpointIdOf(method: string, url: string): string {
  return createHash('sha256').update(`${method}\n${url}`).digest('hex');
}

export function encodeEndpointCursor(method: string, url: string): string {
  return Buffer.from(`${method}\n${url}`, 'utf8').toString('base64url');
}

export function decodeEndpointCursor(cursor: string): { method: string; url: string } {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const sep = decoded.indexOf('\n');
    if (sep <= 0) throw new Error('malformed');
    return { method: decoded.slice(0, sep), url: decoded.slice(sep + 1) };
  } catch {
    throw new ProcessingStoreError('invalid_input', 'malformed endpoint cursor');
  }
}

export async function queryRequestMetricSummary(
  pool: Pool,
  input: RequestMetricQueryWindow,
): Promise<{ methods: MethodAggregate[]; dataThrough: string | null }> {
  const rows = await pool.query<{
    method: string; observed: string; failures: string; slow: string;
    sum_ms: string; max_ms: string; outcome: string; outcome_count: string;
  }>(
    `SELECT method, outcome, status_code,
            SUM(observed_count)::bigint AS observed,
            SUM(failure_count)::bigint AS failures,
            SUM(slow_count)::bigint AS slow,
            SUM(duration_sum_ms) AS sum_ms,
            MAX(duration_max_ms) AS max_ms,
            COUNT(*) FILTER (WHERE outcome_count > 0) AS _ignored
     FROM request_metric_buckets
     WHERE project_id = $1 AND bucket_start >= $2 AND bucket_start < $3
     GROUP BY method, outcome, status_code`,
    [input.projectId, input.startIso, input.endIso],
  );
  // 组装：按 method 分组，outcomes 汇总，duration 用 Number()
  const byMethod = new Map<string, MethodAggregate>();
  for (const row of rows.rows) {
    // ...（实现者按类型组装，确保失败/慢/观测为聚合和；outcome 来自 event-schema 常量校验）
  }
  const dataThroughRow = await pool.query<{ d: string }>(
    `SELECT MAX(updated_at)::text AS d FROM request_metric_buckets
     WHERE project_id = $1 AND bucket_start >= $2 AND bucket_start < $3`,
    [input.projectId, input.startIso, input.endIso],
  );
  const dataThrough = dataThroughRow.rows[0]?.d ?? null;
  return { methods: [...byMethod.values()], dataThrough };
}

export async function queryRequestEndpointPage(
  pool: Pool,
  input: RequestMetricQueryWindow & { cursor?: string; limit: number },
): Promise<RequestEndpointPage> {
  const decoded = input.cursor === undefined ? null : decodeEndpointCursor(input.cursor);
  const params: unknown[] = [input.projectId, input.startIso, input.endIso, input.limit + 1];
  let keyset = '';
  if (decoded !== null) {
    keyset = `AND (sample_body->>'method', sample_body->>'url') > ($4, $5)`;
    params.splice(4, 0, decoded.method, decoded.url);
  }
  const rows = await pool.query<{
    method: string; url: string; cnt: string; outcome: string; ocnt: string; created: string;
  }>(
    `SELECT sample_body->>'method' AS method,
            sample_body->>'url' AS url,
            COUNT(*)::bigint AS cnt,
            sample_body->>'outcome' AS outcome,
            COUNT(*) FILTER (WHERE sample_body->>'outcome' = sample_body->>'outcome')::bigint AS ocnt,
            MAX(created_at)::text AS created
     FROM request_event_samples
     WHERE project_id = $1 AND occurred_at >= $2 AND occurred_at < $3 ${keyset}
     GROUP BY method, url, outcome
     ORDER BY method, url, outcome
     LIMIT $4`,
    params,
  );
  // 组装 items + totalCount = COUNT(DISTINCT method,url) + nextCursor（超过 limit 时）
  // isPartial 恒为 true；completeness 恒为 { source: 'diagnostic_samples', bounded: true }
}
```

> **实现注意：** 以上是结构与关键 SQL 骨架。实现者必须：(a) 按 `request-metric-query-types.ts` 完成类型与组装（观测/失败/慢为 bigint 转 number；duration 为 numeric 转 number）；(b) outcome 只接受 `RequestOutcome` 常量内的值，未知值按 `invalid_input` 稳定错误处理；(c) `totalCount` 用独立 `COUNT(DISTINCT sample_body->>'method', sample_body->>'url')` 查询；(d) `nextCursor` 在返回行数超过 `limit` 时用第 `limit` 行（不含下一批首行）编码；(e) 所有 SQL 参数化；数据库错误一律映射 `ProcessingStoreError`，不泄露内部细节。

- [ ] **Step 4: Run unit test to verify it passes**

Run: `pnpm --filter @aurora/processing-store test -- test/request-metric-query.unit.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing real-PostgreSQL integration test**

`packages/processing-store/test/request-metric-query.integration.test.ts`（使用现有 `runMigrations`/测试 DB 工具，`AURORA_TEST_DATABASE_URL`）：

```ts
// 种子：向 request_metric_buckets 插入 2 个 method（GET/POST）跨 2 个桶；
// 向 request_event_samples 插入 3 行（2 个接口、含 outcome）；
// 断言：summary.methods 聚合正确（GET observed=2、POST observed=1、duration sum/max）；
//       endpoints.items 只含窗口内有样本的接口、sampleCount 正确、isPartial=true、
//       completeness={source:'diagnostic_samples',bounded:true}；
//       totalCount=2；nextCursor 分页取第二页返回剩余 1 条；
//       空窗口 → summary.methods=[]、endpoints.items=[]；
//       project isolation：另一 projectId → 无数据。
```

- [ ] **Step 6: Run integration test to verify it fails then passes**

Run: `pnpm --filter @aurora/processing-store test -- test/request-metric-query.integration.test.ts`
Expected: FAIL（表/函数未接）→ 完成后 PASS（实现已在 Step 3 完成，此处补种子与断言验证）。若失败为真实逻辑错误，用 `systematic-debugging` 修复至 PASS。

- [ ] **Step 7: Typecheck + commit**

Run: `pnpm --filter @aurora/processing-store typecheck && git diff --check`
Expected: PASS.
```bash
git add packages/processing-store/src/request-metric-query-types.ts packages/processing-store/src/request-metric-query-repository.ts packages/processing-store/src/index.ts packages/processing-store/test/request-metric-query.unit.test.ts packages/processing-store/test/request-metric-query.integration.test.ts
git commit -m "feat(processing-store): request metric query repositories over buckets + samples (DAT-16)"
```

---

### Task 3: Project access check + platform-api query handler

**Files:**
- Modify: `packages/platform-project-governance/src/repositories/projects.ts`（新增只读 `checkProjectAccess`）+ `packages/platform-project-governance/src/index.ts`（导出）
- Modify: `apps/platform-api/src/routes/_shared.ts`（新增 `requireProjectAccess` 守卫）
- Create: `apps/platform-api/src/routes/requests.ts`
- Modify: `apps/platform-api/src/app.ts`（注册路由）
- Test: `apps/platform-api/test/unit-pieces.test.ts`（守卫）或独立 `apps/platform-api/test/requests-query.test.ts`（集成：授权 + 数据）

**Interfaces:**
- Consumes: Task 1 契约 schema 与 op id；Task 2 查询仓库；`effectivePermissions`/`requireSession`/`requireUuidParams`/`orgNavigation`；`@aurora/platform-project-governance` 新增 `checkProjectAccess`。
- Produces（handler）：`handleListRequestEndpoints(request, reply, deps)`；`requireProjectAccess(permissions, accountId, organizationId, projectId, deps, reply, requestId): Promise<boolean>`（返回 `false` 时已发送 403/404/503）。

- [ ] **Step 1: Write the failing data-layer test**

`packages/platform-project-governance/test/.../project-access.integration.test.ts`（真实 PG）：

```ts
// 种子：org + project + 一个 project_member（account A）+ 非成员 account B；
// 断言：org manager（owner）→ allowed（不看 project_members）；
//       项目成员 A → allowed；
//       非成员 B（但 org member）→ forbidden；
//       项目不存在 / 项目 org 不匹配 → not_found。
export async function checkProjectAccess(
  pool: Pool,
  input: { organizationId: string; projectId: string; accountId: string },
): Promise<{ outcome: 'allowed' } | { outcome: 'forbidden' } | { outcome: 'not_found' }>
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aurora/platform-project-governance test`
Expected: FAIL — `checkProjectAccess` 未导出。

- [ ] **Step 3: Minimal implementation**

在 `projects.ts` 增加：

```ts
export async function checkProjectAccess(
  pool: Pool,
  input: { organizationId: string; projectId: string; accountId: string },
): Promise<{ outcome: 'allowed' } | { outcome: 'forbidden' } | { outcome: 'not_found' }> {
  const project = await pool.query<{ org_id: string }>(
    'SELECT org_id FROM projects WHERE id = $1',
    [input.projectId],
  );
  const row = project.rows[0];
  if (row === undefined || row.org_id !== input.organizationId) return { outcome: 'not_found' };
  const membership = await pool.query<{ account_id: string }>(
    'SELECT account_id FROM project_members WHERE project_id = $1 AND account_id = $2',
    [input.projectId, input.accountId],
  );
  return membership.rows[0] === undefined ? { outcome: 'forbidden' } : { outcome: 'allowed' };
}
```

在 `_shared.ts` 增加 `requireProjectAccess`（org manager 直接通过；非 manager 调 `checkProjectAccess`；`not_found` → 404，`forbidden` → 403）：

```ts
export async function requireProjectAccess(
  permissions: EffectivePermissions,
  accountId: string,
  organizationId: string,
  projectId: string,
  deps: PlatformApiRouteDependencies,
  reply: FastifyReply,
  requestId: string,
): Promise<boolean> {
  if (permissions.isOrgManager) return true;
  let result;
  try {
    result = await checkProjectAccess(deps.pool, { organizationId, projectId, accountId });
  } catch (error) {
    if (await sendMappedError(reply, requestId, error)) return false;
    throw error;
  }
  if (result.outcome === 'not_found') {
    await sendProblem(reply, requestId, 404, 'not_found', 'Project not found.');
    return false;
  }
  if (result.outcome === 'forbidden') {
    await sendProblem(reply, requestId, 403, 'authorization', 'You do not have permission to view this project.');
    return false;
  }
  return true;
}
```

在 `routes/requests.ts` 实现 `handleListRequestEndpoints`（遵循 audit 查询模式：parseInput → requireUuidParams → requireSession → effectivePermissions → requireProjectAccess → 调两个查询仓库 → 组装 `summary`（`methods.length===0 → {status:'empty'}`；否则 `{status:'available', data:{methods, dataThrough, isPartial: dataThrough!==null && dataThrough<end}}`）、`endpoints`（`items.length===0 → empty`；否则 available + pageResult）、`percentiles`（恒 `{status:'unavailable', reason:'percentiles deferred (ADR-020)'}`）→ serializeOutput）。

在 `app.ts` 注册 `GET` 路由 `'/api/platform/v1/organizations/:organizationId/projects/:projectId/requests'`。

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter @aurora/platform-project-governance test`（数据层）与 `pnpm --filter @aurora/console --if-present test` 不跑；改为：
`pnpm --filter @aurora/platform-api test -- test/requests-query.test.ts`
Expected: PASS（授权三态 + handler 组装 + 隐私负例）。

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @aurora/platform-api typecheck && pnpm --filter @aurora/platform-project-governance typecheck && git diff --check`
Expected: PASS.
```bash
git add packages/platform-project-governance/src/repositories/projects.ts packages/platform-project-governance/src/index.ts packages/platform-project-governance/test apps/platform-api/src/routes/_shared.ts apps/platform-api/src/routes/requests.ts apps/platform-api/src/app.ts apps/platform-api/test/requests-query.test.ts
git commit -m "feat(platform-api): requestsListEndpoints handler with project-scoped authorization (DAT-16)"
```

---

### Task 4: Contract integration, verification + docs

**Files:**
- Modify: `packages/platform-contract/README.md`（操作清单）、`packages/processing-store/README.md`（查询能力）、`apps/platform-api/README.md`（路由）
- Modify: `docs/architecture/request-metric-query-projection.md`（`implementation-status: implemented`、证据）
- Test: 复用已生成契约（`pnpm --filter @aurora/platform-contract test:package`）+ 全仓受影响验证

**Interfaces:**
- Consumes: Task 1-3 全部产出。
- Produces: 更新后的规格状态与 README；`pnpm openapi:check` 全绿证据。

- [ ] **Step 1: Package-entry + generated contract integration test**

Run:
```
pnpm --filter @aurora/platform-contract build && pnpm --filter @aurora/platform-contract test:package
pnpm platform-contract:generate && pnpm openapi:platform:lint && pnpm --filter @aurora/platform-contract-drift test
```
Expected: PASS — 生成 client/server 适配器包含 `requestsListEndpoints`，包入口导出无 `ERR_PACKAGE_PATH_NOT_EXPORTED`。

- [ ] **Step 2: Affected-verification sweep**

Run:
```
pnpm --filter @aurora/processing-store test
pnpm --filter @aurora/platform-api typecheck
pnpm --filter @aurora/processing-store typecheck
pnpm --filter @aurora/platform-contract typecheck
git diff --check
```
Expected: 全 PASS（新增单元/集成测试计入；不跑 Browser、Console、root coverage、ingestion 全套）。

- [ ] **Step 3: Update docs**

- `docs/architecture/request-metric-query-projection.md`：`implementation-status: in-progress → implemented`，在 §1 记录独立验收证据（测试数、命令、结果）。
- 三个 README 各加一行能力说明。
- 同步 `AGENTS.md`/`AURORA_RULES.md` 的 G02/DAT-16 状态行（`requestsListEndpoints` 从 blocked → stable；leaf 43→44 / 35→34）。

- [ ] **Step 4: Commit**

```bash
git add docs/architecture/request-metric-query-projection.md packages/platform-contract/README.md packages/processing-store/README.md apps/platform-api/README.md AGENTS.md AURORA_RULES.md
git commit -m "docs: DAT-16 request metric query implemented + close leaf 43->44 / 35->34"
```

---

## Plan Self-Review

- **approved spec coverage**：规格 §5 契约、§6 授权、§7 结构、§9 测试全部映射到 Task 1-4；无遗漏。
- **file reality**：所有文件路径与现有仓库结构一致（`platform-contract/src/monitoring/` 新建、`processing-store/src/` 已有模式、`platform-api/src/routes/` 已有模式）。
- **no placeholder**：SQL 骨架与组装步骤显式；`_ignored` 列占位已在注释中说明由实现者按类型消除；无 TBD/TODO。
- **API/Schema consistency**：`queryResponse`/`pageResult`/`sectionResult`/`utcTimestamp`/`OrganizationId`/`ProjectId` 均为既有导出；操作 path 与 RouteTarget `project.requests` 一致。
- **authorization**：项目级查看权限三态（allowed/forbidden/not_found）+ org manager 豁免 + 无权限不查数据。
- **privacy**：不返回 body/cookie/auth/完整 query 原文；url 为协议安全投影。
- **SQL/query semantics**：窗口 = `bucket_start`/`occurred_at` 半开区间 `[start, end)`；`dataThrough` = `MAX(updated_at)`；keyset 分页有序；`totalCount` 独立 distinct 计数。
- **no fake data**：所有字段来自真实表；percentile 恒 `unavailable`；缺失恒 `empty`。
- **no UI scope leak**：无 Console、无图表。
- **no unnecessary tests**：每 Task 1-2 targeted 测试 + 必要 typecheck/diff；不跑 Browser/全仓覆盖。
- **task count reasonable**：4 个 meaningful Task。
