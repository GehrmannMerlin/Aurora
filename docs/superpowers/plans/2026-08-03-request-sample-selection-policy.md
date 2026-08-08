# Request Sample Selection Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## 文件头

- 日期：2026-08-03
- 模块：`apps/ingestion-worker`（`@aurora/ingestion-worker`）请求样本选择策略
- 正式规格：`docs/architecture/request-sample-selection-policy.md`（approved）
- ADR：`docs/adr/ADR-019-request-event-aggregation-and-bounded-diagnostic-sample-storage.md`（accepted / in-progress；本模块追加实施证据，不修改最终结论）
- 计划状态：ready-for-implementation
- 目标读者：零上下文工程师
- 权威来源：CLAUDE.md/AGENTS.md/AURORA_RULES.md 快照、approved 规格、accepted ADR-019/020、approved 请求事件协议契约、PRD 5.1.2/5.1.3/5.1.5/5.1.6、RULE-REQUEST-PERSISTENCE-20260803-002

## Goal

在 `apps/ingestion-worker` 内实现请求样本选择策略第一增量：`decideRequestSampleSelection` 确定性纯函数（输入 outcome/statusCode/isSlow/isAdditionalMonitoredStatus → 判别联合 store/skip/invalid），按固定优先级判断是否保存安全诊断样本。**不**实现随机采样、Request Processor、样本持久化、指标聚合、Router、production composition root；**不**读取项目配置、不计算慢请求阈值、不写数据库、不写日志、不读取时间/环境变量。

## Architecture

```
apps/ingestion-worker/
  src/
    request-sample-selection-policy.ts      # 新建：输入类型 + 判别联合输出 + 决策纯函数
    index.ts                                # 不修改（不扩大包根公共 API）
  test/
    request-sample-selection-policy.test.ts # 新建：决策矩阵/优先级/确定性/边界负例
    security-negative.test.ts               # 追加：策略源文件无副作用负例（编辑）
    documentation-contract.test.ts          # 追加：README 诚实断言（编辑）
  README.md                                 # 追加：请求样本选择策略职责（编辑）
```

依赖方向：`request-sample-selection-policy.ts` → `@aurora/event-schema` 包根（值 `RequestOutcome`/`REQUEST_EVENT_LIMITS` + 类型）。`aurora.layer: service`；不新增任何跨包依赖。测试 `request-sample-selection-policy.test.ts` → `../src/request-sample-selection-policy.js`（相对导入，与 `retry-backoff-policy.test.ts` 模式一致）。

## Tech Stack

- TypeScript 6.0.3（strict，NodeNext，ES2024，verbatimModuleSyntax，exactOptionalPropertyTypes，noImplicitReturns，noUncheckedIndexedAccess）
- vitest 4.1.10；`@aurora/event-schema`（既有 workspace 依赖，vitest alias 指向 `src/index.ts`）
- 无新依赖、无新 Migration、无数据库访问

## Global Constraints

- 只实现样本资格判断；不实现随机采样（不 `Math.random`、不概率、不采样率、不水位）；
- 不接收/读取：请求体、响应体、Header、Cookie、Authorization、完整 URL、Query、页面文本、用户信息、完整 Request Event JSON、PostgreSQL Row、`request_event_samples`、`request_metric_buckets`；
- 不调用 `persistRequestEventSample`、`persistRequestMetricContribution`；不写数据库；不写日志；不读取 `Date`/`process.env`；不访问网络/文件系统；
- 输入使用事件领域语义的真实可空 `statusCode`（`100..599` 安全整数，可选），**不用** `status_code = 0` 数据库哨兵；
- 只从 `@aurora/event-schema` 包根导入；不访问 `src`/`internal`/私有路径；不扩大 `apps/ingestion-worker` 包根公共 API（不修改 `index.ts`）；
- `outcome` 五个值、`statusCode` 边界必须来自 event-schema 公共常量，不散落魔法字符串；
- 同一输入调用任意次数结果一致；不修改输入；输出可冻结；普通控制流不抛出；
- 不修改 `retry-policy.ts`、`retry-backoff-*`、`error-event-processor.ts`、`processor.ts`、`worker-runtime.ts`、`@aurora/processing-store`、`@aurora/ingestion-inbox`、`@aurora/event-schema`、`apps/ingestion-api`、OpenAPI；
- 不修改 ADR-016/017/018/020；ADR-019 只追加实施证据、保持 `accepted / in-progress`；
- 不 `git add`/`commit`/`push`/`stash`/`reset`/`rebase`/`clean`；不覆盖用户已有未提交差异。

