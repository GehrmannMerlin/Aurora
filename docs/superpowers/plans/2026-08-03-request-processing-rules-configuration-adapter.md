# DAT-07 Request Processing Rules/Configuration Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `apps/ingestion-worker`（`@aurora/ingestion-worker`）实现请求处理规则/配置 adapter 第一增量：`createRequestProcessingRulesAdapter` 工厂 + `DEFAULT_REQUEST_PROCESSING_RULES` + `RequestProcessingRules` 配置模型，作为既有 `ClassifyRequestEvent` 分类端口的真实规则实现，使 `createRequestEventProcessor` 从注入确定 fake 升级为注入真实规则分类。

**Architecture:** 纯进程内 adapter：工厂接收不可变 `RequestProcessingRules` 快照（慢阈值 + 失败状态码集合 + 慢状态码集合 + 额外监控状态码集合），递归冻结后返回实现 `ClassifyRequestEvent` 的 `classify` 方法。分类是确定性布尔计算（`isFailure`/`isSlow`/`isAdditionalMonitoredStatus`），无随机、无时钟、无副作用、无数据库、无日志。不接入生产 composition root；不新增 Migration/数据库表/跨包依赖。

**Tech Stack:** TypeScript strict（`exactOptionalPropertyTypes`/`noUncheckedIndexedAccess`）、Node.js 24、Vitest 4、`@aurora/event-schema` 包根（`RequestOutcome`/`REQUEST_EVENT_LIMITS`）、`./request-event-processor.ts` 端口类型、真实 PostgreSQL 17.10 集成测试。

**本计划关闭叶子模块：DAT-07**
**本计划关闭叶子数量：1**
**成功完成后的 remaining_v1_leaf_modules：45**

## Global Constraints

- 不修改 `@aurora/event-schema`、`@aurora/processing-store`、`@aurora/ingestion-inbox` 公共 API；不修改 request-event-contract；
- 不新增 `apps/ingestion-worker` 的 `package.json` 依赖；
- 不创建数据库表、Migration、Redis、队列或云资源；不接生产 composition root；不创建生产 bin/start；不实现总事件路由器；
- `ClassifyRequestEvent`/`createRequestEventProcessor` 公共签名不变；既有 fake 分类注入继续可用；
- 默认慢阈值 3000ms、失败状态码默认含 429 与 500—599、`additionalMonitoredStatusCodes`/`slowStatusCodes` 默认空（不扩大监控范围）；
- 禁止采集/记录请求体、响应体、Header、Cookie、Authorization、完整 URL、查询参数值、页面文本、用户信息；禁止写日志；禁止 `Date.now`/`Math.random`/`process.env`；
- 配置非法或缺失时必须抛稳定 `RequestProcessingRulesAdapterError`（`invalid_rules`），不静默回退任意默认；
- 严格 TypeScript、单一职责、文件 kebab-case、类型 PascalCase、函数 camelCase、布尔 `is` 前缀、无 `utils`/`helpers`/`common`；
- 覆盖率门槛 lines ≥ 85%、branches ≥ 80%、functions ≥ 85%、statements ≥ 85%；不得删除或弱化失败测试；
- 本计划执行实际**不执行 `git add`/`git commit`/`git push`**；Commit 步骤只作为逻辑提交边界保留。

## 固定回读与权威边界

| Module ID | 完整回读文件 | 重点章节 | 本计划不得改变的业务逻辑 | 缺失门禁 |
| --- | --- | --- | --- | --- |
| DAT-07 | `Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md`；`Aurora 架构规范.md`；`docs/architecture/system-overview.md`；`Aurora 代码规范.md`；`Aurora 测试规范.md`；`Aurora ADR 规范.md`；`Aurora 文档规范.md`；`docs/protocol/request-event-contract.md`；`docs/protocol/error-event-contract.md`；`docs/protocol/performance-event-contract.md`；`docs/protocol/ingestion-batch-and-receipt-contract.md`；`docs/architecture/request-event-sample-processing-store.md`；`docs/architecture/request-metric-aggregate-store.md`；`docs/architecture/request-sample-selection-policy.md`；`docs/architecture/request-event-processor.md`；`docs/adr/ADR-019-request-event-aggregation-and-bounded-diagnostic-sample-storage.md`；`docs/adr/ADR-020-idempotent-request-metric-bucket-aggregation.md`；`docs/architecture/formalization-readiness.md`；`docs/adr/README.md` | PRD §5.1.2、§5.1.3、§5.1.5、§5.1.6、§15；Request Processor §9、§16、§30；ADR-019 决定细节 3/4/14；ADR-020 决定细节 5/20；Sample Selection Policy §11/§12；架构规范 §2.3.3、§2.11 | 请求分类（失败/慢/额外监控状态）、默认慢阈值 3000ms 与可覆盖、普通 4xx 默认不监控、网络失败/超时/429/5xx 失败语义、样本类别有界性由样本选择策略强制、配置失败不静默降级、处理失败语义 | approved DAT-07 spec（`docs/architecture/request-processing-rules-configuration-adapter.md`，本计划依赖）；ADR 判断完成（无需新 ADR）；现有 Request Processor 公共接口稳定 |

## 文件结构映射

```text
apps/ingestion-worker/
├── src/
│   ├── request-processing-rules-adapter.ts      # Create：RequestProcessingRules 模型、默认规则、工厂、错误类、classify
│   └── index.ts                                 # Modify：追加包根导出
├── test/
│   ├── request-processing-rules-adapter.test.ts # Create：单元测试（默认/覆盖/非法/冻结/确定性/隐私）
│   ├── integration/
│   │   └── request-processing-rules-adapter.test.ts # Create：真实 PostgreSQL adapter→processor 组合
│   ├── package-entry.test.ts                    # Modify：追加包根导出断言
│   ├── documentation-contract.test.ts           # Modify：追加规格对齐断言
│   └── security-negative.test.ts                # Modify：追加 adapter 源码安全负例
├── README.md                                    # Modify：职责、接口、边界
└── package.json                                 # 不修改（无新依赖）

docs/
├── architecture/request-processing-rules-configuration-adapter.md  # Create（已存在，规格）
├── architecture/formalization-readiness.md      # Modify：DAT-07 implemented 状态记录
├── README.md                                    # Modify：模块表新增一行
├── adr/ADR-019-request-event-aggregation-and-bounded-diagnostic-sample-storage.md # Modify：追加实施证据
├── adr/ADR-020-idempotent-request-metric-bucket-aggregation.md      # Modify：追加实施证据
└── superpowers/plans/2026-08-03-request-processing-rules-configuration-adapter.md # 本计划
```

### 单一职责

| 文件 | 单一职责 |
| --- | --- |
| `src/request-processing-rules-adapter.ts` | 规则模型 + 默认规则 + 配置校验 + 冻结 + 确定性分类；单一文件承载本模块全部核心逻辑 |
| `test/request-processing-rules-adapter.test.ts` | adapter 单元测试：分类矩阵、覆盖规则、非法配置、冻结、确定性、隐私负例 |
| `test/integration/request-processing-rules-adapter.test.ts` | 真实 PostgreSQL：adapter → Request Processor 组合的指标/样本行为 |
| `src/index.ts` | worker 包根公共出口（最小追加导出） |
| `test/package-entry.test.ts` / `documentation-contract.test.ts` / `security-negative.test.ts` | 包入口、文档对齐、安全负例门禁 |
| `apps/ingestion-worker/README.md` | 模块职责、对外接口、非职责边界 |

## 范围与排除

**本轮范围**：adapter 核心能力 + 包根导出 + 单元/集成测试 + README + 正式规格/状态/ADR 证据同步。Request Processor 分类端口接线示例（集成测试证明组合可用）。

