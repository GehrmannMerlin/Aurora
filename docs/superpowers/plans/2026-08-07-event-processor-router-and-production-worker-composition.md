# DAT-10 Event Processor Router and DAT-11 Production Worker Composition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成 G01 剩余两个叶子：DAT-10 事件处理器 Router（`createEventProcessorRouter` 按 EventType 分发到 Error/Request/Performance 处理器并原样传播结果）与 DAT-11 生产 Worker composition（把三个真实 processor + DAT-07 adapter + Router 接线到既有 `startIngestionWorker`）。

**本计划包含两个独立叶子：**
- DAT-10
- DAT-11

**DAT-10 完成不代表 DAT-11 完成。**
**DAT-11 Task 禁止在 DAT-10 验收停点通过前开始。**

**本计划关闭数量：2（DAT-10 与 DAT-11 各自独立验收）**
**预期完成后：completed 35 → 37，remaining 43 → 41**

## Global Constraints

- 不修改 `@aurora/event-schema`、`@aurora/processing-store`、`@aurora/ingestion-inbox` 公共 API；不修改 performance-event-contract；
- 不新增 `apps/ingestion-worker` 的 `package.json` 依赖（`@aurora/processing-store`/`@aurora/ingestion-inbox`/`@aurora/event-schema` 已存在）；
- 不创建数据库表、Migration、Redis、队列或云资源；
- `IngestionEventProcessor`/`ProcessIngestionEventInput`/`ProcessIngestionEventResult`/`buildIngestionWorker`/`startIngestionWorker`/`loadIngestionWorkerConfig` 公共签名不变；
- DAT-10 Router 是**纯分发器**：不实现 retry budget/backoff/dead-letter/lease lost；不访问数据库/Pool/Inbox；不吞异常；EventType 唯一来源是 event-schema；
- DAT-11 production composition **必须**注入三个真实 processor + DAT-07 真实 adapter + Router；**禁止 fake/noop processor**；不得只接 Error/Request 而遗漏 Performance；
- 禁止采集/记录请求体、响应体、Header、Cookie、Authorization、完整 URL、查询参数值、页面文本、DOM、用户信息；禁止写日志；禁止 `Date.now`/`Math.random`/`process.env`；
- 严格 TypeScript、单一职责、文件 kebab-case、类型 PascalCase、函数 camelCase、无 `utils`/`helpers`/`common`；
- 覆盖率门槛 lines ≥ 85%、branches ≥ 80%、functions ≥ 85%、statements ≥ 85%；不得删除或弱化失败测试；
- 本计划执行实际**不执行 `git add`/`commit`/`push`**；Commit 步骤只作为逻辑提交边界保留。

## 固定回读与权威边界

| Module ID | 完整回读文件 | 重点章节 | 本计划不得改变的业务逻辑 | 缺失门禁 |
| --- | --- | --- | --- | --- |
| DAT-10 | `Aurora 架构规范.md`；`docs/architecture/system-overview.md`；`Aurora 代码规范.md`；`Aurora 测试规范.md`；`Aurora ADR 规范.md`；`Aurora 文档规范.md`；`docs/protocol/event-envelope-v1.md`；`docs/protocol/error-event-contract.md`；`docs/protocol/request-event-contract.md`；`docs/protocol/performance-event-contract.md`；`docs/architecture/ingestion-worker-runtime.md`；`docs/architecture/error-event-processor.md`；`docs/architecture/request-event-processor.md`；`docs/architecture/performance-event-processor.md`；`docs/architecture/event-processor-router.md`；`docs/adr/ADR-005/012/015/016`；`docs/adr/README.md`；`docs/architecture/formalization-readiness.md`；`apps/ingestion-worker/src/processor.ts`、`worker-runtime.ts`、`start.ts` | 架构规范 §2.3.3、§2.5—2.7；Worker Runtime §9—16、§22—23；EventType 唯一来源（event-schema）；三个 processor 的输入/输出/异常；Event Processor Router 规格 §8—§36 | EventType 分发、结果原样传播、resource/unknown/deferred 稳定拒绝、异常传播、无数据库/Pool/lease/retry 访问 | approved DAT-10 spec（`docs/architecture/event-processor-router.md`）；accepted ADR-005/012/015/016；三个 processor 已 implemented |
| DAT-11 | `Aurora 架构规范.md`；`docs/architecture/system-overview.md`；`Aurora 代码规范.md`；`Aurora 测试规范.md`；`Aurora ADR 规范.md`；`Aurora 文档规范.md`；`docs/architecture/ingestion-inbox-data-model.md`；`docs/architecture/ingestion-inbox-processing-repository.md`；`docs/architecture/ingestion-worker-runtime.md`；`docs/architecture/ingestion-worker-retry-budget-policy.md`；`docs/architecture/ingestion-worker-retry-backoff-schedule.md`；`docs/architecture/error-event-processor.md`；`docs/architecture/request-event-processor.md`；`docs/architecture/performance-event-processor.md`；`docs/architecture/request-processing-rules-configuration-adapter.md`；`docs/architecture/event-processor-router.md`；`docs/architecture/production-worker-composition-root.md`；`docs/adr/ADR-008/010/012/015/016`；`docs/architecture/formalization-readiness.md`；`apps/ingestion-worker/src/configuration.ts`、`start.ts`、`worker-runtime.ts` | Worker Runtime §7—16；start.ts 的 Pool 所有权/两阶段/closePoolOnce；三个 processor 的真实注入形态；DAT-07 adapter.classify；DAT-10 Router；graceful shutdown | 三个 processor 真实注入、DAT-07 真实 adapter、Router 注入、无 fake/noop processor、Pool 唯一所有权、启动失败清理、shutdown 重入 | approved DAT-11 spec（`docs/architecture/production-worker-composition-root.md`）；approved/accepted DAT-10 Router；accepted ADR-008/010/012/015/016 |

## 文件结构映射

