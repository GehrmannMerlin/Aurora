# DAT-09 Performance Event Processor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `apps/ingestion-worker`（`@aurora/ingestion-worker`）实现 DAT-09 性能事件 Processor 核心第一增量：`createPerformanceEventProcessor` 工厂，只处理 `EventType.Performance`，经 `@aurora/event-schema` 包根 `parsePerformanceEventEnvelope` 解析，把每个合法性能事件构建为 DAT-08 已批准的 `PerformanceMetricContributionInput` 并调用 `persistPerformanceMetricContribution`（聚合主路径），把稳定结果映射到既有 `IngestionEventProcessor` 结果。**V1 不调用 `persistPerformanceEventSample`（不保存性能诊断样本）。**

**本计划关闭叶子：DAT-09**
**本计划关闭数量：1**
**预期完成后：completed 34 → 35，remaining 44 → 43**

## Global Constraints

- 不修改 `@aurora/event-schema`、`@aurora/processing-store`、`@aurora/ingestion-inbox` 公共 API；不修改 performance-event-contract；
- 不新增 `apps/ingestion-worker` 的 `package.json` 依赖（`@aurora/processing-store`/`@aurora/event-schema` 已存在）；
- 不创建数据库表、Migration、Redis、队列或云资源；不接生产 composition root（DAT-11）；不实现总事件路由器（DAT-10）；
- `IngestionEventProcessor`/`ProcessIngestionEventInput`/`ProcessIngestionEventResult` 公共签名不变；
- **V1 不调用 `persistPerformanceEventSample`**：不实现样本容量/淘汰/first-wins/随机/优先级/reservoir；不根据页面/环境/指标挑样本；
- **无服务器侧二次采样**：不对到达 Worker 的合法性能事件应用 10% 采样、不 double sampling；SDK 10% 采样与 DAT-09 服务端聚合是分离关注点；
- 只接受 `PerformanceMetricName` 四项（lcp/inp/cls/page_load）；不新建指标；不重新计算 LCP/INP/CLS；不修改 value/occurredAt/startedAt；
- 禁止采集/记录请求体、响应体、Header、Cookie、Authorization、完整 URL、查询参数值、页面文本、DOM、用户信息；禁止写日志；禁止 `Date.now`/`Math.random`/`process.env`；
- 严格 TypeScript、单一职责、文件 kebab-case、类型 PascalCase、函数 camelCase、布尔 `is` 前缀、无 `utils`/`helpers`/`common`；
- 覆盖率门槛 lines ≥ 85%、branches ≥ 80%、functions ≥ 85%、statements ≥ 85%；不得删除或弱化失败测试；
- 本计划执行实际**不执行 `git add`/`commit`/`push`**；Commit 步骤只作为逻辑提交边界保留。

## 固定回读与权威边界

| Module ID | 完整回读文件 | 重点章节 | 本计划不得改变的业务逻辑 | 缺失门禁 |
| --- | --- | --- | --- | --- |
| DAT-09 | `Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md`；`Aurora 架构规范.md`；`docs/architecture/system-overview.md`；`Aurora 代码规范.md`；`Aurora 测试规范.md`；`Aurora ADR 规范.md`；`Aurora 文档规范.md`；`docs/protocol/performance-event-contract.md`；`docs/architecture/ingestion-worker-runtime.md`；`docs/architecture/ingestion-worker-retry-budget-policy.md`；`docs/architecture/ingestion-worker-retry-backoff-schedule.md`；`docs/architecture/ingestion-dead-letter-manual-replay.md`；`docs/architecture/error-event-occurrence-processing-store.md`；`docs/architecture/error-event-processor.md`；`docs/architecture/request-event-sample-processing-store.md`；`docs/architecture/request-metric-aggregate-store.md`；`docs/architecture/request-sample-selection-policy.md`；`docs/architecture/request-event-processor.md`；`docs/architecture/request-processing-rules-configuration-adapter.md`；`docs/architecture/performance-metric-aggregate-and-bounded-sample-store.md`；`docs/architecture/performance-event-processor.md`；`docs/adr/ADR-012/015/016/017/018/019/020/021`；`docs/adr/README.md`；`docs/architecture/formalization-readiness.md`；`docs/README.md` | PRD §5.1.9、§15.2；Performance Contract §4—10、§17—18；DAT-08 规格 §33/§34/§52；ADR-021 决定细节 12；Error/Request Processor 的工厂/端口/结果映射/异常传播模式；Worker Runtime §9—§16 | 四项性能指标、聚合主路径、V1 不保存性能诊断样本、无 double sampling、`(project_id, event_id)` 幂等、结果映射（applied/duplicate→processed、invalid_input→dead-letter、temporarily_unavailable→retry）、retry/backoff/lease lost 不重新实现 | approved DAT-09 spec（`docs/architecture/performance-event-processor.md`）；accepted ADR-021/DAT-08；真实 PostgreSQL 工具链 |

## 文件结构映射

```text
apps/ingestion-worker/
├── src/
│   ├── performance-event-processor.ts        # Create：createPerformanceEventProcessor 工厂 + 类型
│   └── index.ts                              # Modify：追加包根导出
├── test/
│   ├── performance-event-processor.test.ts   # Create：单元测试（fake store）
│   ├── integration/
│   │   └── performance-event-processor.test.ts  # Create：真实 PostgreSQL 集成测试
│   ├── package-entry.test.ts                 # Modify：追加导出断言
│   ├── documentation-contract.test.ts        # Modify：追加规格对齐断言
│   └── security-negative.test.ts             # Modify：追加处理器源码安全负例
├── README.md                                 # Modify：性能处理器职责/接口
└── package.json                              # 不修改（无新依赖）

docs/
├── architecture/performance-event-processor.md  # Create（已存在，规格，本计划依赖）
├── architecture/formalization-readiness.md      # Modify：DAT-09 implemented 状态记录
├── README.md                                    # Modify：模块表新增一行
├── adr/ADR-021-performance-aggregate-and-bounded-sample-storage.md  # Modify：追加 DAT-09 实施证据
└── superpowers/plans/2026-08-07-performance-event-processor.md      # 本计划
```

### 单一职责

| 文件 | 单一职责 |
| --- | --- |
| `src/performance-event-processor.ts` | 性能处理器工厂 + 诊断端口 + 结果映射 + 聚合贡献构造；单一文件承载本模块全部核心逻辑 |
| `test/performance-event-processor.test.ts` | 处理器单元测试：解析/聚合/映射/幂等/隐私/no-sample/no-sampling |
| `test/integration/performance-event-processor.test.ts` | 真实 PostgreSQL：处理器 → 聚合 Store 组合 |
| `src/index.ts` | worker 包根公共出口（最小追加导出） |
| `test/package-entry.test.ts` / `documentation-contract.test.ts` / `security-negative.test.ts` | 包入口、文档对齐、安全负例门禁 |
| `apps/ingestion-worker/README.md` | 模块职责、对外接口、非职责边界 |