## 文件树（完整）

```
apps/ingestion-worker/src/request-sample-selection-policy.ts      # 新建
apps/ingestion-worker/test/request-sample-selection-policy.test.ts # 新建
apps/ingestion-worker/test/security-negative.test.ts               # 追加负例（编辑）
apps/ingestion-worker/test/documentation-contract.test.ts          # 追加断言（编辑）
apps/ingestion-worker/README.md                                   # 追加职责（编辑）
docs/superpowers/plans/2026-08-03-request-sample-selection-policy.md # 本计划
docs/architecture/request-sample-selection-policy.md               # 正式规格（已建，实施后更新 implementation-status）
docs/architecture/formalization-readiness.md                       # 状态记录（编辑）
docs/README.md                                                    # 模块条目（编辑）
docs/adr/ADR-019-request-event-aggregation-and-bounded-diagnostic-sample-storage.md # 追加实施证据（编辑）
```

## 每个文件单一职责

- `src/request-sample-selection-policy.ts`：`RequestSampleSelectionInput` 类型、`RequestSampleSelectionDecision` 判别联合、`decideRequestSampleSelection` 纯函数 + 私有校验/分类辅助。不做任何 I/O。
- `test/request-sample-selection-policy.test.ts`：决策矩阵、优先级组合、确定性、输入不变、非法输入、outcome 穷尽。不连数据库。
- `test/security-negative.test.ts`：追加策略源文件无副作用/无敏感字段负例。
- `test/documentation-contract.test.ts`：追加 README 提及请求样本选择策略断言。
- `README.md`：职责清单新增一行，非职责新增一行。
- 规格/追踪/ADR-019：只同步真实状态。

## 关键设计决策

1. **API 形态**：`decideRequestSampleSelection(input: RequestSampleSelectionInput): RequestSampleSelectionDecision`。输入为强类型最小内部事实；内部运行时校验（与 `decideRetryDisposition` 模式一致），非法输入返回稳定 `invalid` 结果而非抛出。
2. **状态码边界**：`statusCode` 可选；存在时必须为 `100..599` 安全整数，用 `@aurora/event-schema` 的 `REQUEST_EVENT_LIMITS.minStatusCode`/`maxStatusCode`，不用魔法数字。
3. **优先级**：`canceled` → `network_error` → `timeout` → 429 → 500..599 → configured → slow → skip。
4. **不冻结 vs 冻结**：本模块冻结输出（`Object.freeze`），与 `retry-backoff-policy.ts` 一致，强化确定性承诺。
5. **不扩大公共 API**：不修改 `src/index.ts`；`decideRequestSampleSelection` 仅供未来同包 Request Processor 以相对路径导入。
6. **错误处理**：未知 outcome、statusCode 越界、布尔非法 → `{ decision: 'invalid', diagnosticCode: 'invalid_request_sample_selection_input' }`；普通控制流不抛出。

## 完整 TypeScript 签名

```ts
// src/request-sample-selection-policy.ts
import { REQUEST_EVENT_LIMITS, RequestOutcome } from '@aurora/event-schema';

export interface RequestSampleSelectionInput {
  readonly outcome: RequestOutcome;
  readonly statusCode?: number;
  readonly isSlow: boolean;
  readonly isAdditionalMonitoredStatus: boolean;
}

export type RequestSampleSelectionDecision =
  | {
      readonly decision: 'store';
      readonly reason:
        | 'network_failure'
        | 'timeout'
        | 'http_429'
        | 'http_5xx'
        | 'configured_status'
        | 'slow_request';
    }
  | {
      readonly decision: 'skip';
      readonly reason: 'cancelled' | 'successful_not_slow' | 'unmonitored_status';
    }
  | {
      readonly decision: 'invalid';
      readonly diagnosticCode: 'invalid_request_sample_selection_input';
    };

export function decideRequestSampleSelection(
  input: RequestSampleSelectionInput,
): RequestSampleSelectionDecision;
```

