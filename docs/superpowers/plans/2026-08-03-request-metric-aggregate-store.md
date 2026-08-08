# Request Metric Aggregate Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## 文件头

- 日期：2026-08-03
- 模块：`packages/processing-store`（`@aurora/processing-store`）请求指标聚合存储
- 正式规格：`docs/architecture/request-metric-aggregate-store.md`（approved）
- ADR：`docs/adr/ADR-020-idempotent-request-metric-bucket-aggregation.md`（accepted / not-started）
- 计划状态：ready-for-implementation
- 目标读者：零上下文工程师
- 权威来源：CLAUDE.md/AGENTS.md/AURORA_RULES.md 快照、approved 规格、accepted ADR-004/005/006/008/010/012/018/019/020、approved 请求事件协议契约、C5 UX 语义、既有 Error/Sample store 规格

## Goal

在 `packages/processing-store` 内实现请求指标聚合存储第一增量：`request_metric_buckets` 与 `request_metric_event_applications` 表 + Migration、`persistRequestMetricContribution` Repository（UTC 一分钟桶 + 最小事件应用登记 + 同事务 UPSERT + `(project_id, event_id)` 幂等）、五指标字段、稳定结果。**不**实现 Request Processor、样本选择、isFailure/isSlow 分类、percentile、采样外推、Query、Performance、路由、production composition root、数据删除任务。

## Architecture

```
packages/processing-store/
  src/
    request-metric-types.ts          # 输入/结果联合类型 + 私有 BucketParams
    request-metric-contribution.ts   # 顶层 unknown 输入解析 + UTC 分钟桶算法 + 校验
    request-metric-repository.ts     # persistRequestMetricContribution 同事务持久化
    index.ts                         # 追加导出（编辑）
  migrations/
    1722500000005_request-metric-aggregation.ts   # 追加 Migration（编辑目录）
  test/
    request-metric-contribution.test.ts  # 输入解析 + 桶算法单测
    request-metric-repository.test.ts    # 同事务持久化/错误映射单测
    package-entry.test.ts            # 追加 request metric 导出断言（编辑）
    security-negative.test.ts        # 追加请求明细/敏感负例（编辑）
    integration/
      migrations.test.ts             # 追加两表断言（编辑）
      request-metric.test.ts         # 真实 PostgreSQL 17.10 集成
  README.md                          # 追加请求指标能力（编辑）
```

依赖方向：`request-metric-repository.ts` → `request-metric-contribution.ts` → `@aurora/event-schema` 包根 + `request-metric-types.ts`。`aurora.layer: data`，允许 `data → {protocol}`。

## Tech Stack

- TypeScript 6.0.3（strict，NodeNext，ES2024，verbatimModuleSyntax）
- `pg` 8.22.0（生产）；`node-pg-migrate` 9.0.0、`@vitest/coverage-v8` 4.1.10（开发）
- `@aurora/event-schema`（workspace:* 开发依赖，vitest alias 指向 src/index.ts；`RequestMethod`/`RequestOutcome`）
- vitest 4.1.10；真实 PostgreSQL 17（集成测试，`AURORA_TEST_DATABASE_URL`）

## Global Constraints

- 只实现请求指标聚合存储；不实现 Request Processor/样本选择/isFailure/isSlow 分类/percentile/采样外推/Query/Performance/路由/删除任务；
- 不硬编码慢请求阈值（3000ms）、HTTP 429、HTTP 500—599 或额外状态码；
- `isFailure`/`isSlow` 由调用方显式提供，Store 只校验类型；
- 只从 `@aurora/event-schema` 包根导入；不访问 `src`/`internal`；
- 事件应用登记只存 project_id/event_id/applied_at；聚合桶只存低基数维度 + 计数/求和/最大值；
- 不保存请求明细/正文/Header/Cookie/Authorization/敏感查询/完整 URL/DOM/文本/IP/指纹；
- `(project_id, event_id)` 事件应用唯一幂等；同事务 `ON CONFLICT DO NOTHING` + 桶 `ON CONFLICT DO UPDATE`；禁止先查后插；
- `bucket_start = occurredAt 向下取整到 UTC 分钟`；`statusCode` 缺省映射 0 哨兵；
- SQL 全参数化；不暴露 SQLSTATE/约束名/SQL；稳定结果不通过正常控制流抛异常；
- 不写日志；不访问 `process.env`；不使用 `Math.random`；
- 不修改 `error_event_occurrences`/`request_event_samples`/`persistErrorEventOccurrence`/`persistRequestEventSample`/Error processor/request-event-contract/ingestion-api/Worker；
- 不 `git add`/`commit`/`push`/`stash`/`reset`/`rebase`/`clean`。