**明确排除（不在本计划实现）**：真实配置存储/Repository、配置管理 HTTP API、管理平台 UI、生产 composition root 接线、生产 bin/start、总事件路由器、动态配置刷新、慢请求采样率（20%）执行、SDK allowlist/路径归一化/同源判断、DAT-08 Performance store、DAT-09 Performance processor、DAT-10 router、DAT-11 production composition、DAT-16 Query、Issue/告警/用量/平台 UI。

## Task 1：RequestProcessingRules 类型、默认规则与错误类

**Files:**
- Create: `apps/ingestion-worker/src/request-processing-rules-adapter.ts`

**Interfaces:**
- Consumes: `@aurora/event-schema` 包根（`RequestOutcome` 常量、`REQUEST_EVENT_LIMITS` 类型）
- Produces:
  ```ts
  export interface RequestProcessingRules {
    readonly slowRequestThresholdMs: number;
    readonly failureStatusCodes: ReadonlySet<number>;
    readonly slowStatusCodes: ReadonlySet<number>;
    readonly additionalMonitoredStatusCodes: ReadonlySet<number>;
  }
  export type RequestProcessingRulesAdapterErrorKind = 'invalid_rules';
  export class RequestProcessingRulesAdapterError extends Error {
    readonly kind: RequestProcessingRulesAdapterErrorKind;
  }
  export const DEFAULT_REQUEST_PROCESSING_RULES: RequestProcessingRules;
  ```

- [x] **Step 1: 写失败测试**

在 `apps/ingestion-worker/test/request-processing-rules-adapter.test.ts` 建立测试骨架，先只写三个失败测试：

```ts
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REQUEST_PROCESSING_RULES,
  RequestProcessingRulesAdapterError,
} from '../src/request-processing-rules-adapter.js';

describe('request processing rules adapter', () => {
  it('exports a frozen default rules snapshot with PRD 5.1.3 default threshold', () => {
    expect(DEFAULT_REQUEST_PROCESSING_RULES.slowRequestThresholdMs).toBe(3000);
    expect(DEFAULT_REQUEST_PROCESSING_RULES.failureStatusCodes.has(429)).toBe(true);
    expect(DEFAULT_REQUEST_PROCESSING_RULES.failureStatusCodes.has(500)).toBe(true);
    expect(DEFAULT_REQUEST_PROCESSING_RULES.failureStatusCodes.has(599)).toBe(true);
    expect(DEFAULT_REQUEST_PROCESSING_RULES.additionalMonitoredStatusCodes.size).toBe(0);
    expect(DEFAULT_REQUEST_PROCESSING_RULES.slowStatusCodes.size).toBe(0);
  });

  it('exposes a stable invalid_rules error kind', () => {
    const error = new RequestProcessingRulesAdapterError('invalid_rules', 'bad rules');
    expect(error.kind).toBe('invalid_rules');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('RequestProcessingRulesAdapterError');
  });
});
```

- [x] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @aurora/ingestion-worker test -- test/request-processing-rules-adapter.test.ts`
Expected: FAIL —— 模块不存在（`Cannot find module '../src/request-processing-rules-adapter.js'`）。

- [x] **Step 3: 写最小实现**

在 `apps/ingestion-worker/src/request-processing-rules-adapter.ts` 写入类型、错误类与默认规则常量：

```ts
import { REQUEST_EVENT_LIMITS } from '@aurora/event-schema';

/** Immutable request classification rules snapshot consumed by the adapter. */
export interface RequestProcessingRules {
  /** Slow-request threshold in milliseconds. PRD 5.1.3 default is 3000; projects may override. */
  readonly slowRequestThresholdMs: number;
  /** Status codes classified as failures (default includes 429 and 500–599). */
  readonly failureStatusCodes: ReadonlySet<number>;
  /** Status codes explicitly classified as slow regardless of duration. */
  readonly slowStatusCodes: ReadonlySet<number>;
  /** Status codes the project explicitly monitors as request problems (default empty). */
  readonly additionalMonitoredStatusCodes: ReadonlySet<number>;
}

/** Stable failure kinds emitted by the adapter factory. */
export type RequestProcessingRulesAdapterErrorKind = 'invalid_rules';

/** Stable error thrown when rules are missing or invalid; never carries rule contents. */
export class RequestProcessingRulesAdapterError extends Error {
  readonly kind: RequestProcessingRulesAdapterErrorKind;

  constructor(kind: RequestProcessingRulesAdapterErrorKind, message: string) {
    super(message);
    this.name = 'RequestProcessingRulesAdapterError';
    this.kind = kind;
  }
}

/** PRD 5.1.2/5.1.3 defaults: slow threshold 3000 ms, failures 429 + 500–599, no extra monitored statuses. */
export const DEFAULT_REQUEST_PROCESSING_RULES: RequestProcessingRules = Object.freeze({
  slowRequestThresholdMs: 3000,
  failureStatusCodes: Object.freeze(new Set([429, 500, 501, 502, 503, 504, 505, 506, 507, 508, 509, 510, 511, 512, 513, 514, 515, 516, 517, 518, 519, 520, 521, 522, 523, 524, 525, 526, 527, 528, 529, 530, 531, 532, 533, 534, 535, 536, 537, 538, 539, 540, 541, 542, 543, 544, 545, 546, 547, 548, 549, 550, 551, 552, 553, 554, 555, 556, 557, 558, 559, 560, 561, 562, 563, 564, 565, 566, 567, 568, 569, 570, 571, 572, 573, 574, 575, 576, 577, 578, 579, 580, 581, 582, 583, 584, 585, 586, 587, 588, 589, 590, 591, 592, 593, 594, 595, 596, 597, 598, 599])),
  slowStatusCodes: Object.freeze(new Set<number>()),
  additionalMonitoredStatusCodes: Object.freeze(new Set<number>()),
});
```

> 说明：`failureStatusCodes` 使用 `429` 加 `500..599` 全量，明确表达"429 + 500 至 599"。`REQUEST_EVENT_LIMITS.maxStatusCode = 599` 保证上界。测试断言 429/500/599 存在。

- [x] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @aurora/ingestion-worker test -- test/request-processing-rules-adapter.test.ts`
Expected: PASS（2 个测试通过）。

- [x] **Step 5: Commit 边界（不实际执行）**

```text
逻辑提交边界：feat(ingestion-worker): request processing rules types, defaults and error class
实际执行：不运行 git add/commit。
```

- [x] **Step 6: 检查差异**

Run: `git diff --check`
Expected: 无输出（无空白错误）。

## Task 2：createRequestProcessingRulesAdapter 工厂与 classify 分类语义

**Files:**
- Modify: `apps/ingestion-worker/src/request-processing-rules-adapter.ts`（追加工厂与 classify）
- Create: `apps/ingestion-worker/test/request-processing-rules-adapter.test.ts`（追加测试）

**Interfaces:**
- Consumes: Task 1 的 `RequestProcessingRules`/`DEFAULT_REQUEST_PROCESSING_RULES`/`RequestProcessingRulesAdapterError`；`./request-event-processor.ts` 的 `ClassifyRequestEvent`/`RequestEventClassification`/`RequestEventClassificationInput`；`@aurora/event-schema` 的 `RequestOutcome`
- Produces:
  ```ts
  export interface RequestProcessingRulesAdapter {
    classify(input: RequestEventClassificationInput): Promise<RequestEventClassification>;
  }
  export interface CreateRequestProcessingRulesAdapterInput {
    readonly rules: RequestProcessingRules;
  }
  export function createRequestProcessingRulesAdapter(
    input: CreateRequestProcessingRulesAdapterInput,
  ): RequestProcessingRulesAdapter;
  ```

