# DAT-08 Performance Aggregate and Bounded Sample Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `packages/processing-store`（`@aurora/processing-store`）实现 DAT-08 性能指标聚合与有限诊断样本存储第一增量：`performance_metric_buckets`/`performance_metric_event_applications`/`performance_event_samples` 三张表、Migration、`persistPerformanceMetricContribution`/`persistPerformanceEventSample` 两个 Repository，作为 accepted ADR-021 的物理实施。

**Architecture:** 扩展现有 `@aurora/processing-store`（`aurora.layer: data`）。聚合主路径：UTC 一分钟桶 `performance_metric_buckets`（唯一键 `(project_id, bucket_start, metric_name, unit)`，统计量 `observed_count`/`value_sum`/`value_max` 用 `numeric`）+ 最小事件应用登记 `performance_metric_event_applications`（`(project_id, event_id)` PK，同事务 `ON CONFLICT DO NOTHING` → duplicate 跳过 → 首次 `UPSERT` 桶 → COMMIT）。有限样本：`performance_event_samples`（`(project_id, event_id)` 唯一，受协议约束 `sample_body` jsonb 白名单投影，`ON CONFLICT DO NOTHING`）。两个 Repository 独立事务，无跨 Store 事务；`(project_id, event_id)` 幂等；稳定结果 `invalid_input`/`temporarily_unavailable`/`applied`/`duplicate`/`inserted`。

**Tech Stack:** PostgreSQL 17、`pg` 8.22.0、`node-pg-migrate` 9.0.0、TypeScript strict（`exactOptionalPropertyTypes`/`noUncheckedIndexedAccess`）、Vitest 4、`@aurora/event-schema` 包根（`PerformanceMetricName`/`PerformanceMetricUnit`/`PERFORMANCE_EVENT_LIMITS`/`parsePerformanceEventEnvelope`）。

**本计划关闭叶子模块：DAT-08**
**本计划关闭叶子数量：1**
**成功完成后的 remaining_v1_leaf_modules：44**

## Global Constraints

- PostgreSQL 17 + `pg` + `node-pg-migrate` + SQL-first（accepted ADR-010）；禁止 ORM/Query Builder；Migration 追加式；
- 不修改 `@aurora/event-schema`、`@aurora/ingestion-inbox`、`apps/ingestion-worker`、`apps/ingestion-api`、OpenAPI、既有 Migration（`1722500000003`—`1722500000005`）；
- 扩展现有 `@aurora/processing-store`，不新建包；`package.json` 不新增运行时依赖（`pg` 已存在；`@aurora/event-schema` 为 devDependency）；
- 聚合唯一键 `(project_id, bucket_start, metric_name, unit)`；统计量 `observed_count`/`value_sum`/`value_max`（`numeric`）；`(project_id, event_id)` 幂等；
- 样本白名单投影 `(metricName/value/unit/startedAt/可选 durationMs)`；不存完整信封/页面/环境/发布字段/URL/DOM/用户信息；
- percentile/直方图/超标比例原材料、采样率执行、页面/环境/发布维度、DAT-09 Processor、DAT-17 Query、平台 UI、新基础设施均不实现；
- 严格 TypeScript、参数化 SQL、稳定结果、不暴露 SQLSTATE/约束名/SQL、敏感信息不入日志；
- 真实 PostgreSQL 17 集成测试（`AURORA_TEST_DATABASE_URL`，目标必须是 `aurora_inbox_test`）；禁止 SQLite/mock/PGlite 证明数据库约束；
- 覆盖率门槛 lines ≥ 85%、branches ≥ 80%、functions ≥ 85%、statements ≥ 85%；不删除或弱化失败测试；
- 本计划执行实际**不执行 `git add`/`commit`/`push`**；Commit 步骤只作为逻辑提交边界保留。

## 固定回读与权威边界

| Module ID | 完整回读文件 | 重点章节 | 本计划不得改变的业务逻辑 | 缺失门禁 |
| --- | --- | --- | --- | --- |
| DAT-08 | `Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md`；`Aurora 架构规范.md`；`docs/architecture/system-overview.md`；`Aurora 代码规范.md`；`Aurora 测试规范.md`；`Aurora ADR 规范.md`；`Aurora 文档规范.md`；`docs/protocol/performance-event-contract.md`；`docs/architecture/error-event-occurrence-processing-store.md`；`docs/architecture/request-event-sample-processing-store.md`；`docs/architecture/request-metric-aggregate-store.md`；`docs/architecture/performance-metric-aggregate-and-bounded-sample-store.md`；`docs/adr/ADR-010-postgresql-access-and-migration-tooling.md`；`docs/adr/ADR-018-error-event-occurrence-processing-storage.md`；`docs/adr/ADR-019-request-event-aggregation-and-bounded-diagnostic-sample-storage.md`；`docs/adr/ADR-020-idempotent-request-metric-bucket-aggregation.md`；`docs/adr/ADR-021-performance-aggregate-and-bounded-sample-storage.md`；`docs/architecture/formalization-readiness.md`；`docs/adr/README.md`；`docs/superpowers/specs/2026-07-27-aurora-frontend-ux-ui-design.md`（§7.21） | PRD §5.1.9、§12、§14—16；Performance Contract §4—10、§17—18；ADR-021 决定细节 1—19；DAT-08 规格 §1—57；C6 UX §7.21 | 四项性能指标（lcp/inp/cls/page_load）、聚合优先不建逐条性能历史、有界安全样本、`(project_id, bucket_start, metric_name, unit)` 聚合键、count/sum/max 统计量、样本白名单投影、`(project_id, event_id)` 幂等、percentile/直方图 deferred、页面/环境/发布维度为契约缺口 | approved spec（`docs/architecture/performance-metric-aggregate-and-bounded-sample-store.md`）；accepted ADR-021；真实 PostgreSQL 工具链（ADR-010） |

## 文件结构映射

```text
packages/processing-store/
├── migrations/
│   └── 1722500000006_performance-aggregate-and-sample.ts   # Create：三张表 + 约束
├── src/
│   ├── performance-metric-types.ts                          # Create：贡献输入/结果/DbParams 类型
│   ├── performance-metric-contribution.ts                   # Create：computeBucketStart + parse 输入校验
│   ├── performance-metric-repository.ts                     # Create：persistPerformanceMetricContribution
│   ├── performance-sample-types.ts                          # Create：样本输入/结果/DbParams 类型
│   ├── performance-sample-input.ts                          # Create：parse 输入校验 + 白名单投影
│   ├── performance-sample-repository.ts                     # Create：persistPerformanceEventSample
│   └── index.ts                                             # Modify：追加性能导出
├── test/
│   ├── performance-metric-contribution.test.ts              # Create：桶算法/输入校验单测
│   ├── performance-metric-repository.test.ts                # Create：Repository 单测（fake pg）
│   ├── performance-sample-input.test.ts                     # Create：样本输入/白名单单测
│   ├── performance-sample-repository.test.ts                # Create：样本 Repository 单测（fake pg）
│   ├── integration/performance-metric.test.ts               # Create：真实 PG 聚合集成测试
│   ├── integration/performance-sample.test.ts               # Create：真实 PG 样本集成测试
│   ├── integration/migrations.test.ts                       # Modify：追加性能表 DROP/断言
│   ├── package-entry.test.ts                                # Modify：追加性能导出断言
│   └── security-negative.test.ts                            # Modify：追加性能源安全负例
├── README.md                                                # Modify：性能存储职责/接口
└── package.json                                             # 不修改（无新依赖）
```

### 单一职责

| 文件 | 单一职责 |
| --- | --- |
| `migrations/1722500000006_performance-aggregate-and-sample.ts` | 三张性能表 + 约束 + up/down |
| `src/performance-metric-types.ts` | `PerformanceMetricContributionInput`/`PersistPerformanceMetricContributionResult`/`PerformanceMetricBucketParams` |
| `src/performance-metric-contribution.ts` | `computeBucketStart`（UTC 分钟桶）+ `parsePerformanceMetricContributionInput`（unknown 顶层校验） |
| `src/performance-metric-repository.ts` | `persistPerformanceMetricContribution`（同事务登记→UPSERT） |
| `src/performance-sample-types.ts` | `PersistPerformanceEventSampleInput`/`PersistPerformanceEventSampleResult`/`PerformanceSampleDbParams` |
| `src/performance-sample-input.ts` | `parsePersistPerformanceEventSampleInput`（unknown 校验 + 白名单投影） |
| `src/performance-sample-repository.ts` | `persistPerformanceEventSample`（事务 INSERT ON CONFLICT） |
| `src/index.ts` | 包根公共出口（最小追加） |

## 范围与排除

**本轮范围**：三张性能表 + Migration + 两个 Repository + 单测 + 真实 PostgreSQL 集成测试 + 包根导出 + README + 正式规格/ADR 证据/formalization-readiness/remaining-module-batches 同步。

**明确排除（不在本计划实现）**：DAT-09 Performance Processor、DAT-10 Router、DAT-11 production composition、DAT-17 Query、percentile/直方图、超标比例、平台 UI、采样率执行/采样外推、页面/环境/发布维度、Issue、告警、数据保留清理任务、事件协议修改、新缓存/队列/云资源。

## Task 1：Migration 与三张表

**Files:**
- Create: `packages/processing-store/migrations/1722500000006_performance-aggregate-and-sample.ts`

**Interfaces:**
- Consumes: `node-pg-migrate` `MigrationBuilder`
- Produces: `performance_metric_buckets`、`performance_metric_event_applications`、`performance_event_samples` 表

- [x] **Step 1: 写失败测试**

在 `packages/processing-store/test/integration/migrations.test.ts` 追加（先读该文件确认既有结构）：

