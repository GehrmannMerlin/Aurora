# Request Event Processor Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## 文件头

- 日期：2026-08-03
- 模块：`apps/ingestion-worker`（`@aurora/ingestion-worker`）请求事件 Processor 核心
- 正式规格：`docs/architecture/request-event-processor.md`（approved）
- ADR：`docs/adr/ADR-019-request-event-aggregation-and-bounded-diagnostic-sample-storage.md`（accepted / in-progress；本模块追加实施证据，不修改最终结论）
- 计划状态：ready-for-implementation
- 目标读者：零上下文工程师
- 权威来源：CLAUDE.md/AGENTS.md/AURORA_RULES.md 快照、approved 规格、accepted ADR-019/020、approved 请求事件协议契约、既有 `createErrorEventProcessor` 规格与实现、`decideRequestSampleSelection` 规格与实现、PRD 5.1.2/5.1.3/5.1.5/5.1.6、RULE-REQUEST-PERSISTENCE-20260803-002

## Goal

在 `apps/ingestion-worker` 内实现请求事件 Processor 核心第一增量：`createRequestEventProcessor` 工厂（实现既有 `IngestionEventProcessor` 端口）。只处理 `EventType.Request`，通过 `@aurora/event-schema` 包根解析 Request Event，通过注入分类端口获取 `isFailure`/`isSlow`/`isAdditionalMonitoredStatus`，依次调用 `persistRequestMetricContribution`（指标主路径）→ `decideRequestSampleSelection`（样本资格）→ `persistRequestEventSample`（有界安全样本），把稳定结果映射到既有 Worker 结果（`processed`/`retry`/`dead-letter`）。**不**接生产 composition root、**不**实现 Router、**不**实现真实配置 adapter、**不**实现 Request Metric Query、**不**实现 Performance。

## Architecture

```
apps/ingestion-worker/
  src/
    request-event-processor.ts              # 新建：工厂 + 分类端口 + 结果映射 + 诊断类型
    request-sample-selection-policy.ts      # 既有（consume：decideRequestSampleSelection）
    index.ts                                # 追加导出（编辑）
  test/
    request-event-processor.test.ts          # 新建：编排/映射/跨 Store 收敛/隐私负例（fake store）
    integration/
      request-event-processor.test.ts        # 新建：真实 PostgreSQL 17.10 集成
      helpers.ts                             # 追加 processing-store migrations helper（编辑）
    package-entry.test.ts                    # 追加 createRequestEventProcessor 断言（编辑）
    security-negative.test.ts                # 追加 processor 源文件负例（编辑）
    documentation-contract.test.ts           # 追加 README/规格对齐断言（编辑）
  README.md                                 # 追加职责（编辑）
```

依赖方向：`request-event-processor.ts` → `@aurora/event-schema` 包根、`@aurora/processing-store` 包根、`./processor.ts`、`./request-sample-selection-policy.ts`、`./retry-backoff-*`、`./diagnostics.ts`。`aurora.layer: service`；不新增任何包依赖。

## Tech Stack

- TypeScript 6.0.3（strict，NodeNext，ES2024，verbatimModuleSyntax，exactOptionalPropertyTypes）
- vitest 4.1.10；`@aurora/event-schema`、`@aurora/processing-store`（既有 workspace 依赖，vitest alias 指向各包 src/index.ts）
- 真实 PostgreSQL 17.10（集成测试，`AURORA_TEST_DATABASE_URL`）
- 无新依赖、无新 Migration

## Global Constraints