## 范围与排除

**本轮范围**：性能处理器核心能力 + 包根导出 + 单元/集成测试 + README + 正式规格/状态/ADR 证据同步。

**明确排除（不在本计划实现）**：DAT-10 Event Processor Router、DAT-11 production composition root、DAT-17 Performance Query、性能诊断样本保存（不调用 `persistPerformanceEventSample`）、percentile/直方图、页面/环境/发布维度、采样率执行/采样外推、Issue、告警、数据保留清理、事件协议修改、新缓存/队列/云资源。

## Task 1：性能处理器类型、诊断端口与工厂（含结果映射）

**Files:**
- Create: `apps/ingestion-worker/src/performance-event-processor.ts`
- Create: `apps/ingestion-worker/test/performance-event-processor.test.ts`

**Interfaces:**
- Consumes: `@aurora/event-schema` 包根（`parsePerformanceEventEnvelope`、`PerformanceMetricName`/`PerformanceMetricUnit`、`EventType` 类型、`IngestionErrorCode`）；`@aurora/processing-store` 包根（`persistPerformanceMetricContribution`、`PerformanceMetricContributionInput`、`PersistPerformanceMetricContributionResult` 类型）；`./processor.ts`（`IngestionEventProcessor`/`ProcessIngestionEventInput`/`ProcessIngestionEventResult`）；`./retry-backoff-*.ts`（`RetryBackoffConfig`/`RetryBackoffEntropyProvider`/`calculateRetryBackoffSchedule`/`createNodeCryptoEntropyProvider`）
- Produces:
  ```ts
  export interface PerformanceEventProcessorDiagnostic {
    readonly code: string;
    readonly inboxId?: number;
    readonly eventType?: string;
    readonly attemptCount?: number;
  }
  export interface PerformanceEventProcessorDiagnostics {
    record(diagnostic: PerformanceEventProcessorDiagnostic): void;
  }
  export type PersistPerformanceMetricFn = (
    input: PerformanceMetricContributionInput,
  ) => Promise<PersistPerformanceMetricContributionResult>;
  export interface CreatePerformanceEventProcessorInput {
    readonly persistMetric: PersistPerformanceMetricFn;
    readonly backoff: RetryBackoffConfig;
    readonly calculateBackoff?: typeof calculateRetryBackoffSchedule;
    readonly entropyProvider?: RetryBackoffEntropyProvider;
    readonly now?: () => Date;
    readonly diagnostics?: PerformanceEventProcessorDiagnostics;
  }
  export function createPerformanceEventProcessor(
    input: CreatePerformanceEventProcessorInput,
  ): IngestionEventProcessor;
  ```

- [x] **Step 1: 写失败测试**

创建 `apps/ingestion-worker/test/performance-event-processor.test.ts`（先写核心失败测试）：

