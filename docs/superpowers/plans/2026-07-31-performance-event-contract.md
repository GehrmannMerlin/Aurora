# Performance Event Contract (性能事件协议契约第一增量) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `@aurora/event-schema` 中冻结并实施性能事件协议契约第一增量：性能指标类别/名称/单位常量、安全性能正文、`parsePerformanceEventBody`/`parsePerformanceEventEnvelope` 解析器与三类性能契约样本。

**Architecture:** 镜像已实施请求事件契约的协议模式：新增 `performance-event-types.ts`（常量、限制、类型）、`performance-event-body.ts`（正文解析器）、`performance-event-envelope.ts`（信封解析器复用 `parseEventEnvelope`），复用既有 `field-validation.ts` 与 `value-boundaries.ts` 中立助手，不复制校验逻辑。`contract-testkit` 新增三组性能样本，包根新增性能导出。指标范围严格限定为 PRD 5.1.9 批准的 LCP、INP、CLS、页面加载耗时，不自创指标。

**Tech Stack:** TypeScript 6.0.3（root `strict`/`exactOptionalPropertyTypes`/`noUncheckedIndexedAccess`）、Vitest 4.1.10、@vitest/coverage-v8 4.1.10、pnpm Workspace 11.17.0、Node.js ≥24.18.0。

**Plan status:** ready-for-implementation（联合模式自动审批通过后执行；禁止 `git add`/`commit`/`push`）。

## Global Constraints

- 只修改 `packages/event-schema`，不修改 Core、Browser、plugin-error、plugin-request 的公共接口，不创建新包。
- `event-schema` 保持零运行时依赖、零本地 Workspace 依赖、`aurora.layer: protocol`、`sideEffects: false`、恰好两个公共入口（`.` 与 `./contract-testkit`）。
- 指标范围严格限定为 PRD 5.1.9 批准的四项：`lcp`、`inp`、`cls`、`page_load`；禁止 `fcp`、`ttfb`、`fid`、`tbt`、`custom_metric` 等未批准指标。
- 采样率（PRD 默认 10%）、聚合、统计、问题识别不进入协议层。
- 解析器为同步、确定性、非抛出；不修改输入，不记录输入，成功结果全部新建。
- 复用 `field-validation.ts`（`isPlainRecord`、`readRequiredField`、`rejectUnknownFields`、`addValidationIssue`）与 `value-boundaries.ts`（`validateBodyValue`），不复制其逻辑。
- 不增加新 `EventSchemaIssueCode`；复用 `missing_required_field`、`invalid_type`、`unknown_field`、`invalid_enum`、`string_empty`、`invalid_number`、`invalid_timestamp`、`event_type_mismatch`。
- 文件 kebab-case，类型/接口 PascalCase，函数/变量 camelCase，布尔值 `is`/`has`/`can`/`should` 前缀。禁止无说明 `any`、`Object`、`Function`、`Record<string, any>`、双重断言、非空断言、`@ts-ignore`。
- 不创建 `utils`/`helpers`/`common`/`misc`。生产源码不使用 `console`、DOM、`PerformanceObserver`、`performance.*`、Node 运行时。
- 覆盖率阈值 lines ≥ 85 / branches ≥ 80 / functions ≥ 85 / statements ≥ 85，由 `packages/event-schema/vitest.config.ts` 固定，不得排除逻辑文件。
- ADR-003/005/006 保持 `accepted / in-progress`，ADR-007 保持 `accepted / implemented`，本计划不改变任何 ADR 状态。

---

## 文件树

```text
packages/event-schema/
├── src/
│   ├── index.ts                           # Modify：新增性能导出
│   ├── performance-event-types.ts         # Create：常量、限制、正文/信封/结果类型
│   ├── performance-event-body.ts          # Create：parsePerformanceEventBody
│   ├── performance-event-envelope.ts      # Create：parsePerformanceEventEnvelope
│   └── contract-testkit/
│       ├── boundary-performance-event-samples.ts  # Create
│       ├── invalid-performance-event-samples.ts   # Create
│       ├── valid-performance-event-samples.ts     # Create
│       └── index.ts                       # Modify：新增性能样本导出
└── test/
    ├── performance-event-body.test.ts     # Create
    ├── performance-event-envelope.test.ts # Create
    ├── performance-event-types.test.ts    # Create
    ├── package-entry.test.ts              # Modify：扩展根入口与样本入口断言
    ├── architecture-boundary.test.ts      # Modify：扩展禁止项
    └── consumers/
        ├── ingestion-performance-event.contract.test.ts   # Create
        ├── processing-performance-event.contract.test.ts  # Create
        └── sdk-performance-event.contract.test.ts         # Create
```

根文件修改（跨 Task 使用）：`packages/event-schema/README.md`、`docs/protocol/event-envelope-v1.md`、`docs/README.md`、`docs/architecture/sdk-architecture.md`、`docs/architecture/formalization-readiness.md`、`docs/adr/ADR-003-sdk-plugin-architecture.md`、`docs/adr/ADR-005-event-schema-source-of-truth.md`、`docs/adr/ADR-006-one-way-dependencies.md`、`AGENTS.md`、`AURORA_RULES.md`、根 `README.md`。

---

### Task 1: 性能事件类型、限制与正文解析器

**Files:**
- Create: `packages/event-schema/src/performance-event-types.ts`
- Create: `packages/event-schema/src/performance-event-body.ts`
- Create: `packages/event-schema/test/performance-event-types.test.ts`
- Create: `packages/event-schema/test/performance-event-body.test.ts`

**Interfaces:**
- Consumes: 既有 `field-validation.ts`（`isPlainRecord`、`readRequiredField`、`rejectUnknownFields`、`addValidationIssue`）、`value-boundaries.ts`（`validateBodyValue`）、`validation-issues.ts`（`EventSchemaIssue`、`EventEnvelopeParseFailure`）、`event-envelope.ts`（`EventEnvelope`）、`event-types.ts`（`EventType`）。
- Produces: `PerformanceMetricCategory`、`PerformanceMetricName`、`PerformanceMetricUnit`、`PERFORMANCE_EVENT_LIMITS`、`PerformanceEventBody`、`PerformanceEventBodyParseResult`/`Success`/`Failure`、`PerformanceEventEnvelope`、`PerformanceEventEnvelopeParseResult`/`Success`/`Failure`、`parsePerformanceEventBody`（后续 Task 依赖）。

- [ ] **Step 1: 写失败的性能类型测试**

`packages/event-schema/test/performance-event-types.test.ts`：