- 只实现请求处理器核心能力；不接 production composition root、不创建生产 bin/start、不实现 Router/Performance/真实配置 adapter/Request Metric Query；
- 非 Request Event（Error/Performance/Resource/未知）→ `dead-letter{invalid_event_type}`（局部前置条件，不伪装 processed、不无限 retry、不静默忽略）；
- 只通过 `@aurora/event-schema` 包根解析 Request Event；不重新定义 `RequestOutcome`/`RequestMethod`/Request Schema；
- 只通过 `@aurora/processing-store` 包根调用 `persistRequestMetricContribution`/`persistRequestEventSample`；不直接 SQL、不访问私有路径；
- 分类端口输入只含安全最小事实（outcome/statusCode?/durationMs/method），不含请求体/响应体/Header/Cookie/Authorization/完整 URL/Query/页面文本/用户信息；不修改输入；不写数据库；不记录原始事件；
- 不硬编码 `slowRequestThreshold = 3000`、额外状态码、采样率、环境或发布规则；`isFailure`/`isSlow`/`isAdditionalMonitoredStatus` 全部来自分类端口；
- 每个合法 Request Event 先应用 metric；metric `applied`/`duplicate` 后调用 `decideRequestSampleSelection`；`skip` 不调用 Sample Store；`store` 才调用 `persistRequestEventSample`；
- `duplicate` 是幂等成功，不进 retry/dead-letter；
- `temporarily_unavailable` → retry，`availableAt` 复用 `calculateRetryBackoffSchedule`（ADR-016）；backoff 非法时不静默降级（抛稳定 Error）；
- 未知异常传播给 Worker runtime；不建立跨 Store 事务 API；
- 不修改 `request_metric_event_applications`/`request_metric_buckets`/`request_event_samples`/`error_event_occurrences`/`event_inbox`；不增加 Migration；
- 不 `git add`/`commit`/`push`/`stash`/`reset`/`rebase`/`clean`；不覆盖用户已有未提交差异。

## 文件树（完整）

```
apps/ingestion-worker/src/request-event-processor.ts            # 新建
apps/ingestion-worker/test/request-event-processor.test.ts       # 新建
apps/ingestion-worker/test/integration/request-event-processor.test.ts  # 新建
apps/ingestion-worker/src/index.ts                              # 追加导出（编辑）
apps/ingestion-worker/test/integration/helpers.ts               # 追加 processing-store migrations helper（编辑）
apps/ingestion-worker/test/package-entry.test.ts                # 追加断言（编辑）
apps/ingestion-worker/test/security-negative.test.ts            # 追加负例（编辑）
apps/ingestion-worker/test/documentation-contract.test.ts       # 追加断言（编辑）
apps/ingestion-worker/README.md                                 # 追加职责（编辑）
docs/superpowers/plans/2026-08-03-request-event-processor.md    # 本计划
docs/architecture/request-event-processor.md                     # 正式规格（已建，实施后更新 implementation-status）
docs/architecture/formalization-readiness.md                     # 状态记录（编辑）
docs/README.md                                                  # 模块条目（编辑）
docs/adr/ADR-019-request-event-aggregation-and-bounded-diagnostic-sample-storage.md  # 追加实施证据（编辑）
```

## 每个文件单一职责

- `src/request-event-processor.ts`：`RequestEventClassification`、`ClassifyRequestEvent`、`RequestEventClassificationInput`（内部投影）、`RequestEventProcessorDiagnostics`/`RequestEventProcessorDiagnostic`、`mapRequestPersistResultsToWorkerResult`（或等价结果映射）、`createRequestEventProcessor` 工厂。不做任何 I/O。
- `test/request-event-processor.test.ts`：fake store + fake 分类端口，覆盖编排矩阵/映射/跨 Store 收敛/隐私负例。不连数据库。
- `test/integration/request-event-processor.test.ts`：真实 PostgreSQL 17.10 集成。
- `test/integration/helpers.ts`：追加 `ensureRequestProcessingTables`（跑 processing-store 全部 migrations 确保 0003/0004/0005 表存在）。
- `src/index.ts`：追加导出 `createRequestEventProcessor`、`mapRequestPersistResultsToWorkerResult`、`RequestEventProcessorDiagnostics`、`RequestEventClassification`、`ClassifyRequestEvent` 类型。
- 文档/规格/ADR-019：只同步真实状态。

## 关键设计决策