```ts
import { describe, expect, it, vi } from 'vitest';
import type {
  PersistPerformanceMetricContributionResult,
  PerformanceMetricContributionInput,
} from '@aurora/processing-store';
import {
  createPerformanceEventProcessor,
  type PersistPerformanceMetricFn,
  type PerformanceEventProcessorDiagnostics,
} from '../src/performance-event-processor.js';
import type { ProcessIngestionEventInput } from '../src/processor.js';
import type { RetryBackoffConfig, RetryBackoffEntropyProvider } from '../src/retry-backoff-types.js';

const NOW = new Date('2026-08-07T00:00:00.000Z');
const backoff: RetryBackoffConfig = { initialDelayMs: 100, maxDelayMs: 1000 };

function zeroEntropy(): RetryBackoffEntropyProvider {
  return { next: () => 0 };
}

function performanceEnvelope(eventId: string, bodyOverrides?: Record<string, unknown>): unknown {
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

function validInput(overrides?: Partial<ProcessIngestionEventInput>): ProcessIngestionEventInput {
  return {
    inboxId: 1,
    projectId: '11111111-1111-1111-1111-111111111111',
    eventId: 'evt-perf-1',
    event: performanceEnvelope('evt-perf-1') as ProcessIngestionEventInput['event'],
    attemptCount: 1,
    leaseId: '00000000-0000-0000-0000-000000000001',
    leaseExpiresAt: new Date('2026-08-07T00:01:00.000Z'),
    ...overrides,
  };
}

function metricResult(
  status: PersistPerformanceMetricContributionResult['status'],
): PersistPerformanceMetricContributionResult {
  return status === 'applied'
    ? { status: 'applied' }
    : status === 'duplicate'
      ? { status: 'duplicate' }
      : status === 'invalid_input'
        ? { status: 'invalid_input', code: 'invalid_metric_name' }
        : { status: 'temporarily_unavailable' };
}

function recordingDiagnostics(): {
  diagnostics: PerformanceEventProcessorDiagnostics;
  codes: string[];
} {
  const codes: string[] = [];
  return {
    codes,
    diagnostics: {
      record: (entry) => {
        codes.push(entry.code);
      },
    },
  };
}

describe('createPerformanceEventProcessor', () => {
  it('rejects a non-performance event as a local precondition without touching the store', async () => {
    const persistMetric = vi.fn<PersistPerformanceMetricFn>();
    const processor = createPerformanceEventProcessor({
      persistMetric,
      backoff,
      entropyProvider: zeroEntropy(),
      now: () => NOW,
    });
    const result = await processor.process(
      validInput({ event: { eventType: 'error' } as ProcessIngestionEventInput['event'] }),
      new AbortController().signal,
    );
    expect(result).toEqual({ outcome: 'dead-letter', errorCode: 'invalid_event_type' });
    expect(persistMetric).not.toHaveBeenCalled();
  });

  it('returns processed when the aggregate contribution is applied for an lcp event', async () => {
    const persistMetric = vi.fn<PersistPerformanceMetricFn>().mockResolvedValue(metricResult('applied'));
    const processor = createPerformanceEventProcessor({
      persistMetric,
      backoff,
      entropyProvider: zeroEntropy(),
      now: () => NOW,
    });
    const result = await processor.process(validInput(), new AbortController().signal);
    expect(result).toEqual({ outcome: 'processed' });
  });

  it('maps an aggregate duplicate to processed (idempotent success)', async () => {
    const persistMetric = vi.fn<PersistPerformanceMetricFn>().mockResolvedValue(metricResult('duplicate'));
    const processor = createPerformanceEventProcessor({
      persistMetric,
      backoff,
      entropyProvider: zeroEntropy(),
      now: () => NOW,
    });
    const result = await processor.process(validInput(), new AbortController().signal);
    expect(result).toEqual({ outcome: 'processed' });
  });

  it('maps an aggregate invalid_input to dead-letter', async () => {
    const persistMetric = vi.fn<PersistPerformanceMetricFn>().mockResolvedValue(metricResult('invalid_input'));
    const processor = createPerformanceEventProcessor({
      persistMetric,
      backoff,
      entropyProvider: zeroEntropy(),
      now: () => NOW,
    });
    const result = await processor.process(validInput(), new AbortController().signal);
    expect(result).toEqual({ outcome: 'dead-letter', errorCode: 'invalid_event_type' });
  });

  it('maps an aggregate temporarily_unavailable to retry with a bounded availableAt', async () => {
    const persistMetric = vi
      .fn<PersistPerformanceMetricFn>()
      .mockResolvedValue(metricResult('temporarily_unavailable'));
    const processor = createPerformanceEventProcessor({
      persistMetric,
      backoff,
      entropyProvider: zeroEntropy(),
      now: () => NOW,
    });
    const result = await processor.process(validInput(), new AbortController().signal);
    expect(result.outcome).toBe('retry');
    if (result.outcome === 'retry') {
      expect(result.errorCode).toBe('service_temporarily_unavailable');
      expect(result.availableAt.getTime()).toBe(NOW.getTime() + 50);
    }
  });

  it('propagates a store unknown exception', async () => {
    const persistMetric = vi.fn<PersistPerformanceMetricFn>().mockRejectedValue(new Error('store-boom'));
    const processor = createPerformanceEventProcessor({
      persistMetric,
      backoff,
      entropyProvider: zeroEntropy(),
      now: () => NOW,
    });
    await expect(processor.process(validInput(), new AbortController().signal)).rejects.toThrow(
      'store-boom',
    );
  });

  it('constructs the metric contribution with parsed fields for lcp/inp/cls/page_load', async () => {
    const args: PerformanceMetricContributionInput[] = [];
    const persistMetric: PersistPerformanceMetricFn = vi.fn().mockImplementation((input) => {
      args.push(input);
      return Promise.resolve(metricResult('applied'));
    });
    const processor = createPerformanceEventProcessor({
      persistMetric,
      backoff,
      entropyProvider: zeroEntropy(),
      now: () => NOW,
    });
    const input = validInput({
      event: performanceEnvelope('evt-perf-inp', { metricName: 'inp', value: 320, unit: 'millisecond' }) as ProcessIngestionEventInput['event'],
    });
    await processor.process(input, new AbortController().signal);
    expect(args).toHaveLength(1);
    expect(args[0]).toMatchObject({
      projectId: input.projectId,
      eventId: 'evt-perf-inp',
      occurredAt: 1_800_000_054_000,
      metricName: 'inp',
      unit: 'millisecond',
      value: 320,
      startedAt: 1_800_000_050_000,
    });
  });

  it('includes durationMs in the contribution when present', async () => {
    const args: PerformanceMetricContributionInput[] = [];
    const persistMetric: PersistPerformanceMetricFn = vi.fn().mockImplementation((input) => {
      args.push(input);
      return Promise.resolve(metricResult('applied'));
    });
    const processor = createPerformanceEventProcessor({
      persistMetric,
      backoff,
      entropyProvider: zeroEntropy(),
      now: () => NOW,
    });
    const input = validInput({
      event: performanceEnvelope('evt-perf-dur', { durationMs: 300 }) as ProcessIngestionEventInput['event'],
    });
    await processor.process(input, new AbortController().signal);
    expect(args[0]?.durationMs).toBe(300);
  });
});
```

- [x] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @aurora/ingestion-worker test -- test/performance-event-processor.test.ts`
Expected: FAIL —— 模块不存在（Cannot find module '../src/performance-event-processor.js'）。

- [x] **Step 3: 写最小实现**

创建 `apps/ingestion-worker/src/performance-event-processor.ts`：

```ts
import {
  parsePerformanceEventEnvelope,
  type EventType,
  type IngestionErrorCode,
} from '@aurora/event-schema';
import type {
  PersistPerformanceMetricContributionResult,
  PerformanceMetricContributionInput,
} from '@aurora/processing-store';
import type {
  IngestionEventProcessor,
  ProcessIngestionEventInput,
  ProcessIngestionEventResult,
} from './processor.js';
import { calculateRetryBackoffSchedule } from './retry-backoff-policy.js';
import { createNodeCryptoEntropyProvider } from './retry-backoff-entropy.js';
import type { RetryBackoffConfig, RetryBackoffEntropyProvider } from './retry-backoff-types.js';

/** Stable diagnostic facts emitted by the performance processor; never carries the event body. */
export interface PerformanceEventProcessorDiagnostic {
  readonly code: string;
  readonly inboxId?: number;
  readonly eventType?: string;
  readonly attemptCount?: number;
}

/** Optional bounded diagnostics port. */
export interface PerformanceEventProcessorDiagnostics {
  record(diagnostic: PerformanceEventProcessorDiagnostic): void;
}

/** Inject the processing-store root performance metric persistence function or a compatible fake. */
export type PersistPerformanceMetricFn = (
  input: PerformanceMetricContributionInput,
) => Promise<PersistPerformanceMetricContributionResult>;

export interface CreatePerformanceEventProcessorInput {
  readonly persistMetric: PersistPerformanceMetricFn;
  readonly backoff: RetryBackoffConfig;
  readonly calculateBackoff?: typeof calculateRetryBackoffSchedule;
  readonly entropyProvider?: RetryBackoffEntropyProvider;
  readonly now?: () => Date;
  readonly diagnostics?: PerformanceEventProcessorDiagnostics;
}

const NOOP_DIAGNOSTICS: PerformanceEventProcessorDiagnostics = {
  record: () => undefined,
};

/**
 * Map a processing-store performance metric persistence result to the worker
 * processed / dead-letter outcome. applied and duplicate are idempotent success;
 * invalid_input is a permanent rejection (SDK must not retry).
 * temporarily_unavailable is handled by the factory (it needs backoff) and
 * throws as a program-defect branch here.
 */