```ts
import {
  PERFORMANCE_EVENT_LIMITS,
  PerformanceMetricCategory,
  PerformanceMetricName,
  PerformanceMetricUnit,
} from '../src/index.js';
import { describe, expect, it } from 'vitest';

describe('performance event types', () => {
  it('exposes exactly the approved metric category, names, and units', () => {
    expect(PerformanceMetricCategory).toEqual({ Page: 'page' });
    expect(PerformanceMetricName).toEqual({
      Lcp: 'lcp',
      Inp: 'inp',
      Cls: 'cls',
      PageLoad: 'page_load',
    });
    expect(PerformanceMetricUnit).toEqual({ Millisecond: 'millisecond', Ratio: 'ratio' });
  });

  it('exposes bounded performance limits', () => {
    expect(PERFORMANCE_EVENT_LIMITS).toEqual({
      maxMetricNameLength: 64,
      maxValueSafeInteger: 2147483647,
      maxRatioValue: 1,
      maxDurationMs: 86400000,
    });
  });

  it('does not include unapproved metrics', () => {
    const values = Object.values(PerformanceMetricName);
    for (const unapproved of ['fcp', 'ttfb', 'fid', 'tbt', 'custom_metric']) {
      expect(values).not.toContain(unapproved);
    }
  });
});
```

- [ ] **Step 2: 运行测试确认预期失败**

Run: `pnpm --filter @aurora/event-schema exec vitest run test/performance-event-types.test.ts`
Expected: FAIL，`../src/index.js` 无 `PerformanceMetricCategory` 导出。

- [ ] **Step 3: 写失败的正文解析测试**

`packages/event-schema/test/performance-event-body.test.ts`：

```ts
import { PERFORMANCE_EVENT_LIMITS } from '../src/index.js';
import { parsePerformanceEventBody } from '../src/performance-event-body.js';
import { describe, expect, it } from 'vitest';

describe('performance event body parsing', () => {
  it('parses a minimal successful LCP in milliseconds', () => {
    expect(
      parsePerformanceEventBody({
        metricCategory: 'page',
        metricName: 'lcp',
        value: 2500,
        unit: 'millisecond',
        startedAt: 1_800_000_005_000,
      }),
    ).toEqual({
      success: true,
      data: {
        metricCategory: 'page',
        metricName: 'lcp',
        value: 2500,
        unit: 'millisecond',
        startedAt: 1_800_000_005_000,
      },
    });
  });

  it('parses a CLS ratio without integer constraint', () => {
    const result = parsePerformanceEventBody({
      metricCategory: 'page',
      metricName: 'cls',
      value: 0.125,
      unit: 'ratio',
      startedAt: 1_800_000_005_001,
    });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error('must succeed');
    expect(result.data.value).toBe(0.125);
  });

  it('parses all four approved metric names', () => {
    for (const metricName of ['lcp', 'inp', 'cls', 'page_load'] as const) {
      const unit = metricName === 'cls' ? 'ratio' : 'millisecond';
      const value = metricName === 'cls' ? 0.1 : 1500;
      expect(
        parsePerformanceEventBody({
          metricCategory: 'page',
          metricName,
          value,
          unit,
          startedAt: 1_800_000_005_002,
        }).success,
      ).toBe(true);
    }
  });

  it('accepts an optional durationMs', () => {
    expect(
      parsePerformanceEventBody({
        metricCategory: 'page',
        metricName: 'page_load',
        value: 3200,
        unit: 'millisecond',
        startedAt: 1_800_000_005_003,
        durationMs: 3400,
      }).success,
    ).toBe(true);
  });

  it.each([
    [
      { metricName: 'lcp', value: 2500, unit: 'millisecond', startedAt: 1 },
      'missing_required_field',
    ],
    [
      { metricCategory: 'page', value: 2500, unit: 'millisecond', startedAt: 1 },
      'missing_required_field',
    ],
    [
      { metricCategory: 'page', metricName: 'lcp', unit: 'millisecond', startedAt: 1 },
      'missing_required_field',
    ],
    [
      { metricCategory: 'page', metricName: 'lcp', value: 2500, startedAt: 1 },
      'missing_required_field',
    ],
    [
      { metricCategory: 'page', metricName: 'lcp', value: 2500, unit: 'millisecond' },
      'missing_required_field',
    ],
    [
      { metricCategory: 'Page', metricName: 'lcp', value: 1, unit: 'millisecond', startedAt: 1 },
      'invalid_enum',
    ],
    [
      { metricCategory: 'page', metricName: 'fcp', value: 1, unit: 'millisecond', startedAt: 1 },
      'invalid_enum',
    ],
    [
      { metricCategory: 'page', metricName: 'lcp', value: 1, unit: 'second', startedAt: 1 },
      'invalid_enum',
    ],
    [
      { metricCategory: 'page', metricName: 'lcp', value: -1, unit: 'millisecond', startedAt: 1 },
      'invalid_number',
    ],
    [
      { metricCategory: 'page', metricName: 'lcp', value: 2500.5, unit: 'millisecond', startedAt: 1 },
      'invalid_number',
    ],
    [
      { metricCategory: 'page', metricName: 'lcp', value: Number.NaN, unit: 'millisecond', startedAt: 1 },
      'invalid_number',
    ],
    [
      { metricCategory: 'page', metricName: 'cls', value: 1.5, unit: 'ratio', startedAt: 1 },
      'invalid_number',
    ],
    [
      { metricCategory: 'page', metricName: 'cls', value: -0.1, unit: 'ratio', startedAt: 1 },
      'invalid_number',
    ],
    [
      { metricCategory: 'page', metricName: 'lcp', value: 2147483648, unit: 'millisecond', startedAt: 1 },
      'invalid_number',
    ],
    [
      { metricCategory: 'page', metricName: 'lcp', value: 1, unit: 'millisecond', startedAt: 0 },
      'invalid_timestamp',
    ],
    [
      {
        metricCategory: 'page',
        metricName: 'lcp',
        value: 1,
        unit: 'millisecond',
        startedAt: 1,
        durationMs: 86400001,
      },
      'invalid_number',
    ],
    [
      {
        metricCategory: 'page',
        metricName: 'lcp',
        value: 1,
        unit: 'millisecond',
        startedAt: 1,
        durationMs: -1,
      },
      'invalid_number',
    ],
    [
      {
        metricCategory: 'page',
        metricName: 'lcp',
        value: 1,
        unit: 'millisecond',
        startedAt: 1,
        page: 'x',
      },
      'unknown_field',
    ],
  ] as const)('rejects invalid performance body %# with %s', (input, issueCode) => {
    const result = parsePerformanceEventBody(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.map(({ code }) => code)).toContain(issueCode);
    }
  });

  it('does not modify the input object', () => {
    const input = Object.freeze({
      metricCategory: 'page',
      metricName: 'lcp',
      value: 2500,
      unit: 'millisecond',
      startedAt: 1_800_000_005_004,
    });
    const before = { ...input };
    parsePerformanceEventBody(input);
    expect(input).toEqual(before);
  });

  it('does not retain input object references in the success result', () => {
    const input = {
      metricCategory: 'page',
      metricName: 'lcp',
      value: 2500,
      unit: 'millisecond',
      startedAt: 1_800_000_005_005,
    };
    const result = parsePerformanceEventBody(input);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error('must succeed');
    expect(result.data).not.toBe(input);
  });
});
```

- [ ] **Step 4: 运行正文测试确认预期失败**