## 文件树（完整）

```
packages/processing-store/src/request-metric-types.ts
packages/processing-store/src/request-metric-contribution.ts
packages/processing-store/src/request-metric-repository.ts
packages/processing-store/src/index.ts   # 追加导出（编辑）
packages/processing-store/migrations/1722500000005_request-metric-aggregation.ts
packages/processing-store/test/request-metric-contribution.test.ts
packages/processing-store/test/request-metric-repository.test.ts
packages/processing-store/test/package-entry.test.ts   # 追加断言（编辑）
packages/processing-store/test/security-negative.test.ts   # 追加负例（编辑）
packages/processing-store/test/integration/migrations.test.ts   # 追加断言（编辑）
packages/processing-store/test/integration/request-metric.test.ts
packages/processing-store/README.md   # 追加请求指标能力（编辑）
```

## 每个文件单一职责

- `request-metric-types.ts`：`RequestMetricContributionInput`、`PersistRequestMetricContributionResult` 联合类型、私有 `RequestMetricBucketParams`。
- `request-metric-contribution.ts`：`parseRequestMetricContributionInput(input: unknown)` 顶层校验 + `computeBucketStart(occurredAt: number): Date` UTC 分钟桶算法。
- `request-metric-repository.ts`：`persistRequestMetricContribution(pool, input)` 同事务内应用登记 + 桶 UPSERT。
- `1722500000005_request-metric-aggregation.ts`：`request_metric_buckets` + `request_metric_event_applications` 表 + 约束 + up/down。
- 集成测试：`request-metric.test.ts`（真实 PG）、`migrations.test.ts`（两表/约束/down/up）。

## 关键设计决策

1. **API 形态**：`persistRequestMetricContribution(pool, input)` 接受 `Pool`。`input` 为 `unknown`，内部 `parseRequestMetricContributionInput` 校验后生成 `RequestMetricBucketParams`。
2. **桶算法**：`computeBucketStart(occurredAt) = new Date(Math.floor(occurredAt / 60000) * 60000)`。
3. **statusCode 哨兵**：缺省 `statusCode` → `0`；存在则校验 `100..599` 安全整数。
4. **同事务**：`BEGIN` → 应用登记 `ON CONFLICT DO NOTHING RETURNING project_id` → rows.length===0 ⇒ duplicate（跳过桶更新，COMMIT）；否则桶 UPSERT `ON CONFLICT DO UPDATE` → COMMIT。任一步失败 ROLLBACK。
5. **指标字段**：`observed_count +1`、`failure_count + CASE WHEN isFailure`、`slow_count + CASE WHEN isSlow`、`duration_sum_ms + $durationMs`、`duration_max_ms = GREATEST(...)`。
6. **错误映射**：连接/语句失败 → `temporarily_unavailable`；不泄露 SQLSTATE/约束/SQL。

## 完整 TypeScript 签名

```ts
// src/request-metric-types.ts
import type { RequestMethod, RequestOutcome } from '@aurora/event-schema';

export interface RequestMetricContributionInput {
  readonly projectId: string;
  readonly eventId: string;
  readonly occurredAt: number;
  readonly method: RequestMethod;
  readonly outcome: RequestOutcome;
  readonly statusCode?: number;
  readonly durationMs: number;
  readonly isFailure: boolean;
  readonly isSlow: boolean;
}

export type PersistRequestMetricContributionResult =
  | { readonly status: 'applied' }
  | { readonly status: 'duplicate' }
  | { readonly status: 'invalid_input'; readonly code: string }
  | { readonly status: 'temporarily_unavailable' };

export interface RequestMetricBucketParams {
  readonly projectId: string;
  readonly eventId: string;
  readonly bucketStartIso: string;
  readonly method: string;
  readonly outcome: string;
  readonly statusCode: number;
  readonly durationMs: number;
  readonly isFailure: boolean;
  readonly isSlow: boolean;
}

// src/request-metric-contribution.ts（内部）
export function parseRequestMetricContributionInput(
  input: unknown,
): RequestMetricBucketParams | { readonly status: 'invalid_input'; readonly code: string };

export function computeBucketStart(occurredAt: number): Date;

// src/request-metric-repository.ts
export function persistRequestMetricContribution(
  pool: Pool,
  input: unknown,
): Promise<PersistRequestMetricContributionResult>;
```

## 每个 Task 精确路径与 TDD 闭环

### Task 1：RequestMetricContribution 输入解析与 UTC 分钟桶算法

**Consumes**：`@aurora/event-schema` 根入口（`RequestMethod`/`RequestOutcome`）。
**Produces**：`src/request-metric-types.ts`、`src/request-metric-contribution.ts`、`test/request-metric-contribution.test.ts`。