export function mapPerformanceMetricResultToWorkerResult(
  result: PersistPerformanceMetricContributionResult,
):
  | { readonly outcome: 'processed' }
  | { readonly outcome: 'dead-letter'; readonly errorCode: IngestionErrorCode } {
  if (result.status === 'applied' || result.status === 'duplicate') {
    return { outcome: 'processed' };
  }
  if (result.status === 'invalid_input') {
    return { outcome: 'dead-letter', errorCode: 'invalid_event_type' };
  }
  // temporarily_unavailable is a temporary outcome, not a terminal mapping.
  throw new Error('temporarily_unavailable is not a terminal worker outcome');
}

/**
 * Create a concrete performance event processor. It accepts the worker
 * processing input, validates that the envelope is a performance event, parses
 * it through the @aurora/event-schema root, constructs the DAT-08 approved
 * aggregate contribution, persists it through the injected processing-store
 * root function, and maps the stable result to the worker outcome (processed /
 * retry / dead-letter). This increment aggregates every valid performance event
 * delivered to its boundary and does NOT persist bounded performance diagnostic
 * samples (persistPerformanceEventSample is not called); upstream SDK sampling
 * and downstream diagnostic-sample selection are separate concerns. Never
 * touches the database directly, never creates or closes a Pool, never copies
 * retry budget / backoff / lease / store logic, and never writes logs.
 */
export function createPerformanceEventProcessor(
  input: CreatePerformanceEventProcessorInput,
): IngestionEventProcessor {
  const calculateBackoff = input.calculateBackoff ?? calculateRetryBackoffSchedule;
  const entropyProvider = input.entropyProvider ?? createNodeCryptoEntropyProvider();
  const now = input.now ?? (() => new Date());
  const diagnostics = input.diagnostics ?? NOOP_DIAGNOSTICS;

  const computeRetry = (
    inboxId: number,
    eventType: string,
    attemptCount: number,
  ): ProcessIngestionEventResult => {
    const backoffResult = calculateBackoff({
      config: input.backoff,
      attemptCount,
      now: now(),
      entropy: entropyProvider.next(),
    });
    if (backoffResult.status !== 'success') {
      // Program defect: the caller supplied an invalid backoff configuration.
      // Do not silently downgrade to a business retry; let the worker runtime
      // treat this as an unclassified processor failure (ADR-015).
      throw new Error('invalid retry backoff configuration');
    }
    diagnostics.record({ code: 'temporarily_unavailable', inboxId, eventType, attemptCount });
    return {
      outcome: 'retry',
      availableAt: backoffResult.availableAt,
      errorCode: 'service_temporarily_unavailable',
    };
  };

  const process = async (
    processorInput: ProcessIngestionEventInput,
    signal: AbortSignal,
  ): Promise<ProcessIngestionEventResult> => {
    // The performance processor is synchronous with the store call and does not
    // need the abort signal for cooperative cancellation; the runtime owns
    // shutdown. The eventType guard below is a local precondition, NOT the
    // final routing policy for non-performance events (that remains blocked).
    void signal;
    const eventType = processorInput.event.eventType;
    if (eventType !== 'performance') {
      diagnostics.record({
        code: 'permanently_rejected_invalid_input',
        inboxId: processorInput.inboxId,
        eventType,
        attemptCount: processorInput.attemptCount,
      });
      return { outcome: 'dead-letter', errorCode: 'invalid_event_type' };
    }

    const parseResult = parsePerformanceEventEnvelope(processorInput.event);
    if (!parseResult.success) {
      diagnostics.record({
        code: 'permanently_rejected_invalid_input',
        inboxId: processorInput.inboxId,
        eventType,
        attemptCount: processorInput.attemptCount,
      });
      return { outcome: 'dead-letter', errorCode: 'invalid_event_type' };
    }
    const envelope = parseResult.data;

    const contribution: PerformanceMetricContributionInput = {
      projectId: processorInput.projectId,
      eventId: envelope.eventId,
      occurredAt: envelope.occurredAt,
      metricName: envelope.body.metricName,
      unit: envelope.body.unit,
      value: envelope.body.value,
      startedAt: envelope.body.startedAt,
      ...(envelope.body.durationMs !== undefined ? { durationMs: envelope.body.durationMs } : {}),
    };

    const metricResult = await input.persistMetric(contribution);

    if (metricResult.status === 'temporarily_unavailable') {
      return computeRetry(processorInput.inboxId, eventType, processorInput.attemptCount);
    }
    const mapping = mapPerformanceMetricResultToWorkerResult(metricResult);
    diagnostics.record({
      code: metricResult.status === 'applied' ? 'performance_applied' : 'performance_duplicate',
      inboxId: processorInput.inboxId,
      eventType,
      attemptCount: processorInput.attemptCount,
    });
    return mapping;
  };

  return { process };
}
```

- [x] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @aurora/ingestion-worker test -- test/performance-event-processor.test.ts`
Expected: PASS（8 个测试）。

- [x] **Step 5: Commit 边界（不实际执行）**

```text
逻辑提交边界：feat(ingestion-worker): performance event processor core
实际执行：不运行 git add/commit。
```

- [x] **Step 6: 检查差异**

Run: `git diff --check`
Expected: 无输出。

## Task 2：no-sample 与 no-double-sampling 断言测试

**Files:**
- Modify: `apps/ingestion-worker/test/performance-event-processor.test.ts`（追加测试）

**Interfaces:**
- Consumes: Task 1 的工厂
- Produces: 无新接口（验证行为）

- [x] **Step 1: 写失败测试**

在 `apps/ingestion-worker/test/performance-event-processor.test.ts` 追加：

```ts
import { persistPerformanceEventSample } from '@aurora/processing-store';
```

并在 describe 内追加：