Run: `pnpm --filter @aurora/event-schema exec vitest run test/performance-event-body.test.ts`
Expected: FAIL，`../src/performance-event-body.js` 不存在。

- [ ] **Step 5: 写最小实现**

`packages/event-schema/src/performance-event-types.ts`：

```ts
import type { EventEnvelope } from './event-envelope.js';
import type { EventType } from './event-types.js';
import type { EventEnvelopeParseFailure } from './validation-issues.js';

export const PerformanceMetricCategory = Object.freeze({
  Page: 'page',
} as const);

export type PerformanceMetricCategory =
  (typeof PerformanceMetricCategory)[keyof typeof PerformanceMetricCategory];

export const PerformanceMetricName = Object.freeze({
  Lcp: 'lcp',
  Inp: 'inp',
  Cls: 'cls',
  PageLoad: 'page_load',
} as const);

export type PerformanceMetricName =
  (typeof PerformanceMetricName)[keyof typeof PerformanceMetricName];

export const PerformanceMetricUnit = Object.freeze({
  Millisecond: 'millisecond',
  Ratio: 'ratio',
} as const);

export type PerformanceMetricUnit =
  (typeof PerformanceMetricUnit)[keyof typeof PerformanceMetricUnit];

export const PERFORMANCE_EVENT_LIMITS = Object.freeze({
  maxMetricNameLength: 64,
  maxValueSafeInteger: 2147483647,
  maxRatioValue: 1,
  maxDurationMs: 86400000,
} as const);

export interface PerformanceEventBody {
  readonly metricCategory: PerformanceMetricCategory;
  readonly metricName: PerformanceMetricName;
  readonly value: number;
  readonly unit: PerformanceMetricUnit;
  readonly startedAt: number;
  readonly durationMs?: number;
}

export interface PerformanceEventEnvelope extends EventEnvelope {
  readonly eventType: typeof EventType.Performance;
  readonly body: PerformanceEventBody;
}

export interface PerformanceEventBodyParseSuccess {
  readonly success: true;
  readonly data: PerformanceEventBody;
}

export type PerformanceEventBodyParseFailure = EventEnvelopeParseFailure;
export type PerformanceEventBodyParseResult =
  PerformanceEventBodyParseSuccess | PerformanceEventBodyParseFailure;

export interface PerformanceEventEnvelopeParseSuccess {
  readonly success: true;
  readonly data: PerformanceEventEnvelope;
}

export type PerformanceEventEnvelopeParseFailure = EventEnvelopeParseFailure;
export type PerformanceEventEnvelopeParseResult =
  PerformanceEventEnvelopeParseSuccess | PerformanceEventEnvelopeParseFailure;
```

`packages/event-schema/src/performance-event-body.ts`：

```ts
import {
  PERFORMANCE_EVENT_LIMITS,
  PerformanceMetricCategory,
  PerformanceMetricName,
  PerformanceMetricUnit,
  type PerformanceEventBodyParseResult,
} from './performance-event-types.js';
import {
  addValidationIssue,
  isPlainRecord,
  readRequiredField,
  rejectUnknownFields,
} from './field-validation.js';
import type { EventSchemaIssue } from './validation-issues.js';
import { validateBodyValue } from './value-boundaries.js';

const PERFORMANCE_BODY_FIELDS: ReadonlySet<string> = new Set([
  'metricCategory',
  'metricName',
  'value',
  'unit',
  'startedAt',
  'durationMs',
]);
const metricCategories: ReadonlySet<unknown> = new Set(Object.values(PerformanceMetricCategory));
const metricNames: ReadonlySet<unknown> = new Set(Object.values(PerformanceMetricName));
const metricUnits: ReadonlySet<unknown> = new Set(Object.values(PerformanceMetricUnit));

function unsafeBodyFailure(): PerformanceEventBodyParseResult {
  return {
    success: false,
    issues: [
      {
        code: 'invalid_type',
        path: ['body'],
        message: 'Performance event body could not be read safely',
      },
    ],
  };
}

function parseCategory(input: unknown, issues: EventSchemaIssue[]): PerformanceMetricCategory | undefined {
  const path = ['body', 'metricCategory'] as const;
  if (typeof input !== 'string') {
    addValidationIssue(issues, 'invalid_type', path, 'Performance metric category must be a string');
    return undefined;
  }
  if (!metricCategories.has(input)) {
    addValidationIssue(issues, 'invalid_enum', path, 'Performance metric category is not supported');
    return undefined;
  }
  return PerformanceMetricCategory.Page;
}

function parseMetricName(input: unknown, issues: EventSchemaIssue[]): PerformanceMetricName | undefined {
  const path = ['body', 'metricName'] as const;
  if (typeof input !== 'string') {
    addValidationIssue(issues, 'invalid_type', path, 'Performance metric name must be a string');
    return undefined;
  }
  if (!metricNames.has(input)) {
    addValidationIssue(issues, 'invalid_enum', path, 'Performance metric name is not supported');
    return undefined;
  }
  if (input === PerformanceMetricName.Lcp) return PerformanceMetricName.Lcp;
  if (input === PerformanceMetricName.Inp) return PerformanceMetricName.Inp;
  if (input === PerformanceMetricName.Cls) return PerformanceMetricName.Cls;
  return PerformanceMetricName.PageLoad;
}

function parseUnit(input: unknown, issues: EventSchemaIssue[]): PerformanceMetricUnit | undefined {
  const path = ['body', 'unit'] as const;
  if (typeof input !== 'string') {
    addValidationIssue(issues, 'invalid_type', path, 'Performance metric unit must be a string');
    return undefined;
  }
  if (!metricUnits.has(input)) {
    addValidationIssue(issues, 'invalid_enum', path, 'Performance metric unit is not supported');
    return undefined;
  }
  return input === PerformanceMetricUnit.Ratio ? PerformanceMetricUnit.Ratio : PerformanceMetricUnit.Millisecond;
}

function parseValue(input: unknown, unit: PerformanceMetricUnit | undefined, issues: EventSchemaIssue[]): number | undefined {
  const path = ['body', 'value'] as const;
  if (typeof input !== 'number') {
    addValidationIssue(issues, 'invalid_type', path, 'Performance metric value must be a number');
    return undefined;
  }
  if (unit === PerformanceMetricUnit.Ratio) {
    if (
      !Number.isFinite(input) ||
      input < 0 ||
      input > PERFORMANCE_EVENT_LIMITS.maxRatioValue
    ) {
      addValidationIssue(issues, 'invalid_number', path, 'Ratio value must be finite and between 0 and 1');
      return undefined;
    }
    return input;
  }
  if (
    !Number.isSafeInteger(input) ||
    input < 0 ||
    input > PERFORMANCE_EVENT_LIMITS.maxValueSafeInteger
  ) {
    addValidationIssue(issues, 'invalid_number', path, 'Millisecond value must be a non-negative safe integer');
    return undefined;
  }
  return input;
}

function parseStartedAt(input: unknown, issues: EventSchemaIssue[]): number | undefined {
  const path = ['body', 'startedAt'] as const;
  if (typeof input !== 'number') {
    addValidationIssue(issues, 'invalid_type', path, 'startedAt must be a number');
    return undefined;
  }
  if (!Number.isSafeInteger(input) || input <= 0) {
    addValidationIssue(
      issues,
      'invalid_timestamp',
      path,
      'startedAt must be a positive safe integer in Unix epoch milliseconds',
    );
    return undefined;
  }
  return input;
}

function parseDurationMs(input: unknown, issues: EventSchemaIssue[]): number | undefined {
  const path = ['body', 'durationMs'] as const;
  if (typeof input !== 'number') {
    addValidationIssue(issues, 'invalid_type', path, 'durationMs must be a number');
    return undefined;
  }
  if (
    !Number.isSafeInteger(input) ||
    input < 0 ||
    input > PERFORMANCE_EVENT_LIMITS.maxDurationMs
  ) {
    addValidationIssue(issues, 'invalid_number', path, 'durationMs must be a safe integer between 0 and 86400000');
    return undefined;
  }
  return input;
}

function parseBody(input: unknown): PerformanceEventBodyParseResult {
  const issues: EventSchemaIssue[] = [];
  validateBodyValue(input, issues);
  if (issues.length > 0) return { success: false, issues };
  if (!isPlainRecord(input)) {
    addValidationIssue(
      issues,
      'invalid_type',
      ['body'],
      'Performance event body must be a plain object',
    );
    return { success: false, issues };
  }
  rejectUnknownFields(input, PERFORMANCE_BODY_FIELDS, issues, ['body']);
  const categoryField = readRequiredField(input, 'metricCategory', issues, ['body']);
  const nameField = readRequiredField(input, 'metricName', issues, ['body']);
  const valueField = readRequiredField(input, 'value', issues, ['body']);
  const unitField = readRequiredField(input, 'unit', issues, ['body']);
  const startedAtField = readRequiredField(input, 'startedAt', issues, ['body']);
  const hasDurationMs = Object.prototype.hasOwnProperty.call(input, 'durationMs');
  const category = categoryField.found ? parseCategory(categoryField.value, issues) : undefined;
  const metricName = nameField.found ? parseMetricName(nameField.value, issues) : undefined;
  const unit = unitField.found ? parseUnit(unitField.value, issues) : undefined;
  const value = valueField.found ? parseValue(valueField.value, unit, issues) : undefined;
  const startedAt = startedAtField.found ? parseStartedAt(startedAtField.value, issues) : undefined;
  const durationMs = hasDurationMs ? parseDurationMs(input.durationMs, issues) : undefined;
  if (
    issues.length > 0 ||
    category === undefined ||
    metricName === undefined ||
    value === undefined ||
    unit === undefined ||
    startedAt === undefined ||
    (hasDurationMs && durationMs === undefined)
  ) {
    return { success: false, issues };
  }
  return {
    success: true,
    data: {
      metricCategory: category,
      metricName,
      value,
      unit,
      startedAt,
      ...(durationMs === undefined ? {} : { durationMs }),
    },
  };
}

export function parsePerformanceEventBody(input: unknown): PerformanceEventBodyParseResult {
  try {
    return parseBody(input);
  } catch {
    return unsafeBodyFailure();
  }
}
```