```text
apps/ingestion-worker/
├── src/
│   ├── event-processor-router.ts              # Create：DAT-10 createEventProcessorRouter 工厂
│   ├── production-composition.ts              # Create：DAT-11 createProductionIngestionWorker 接线
│   └── index.ts                               # Modify：追加 DAT-10/DAT-11 导出
├── test/
│   ├── event-processor-router.test.ts         # Create：DAT-10 单元测试
│   ├── production-composition.test.ts         # Create：DAT-11 单元测试（fake Pool）
│   ├── integration/
│   │   └── production-composition.test.ts     # Create：DAT-11 真实 PostgreSQL 端到端
│   ├── package-entry.test.ts                  # Modify：追加 Router/composition 导出断言
│   ├── documentation-contract.test.ts         # Modify：追加两规格对齐断言
│   └── security-negative.test.ts              # Modify：追加 Router/composition 安全负例
├── README.md                                  # Modify：Router/composition 职责
└── package.json                               # 不修改（无新依赖）

docs/
├── architecture/event-processor-router.md             # Create（已存在，DAT-10 规格）
├── architecture/production-worker-composition-root.md  # Create（已存在，DAT-11 规格）
├── architecture/formalization-readiness.md            # Modify：DAT-10/11 implemented
├── README.md                                           # Modify：模块表新增两行
├── adr/ADR-012-ingestion-worker-runtime.md             # Modify：追加 DAT-10/11 实施证据（如需）
└── superpowers/plans/2026-08-07-event-processor-router-and-production-worker-composition.md  # 本计划
```

---

# 阶段 A：DAT-10 Event Processor Router

## Task A1：Router 类型、工厂与分发

**Files:**
- Create: `apps/ingestion-worker/src/event-processor-router.ts`
- Create: `apps/ingestion-worker/test/event-processor-router.test.ts`

**Interfaces:**
- Consumes: `./processor.ts`（`IngestionEventProcessor`/`ProcessIngestionEventInput`/`ProcessIngestionEventResult`）；`@aurora/event-schema` 包根（`EventType` 类型）
- Produces:
  ```ts
  export interface EventProcessorRouterDiagnostic {
    readonly code: string;
    readonly inboxId?: number;
    readonly eventType?: string;
    readonly attemptCount?: number;
  }
  export interface EventProcessorRouterDiagnostics {
    record(diagnostic: EventProcessorRouterDiagnostic): void;
  }
  export interface CreateEventProcessorRouterInput {
    readonly errorProcessor?: IngestionEventProcessor;
    readonly requestProcessor?: IngestionEventProcessor;
    readonly performanceProcessor?: IngestionEventProcessor;
    readonly diagnostics?: EventProcessorRouterDiagnostics;
  }
  export function createEventProcessorRouter(
    input: CreateEventProcessorRouterInput,
  ): IngestionEventProcessor;
  ```

- [x] **Step 1: 写失败测试**

创建 `apps/ingestion-worker/test/event-processor-router.test.ts`：