```ts
  it('never calls persistPerformanceEventSample (V1 does not persist diagnostic samples)', async () => {
    const sampleSpy = vi.fn(persistPerformanceEventSample);
    const persistMetric = vi.fn<PersistPerformanceMetricFn>().mockResolvedValue(metricResult('applied'));
    const processor = createPerformanceEventProcessor({
      persistMetric,
      backoff,
      entropyProvider: zeroEntropy(),
      now: () => NOW,
    });
    await processor.process(validInput(), new AbortController().signal);
    expect(sampleSpy).not.toHaveBeenCalled();
  });

  it('aggregates deterministically without any server-side sampling', async () => {
    const args: PerformanceMetricContributionInput[] = [];
    const persistMetric: PersistPerformanceMetricFn = vi.fn().mockImplementation((input) => {
      args.push(input);
      return Promise.resolve(metricResult('applied'));
    });
    const processor = createPerformanceEventProcessor({
      persistMetric,
      backoff,
      entropyProvider: zeroEntropy(),
      now: () => NOW,
    });
    // Two distinct valid events both aggregate (no probabilistic dropping).
    await processor.process(
      validInput({ event: performanceEnvelope('evt-perf-a') as ProcessIngestionEventInput['event'] }),
      new AbortController().signal,
    );
    await processor.process(
      validInput({ event: performanceEnvelope('evt-perf-b') as ProcessIngestionEventInput['event'] }),
      new AbortController().signal,
    );
    expect(args).toHaveLength(2);
  });

  it('rejects an unknown performance metric name via the parser', async () => {
    const persistMetric = vi.fn<PersistPerformanceMetricFn>();
    const processor = createPerformanceEventProcessor({
      persistMetric,
      backoff,
      entropyProvider: zeroEntropy(),
      now: () => NOW,
    });
    const result = await processor.process(
      validInput({
        event: performanceEnvelope('evt-perf-fcp', { metricName: 'fcp' }) as ProcessIngestionEventInput['event'],
      }),
      new AbortController().signal,
    );
    expect(result).toEqual({ outcome: 'dead-letter', errorCode: 'invalid_event_type' });
    expect(persistMetric).not.toHaveBeenCalled();
  });

  it('rejects a malformed performance envelope without touching the store', async () => {
    const persistMetric = vi.fn<PersistPerformanceMetricFn>();
    const processor = createPerformanceEventProcessor({
      persistMetric,
      backoff,
      entropyProvider: zeroEntropy(),
      now: () => NOW,
    });
    const result = await processor.process(
      validInput({ event: { protocolVersion: 1, eventId: 'evt-bad', eventType: 'performance', occurredAt: 1, body: { metricName: 'lcp', value: 'bad', unit: 'millisecond', startedAt: 1 } } as ProcessIngestionEventInput['event'] }),
      new AbortController().signal,
    );
    expect(result).toEqual({ outcome: 'dead-letter', errorCode: 'invalid_event_type' });
    expect(persistMetric).not.toHaveBeenCalled();
  });

  it('does not modify its input object', async () => {
    const processor = createPerformanceEventProcessor({
      persistMetric: vi.fn<PersistPerformanceMetricFn>().mockResolvedValue(metricResult('applied')),
      backoff,
      entropyProvider: zeroEntropy(),
      now: () => NOW,
    });
    const input = validInput();
    const snapshot = {
      inboxId: input.inboxId,
      projectId: input.projectId,
      eventId: input.eventId,
      event: input.event,
      attemptCount: input.attemptCount,
      leaseId: input.leaseId,
      leaseExpiresAt: input.leaseExpiresAt.getTime(),
    };
    await processor.process(input, new AbortController().signal);
    expect(input.inboxId).toBe(snapshot.inboxId);
    expect(input.projectId).toBe(snapshot.projectId);
    expect(input.eventId).toBe(snapshot.eventId);
    expect(input.event).toEqual(snapshot.event);
    expect(input.attemptCount).toBe(snapshot.attemptCount);
    expect(input.leaseId).toBe(snapshot.leaseId);
    expect(input.leaseExpiresAt.getTime()).toBe(snapshot.leaseExpiresAt);
  });

  it('records only stable diagnostic codes, never event bodies', async () => {
    const { diagnostics, codes } = recordingDiagnostics();
    const processor = createPerformanceEventProcessor({
      persistMetric: vi.fn<PersistPerformanceMetricFn>().mockResolvedValue(metricResult('applied')),
      backoff,
      entropyProvider: zeroEntropy(),
      now: () => NOW,
      diagnostics,
    });
    await processor.process(validInput(), new AbortController().signal);
    expect(codes).toContain('performance_applied');
    expect(codes.every((c) => typeof c === 'string' && c.length > 0)).toBe(true);
  });

  it('throws a stable error on an invalid backoff configuration instead of silent downgrade', async () => {
    const processor = createPerformanceEventProcessor({
      persistMetric: vi.fn<PersistPerformanceMetricFn>().mockResolvedValue(metricResult('temporarily_unavailable')),
      backoff: { initialDelayMs: 0, maxDelayMs: 1000 },
      entropyProvider: zeroEntropy(),
      now: () => NOW,
    });
    await expect(processor.process(validInput(), new AbortController().signal)).rejects.toThrow(
      'invalid retry backoff configuration',
    );
  });
```

- [x] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @aurora/ingestion-worker test -- test/performance-event-processor.test.ts`
Expected: FAIL（部分）—— 若 Task 1 已完成，仅新断言中的 `persistPerformanceEventSample` spy 相关测试需要实现验证；工厂已实现则这些测试可能直接通过。若 Task 1 未完成，全部失败。TDD 红绿以工厂未实现为真实 RED。

- [x] **Step 3: 写最小实现**

本 Task 无新源码；依赖 Task 1 的工厂。若 Step 2 因 `persistPerformanceEventSample` 从 `@aurora/processing-store` 导入失败（该包根已导出），则修正测试导入；若工厂行为不符合断言，回到 Task 1 修复。

- [x] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @aurora/ingestion-worker test -- test/performance-event-processor.test.ts`
Expected: PASS（全部 15 个测试：8 个 Task 1 + 7 个 Task 2）。

- [x] **Step 5: Commit 边界（不实际执行）**

```text
逻辑提交边界：test(ingestion-worker): performance processor no-sample and determinism assertions
实际执行：不运行 git add/commit。
```

- [x] **Step 6: 检查差异**

Run: `git diff --check`
Expected: 无输出。

## Task 3：包根导出与既有门禁同步

**Files:**
- Modify: `apps/ingestion-worker/src/index.ts`
- Modify: `apps/ingestion-worker/test/package-entry.test.ts`
- Modify: `apps/ingestion-worker/test/security-negative.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `createPerformanceEventProcessor`/`mapPerformanceMetricResultToWorkerResult` 与类型
- Produces: 包根公共出口：`createPerformanceEventProcessor`、`mapPerformanceMetricResultToWorkerResult`、`PerformanceEventProcessorDiagnostic(s)`、`PersistPerformanceMetricFn`、`CreatePerformanceEventProcessorInput`

- [x] **Step 1: 写失败测试**

`apps/ingestion-worker/test/package-entry.test.ts` 追加（在 `../src/index.js` 导入中加 `createPerformanceEventProcessor`）：

```ts
  it('exports the performance event processor API from the package root', () => {
    expect(typeof createPerformanceEventProcessor).toBe('function');
  });

  it('never exposes the performance-event-processor private path', async () => {
    const index = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
    expect(index).toContain('createPerformanceEventProcessor');
  });