1. **工厂形态**：`createRequestEventProcessor(input: CreateRequestEventProcessorInput): IngestionEventProcessor`，与 `createErrorEventProcessor` 完全一致。`CreateRequestEventProcessorInput` 注入：`persistMetric`、`persistSample`、`classify`、`backoff: RetryBackoffConfig`、`calculateBackoff?`、`entropyProvider?`、`now?`、`diagnostics?`。
2. **分类端口**：`classify: ClassifyRequestEvent` 是异步函数，接收处理器解析后的安全最小投影 `RequestEventClassificationInput {outcome, statusCode?, durationMs, method}`，返回 `Promise<RequestEventClassification {isFailure, isSlow, isAdditionalMonitoredStatus}>`。
3. **解析**：先用 `eventType === EventType.Request` 前置校验（非 Request → `dead-letter{invalid_event_type}`），再用 `parseRequestEventEnvelope` 从包根解析；解析失败 → 同样永久拒绝。
4. **结果映射**：metric `applied`/`duplicate` → 继续；`invalid_input` → `dead-letter{invalid_event_type}`；`temporarily_unavailable` → retry。sample `inserted`/`duplicate` → `processed`；`invalid_input` → `dead-letter{invalid_event_type}`；`temporarily_unavailable` → retry。
5. **cross-store 收敛**：metric applied + sample temporary → retry；下次 metric duplicate + sample inserted → processed。无跨 Store 事务。
6. **不扩大处理 Store 公共 API**：本模块只消费已有包根函数。
7. **诊断**：复用 `ErrorEventProcessorDiagnostics` 的 `record(code, inboxId?, eventType?, attemptCount?)` 形态，事件码稳定、不携带正文。

## 完整 TypeScript 签名

```ts
// src/request-event-processor.ts
import type { RequestMethod, RequestOutcome } from '@aurora/event-schema';
import type {
  PersistRequestEventSampleResult,
  PersistRequestMetricContributionResult,
  RequestMetricContributionInput,
} from '@aurora/processing-store';
import type {
  IngestionEventProcessor,
  ProcessIngestionEventInput,
  ProcessIngestionEventResult,
} from './processor.js';
import { calculateRetryBackoffSchedule } from './retry-backoff-policy.js';
import { createNodeCryptoEntropyProvider } from './retry-backoff-entropy.js';
import type { RetryBackoffConfig, RetryBackoffEntropyProvider } from './retry-backoff-types.js';
import { decideRequestSampleSelection } from './request-sample-selection-policy.js';

export interface RequestEventClassification {
  readonly isFailure: boolean;
  readonly isSlow: boolean;
  readonly isAdditionalMonitoredStatus: boolean;
}

export interface RequestEventClassificationInput {
  readonly outcome: RequestOutcome;
  readonly statusCode?: number;
  readonly durationMs: number;
  readonly method: RequestMethod;
}

export type ClassifyRequestEvent = (
  input: RequestEventClassificationInput,
) => Promise<RequestEventClassification>;

export interface RequestEventProcessorDiagnostic {
  readonly code: string;
  readonly inboxId?: number;
  readonly eventType?: string;
  readonly attemptCount?: number;
}

export interface RequestEventProcessorDiagnostics {
  record(diagnostic: RequestEventProcessorDiagnostic): void;
}

export type PersistRequestMetricFn = (input: RequestMetricContributionInput) => Promise<PersistRequestMetricContributionResult>;
export type PersistRequestSampleFn = (input: {
  readonly projectId: string;
  readonly eventEnvelope: unknown;
}) => Promise<PersistRequestEventSampleResult>;

export interface CreateRequestEventProcessorInput {
  readonly persistMetric: PersistRequestMetricFn;
  readonly persistSample: PersistRequestSampleFn;
  readonly classify: ClassifyRequestEvent;
  readonly backoff: RetryBackoffConfig;
  readonly calculateBackoff?: typeof calculateRetryBackoffSchedule;
  readonly entropyProvider?: RetryBackoffEntropyProvider;
  readonly now?: () => Date;
  readonly diagnostics?: RequestEventProcessorDiagnostics;
}

export function createRequestEventProcessor(
  input: CreateRequestEventProcessorInput,
): IngestionEventProcessor;
```

## 每个 Task 精确路径与 TDD 闭环

### Task 1：Processor 输入、依赖与结果映射（red → green）

**Consumes**：`@aurora/event-schema` 包根、`@aurora/processing-store` 包根类型、`./processor.ts`、`./retry-backoff-*`。
**Produces**：`src/request-event-processor.ts`、`test/request-event-processor.test.ts`、`src/index.ts`（追加导出）、`test/package-entry.test.ts`（追加断言）。