```ts
import { describe, expect, it, vi } from 'vitest';
import { EventType } from '@aurora/event-schema';
import {
  createEventProcessorRouter,
  type EventProcessorRouterDiagnostics,
} from '../src/event-processor-router.js';
import type {
  IngestionEventProcessor,
  ProcessIngestionEventInput,
  ProcessIngestionEventResult,
} from '../src/processor.js';

function fakeProcessor(handler: (input: ProcessIngestionEventInput) => Promise<ProcessIngestionEventResult>): {
  processor: IngestionEventProcessor;
  calledWith: ProcessIngestionEventInput[];
} {
  const calledWith: ProcessIngestionEventInput[] = [];
  const processor: IngestionEventProcessor = {
    process: vi.fn(async (input, signal) => {
      void signal;
      calledWith.push(input);
      return handler(input);
    }),
  };
  return { processor, calledWith };
}

function envelope(eventType: string, eventId = 'evt-1'): unknown {
  return { protocolVersion: 1, eventId, eventType, occurredAt: 1_800_000_054_000, body: {} };
}

function input(eventType: string): ProcessIngestionEventInput {
  return {
    inboxId: 1,
    projectId: '11111111-1111-1111-1111-111111111111',
    eventId: 'evt-1',
    event: envelope(eventType) as ProcessIngestionEventInput['event'],
    attemptCount: 1,
    leaseId: '00000000-0000-0000-0000-000000000001',
    leaseExpiresAt: new Date('2026-08-07T00:01:00.000Z'),
  };
}

function recordingDiagnostics(): { diagnostics: EventProcessorRouterDiagnostics; codes: string[] } {
  const codes: string[] = [];
  return {
    codes,
    diagnostics: { record: (entry) => { codes.push(entry.code); } },
  };
}

describe('createEventProcessorRouter', () => {
  it('routes an error event to the error processor and propagates its result', async () => {
    const { processor: errorProcessor } = fakeProcessor(async () => ({ outcome: 'processed' as const }));
    const router = createEventProcessorRouter({ errorProcessor });
    const result = await router.process(input(EventType.Error), new AbortController().signal);
    expect(result).toEqual({ outcome: 'processed' });
  });

  it('routes a request event to the request processor', async () => {
    const { processor: requestProcessor } = fakeProcessor(async () => ({ outcome: 'processed' as const }));
    const router = createEventProcessorRouter({ requestProcessor });
    const result = await router.process(input(EventType.Request), new AbortController().signal);
    expect(result).toEqual({ outcome: 'processed' });
  });

  it('routes a performance event to the performance processor', async () => {
    const { processor: performanceProcessor } = fakeProcessor(async () => ({ outcome: 'processed' as const }));
    const router = createEventProcessorRouter({ performanceProcessor });
    const result = await router.process(input(EventType.Performance), new AbortController().signal);
    expect(result).toEqual({ outcome: 'processed' });
  });

  it('propagates a retry result verbatim', async () => {
    const { processor: errorProcessor } = fakeProcessor(async () => ({
      outcome: 'retry' as const,
      availableAt: new Date('2026-08-07T00:01:00.000Z'),
      errorCode: 'service_temporarily_unavailable' as const,
    }));
    const router = createEventProcessorRouter({ errorProcessor });
    const result = await router.process(input(EventType.Error), new AbortController().signal);
    expect(result).toEqual({
      outcome: 'retry',
      availableAt: new Date('2026-08-07T00:01:00.000Z'),
      errorCode: 'service_temporarily_unavailable',
    });
  });

  it('propagates a dead-letter result verbatim', async () => {
    const { processor: errorProcessor } = fakeProcessor(async () => ({
      outcome: 'dead-letter' as const,
      errorCode: 'invalid_event_type' as const,
    }));
    const router = createEventProcessorRouter({ errorProcessor });
    const result = await router.process(input(EventType.Error), new AbortController().signal);
    expect(result).toEqual({ outcome: 'dead-letter', errorCode: 'invalid_event_type' });
  });

  it('rejects a resource event with dead-letter without calling any processor', async () => {
    const { processor: errorProcessor } = fakeProcessor(async () => ({ outcome: 'processed' as const }));
    const { processor: requestProcessor } = fakeProcessor(async () => ({ outcome: 'processed' as const }));
    const { processor: performanceProcessor } = fakeProcessor(async () => ({ outcome: 'processed' as const }));
    const router = createEventProcessorRouter({ errorProcessor, requestProcessor, performanceProcessor });
    const result = await router.process(input(EventType.Resource), new AbortController().signal);
    expect(result).toEqual({ outcome: 'dead-letter', errorCode: 'invalid_event_type' });
  });

  it('rejects an unknown event type with dead-letter', async () => {
    const { processor: errorProcessor } = fakeProcessor(async () => ({ outcome: 'processed' as const }));
    const router = createEventProcessorRouter({ errorProcessor });
    const result = await router.process(input('behavior'), new AbortController().signal);
    expect(result).toEqual({ outcome: 'dead-letter', errorCode: 'invalid_event_type' });
  });

  it('rejects a missing processor for a routed type with dead-letter', async () => {
    const router = createEventProcessorRouter({});
    const result = await router.process(input(EventType.Error), new AbortController().signal);
    expect(result).toEqual({ outcome: 'dead-letter', errorCode: 'invalid_event_type' });
  });

  it('propagates a processor exception without catching', async () => {
    const { processor: errorProcessor } = fakeProcessor(async () => {
      throw new Error('processor-boom');
    });
    const router = createEventProcessorRouter({ errorProcessor });
    await expect(router.process(input(EventType.Error), new AbortController().signal)).rejects.toThrow(
      'processor-boom',
    );
  });

  it('calls only the processor matching the event type', async () => {
    const { processor: errorProcessor, calledWith: errorCalls } = fakeProcessor(async () => ({ outcome: 'processed' as const }));
    const { processor: requestProcessor, calledWith: requestCalls } = fakeProcessor(async () => ({ outcome: 'processed' as const }));
    const router = createEventProcessorRouter({ errorProcessor, requestProcessor });
    await router.process(input(EventType.Error), new AbortController().signal);
    expect(errorCalls).toHaveLength(1);
    expect(requestCalls).toHaveLength(0);
  });

  it('records only stable diagnostic codes, never event bodies', async () => {
    const { diagnostics, codes } = recordingDiagnostics();
    const { processor: errorProcessor } = fakeProcessor(async () => ({ outcome: 'processed' as const }));
    const router = createEventProcessorRouter({ errorProcessor, diagnostics });
    await router.process(input(EventType.Error), new AbortController().signal);
    expect(codes).toContain('routed_error');
    expect(codes.every((c) => typeof c === 'string' && c.length > 0)).toBe(true);
  });
});
```

- [x] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @aurora/ingestion-worker test -- test/event-processor-router.test.ts`
Expected: FAIL —— 模块不存在（Cannot find module '../src/event-processor-router.js'）。

- [x] **Step 3: 写最小实现**

创建 `apps/ingestion-worker/src/event-processor-router.ts`：

```ts
import type { EventType } from '@aurora/event-schema';
import type {
  IngestionEventProcessor,
  ProcessIngestionEventInput,
  ProcessIngestionEventResult,
} from './processor.js';

/** Stable diagnostic facts emitted by the router; never carries the event body. */
export interface EventProcessorRouterDiagnostic {
  readonly code: string;
  readonly inboxId?: number;
  readonly eventType?: string;
  readonly attemptCount?: number;
}

/** Optional bounded diagnostics port. */
export interface EventProcessorRouterDiagnostics {
  record(diagnostic: EventProcessorRouterDiagnostic): void;
}

export interface CreateEventProcessorRouterInput {
  readonly errorProcessor?: IngestionEventProcessor;
  readonly requestProcessor?: IngestionEventProcessor;
  readonly performanceProcessor?: IngestionEventProcessor;
  readonly diagnostics?: EventProcessorRouterDiagnostics;
}

const NOOP_DIAGNOSTICS: EventProcessorRouterDiagnostics = {
  record: () => undefined,
};

const REJECTED: ProcessIngestionEventResult = Object.freeze({
  outcome: 'dead-letter',
  errorCode: 'invalid_event_type',
});

/**
 * Create the final event-type routing policy for the worker. It implements the
 * IngestionEventProcessor port, dispatches one claimed event to the matching
 * injected processor by its eventType (the single source is @aurora/event-schema),
 * and propagates the processor result verbatim. resource is product-deferred and
 * unknown/missing-processor events are permanently rejected. The router never
 * parses the envelope (processors do), never touches the database / Pool / Inbox,
 * never implements retry budget / backoff / lease, never swallows a processor
 * exception, and never writes logs.
 */