## 每个 Task 精确路径与 TDD 闭环

### Task 1：输入/输出类型与决策矩阵失败测试（red）

**Consumes**：`@aurora/event-schema` 包根（`RequestOutcome`/`REQUEST_EVENT_LIMITS`）、规格第 5/6/7 节。
**Produces**：`test/request-sample-selection-policy.test.ts`（仅测试文件，不含实现）。

1. 创建 `test/request-sample-selection-policy.test.ts`，包含决策矩阵全部用例（见"测试代码"第 1—23 项）与优先级组合（第 20—23 项）。导入 `RequestOutcome` 常量与 `decideRequestSampleSelection`/类型（相对 `../src/...`）。
2. 预期失败：TS2307 `Cannot find module '../src/request-sample-selection-policy.js'`（实现文件不存在）。
3. 最小实现：**不创建实现**；本 Task 只证明测试存在且当前失败。
4. 确认失败：`pnpm --filter @aurora/ingestion-worker test` 输出 `FAIL` + `Cannot find module`。
5. 提交边界：Task 1 不落盘独立可提交单元（测试与实现需同批）——逻辑边界记录：测试先行。

### Task 2：确定性决策纯函数实现（green）

**Consumes**：`@aurora/event-schema` 包根、`test/request-sample-selection-policy.test.ts`、`retry-policy.ts` 模式。
**Produces**：`src/request-sample-selection-policy.ts`。

1. 实现文件：`RequestSampleSelectionInput` 类型、`RequestSampleSelectionDecision` 判别联合、`decideRequestSampleSelection` 纯函数。
   - 运行时校验：`outcome` ∈ `RequestOutcome` 五值；`statusCode` 若存在为 `100..599` 安全整数；`isSlow`/`isAdditionalMonitoredStatus` 为 boolean；否则返回 `invalid`。
   - 分类（严格按优先级）：`canceled → skip/cancelled`；`network_error → store/network_failure`；`timeout → store/timeout`；`http_error` 时 `statusCode === 429 → store/http_429`、`statusCode >= 500 → store/http_5xx`、`isAdditionalMonitoredStatus → store/configured_status`、`isSlow → store/slow_request`、否则 `skip/unmonitored_status`；`success` 时 `isSlow → store/slow_request`、否则 `skip/successful_not_slow`。
   - 输出 `Object.freeze`。
2. 确认通过：`pnpm --filter @aurora/ingestion-worker test` 该文件全部通过。
3. 回归：`pnpm --filter @aurora/ingestion-worker test` 既有单测不回归（retry/backoff/error processor/configuration 等）。
4. 提交边界：`request-sample-selection-policy.ts` + `request-sample-selection-policy.test.ts` 同批（不执行 git add/commit）。

### Task 3：确定性、无副作用与非法输入边界测试

**Consumes**：`request-sample-selection-policy.ts`。
**Produces**：`test/request-sample-selection-policy.test.ts` 追加用例 + `test/security-negative.test.ts` 追加负例。

1. 追加测试（见"测试代码"第 24—33 项）：
   - 同一输入调用 100 次结果完全一致；
   - 输入对象不被修改（快照断言）；
   - 未知 outcome → `invalid`；
   - statusCode `< 100`、`> 599`、非整数（`200.5`）→ `invalid`；
   - `isSlow`/`isAdditionalMonitoredStatus` 非布尔（`1`/`'yes'`）→ `invalid`；
   - 五类 `RequestOutcome` 全部返回合法 decision（穷尽，不 `invalid`）。
2. `test/security-negative.test.ts` 追加：读取 `src/request-sample-selection-policy.ts`，断言不匹配 `console\.`、`Math\.random`、`Date\.now|new Date`、`process\.env`、`persistRequestEventSample|persistRequestMetricContribution`、`INSERT INTO|SELECT`、`event\.body|EventEnvelope\.body`、`Authorization|clientKey|token|password`。
3. 确认通过：`pnpm --filter @aurora/ingestion-worker test` 全部通过。
4. 回归：同上（全量单测）。
5. 提交边界：测试追加同批。