1. 失败测试：`test/request-metric-contribution.test.ts`：
   - 非对象 input → `invalid_top_level`；
   - 缺/非法 projectId/eventId → `invalid_top_level`/`invalid_project_id`/`invalid_event_id`；
   - occurredAt 非正安全整数 → `invalid_occurred_at`；
   - durationMs 负数/非安全整数 → `invalid_duration_ms`；
   - method/outcome 非法枚举 → `invalid_method`/`invalid_outcome`；
   - statusCode 非法（<100 或 >599 或非整数）→ `invalid_status_code`；
   - isFailure/isSlow 非布尔 → `invalid_boolean`；
   - `computeBucketStart`：`12:34:00.000 → 12:34:00`、`12:34:59.999 → 12:34:00`、`12:35:00.000 → 12:35:00`、`12:34:00.001 → 12:34:00`；
   - 合法输入 → 返回 `RequestMetricBucketParams`，`bucketStartIso` 正确，statusCode 缺省为 0；
   - 输入不变。
2. 预期失败：`ERR_MODULE_NOT_FOUND` / TS2307。
3. 最小实现：创建 `request-metric-types.ts` + `request-metric-contribution.ts`。
4. 确认通过：`pnpm --filter @aurora/processing-store test`。
5. 回归：`request-sample-contribution.test.ts`/`error-occurrence-input.test.ts` 不回归。
6. 提交边界：types + contribution + 单测。

### Task 2：request_metric_buckets 与 request_metric_event_applications Migration

**Consumes**：规格第 12—13 节、`1722500000004_request-event-samples.ts` 模式。
**Produces**：`migrations/1722500000005_request-metric-aggregation.ts`、`test/integration/migrations.test.ts` 追加。

1. 失败测试：`test/integration/migrations.test.ts` 追加断言两表存在、列、主键/唯一约束、CHECK、down 后消失、up/down/up；`beforeAll` 追加 DROP 两表。
2. 预期失败：`to_regclass('request_metric_buckets')` 为 null。
3. 最小实现：创建 Migration（up/down 对称）。
4. 确认通过：`pnpm --filter @aurora/processing-store test:integration`。
5. 回归：既有 migrations 断言不回归。
6. 提交边界：Migration + migrations.test 追加。

### Task 3：persistRequestMetricContribution 同事务 Repository

**Consumes**：`request-metric-contribution.ts`、`request-metric-types.ts`。
**Produces**：`src/request-metric-repository.ts`、`test/request-metric-repository.test.ts`。

1. 失败测试：`test/request-metric-repository.test.ts`（fake pool/client，模式同 `request-sample-repository.test.ts`）：
   - input 解析失败 → `invalid_input`（不执行 SQL）；
   - 首次应用 → `applied`（应用登记 INSERT 返回 1 行，桶 UPSERT 执行）；
   - duplicate → `duplicate`（应用登记返回 0 行，桶 UPSERT 不执行）；
   - 桶 UPSERT 抛错 → `temporarily_unavailable`（ROLLBACK）；
   - 不泄露 SQL/SQLSTATE/约束名；
   - 输入不变；
   - 不 `console`/`process.env`/`Math.random`。
2. 预期失败：`persistRequestMetricContribution` 未实现 → TS2307。
3. 最小实现：实现 `persistRequestMetricContribution`（同事务：应用登记 `ON CONFLICT DO NOTHING` → duplicate 跳过 → 桶 UPSERT `ON CONFLICT DO UPDATE` → COMMIT/ROLLBACK）。
4. 确认通过：`pnpm --filter @aurora/processing-store test`。
5. 回归：`request-sample-repository.test.ts`/`error-occurrence-repository.test.ts` 不回归。
6. 提交边界：repository.ts + 单测。

### Task 4：包根导出、隐私负例

**Consumes**：全部实现。
**Produces**：`src/index.ts` 追加导出、`test/package-entry.test.ts` 追加、`test/security-negative.test.ts` 追加。

1. 失败测试：
   - `package-entry.test.ts`：`persistRequestMetricContribution`/`PersistRequestMetricContributionResult` 从包根导出；私有路径 `@aurora/processing-store/request-metric-repository` 等以 `ERR_PACKAGE_PATH_NOT_EXPORTED` 拒绝；
   - `security-negative.test.ts`：src 不含 `requestBody`/`responseBody`/`requestHeader`/`responseHeader`/`X-Aurora-Client-Key`/`Authorization`/`cookie`/`password`/`SQLSTATE`/`postgres://`/`console.`/`process.env`/`Math.random`；不含 `+ ${` 字符串拼接 SQL；metric 源码不引用 `sampleBody`/`envelope.body`。