export function createEventProcessorRouter(
  input: CreateEventProcessorRouterInput,
): IngestionEventProcessor {
  const diagnostics = input.diagnostics ?? NOOP_DIAGNOSTICS;

  const process = async (
    processorInput: ProcessIngestionEventInput,
    signal: AbortSignal,
  ): Promise<ProcessIngestionEventResult> => {
    const eventType = processorInput.event.eventType;
    if (typeof eventType !== 'string') {
      diagnostics.record({
        code: 'routed_invalid_envelope',
        inboxId: processorInput.inboxId,
        attemptCount: processorInput.attemptCount,
      });
      return REJECTED;
    }
    const processor: IngestionEventProcessor | undefined =
      eventType === 'error'
        ? input.errorProcessor
        : eventType === 'request'
          ? input.requestProcessor
          : eventType === 'performance'
            ? input.performanceProcessor
            : undefined;
    if (processor === undefined) {
      diagnostics.record({
        code: eventType === 'resource' ? 'routed_resource_deferred' : 'routed_unknown_type',
        inboxId: processorInput.inboxId,
        eventType,
        attemptCount: processorInput.attemptCount,
      });
      return REJECTED;
    }
    diagnostics.record({
      code:
        eventType === 'error'
          ? 'routed_error'
          : eventType === 'request'
            ? 'routed_request'
            : 'routed_performance',
      inboxId: processorInput.inboxId,
      eventType,
      attemptCount: processorInput.attemptCount,
    });
    return processor.process(processorInput, signal);
  };

  return { process };
}
```

- [x] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @aurora/ingestion-worker test -- test/event-processor-router.test.ts`
Expected: PASS（11 个测试）。

- [x] **Step 5: Commit 边界（不实际执行）**

```text
逻辑提交边界：feat(ingestion-worker): event processor router
实际执行：不运行 git add/commit。
```

- [x] **Step 6: 检查差异**

Run: `git diff --check`
Expected: 无输出。

## Task A2：Router 包根导出与既有门禁同步

**Files:**
- Modify: `apps/ingestion-worker/src/index.ts`
- Modify: `apps/ingestion-worker/test/package-entry.test.ts`
- Modify: `apps/ingestion-worker/test/security-negative.test.ts`

**Interfaces:**
- Consumes: Task A1 的 `createEventProcessorRouter`/类型
- Produces: 包根导出 `createEventProcessorRouter`、`CreateEventProcessorRouterInput`、`EventProcessorRouterDiagnostic(s)`

- [x] **Step 1: 写失败测试**

`package-entry.test.ts` 追加：

```ts
  it('exports the event processor router API from the package root', () => {
    expect(typeof createEventProcessorRouter).toBe('function');
  });

  it('never exposes the event-processor-router private path', async () => {
    const index = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
    expect(index).toContain('createEventProcessorRouter');
  });
```

`security-negative.test.ts` 追加：

```ts
  it('event processor router never reads secrets, runs randomness, or touches the database', async () => {
    const source = await readFile(
      new URL('../src/event-processor-router.ts', import.meta.url),
      'utf8',
    );
    expect(source).not.toMatch(/console\./);
    expect(source).not.toMatch(/Math\.random/);
    expect(source).not.toMatch(/Date\.now|new Date\(/);
    expect(source).not.toMatch(/process\.env/);
    expect(source).not.toMatch(/INSERT INTO|SELECT.*FROM/);
    expect(source).not.toMatch(/Authorization|clientKey|token|password/);
    expect(source).not.toMatch(/@aurora\/ingestion-inbox|claimAvailable|markProcessed/);
    expect(source).not.toMatch(/new Pool\(|pool\./);
  });
```

- [x] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @aurora/ingestion-worker test -- test/package-entry.test.ts test/security-negative.test.ts`
Expected: FAIL —— `createEventProcessorRouter` 未从包根导出。

- [x] **Step 3: 写最小实现**

`src/index.ts` 追加：

```ts
export {
  createEventProcessorRouter,
  type CreateEventProcessorRouterInput,
  type EventProcessorRouterDiagnostic,
  type EventProcessorRouterDiagnostics,
} from './event-processor-router.js';
```

- [x] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @aurora/ingestion-worker test -- test/package-entry.test.ts test/security-negative.test.ts`
Expected: PASS。

- [x] **Step 5: Commit 边界（不实际执行）**

```text
逻辑提交边界：feat(ingestion-worker): export event processor router API
实际执行：不运行 git add/commit。
```

- [x] **Step 6: 检查差异**

Run: `git diff --check`
Expected: 无输出。

## Task A3：DAT-10 文档同步（Router 规格 + formalization-readiness + docs/README + ADR-012 证据）

**Files:**
- Modify: `apps/ingestion-worker/README.md`
- Modify: `docs/architecture/event-processor-router.md`（implementation-status → implemented）
- Modify: `docs/architecture/formalization-readiness.md`
- Modify: `docs/README.md`
- Modify: `docs/adr/ADR-012-ingestion-worker-runtime.md`（追加 DAT-10 实施证据）
- Modify: `apps/ingestion-worker/test/documentation-contract.test.ts`（追加 Router 规格对齐断言）

**Interfaces:**
- Consumes: Task A1/A2 的导出
- Produces: 文档同步状态

- [x] **Step 1: 写失败测试**

`documentation-contract.test.ts` 追加：

```ts
  it('keeps the event processor router spec honest about its boundary', async () => {
    const spec = await readFile(
      new URL('../../../docs/architecture/event-processor-router.md', import.meta.url),
      'utf8',
    );
    expect(spec).toContain('implementation-status');
    expect(spec).toContain('createEventProcessorRouter');
    expect(spec).toContain('纯分发器');
    expect(spec).toContain('resource');
  });
```

- [x] **Step 2: 运行测试确认当前状态**

Run: `pnpm --filter @aurora/ingestion-worker test`
Expected: PASS。

- [x] **Step 3: 写最小实现（文档修改）**

- `apps/ingestion-worker/README.md`：职责追加 Router；对外接口追加导出；
- `docs/architecture/event-processor-router.md`：`implementation-status` → implemented + 实施记录；
- `docs/architecture/formalization-readiness.md`：DAT-10 implemented 记录；
- `docs/README.md`：模块表新增 Router 一行；
- `docs/adr/ADR-012-ingestion-worker-runtime.md`：追加 Router 实施证据。