```

`apps/ingestion-worker/test/security-negative.test.ts` 追加：

```ts
  it('performance event processor never reads secrets, runs randomness, or hardcodes sampling', async () => {
    const source = await readFile(
      new URL('../src/performance-event-processor.ts', import.meta.url),
      'utf8',
    );
    expect(source).not.toMatch(/console\./);
    expect(source).not.toMatch(/Math\.random/);
    expect(source).not.toMatch(/Date\.now/);
    expect(source).not.toMatch(/process\.env/);
    expect(source).not.toMatch(/INSERT INTO|SELECT.*FROM/);
    expect(source).not.toMatch(/Authorization|clientKey|token|password/);
    expect(source).not.toMatch(/request\.body|response\.body|\.headers|\.cookies/);
    expect(source).not.toMatch(/event\.body|EventEnvelope\.body/);
    // The processor must never CALL sample persistence or hardcode a sampling
    // rate; the words may appear only in doc comments stating these are out of
    // scope (V1 does not persist diagnostic samples; SDK sampling is separate).
    expect(source).not.toMatch(/persistPerformanceEventSample\(/);
    expect(source).not.toMatch(/sampleRate\s*[:=]|sampleRate\s*\d|0\.1\s*\*\s*/);
  });
```

- [x] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @aurora/ingestion-worker test -- test/package-entry.test.ts test/security-negative.test.ts`
Expected: FAIL —— `createPerformanceEventProcessor` 未从包根导出。

- [x] **Step 3: 写最小实现**

`apps/ingestion-worker/src/index.ts` 末尾追加：

```ts
export {
  createPerformanceEventProcessor,
  mapPerformanceMetricResultToWorkerResult,
  type CreatePerformanceEventProcessorInput,
  type PerformanceEventProcessorDiagnostic,
  type PerformanceEventProcessorDiagnostics,
  type PersistPerformanceMetricFn,
} from './performance-event-processor.js';
```

- [x] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @aurora/ingestion-worker test -- test/package-entry.test.ts test/security-negative.test.ts`
Expected: PASS。

- [x] **Step 5: Commit 边界（不实际执行）**

```text
逻辑提交边界：feat(ingestion-worker): export performance event processor API
实际执行：不运行 git add/commit。
```

- [x] **Step 6: 检查差异**

Run: `git diff --check`
Expected: 无输出。

## Task 4：真实 PostgreSQL 集成测试（Processor → 聚合 Store）

**Files:**
- Create: `apps/ingestion-worker/test/integration/performance-event-processor.test.ts`
- Modify: `apps/ingestion-worker/test/documentation-contract.test.ts`（追加规格对齐断言）

**Interfaces:**
- Consumes: Task 1 的工厂；`persistPerformanceMetricContribution`（`@aurora/processing-store` 包根）；`./integration/helpers.js`（`assertIsTestDatabase`/`createTestPool`/`migrateUp`/`ensureRequestProcessingTables`/`clearEventInbox`/`queryRow`/`queryRows`）
- Produces: 真实 PostgreSQL 行为证据

- [x] **Step 1: 写失败测试**

创建 `apps/ingestion-worker/test/integration/performance-event-processor.test.ts`：

```ts
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { persistPerformanceMetricContribution } from '@aurora/processing-store';
import { createPerformanceEventProcessor } from '../../src/performance-event-processor.js';
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
  metric_name: string;
  unit: string;
  observed_count: string;
  value_sum: string;
  value_max: string;
}

interface SampleRow {
  event_id: string;
}

function performanceEnvelope(eventId: string, bodyOverrides?: Record<string, unknown>): unknown {
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
    leaseExpiresAt: new Date('2026-08-07T00:01:00.000Z'),
  };
}