- [x] **Step 1: 写失败测试**

在 `test/request-processing-rules-adapter.test.ts` 追加以下测试块（本 Task 先写分类语义测试）：

```ts
import {
  createRequestProcessingRulesAdapter,
  DEFAULT_REQUEST_PROCESSING_RULES,
  RequestProcessingRulesAdapterError,
  type RequestProcessingRules,
} from '../src/request-processing-rules-adapter.js';
import type {
  RequestEventClassificationInput,
} from '../src/request-event-processor.js';

function input(overrides?: Partial<RequestEventClassificationInput>): RequestEventClassificationInput {
  return { outcome: 'success', durationMs: 120, method: 'GET', ...overrides };
}

describe('createRequestProcessingRulesAdapter classify', () => {
  it('marks network failures and timeouts as failures under default rules', async () => {
    const adapter = createRequestProcessingRulesAdapter({ rules: DEFAULT_REQUEST_PROCESSING_RULES });
    expect(await adapter.classify(input({ outcome: 'network_error' }))).toMatchObject({ isFailure: true });
    expect(await adapter.classify(input({ outcome: 'timeout' }))).toMatchObject({ isFailure: true });
  });

  it('marks http_error 429 and 500–599 as failures, ordinary 4xx as non-failure', async () => {
    const adapter = createRequestProcessingRulesAdapter({ rules: DEFAULT_REQUEST_PROCESSING_RULES });
    expect(await adapter.classify(input({ outcome: 'http_error', statusCode: 429 }))).toMatchObject({ isFailure: true });
    expect(await adapter.classify(input({ outcome: 'http_error', statusCode: 503 }))).toMatchObject({ isFailure: true });
    expect(await adapter.classify(input({ outcome: 'http_error', statusCode: 404 }))).toMatchObject({ isFailure: false });
  });

  it('never marks success or canceled as failures', async () => {
    const adapter = createRequestProcessingRulesAdapter({ rules: DEFAULT_REQUEST_PROCESSING_RULES });
    expect(await adapter.classify(input())).toMatchObject({ isFailure: false });
    expect(await adapter.classify(input({ outcome: 'canceled' }))).toMatchObject({ isFailure: false });
  });

  it('classifies slow by default 3000ms threshold, excluding canceled', async () => {
    const adapter = createRequestProcessingRulesAdapter({ rules: DEFAULT_REQUEST_PROCESSING_RULES });
    expect(await adapter.classify(input({ durationMs: 3000 }))).toMatchObject({ isSlow: true });
    expect(await adapter.classify(input({ durationMs: 2999 }))).toMatchObject({ isSlow: false });
    expect(await adapter.classify(input({ outcome: 'canceled', durationMs: 5000 }))).toMatchObject({ isSlow: false });
  });

  it('computes isAdditionalMonitoredStatus only for http_error on configured codes', async () => {
    const rules: RequestProcessingRules = {
      ...DEFAULT_REQUEST_PROCESSING_RULES,
      additionalMonitoredStatusCodes: new Set([404]),
    };
    const adapter = createRequestProcessingRulesAdapter({ rules });
    expect(await adapter.classify(input({ outcome: 'http_error', statusCode: 404 }))).toMatchObject({ isAdditionalMonitoredStatus: true });
    expect(await adapter.classify(input({ outcome: 'http_error', statusCode: 405 }))).toMatchObject({ isAdditionalMonitoredStatus: false });
    expect(await adapter.classify(input({ outcome: 'success' }))).toMatchObject({ isAdditionalMonitoredStatus: false });
  });

  it('applies project overrides for slow threshold, failure codes and slow codes', async () => {
    const rules: RequestProcessingRules = {
      slowRequestThresholdMs: 1000,
      failureStatusCodes: new Set([404]),
      slowStatusCodes: new Set([202]),
      additionalMonitoredStatusCodes: new Set<number>(),
    };
    const adapter = createRequestProcessingRulesAdapter({ rules });
    expect(await adapter.classify(input({ durationMs: 1000 }))).toMatchObject({ isSlow: true });
    expect(await adapter.classify(input({ durationMs: 999 }))).toMatchObject({ isSlow: false });
    expect(await adapter.classify(input({ outcome: 'http_error', statusCode: 404 }))).toMatchObject({ isFailure: true });
    expect(await adapter.classify(input({ outcome: 'http_error', statusCode: 202 }))).toMatchObject({ isSlow: true });
  });

  it('allows failure and slow to be true simultaneously for a slow 5xx', async () => {
    const adapter = createRequestProcessingRulesAdapter({ rules: DEFAULT_REQUEST_PROCESSING_RULES });
    expect(await adapter.classify(input({ outcome: 'http_error', statusCode: 503, durationMs: 3200 }))).toEqual({
      isFailure: true,
      isSlow: true,
      isAdditionalMonitoredStatus: false,
    });
  });

  it('is deterministic and never mutates its input', async () => {
    const adapter = createRequestProcessingRulesAdapter({ rules: DEFAULT_REQUEST_PROCESSING_RULES });
    const original: RequestEventClassificationInput = { outcome: 'http_error', statusCode: 503, durationMs: 2500, method: 'POST' };
    const first = await adapter.classify(original);
    const second = await adapter.classify(original);
    expect(first).toEqual(second);
    expect(original).toEqual({ outcome: 'http_error', statusCode: 503, durationMs: 2500, method: 'POST' });
    for (let i = 0; i < 100; i += 1) {
      expect(await adapter.classify(original)).toEqual(first);
    }
  });
});
```

- [x] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @aurora/ingestion-worker test -- test/request-processing-rules-adapter.test.ts`
Expected: FAIL —— `createRequestProcessingRulesAdapter` 未定义（`Cannot find name`/undefined is not a function）。

- [x] **Step 3: 写最小实现**

在 `apps/ingestion-worker/src/request-processing-rules-adapter.ts` 追加（Task 1 内容之后）：

```ts
import { RequestOutcome } from '@aurora/event-schema';
import type {
  RequestEventClassification,
  RequestEventClassificationInput,
} from './request-event-processor.js';

/** Adapter produced by the factory; implements the request processor classification port. */
export interface RequestProcessingRulesAdapter {
  classify(input: RequestEventClassificationInput): Promise<RequestEventClassification>;
}