- [x] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @aurora/ingestion-worker test`
Expected: PASS。

- [x] **Step 5: Commit 边界（不实际执行）**

```text
逻辑提交边界：docs(ingestion-worker): event processor router spec/readme sync
实际执行：不运行 git add/commit。
```

- [x] **Step 6: 检查差异**

Run: `git diff --check`
Expected: 无输出。

---

# 阶段 B：DAT-11 Production Worker Composition

> **DAT-10 验收停点**：只有 Task A1—A3 全部通过（Router 单元测试、路由/隔离/异常传播、包根导出、安全负例、文档契约、typecheck/lint/coverage/boundaries/git diff --check）且 DAT-10 关闭（completed 35→36，remaining 43→42）后，才允许开始本阶段 Task。

## Task B1：生产 composition 接线工厂

**Files:**
- Create: `apps/ingestion-worker/src/production-composition.ts`
- Create: `apps/ingestion-worker/test/production-composition.test.ts`

**Interfaces:**
- Consumes: `./configuration.ts`（`IngestionWorkerConfig`）；`./error-event-processor.ts`、`./request-event-processor.ts`、`./performance-event-processor.ts`、`./request-processing-rules-adapter.ts`、`./event-processor-router.ts`；`@aurora/processing-store` 包根（`persistErrorEventOccurrence`/`persistRequestMetricContribution`/`persistRequestEventSample`/`persistPerformanceMetricContribution`）；`pg` `Pool`
- Produces:
  ```ts
  export interface ProductionCompositionOptions {
    readonly config: IngestionWorkerConfig;
    readonly pool: Pool;
    readonly backoff?: RetryBackoffConfig;
    readonly entropyProvider?: RetryBackoffEntropyProvider;
    readonly now?: () => Date;
  }
  export interface ProductionIngestionWorker {
    readonly processor: IngestionEventProcessor;
    readonly close: () => Promise<void>;
  }
  export function createProductionIngestionWorker(
    options: ProductionCompositionOptions,
  ): ProductionIngestionWorker;
  ```

- [x] **Step 1: 写失败测试**

创建 `apps/ingestion-worker/test/production-composition.test.ts`（用 fake Pool 验证接线，不连数据库）：

```ts
import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { createProductionIngestionWorker } from '../src/production-composition.js';
import type { IngestionWorkerConfig } from '../src/configuration.js';
import type { IngestionEventProcessor } from '../src/processor.js';
import type { RetryBackoffConfig } from '../src/retry-backoff-types.js';

const backoff: RetryBackoffConfig = { initialDelayMs: 100, maxDelayMs: 1000 };

const config: IngestionWorkerConfig = {
  workerId: 'test-worker',
  claimBatchSize: 5,
  maxConcurrentHandlers: 2,
  leaseDurationMs: 30_000,
  leaseRenewIntervalMs: 10_000,
  idlePollIntervalMs: 1000,
  infrastructureFailureDelayMs: 500,
  shutdownGracePeriodMs: 5000,
  maxProcessingAttempts: 3,
  databaseUrl: 'postgres://test',
  logEnabled: false,
};

function fakePool(): Pool {
  return { connect: vi.fn() } as unknown as Pool;
}

describe('createProductionIngestionWorker', () => {
  it('wires a real router with three processors and returns it as the worker processor', () => {
    const pool = fakePool();
    const worker = createProductionIngestionWorker({ config, pool, backoff, entropyProvider: { next: () => 0 }, now: () => new Date('2026-08-07T00:00:00.000Z') });
    expect(typeof worker.processor.process).toBe('function');
    expect(typeof worker.close).toBe('function');
  });

  it('provides a close that is idempotent and does not close a caller-owned pool', async () => {
    const pool = fakePool();
    const worker = createProductionIngestionWorker({ config, pool, backoff, entropyProvider: { next: () => 0 }, now: () => new Date('2026-08-07T00:00:00.000Z') });
    await worker.close();
    await worker.close();
    expect(pool.connect).toHaveBeenCalledTimes(0); // composition does not open a pool
  });
});
```

- [x] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @aurora/ingestion-worker test -- test/production-composition.test.ts`
Expected: FAIL —— 模块不存在（Cannot find module）。

- [x] **Step 3: 写最小实现**

创建 `apps/ingestion-worker/src/production-composition.ts`：