1. 失败测试：`test/request-event-processor.test.ts` 定义 fake `persistMetric`/`persistSample`/`classify` 与 helper 构造 `ProcessIngestionEventInput`；断言：
   - 非 Request Event → `dead-letter{invalid_event_type}`，metric/sample 均不调用；
   - 合法 Request + metric applied + selection skip → `processed`，sample 调用次数 0；
   - metric invalid_input → `dead-letter{invalid_event_type}`，sample 不调用；
   - metric temporarily_unavailable → `retry{service_temporarily_unavailable}`，sample 不调用；
   - metric applied + selection store + sample inserted → `processed`；
   - sample duplicate → `processed`；
   - sample invalid_input → `dead-letter{invalid_event_type}`；
   - sample temporarily_unavailable → `retry`。
2. 预期失败：TS2307 `Cannot find module '../src/request-event-processor.js'`。
3. 最小实现：创建 `request-event-processor.ts`（类型 + 结果映射 + 工厂骨架，先实现 metric/sample 顺序与映射），在 `src/index.ts` 追加导出，`test/package-entry.test.ts` 追加 `expect(typeof createRequestEventProcessor).toBe('function')`。
4. 确认通过：`pnpm --filter @aurora/ingestion-worker test`。
5. 回归：`request-sample-selection-policy.test.ts`/`error-event-processor.test.ts` 不回归。
6. 提交边界：`request-event-processor.ts` + `request-event-processor.test.ts` + `index.ts` + `package-entry.test.ts` 同批（不执行 git add/commit）。

### Task 2：分类端口与 metric 主路径

**Consumes**：`request-event-processor.ts`。
**Produces**：`src/request-event-processor.ts`（完善 `classify` 调用）、`test/request-event-processor.test.ts`（追加）。

1. 失败测试追加：
   - classify 返回的 `isFailure`/`isSlow`/`isAdditionalMonitoredStatus` 正确传入 `persistMetric`（fake 断言参数）；
   - classify 抛出异常 → 异常传播（metric/sample 不调用）；
   - metric 未知异常 → 异常传播；
   - backoff 非法（`{initialDelayMs:0, maxDelayMs:1000}`）→ 抛稳定 Error（不静默降级）；
   - metric temporarily_unavailable → `retry.availableAt` 落在 backoff 计算区间（注入 `entropyProvider:{next:()=>0}` + `now:()=>NOW`，断言精确值）。
2. 预期失败：`classify` 未被调用或参数不符 → 断言失败。
3. 最小实现：在 `process` 中调用 `input.classify({outcome,statusCode,durationMs,method})`，构造 `RequestMetricContributionInput`，处理 metric 结果映射，backoff 非法抛错。
4. 确认通过：`pnpm --filter @aurora/ingestion-worker test`。
5. 回归：同上。
6. 提交边界：`request-event-processor.ts` + 测试同批。

### Task 3：Sample Selection 与 Sample Store

**Consumes**：`request-event-processor.ts`、`decideRequestSampleSelection`。
**Produces**：`src/request-event-processor.ts`（`skip`/`store` 分支）、`test/request-event-processor.test.ts`（追加）。

1. 失败测试追加：
   - selection skip → `processed`，`persistSample` 调用 0 次；
   - selection store → `persistSample` 收到 `{projectId, eventEnvelope: input.event}`；
   - selection invalid（程序缺陷）→ 不伪造 processed（抛稳定 Error）；
   - cancelled（classify 返回 isSlow=false, isAdditionalMonitoredStatus=false, outcome=canceled）→ skip；
   - network failure/timeout/429/5xx/configured/slow 各驱动 store；
   - 传给 `decideRequestSampleSelection` 的输入（outcome/statusCode/isSlow/isAdditionalMonitoredStatus）正确。
2. 预期失败：`persistSample` 调用次数/参数断言失败。
3. 最小实现：metric applied/duplicate 后调用 `decideRequestSampleSelection`，`skip` 返回 processed、`store` 调用 `persistSample` 并映射结果。
4. 确认通过：`pnpm --filter @aurora/ingestion-worker test`。
5. 回归：`request-sample-selection-policy.test.ts` 不回归。
6. 提交边界：同批。