- [ ] **Step 6: 在包根导出性能常量与类型**

修改 `packages/event-schema/src/index.ts`，追加：

```ts
export {
  PERFORMANCE_EVENT_LIMITS,
  PerformanceMetricCategory,
  PerformanceMetricName,
  PerformanceMetricUnit,
} from './performance-event-types.js';
export type {
  PerformanceEventBody,
  PerformanceEventBodyParseFailure,
  PerformanceEventBodyParseResult,
  PerformanceEventBodyParseSuccess,
  PerformanceEventEnvelope,
  PerformanceEventEnvelopeParseFailure,
  PerformanceEventEnvelopeParseResult,
  PerformanceEventEnvelopeParseSuccess,
} from './performance-event-types.js';
export { parsePerformanceEventBody } from './performance-event-body.js';
```

（`parsePerformanceEventEnvelope` 在 Task 2 加入；本 Task 不导出它，避免引用不存在的文件。）

- [ ] **Step 7: 运行测试确认通过**

Run: `pnpm --filter @aurora/event-schema exec vitest run test/performance-event-types.test.ts test/performance-event-body.test.ts`
Expected: PASS（types 3 个 + body 若干全部通过）。

- [ ] **Step 8: 相关回归**

Run: `pnpm --filter @aurora/event-schema exec vitest run test/request-event-body.test.ts test/error-event-envelope.test.ts`
Expected: PASS（既有错误/请求契约不受影响）。

- [ ] **Step 9: 建议提交边界**

不执行 `git add`/`commit`。若另行授权，本 Task 边界为三个新文件（types/body 与两个测试）+ `src/index.ts` 的性能常量/类型/正文解析器导出。

---

### Task 2: 性能信封解析器与包根出口

**Files:**
- Create: `packages/event-schema/src/performance-event-envelope.ts`
- Create: `packages/event-schema/test/performance-event-envelope.test.ts`
- Modify: `packages/event-schema/src/index.ts`（追加 `parsePerformanceEventEnvelope` 导出）
- Modify: `packages/event-schema/test/package-entry.test.ts`（扩展根入口断言）

**Interfaces:**
- Consumes: Task 1 的 `parsePerformanceEventBody`、`PerformanceEventEnvelope`/`PerformanceEventEnvelopeParseResult`；既有 `parseEventEnvelope`、`EventType`。
- Produces: `parsePerformanceEventEnvelope`（Task 3 的样本与消费者测试依赖）。

- [ ] **Step 1: 写失败的信封解析测试**

`packages/event-schema/test/performance-event-envelope.test.ts`：