```ts
  it('creates the performance aggregate and sample tables', async () => {
    const metricBuckets = await queryRow<{ name: string }>(
      pool,
      `SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'performance_metric_buckets'`,
    );
    expect(metricBuckets?.name).toBe('performance_metric_buckets');
    const applications = await queryRow<{ name: string }>(
      pool,
      `SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'performance_metric_event_applications'`,
    );
    expect(applications?.name).toBe('performance_metric_event_applications');
    const samples = await queryRow<{ name: string }>(
      pool,
      `SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'performance_event_samples'`,
    );
    expect(samples?.name).toBe('performance_event_samples');
  });
```

- [x] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @aurora/processing-store test:integration -- test/integration/migrations.test.ts`
Expected: FAIL —— 性能表不存在（integration 测试需要 `AURORA_TEST_DATABASE_URL`）。

- [x] **Step 3: 写最小实现**

创建 `packages/processing-store/migrations/1722500000006_performance-aggregate-and-sample.ts`：

```ts
import type { MigrationBuilder } from 'node-pg-migrate';

export const shorthands = undefined;

/**
 * Appended migration creating the performance aggregate and bounded sample
 * store: a UTC one-minute aggregate bucket table, a minimal event-application
 * idempotency registry, and a bounded safe diagnostic sample table. The tables
 * are additive and never modify the ingestion Inbox schema, error/request
 * processing-store tables, or the performance event protocol.
 */