### Task 4：跨 Store 重试收敛

**Consumes**：`request-event-processor.ts`。
**Produces**：`test/request-event-processor.test.ts`（追加）。

1. 失败测试追加：
   - metric applied + sample temporarily_unavailable → 第一次 retry；第二次（metric duplicate + sample inserted）→ processed；
   - 断言两次 `persistMetric` 调用：第一次 applied、第二次 duplicate；
   - 断言 `persistSample` 只在第二次被调用；
   - 断言 retry `availableAt` 来自 backoff（注入确定 entropy/now）。
2. 预期失败：收敛断言失败。
3. 最小实现：sample temporarily_unavailable → retry（复用 backoff）；无需额外代码（第二次调用时 store 天然返回 duplicate）。
4. 确认通过：`pnpm --filter @aurora/ingestion-worker test`。
5. 回归：同上。
6. 提交边界：同批。

### Task 5：错误、边界与隐私负例

**Consumes**：`request-event-processor.ts`。
**Produces**：`src/request-event-processor.ts`（如有需要）、`test/security-negative.test.ts`（追加）、`test/request-event-processor.test.ts`（追加）。

1. `test/security-negative.test.ts` 追加：读取 `src/request-event-processor.ts`，断言不匹配 `console\.`、`Math\.random`、`Date\.now|new Date\(`、`process\.env`、`INSERT INTO|SELECT.*FROM`、`event\.body|EventEnvelope\.body`、`Authorization|clientKey|token|password`、`slowRequestThreshold|3000`。
2. `test/request-event-processor.test.ts` 追加：
   - 输入对象不被修改；
   - 非 Request Event 不调用 metric/sample；
   - 不导入 Store 私有路径（源文件断言）。
3. 确认通过：`pnpm --filter @aurora/ingestion-worker test`。
4. 回归：`security-negative.test.ts` 既有负例不回归。
5. 提交边界：同批。

### Task 6：真实 PostgreSQL 17.10 集成

**Consumes**：`helpers.ts`、`@aurora/processing-store` 包根。
**Produces**：`test/integration/request-event-processor.test.ts`、`test/integration/helpers.ts`（追加 `ensureRequestProcessingTables`）。

1. `helpers.ts` 追加 `ensureRequestProcessingTables`：跑 `processingStoreMigrationsDir()` 全部 migrations（count Infinity），确保 `error_event_occurrences`(0003)/`request_event_samples`(0004)/`request_metric_buckets`+`request_metric_event_applications`(0005) 表存在。
2. `test/integration/request-event-processor.test.ts`：
   - 注入真实 `persistMetricContribution(pool, input)`/`persistRequestEventSample(pool, input)`，classify 用确定 fake；
   - metric applied + selection skip → `request_metric_buckets` 计数 +1、`request_event_samples` 无行；
   - metric applied + selection store + sample inserted → 两表都有记录；
   - replay（同 eventId 二次处理）→ metric duplicate + sample duplicate → processed，指标不重复、样本一行；
   - sample 暂时失败收敛：先注入返回 temporarily_unavailable 的 fake sample → retry → 换真实 sample → metric duplicate + sample inserted → processed；
   - 非 Request Event → dead-letter，两表无行；
   - Error Processor 回归、Sample Store 回归、Metric Store 回归（同库其他测试文件）。
3. 确认通过：`pnpm --filter @aurora/ingestion-worker test:integration`。
4. 回归：`error-event-processor.test.ts`/`worker-backoff-retry.test.ts` 不回归。
5. 提交边界：集成测试 + helpers 同批。

### Task 7：README、规格和状态同步

**Consumes**：既有文档状态。
**Produces**：编辑 `README.md`、`test/documentation-contract.test.ts`、`docs/architecture/request-event-processor.md`（`implementation-status` → implemented）、`docs/architecture/formalization-readiness.md`、`docs/README.md`、`docs/adr/ADR-019-...md`（追加实施证据）。