```ts
import { EventType, parseEventEnvelope } from '../src/index.js';
import { parsePerformanceEventEnvelope } from '../src/performance-event-envelope.js';
import { describe, expect, it } from 'vitest';

describe('performance event envelope parsing', () => {
  it('parses a valid performance envelope', () => {
    const input = {
      protocolVersion: 1,
      eventId: 'evt-perf-valid',
      eventType: 'performance',
      occurredAt: 1_800_000_005_100,
      body: {
        metricCategory: 'page',
        metricName: 'inp',
        value: 180,
        unit: 'millisecond',
        startedAt: 1_800_000_005_000,
      },
    };
    const result = parsePerformanceEventEnvelope(input);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error('must succeed');
    expect(result.data.eventType).toBe(EventType.Performance);
    expect(result.data.body).toEqual({
      metricCategory: 'page',
      metricName: 'inp',
      value: 180,
      unit: 'millisecond',
      startedAt: 1_800_000_005_000,
    });
  });

  it('rejects a performance body with a non-performance event type', () => {
    const input = {
      protocolVersion: 1,
      eventId: 'evt-perf-mismatch',
      eventType: 'error',
      occurredAt: 1_800_000_005_101,
      body: {
        metricCategory: 'page',
        metricName: 'lcp',
        value: 2500,
        unit: 'millisecond',
        startedAt: 1_800_000_005_000,
      },
    };
    const result = parsePerformanceEventEnvelope(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.map(({ code }) => code)).toContain('event_type_mismatch');
    }
  });

  it('rejects an error body with a performance event type', () => {
    const result = parsePerformanceEventEnvelope({
      protocolVersion: 1,
      eventId: 'evt-perf-mismatch-2',
      eventType: 'performance',
      occurredAt: 1_800_000_005_102,
      body: {
        category: 'javascript_error',
        error: { name: 'TypeError', message: 'x', stack: 'x' },
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.map(({ code }) => code)).toContain('missing_required_field');
    }
  });

  it('rejects an unsupported protocol version through the shared envelope parser', () => {
    const result = parsePerformanceEventEnvelope({
      protocolVersion: 2,
      eventId: 'evt-perf-version',
      eventType: 'performance',
      occurredAt: 1_800_000_005_103,
      body: {
        metricCategory: 'page',
        metricName: 'lcp',
        value: 2500,
        unit: 'millisecond',
        startedAt: 1_800_000_005_000,
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.map(({ code }) => code)).toContain('unsupported_protocol_version');
    }
  });

  it('keeps generic envelope issues unchanged', () => {
    const result = parsePerformanceEventEnvelope({
      protocolVersion: 1,
      eventId: '',
      eventType: 'performance',
      occurredAt: 1_800_000_005_104,
      body: {
        metricCategory: 'page',
        metricName: 'lcp',
        value: 2500,
        unit: 'millisecond',
        startedAt: 1_800_000_005_000,
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      // parseEventEnvelope validates a non-empty eventId as invalid_type.
      expect(result.issues.map(({ code }) => code)).toContain('invalid_type');
    }
  });

  it('uses the same body path for body and envelope parsing', () => {
    const bodyResult = parsePerformanceEventEnvelope({
      protocolVersion: 1,
      eventId: 'evt-perf-path',
      eventType: 'performance',
      occurredAt: 1_800_000_005_105,
      body: {
        metricCategory: 'page',
        metricName: 'lcp',
        value: 2500,
        unit: 'millisecond',
        startedAt: 1_800_000_005_000,
        extra: true,
      },
    });
    expect(bodyResult.success).toBe(false);
    if (!bodyResult.success) {
      const unknownIssue = bodyResult.issues.find((issue) => issue.code === 'unknown_field');
      expect(unknownIssue?.path).toEqual(['body', 'extra']);
    }
  });

  it('is a deterministic non-throwing parser that does not modify input', () => {
    const input = Object.freeze({
      protocolVersion: 1,
      eventId: 'evt-perf-frozen',
      eventType: 'performance',
      occurredAt: 1_800_000_005_106,
      body: {
        metricCategory: 'page',
        metricName: 'cls',
        value: 0.05,
        unit: 'ratio',
        startedAt: 1_800_000_005_000,
      },
    });
    const before = JSON.stringify(input);
    const result = parsePerformanceEventEnvelope(input);
    expect(JSON.stringify(input)).toBe(before);
    expect(typeof result).toBe('object');
  });
});
```

- [ ] **Step 2: 运行信封测试确认预期失败**

Run: `pnpm --filter @aurora/event-schema exec vitest run test/performance-event-envelope.test.ts`
Expected: FAIL，`../src/performance-event-envelope.js` 不存在。

- [ ] **Step 3: 写最小实现**

`packages/event-schema/src/performance-event-envelope.ts`：

```ts
import { parsePerformanceEventBody } from './performance-event-body.js';
import type { PerformanceEventEnvelopeParseResult } from './performance-event-types.js';
import { parseEventEnvelope } from './event-envelope.js';
import { EventType } from './event-types.js';

function unsafeEnvelopeFailure(): PerformanceEventEnvelopeParseResult {
  return {
    success: false,
    issues: [
      {
        code: 'invalid_type',
        path: [],
        message: 'Performance event envelope could not be read safely',
      },
    ],
  };
}

function parseEnvelope(input: unknown): PerformanceEventEnvelopeParseResult {
  const envelopeResult = parseEventEnvelope(input);
  if (!envelopeResult.success) return envelopeResult;
  if (envelopeResult.data.eventType !== EventType.Performance) {
    return {
      success: false,
      issues: [
        {
          code: 'event_type_mismatch',
          path: ['eventType'],
          message: 'Performance event body requires the performance event type',
        },
      ],
    };
  }
  const bodyResult = parsePerformanceEventBody(envelopeResult.data.body);
  if (!bodyResult.success) return bodyResult;
  return {
    success: true,
    data: {
      protocolVersion: envelopeResult.data.protocolVersion,
      eventId: envelopeResult.data.eventId,
      eventType: EventType.Performance,
      occurredAt: envelopeResult.data.occurredAt,
      body: bodyResult.data,
    },
  };
}

export function parsePerformanceEventEnvelope(input: unknown): PerformanceEventEnvelopeParseResult {
  try {
    return parseEnvelope(input);
  } catch {
    return unsafeEnvelopeFailure();
  }
}
```

修改 `packages/event-schema/src/index.ts`，追加：

```ts
export { parsePerformanceEventEnvelope } from './performance-event-envelope.js';
```

- [ ] **Step 4: 运行信封测试确认通过**

Run: `pnpm --filter @aurora/event-schema exec vitest run test/performance-event-envelope.test.ts`
Expected: PASS。

- [ ] **Step 5: 扩展包入口测试**

修改 `packages/event-schema/test/package-entry.test.ts` 的根入口断言，追加性能符号。在根入口 `Object.keys` 期望列表中加入：

```ts
'PERFORMANCE_EVENT_LIMITS,PerformanceMetricCategory,PerformanceMetricName,' +
'PerformanceMetricUnit,parsePerformanceEventBody,parsePerformanceEventEnvelope,'
```

（精确位置依现有断言拼接方式调整；同时私有路径负例列表加入 `performance-event-body`、`performance-event-envelope`、`performance-event-types`。）

Run: `pnpm --filter @aurora/event-schema test:package`
Expected: PASS（构建后根入口含性能符号，私有路径全部 `ERR_PACKAGE_PATH_NOT_EXPORTED`）。

- [ ] **Step 6: 相关回归**

Run: `pnpm --filter @aurora/event-schema exec vitest run test/request-event-envelope.test.ts test/error-event-envelope.test.ts test/package-entry.test.ts`
Expected: PASS。

- [ ] **Step 7: 建议提交边界**

不执行 `git add`/`commit`。若另行授权，本 Task 边界为信封解析器新文件、信封测试、`src/index.ts` 追加、`test/package-entry.test.ts` 扩展。

---

### Task 3: 契约样本、消费者契约与覆盖率门禁