### Task 4：README 与文档诚实同步

**Consumes**：`README.md`、正式规格、formalization-readiness、docs/README、ADR-019。
**Produces**：编辑 `apps/ingestion-worker/README.md`、`test/documentation-contract.test.ts`、`docs/architecture/request-sample-selection-policy.md`（`implementation-status` → `implemented`）、`docs/architecture/formalization-readiness.md`、`docs/README.md`、`docs/adr/ADR-019-...md`（追加实施证据）。

1. `README.md` 职责清单追加"请求样本选择策略（`decideRequestSampleSelection`：确定性纯函数，按 ADR-019 优先级判断是否保存安全诊断样本）"；非职责追加"不实现随机采样/样本持久化/指标聚合/Request Processor"。
2. `documentation-contract.test.ts` 第一个测试追加 `expect(readme).toContain('请求样本选择策略')`。
3. 正式规格 `implementation-status: not-started` → `implemented`，并在定位节声明已实施。
4. `formalization-readiness.md` 状态记录更新：`request sample selection policy not-started` → `implemented`；`request event processor`/`request query projection`/`performance`/`event processor routing`/`production worker composition` 保持 not-started / blocked；ADR-019 保持 `accepted / in-progress`、ADR-020 保持 `accepted / implemented`。
5. `docs/README.md` 请求模块表追加一行："请求样本选择策略第一增量 | [规格](architecture/request-sample-selection-policy.md) | 请求事件契约、ADR-019、PRD 5.1.2/5.1.3 | approved + implemented；`apps/ingestion-worker` `decideRequestSampleSelection` 确定性纯函数（store/skip/invalid、固定优先级、无随机无副作用）已通过单元测试与全仓质量门禁；Request Processor/样本持久化执行器/指标提交/Router/生产接线 not-started / blocked"。
6. ADR-019 追加记录：样本选择策略核心能力实施证据（文件、语义、测试、门禁），保持 `accepted / in-progress`。
7. 确认通过：`pnpm --filter @aurora/ingestion-worker test`（documentation-contract 通过）、`pnpm --filter @aurora/ingestion-worker typecheck`。
8. 提交边界：文档与测试同批。

## 测试代码（精确）