2. 预期失败：导出缺失 / 负例命中。
3. 最小实现：`index.ts` 导出；确认负例通过。
4. 确认通过：`pnpm --filter @aurora/processing-store test`、`test:package`、`pnpm check:boundaries`。
5. 回归：`pnpm --filter @aurora/event-schema test`。
6. 提交边界：index.ts + 负例。

### Task 5：真实 PostgreSQL 17.10 集成测试

**Consumes**：全部实现 + `test/integration/helpers.ts`。
**Produces**：`test/integration/request-metric.test.ts`。

1. 失败测试：
   - 空库跑 Migration → 两表存在；
   - 首次贡献 → `applied`，`observed_count` +1；
   - failure → `failure_count` +1；
   - slow → `slow_count` +1；
   - 同时 failure+slow → 两项分别 +1；
   - duration → `duration_sum_ms` 累加、`duration_max_ms` 取最大值；
   - duplicate → `duplicate`，所有指标不变；
   - 并发 duplicate → 最多应用一次；
   - 两个不同 eventId 同桶 → `observed_count` +2；
   - 不同 project → 不同桶；
   - 不同 method/outcome/status_code → 不同桶；
   - 跨 UTC 分钟 → 不同桶；
   - 非法 duration/时间 → `invalid_input`，不写登记不写桶；
   - 桶更新异常 → 应用登记回滚（注入失败 store 场景或 SQL 级验证）；
   - 数据库暂时不可用 → `temporarily_unavailable`；
   - **error_event_occurrences 回归**（persistErrorEventOccurrence 不变）；
   - **request_event_samples 回归**（persistRequestEventSample 不变）；
   - Schema/Pool 完整清理。
2. 预期失败：Repository/表未实现 → 失败。
3. 最小实现：写集成测试。
4. 确认通过：`pnpm --filter @aurora/processing-store test:integration`。
5. 回归：既有 `request-sample.test.ts`/`error-occurrence.test.ts` 集成测试。
6. 提交边界：集成测试文件。

### Task 6：README、文档、覆盖率与状态同步

**Consumes**：全部实现。
**Produces**：`README.md` 追加、规格 `implementation-status: implemented`、ADR-020 追加实施证据、`docs/README.md`、`docs/architecture/formalization-readiness.md`、`AGENTS.md`、`AURORA_RULES.md` 状态同步。

1. 失败测试：无新代码测试；执行 `pnpm --filter @aurora/processing-store test:coverage`（85/80/85/85）。
2. 最小实现：README；规格/ADR/文档/入口状态同步。
3. 确认通过：`pnpm --filter @aurora/processing-store test:coverage`、全仓门禁（见 CLI）。
4. 回归：全仓。
5. 提交边界：README + 文档 + 状态同步。

## CLI / 命令

```text
cd D:/Develop/SDK/Aurora
pnpm install --frozen-lockfile
pnpm --filter @aurora/processing-store typecheck
pnpm --filter @aurora/processing-store test
pnpm --filter @aurora/processing-store test:integration
pnpm --filter @aurora/processing-store test:coverage
pnpm --filter @aurora/processing-store test:package
pnpm --filter @aurora/processing-store build
pnpm check:boundaries
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm build
pnpm check:ci
pnpm openapi:check
pnpm benchmark:ingestion:smoke
git diff --check
```

## 预期结果

- `@aurora/processing-store` 单元测试全绿（含 request metric）；
- 真实 PostgreSQL 17.10 集成测试全绿（首次/duplicate/并发/桶/回归/Migration up/down/up）；
- 覆盖率 85/80/85/85；
- 全仓门禁 exit 0；benchmark smoke exit 0；OpenAPI 无变化；
- 回归：event-schema/Error store/Request Sample store/ingestion-worker/ingestion-api 全绿。

## 建议提交边界

- Commit 1：Task 1（types/contribution/单测）。
- Commit 2：Task 2（Migration + 集成基建）。
- Commit 3：Task 3（repository/单测）。
- Commit 4：Task 4（index/负例）。
- Commit 5：Task 5（真实 PG 集成）。
- Commit 6：Task 6（README/文档/状态同步）。

（本轮不实际执行 Git 提交；以上仅为逻辑边界。）

## 禁止

- TODO/TBD/伪代码/模糊占位/未定义类型/实现 Request Processor 或样本选择或 isFailure/isSlow 分类/percentile/采样外推/Query/把指标桶描述为逐请求日志/硬编码慢请求阈值/保存请求明细/请求体/响应体/Header/Cookie/Authorization/敏感查询/完整 URL/修改 request-event-contract/修改 Error store/修改 Sample store/修改 Worker/修改 POST /v1/batches/git add/commit/push/stash/reset/rebase/clean。