export const up = (pgm: MigrationBuilder): void => {
  pgm.createTable('performance_metric_buckets', {
    id: { type: 'bigserial', primaryKey: true },
    project_id: { type: 'uuid', notNull: true },
    bucket_start: { type: 'timestamptz', notNull: true },
    metric_name: { type: 'varchar(64)', notNull: true },
    unit: { type: 'varchar(16)', notNull: true },
    observed_count: { type: 'bigint', notNull: true, default: 0 },
    value_sum: { type: 'numeric', notNull: true, default: 0 },
    value_max: { type: 'numeric', notNull: true, default: 0 },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('performance_metric_buckets', 'uq_performance_metric_buckets_key', {
    unique: ['project_id', 'bucket_start', 'metric_name', 'unit'],
  });
  pgm.addConstraint('performance_metric_buckets', 'ck_performance_metric_buckets_counts', {
    check: 'observed_count >= 0 AND value_sum >= 0 AND value_max >= 0 AND value_max <= value_sum',
  });

  pgm.createTable('performance_metric_event_applications', {
    project_id: { type: 'uuid', notNull: true },
    event_id: { type: 'varchar(128)', notNull: true },
    applied_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint(
    'performance_metric_event_applications',
    'pk_performance_metric_event_applications',
    { primaryKey: ['project_id', 'event_id'] },
  );

  pgm.createTable('performance_event_samples', {
    id: { type: 'bigserial', primaryKey: true },
    project_id: { type: 'uuid', notNull: true },
    event_id: { type: 'varchar(128)', notNull: true },
    occurred_at: { type: 'timestamptz', notNull: true },
    sample_body: { type: 'jsonb', notNull: true },
  });
  pgm.addConstraint('performance_event_samples', 'uq_performance_event_samples_event', {
    unique: ['project_id', 'event_id'],
  });
  pgm.addConstraint('performance_event_samples', 'ck_performance_event_samples_body', {
    check: "jsonb_typeof(sample_body) = 'object'",
  });
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.dropTable('performance_event_samples');
  pgm.dropTable('performance_metric_event_applications');
  pgm.dropTable('performance_metric_buckets');
};
```

- [x] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @aurora/processing-store test:integration -- test/integration/migrations.test.ts`
Expected: PASS（性能表创建断言通过；既有表断言不回归）。

- [x] **Step 5: Commit 边界（不实际执行）**

```text
逻辑提交边界：feat(processing-store): performance aggregate and sample migration
实际执行：不运行 git add/commit。
```

- [x] **Step 6: 检查差异**

Run: `git diff --check`
Expected: 无输出。

## Task 2：性能指标类型与输入校验

**Files:**
- Create: `packages/processing-store/src/performance-metric-types.ts`
- Create: `packages/processing-store/src/performance-metric-contribution.ts`
- Create: `packages/processing-store/test/performance-metric-contribution.test.ts`

**Interfaces:**
- Consumes: `@aurora/event-schema` 包根（`PerformanceMetricName`/`PerformanceMetricUnit`/`PERFORMANCE_EVENT_LIMITS`）
- Produces:
  ```ts
  export interface PerformanceMetricContributionInput {
    readonly projectId: string;
    readonly eventId: string;
    readonly occurredAt: number;
    readonly metricName: PerformanceMetricName;
    readonly unit: PerformanceMetricUnit;
    readonly value: number;
    readonly startedAt: number;
    readonly durationMs?: number;
  }
  export type PersistPerformanceMetricContributionResult =
    | { readonly status: 'applied' }
    | { readonly status: 'duplicate' }
    | { readonly status: 'invalid_input'; readonly code: string }
    | { readonly status: 'temporarily_unavailable' };
  export function computeBucketStart(occurredAt: number): Date;
  export function parsePerformanceMetricContributionInput(input: unknown):
    PerformanceMetricBucketParams | { readonly status: 'invalid_input'; readonly code: string };
  ```

- [x] **Step 1: 写失败测试**

创建 `packages/processing-store/test/performance-metric-contribution.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import {
  computeBucketStart,
  parsePerformanceMetricContributionInput,
} from '../src/performance-metric-contribution.js';

describe('computeBucketStart', () => {
  it('floors a timestamp to the start of its UTC minute', () => {
    expect(computeBucketStart(1_800_000_054_000).toISOString()).toBe('2027-01-15T08:00:00.000Z');
    expect(computeBucketStart(1_800_000_059_999).toISOString()).toBe('2027-01-15T08:00:00.000Z');
    expect(computeBucketStart(1_800_000_060_000).toISOString()).toBe('2027-01-15T08:01:00.000Z');
  });
});

describe('parsePerformanceMetricContributionInput', () => {
  const valid = {
    projectId: '11111111-1111-1111-1111-111111111111',
    eventId: 'evt-perf-1',
    occurredAt: 1_800_000_054_000,
    metricName: 'lcp',
    unit: 'millisecond',
    value: 2500,
    startedAt: 1_800_000_050_000,
  };

  it('accepts a valid lcp millisecond contribution', () => {
    const result = parsePerformanceMetricContributionInput(valid);
    expect(result).toMatchObject({
      projectId: valid.projectId,
      eventId: valid.eventId,
      metricName: 'lcp',
      unit: 'millisecond',
      value: 2500,
      bucketStartIso: '2027-01-15T08:00:00.000Z',
    });
  });

  it('accepts a valid cls ratio contribution', () => {
    const result = parsePerformanceMetricContributionInput({
      ...valid,
      eventId: 'evt-perf-cls',
      metricName: 'cls',
      unit: 'ratio',
      value: 0.12,
    });
    expect(result).toMatchObject({ metricName: 'cls', unit: 'ratio', value: 0.12 });
  });

  it('accepts an optional durationMs', () => {
    const result = parsePerformanceMetricContributionInput({
      ...valid,
      eventId: 'evt-perf-dur',
      durationMs: 300,
    });
    expect(result).toMatchObject({ durationMs: 300 });
  });

  it('rejects a non-object top level', () => {
    expect(parsePerformanceMetricContributionInput(null)).toEqual({
      status: 'invalid_input',
      code: 'invalid_top_level',
    });
  });

  it('rejects a missing required field', () => {
    const { metricName: _omit, ...rest } = valid;
    void _omit;
    expect(parsePerformanceMetricContributionInput(rest)).toMatchObject({ status: 'invalid_input' });
  });

  it('rejects an empty projectId', () => {
    expect(
      parsePerformanceMetricContributionInput({ ...valid, projectId: '' }),
    ).toMatchObject({ status: 'invalid_input' });
  });

  it('rejects an unknown metric name', () => {
    expect(
      parsePerformanceMetricContributionInput({ ...valid, metricName: 'fcp' }),
    ).toMatchObject({ status: 'invalid_input' });
  });

  it('rejects an unknown unit', () => {
    expect(
      parsePerformanceMetricContributionInput({ ...valid, unit: 'bytes' }),
    ).toMatchObject({ status: 'invalid_input' });
  });

  it('rejects a negative value', () => {
    expect(
      parsePerformanceMetricContributionInput({ ...valid, value: -1 }),
    ).toMatchObject({ status: 'invalid_input' });
  });

  it('rejects a non-finite value', () => {
    expect(
      parsePerformanceMetricContributionInput({ ...valid, value: Number.NaN }),
    ).toMatchObject({ status: 'invalid_input' });
  });

  it('rejects a millisecond value above the safe integer limit', () => {
    expect(
      parsePerformanceMetricContributionInput({ ...valid, value: 2_147_483_648 }),
    ).toMatchObject({ status: 'invalid_input' });
  });

  it('rejects a ratio value above 1', () => {
    expect(
      parsePerformanceMetricContributionInput({ ...valid, metricName: 'cls', unit: 'ratio', value: 1.5 }),
    ).toMatchObject({ status: 'invalid_input' });
  });

  it('rejects a non-safe-integer occurredAt', () => {
    expect(
      parsePerformanceMetricContributionInput({ ...valid, occurredAt: Number.NaN }),
    ).toMatchObject({ status: 'invalid_input' });
  });
});
```

- [x] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @aurora/processing-store test -- test/performance-metric-contribution.test.ts`
Expected: FAIL —— 模块不存在（Cannot find module）。

- [x] **Step 3: 写最小实现**

创建 `packages/processing-store/src/performance-metric-types.ts`：

```ts
import type { PerformanceMetricName, PerformanceMetricUnit } from '@aurora/event-schema';

/**
 * A performance metric contribution submitted by a future Performance Processor.
 * The store validates the shape but does NOT classify goodness/exceedance;
 * percentile, histogram, and exceed-rate are explicitly out of scope.
 */
export interface PerformanceMetricContributionInput {
  readonly projectId: string;
  readonly eventId: string;
  readonly occurredAt: number;
  readonly metricName: PerformanceMetricName;
  readonly unit: PerformanceMetricUnit;
  readonly value: number;
  readonly startedAt: number;
  readonly durationMs?: number;
}

/**
 * Discriminable persistence result. Never exposes the pg Result object, raw
 * database error codes, or internal database identifiers; never leaks metric
 * values or input details.
 */
export type PersistPerformanceMetricContributionResult =
  | { readonly status: 'applied' }
  | { readonly status: 'duplicate' }
  | { readonly status: 'invalid_input'; readonly code: string }
  | { readonly status: 'temporarily_unavailable' };

/**
 * Internal validated database parameters derived from a performance metric
 * contribution. Not exported.
 */
export interface PerformanceMetricBucketParams {
  readonly projectId: string;
  readonly eventId: string;
  readonly bucketStartIso: string;
  readonly metricName: string;
  readonly unit: string;
  readonly value: number;
  readonly durationMs?: number;
}
```

创建 `packages/processing-store/src/performance-metric-contribution.ts`：

```ts
import {
  PerformanceMetricName,
  PerformanceMetricUnit,
  PERFORMANCE_EVENT_LIMITS,
} from '@aurora/event-schema';
import type { PerformanceMetricBucketParams } from './performance-metric-types.js';

const TOP_LEVEL_FIELDS = [
  'projectId',
  'eventId',
  'occurredAt',
  'metricName',
  'unit',
  'value',
  'startedAt',
] as const;

const MINUTES_MS = 60_000;

function isPlainRecord(input: unknown): input is Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return false;
  const prototype: unknown = Object.getPrototypeOf(input);
  return prototype === Object.prototype || prototype === null;
}

function invalid(code: string): { readonly status: 'invalid_input'; readonly code: string } {
  return { status: 'invalid_input', code };
}

/** Floor a Unix epoch millisecond timestamp to the start of its UTC minute. */
export function computeBucketStart(occurredAt: number): Date {
  return new Date(Math.floor(occurredAt / MINUTES_MS) * MINUTES_MS);
}

/**
 * Validate the caller-facing unknown input and derive stable, protocol-validated
 * bucket parameters. The store validates the shape but does NOT classify
 * performance goodness, percentile, or exceedance. Bucket time base is the
 * envelope occurredAt, floored to the UTC minute.
 */
export function parsePerformanceMetricContributionInput(
  input: unknown,
): PerformanceMetricBucketParams | { readonly status: 'invalid_input'; readonly code: string } {
  if (!isPlainRecord(input)) {
    return invalid('invalid_top_level');
  }
  for (const field of TOP_LEVEL_FIELDS) {
    if (!(field in input)) {
      return invalid('invalid_top_level');
    }
  }
  const projectId = input.projectId;
  if (typeof projectId !== 'string' || projectId.length === 0) {
    return invalid('invalid_project_id');
  }
  const eventId = input.eventId;
  if (typeof eventId !== 'string' || eventId.length === 0) {
    return invalid('invalid_event_id');
  }
  const occurredAt = input.occurredAt;
  if (!Number.isSafeInteger(occurredAt) || (occurredAt as number) <= 0) {
    return invalid('invalid_occurred_at');
  }
  const startedAt = input.startedAt;
  if (!Number.isSafeInteger(startedAt) || (startedAt as number) <= 0) {
    return invalid('invalid_started_at');
  }
  const metricName = input.metricName;
  if (typeof metricName !== 'string') {
    return invalid('invalid_metric_name');
  }
  if (!Object.values(PerformanceMetricName).includes(metricName as PerformanceMetricName)) {
    return invalid('invalid_metric_name');
  }
  const unit = input.unit;
  if (typeof unit !== 'string') {
    return invalid('invalid_unit');
  }
  if (!Object.values(PerformanceMetricUnit).includes(unit as PerformanceMetricUnit)) {
    return invalid('invalid_unit');
  }
  const value = input.value;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return invalid('invalid_value');
  }
  if (unit === PerformanceMetricUnit.Millisecond) {
    if (!Number.isSafeInteger(value) || value > PERFORMANCE_EVENT_LIMITS.maxValueSafeInteger) {
      return invalid('invalid_value');
    }
  } else {
    // ratio (CLS): 0..1 finite non-negative.
    if (value > PERFORMANCE_EVENT_LIMITS.maxRatioValue) {
      return invalid('invalid_value');
    }
  }
  let durationMs: number | undefined;
  if (input.durationMs !== undefined) {
    const raw = input.durationMs;
    if (
      typeof raw !== 'number' ||
      !Number.isSafeInteger(raw) ||
      raw < 0 ||
      raw > PERFORMANCE_EVENT_LIMITS.maxDurationMs
    ) {
      return invalid('invalid_duration_ms');
    }
    durationMs = raw;
  }

  return {
    projectId,
    eventId,
    bucketStartIso: computeBucketStart(occurredAt as number).toISOString(),
    metricName,
    unit,
    value,
    ...(durationMs !== undefined ? { durationMs } : {}),
  };
}
```

- [x] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @aurora/processing-store test -- test/performance-metric-contribution.test.ts`
Expected: PASS（14 个测试：1 个 computeBucketStart + 13 个 parsePerformanceMetricContributionInput）。

- [x] **Step 5: Commit 边界（不实际执行）**

```text
逻辑提交边界：feat(processing-store): performance metric contribution types and validation
实际执行：不运行 git add/commit。
```

- [x] **Step 6: 检查差异**

Run: `git diff --check`
Expected: 无输出。

## Task 3：persistPerformanceMetricContribution Repository

**Files:**
- Create: `packages/processing-store/src/performance-metric-repository.ts`
- Create: `packages/processing-store/test/performance-metric-repository.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `parsePerformanceMetricContributionInput`/`PersistPerformanceMetricContributionResult`；`pg` `Pool`/`PoolClient`
- Produces:
  ```ts
  export function persistPerformanceMetricContribution(
    pool: Pool,
    input: unknown,
  ): Promise<PersistPerformanceMetricContributionResult>;
  ```

- [x] **Step 1: 写失败测试**

创建 `packages/processing-store/test/performance-metric-repository.test.ts`（用 fake Pool 验证编排，不连数据库）：

```ts
import { describe, expect, it, vi } from 'vitest';
import { persistPerformanceMetricContribution } from '../src/performance-metric-repository.js';
import type { Pool, PoolClient } from 'pg';

interface QueryCall {
  sql: string;
  params: unknown[];
  rows: unknown[];
}

function fakePool(): { pool: Pool; calls: QueryCall[] } {
  const calls: QueryCall[] = [];
  const client = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params: params ?? [], rows: [] });
      if (typeof sql === 'string' && sql.includes('INSERT INTO performance_metric_event_applications')) {
        // First application attempt returns a row (inserted).
        return { rows: [{ project_id: 'p' }] };
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO performance_metric_buckets')) {
        return { rows: [{ id: '1' }] };
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  const pool = {
    connect: vi.fn(async () => client as unknown as PoolClient),
  } as unknown as Pool;
  return { pool, calls };
}

function validContribution(overrides: Record<string, unknown> = {}) {
  return {
    projectId: '11111111-1111-1111-1111-111111111111',
    eventId: 'evt-perf-repo',
    occurredAt: 1_800_000_054_000,
    metricName: 'lcp',
    unit: 'millisecond',
    value: 2500,
    startedAt: 1_800_000_050_000,
    ...overrides,
  };
}

describe('persistPerformanceMetricContribution', () => {
  it('applies a first contribution via register-then-upsert in one transaction', async () => {
    const { pool, calls } = fakePool();
    const result = await persistPerformanceMetricContribution(pool, validContribution());
    expect(result).toEqual({ status: 'applied' });
    const sqls = calls.map((c) => c.sql);
    expect(sqls[0]).toContain('BEGIN');
    expect(sqls[1]).toContain('INSERT INTO performance_metric_event_applications');
    expect(sqls[2]).toContain('INSERT INTO performance_metric_buckets');
    expect(sqls[3]).toContain('COMMIT');
    expect(calls[2]?.params).toContain(2500);
  });

  it('returns duplicate and skips the bucket update when the event was already applied', async () => {
    const { pool } = fakePool();
    // Force the application insert to return no row (duplicate).
    const client = {
      query: vi.fn(async (sql: string) => {
        if (typeof sql === 'string' && sql.includes('INSERT INTO performance_metric_event_applications')) {
          return { rows: [] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const dupPool = { connect: vi.fn(async () => client as unknown as PoolClient) } as unknown as Pool;
    const result = await persistPerformanceMetricContribution(dupPool, validContribution());
    expect(result).toEqual({ status: 'duplicate' });
  });

  it('returns invalid_input without touching the database for an invalid input', async () => {
    const { pool, calls } = fakePool();
    const result = await persistPerformanceMetricContribution(pool, validContribution({ metricName: 'fcp' }));
    expect(result.status).toBe('invalid_input');
    expect(calls).toHaveLength(0);
  });

  it('returns temporarily_unavailable and rolls back on a database failure', async () => {
    const client = {
      query: vi.fn(async () => {
        throw new Error('db boom');
      }),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn(async () => client as unknown as PoolClient) } as unknown as Pool;
    const result = await persistPerformanceMetricContribution(pool, validContribution());
    expect(result).toEqual({ status: 'temporarily_unavailable' });
  });
});
```

- [x] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @aurora/processing-store test -- test/performance-metric-repository.test.ts`
Expected: FAIL —— 模块不存在。

- [x] **Step 3: 写最小实现**

创建 `packages/processing-store/src/performance-metric-repository.ts`：

```ts
import type { Pool, PoolClient } from 'pg';
import { parsePerformanceMetricContributionInput } from './performance-metric-contribution.js';
import type { PersistPerformanceMetricContributionResult } from './performance-metric-types.js';

const INSERT_APPLICATION_SQL = `
  INSERT INTO performance_metric_event_applications (project_id, event_id)
  VALUES ($1, $2)
  ON CONFLICT (project_id, event_id) DO NOTHING
  RETURNING project_id
`;

const UPSERT_BUCKET_SQL = `
  INSERT INTO performance_metric_buckets
    (project_id, bucket_start, metric_name, unit, observed_count, value_sum, value_max)
  VALUES
    ($1, $2, $3, $4, 1, $5, $5)
  ON CONFLICT (project_id, bucket_start, metric_name, unit)
  DO UPDATE SET
    observed_count = performance_metric_buckets.observed_count + 1,
    value_sum = performance_metric_buckets.value_sum + $5,
    value_max = GREATEST(performance_metric_buckets.value_max, $5),
    updated_at = now()
  RETURNING id
`;

/**
 * Persist one performance metric contribution within a single committed
 * transaction: register the (project_id, event_id) application first; if it was
 * already applied (duplicate), skip the bucket update; otherwise upsert the
 * UTC-minute performance bucket. Any failure rolls back the whole transaction.
 * Never exposes the pg Result object or internal database error details.
 */
export async function persistPerformanceMetricContribution(
  pool: Pool,
  input: unknown,
): Promise<PersistPerformanceMetricContributionResult> {
  const parsed = parsePerformanceMetricContributionInput(input);
  if ('status' in parsed) return parsed;

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    const application = await client.query<{ project_id: string }>(INSERT_APPLICATION_SQL, [
      parsed.projectId,
      parsed.eventId,
    ]);
    if (application.rows.length === 0) {
      // Duplicate: this event was already applied; do not update the bucket.
      await client.query('COMMIT');
      return { status: 'duplicate' };
    }
    await client.query(UPSERT_BUCKET_SQL, [
      parsed.projectId,
      parsed.bucketStartIso,
      parsed.metricName,
      parsed.unit,
      parsed.value,
    ]);
    await client.query('COMMIT');
    return { status: 'applied' };
  } catch {
    await client.query('ROLLBACK').catch(() => undefined);
    // Never leak database error details to the caller.
    return { status: 'temporarily_unavailable' };
  } finally {
    client.release();
  }
}
```

- [x] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @aurora/processing-store test -- test/performance-metric-repository.test.ts`
Expected: PASS（4 个测试）。

- [x] **Step 5: Commit 边界（不实际执行）**

```text
逻辑提交边界：feat(processing-store): performance metric aggregate repository
实际执行：不运行 git add/commit。
```

- [x] **Step 6: 检查差异**

Run: `git diff --check`
Expected: 无输出。

## Task 4：性能样本类型、输入校验与 Repository

**Files:**
- Create: `packages/processing-store/src/performance-sample-types.ts`
- Create: `packages/processing-store/src/performance-sample-input.ts`
- Create: `packages/processing-store/src/performance-sample-repository.ts`
- Create: `packages/processing-store/test/performance-sample-input.test.ts`
- Create: `packages/processing-store/test/performance-sample-repository.test.ts`

**Interfaces:**
- Consumes: `@aurora/event-schema` 包根 `parsePerformanceEventEnvelope`；`pg` `Pool`/`PoolClient`
- Produces:
  ```ts
  export interface PersistPerformanceEventSampleInput {
    readonly projectId: string;
    readonly eventEnvelope: unknown;
  }
  export type PersistPerformanceEventSampleResult =
    | { readonly status: 'inserted'; readonly sampleId: string }
    | { readonly status: 'duplicate' }
    | { readonly status: 'invalid_input'; readonly code: string }
    | { readonly status: 'temporarily_unavailable' };
  export function persistPerformanceEventSample(
    pool: Pool,
    input: unknown,
  ): Promise<PersistPerformanceEventSampleResult>;
  ```

- [x] **Step 1: 写失败测试**

创建 `packages/processing-store/test/performance-sample-input.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { parsePersistPerformanceEventSampleInput } from '../src/performance-sample-input.js';

function performanceEnvelope(eventId: string, bodyOverrides: Record<string, unknown> = {}) {
  return {
    protocolVersion: 1,
    eventId,
    eventType: 'performance',
    occurredAt: 1_800_000_054_000,
    body: {
      metricCategory: 'page',
      metricName: 'lcp',
      value: 2500,
      unit: 'millisecond',
      startedAt: 1_800_000_050_000,
      ...bodyOverrides,
    },
  };
}

describe('parsePersistPerformanceEventSampleInput', () => {
  it('derives a whitelist projection from a valid performance envelope', () => {
    const result = parsePersistPerformanceEventSampleInput({
      projectId: '11111111-1111-1111-1111-111111111111',
      eventEnvelope: performanceEnvelope('evt-perf-sample-1'),
    });
    expect(result).toMatchObject({
      projectId: '11111111-1111-1111-1111-111111111111',
      eventId: 'evt-perf-sample-1',
      occurredAtIso: '2027-01-15T08:00:54.000Z',
    });
    const body = (result as { sampleBody: Record<string, unknown> }).sampleBody;
    expect(body).toEqual({
      metricName: 'lcp',
      value: 2500,
      unit: 'millisecond',
      startedAt: 1_800_000_050_000,
    });
  });

  it('includes durationMs in the projection when present', () => {
    const result = parsePersistPerformanceEventSampleInput({
      projectId: '11111111-1111-1111-1111-111111111111',
      eventEnvelope: performanceEnvelope('evt-perf-sample-dur', { durationMs: 300 }),
    });
    const body = (result as { sampleBody: Record<string, unknown> }).sampleBody;
    expect(body).toMatchObject({ durationMs: 300 });
  });

  it('rejects a non-object top level', () => {
    expect(parsePersistPerformanceEventSampleInput(null)).toMatchObject({
      status: 'invalid_input',
    });
  });

  it('rejects a missing projectId', () => {
    expect(
      parsePersistPerformanceEventSampleInput({ eventEnvelope: performanceEnvelope('evt-x') }),
    ).toMatchObject({ status: 'invalid_input' });
  });

  it('rejects a non-performance envelope', () => {
    expect(
      parsePersistPerformanceEventSampleInput({
        projectId: '11111111-1111-1111-1111-111111111111',
        eventEnvelope: {
          protocolVersion: 1,
          eventId: 'evt-err',
          eventType: 'error',
          occurredAt: 1_800_000_054_000,
          body: { category: 'javascript', error: { message: 'x' } },
        },
      }),
    ).toMatchObject({ status: 'invalid_input' });
  });

  it('rejects an unknown performance metric', () => {
    expect(
      parsePersistPerformanceEventSampleInput({
        projectId: '11111111-1111-1111-1111-111111111111',
        eventEnvelope: performanceEnvelope('evt-fcp', { metricName: 'fcp' }),
      }),
    ).toMatchObject({ status: 'invalid_input' });
  });
});
```

创建 `packages/processing-store/test/performance-sample-repository.test.ts`（fake Pool 验证编排）：

```ts
import { describe, expect, it, vi } from 'vitest';
import { persistPerformanceEventSample } from '../src/performance-sample-repository.js';
import type { Pool, PoolClient } from 'pg';

function performanceEnvelope(eventId: string) {
  return {
    protocolVersion: 1,
    eventId,
    eventType: 'performance',
    occurredAt: 1_800_000_054_000,
    body: {
      metricCategory: 'page',
      metricName: 'lcp',
      value: 2500,
      unit: 'millisecond',
      startedAt: 1_800_000_050_000,
    },
  };
}

function fakePool(insertRows: unknown[]): { pool: Pool; sqls: string[] } {
  const sqls: string[] = [];
  const client = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      sqls.push(sql);
      void params;
      if (typeof sql === 'string' && sql.includes('INSERT INTO performance_event_samples')) {
        return { rows: insertRows };
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  const pool = { connect: vi.fn(async () => client as unknown as PoolClient) } as unknown as Pool;
  return { pool, sqls };
}

describe('persistPerformanceEventSample', () => {
  it('inserts a first sample and returns the sample id', async () => {
    const { pool, sqls } = fakePool([{ id: '7' }]);
    const result = await persistPerformanceEventSample(pool, {
      projectId: '11111111-1111-1111-1111-111111111111',
      eventEnvelope: performanceEnvelope('evt-perf-sample-1'),
    });
    expect(result).toEqual({ status: 'inserted', sampleId: '7' });
    expect(sqls[0]).toContain('BEGIN');
    expect(sqls[1]).toContain('INSERT INTO performance_event_samples');
    expect(sqls[2]).toContain('COMMIT');
  });

  it('returns duplicate when the sample already exists', async () => {
    const { pool } = fakePool([]);
    const result = await persistPerformanceEventSample(pool, {
      projectId: '11111111-1111-1111-1111-111111111111',
      eventEnvelope: performanceEnvelope('evt-perf-sample-dup'),
    });
    expect(result).toEqual({ status: 'duplicate' });
  });

  it('returns invalid_input without touching the database for an invalid envelope', async () => {
    const { pool, sqls } = fakePool([]);
    const result = await persistPerformanceEventSample(pool, {
      projectId: '11111111-1111-1111-1111-111111111111',
      eventEnvelope: { protocolVersion: 1, eventId: 'evt-bad', eventType: 'error', occurredAt: 1, body: {} },
    });
    expect(result.status).toBe('invalid_input');
    expect(sqls).toHaveLength(0);
  });

  it('returns temporarily_unavailable and rolls back on a database failure', async () => {
    const client = {
      query: vi.fn(async () => {
        throw new Error('db boom');
      }),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn(async () => client as unknown as PoolClient) } as unknown as Pool;
    const result = await persistPerformanceEventSample(pool, {
      projectId: '11111111-1111-1111-1111-111111111111',
      eventEnvelope: performanceEnvelope('evt-perf-sample-fail'),
    });
    expect(result).toEqual({ status: 'temporarily_unavailable' });
  });
});
```

- [x] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @aurora/processing-store test -- test/performance-sample-input.test.ts test/performance-sample-repository.test.ts`
Expected: FAIL —— 模块不存在。

- [x] **Step 3: 写最小实现**

创建 `packages/processing-store/src/performance-sample-types.ts`：

```ts
/**
 * Stable public input and result contract for persisting one performance event
 * safe sample. The caller-facing boundary accepts unknown and the repository
 * validates everything before touching the database. A sample is a bounded
 * diagnostic projection of a performance event already selected by an upstream
 * policy, NOT a complete performance occurrence history.
 */
export interface PersistPerformanceEventSampleInput {
  readonly projectId: string;
  readonly eventEnvelope: unknown;
}

/**
 * Discriminable persistence result. Never exposes the pg Result object, raw
 * database error codes, or internal database identifiers; never leaks the
 * PerformanceEventEnvelope body or input values.
 */
export type PersistPerformanceEventSampleResult =
  | {
      readonly status: 'inserted';
      readonly sampleId: string;
    }
  | { readonly status: 'duplicate' }
  | { readonly status: 'invalid_input'; readonly code: string }
  | { readonly status: 'temporarily_unavailable' };

/**
 * Internal validated database parameters derived from a PerformanceEventEnvelope
 * that already passed @aurora/event-schema root validation. Not exported.
 */
export interface PerformanceSampleDbParams {
  readonly projectId: string;
  readonly eventId: string;
  readonly occurredAtIso: string;
  readonly sampleBody: unknown;
}
```

创建 `packages/processing-store/src/performance-sample-input.ts`：

```ts
import { parsePerformanceEventEnvelope } from '@aurora/event-schema';
import type { PerformanceSampleDbParams } from './performance-sample-types.js';

const TOP_LEVEL_FIELDS = ['projectId', 'eventEnvelope'] as const;

function isPlainRecord(input: unknown): input is Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return false;
  const prototype: unknown = Object.getPrototypeOf(input);
  return prototype === Object.prototype || prototype === null;
}

function invalid(code: string): { readonly status: 'invalid_input'; readonly code: string } {
  return { status: 'invalid_input', code };
}

/**
 * Validate the caller-facing unknown input and derive stable, already
 * protocol-validated database parameters. The projected sample_body is the
 * parsed PerformanceEventBody safe-field whitelist (metricName/value/unit/
 * startedAt/optional durationMs). metricCategory is constant `page` in v1 and
 * deliberately omitted; the envelope is never persisted whole.
 */
export function parsePersistPerformanceEventSampleInput(
  input: unknown,
): PerformanceSampleDbParams | { readonly status: 'invalid_input'; readonly code: string } {
  if (!isPlainRecord(input)) {
    return invalid('invalid_top_level');
  }
  for (const field of TOP_LEVEL_FIELDS) {
    if (!(field in input)) {
      return invalid('invalid_top_level');
    }
  }
  const projectId = input.projectId;
  if (typeof projectId !== 'string' || projectId.length === 0) {
    return invalid('invalid_project_id');
  }

  const parsed = parsePerformanceEventEnvelope(input.eventEnvelope);
  if (!parsed.success) {
    return invalid('invalid_envelope');
  }
  const envelope = parsed.data;
  const body = envelope.body;
  const sampleBody: Record<string, unknown> = {
    metricName: body.metricName,
    value: body.value,
    unit: body.unit,
    startedAt: body.startedAt,
  };
  if (body.durationMs !== undefined) {
    sampleBody.durationMs = body.durationMs;
  }

  return {
    projectId,
    eventId: envelope.eventId,
    occurredAtIso: new Date(envelope.occurredAt).toISOString(),
    sampleBody,
  };
}
```

创建 `packages/processing-store/src/performance-sample-repository.ts`：

```ts
import type { Pool, PoolClient } from 'pg';
import { parsePersistPerformanceEventSampleInput } from './performance-sample-input.js';
import type { PersistPerformanceEventSampleResult } from './performance-sample-types.js';

const INSERT_SQL = `
  INSERT INTO performance_event_samples
    (project_id, event_id, occurred_at, sample_body)
  VALUES
    ($1, $2, $3, $4::jsonb)
  ON CONFLICT (project_id, event_id) DO NOTHING
  RETURNING id
`;

/**
 * Persist one validated performance event safe sample within a single committed
 * transaction. Idempotency is enforced by the (project_id, event_id) unique key
 * via ON CONFLICT DO NOTHING: first write -> inserted, repeat write -> duplicate.
 * Never exposes the pg Result object or internal database error details. A
 * sample is a bounded diagnostic projection, not a complete performance history.
 */
export async function persistPerformanceEventSample(
  pool: Pool,
  input: unknown,
): Promise<PersistPerformanceEventSampleResult> {
  const parsed = parsePersistPerformanceEventSampleInput(input);
  if ('status' in parsed) return parsed;

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query<{ id: string }>(INSERT_SQL, [
      parsed.projectId,
      parsed.eventId,
      parsed.occurredAtIso,
      JSON.stringify(parsed.sampleBody),
    ]);
    await client.query('COMMIT');
    if (result.rows.length === 0) return { status: 'duplicate' };
    return { status: 'inserted', sampleId: result.rows[0]?.id ?? '' };
  } catch {
    await client.query('ROLLBACK').catch(() => undefined);
    // Never leak database error details to the caller.
    return { status: 'temporarily_unavailable' };
  } finally {
    client.release();
  }
}
```

- [x] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @aurora/processing-store test -- test/performance-sample-input.test.ts test/performance-sample-repository.test.ts`
Expected: PASS（10 个测试：6 个样本输入校验 + 4 个样本 Repository）。

- [x] **Step 5: Commit 边界（不实际执行）**

```text
逻辑提交边界：feat(processing-store): performance sample store types/validation/repository
实际执行：不运行 git add/commit。
```

- [x] **Step 6: 检查差异**

Run: `git diff --check`
Expected: 无输出。

## Task 5：真实 PostgreSQL 集成测试（聚合 + 样本）

**Files:**
- Create: `packages/processing-store/test/integration/performance-metric.test.ts`
- Create: `packages/processing-store/test/integration/performance-sample.test.ts`
- Modify: `packages/processing-store/test/integration/migrations.test.ts`（beforeAll DROP 性能表）

**Interfaces:**
- Consumes: Task 1—4 的 Repository；`./helpers.js`（`assertIsTestDatabase`/`createTestPool`/`queryRow`/`queryRows`/`testDatabaseUrl`）
- Produces: 真实 PostgreSQL 行为证据

- [x] **Step 1: 写失败测试**

创建 `packages/processing-store/test/integration/performance-metric.test.ts`：

```ts
import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  persistErrorEventOccurrence,
  persistRequestMetricContribution,
  persistRequestEventSample,
  persistPerformanceMetricContribution,
} from '../../src/index.js';
import {
  assertIsTestDatabase,
  createTestPool,
  queryRow,
  queryRows,
  testDatabaseUrl,
} from './helpers.js';

const migrationsDir = fileURLToPath(new URL('../../migrations', import.meta.url));
const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const describeDb = hasDb ? describe : describe.skip;

interface BucketRow {
  id: string;
  project_id: string;
  bucket_start: string;
  metric_name: string;
  unit: string;
  observed_count: string;
  value_sum: string;
  value_max: string;
}

interface ApplicationRow {
  project_id: string;
  event_id: string;
}

const projectA = '11111111-1111-1111-1111-111111111111';
const projectB = '22222222-2222-2222-2222-222222222222';

function contribution(overrides: Record<string, unknown> = {}) {
  return {
    projectId: projectA,
    eventId: 'evt-perf-default',
    occurredAt: 1_800_000_054_000,
    metricName: 'lcp',
    unit: 'millisecond',
    value: 2500,
    startedAt: 1_800_000_050_000,
    ...overrides,
  };
}

describeDb('processing-store performance metric aggregation (real PostgreSQL 17)', () => {
  let pool: Pool;

  beforeAll(async () => {
    assertIsTestDatabase(testDatabaseUrl());
    pool = createTestPool();
    await pool.query('DROP TABLE IF EXISTS performance_metric_event_applications CASCADE');
    await pool.query('DROP TABLE IF EXISTS performance_metric_buckets CASCADE');
    await pool.query('DROP TABLE IF EXISTS performance_event_samples CASCADE');
    await pool.query('DROP TABLE IF EXISTS request_metric_event_applications CASCADE');
    await pool.query('DROP TABLE IF EXISTS request_metric_buckets CASCADE');
    await pool.query('DROP TABLE IF EXISTS request_event_samples CASCADE');
    await pool.query('DROP TABLE IF EXISTS error_event_occurrences CASCADE');
    await pool.query('DROP TABLE IF EXISTS pgmigrations CASCADE');
    await runner({
      databaseUrl: testDatabaseUrl(),
      dir: migrationsDir,
      direction: 'up',
      migrationsTable: 'pgmigrations',
      count: Infinity,
      log: () => undefined,
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('applies a first contribution and increments observed_count/sum/max', async () => {
    const result = await persistPerformanceMetricContribution(pool, contribution({ eventId: 'evt-perf-first' }));
    expect(result).toEqual({ status: 'applied' });
    const row = await queryRow<BucketRow>(
      pool,
      `SELECT * FROM performance_metric_buckets WHERE project_id = '${projectA}'`,
    );
    expect(row?.observed_count).toBe('1');
    expect(row?.value_sum).toBe('2500');
    expect(row?.value_max).toBe('2500');
    expect(row?.metric_name).toBe('lcp');
    expect(row?.unit).toBe('millisecond');
    expect(new Date(row?.bucket_start ?? 0).toISOString()).toBe('2027-01-15T08:00:00.000Z');
  });

  it('accumulates value_sum and takes value_max across events', async () => {
    await persistPerformanceMetricContribution(pool, contribution({ eventId: 'evt-perf-v1', value: 1000 }));
    await persistPerformanceMetricContribution(pool, contribution({ eventId: 'evt-perf-v2', value: 3200 }));
    const row = await queryRow<BucketRow>(
      pool,
      `SELECT * FROM performance_metric_buckets WHERE project_id = '${projectA}' AND metric_name = 'lcp' AND unit = 'millisecond'`,
    );
    // 2500 (first) + 1000 + 3200 = 6700
    expect(row?.observed_count).toBe('3');
    expect(row?.value_sum).toBe('6700');
    expect(row?.value_max).toBe('3200');
  });

  it('returns duplicate and does not change the bucket when re-applied', async () => {
    const before = await queryRow<BucketRow>(
      pool,
      `SELECT * FROM performance_metric_buckets WHERE project_id = '${projectA}' AND metric_name = 'lcp' AND unit = 'millisecond'`,
    );
    const result = await persistPerformanceMetricContribution(pool, contribution({ eventId: 'evt-perf-v1', value: 1000 }));
    expect(result).toEqual({ status: 'duplicate' });
    const after = await queryRow<BucketRow>(
      pool,
      `SELECT * FROM performance_metric_buckets WHERE project_id = '${projectA}' AND metric_name = 'lcp' AND unit = 'millisecond'`,
    );
    expect(after?.observed_count).toBe(before?.observed_count);
    expect(after?.value_sum).toBe(before?.value_sum);
    const apps = await queryRows<ApplicationRow>(
      pool,
      `SELECT * FROM performance_metric_event_applications WHERE event_id = 'evt-perf-v1'`,
    );
    expect(apps).toHaveLength(1);
  });

  it('keeps cls ratio and millisecond metrics in separate buckets', async () => {
    await persistPerformanceMetricContribution(
      pool,
      contribution({ eventId: 'evt-perf-cls', metricName: 'cls', unit: 'ratio', value: 0.12 }),
    );
    const rows = await queryRows<BucketRow>(
      pool,
      `SELECT * FROM performance_metric_buckets WHERE project_id = '${projectA}' AND metric_name = 'cls'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.unit).toBe('ratio');
    expect(rows[0]?.value_sum).toBe('0.12');
  });

  it('does not merge different projects into the same bucket', async () => {
    await persistPerformanceMetricContribution(
      pool,
      contribution({ projectId: projectB, eventId: 'evt-perf-proj-b', metricName: 'inp', unit: 'millisecond', value: 100 }),
    );
    const rows = await queryRows<BucketRow>(
      pool,
      `SELECT * FROM performance_metric_buckets WHERE metric_name = 'inp' AND unit = 'millisecond'`,
    );
    expect(rows.filter((r) => r.project_id === projectA)).toHaveLength(0);
    expect(rows.filter((r) => r.project_id === projectB)).toHaveLength(1);
  });

  it('does not merge across UTC minutes', async () => {
    await persistPerformanceMetricContribution(
      pool,
      contribution({ eventId: 'evt-perf-min2', occurredAt: 1_800_000_060_000, metricName: 'inp', unit: 'millisecond', value: 200 }),
    );
    const rows = await queryRows<BucketRow>(
      pool,
      `SELECT * FROM performance_metric_buckets WHERE project_id = '${projectB}' AND metric_name = 'inp' AND unit = 'millisecond'`,
    );
    expect(
      rows.filter((r) => new Date(r.bucket_start).toISOString() === '2027-01-15T08:00:00.000Z'),
    ).toHaveLength(1);
    expect(
      rows.filter((r) => new Date(r.bucket_start).toISOString() === '2027-01-15T08:01:00.000Z'),
    ).toHaveLength(1);
  });

  it('rejects an invalid value without registering or writing a bucket', async () => {
    const result = await persistPerformanceMetricContribution(pool, contribution({ eventId: 'evt-perf-bad', value: -5 }));
    expect(result.status).toBe('invalid_input');
    const apps = await queryRows<ApplicationRow>(
      pool,
      `SELECT * FROM performance_metric_event_applications WHERE event_id = 'evt-perf-bad'`,
    );
    expect(apps).toHaveLength(0);
  });

  it('produces at most one application across concurrent duplicate calls', async () => {
    const input = contribution({ eventId: 'evt-perf-conc', value: 100 });
    const results = await Promise.all([
      persistPerformanceMetricContribution(pool, input),
      persistPerformanceMetricContribution(pool, input),
    ]);
    const applied = results.filter((r) => r.status === 'applied');
    const duplicates = results.filter((r) => r.status === 'duplicate');
    expect(applied.length + duplicates.length).toBe(2);
    expect(applied.length).toBe(1);
    const apps = await queryRows<ApplicationRow>(
      pool,
      `SELECT * FROM performance_metric_event_applications WHERE event_id = 'evt-perf-conc'`,
    );
    expect(apps).toHaveLength(1);
  });

  it('does not regress the error occurrence store', async () => {
    const result = await persistErrorEventOccurrence(pool, {
      projectId: projectA,
      eventEnvelope: {
        protocolVersion: 1,
        eventId: 'evt-error-perf-regress',
        eventType: 'error',
        occurredAt: 1_800_000_054_000,
        body: { category: 'javascript', error: { message: 'Synthetic runtime failure' } },
      },
    });
    expect(result.status).toBe('inserted');
  });

  it('does not regress the request stores', async () => {
    const sampleResult = await persistRequestEventSample(pool, {
      projectId: projectA,
      eventEnvelope: {
        protocolVersion: 1,
        eventId: 'evt-sample-perf-regress',
        eventType: 'request',
        occurredAt: 1_800_000_054_000,
        body: { method: 'GET', url: 'https://api.example.test/orders', startedAt: 1_800_000_054_000, durationMs: 120, outcome: 'success', statusCode: 200 },
      },
    });
    expect(sampleResult.status).toBe('inserted');
    const metricResult = await persistRequestMetricContribution(pool, {
      projectId: projectA,
      eventId: 'evt-metric-perf-regress',
      occurredAt: 1_800_000_054_000,
      method: 'GET',
      outcome: 'success',
      statusCode: 200,
      durationMs: 120,
      isFailure: false,
      isSlow: false,
    });
    expect(metricResult.status).toBe('applied');
  });
});
```

创建 `packages/processing-store/test/integration/performance-sample.test.ts`：

```ts
import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { persistPerformanceEventSample } from '../../src/index.js';
import {
  assertIsTestDatabase,
  createTestPool,
  queryRow,
  queryRows,
  testDatabaseUrl,
} from './helpers.js';

const migrationsDir = fileURLToPath(new URL('../../migrations', import.meta.url));
const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const describeDb = hasDb ? describe : describe.skip;

interface SampleRow {
  id: string;
  project_id: string;
  event_id: string;
  occurred_at: string;
  sample_body: Record<string, unknown>;
}

const projectA = '11111111-1111-1111-1111-111111111111';

function envelope(eventId: string, bodyOverrides: Record<string, unknown> = {}) {
  return {
    protocolVersion: 1,
    eventId,
    eventType: 'performance',
    occurredAt: 1_800_000_054_000,
    body: {
      metricCategory: 'page',
      metricName: 'lcp',
      value: 2500,
      unit: 'millisecond',
      startedAt: 1_800_000_050_000,
      ...bodyOverrides,
    },
  };
}

describeDb('processing-store performance event sample (real PostgreSQL 17)', () => {
  let pool: Pool;

  beforeAll(async () => {
    assertIsTestDatabase(testDatabaseUrl());
    pool = createTestPool();
    await pool.query('DROP TABLE IF EXISTS performance_metric_event_applications CASCADE');
    await pool.query('DROP TABLE IF EXISTS performance_metric_buckets CASCADE');
    await pool.query('DROP TABLE IF EXISTS performance_event_samples CASCADE');
    await pool.query('DROP TABLE IF EXISTS pgmigrations CASCADE');
    await runner({
      databaseUrl: testDatabaseUrl(),
      dir: migrationsDir,
      direction: 'up',
      migrationsTable: 'pgmigrations',
      count: Infinity,
      log: () => undefined,
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('inserts one safe sample with a whitelist projection body', async () => {
    const result = await persistPerformanceEventSample(pool, {
      projectId: projectA,
      eventEnvelope: envelope('evt-perf-sample-1'),
    });
    expect(result.status).toBe('inserted');
    if (result.status !== 'inserted') return;
    expect(result.sampleId).toBeTruthy();
    const row = await queryRow<SampleRow>(
      pool,
      `SELECT * FROM performance_event_samples WHERE event_id = 'evt-perf-sample-1'`,
    );
    expect(row?.project_id).toBe(projectA);
    expect(row?.sample_body).toEqual({
      metricName: 'lcp',
      value: 2500,
      unit: 'millisecond',
      startedAt: 1_800_000_050_000,
    });
  });

  it('includes durationMs in the projection when present', async () => {
    await persistPerformanceEventSample(pool, {
      projectId: projectA,
      eventEnvelope: envelope('evt-perf-sample-dur', { durationMs: 300 }),
    });
    const row = await queryRow<SampleRow>(
      pool,
      `SELECT * FROM performance_event_samples WHERE event_id = 'evt-perf-sample-dur'`,
    );
    expect(row?.sample_body).toMatchObject({ durationMs: 300 });
  });

  it('treats a replay as idempotent: one row only', async () => {
    const first = await persistPerformanceEventSample(pool, {
      projectId: projectA,
      eventEnvelope: envelope('evt-perf-sample-dup'),
    });
    const second = await persistPerformanceEventSample(pool, {
      projectId: projectA,
      eventEnvelope: envelope('evt-perf-sample-dup'),
    });
    expect(first.status).toBe('inserted');
    expect(second.status).toBe('duplicate');
    const rows = await queryRows<SampleRow>(
      pool,
      `SELECT * FROM performance_event_samples WHERE event_id = 'evt-perf-sample-dup'`,
    );
    expect(rows).toHaveLength(1);
  });

  it('rejects a non-performance envelope without inserting', async () => {
    const result = await persistPerformanceEventSample(pool, {
      projectId: projectA,
      eventEnvelope: {
        protocolVersion: 1,
        eventId: 'evt-perf-sample-bad',
        eventType: 'error',
        occurredAt: 1_800_000_054_000,
        body: { category: 'javascript', error: { message: 'x' } },
      },
    });
    expect(result.status).toBe('invalid_input');
    const rows = await queryRows<SampleRow>(
      pool,
      `SELECT * FROM performance_event_samples WHERE event_id = 'evt-perf-sample-bad'`,
    );
    expect(rows).toHaveLength(0);
  });

  it('rejects an unapproved metric name', async () => {
    const result = await persistPerformanceEventSample(pool, {
      projectId: projectA,
      eventEnvelope: envelope('evt-perf-sample-fcp', { metricName: 'fcp' }),
    });
    expect(result.status).toBe('invalid_input');
  });
});
```

- [x] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @aurora/processing-store test:integration -- test/integration/performance-metric.test.ts test/integration/performance-sample.test.ts`
Expected: FAIL —— 性能 Repository 尚未导出（Task 6 才改 index.ts），或性能表已由 Task 1 Migration 创建但 Repository 缺失。

> 说明：本 Task 的测试先失败（Cannot find `persistPerformanceMetricContribution` in `../../src/index.js`），因为包根导出在 Task 6 才追加。若先运行到 Task 5，测试会因导出缺失失败——这是预期 RED。实施时若 Task 6 已完成（包根导出已加），则本 Task RED 由 Migration/表缺失驱动。

- [x] **Step 3: 写最小实现**

本 Task 无新源码；依赖 Task 1—4 与 Task 6 的包根导出。若 Step 2 因包根导出缺失失败，按 Task 6 顺序先追加导出后再跑；若因表缺失失败，回到 Task 1 修复 Migration。真实 PostgreSQL 集成作为组合证据消费。

- [x] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @aurora/processing-store test:integration -- test/integration/performance-metric.test.ts test/integration/performance-sample.test.ts`
Expected: PASS（聚合 10 个 + 样本 5 个）。

- [x] **Step 5: Commit 边界（不实际执行）**

```text
逻辑提交边界：test(processing-store): real-postgres performance aggregate and sample integration
实际执行：不运行 git add/commit。
```

- [x] **Step 6: 检查差异**

Run: `git diff --check`
Expected: 无输出。

## Task 6：包根导出与既有测试门禁同步

**Files:**
- Modify: `packages/processing-store/src/index.ts`（追加性能导出）
- Modify: `packages/processing-store/test/package-entry.test.ts`（追加断言）
- Modify: `packages/processing-store/test/security-negative.test.ts`（追加性能源安全负例）
- Modify: `packages/processing-store/test/integration/migrations.test.ts`（beforeAll DROP 性能表）
- Modify: `packages/processing-store/test/integration/error-occurrence.test.ts`（beforeAll DROP 性能表）
- Modify: `packages/processing-store/test/integration/request-sample.test.ts`（beforeAll DROP 性能表）
- Modify: `packages/processing-store/test/integration/request-metric.test.ts`（beforeAll DROP 性能表）

**Interfaces:**
- Consumes: Task 2—4 的 Repository 与类型
- Produces: 包根公共出口：`persistPerformanceMetricContribution`/`persistPerformanceEventSample`/`PerformanceMetricContributionInput`/`PersistPerformanceMetricContributionResult`/`PersistPerformanceEventSampleInput`/`PersistPerformanceEventSampleResult`

- [x] **Step 1: 写失败测试**

在 `packages/processing-store/src/index.ts` 末尾追加导出（Step 3 实际写入，Step 1 先写 package-entry 测试）：

`packages/processing-store/test/package-entry.test.ts` 追加：

```ts
    expect(result.stdout).toContain('persistPerformanceMetricContribution');
    expect(result.stdout).toContain('persistPerformanceEventSample');
```

及私有路径拒绝追加：

```ts
      '@aurora/processing-store/performance-metric-repository',
      '@aurora/processing-store/performance-metric-contribution',
      '@aurora/processing-store/performance-metric-types',
      '@aurora/processing-store/performance-sample-repository',
      '@aurora/processing-store/performance-sample-input',
      '@aurora/processing-store/performance-sample-types',
```

`packages/processing-store/test/security-negative.test.ts` 追加：

```ts
  it('performance metric source stores only counts and low-cardinality dimensions', async () => {
    const metricTypes = await readFile(
      new URL('../src/performance-metric-types.ts', import.meta.url),
      'utf8',
    );
    const metricContribution = await readFile(
      new URL('../src/performance-metric-contribution.ts', import.meta.url),
      'utf8',
    );
    const metricRepository = await readFile(
      new URL('../src/performance-metric-repository.ts', import.meta.url),
      'utf8',
    );
    const text = `${metricTypes}\n${metricContribution}\n${metricRepository}`;
    for (const forbidden of [
      'requestBody',
      'responseBody',
      'requestHeader',
      'responseHeader',
      'sampleBody',
      'fullUrl',
      'pageUrl',
      'userAgent',
      'ipAddress',
      'percentile',
      'histogram',
    ]) {
      expect(text, `forbidden token ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('performance sample source persists only the whitelist projection', async () => {
    const sampleInput = await readFile(
      new URL('../src/performance-sample-input.ts', import.meta.url),
      'utf8',
    );
    const sampleRepository = await readFile(
      new URL('../src/performance-sample-repository.ts', import.meta.url),
      'utf8',
    );
    const text = `${sampleInput}\n${sampleRepository}`;
    for (const forbidden of ['Authorization', 'cookie', 'password', 'X-Aurora-Client-Key', 'clientKey']) {
      expect(text, `forbidden token ${forbidden}`).not.toContain(forbidden);
    }
    // The projection must only persist the parsed body whitelist, never the
    // full envelope.
    expect(text).not.toMatch(/sampleBody:\s*envelope(?!\.body)/);
    expect(text).not.toMatch(/JSON\.stringify\(envelope\)/);
    expect(text).not.toMatch(/JSON\.stringify\(parsed\)/);
  });
```

- [x] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @aurora/processing-store test -- test/package-entry.test.ts test/security-negative.test.ts`
Expected: FAIL —— `persistPerformanceMetricContribution`/`persistPerformanceEventSample` 未从包根导出。

> 说明：`package-entry.test.ts` 需要 `pnpm build` 后运行（`test:package`）；security-negative 直接读源文件。若直接 `test` 不跑 package-entry（其 exclude 了 package-entry），则先用 `pnpm --filter @aurora/processing-store test:package` 验证导出，用 `test -- security-negative` 验证负例。

- [x] **Step 3: 写最小实现**

`packages/processing-store/src/index.ts` 末尾追加：

```ts
export type {
  PerformanceMetricContributionInput,
  PersistPerformanceMetricContributionResult,
} from './performance-metric-types.js';
export { persistPerformanceMetricContribution } from './performance-metric-repository.js';
export type {
  PersistPerformanceEventSampleInput,
  PersistPerformanceEventSampleResult,
} from './performance-sample-types.js';
export { persistPerformanceEventSample } from './performance-sample-repository.js';
```

`packages/processing-store/test/integration/migrations.test.ts` 的 beforeAll 追加 DROP：

```ts
    await pool.query('DROP TABLE IF EXISTS performance_metric_event_applications CASCADE');
    await pool.query('DROP TABLE IF EXISTS performance_metric_buckets CASCADE');
    await pool.query('DROP TABLE IF EXISTS performance_event_samples CASCADE');
```

**同一 DROP 三行也必须追加到** `test/integration/error-occurrence.test.ts`、`test/integration/request-sample.test.ts`、`test/integration/request-metric.test.ts` **的 beforeAll**（这三个既有集成文件同样在 beforeAll 重跑全部 Migration，缺少性能表 DROP 会导致 `relation "performance_metric_buckets" already exists` 失败）。

- [x] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @aurora/processing-store test:package` 与 `pnpm --filter @aurora/processing-store test -- test/security-negative.test.ts`
Expected: PASS。

- [x] **Step 5: Commit 边界（不实际执行）**

```text
逻辑提交边界：feat(processing-store): export performance aggregate and sample API
实际执行：不运行 git add/commit。
```

- [x] **Step 6: 检查差异**

Run: `git diff --check`
Expected: 无输出。

## Task 7：README、正式文档、ADR 证据与状态基线同步

**Files:**
- Modify: `packages/processing-store/README.md`
- Modify: `docs/architecture/performance-metric-aggregate-and-bounded-sample-store.md`（implementation-status → implemented，追加实施记录）
- Modify: `docs/architecture/formalization-readiness.md`
- Modify: `docs/README.md`
- Modify: `docs/adr/ADR-021-performance-aggregate-and-bounded-sample-storage.md`（追加实施证据）
- Modify: `docs/architecture/aurora-v1-remaining-module-batches.md`（remaining 45 → 44）

**Interfaces:**
- Consumes: 全部 Task 的导出、正式规格
- Produces: 文档同步状态

- [x] **Step 1: 写失败测试**

本 Task 是文档同步，无新增代码测试。文档契约与 security-negative 门禁已在 Task 6 落地。执行文档修改后运行完整质量门禁验证一致性。

- [x] **Step 2: 运行测试确认当前状态**

Run: `pnpm --filter @aurora/processing-store test`
Expected: PASS。

- [x] **Step 3: 写最小实现（文档修改）**

**`packages/processing-store/README.md`**：
- "模块定位"追加性能聚合与样本存储；
- "职责"追加 `performance_metric_buckets`/`performance_metric_event_applications`/`performance_event_samples` 与两个 Repository；
- "非职责"追加"不实现 percentile/直方图/超标比例、Performance Processor、Query、页面/环境/发布维度、采样率执行、保留清理"；
- "对外接口"追加两个 Repository 导出与类型；
- "关联文档"追加 ADR-021 与性能规格链接。

**`docs/architecture/performance-metric-aggregate-and-bounded-sample-store.md`**：
- `implementation-status` → `implemented`；
- 追加"实施记录"节：Migration `1722500000006`、三表、两 Repository、真实 PostgreSQL 测试数量、全仓门禁通过。

**`docs/architecture/formalization-readiness.md`**：
- §12 追加 DAT-08 实施记录；
- §7 机器契约表"处理/存储可执行模型"行追加性能存储 implemented。

**`docs/README.md`**：
- §2 权威来源表新增性能聚合/样本存储一行。

**`docs/adr/ADR-021-performance-aggregate-and-bounded-sample-storage.md`**：
- 追加实施证据节；`implementation-status` → implemented。

**`docs/architecture/aurora-v1-remaining-module-batches.md`**：
- frontmatter `completed: 33 → 34`、`remaining: 45 → 44`；
- §2 计数 `45 = 0 + 11 + 34` → `44 = 0 + 11 + 33`；
- §5.3 DAT-08 行标注已关闭；
- §10 覆盖矩阵 G01 4 → 3、Total 45 → 44。

- [x] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @aurora/processing-store test`
Expected: PASS。

- [x] **Step 5: Commit 边界（不实际执行）**

```text
逻辑提交边界：docs(processing-store): performance store spec/readme/baseline sync
实际执行：不运行 git add/commit。
```

- [x] **Step 6: 检查差异**

Run: `git diff --check`
Expected: 无输出。

## 验证命令（最终质量门禁）

全部 Task 完成后，从仓库根目录执行：

```bash
pnpm --filter @aurora/processing-store typecheck      # strict TypeScript
pnpm --filter @aurora/processing-store test           # 单元测试（不连数据库）
pnpm --filter @aurora/processing-store test:integration  # 真实 PostgreSQL 17.10 集成测试
pnpm --filter @aurora/processing-store test:coverage  # 覆盖率 85/80/85/85
pnpm --filter @aurora/processing-store test:package   # 包入口测试（build 后）
pnpm --filter @aurora/processing-store build          # 构建 dist
pnpm --filter @aurora/ingestion-worker test           # Worker 回归
pnpm --filter @aurora/ingestion-worker test:integration  # Worker 集成回归
pnpm lint                                             # ESLint
pnpm typecheck                                        # 全仓类型检查
pnpm check:boundaries                                 # Workspace 依赖边界
pnpm format:check                                     # 格式检查
pnpm openapi:check                                    # OpenAPI 漂移门禁（回归）
pnpm check                                            # 全仓质量门禁
git diff --check                                      # 空白错误
```

集成测试需要真实 PostgreSQL 17 与 `AURORA_TEST_DATABASE_URL`（目标 `aurora_inbox_test` 测试库）。无 DB 环境时记录未运行命令、原因、所需环境、替代证据、剩余风险；不得把 skip 写成通过。

## 回滚方式

- Migration `1722500000006` 可 up/down；发布前缺陷可直接修改未发布 Migration；
- Repository 与 Error/Request store 解耦，移除性能文件与导出不影响既有公共接口；
- 无破坏性数据操作；正式文档可随代码一并回滚。

## deferred 与 out-of-scope

- DAT-09 Performance Processor、DAT-10 Router、DAT-11 production composition；
- DAT-17 Query、percentile/直方图/超标比例；
- 平台 UI、Platform OpenAPI；
- 页面/环境/发布维度（契约缺口）；
- 采样率执行/采样外推、样本容量水位；
- 数据保留清理任务、项目/账号删除传播；
- event-schema 修改、新缓存/队列/云资源。

## 未完成状态处理

- 若 `AURORA_TEST_DATABASE_URL` 不可用：集成测试以 skip 记录，DAT-08 关闭前必须如实标注"集成测试未运行/被跳过"，剩余风险与替代证据写入完成报告；
- 若任何质量门禁失败：停止，调查根因，修复后重跑，不得以部分通过代替完整验证；
- 实际不执行 `git add`/`commit`/`push`，完成报告明确说明。

## 计划自审批记录

> 自检修正记录（2026-08-05）：(1) Task 5 集成测试原计划导入 `persistRequestEventMetricContribution`（不存在），已修正为真实导出 `persistRequestMetricContribution`。(2) Task 6 原计划只在 `migrations.test.ts` beforeAll 加性能表 DROP；实施时发现 `error-occurrence.test.ts`、`request-sample.test.ts`、`request-metric.test.ts` 三个既有集成文件同样在 beforeAll 重跑全部 Migration，也必须追加性能表 DROP，否则全目录 `test:integration` 会因 `relation "performance_metric_buckets" already exists` 失败——已把 Task 6 的 Files/实现说明扩展覆盖这四个文件。(3) Task 2 测试数修正：Step 4 原写"15 个测试"，实际为 14 个（1 个 computeBucketStart + 13 个 parse）。(4) Task 3 重复用例原计划 `const { pool } = fakePool();` 中 `pool` 未使用导致 strict TS6133，实施者改为 `void fakePool();` 保留语义。(5) Task 4 输入测试原计划 `occurredAt: 1_800_000_054_000` 断言 `occurredAtIso: '2027-01-15T08:01:00.000Z'`（误写为分钟取整），实际 `.toISOString()` 为 `2027-01-15T08:00:54.000Z`（样本存储信封 occurredAt 精确时间戳）；已修正测试期望为 `08:00:54.000Z`。Task 4 测试数修正为 10（6 输入 + 4 Repository）。(6) Task 5 集成测试：`performance-sample.test.ts` beforeAll 原计划只 DROP 性能表 + `pgmigrations`，在与其他文件并行时会因遗留 `error_event_occurrences` 失败——已镜像 `performance-metric.test.ts` beforeAll 补上 4 个 error/request DROP；`performance-metric.test.ts` "does not merge across UTC minutes" 用例原计划用默认 projectId: projectA 插入却查询 projectB——已在该插入加 `projectId: projectB`。(7) Task 6 的 `src/index.ts` 导出块在 Task 5 提前应用（Task 5 集成测试导入 `../../src/index.js` 的前置依赖），Task 6 剩余工作仅 package-entry/security-negative 断言与文档同步。(8) Task 6 security-negative 测试原计划禁止 `percentile`/`histogram` 两个 token，但 Task 2 源码的 doc 注释含这两个词（声明其 out-of-scope）；已从禁止列表移除这两个 token，保留"无 percentile/histogram 逻辑/列"的测试意图。其余类型/函数名全计划一致。

- spec coverage: pass（规格 §1—§57 每项要求映射到 Task 1—7；表/约束/Repository/幂等/并发/隐私/Migration/文档全部有 Task 与测试）
- placeholder scan: pass（无 TBD/TODO/appropriate/similar to/handle edge cases/implement validation）
- type consistency: pass（`PerformanceMetricContributionInput`/`PersistPerformanceMetricContributionResult`/`PerformanceMetricBucketParams`/`PersistPerformanceEventSampleInput`/`PersistPerformanceEventSampleResult`/`PerformanceSampleDbParams` 全计划一致）
- SQL/type consistency: pass（表列 `metric_name`/`unit`/`observed_count`/`value_sum`/`value_max`/`sample_body` 与 TS 字段逐列对应；`numeric`/`bigint`/`varchar`/`uuid`/`timestamptz`/`jsonb` 类型一致）
- migration review: pass（追加式；时间戳 `1722500000006` 晚于 `0005`；up/down；不修改既有表）
- idempotency review: pass（`(project_id, event_id)` 应用登记 PK + 样本唯一；`ON CONFLICT DO NOTHING`）
- concurrency review: pass（唯一约束 + 原子 SQL，无显式行锁；并发测试覆盖）
- privacy review: pass（样本白名单投影；无 body/URL/页面/用户字段；security-negative 覆盖）
- authority conflict scan: pass（PRD 5.1.9/§16、Performance Contract、accepted ADR-021、DAT-08 规格无冲突）
- DAT-07 compatibility: pass（不触碰 request processing rules adapter 与 Request store）
- DAT-09 exclusion: pass（无 processor 逻辑）
- DAT-17 exclusion: pass（无读侧投影）
- workspace safety: pass（新文件 `performance-*` 为 DAT-08 专属；不触碰用户既有修改；不执行破坏性 Git）
- required ADR: **ADR-021（accepted，用户 2026-08-05 正式批准）**
- closing leaf: DAT-08 only
- closing count: 1
- remaining after verified completion: 44
- execution authorization: current joint-mode instruction

"自审批"只表示计划可以执行，不得表示 Agent 批准了 ADR 或修改了产品规则。