`test/request-sample-selection-policy.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { RequestOutcome } from '@aurora/event-schema';
import {
  decideRequestSampleSelection,
  type RequestSampleSelectionDecision,
  type RequestSampleSelectionInput,
} from '../src/request-sample-selection-policy.js';

function select(
  outcome: RequestOutcome,
  overrides: Partial<Pick<RequestSampleSelectionInput, 'statusCode' | 'isSlow' | 'isAdditionalMonitoredStatus'>> = {},
): RequestSampleSelectionDecision {
  return decideRequestSampleSelection({
    outcome,
    isSlow: false,
    isAdditionalMonitoredStatus: false,
    ...overrides,
  });
}

function expectDecision(
  input: RequestSampleSelectionInput,
  expected: RequestSampleSelectionDecision,
): void {
  expect(decideRequestSampleSelection(input)).toEqual(expected);
}

describe('decideRequestSampleSelection decision matrix', () => {
  it('cancelled, not slow -> skip/cancelled', () => {
    expectDecision({ outcome: RequestOutcome.Canceled, isSlow: false, isAdditionalMonitoredStatus: false },
      { decision: 'skip', reason: 'cancelled' });
  });

  it('cancelled, slow -> skip/cancelled (cancel beats slow)', () => {
    expectDecision({ outcome: RequestOutcome.Canceled, isSlow: true, isAdditionalMonitoredStatus: false },
      { decision: 'skip', reason: 'cancelled' });
  });

  it('cancelled, configured -> skip/cancelled (cancel beats configured)', () => {
    expectDecision({ outcome: RequestOutcome.Canceled, isSlow: false, isAdditionalMonitoredStatus: true },
      { decision: 'skip', reason: 'cancelled' });
  });

  it('cancelled, slow + configured -> skip/cancelled (cancel is highest priority)', () => {
    expectDecision({ outcome: RequestOutcome.Canceled, isSlow: true, isAdditionalMonitoredStatus: true },
      { decision: 'skip', reason: 'cancelled' });
  });

  it('network_error -> store/network_failure', () => {
    expectDecision({ outcome: RequestOutcome.NetworkError, isSlow: false, isAdditionalMonitoredStatus: false },
      { decision: 'store', reason: 'network_failure' });
  });

  it('network_error, slow -> store/network_failure', () => {
    expectDecision({ outcome: RequestOutcome.NetworkError, isSlow: true, isAdditionalMonitoredStatus: false },
      { decision: 'store', reason: 'network_failure' });
  });

  it('timeout -> store/timeout', () => {
    expectDecision({ outcome: RequestOutcome.Timeout, isSlow: false, isAdditionalMonitoredStatus: false },
      { decision: 'store', reason: 'timeout' });
  });

  it('http_error 429 -> store/http_429', () => {
    expectDecision({ outcome: RequestOutcome.HttpError, statusCode: 429, isSlow: false, isAdditionalMonitoredStatus: false },
      { decision: 'store', reason: 'http_429' });
  });

  it('http_error 429 slow -> store/http_429 (429 beats slow)', () => {
    expectDecision({ outcome: RequestOutcome.HttpError, statusCode: 429, isSlow: true, isAdditionalMonitoredStatus: false },
      { decision: 'store', reason: 'http_429' });
  });

  it('http_error 500 -> store/http_5xx', () => {
    expectDecision({ outcome: RequestOutcome.HttpError, statusCode: 500, isSlow: false, isAdditionalMonitoredStatus: false },
      { decision: 'store', reason: 'http_5xx' });
  });

  it('http_error 599 -> store/http_5xx', () => {
    expectDecision({ outcome: RequestOutcome.HttpError, statusCode: 599, isSlow: false, isAdditionalMonitoredStatus: false },
      { decision: 'store', reason: 'http_5xx' });
  });

  it('http_error 503 slow -> store/http_5xx (5xx beats slow)', () => {
    expectDecision({ outcome: RequestOutcome.HttpError, statusCode: 503, isSlow: true, isAdditionalMonitoredStatus: false },
      { decision: 'store', reason: 'http_5xx' });
  });

  it('http_error 404 configured -> store/configured_status', () => {
    expectDecision({ outcome: RequestOutcome.HttpError, statusCode: 404, isSlow: false, isAdditionalMonitoredStatus: true },
      { decision: 'store', reason: 'configured_status' });
  });

  it('http_error 404 configured slow -> store/configured_status (configured beats slow)', () => {
    expectDecision({ outcome: RequestOutcome.HttpError, statusCode: 404, isSlow: true, isAdditionalMonitoredStatus: true },
      { decision: 'store', reason: 'configured_status' });
  });

  it('http_error 404 unmonitored slow -> store/slow_request', () => {
    expectDecision({ outcome: RequestOutcome.HttpError, statusCode: 404, isSlow: true, isAdditionalMonitoredStatus: false },
      { decision: 'store', reason: 'slow_request' });
  });

  it('success slow -> store/slow_request', () => {
    expectDecision({ outcome: RequestOutcome.Success, isSlow: true, isAdditionalMonitoredStatus: false },
      { decision: 'store', reason: 'slow_request' });
  });

  it('success 200 not slow -> skip/successful_not_slow', () => {
    expectDecision({ outcome: RequestOutcome.Success, statusCode: 200, isSlow: false, isAdditionalMonitoredStatus: false },
      { decision: 'skip', reason: 'successful_not_slow' });
  });

  it('http_error 499 unmonitored not slow -> skip/unmonitored_status', () => {
    expectDecision({ outcome: RequestOutcome.HttpError, statusCode: 499, isSlow: false, isAdditionalMonitoredStatus: false },
      { decision: 'skip', reason: 'unmonitored_status' });
  });

  it('http_error 400 unmonitored not slow -> skip/unmonitored_status', () => {
    expectDecision({ outcome: RequestOutcome.HttpError, statusCode: 400, isSlow: false, isAdditionalMonitoredStatus: false },
      { decision: 'skip', reason: 'unmonitored_status' });
  });

  it('http_error 500 configured slow -> store/http_5xx (5xx beats configured and slow)', () => {
    expectDecision({ outcome: RequestOutcome.HttpError, statusCode: 500, isSlow: true, isAdditionalMonitoredStatus: true },
      { decision: 'store', reason: 'http_5xx' });
  });

  it('http_error 429 configured -> store/http_429 (429 beats configured)', () => {
    expectDecision({ outcome: RequestOutcome.HttpError, statusCode: 429, isSlow: false, isAdditionalMonitoredStatus: true },
      { decision: 'store', reason: 'http_429' });
  });

  it('http_error 200 unmonitored not slow -> skip/unmonitored_status', () => {
    expectDecision({ outcome: RequestOutcome.HttpError, statusCode: 200, isSlow: false, isAdditionalMonitoredStatus: false },
      { decision: 'skip', reason: 'unmonitored_status' });
  });
});

describe('decideRequestSampleSelection determinism and purity', () => {
  const cases: readonly RequestSampleSelectionInput[] = [
    { outcome: RequestOutcome.Success, isSlow: true, isAdditionalMonitoredStatus: false },
    { outcome: RequestOutcome.HttpError, statusCode: 429, isSlow: false, isAdditionalMonitoredStatus: false },
    { outcome: RequestOutcome.HttpError, statusCode: 404, isSlow: false, isAdditionalMonitoredStatus: true },
    { outcome: RequestOutcome.Canceled, isSlow: true, isAdditionalMonitoredStatus: true },
    { outcome: RequestOutcome.NetworkError, isSlow: true, isAdditionalMonitoredStatus: false },
    { outcome: RequestOutcome.Timeout, isSlow: false, isAdditionalMonitoredStatus: false },
    { outcome: RequestOutcome.HttpError, statusCode: 599, isSlow: true, isAdditionalMonitoredStatus: true },
  ];

  it('returns the identical result across 100 calls', () => {
    for (const input of cases) {
      const first = decideRequestSampleSelection(input);
      for (let i = 0; i < 100; i += 1) {
        expect(decideRequestSampleSelection(input)).toEqual(first);
      }
    }
  });

  it('does not modify its input', () => {
    for (const input of cases) {
      const snapshot = JSON.parse(JSON.stringify(input)) as RequestSampleSelectionInput;
      decideRequestSampleSelection(input);
      expect(input).toEqual(snapshot);
    }
  });

  it('freezes the returned decision', () => {
    const result = decideRequestSampleSelection(cases[0]);
    expect(Object.isFrozen(result)).toBe(true);
  });
});

describe('decideRequestSampleSelection invalid input', () => {
  it('returns invalid for an unknown outcome', () => {
    const input = { outcome: 'bogus' as RequestOutcome, isSlow: false, isAdditionalMonitoredStatus: false };
    expect(decideRequestSampleSelection(input)).toEqual({
      decision: 'invalid',
      diagnosticCode: 'invalid_request_sample_selection_input',
    });
  });

  it('returns invalid for statusCode below 100', () => {
    expect(select(RequestOutcome.HttpError, { statusCode: 99 })).toEqual({
      decision: 'invalid',
      diagnosticCode: 'invalid_request_sample_selection_input',
    });
  });

  it('returns invalid for statusCode above 599', () => {
    expect(select(RequestOutcome.HttpError, { statusCode: 600 })).toEqual({
      decision: 'invalid',
      diagnosticCode: 'invalid_request_sample_selection_input',
    });
  });

  it('returns invalid for a non-integer statusCode', () => {
    expect(select(RequestOutcome.HttpError, { statusCode: 200.5 })).toEqual({
      decision: 'invalid',
      diagnosticCode: 'invalid_request_sample_selection_input',
    });
  });

  it('returns invalid for a non-boolean isSlow', () => {
    expect(
      decideRequestSampleSelection({
        outcome: RequestOutcome.Success,
        isSlow: 1 as unknown as boolean,
        isAdditionalMonitoredStatus: false,
      }),
    ).toEqual({ decision: 'invalid', diagnosticCode: 'invalid_request_sample_selection_input' });
  });

  it('returns invalid for a non-boolean isAdditionalMonitoredStatus', () => {
    expect(
      decideRequestSampleSelection({
        outcome: RequestOutcome.Success,
        isSlow: false,
        isAdditionalMonitoredStatus: 'yes' as unknown as boolean,
      }),
    ).toEqual({ decision: 'invalid', diagnosticCode: 'invalid_request_sample_selection_input' });
  });

  it('covers every real RequestOutcome value with a valid decision', () => {
    for (const outcome of [
      RequestOutcome.Success,
      RequestOutcome.HttpError,
      RequestOutcome.NetworkError,
      RequestOutcome.Timeout,
      RequestOutcome.Canceled,
    ]) {
      const result = select(outcome);
      expect(result.decision === 'store' || result.decision === 'skip').toBe(true);
    }
  });
});
```