1. `README.md`：职责追加"请求事件 Processor 核心（`createRequestEventProcessor`：只处理 `EventType.Request`、经 event-schema 包根解析、分类端口、指标主路径、样本选择、有界安全样本）"；非职责追加"不接生产 composition root、不实现 Router/真实配置 adapter/Request Metric Query"。
2. `documentation-contract.test.ts`：第一个测试追加 `expect(readme).toContain('请求事件 Processor')`。
3. 正式规格 `implementation-status` → implemented，定位节声明已实施。
4. `formalization-readiness.md`：状态记录更新（request event processor core implemented；config adapter/Query/Router/生产接线 not-started / blocked；ADR-019 保持 in-progress、ADR-020 保持 implemented）。
5. `docs/README.md`：模块表新增一行。
6. ADR-019 追加记录：request event processor core 实施证据。
7. 确认通过：`pnpm --filter @aurora/ingestion-worker test`、`pnpm --filter @aurora/ingestion-worker typecheck`。

## 测试代码（精确）

### 单元测试 helper（`test/request-event-processor.test.ts` 顶部）

```ts
import { describe, expect, it, vi } from 'vitest';
import { RequestOutcome } from '@aurora/event-schema';
import {
  createRequestEventProcessor,
  type ClassifyRequestEvent,
  type RequestEventClassification,
  type PersistRequestMetricFn,
  type PersistRequestSampleFn,
  type RequestEventProcessorDiagnostics,
} from '../src/request-event-processor.js';
import type { ProcessIngestionEventInput } from '../src/processor.js';
import type { RetryBackoffConfig, RetryBackoffEntropyProvider } from '../src/retry-backoff-types.js';
import type {
  PersistRequestEventSampleResult,
  PersistRequestMetricContributionResult,
  RequestMetricContributionInput,
} from '@aurora/processing-store';

const NOW = new Date('2026-08-03T00:00:00.000Z');
const backoff: RetryBackoffConfig = { initialDelayMs: 100, maxDelayMs: 1000 };

function zeroEntropy(): RetryBackoffEntropyProvider {
  return { next: () => 0 };
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

function validInput(overrides?: Partial<ProcessIngestionEventInput>): ProcessIngestionEventInput {
  return {
    inboxId: 1,
    projectId: '11111111-1111-1111-1111-111111111111',
    eventId: 'evt-1',
    event: requestEnvelope('evt-1') as ProcessIngestionEventInput['event'],
    attemptCount: 1,
    leaseId: '00000000-0000-0000-0000-000000000001',
    leaseExpiresAt: new Date('2026-08-03T00:01:00.000Z'),
    ...overrides,
  };
}

function classification(overrides?: Partial<RequestEventClassification>): RequestEventClassification {
  return { isFailure: false, isSlow: false, isAdditionalMonitoredStatus: false, ...overrides };
}

function metricResult(status: PersistRequestMetricContributionResult['status']): PersistRequestMetricContributionResult {
  return status === 'applied'
    ? { status: 'applied' }
    : status === 'duplicate'
      ? { status: 'duplicate' }
      : status === 'invalid_input'
        ? { status: 'invalid_input', code: 'invalid_outcome' }
        : { status: 'temporarily_unavailable' };
}

function sampleResult(status: PersistRequestEventSampleResult['status']): PersistRequestEventSampleResult {
  return status === 'inserted'
    ? { status: 'inserted', sampleId: '7' }
    : status === 'duplicate'
      ? { status: 'duplicate' }
      : status === 'invalid_input'
        ? { status: 'invalid_input', code: 'invalid_request_event' }
        : { status: 'temporarily_unavailable' };
}
```

### 单元测试用例（`describe('createRequestEventProcessor')`）

覆盖（与规格第 24 节矩阵一一对应，含 fake 断言）：