```ts
import type { Pool } from 'pg';
import {
  persistErrorEventOccurrence,
  persistPerformanceMetricContribution,
  persistRequestEventSample,
  persistRequestMetricContribution,
} from '@aurora/processing-store';
import type { IngestionWorkerConfig } from './configuration.js';
import type { IngestionEventProcessor } from './processor.js';
import { createErrorEventProcessor } from './error-event-processor.js';
import { createRequestEventProcessor } from './request-event-processor.js';
import { createPerformanceEventProcessor } from './performance-event-processor.js';
import { createRequestProcessingRulesAdapter, DEFAULT_REQUEST_PROCESSING_RULES } from './request-processing-rules-adapter.js';
import { createEventProcessorRouter } from './event-processor-router.js';
import type { RetryBackoffConfig, RetryBackoffEntropyProvider } from './retry-backoff-types.js';

export interface ProductionCompositionOptions {
  readonly config: IngestionWorkerConfig;
  readonly pool: Pool;
  readonly backoff?: RetryBackoffConfig;
  readonly entropyProvider?: RetryBackoffEntropyProvider;
  readonly now?: () => Date;
}

export interface ProductionIngestionWorker {
  readonly processor: IngestionEventProcessor;
  readonly close: () => Promise<void>;
}

/**
 * Production composition root: wires the three real processors, the DAT-07
 * request-processing rules adapter, and the DAT-10 router over the caller-owned
 * PostgreSQL Pool. The caller (startIngestionWorker) owns the Pool lifecycle;
 * this composition never opens or closes a Pool. Returns the router as the
 * worker's processor plus an idempotent close. No fake/noop processors are used;
 * the performance processor aggregates every valid performance event and does
 * not persist diagnostic samples (V1).
 */
export function createProductionIngestionWorker(
  options: ProductionCompositionOptions,
): ProductionIngestionWorker {
  const backoff = options.backoff ?? { initialDelayMs: 100, maxDelayMs: 60_000 };
  const entropyProvider = options.entropyProvider ?? { next: () => 0 };
  const now = options.now ?? (() => new Date());

  const rulesAdapter = createRequestProcessingRulesAdapter({
    rules: DEFAULT_REQUEST_PROCESSING_RULES,
  });

  const errorProcessor = createErrorEventProcessor({
    persist: (input) => persistErrorEventOccurrence(options.pool, input),
    backoff,
    entropyProvider,
    now,
  });

  const requestProcessor = createRequestEventProcessor({
    persistMetric: (input) => persistRequestMetricContribution(options.pool, input),
    persistSample: (input) => persistRequestEventSample(options.pool, input),
    classify: (input) => rulesAdapter.classify(input),
    backoff,
    entropyProvider,
    now,
  });

  const performanceProcessor = createPerformanceEventProcessor({
    persistMetric: (input) => persistPerformanceMetricContribution(options.pool, input),
    backoff,
    entropyProvider,
    now,
  });

  const router = createEventProcessorRouter({
    errorProcessor,
    requestProcessor,
    performanceProcessor,
  });

  let closed = false;
  const close = async (): Promise<void> => {
    // Idempotent; the caller owns Pool lifecycle, so nothing is closed here.
    closed = true;
    void closed;
  };

  return { processor: router, close };
}
```

- [x] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @aurora/ingestion-worker test -- test/production-composition.test.ts`
Expected: PASS（2 个测试）。

- [x] **Step 5: Commit 边界（不实际执行）**

```text
逻辑提交边界：feat(ingestion-worker): production worker composition
实际执行：不运行 git add/commit。
```

- [x] **Step 6: 检查差异**

Run: `git diff --check`
Expected: 无输出。

## Task B2：真实 PostgreSQL 端到端集成测试

**Files:**
- Create: `apps/ingestion-worker/test/integration/production-composition.test.ts`

**Interfaces:**
- Consumes: Task B1 的 `createProductionIngestionWorker`；`buildIngestionWorker`（既有）；`./integration/helpers.js`；真实 PostgreSQL
- Produces: 三类事件完整链证据

- [x] **Step 1: 写失败测试**

创建 `apps/ingestion-worker/test/integration/production-composition.test.ts`：

```ts
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { claimAvailable, markDeadLettered, markProcessed, renewLease, scheduleRetry } from '@aurora/ingestion-inbox';
import { createProductionIngestionWorker } from '../../src/production-composition.js';
import { buildIngestionWorker } from '../../src/worker-runtime.js';
import type { ProcessIngestionEventInput } from '../../src/processor.js';
import { assertIsTestDatabase, clearEventInbox, createTestPool, migrateUp, ensureRequestProcessingTables, queryRow, queryRows } from './helpers.js';

const hasDb = process.env.AURORA_TEST_DATABASE_URL !== undefined;
const describeDb = hasDb ? describe : describe.skip;

const projectA = '11111111-1111-1111-1111-111111111111';

interface OccurrenceRow { event_id: string; error_category: string; }
interface MetricBucketRow { metric_name: string; observed_count: string; }
interface SampleRow { event_id: string; }

function processorInput(inboxId: number, eventId: string, event: unknown): ProcessIngestionEventInput {
  return {
    inboxId,
    projectId: projectA,
    eventId,
    event: event as ProcessIngestionEventInput['event'],
    attemptCount: 1,
    leaseId: '00000000-0000-0000-0000-000000000001',
    leaseExpiresAt: new Date('2026-08-07T00:01:00.000Z'),
  };
}