`test/security-negative.test.ts` 追加（在 `error event processor never emits...` describe 内追加一个 `it`）：

```ts
it('request sample selection policy has no side effects, randomness, or sensitive fields', async () => {
  const source = await readFile(
    new URL('../src/request-sample-selection-policy.ts', import.meta.url),
    'utf8',
  );
  expect(source).not.toMatch(/console\./);
  expect(source).not.toMatch(/Math\.random/);
  expect(source).not.toMatch(/Date\.now|new Date\(/);
  expect(source).not.toMatch(/process\.env/);
  expect(source).not.toMatch(/persistRequestEventSample|persistRequestMetricContribution/);
  expect(source).not.toMatch(/INSERT INTO|SELECT.*FROM/);
  expect(source).not.toMatch(/event\.body|EventEnvelope\.body/);
  expect(source).not.toMatch(/Authorization|clientKey|token|password/);
});
```

`test/documentation-contract.test.ts` 第一个 `it` 追加一行断言：

```ts
expect(readme).toContain('请求样本选择策略');
```

## 每个 Task 命令与预期输出

| Task | 命令 | 预期成功 | 预期失败（red 阶段） |
| --- | --- | --- | --- |
| 1 | `pnpm --filter @aurora/ingestion-worker test` | — | `Cannot find module '../src/request-sample-selection-policy.js'` / TS2307 |
| 2 | `pnpm --filter @aurora/ingestion-worker test` | `Test Files  1 passed` / 全部通过 | — |
| 2 | `pnpm --filter @aurora/ingestion-worker typecheck` | `tsc` 退出码 0，无错误 | — |
| 3 | `pnpm --filter @aurora/ingestion-worker test` | 全部单测通过（含 security-negative 新增负例） | — |
| 4 | `pnpm --filter @aurora/ingestion-worker test` | documentation-contract 通过 | — |
| 4 | `pnpm --filter @aurora/ingestion-worker typecheck` | 退出码 0 | — |

## 逻辑 Commit 边界（不实际执行 git add/commit）

1. `request-sample-selection-policy.ts` + `request-sample-selection-policy.test.ts`（Task 1—3）；
2. README + documentation-contract 断言（Task 4a）；
3. 正式规格 implementation-status + formalization-readiness + docs/README + ADR-019 追加记录（Task 4b）。

## Plan Review Record

- Review type: Claude Code implementation-plan self-review
- Scope: request-sample-selection-policy first increment only
- Product direction: approved by current user prompt
- ADR-019 status: accepted / in-progress
- ADR-020 status: accepted / implemented
- New ADR required: no
- Authority conflicts: none
- Existing-feature conflicts: none
- Architecture check: pass
- Code-rule check: pass
- Test-rule check: pass
- Documentation-rule check: pass
- Privacy check: pass
- Outcome exhaustiveness check: pass
- Precedence check: pass
- Dependency check: pass
- Public API check: pass
- Verdict: ready-for-implementation