1. 非 Request Event → `{outcome:'dead-letter', errorCode:'invalid_event_type'}`，metric/sample 不调用；
2. metric applied + classify 返回取消场景（outcome canceled）→ selection skip → `processed`，sample 0 次；
3. metric duplicate + selection skip → `processed`；
4. metric invalid_input → `dead-letter{invalid_event_type}`，sample 0 次；
5. metric temporarily_unavailable → `retry{service_temporarily_unavailable, availableAt=NOW+50}`（注入 zeroEntropy + now），sample 0 次；
6. metric 未知异常（fake throw）→ 异常传播（`await expect(...).rejects.toThrow('boom')`）；
7. metric applied + selection store + sample inserted → `processed`；
8. metric duplicate + sample duplicate → `processed`；
9. sample invalid_input → `dead-letter{invalid_event_type}`；
10. sample temporarily_unavailable → `retry{service_temporarily_unavailable}`；
11. sample 未知异常 → 传播；
12. selection skip 时 sample 调用 0 次（fake `persistSample` 断言 `toHaveBeenCalledTimes(0)`）；
13. classify 收到的输入 `{outcome,statusCode,durationMs,method}` 正确（fake 捕获断言，不含 url/Header/Cookie）；
14. classifier 异常 → 传播，metric/sample 不调用；
15. backoff 非法（config `{initialDelayMs:0,maxDelayMs:1000}`）→ 抛稳定 Error；
16. cross-store 收敛：metric applied + sample temporary → 第一次 retry；第二次 metric duplicate + sample inserted → `processed`；两次 `persistMetric` 分别收到 applied/duplicate；`persistSample` 只在第二次调用；
17. 输入对象不被修改（快照断言）；
18. 诊断事件不含事件正文/敏感字段（recording diagnostics 断言 codes）。

### 集成测试（`test/integration/request-event-processor.test.ts`）

模式同 `error-event-processor.test.ts`：`describeDb` 守卫、`beforeAll` 建池 + `migrateUp()` + `ensureRequestProcessingTables()` + 清理三表 + `clearEventInbox`，`afterAll` 清理三表 + 关池。注入真实 `persistMetricContribution(pool, input)`/`persistRequestEventSample(pool, input)` + 确定 classify fake + 确定 backoff。用例：

1. metric applied + selection skip → `request_metric_buckets` 计数 +1（按 project/method/outcome/status_code 查询）、`request_event_samples` 0 行；
2. metric applied + selection store + sample inserted → 两表各 1 行；
3. replay 同 eventId → metric duplicate + sample duplicate → `processed`，`observed_count` 不重复、样本 1 行；
4. sample 暂时失败收敛：先 fake sample temporary → retry → 换真实 sample → metric duplicate + sample inserted → `processed`；
5. 非 Request Event → `dead-letter`，两表 0 行；
6. 清理断言：无残留 leased 行、三表清空。

## 每个 Task 命令与预期输出

| Task | 命令 | 预期成功 | 预期失败（red 阶段） |
| --- | --- | --- | --- |
| 1 | `pnpm --filter @aurora/ingestion-worker test` | 新增测试通过 | TS2307 `Cannot find module '../src/request-event-processor.js'` |
| 2 | `pnpm --filter @aurora/ingestion-worker test` | classify/metric 参数断言通过 | 断言失败（classify 未调用） |
| 3 | `pnpm --filter @aurora/ingestion-worker test` | sample 分支断言通过 | `persistSample` 调用次数/参数不符 |
| 4 | `pnpm --filter @aurora/ingestion-worker test` | 收敛断言通过 | 收敛失败 |
| 5 | `pnpm --filter @aurora/ingestion-worker test` | 负例通过 | 负例正则命中 |
| 6 | `pnpm --filter @aurora/ingestion-worker test:integration` | 集成用例通过 | 表不存在/断言失败 |
| 7 | `pnpm --filter @aurora/ingestion-worker test` + `typecheck` | 通过 | — |

## 逻辑 Commit 边界（不实际执行 git add/commit）

1. `request-event-processor.ts` + `request-event-processor.test.ts` + `index.ts` + `package-entry.test.ts`（Task 1—5）；
2. `test/integration/request-event-processor.test.ts` + `helpers.ts` 追加（Task 6）；
3. README + documentation-contract + 正式规格 + formalization-readiness + docs/README + ADR-019（Task 7）。

## Plan Review Record

- Review type: Claude Code implementation-plan self-review
- Scope: request-event-processor core first increment only
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
- Worker-result mapping check: pass
- Cross-store convergence check: pass
- Retry/backoff check: pass
- Public API check: pass
- Production-wiring check: blocked as designed
- Verdict: ready-for-implementation