**Files:**
- Create: `packages/event-schema/src/contract-testkit/valid-performance-event-samples.ts`
- Create: `packages/event-schema/src/contract-testkit/invalid-performance-event-samples.ts`
- Create: `packages/event-schema/src/contract-testkit/boundary-performance-event-samples.ts`
- Create: `packages/event-schema/test/consumers/sdk-performance-event.contract.test.ts`
- Create: `packages/event-schema/test/consumers/ingestion-performance-event.contract.test.ts`
- Create: `packages/event-schema/test/consumers/processing-performance-event.contract.test.ts`
- Modify: `packages/event-schema/src/contract-testkit/index.ts`

**Interfaces:**
- Consumes: Task 1/2 的常量、类型、`parsePerformanceEventBody`、`parsePerformanceEventEnvelope`；`CURRENT_PROTOCOL_VERSION`、`EventType`。
- Produces: `valid/invalid/boundaryPerformanceEventSamples` 三组样本，供 SDK/接入/处理消费者契约测试复用。

- [ ] **Step 1: 写失败的样本**

`packages/event-schema/src/contract-testkit/valid-performance-event-samples.ts`：

```ts
import { CURRENT_PROTOCOL_VERSION } from '../constants.js';
import {
  PerformanceMetricCategory,
  PerformanceMetricName,
  PerformanceMetricUnit,
  type PerformanceEventBody,
  type PerformanceEventEnvelope,
} from '../performance-event-types.js';
import { EventType } from '../event-types.js';

export interface ValidPerformanceEventSample {
  readonly name: string;
  readonly input: unknown;
  readonly expected: PerformanceEventEnvelope;
}

function envelope(
  eventId: string,
  body: PerformanceEventBody,
  occurredAt: number,
): PerformanceEventEnvelope {
  return {
    protocolVersion: CURRENT_PROTOCOL_VERSION,
    eventId,
    eventType: EventType.Performance,
    occurredAt,
    body,
  };
}

const lcpBody = {
  metricCategory: PerformanceMetricCategory.Page,
  metricName: PerformanceMetricName.Lcp,
  value: 2500,
  unit: PerformanceMetricUnit.Millisecond,
  startedAt: 1_800_000_005_000,
} as const;
const inpBody = {
  metricCategory: PerformanceMetricCategory.Page,
  metricName: PerformanceMetricName.Inp,
  value: 180,
  unit: PerformanceMetricUnit.Millisecond,
  startedAt: 1_800_000_005_001,
} as const;
const clsBody = {
  metricCategory: PerformanceMetricCategory.Page,
  metricName: PerformanceMetricName.Cls,
  value: 0.125,
  unit: PerformanceMetricUnit.Ratio,
  startedAt: 1_800_000_005_002,
} as const;
const pageLoadBody = {
  metricCategory: PerformanceMetricCategory.Page,
  metricName: PerformanceMetricName.PageLoad,
  value: 3200,
  unit: PerformanceMetricUnit.Millisecond,
  startedAt: 1_800_000_005_003,
  durationMs: 3400,
} as const;

export const validPerformanceEventSamples: readonly ValidPerformanceEventSample[] = [
  {
    name: 'LCP in milliseconds',
    input: envelope('evt-perf-valid-lcp', lcpBody, 1_800_000_005_500),
    expected: envelope('evt-perf-valid-lcp', lcpBody, 1_800_000_005_500),
  },
  {
    name: 'INP in milliseconds',
    input: envelope('evt-perf-valid-inp', inpBody, 1_800_000_005_501),
    expected: envelope('evt-perf-valid-inp', inpBody, 1_800_000_005_501),
  },
  {
    name: 'CLS as a ratio',
    input: envelope('evt-perf-valid-cls', clsBody, 1_800_000_005_502),
    expected: envelope('evt-perf-valid-cls', clsBody, 1_800_000_005_502),
  },
  {
    name: 'page load with duration',
    input: envelope('evt-perf-valid-load', pageLoadBody, 1_800_000_005_503),
    expected: envelope('evt-perf-valid-load', pageLoadBody, 1_800_000_005_503),
  },
];
```

`packages/event-schema/src/contract-testkit/invalid-performance-event-samples.ts`：

```ts
import { CURRENT_PROTOCOL_VERSION } from '../constants.js';
import { EventType } from '../event-types.js';
import type { EventSchemaIssueCode } from '../validation-issues.js';

export interface InvalidPerformanceEventSample {
  readonly name: string;
  readonly input: unknown;
  readonly expectedIssueCode: EventSchemaIssueCode;
}

function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    metricCategory: 'page',
    metricName: 'lcp',
    value: 2500,
    unit: 'millisecond',
    startedAt: 1_800_000_005_000,
    ...overrides,
  };
}

function drop(...keys: readonly string[]): Record<string, unknown> {
  const base = body();
  for (const key of keys) delete base[key];
  return base;
}

function envelope(candidate: unknown): unknown {
  return {
    protocolVersion: CURRENT_PROTOCOL_VERSION,
    eventId: 'evt-perf-invalid-synthetic',
    eventType: EventType.Performance,
    occurredAt: 1_800_000_005_600,
    body: candidate,
  };
}

export const invalidPerformanceEventSamples: readonly InvalidPerformanceEventSample[] = [
  { name: 'missing category', input: envelope(drop('metricCategory')), expectedIssueCode: 'missing_required_field' },
  { name: 'missing name', input: envelope(drop('metricName')), expectedIssueCode: 'missing_required_field' },
  { name: 'missing value', input: envelope(drop('value')), expectedIssueCode: 'missing_required_field' },
  { name: 'missing unit', input: envelope(drop('unit')), expectedIssueCode: 'missing_required_field' },
  { name: 'missing startedAt', input: envelope(drop('startedAt')), expectedIssueCode: 'missing_required_field' },
  { name: 'unknown category', input: envelope(body({ metricCategory: 'resource' })), expectedIssueCode: 'invalid_enum' },
  { name: 'unapproved metric', input: envelope(body({ metricName: 'fcp' })), expectedIssueCode: 'invalid_enum' },
  { name: 'unknown unit', input: envelope(body({ unit: 'second' })), expectedIssueCode: 'invalid_enum' },
  { name: 'negative millisecond', input: envelope(body({ value: -1 })), expectedIssueCode: 'invalid_number' },
  { name: 'non-integer millisecond', input: envelope(body({ value: 2500.5 })), expectedIssueCode: 'invalid_number' },
  { name: 'NaN value', input: envelope(body({ value: Number.NaN })), expectedIssueCode: 'invalid_number' },
  { name: 'ratio over one', input: envelope(body({ metricName: 'cls', value: 1.5, unit: 'ratio' })), expectedIssueCode: 'invalid_number' },
  { name: 'startedAt zero', input: envelope(body({ startedAt: 0 })), expectedIssueCode: 'invalid_timestamp' },
  { name: 'duration over limit', input: envelope(body({ durationMs: 86400001 })), expectedIssueCode: 'invalid_number' },
  { name: 'unknown field', input: envelope(body({ page: 'x' })), expectedIssueCode: 'unknown_field' },
];
```