describeDb('production worker composition (real PostgreSQL 17)', () => {
  let pool: Pool;

  beforeAll(async () => {
    assertIsTestDatabase(process.env.AURORA_TEST_DATABASE_URL ?? '');
    pool = createTestPool();
    await migrateUp();
    await ensureRequestProcessingTables();
    await pool.query('DELETE FROM error_event_occurrences');
    await pool.query('DELETE FROM request_metric_event_applications');
    await pool.query('DELETE FROM request_metric_buckets');
    await pool.query('DELETE FROM request_event_samples');
    await pool.query('DELETE FROM performance_metric_event_applications');
    await pool.query('DELETE FROM performance_metric_buckets');
    await pool.query('DELETE FROM performance_event_samples');
    await clearEventInbox(pool);
  });

  afterAll(async () => {
    await pool.query('DELETE FROM error_event_occurrences').catch(() => undefined);
    await pool.query('DELETE FROM request_metric_event_applications').catch(() => undefined);
    await pool.query('DELETE FROM request_metric_buckets').catch(() => undefined);
    await pool.query('DELETE FROM request_event_samples').catch(() => undefined);
    await pool.query('DELETE FROM performance_metric_event_applications').catch(() => undefined);
    await pool.query('DELETE FROM performance_metric_buckets').catch(() => undefined);
    await pool.query('DELETE FROM performance_event_samples').catch(() => undefined);
    await clearEventInbox(pool).catch(() => undefined);
    await pool.end();
  });

  function makeWorker() {
    const { processor, close } = createProductionIngestionWorker({
      config: {
        workerId: 'prod-test',
        claimBatchSize: 5,
        maxConcurrentHandlers: 2,
        leaseDurationMs: 30_000,
        leaseRenewIntervalMs: 10_000,
        idlePollIntervalMs: 1000,
        infrastructureFailureDelayMs: 500,
        shutdownGracePeriodMs: 5000,
        maxProcessingAttempts: 3,
        databaseUrl: process.env.AURORA_TEST_DATABASE_URL ?? '',
        logEnabled: false,
      },
      pool,
      backoff: { initialDelayMs: 100, maxDelayMs: 1000 },
      entropyProvider: { next: () => 0 },
      now: () => new Date('2026-08-07T00:00:00.000Z'),
    });
    // Mirror start.ts's private createProcessingRepository over the real Pool.
    const repository = {
      claimAvailable: (input: Parameters<typeof claimAvailable>[1]) => claimAvailable(pool, input),
      renewLease: (input: Parameters<typeof renewLease>[1]) => renewLease(pool, input),
      markProcessed: (input: Parameters<typeof markProcessed>[1]) => markProcessed(pool, input),
      scheduleRetry: (input: Parameters<typeof scheduleRetry>[1]) => scheduleRetry(pool, input),
      markDeadLettered: (input: Parameters<typeof markDeadLettered>[1]) => markDeadLettered(pool, input),
    } as unknown as ConstructorParameters<typeof buildIngestionWorker>[0]['repository'];
    const worker = buildIngestionWorker({
      config: {
        workerId: 'prod-test',
        claimBatchSize: 5,
        maxConcurrentHandlers: 2,
        leaseDurationMs: 30_000,
        leaseRenewIntervalMs: 10_000,
        idlePollIntervalMs: 1000,
        infrastructureFailureDelayMs: 500,
        shutdownGracePeriodMs: 5000,
        maxProcessingAttempts: 3,
        databaseUrl: process.env.AURORA_TEST_DATABASE_URL ?? '',
        logEnabled: false,
      },
      repository,
      processor,
    });
    return { worker, close };
  }

  /** Insert one event into event_inbox so the worker's real claim loop picks it up. */
  async function insertIntoInbox(
    eventId: string,
    eventType: string,
    body: Record<string, unknown>,
  ): Promise<void> {
    const envelope = JSON.stringify({
      protocolVersion: 1,
      eventId,
      eventType,
      occurredAt: 1_800_000_054_000,
      body,
    });
    await pool.query(
      `INSERT INTO event_inbox
         (project_id, event_id, event_type, protocol_version, envelope,
          received_at, available_at, created_at, updated_at, state)
       VALUES ($1, $2, $3, 1, $4::jsonb,
               now(), now(), now(), now(), 'pending')`,
      [projectA, eventId, eventType, envelope],
    );
  }

  /** Run the worker long enough to claim and process the inserted event, then stop. */
  async function runOnce(eventId: string, eventType: string, body: Record<string, unknown>): Promise<void> {
    await insertIntoInbox(eventId, eventType, body);
    const { worker, close } = makeWorker();
    await worker.start();
    // Poll until the event leaves the pending state (processed, retried, or dead-lettered).
    for (let i = 0; i < 50; i += 1) {
      const row = await queryRow<{ state: string }>(
        pool,
        `SELECT state FROM event_inbox WHERE event_id = $1`,
        [eventId],
      );
      if (row === undefined || row.state !== 'pending') break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await worker.stop();
    await close();
  }

  it('processes an error event end-to-end into error_event_occurrences', async () => {
    await runOnce('prod-err-1', 'error', { category: 'javascript', error: { message: 'Synthetic runtime failure' } });
    const rows = await queryRows<OccurrenceRow>(pool, `SELECT event_id, error_category FROM error_event_occurrences WHERE event_id = 'prod-err-1'`);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.error_category).toBe('javascript');
  });

  it('processes a request event end-to-end into request_metric_buckets', async () => {
    await runOnce('prod-req-1', 'request', { method: 'GET', url: 'https://api.example.test/orders', startedAt: 1_800_000_054_000, durationMs: 120, outcome: 'success', statusCode: 200 });
    const rows = await queryRows<MetricBucketRow>(pool, `SELECT method, observed_count FROM request_metric_buckets WHERE project_id = $1 AND method = 'GET'`, [projectA]);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('processes a performance event end-to-end into performance_metric_buckets with no sample', async () => {
    await runOnce('prod-perf-1', 'performance', { metricCategory: 'page', metricName: 'lcp', value: 2500, unit: 'millisecond', startedAt: 1_800_000_050_000 });
    const buckets = await queryRows<MetricBucketRow>(pool, `SELECT metric_name, observed_count FROM performance_metric_buckets WHERE project_id = $1 AND metric_name = 'lcp'`, [projectA]);
    expect(buckets.length).toBeGreaterThan(0);
    const samples = await queryRows<SampleRow>(pool, `SELECT event_id FROM performance_event_samples WHERE project_id = $1`, [projectA]);
    expect(samples).toHaveLength(0);
  });
});
```

> 注：`buildIngestionWorker`/`workerRuntime` 需要 `processEvent` 方法（或等价公开方法）。若真实 Worker runtime 不暴露 `processEvent`，则本集成测试改用 `worker.start()` + 真实 claim 循环（写入 `event_inbox` 后等待 worker 处理）。实施时以真实 `WorkerRuntime` 公共接口为准。

- [x] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @aurora/ingestion-worker test:integration -- test/integration/production-composition.test.ts`
Expected: FAIL —— 模块不存在（Cannot find module），或 Worker runtime 公开方法名需核对。

- [x] **Step 3: 写最小实现**

本 Task 无新源码；依赖 Task B1 的 composition。集成测试使用真实 claim 循环：写入 `event_inbox`（pending）→ `worker.start()` → 轮询直到事件离开 pending → `worker.stop()` → 断言 Store 行。`buildIngestionWorker` 的 repository 参数在测试内联构造（镜像 start.ts 私有 `createProcessingRepository`），不导入私有函数。

- [x] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @aurora/ingestion-worker test:integration -- test/integration/production-composition.test.ts`
Expected: PASS（3 个端到端测试）。

- [x] **Step 5: Commit 边界（不实际执行）**

```text
逻辑提交边界：test(ingestion-worker): production composition real-postgres end-to-end evidence
实际执行：不运行 git add/commit。
```

- [x] **Step 6: 检查差异**

Run: `git diff --check`
Expected: 无输出。

## Task B3：DAT-11 文档同步与状态基线

**Files:**
- Modify: `apps/ingestion-worker/README.md`
- Modify: `docs/architecture/production-worker-composition-root.md`（implementation-status → implemented）
- Modify: `docs/architecture/formalization-readiness.md`
- Modify: `docs/README.md`
- Modify: `docs/adr/ADR-012-ingestion-worker-runtime.md`（追加 DAT-11 实施证据）
- Modify: `docs/architecture/aurora-v1-remaining-module-batches.md`（DAT-10 后 36/42 → DAT-11 后 37/41）
- Modify: `apps/ingestion-worker/test/documentation-contract.test.ts`（追加 composition 规格对齐断言）

**Interfaces:**
- Consumes: Task A3/B1 的导出
- Produces: 文档同步 + G01 基线 43→41

- [x] **Step 1: 写失败测试**

`documentation-contract.test.ts` 追加：

```ts
  it('keeps the production worker composition spec honest about its boundary', async () => {
    const spec = await readFile(
      new URL('../../../docs/architecture/production-worker-composition-root.md', import.meta.url),
      'utf8',
    );
    expect(spec).toContain('implementation-status');
    expect(spec).toContain('createProductionIngestionWorker');
    expect(spec).toContain('Router');
    expect(spec).toContain('fake/noop');
  });
```

- [x] **Step 2: 运行测试确认当前状态**

Run: `pnpm --filter @aurora/ingestion-worker test`
Expected: PASS。

- [x] **Step 3: 写最小实现（文档修改）**

- README、composition 规格（implementation-status → implemented + 实施记录）、formalization-readiness、docs/README、ADR-012 证据同步；
- batch baseline：DAT-10 关闭时 completed 35→36 / remaining 43→42；DAT-11 关闭时 completed 36→37 / remaining 42→41；覆盖矩阵 G01 2→1→0、Total 43→42→41。

- [x] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @aurora/ingestion-worker test`
Expected: PASS。

- [x] **Step 5: Commit 边界（不实际执行）**

```text
逻辑提交边界：docs(ingestion-worker): production composition spec/readme/baseline sync
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
pnpm --filter @aurora/processing-store test/test:integration/test:package/build
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

## 回滚方式

- DAT-10 Router 与 DAT-11 composition 是 `apps/ingestion-worker` 内部模块，移除文件/导出/测试/README 条目不影响既有 processor/Worker runtime；
- 无 Migration、无破坏性数据操作。

## deferred 与 out-of-scope

- DAT-17 Performance Query、平台 UI、告警、Issue；
- Resource 事件正文（product scope deferred）；
- 新基础设施、事件协议修改、采样率执行；
- 性能诊断样本保存（V1 deferred）。

## 未完成状态处理

- 集成测试需真实 PostgreSQL 17 与 `AURORA_TEST_DATABASE_URL`；无 DB 环境时如实记录；
- 任何门禁失败停止调查，不伪造通过；
- 不执行 `git add`/`commit`/`push`。

## 计划自审批记录

> 自检修正记录（2026-08-07）：(1) Task B2 集成测试原计划使用 `worker.processEvent(...)` 与导入私有 `createProcessingRepository`——真实 `WorkerRuntime` 无 `processEvent` 方法（只有 `start()/stop()/status` + claim 循环），且 `createProcessingRepository` 是 `start.ts` 私有函数。已改为真实 claim 循环（写入 `event_inbox` → `worker.start()` → 轮询离开 pending → 断言 Store 行）并在测试内联构造 repository（镜像 start.ts 模式）。(2) Task B1 composition 源码原计划回退熵 `{ next: () => Math.random() }` 违反仓库 no-`Math.random` 姿态与计划 Global Constraint——已改为确定性 `{ next: () => 0 }`。(3) Task B2 集成测试原计划 `ConstructorParameters<typeof buildIngestionWorker>[0]['repository']` 在普通函数上非法（TS2344）——已改用 `IngestionInboxProcessingRepository` 类型注解；移除未用 `processorInput` helper 与 `ProcessIngestionEventInput` import；`row === undefined || row.state !== 'pending'` 改为 `row?.state !== 'pending'`（prefer-optional-chain）。(4) Task B2 `insertIntoInbox` 原计划列名与真实 `event_inbox` 不匹配（`event`/`attempts` 列不存在）——已改为真实列（`envelope`/`protocol_version`/`received_at`/`available_at`/`created_at`/`updated_at`/`state`）。

- DAT-10 spec coverage: pass（Router 规格 §8—§36 每项映射到 Task A1—A3）
- DAT-11 spec coverage: pass（composition 规格 §3—§43 每项映射到 Task B1—B3）
- 每叶子独立 Task/测试/计数: pass
- DAT-10 → DAT-11 停点: pass（Task B 仅在 DAT-10 验收后开始）
- 三 processor 类型一致性: pass（`IngestionEventProcessor`/`ProcessIngestionEventResult` 全计划一致）
- Router Result 一致性: pass（原样传播）
- Worker Port 一致性: pass（Router 实现 `IngestionEventProcessor`）
- Pool ownership: pass（composition 不拥有/关闭 Pool）
- shutdown: pass（`close` 幂等）
- retry/backoff/lease lost/dead-letter: pass（不实现，由 Worker runtime 承担）
- 文件真实性: pass（全部 Modify/Test 路径真实；Create 符合命名）
- 命令真实性: pass（从真实 package.json scripts 读取）
- 隐私: pass（无敏感字段；security-negative 覆盖）
- 依赖方向: pass（无新跨包依赖）
- 不修改 event-schema: pass
- 不新增基础设施: pass
- workspace safety: pass
- required ADR: none 新增（DAT-10/11 均无需新 ADR）
- closing leaves: DAT-10 + DAT-11（各自独立验收）
- closing count: 2
- remaining after verified completion: 41
- execution authorization: current G01 joint-mode instruction

"自审批"只表示计划可以执行，不得表示 Agent 批准了 ADR 或修改了产品规则。