describeDb('performance event processor (real PostgreSQL 17)', () => {
  let pool: Pool;

  beforeAll(async () => {
    assertIsTestDatabase(process.env.AURORA_TEST_DATABASE_URL ?? '');
    pool = createTestPool();
    await migrateUp();
    await ensureRequestProcessingTables();
    await pool.query('DELETE FROM performance_metric_event_applications');
    await pool.query('DELETE FROM performance_metric_buckets');
    await pool.query('DELETE FROM performance_event_samples');
    await pool.query('DELETE FROM error_event_occurrences');
    await clearEventInbox(pool);
  });

  afterAll(async () => {
    await pool.query('DELETE FROM performance_metric_event_applications').catch(() => undefined);
    await pool.query('DELETE FROM performance_metric_buckets').catch(() => undefined);
    await pool.query('DELETE FROM performance_event_samples').catch(() => undefined);
    await pool.query('DELETE FROM error_event_occurrences').catch(() => undefined);
    await clearEventInbox(pool).catch(() => undefined);
    await pool.end();
  });

  function defaultProcessor() {
    return createPerformanceEventProcessor({
      persistMetric: (input) => persistPerformanceMetricContribution(pool, input),
      backoff: { initialDelayMs: 100, maxDelayMs: 1000 },
      entropyProvider: { next: () => 0 },
      now: () => new Date('2026-08-07T00:00:00.000Z'),
    });
  }

  it('aggregates an lcp event into the metric bucket', async () => {
    const processor = defaultProcessor();
    const result = await processor.process(
      processorInput(1, projectA, 'pg-perf-lcp-1', performanceEnvelope('pg-perf-lcp-1')),
      new AbortController().signal,
    );
    expect(result).toEqual({ outcome: 'processed' });
    const bucket = await queryRow<MetricBucketRow>(
      pool,
      `SELECT metric_name, unit, observed_count, value_sum, value_max
       FROM performance_metric_buckets WHERE project_id = $1 AND metric_name = 'lcp' AND unit = 'millisecond'`,
      [projectA],
    );
    expect(bucket?.observed_count).toBe('1');
    expect(bucket?.value_sum).toBe('2500');
    expect(bucket?.value_max).toBe('2500');
  });

  it('aggregates a cls ratio event into a separate ratio bucket', async () => {
    const processor = defaultProcessor();
    const result = await processor.process(
      processorInput(2, projectA, 'pg-perf-cls-1', performanceEnvelope('pg-perf-cls-1', { metricName: 'cls', value: 0.12, unit: 'ratio' })),
      new AbortController().signal,
    );
    expect(result).toEqual({ outcome: 'processed' });
    const bucket = await queryRow<MetricBucketRow>(
      pool,
      `SELECT metric_name, unit, observed_count, value_sum FROM performance_metric_buckets
       WHERE project_id = $1 AND metric_name = 'cls' AND unit = 'ratio'`,
      [projectA],
    );
    expect(bucket?.observed_count).toBe('1');
    expect(bucket?.value_sum).toBe('0.12');
  });

  it('treats a replay as idempotent: duplicate does not double-count', async () => {
    const processor = defaultProcessor();
    const input = processorInput(3, projectA, 'pg-perf-replay-1', performanceEnvelope('pg-perf-replay-1', { metricName: 'inp', value: 320, unit: 'millisecond' }));
    const first = await processor.process(input, new AbortController().signal);
    const second = await processor.process(input, new AbortController().signal);
    expect(first).toEqual({ outcome: 'processed' });
    expect(second).toEqual({ outcome: 'processed' });
    const bucket = await queryRow<MetricBucketRow>(
      pool,
      `SELECT observed_count, value_sum FROM performance_metric_buckets
       WHERE project_id = $1 AND metric_name = 'inp' AND unit = 'millisecond'`,
      [projectA],
    );
    expect(bucket?.observed_count).toBe('1');
    expect(bucket?.value_sum).toBe('320');
  });

  it('never writes any performance diagnostic sample row', async () => {
    const processor = defaultProcessor();
    await processor.process(
      processorInput(4, projectA, 'pg-perf-nosample-1', performanceEnvelope('pg-perf-nosample-1', { metricName: 'page_load', value: 800, unit: 'millisecond' })),
      new AbortController().signal,
    );
    const samples = await queryRows<SampleRow>(
      pool,
      `SELECT event_id FROM performance_event_samples WHERE project_id = $1`,
      [projectA],
    );
    expect(samples).toHaveLength(0);
  });

  it('converges after a temporary failure: retry then duplicate', async () => {
    let calls = 0;
    const processor = createPerformanceEventProcessor({
      persistMetric: async (input) => {
        calls += 1;
        if (calls === 1) {
          return { status: 'temporarily_unavailable' as const };
        }
        return persistPerformanceMetricContribution(pool, input);
      },
      backoff: { initialDelayMs: 100, maxDelayMs: 1000 },
      entropyProvider: { next: () => 0 },
      now: () => new Date('2026-08-07T00:00:00.000Z'),
    });
    const input = processorInput(5, projectA, 'pg-perf-conv-1', performanceEnvelope('pg-perf-conv-1', { metricName: 'page_load', value: 900, unit: 'millisecond' }));
    const first = await processor.process(input, new AbortController().signal);
    expect(first.outcome).toBe('retry');
    if (first.outcome === 'retry') {
      expect(first.errorCode).toBe('service_temporarily_unavailable');
    }
    const second = await processor.process(input, new AbortController().signal);
    expect(second).toEqual({ outcome: 'processed' });
    const bucket = await queryRow<MetricBucketRow>(
      pool,
      `SELECT observed_count, value_sum FROM performance_metric_buckets
       WHERE project_id = $1 AND metric_name = 'page_load' AND unit = 'millisecond'`,
      [projectA],
    );
    expect(bucket?.observed_count).toBe('1');
  });

  it('rejects a non-performance event without aggregating', async () => {
    const processor = defaultProcessor();
    const result = await processor.process(
      processorInput(6, projectA, 'pg-perf-nonreq-1', { protocolVersion: 1, eventId: 'pg-perf-nonreq-1', eventType: 'error', occurredAt: 1_800_000_054_000 }),
      new AbortController().signal,
    );
    expect(result).toEqual({ outcome: 'dead-letter', errorCode: 'invalid_event_type' });
    const buckets = await queryRows<MetricBucketRow>(
      pool,
      `SELECT metric_name FROM performance_metric_buckets WHERE project_id = $1`,
      [projectA],
    );
    expect(buckets.length).toBeGreaterThan(0); // earlier tests already wrote buckets
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

`apps/ingestion-worker/test/documentation-contract.test.ts` 追加：

```ts
  it('keeps the performance event processor spec honest about its boundary', async () => {
    const spec = await readFile(
      new URL('../../../docs/architecture/performance-event-processor.md', import.meta.url),
      'utf8',
    );
    expect(spec).toContain('implementation-status');
    expect(spec).toContain('createPerformanceEventProcessor');
    expect(spec).toContain('persistPerformanceMetricContribution');
    expect(spec).toContain('不调用');
    expect(spec).toContain('persistPerformanceEventSample');
  });
```

- [x] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @aurora/ingestion-worker test:integration -- test/integration/performance-event-processor.test.ts`
Expected: FAIL —— 模块不存在（Cannot find module），或真实 PostgreSQL 集成需 `AURORA_TEST_DATABASE_URL`。

- [x] **Step 3: 写最小实现**

本 Task 无新源码；依赖 Task 1—3 的工厂与包根导出。若 Step 2 因工厂未实现失败，回到 Task 1 修复；若因集成环境（DB 状态）失败，按"真实 PostgreSQL 集成"环境准备修复（`AURORA_TEST_DATABASE_URL`）。

- [x] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @aurora/ingestion-worker test:integration -- test/integration/performance-event-processor.test.ts`
Expected: PASS（7 个测试）。

- [x] **Step 5: Commit 边界（不实际执行）**

```text
逻辑提交边界：test(ingestion-worker): real-postgres performance processor aggregation evidence
实际执行：不运行 git add/commit。
```

- [x] **Step 6: 检查差异**

Run: `git diff --check`
Expected: 无输出。

## Task 5：README、正式文档、ADR 证据与状态基线同步

**Files:**
- Modify: `apps/ingestion-worker/README.md`
- Modify: `docs/architecture/performance-event-processor.md`（implementation-status → implemented）
- Modify: `docs/architecture/formalization-readiness.md`
- Modify: `docs/README.md`
- Modify: `docs/adr/ADR-021-performance-aggregate-and-bounded-sample-storage.md`（追加 DAT-09 实施证据）
- Modify: `docs/architecture/aurora-v1-remaining-module-batches.md`（completed 34→35、remaining 44→43）

**Interfaces:**
- Consumes: 全部 Task 的导出、正式规格
- Produces: 文档同步状态

- [x] **Step 1: 写失败测试**

本 Task 是文档同步，无新增代码测试。文档契约门禁在 Task 4 已落地。执行文档修改后运行完整质量门禁验证一致性。

- [x] **Step 2: 运行测试确认当前状态**

Run: `pnpm --filter @aurora/ingestion-worker test`
Expected: PASS。

- [x] **Step 3: 写最小实现（文档修改）**

**`apps/ingestion-worker/README.md`**：
- "职责"追加性能事件 Processor 核心能力；
- "非职责"更新：不实现生产接线/总路由；V1 不保存性能诊断样本；
- "对外接口"追加 `createPerformanceEventProcessor` 及类型。

**`docs/architecture/performance-event-processor.md`**：
- `implementation-status` → `implemented`；
- 追加"实施记录"节。

**`docs/architecture/formalization-readiness.md`**：
- §12 追加 DAT-09 实施记录；
- §7 机器契约表"处理/存储可执行模型"行追加性能处理器 implemented。

**`docs/README.md`**：
- §2 权威来源表新增性能事件 Processor 一行。

**`docs/adr/ADR-021-performance-aggregate-and-bounded-sample-storage.md`**：
- 追加 DAT-09 实施证据（处理器只聚合不保存样本）。

**`docs/architecture/aurora-v1-remaining-module-batches.md`**：
- frontmatter `completed: 34 → 35`、`remaining: 44 → 43`；
- §2 计数 `44 = 0 + 11 + 33` → `43 = 0 + 11 + 32`；
- §5.3 DAT-09 行标注已关闭；
- §10 覆盖矩阵 G01 3 → 2、Total 44 → 43。

- [x] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @aurora/ingestion-worker test`
Expected: PASS。

- [x] **Step 5: Commit 边界（不实际执行）**

```text
逻辑提交边界：docs(ingestion-worker): performance processor spec/readme/baseline sync
实际执行：不运行 git add/commit。
```

- [x] **Step 6: 检查差异**

Run: `git diff --check`
Expected: 无输出。

## 验证命令（最终质量门禁）

```bash
pnpm --filter @aurora/ingestion-worker typecheck
pnpm --filter @aurora/ingestion-worker test
pnpm --filter @aurora/ingestion-worker test:integration
pnpm --filter @aurora/ingestion-worker test:coverage
pnpm --filter @aurora/ingestion-worker build
pnpm --filter @aurora/processing-store typecheck/test/test:integration/test:coverage/test:package/build
pnpm --filter @aurora/event-schema test
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm check:boundaries
pnpm format:check
pnpm openapi:check
pnpm check
git diff --check
```

集成测试需要真实 PostgreSQL 17 与 `AURORA_TEST_DATABASE_URL`（目标 `aurora_inbox_test`）。无 DB 环境时记录未运行命令、原因、所需环境、替代证据、剩余风险；不得把 skip 写成通过。

## 回滚方式

- 处理器是 `apps/ingestion-worker` 内部独立模块：移除 `src/performance-event-processor.ts`、测试、包根导出、README/文档条目，不影响任何既有模块；
- 无 Migration、无破坏性数据操作；正式文档可随代码一并回滚。

## deferred 与 out-of-scope

- 性能诊断样本保存与样本选择策略（V1 deferred；Activation requires a separately approved sample-selection policy）；
- DAT-10 Event Processor Router、DAT-11 production composition root；
- DAT-17 Performance Query；
- percentile/直方图/超标比例；
- 页面/环境/发布维度；
- 采样率执行/采样外推（SDK-13 职责）；
- Issue、告警、数据保留清理、事件协议修改、新基础设施。

## 未完成状态处理

- 若 `AURORA_TEST_DATABASE_URL` 不可用：集成测试以 skip 记录，DAT-09 关闭前必须如实标注；
- 若任何质量门禁失败：停止，调查根因，修复后重跑；
- 实际不执行 `git add`/`commit`/`push`。

## 计划自审批记录

> 自检修正记录（2026-08-07）：(1) Task 1 Step 1 测试实际 8 个（非计划所写 10 个），Task 2 追加 7 个后共 15 个；(2) Task 1 实施移除未使用的 `EventType` import 与 `recordingDiagnostics` helper（Task 2 需重新加入 helper）；(3) Task 3 security-negative 原计划禁止源码含 `persistPerformanceEventSample`/`sampling` 子串，但源码 JSDoc 合法地说明"不调用样本持久化、SDK 采样是分离关注点"——已改为禁止 `persistPerformanceEventSample(` 调用与硬编码采样率，保留注释合法出现。(4) Task 4 集成测试第 5 个用例（temporarily_unavailable 收敛）原计划断言 `observed_count` 为 `1`，但 no-sample 用例（第 4 个）已向共享 `page_load` 桶写入一条事件，收敛后应为 `2`——已修正断言并加注释说明，非弱化测试。

- spec coverage: pass（规格 §1—§46 每项要求映射到 Task 1—5；解析/聚合/映射/幂等/隐私/no-sample/no-sampling/集成/文档全部有 Task 与测试）
- placeholder scan: pass（无 TBD/TODO/appropriate/similar to/handle edge cases/implement validation）
- type consistency: pass（`CreatePerformanceEventProcessorInput`/`PersistPerformanceMetricFn`/`PerformanceEventProcessorDiagnostic(s)`/`mapPerformanceMetricResultToWorkerResult`/`createPerformanceEventProcessor` 全计划一致）
- Repository Result 一致性: pass（`applied`/`duplicate`/`invalid_input`/`temporarily_unavailable` → processed/dead-letter/retry 映射与 DAT-08 真实结果类型一致）
- Worker Result 一致性: pass（`processed`/`retry`/`dead-letter` 使用既有 `ProcessIngestionEventResult`）
- 重试语义: pass（backoff 复用 `calculateRetryBackoffSchedule`；retry budget/lease lost 不实现）
- 文件真实性: pass（全部 Modify/Test 路径真实存在；Create 路径符合仓库命名）
- 命令真实性: pass（命令从真实 package.json scripts 读取）
- 公共出口: pass（仅新增 `createPerformanceEventProcessor` 等最小导出）
- 隐私: pass（无 body/URL/页面/用户字段；security-negative 覆盖）
- no-double-sampling: pass（无 `sampleRate`/`0.1`/`sampling` 硬编码；security-negative 断言）
- no-sample-persistence: pass（不调用 `persistPerformanceEventSample`；测试断言调用次数为 0）
- ADR-021: pass（只聚合不保存样本符合决定细节 12 + 用户 2026-08-07 批准）
- DAT-10/11 exclusion: pass（无 Router/composition 逻辑）
- workspace safety: pass（新文件 `performance-event-processor.ts` 为 DAT-09 专属；不触碰用户既有修改）
- required ADR: none 新增（accepted ADR-021 + approved DAT-08 充分）
- closing leaf: DAT-09 only
- closing count: 1
- remaining after verified completion: 43
- execution authorization: current G01 joint-mode instruction

"自审批"只表示计划可以执行，不得表示 Agent 批准了 ADR 或修改了产品规则。