export interface CreateRequestProcessingRulesAdapterInput {
  /** Immutable rules snapshot; copied and frozen at factory creation. */
  readonly rules: RequestProcessingRules;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidStatusCodeSet(value: unknown): value is ReadonlySet<number> {
  if (!(value instanceof Set)) return false;
  for (const code of value) {
    if (
      typeof code !== 'number' ||
      !Number.isSafeInteger(code) ||
      code < REQUEST_EVENT_LIMITS.minStatusCode ||
      code > REQUEST_EVENT_LIMITS.maxStatusCode
    ) {
      return false;
    }
  }
  return true;
}

function normalizeRules(rules: RequestProcessingRules): RequestProcessingRules {
  if (!isPlainRecord(rules)) {
    throw new RequestProcessingRulesAdapterError('invalid_rules', 'invalid request processing rules');
  }
  const threshold = rules.slowRequestThresholdMs;
  if (typeof threshold !== 'number' || !Number.isSafeInteger(threshold) || threshold <= 0) {
    throw new RequestProcessingRulesAdapterError('invalid_rules', 'invalid request processing rules');
  }
  for (const key of [
    'failureStatusCodes',
    'slowStatusCodes',
    'additionalMonitoredStatusCodes',
  ] as const) {
    if (!isValidStatusCodeSet(rules[key])) {
      throw new RequestProcessingRulesAdapterError('invalid_rules', 'invalid request processing rules');
    }
  }
  return {
    slowRequestThresholdMs: threshold,
    failureStatusCodes: Object.freeze(new Set(rules.failureStatusCodes)),
    slowStatusCodes: Object.freeze(new Set(rules.slowStatusCodes)),
    additionalMonitoredStatusCodes: Object.freeze(new Set(rules.additionalMonitoredStatusCodes)),
  };
}

/**
 * Create a deterministic request classification adapter implementing the
 * ClassifyRequestEvent port. The rules snapshot is copied and deeply frozen at
 * creation so a retry/replay using the same adapter sees the same classification.
 * Never reads configuration storage, never touches the database, never logs,
 * never mutates its input, never uses randomness or the clock, and throws a
 * stable RequestProcessingRulesAdapterError for missing/invalid rules.
 */
export function createRequestProcessingRulesAdapter(
  input: CreateRequestProcessingRulesAdapterInput,
): RequestProcessingRulesAdapter {
  if (!isPlainRecord(input) || !('rules' in input)) {
    throw new RequestProcessingRulesAdapterError('invalid_rules', 'invalid request processing rules');
  }
  const frozen = normalizeRules(input.rules);

  const classify = async (
    requestInput: RequestEventClassificationInput,
  ): Promise<RequestEventClassification> => {
    const { outcome, statusCode, durationMs } = requestInput;
    const isFailure =
      outcome === RequestOutcome.NetworkError ||
      outcome === RequestOutcome.Timeout ||
      (outcome === RequestOutcome.HttpError &&
        statusCode !== undefined &&
        frozen.failureStatusCodes.has(statusCode));
    const isSlow =
      outcome !== RequestOutcome.Canceled &&
      (durationMs >= frozen.slowRequestThresholdMs ||
        (outcome === RequestOutcome.HttpError &&
          statusCode !== undefined &&
          frozen.slowStatusCodes.has(statusCode)));
    const isAdditionalMonitoredStatus =
      outcome === RequestOutcome.HttpError &&
      statusCode !== undefined &&
      frozen.additionalMonitoredStatusCodes.has(statusCode);
    return { isFailure, isSlow, isAdditionalMonitoredStatus };
  };

  return { classify };
}
```

- [x] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @aurora/ingestion-worker test -- test/request-processing-rules-adapter.test.ts`
Expected: PASS（Task 1 2 个 + Task 2 8 个 = 10 个测试通过）。

- [x] **Step 5: Commit 边界（不实际执行）**

```text
逻辑提交边界：feat(ingestion-worker): request processing rules adapter classify
实际执行：不运行 git add/commit。
```

- [x] **Step 6: 检查差异**

Run: `git diff --check`
Expected: 无输出。

## Task 3：非法配置与冻结语义测试

**Files:**
- Modify: `apps/ingestion-worker/test/request-processing-rules-adapter.test.ts`（追加测试）

**Interfaces:**
- Consumes: Task 1/2 的工厂、错误类、默认规则
- Produces: 无新接口（验证行为）

- [x] **Step 1: 写失败测试**

追加：

```ts
describe('request processing rules adapter invalid rules and freezing', () => {
  it('throws invalid_rules when rules are missing or undefined', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => createRequestProcessingRulesAdapter({ rules: undefined as any })).toThrow(
      RequestProcessingRulesAdapterError,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => createRequestProcessingRulesAdapter(undefined as any)).toThrow(
      RequestProcessingRulesAdapterError,
    );
  });

  it('throws invalid_rules for non-positive, non-finite or non-integer thresholds', async () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        createRequestProcessingRulesAdapter({
          rules: { ...DEFAULT_REQUEST_PROCESSING_RULES, slowRequestThresholdMs: bad },
        }),
      ).toThrow(RequestProcessingRulesAdapterError);
    }
  });

  it('throws invalid_rules for out-of-range or non-integer status codes', async () => {
    for (const badSet of [new Set([99]), new Set([600]), new Set([429.5])]) {
      expect(() =>
        createRequestProcessingRulesAdapter({
          rules: { ...DEFAULT_REQUEST_PROCESSING_RULES, failureStatusCodes: badSet },
        }),
      ).toThrow(RequestProcessingRulesAdapterError);
    }
  });

  it('freezes the snapshot so later mutations of the caller object do not change classification', async () => {
    const source: RequestProcessingRules = {
      slowRequestThresholdMs: 1000,
      failureStatusCodes: new Set([404]),
      slowStatusCodes: new Set<number>(),
      additionalMonitoredStatusCodes: new Set<number>(),
    };
    const adapter = createRequestProcessingRulesAdapter({ rules: source });
    expect(await adapter.classify({ outcome: 'http_error', statusCode: 404, durationMs: 500, method: 'GET' })).toMatchObject({ isFailure: true });
    source.slowRequestThresholdMs = 9999;
    source.failureStatusCodes.add(500);
    expect(await adapter.classify({ outcome: 'http_error', statusCode: 404, durationMs: 500, method: 'GET' })).toMatchObject({ isFailure: true });
    expect(await adapter.classify({ outcome: 'success', durationMs: 1000, method: 'GET' })).toMatchObject({ isSlow: true });
  });
});
```

- [x] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @aurora/ingestion-worker test -- test/request-processing-rules-adapter.test.ts`
Expected: FAIL —— `createRequestProcessingRulesAdapter({ rules: undefined })` 当前会在 `normalizeRules` 中因 `isPlainRecord(undefined)` 返回 false 抛错（该路径实际已抛），但 `isPlainRecord` 未导出且 `input.rules` 读取 undefined 会抛 `TypeError: Cannot read properties of undefined`（未转为稳定错误）。测试失败原因：工厂未对 `rules: undefined` 抛稳定 `RequestProcessingRulesAdapterError`（当前抛原生 TypeError）。

> 说明：本 Task 与 Task 2 的最小实现共用同一文件；为保持 TDD 红绿循环，本 Task 的测试先行失败，随后在第 3 步补强 `createRequestProcessingRulesAdapter` 顶层守卫（对 `input.rules` 显式检查后再 normalize）。

- [x] **Step 3: 写最小实现（补强工厂顶层守卫）**

修改 `createRequestProcessingRulesAdapter` 开头，把"`rules` 缺失/未定义"显式转换为稳定错误：

```ts
export function createRequestProcessingRulesAdapter(
  input: CreateRequestProcessingRulesAdapterInput,
): RequestProcessingRulesAdapter {
  if (
    !isPlainRecord(input) ||
    !('rules' in input) ||
    input.rules === undefined ||
    input.rules === null
  ) {
    throw new RequestProcessingRulesAdapterError('invalid_rules', 'invalid request processing rules');
  }
  const frozen = normalizeRules(input.rules);
  ...
```

- [x] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @aurora/ingestion-worker test -- test/request-processing-rules-adapter.test.ts`
Expected: PASS（全部 14 个测试通过）。

- [x] **Step 5: Commit 边界（不实际执行）**

```text
逻辑提交边界：feat(ingestion-worker): request processing rules adapter validation and freezing
实际执行：不运行 git add/commit。
```

- [x] **Step 6: 检查差异**

Run: `git diff --check`
Expected: 无输出。

## Task 4：包根导出与 package-entry 断言

**Files:**
- Modify: `apps/ingestion-worker/src/index.ts`（追加导出）
- Modify: `apps/ingestion-worker/test/package-entry.test.ts`（追加断言）

**Interfaces:**
- Consumes: Task 1/2 的 `createRequestProcessingRulesAdapter`、`DEFAULT_REQUEST_PROCESSING_RULES`、`RequestProcessingRulesAdapterError`、类型
- Produces: 包根公共出口：`createRequestProcessingRulesAdapter`、`DEFAULT_REQUEST_PROCESSING_RULES`、`RequestProcessingRules`、`RequestProcessingRulesAdapter`、`CreateRequestProcessingRulesAdapterInput`、`RequestProcessingRulesAdapterError`、`RequestProcessingRulesAdapterErrorKind`

- [x] **Step 1: 写失败测试**

在 `apps/ingestion-worker/test/package-entry.test.ts` 顶部导入追加：

```ts
import {
  createRequestProcessingRulesAdapter,
  DEFAULT_REQUEST_PROCESSING_RULES,
} from '../src/index.js';
```

追加测试：

```ts
  it('exports the request processing rules adapter API from the package root', () => {
    expect(typeof createRequestProcessingRulesAdapter).toBe('function');
    expect(DEFAULT_REQUEST_PROCESSING_RULES.slowRequestThresholdMs).toBe(3000);
  });

  it('does not expose the request-processing-rules private path', async () => {
    const index = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
    expect(index).toContain('createRequestProcessingRulesAdapter');
    expect(index).toContain('DEFAULT_REQUEST_PROCESSING_RULES');
  });
```

- [x] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @aurora/ingestion-worker test -- test/package-entry.test.ts`
Expected: FAIL —— `createRequestProcessingRulesAdapter` 从包根导入为 undefined。

- [x] **Step 3: 写最小实现（修改 index.ts 追加导出）**

在 `apps/ingestion-worker/src/index.ts` 末尾（`request-event-processor.js` 导出块之后）追加：

```ts
export {
  createRequestProcessingRulesAdapter,
  DEFAULT_REQUEST_PROCESSING_RULES,
  RequestProcessingRulesAdapterError,
  type CreateRequestProcessingRulesAdapterInput,
  type RequestProcessingRules,
  type RequestProcessingRulesAdapter,
  type RequestProcessingRulesAdapterErrorKind,
} from './request-processing-rules-adapter.js';
```

- [x] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @aurora/ingestion-worker test -- test/package-entry.test.ts`
Expected: PASS。

- [x] **Step 5: Commit 边界（不实际执行）**

```text
逻辑提交边界：feat(ingestion-worker): export request processing rules adapter
实际执行：不运行 git add/commit。
```

- [x] **Step 6: 检查差异**

Run: `git diff --check`
Expected: 无输出。

## Task 5：真实 PostgreSQL 集成测试（adapter → Request Processor 组合）

**Files:**
- Create: `apps/ingestion-worker/test/integration/request-processing-rules-adapter.test.ts`

**Interfaces:**
- Consumes: Task 1/2 的 `createRequestProcessingRulesAdapter`/`DEFAULT_REQUEST_PROCESSING_RULES`；`createRequestEventProcessor`（既有）；`persistRequestMetricContribution`/`persistRequestEventSample`（`@aurora/processing-store` 包根）；`./integration/helpers.js`（`assertIsTestDatabase`/`createTestPool`/`migrateUp`/`ensureRequestProcessingTables`/`clearEventInbox`/`queryRow`/`queryRows`）
- Produces: 真实 PostgreSQL 行为证据

- [x] **Step 1: 写失败测试**

创建 `apps/ingestion-worker/test/integration/request-processing-rules-adapter.test.ts`：

```ts
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  persistRequestEventSample,
  persistRequestMetricContribution,
} from '@aurora/processing-store';
import {
  createRequestEventProcessor,
  createRequestProcessingRulesAdapter,
  DEFAULT_REQUEST_PROCESSING_RULES,
  type RequestProcessingRules,
} from '../../src/index.js';
import type { ProcessIngestionEventInput } from '../../src/processor.js';
import {
  assertIsTestDatabase,
  clearEventInbox,
  createTestPool,
  ensureRequestProcessingTables,
  migrateUp,
  queryRow,
  queryRows,
} from './helpers.js';

const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const describeDb = hasDb ? describe : describe.skip;

const projectA = '11111111-1111-1111-1111-111111111111';

interface MetricBucketRow {
  observed_count: string;
  failure_count: string;
  slow_count: string;
}

interface SampleRow {
  event_id: string;
}

function requestEnvelope(eventId: string, bodyOverrides?: Record<string, unknown>): unknown {
  return {
    protocolVersion: 1,
    eventId,
    eventType: 'request',
    occurredAt: 1_800_000_000_000,
    body: {
      method: 'GET',
      url: 'https://api.example.test/items',
      startedAt: 1_800_000_000_000,
      durationMs: 120,
      outcome: 'success',
      ...bodyOverrides,
    },
  };
}

function processorInput(
  inboxId: number,
  projectId: string,
  eventId: string,
  event: unknown,
): ProcessIngestionEventInput {
  return {
    inboxId,
    projectId,
    eventId,
    event: event as ProcessIngestionEventInput['event'],
    attemptCount: 1,
    leaseId: '00000000-0000-0000-0000-000000000001',
    leaseExpiresAt: new Date('2026-08-03T00:01:00.000Z'),
  };
}

function processorWithRules(pool: Pool, rules: RequestProcessingRules) {
  const adapter = createRequestProcessingRulesAdapter({ rules });
  return createRequestEventProcessor({
    persistMetric: (contribution) => persistRequestMetricContribution(pool, contribution),
    persistSample: (sample) => persistRequestEventSample(pool, sample),
    classify: adapter.classify,
    backoff: { initialDelayMs: 100, maxDelayMs: 1000 },
    entropyProvider: { next: () => 0 },
    now: () => new Date('2026-08-03T00:00:00.000Z'),
  });
}

describeDb('request processing rules adapter with real processor (PostgreSQL 17)', () => {
  let pool: Pool;

  beforeAll(async () => {
    assertIsTestDatabase(process.env.AURORA_TEST_DATABASE_URL ?? '');
    pool = createTestPool();
    await migrateUp();
    await ensureRequestProcessingTables();
    await pool.query('DELETE FROM request_event_samples');
    await pool.query('DELETE FROM request_metric_event_applications');
    await pool.query('DELETE FROM request_metric_buckets');
    await pool.query('DELETE FROM error_event_occurrences');
    await clearEventInbox(pool);
  });

  afterAll(async () => {
    await pool.query('DELETE FROM request_event_samples').catch(() => undefined);
    await pool.query('DELETE FROM request_metric_event_applications').catch(() => undefined);
    await pool.query('DELETE FROM request_metric_buckets').catch(() => undefined);
    await pool.query('DELETE FROM error_event_occurrences').catch(() => undefined);
    await clearEventInbox(pool).catch(() => undefined);
    await pool.end();
  });

  it('default rules classify a fast success as non-failure non-slow and skip the sample', async () => {
    const processor = processorWithRules(pool, DEFAULT_REQUEST_PROCESSING_RULES);
    const result = await processor.process(
      processorInput(1, projectA, 'adp-ok-1', requestEnvelope('adp-ok-1', { durationMs: 200 })),
      new AbortController().signal,
    );
    expect(result).toEqual({ outcome: 'processed' });
    const bucket = await queryRow<MetricBucketRow>(
      pool,
      `SELECT observed_count, failure_count, slow_count FROM request_metric_buckets
       WHERE project_id = $1 AND method = 'GET' AND outcome = 'success' AND status_code = 0`,
      [projectA],
    );
    expect(bucket?.observed_count).toBe('1');
    expect(bucket?.failure_count).toBe('0');
    expect(bucket?.slow_count).toBe('0');
    const samples = await queryRows<SampleRow>(
      pool,
      `SELECT event_id FROM request_event_samples WHERE project_id = $1 AND event_id = 'adp-ok-1'`,
      [projectA],
    );
    expect(samples).toHaveLength(0);
  });

  it('default rules classify a 3200ms success as slow and store a bounded sample', async () => {
    const processor = processorWithRules(pool, DEFAULT_REQUEST_PROCESSING_RULES);
    const result = await processor.process(
      processorInput(2, projectA, 'adp-slow-1', requestEnvelope('adp-slow-1', { durationMs: 3200, method: 'POST' })),
      new AbortController().signal,
    );
    expect(result).toEqual({ outcome: 'processed' });
    const bucket = await queryRow<MetricBucketRow>(
      pool,
      `SELECT observed_count, failure_count, slow_count FROM request_metric_buckets
       WHERE project_id = $1 AND method = 'POST' AND outcome = 'success' AND status_code = 0`,
      [projectA],
    );
    expect(bucket?.observed_count).toBe('1');
    expect(bucket?.slow_count).toBe('1');
    const samples = await queryRows<SampleRow>(
      pool,
      `SELECT event_id FROM request_event_samples WHERE project_id = $1 AND event_id = 'adp-slow-1'`,
      [projectA],
    );
    expect(samples).toHaveLength(1);
  });

  it('default rules classify http_error 503 as failure and store a sample', async () => {
    const processor = processorWithRules(pool, DEFAULT_REQUEST_PROCESSING_RULES);
    const result = await processor.process(
      processorInput(3, projectA, 'adp-503-1', requestEnvelope('adp-503-1', { outcome: 'http_error', statusCode: 503, method: 'PUT' })),
      new AbortController().signal,
    );
    expect(result).toEqual({ outcome: 'processed' });
    const bucket = await queryRow<MetricBucketRow>(
      pool,
      `SELECT observed_count, failure_count FROM request_metric_buckets
       WHERE project_id = $1 AND method = 'PUT' AND outcome = 'http_error' AND status_code = 503`,
      [projectA],
    );
    expect(bucket?.observed_count).toBe('1');
    expect(bucket?.failure_count).toBe('1');
    const samples = await queryRows<SampleRow>(
      pool,
      `SELECT event_id FROM request_event_samples WHERE project_id = $1 AND event_id = 'adp-503-1'`,
      [projectA],
    );
    expect(samples).toHaveLength(1);
  });

  it('project override marks 404 as additional-monitored status and stores a configured_status sample', async () => {
    const rules: RequestProcessingRules = {
      ...DEFAULT_REQUEST_PROCESSING_RULES,
      additionalMonitoredStatusCodes: new Set([404]),
    };
    const processor = processorWithRules(pool, rules);
    const result = await processor.process(
      processorInput(4, projectA, 'adp-404-1', requestEnvelope('adp-404-1', { outcome: 'http_error', statusCode: 404, method: 'DELETE' })),
      new AbortController().signal,
    );
    expect(result).toEqual({ outcome: 'processed' });
    const bucket = await queryRow<MetricBucketRow>(
      pool,
      `SELECT observed_count, failure_count FROM request_metric_buckets
       WHERE project_id = $1 AND method = 'DELETE' AND outcome = 'http_error' AND status_code = 404`,
      [projectA],
    );
    // 404 is additional-monitored but NOT a failure under this rule set.
    expect(bucket?.observed_count).toBe('1');
    expect(bucket?.failure_count).toBe('0');
    const samples = await queryRows<SampleRow>(
      pool,
      `SELECT event_id FROM request_event_samples WHERE project_id = $1 AND event_id = 'adp-404-1'`,
      [projectA],
    );
    expect(samples).toHaveLength(1);
  });

  it('replay with the same adapter is idempotent for a slow request', async () => {
    const processor = processorWithRules(pool, DEFAULT_REQUEST_PROCESSING_RULES);
    const input = processorInput(5, projectA, 'adp-replay-1', requestEnvelope('adp-replay-1', { durationMs: 3400, method: 'PATCH' }));
    const first = await processor.process(input, new AbortController().signal);
    const second = await processor.process(input, new AbortController().signal);
    expect(first).toEqual({ outcome: 'processed' });
    expect(second).toEqual({ outcome: 'processed' });
    const bucket = await queryRow<MetricBucketRow>(
      pool,
      `SELECT observed_count, slow_count FROM request_metric_buckets
       WHERE project_id = $1 AND method = 'PATCH' AND outcome = 'success' AND status_code = 0`,
      [projectA],
    );
    expect(bucket?.observed_count).toBe('1');
    expect(bucket?.slow_count).toBe('1');
    const samples = await queryRows<SampleRow>(
      pool,
      `SELECT event_id FROM request_event_samples WHERE project_id = $1 AND event_id = 'adp-replay-1'`,
      [projectA],
    );
    expect(samples).toHaveLength(1);
  });

  it('leaves no residual state and cleans up so later runs start empty', async () => {
    const residual = await queryRow<{ leased: number }>(
      pool,
      `SELECT count(*) FILTER (WHERE state = 'leased')::int AS leased FROM event_inbox`,
    );
    expect(residual?.leased).toBe(0);
    const count = await queryRow<{ n: number }>(pool, 'SELECT count(*)::int AS n FROM event_inbox');
    expect(count?.n).toBe(0);
  });
});
```

- [x] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @aurora/ingestion-worker test:integration -- test/integration/request-processing-rules-adapter.test.ts`
Expected: FAIL —— 模块不存在（Cannot find module），且需要 `AURORA_TEST_DATABASE_URL`。

> 若 `AURORA_TEST_DATABASE_URL` 未设置，`describeDb` 会 skip（返回 PASS with skipped）。本 Task 的真实失败验证依赖环境；无 DB 环境时记录为"未运行环境依赖测试"（见最终验证节），不把 skip 写成通过。

- [x] **Step 3: 写最小实现**

本 Task 无新源码；依赖 Task 1—4 的 adapter 与既有 processor。集成测试作为组合证据直接消费。若 Step 2 因 adapter 未实现而失败，回到 Task 1—4 修复；若 adapter 已实现，本 Task 的"最小实现"即保持现状（无代码变更）。

- [x] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @aurora/ingestion-worker test:integration -- test/integration/request-processing-rules-adapter.test.ts`
Expected: PASS（6 个测试，含真实 PostgreSQL 17.10）。

- [x] **Step 5: Commit 边界（不实际执行）**

```text
逻辑提交边界：test(ingestion-worker): real-postgres adapter to processor composition evidence
实际执行：不运行 git add/commit。
```

- [x] **Step 6: 检查差异**

Run: `git diff --check`
Expected: 无输出。

## Task 6：安全负例与文档契约测试

**Files:**
- Modify: `apps/ingestion-worker/test/security-negative.test.ts`（追加 adapter 安全负例）
- Modify: `apps/ingestion-worker/test/documentation-contract.test.ts`（追加规格对齐断言）

**Interfaces:**
- Consumes: Task 1/2 的 adapter 源码、正式规格路径
- Produces: 无新接口

- [x] **Step 1: 写失败测试**

在 `security-negative.test.ts` 追加：

```ts
  it('request processing rules adapter never reads secrets, runs randomness, or writes logs', async () => {
    const source = await readFile(
      new URL('../src/request-processing-rules-adapter.ts', import.meta.url),
      'utf8',
    );
    expect(source).not.toMatch(/console\./);
    expect(source).not.toMatch(/Math\.random/);
    expect(source).not.toMatch(/Date\.now|new Date\(/);
    expect(source).not.toMatch(/process\.env/);
    expect(source).not.toMatch(/INSERT INTO|SELECT.*FROM/);
    expect(source).not.toMatch(/Authorization|clientKey|token|password/);
    expect(source).not.toMatch(/request\.body|response\.body|\.headers|\.cookies/);
    expect(source).not.toMatch(/event\.body|EventEnvelope\.body/);
  });
```

在 `documentation-contract.test.ts` 追加：

```ts
  it('keeps the request processing rules adapter spec honest about its boundary', async () => {
    const spec = await readFile(
      new URL('../../../docs/architecture/request-processing-rules-configuration-adapter.md', import.meta.url),
      'utf8',
    );
    expect(spec).toContain('implementation-status');
    expect(spec).toContain('createRequestProcessingRulesAdapter');
    expect(spec).toContain('DEFAULT_REQUEST_PROCESSING_RULES');
    expect(spec).toContain('slowRequestThresholdMs');
    expect(spec).toContain('无需新 ADR');
  });
```

- [x] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @aurora/ingestion-worker test -- test/security-negative.test.ts test/documentation-contract.test.ts`
Expected: FAIL —— 新断言未满足（spec 文件已存在但 `security-negative` 断言针对新源码；若源码含禁止模式则失败）。

- [x] **Step 3: 写最小实现**

- `security-negative.test.ts` 的失败若因源码含禁止模式：修正 `request-processing-rules-adapter.ts`（确保不导入 `event.body`、不写 console 等）；
- `documentation-contract.test.ts` 的失败若因 spec 缺少断言文本：正式规格已含 `createRequestProcessingRulesAdapter`/`DEFAULT_REQUEST_PROCESSING_RULES`/`slowRequestThresholdMs`/`无需新 ADR`（§29），保持规格现状；
- 若 adapter 源码已满足全部负例，本 Task 无需源码变更（测试作为门禁落地）。

- [x] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @aurora/ingestion-worker test -- test/security-negative.test.ts test/documentation-contract.test.ts`
Expected: PASS。

- [x] **Step 5: Commit 边界（不实际执行）**

```text
逻辑提交边界：test(ingestion-worker): adapter security negatives and doc contract
实际执行：不运行 git add/commit。
```

- [x] **Step 6: 检查差异**

Run: `git diff --check`
Expected: 无输出。

## Task 7：README、正式文档、ADR 证据与状态基线同步

**Files:**
- Modify: `apps/ingestion-worker/README.md`
- Modify: `docs/architecture/formalization-readiness.md`
- Modify: `docs/README.md`
- Modify: `docs/adr/ADR-019-request-event-aggregation-and-bounded-diagnostic-sample-storage.md`
- Modify: `docs/adr/ADR-020-idempotent-request-metric-bucket-aggregation.md`
- Modify: `docs/architecture/aurora-v1-remaining-module-batches.md`（remaining 46 → 45）

**Interfaces:**
- Consumes: 全部 Task 的导出、正式规格
- Produces: 文档同步状态

- [x] **Step 1: 写失败测试**

本 Task 是文档同步，无新增代码测试。文档契约测试在 Task 6 已落地门禁。执行文档修改后，运行完整质量门禁验证文档一致性。

- [x] **Step 2: 运行测试确认当前状态**

Run: `pnpm --filter @aurora/ingestion-worker test`
Expected: PASS（18 个既有单元测试文件 + 新 adapter 测试）。

- [x] **Step 3: 写最小实现（文档修改）**

**`apps/ingestion-worker/README.md`**：
- 在"职责"列表追加：`请求处理规则/配置 adapter（createRequestProcessingRulesAdapter：默认慢阈值 3000ms 与项目覆盖、isFailure/isSlow/isAdditionalMonitoredStatus 确定性分类、不可变冻结快照、配置非法抛稳定错误；作为 ClassifyRequestEvent 端口的真实规则实现）`；
- 在"对外接口"追加包根导出 `createRequestProcessingRulesAdapter`、`DEFAULT_REQUEST_PROCESSING_RULES` 及类型；
- 在"非职责"保持"真实项目配置 adapter"表述更新为"真实配置存储/Repository、生产接线仍未实现"。

**`docs/architecture/formalization-readiness.md`**：
- §12 实施就绪结论追加一条：`**请求处理规则/配置 adapter 第一增量（DAT-07，2026-08-03）已实施**：`apps/ingestion-worker` 已实施 `createRequestProcessingRulesAdapter`（`RequestProcessingRules` 配置模型 + `DEFAULT_REQUEST_PROCESSING_RULES` 默认 3000ms 慢阈值/失败 429+500—599/额外状态码默认空 + 确定性分类 + 不可变冻结快照 + 非法配置抛稳定 `RequestProcessingRulesAdapterError{invalid_rules}`；正式规格 [request-processing-rules-configuration-adapter.md](../architecture/request-processing-rules-configuration-adapter.md) approved + implemented），通过单元测试与真实 PostgreSQL 17.10 集成测试与全仓质量门禁。**不接入生产 composition root**：真实配置存储/Repository、配置管理 API、生产接线、总事件路由仍 not-started / blocked。状态记录：request processing rules/config adapter implemented；request metric query not-started；performance aggregate/sample store not-started；performance event processor not-started；event processor routing not-started / blocked；production worker composition not-started / blocked；ADR-019 保持 accepted / in-progress、ADR-020 保持 accepted / implemented。`；
- §7 机器契约表"处理/存储可执行模型"行的 `request processing rules/config adapter not-started` 更新为 implemented。

**`docs/README.md`**：
- §2 权威来源表"请求事件 Processor 核心第一增量"行更新为"…与请求处理规则/配置 adapter（createRequestProcessingRulesAdapter）已实施…真实配置 Repository/生产接线 blocked"；
- 在表中追加一行：`| 请求处理规则/配置 adapter 第一增量 | [请求处理规则/配置 adapter 规格](architecture/request-processing-rules-configuration-adapter.md) | 请求事件契约、ADR-019/020（accepted）、Request Processor §9/§30、PRD 5.1.2/5.1.3/5.1.5/5.1.6 | approved + implemented；@aurora/ingestion-worker createRequestProcessingRulesAdapter（默认慢阈值 3000ms、失败 429+500—599、额外状态码默认空、不可变冻结快照、非法配置抛稳定错误）已通过单元测试、真实 PostgreSQL 17.10 集成测试与全仓质量门禁；真实配置 Repository/配置管理 API/Router/生产接线 not-started / blocked |`。

**`docs/adr/ADR-019-...md`**：追加一节：
```markdown
### 2026-08-03：请求处理规则/配置 adapter 第一增量实施证据

- 实施状态更新：请求处理规则/配置 adapter 核心能力已实施并通过单元测试、真实 PostgreSQL 17.10 集成测试与全仓质量门禁；真实配置存储/Repository、配置管理 API、Request Metric Query、Performance、Router、生产接线仍未实现，故不扩大范围；
- 实施内容：`apps/ingestion-worker` 内部 `src/request-processing-rules-adapter.ts`（`RequestProcessingRules` 配置模型 + `DEFAULT_REQUEST_PROCESSING_RULES` 默认慢阈值 3000ms/失败 429+500—599/额外状态码默认空 + `createRequestProcessingRulesAdapter` 工厂实现 `ClassifyRequestEvent` 端口 + 不可变冻结快照 + 非法配置抛稳定 `RequestProcessingRulesAdapterError{invalid_rules}`），正式规格 [request-processing-rules-configuration-adapter.md](../architecture/request-processing-rules-configuration-adapter.md)（approved + implemented）；
- 语义：`isFailure` = network_error/timeout/http_error 命中 failureStatusCodes；`isSlow` = 非 canceled 且 durationMs ≥ 阈值 或 http_error 命中 slowStatusCodes；`isAdditionalMonitoredStatus` = http_error 命中 additionalMonitoredStatusCodes；默认规则逐条来自 PRD 5.1.2/5.1.3 与本 ADR 决定细节 3/4；
- 未修改：request-event-contract/ingestion-api/Worker 运行时/processing-store/Error processor/Request Processor 核心/样本选择策略/retry/backoff/replay；未增加 Migration；未接生产 composition root；
- 状态记录：request processing rules/config adapter implemented；request metric query not-started；performance aggregate/sample store not-started；performance event processor not-started；event processor routing not-started / blocked；production worker composition not-started / blocked；本 ADR 保持 `accepted / in-progress`、ADR-020 保持 `accepted / implemented`。
```

**`docs/adr/ADR-020-...md`**：追加一节（内容同 ADR-019 追加，但强调 ADR-020 决定细节 5/20 落实）。

**`docs/architecture/aurora-v1-remaining-module-batches.md`**：
- frontmatter `completed-v1-leaf-modules: 32` → `33`，`remaining-v1-leaf-modules: 46` → `45`；
- §2 计数基线同步：`46 = 0 + 11 + 35` → `45 = 0 + 11 + 34`（blocked 35 → 34，因为 DAT-07 从 blocked 转为 completed）；
- 附注 DAT-07 已关闭。

- [x] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @aurora/ingestion-worker test`
Expected: PASS。

- [x] **Step 5: Commit 边界（不实际执行）**

```text
逻辑提交边界：docs(ingestion-worker): request processing rules adapter spec/readme/baseline sync
实际执行：不运行 git add/commit。
```

- [x] **Step 6: 检查差异**

Run: `git diff --check`
Expected: 无输出。

## 验证命令（最终质量门禁）

全部 Task 完成后，从仓库根目录执行：

```bash
pnpm --filter @aurora/ingestion-worker typecheck      # strict TypeScript
pnpm --filter @aurora/ingestion-worker test           # 单元测试（含新 adapter 测试）
pnpm --filter @aurora/ingestion-worker test:integration  # 真实 PostgreSQL 17.10 集成测试
pnpm --filter @aurora/ingestion-worker test:coverage  # 覆盖率 85/80/85/85
pnpm --filter @aurora/ingestion-worker test:package   # 包入口测试（build 后）
pnpm --filter @aurora/ingestion-worker build          # 构建 dist
pnpm lint                                             # ESLint
pnpm typecheck                                        # 全仓类型检查
pnpm test:coverage                                    # 全仓覆盖率（含 worker）
pnpm check:boundaries                                 # Workspace 依赖边界
pnpm format:check                                     # 格式检查
pnpm openapi:check                                    # OpenAPI 漂移门禁（回归）
pnpm check                                            # 全仓质量门禁
git diff --check                                      # 空白错误
```

集成测试需要真实 PostgreSQL 17 与 `AURORA_TEST_DATABASE_URL`（目标 `aurora_inbox_test` 测试库）。无 DB 环境时记录：未运行命令、未运行原因、所需环境、当前替代证据、剩余风险；不得把 skip 写成通过。

## 回滚方式

- adapter 是 `apps/ingestion-worker` 内部独立模块：移除 `src/request-processing-rules-adapter.ts`、`test/request-processing-rules-adapter.test.ts`、`test/integration/request-processing-rules-adapter.test.ts`、包根导出、README/文档条目，不影响 Request Processor 核心、processing-store、Inbox、Worker runtime 任何既有行为（分类端口仍可注入 fake）；
- 无 Migration、无破坏性数据操作；正式文档可随代码一并回滚。

## deferred 与 out-of-scope

- 真实配置存储/Repository、配置管理 HTTP API、管理平台 UI；
- 动态配置刷新与配置版本；
- 慢请求采样率（20%）/性能采样率（10%）执行；
- SDK 请求 allowlist、路径归一化、同源/跨域判断；
- 项目级覆盖规则持久化与版本控制、配置变更审计；
- DAT-08/09/10/11/16、Issue、告警、用量、平台 UI。

## 未完成状态处理

- 若 `AURORA_TEST_DATABASE_URL` 不可用：集成测试以 skip 记录，DAT-07 关闭前必须如实标注"集成测试未运行/被跳过"，剩余风险与替代证据写入完成报告；
- 若任何质量门禁失败：停止，调查根因，修复后重跑，不得以部分通过代替完整验证；
- 实际不执行 `git add`/`commit`/`push`，完成报告明确说明。

## 计划自审批记录

> 执行偏差记录（2026-08-03）：Task 2 的"is deterministic and never mutates its input"测试原计划在 100 次循环中使用 `{ outcome: 'success', durationMs: 120, method: 'GET' }` 却与 `first`（503 http_error 的分类，`isFailure: true`）比较，导致该断言永远不可能通过。实施者将其修正为对同一 `original` 输入分类 100 次并与 `first` 比较，保留测试的确定性意图。本段即该偏差的正式记录；其余测试逐字按计划实现。
>
> Task 3 执行偏差记录（2026-08-03）：(1) `rules: undefined` 用例未出现真实 RED——Task 2 的 `normalizeRules(undefined)` → `isPlainRecord(undefined)` → false 已抛出稳定 `RequestProcessingRulesAdapterError`，Step 3 顶层守卫属防御性加固（可观察行为不变）；(2) 冻结语义测试原计划 `const source: RequestProcessingRules = {...}` 后对 `source.slowRequestThresholdMs = 9999`/`source.failureStatusCodes.add(500)` 赋值，在 strict TS 下产生 TS2540/TS2339。实施者去掉类型标注使 `source` 推断为可变结构对象（仍可赋值给 `RequestProcessingRules`），保留测试的运行时冻结语义意图。两处均为计划文本缺陷的最小保守修正。

- 规格覆盖：pass（规格 §1—§31 每项要求映射到 Task 1—7；分类语义/非法配置/冻结/确定性/隐私/集成/文档全部有 Task 与测试）
- 占位符扫描：pass（无 TBD/TODO/appropriate/similar to/handle edge cases/implement validation）
- 类型一致性：pass（`RequestProcessingRules`/`RequestProcessingRulesAdapter`/`CreateRequestProcessingRulesAdapterInput`/`RequestProcessingRulesAdapterError`/`RequestProcessingRulesAdapterErrorKind`/`DEFAULT_REQUEST_PROCESSING_RULES`/`createRequestProcessingRulesAdapter`/`classify`/`RequestEventClassificationInput`/`RequestEventClassification` 全计划一致）
- 权威冲突扫描：pass（PRD 5.1.2/5.1.3/5.1.5/5.1.6、ADR-019 决定细节 3/4/14、ADR-020 决定细节 5/20、Request Processor §9/§30、Sample Selection Policy §11/§12 无冲突）
- 架构边界扫描：pass（service 层；`service → {protocol, data}`；无私有深导入；无循环依赖；不接生产 composition root；不实现 DAT-08—11）
- 安全与隐私扫描：pass（输入强类型白名单；不记录敏感字段；无日志/随机/时钟/环境变量；配置非法抛稳定错误）
- 工作区安全检查：pass（目标文件 `request-processing-rules-adapter.ts`、三个测试文件、README/文档为 DAT-07 专属；不触碰用户既有修改；不执行破坏性 Git）
- Required ADR：none（spec §29：既有分类端口边界内的配置 adapter 实现）
- 本轮关闭叶子：DAT-07，仅 1 个
- 自动执行授权：来自本轮用户联合模式指令

"自审批"只表示计划可以执行，不得表示 Agent 批准了 ADR 或修改了产品规则。