（注意：invalid 样本必须包进完整 `EventType.Performance` 信封，因为 ingestion 消费者测试用 `parsePerformanceEventEnvelope` 校验——与请求契约的 `invalidRequestEventSamples` 形态一致。缺字段用 `drop()` 删除键而非设为 `undefined`，因为 `readRequiredField` 对值为 `undefined` 的自有键返回 `invalid_type` 而非 `missing_required_field`。）

`packages/event-schema/src/contract-testkit/boundary-performance-event-samples.ts`：

```ts
import { CURRENT_PROTOCOL_VERSION } from '../constants.js';
import {
  PERFORMANCE_EVENT_LIMITS,
  PerformanceMetricCategory,
  PerformanceMetricName,
  PerformanceMetricUnit,
  type PerformanceEventEnvelope,
} from '../performance-event-types.js';
import { EventType } from '../event-types.js';
import type { EventSchemaIssueCode } from '../validation-issues.js';

export interface BoundaryPerformanceEventSample {
  readonly name: string;
  readonly input: unknown;
  readonly isValid: boolean;
  readonly expected?: PerformanceEventEnvelope;
  readonly expectedIssueCode?: EventSchemaIssueCode;
}

function envelope(eventId: string, body: unknown, occurredAt: number): unknown {
  return {
    protocolVersion: CURRENT_PROTOCOL_VERSION,
    eventId,
    eventType: EventType.Performance,
    occurredAt,
    body,
  };
}

export const boundaryPerformanceEventSamples: readonly BoundaryPerformanceEventSample[] = [
  {
    name: 'zero millisecond value',
    input: envelope('evt-perf-boundary-zero', {
      metricCategory: PerformanceMetricCategory.Page,
      metricName: PerformanceMetricName.Lcp,
      value: 0,
      unit: PerformanceMetricUnit.Millisecond,
      startedAt: 1_800_000_005_000,
    }, 1_800_000_005_500),
    isValid: true,
  },
  {
    name: 'ratio at one',
    input: envelope('evt-perf-boundary-ratio-one', {
      metricCategory: PerformanceMetricCategory.Page,
      metricName: PerformanceMetricName.Cls,
      value: 1,
      unit: PerformanceMetricUnit.Ratio,
      startedAt: 1_800_000_005_001,
    }, 1_800_000_005_501),
    isValid: true,
  },
  {
    name: 'millisecond at max safe integer',
    input: envelope('evt-perf-boundary-max', {
      metricCategory: PerformanceMetricCategory.Page,
      metricName: PerformanceMetricName.Lcp,
      value: PERFORMANCE_EVENT_LIMITS.maxValueSafeInteger,
      unit: PerformanceMetricUnit.Millisecond,
      startedAt: 1_800_000_005_002,
    }, 1_800_000_005_502),
    isValid: true,
  },
  {
    name: 'ratio over one',
    input: envelope('evt-perf-boundary-ratio-over', {
      metricCategory: PerformanceMetricCategory.Page,
      metricName: PerformanceMetricName.Cls,
      value: 1.0001,
      unit: PerformanceMetricUnit.Ratio,
      startedAt: 1_800_000_005_003,
    }, 1_800_000_005_503),
    isValid: false,
    expectedIssueCode: 'invalid_number',
  },
  {
    name: 'millisecond over max',
    input: envelope('evt-perf-boundary-over', {
      metricCategory: PerformanceMetricCategory.Page,
      metricName: PerformanceMetricName.Lcp,
      value: PERFORMANCE_EVENT_LIMITS.maxValueSafeInteger + 1,
      unit: PerformanceMetricUnit.Millisecond,
      startedAt: 1_800_000_005_004,
    }, 1_800_000_005_504),
    isValid: false,
    expectedIssueCode: 'invalid_number',
  },
];
```

修改 `packages/event-schema/src/contract-testkit/index.ts`，追加：

```ts
export {
  boundaryPerformanceEventSamples,
  type BoundaryPerformanceEventSample,
} from './boundary-performance-event-samples.js';
export {
  invalidPerformanceEventSamples,
  type InvalidPerformanceEventSample,
} from './invalid-performance-event-samples.js';
export {
  validPerformanceEventSamples,
  type ValidPerformanceEventSample,
} from './valid-performance-event-samples.js';
```

- [ ] **Step 2: 写失败的三类消费者契约测试**

`packages/event-schema/test/consumers/sdk-performance-event.contract.test.ts`：

```ts
import { validPerformanceEventSamples } from '../../src/contract-testkit/index.js';
import { parsePerformanceEventEnvelope } from '../../src/performance-event-envelope.js';
import { describe, expect, it } from 'vitest';

describe('SDK performance event consumer contract', () => {
  it('parses every valid performance sample as a full envelope', () => {
    for (const sample of validPerformanceEventSamples) {
      const result = parsePerformanceEventEnvelope(sample.input);
      expect(result.success, sample.name).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(sample.expected);
      }
    }
  });
});
```

`packages/event-schema/test/consumers/ingestion-performance-event.contract.test.ts`：

```ts
import { invalidPerformanceEventSamples } from '../../src/contract-testkit/index.js';
import { parsePerformanceEventEnvelope } from '../../src/performance-event-envelope.js';
import { describe, expect, it } from 'vitest';

describe('ingestion performance event consumer contract', () => {
  it('rejects every invalid performance sample with a stable issue code', () => {
    for (const sample of invalidPerformanceEventSamples) {
      const result = parsePerformanceEventEnvelope(sample.input);
      expect(result.success, sample.name).toBe(false);
      if (!result.success) {
        expect(result.issues.map(({ code }) => code), sample.name).toContain(
          sample.expectedIssueCode,
        );
      }
    }
  });
});
```

`packages/event-schema/test/consumers/processing-performance-event.contract.test.ts`：

```ts
import { boundaryPerformanceEventSamples } from '../../src/contract-testkit/index.js';
import { parsePerformanceEventEnvelope } from '../../src/performance-event-envelope.js';
import { describe, expect, it } from 'vitest';

describe('processing performance event consumer contract', () => {
  it('accepts valid boundary samples and rejects invalid ones with the expected code', () => {
    for (const sample of boundaryPerformanceEventSamples) {
      const result = parsePerformanceEventEnvelope(sample.input);
      expect(result.success, sample.name).toBe(sample.isValid);
      if (!result.success && sample.expectedIssueCode !== undefined) {
        expect(result.issues.map(({ code }) => code), sample.name).toContain(
          sample.expectedIssueCode,
        );
      }
    }
  });
});
```

- [ ] **Step 3: 运行消费者测试确认预期失败**

Run: `pnpm --filter @aurora/event-schema exec vitest run test/consumers/sdk-performance-event.contract.test.ts test/consumers/ingestion-performance-event.contract.test.ts test/consumers/processing-performance-event.contract.test.ts`
Expected: FAIL，样本或 `parsePerformanceEventEnvelope` 尚未导出。

- [ ] **Step 4: 确认全部通过**

Run: `pnpm --filter @aurora/event-schema exec vitest run test/consumers/performance-event.contract.test.ts 2>/dev/null; pnpm --filter @aurora/event-schema exec vitest run test/consumers/sdk-performance-event.contract.test.ts test/consumers/ingestion-performance-event.contract.test.ts test/consumers/processing-performance-event.contract.test.ts`
Expected: PASS。

Run: `pnpm --filter @aurora/event-schema test`
Expected: PASS（全部测试文件，含既有错误/请求契约回归）。

Run: `pnpm --filter @aurora/event-schema test:coverage`
Expected: PASS，lines ≥ 85 / branches ≥ 80 / functions ≥ 85 / statements ≥ 85。

- [ ] **Step 5: 相关回归**

Run: `pnpm --filter @aurora/event-schema typecheck` 与 `pnpm check:boundaries`
Expected: PASS（exit 0）。

- [ ] **Step 6: 建议提交边界**

不执行 `git add`/`commit`。若另行授权，本 Task 边界为三组样本、三类消费者测试、`contract-testkit/index.ts` 追加。

---

### Task 4: 包入口/架构边界扩展、README、正式文档与 ADR 证据、完整门禁

**Files:**
- Modify: `packages/event-schema/test/architecture-boundary.test.ts`（扩展禁止项与性能入口断言）
- Modify: `packages/event-schema/README.md`
- Modify: `docs/protocol/event-envelope-v1.md`
- Modify: `docs/README.md`
- Modify: `docs/architecture/sdk-architecture.md`
- Modify: `docs/architecture/formalization-readiness.md`
- Modify: `docs/adr/ADR-003-sdk-plugin-architecture.md`、`docs/adr/ADR-005-event-schema-source-of-truth.md`、`docs/adr/ADR-006-one-way-dependencies.md`
- Modify: `AGENTS.md`、`AURORA_RULES.md`、根 `README.md`

**Interfaces:**
- Consumes: 全部前述 Task 交付物与三组样本。
- Produces: 包入口/架构负例、README 文档契约、正式文档同步、ADR 实施证据与根级完整门禁。

- [ ] **Step 1: 扩展架构边界测试**

修改 `packages/event-schema/test/architecture-boundary.test.ts`：
- 源码扫描禁止项追加 `PerformanceObserver`、`performance.`；
- 根出口断言追加 `PerformanceMetricCategory`、`PerformanceMetricName`、`PerformanceMetricUnit`、`PERFORMANCE_EVENT_LIMITS`、`parsePerformanceEventBody`、`parsePerformanceEventEnvelope`；
- 私有路径负例列表追加 `performance-event-body`、`performance-event-envelope`、`performance-event-types`。

Run: `pnpm --filter @aurora/event-schema exec vitest run test/architecture-boundary.test.ts test/package-entry.test.ts`
Expected: PASS。

- [ ] **Step 2: 更新包 README**

修改 `packages/event-schema/README.md`，把"只有错误与请求事件契约"更新为"错误、请求与性能事件契约第一增量"，新增性能 API 清单（四个指标名、两个单位、解析器）、指标范围限制（仅 PRD 5.1.9 四项）、隐私与排除范围。

Run: `pnpm --filter @aurora/event-schema exec vitest run test/documentation-contract.test.ts`
Expected: PASS（README 中的 JSON 示例由文档契约测试提取并执行）。

- [ ] **Step 3: 同步正式文档**

- `docs/protocol/event-envelope-v1.md`：链接 `docs/protocol/performance-event-contract.md`，明确 `parseEventEnvelope` 与精确性能解析器的层次；
- `docs/README.md`：加入性能事件契约条目，保持性能事实源/性能插件/传输缺失；
- `docs/architecture/sdk-architecture.md`：记录性能事件机器契约已存在，性能观测与性能插件仍不存在；
- `docs/architecture/formalization-readiness.md`：把 A1 更新为信封基础加错误、请求与性能正文第一增量，其他正文、批次、兼容转换和真实系统消费者仍受阻。

- [ ] **Step 4: 追加 ADR 实施证据**

- `docs/adr/ADR-005-event-schema-source-of-truth.md` 追加性能事件协议契约第一增量实施记录，保持 `accepted / in-progress`；
- `docs/adr/ADR-006-one-way-dependencies.md` 追加协议层性能契约零本地依赖与公开入口证据，保持 `accepted / in-progress`；
- `docs/adr/ADR-003-sdk-plugin-architecture.md` 追加性能协议前置契约澄清，保持 `accepted / in-progress`。

- [ ] **Step 5: 更新入口快照**

`AGENTS.md` 与 `AURORA_RULES.md` 更新当前真实包/决策队列：`@aurora/event-schema` 从"错误与请求事件契约第一增量"更新为"错误、请求与性能事件契约第一增量"。

- [ ] **Step 6: 根级完整质量门禁**

Run: `pnpm install --frozen-lockfile`
Expected: PASS（exit 0，锁文件未改变——本增量不改依赖）。

Run: `pnpm format:check`
Expected: PASS（exit 0）。

Run: `pnpm lint`
Expected: PASS（exit 0）。

Run: `pnpm typecheck`
Expected: PASS（exit 0）。

Run: `pnpm test`
Expected: PASS（exit 0，全部包）。

Run: `pnpm test:coverage`
Expected: PASS（exit 0，event-schema 满足 85/80/85/85）。

Run: `pnpm check:boundaries`
Expected: PASS（exit 0）。

Run: `pnpm build`
Expected: PASS（exit 0）。

Run: `pnpm check:ci`
Expected: PASS（exit 0，含既有 Chromium 门禁）。

Run: `git diff --check`
Expected: PASS（exit 0）。

- [ ] **Step 7: 测量体积并记录**

Run: `node --input-type=module -e "import{readFileSync}from'node:fs';const f=['performance-event-body','performance-event-envelope','performance-event-types'];const r=f.map(x=>readFileSync('packages/event-schema/dist/'+x+'.js','utf8')).join('\\n');console.log('raw',Buffer.byteLength(r),'gzip',require('zlib').gzipSync(r).length)" 2>/dev/null || node -e "const fs=require('fs'),z=require('zlib');const f=['performance-event-body','performance-event-envelope','performance-event-types'];const r=f.map(x=>fs.readFileSync('packages/event-schema/dist/'+x+'.js','utf8')).join('\\n');console.log('raw',Buffer.byteLength(r),'gzip',z.gzipSync(r).length);"`

Expected: 输出 raw/gzip 字节数，记录到规格第 20 节实施证据，标记 `requires-benchmark`。

- [ ] **Step 8: 建议提交边界**

不执行 `git add`/`commit`。若另行授权，本 Task 边界为 architecture-boundary 测试、README、三个正式文档、三个 ADR 追加记录、`AGENTS.md`、`AURORA_RULES.md`、根 README。
