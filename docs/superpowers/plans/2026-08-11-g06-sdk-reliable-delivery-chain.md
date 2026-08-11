# G06 SDK Reliable Delivery Chain Implementation Plan (SDK-15 + SDK-16)

> **For agentic workers:** This plan is executed **inline by the current main Claude session** per the user's G06 joint-group directive (no subagents, no reviewer, no SDD workflow; only `superpowers:writing-plans` was authorized). Steps use checkbox (`- [ ]`) syntax for tracking. Commit boundaries are logical and explicit in the Git section; do not commit after every micro-step.

**Goal:** Implement SDK-15 (bounded in-memory queue, batch construction, deduplication, queue lifecycle, multi-instance isolation) and SDK-16 (transport, retry classification, retry/backoff, flush, page lifecycle flush, receipt/partial receipt, host safety) as one reliable SDK delivery chain in `@aurora/sdk` + `@aurora/browser` composition, closing 2 leaves (`completed` 58→60 / `remaining` 20→18).

**Architecture:** The delivery chain is environment-agnostic in `@aurora/sdk` (layer `sdk-core`, runtime dependency only on `@aurora/event-schema`), with the network transport injected. `@aurora/browser` (layer `sdk-browser`) provides a fetch-based browser transport, wires the chain into `createAuroraSdk` composition between Core (envelope creation) and the network, and hooks page lifecycle (`pagehide` → best-effort flush). `@aurora/core` receives one minimal additive change so the delivery chain can capture the created `EventEnvelope` (with its stable `eventId`) — required by PRD §6.1 and core-event-creation.md §9 (retries reuse the first-created envelope and ID).

**Tech Stack:** TypeScript strict (workspace config), Vitest 4.1.10, existing `@aurora/event-schema` protocol (batch/receipt contract, `BATCH_EVENT_LIMITS`, `parseIngestionRequestReceipt`, `IngestionReceiptState`, `IngestionErrorCode`), existing `@aurora/core` envelope creation, existing `@aurora/browser` page-lifecycle subscription.

---

## 固定回读与权威边界

| Module ID | 完整回读文件 | 重点章节 | 本计划不得改变的业务逻辑 | 缺失门禁 |
|---|---|---|---|---|
| SDK-15 | `Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md`；`Aurora 架构规范.md`；`Aurora 代码规范.md`；`Aurora 测试规范.md`；`Aurora ADR 规范.md`；`Aurora 文档规范.md`；`docs/architecture/sdk-architecture.md`；`docs/architecture/system-overview.md`；`docs/adr/ADR-003-sdk-plugin-architecture.md`；`docs/adr/ADR-004-asynchronous-event-processing.md`；`docs/adr/ADR-005-event-schema-source-of-truth.md`；`docs/adr/ADR-006-one-way-dependencies.md`；`docs/sdk/sdk-core-foundation.md`；`docs/sdk/core-event-creation.md`；`docs/sdk/browser-environment-foundation.md`；`docs/protocol/event-schema-foundation.md`；`docs/protocol/event-envelope-v1.md`；`docs/protocol/error-event-contract.md`；`docs/protocol/request-event-contract.md`；`docs/protocol/performance-event-contract.md`；`docs/protocol/ingestion-batch-and-receipt-contract.md`；`docs/architecture/formalization-readiness.md`；`docs/adr/README.md` | PRD §6（6.1 可靠性规则、6.2 简化项、6.3 重试原则）；ADR-004；Batch/Receipt Contract §4—11；SDK Architecture §3—6 | 每事件稳定唯一 ID；重试时 ID 不变；第一版仅内存队列、不做浏览器持久化离线队列；SDK 批量发送；队列、批次、重试、退避和内存均有上限；溢出稳定、低优先级可丢弃且错误不被挤占 | approved spec（本计划新写 SDK-15 部分）；无新 ADR（沿用 PRD §6 + ADR-004 语义；队列上限/溢出/生命周期/多实例均已有 approved 规则） |
| SDK-16 | 同上，另加 `docs/security/ingestion-transport-and-client-credential.md`；`docs/api/ingestion-openapi.md` 与 `docs/api/ingestion.openapi.yaml`；`docs/adr/ADR-009-ingestion-transport-and-client-credential.md`；`docs/adr/ADR-011-ingestion-http-service-runtime.md` | PRD §5.3、§6—7；传输安全决策 §3—5；OpenAPI §5—25；Browser Environment 页面生命周期（§10—11） | retryable 与 non-retryable 明确分离（PRD §6.3、Batch/Receipt §6.3/6.4）；重试有上限；flush 可控且可结束；pagehide/unload 只做 best-effort；partial receipt 逐事件处理；accepted/rejected 不能混淆；Transport 异常不破坏宿主；不创建插件独立上报通道 | approved spec（本计划新写 SDK-16 部分）；无新 ADR（沿用 PRD §6 + ADR-004/009 + Batch/Receipt 语义） |

---

## Global Constraints

以下约束从用户 G06 指令与 approved 权威文档逐条复制，每个 Task 都隐含遵守：

- 每事件在客户端生成唯一编号；同一事件重试时编号不变（PRD §6.1）。
- 第一版只使用内存队列和批量发送；不做浏览器持久化离线队列（PRD §6.1/6.2）。
- 可以有限重试：网络失败、请求超时、服务端临时不可用、服务端限流并返回等待时间（PRD §6.3）。
- 不重试：上报密钥无效、项目已归档或删除、来源域名不允许、运行环境不允许、数据格式错误、数据体积超过限制、命中不可绕过的隐私规则（PRD §6.3）。
- 页面退出前尽力发送高价值错误（PRD §6.1）；pagehide/unload 只做 best-effort。
- 一批数据中单条错误不能导致整批失败；partial receipt 逐事件处理；accepted/rejected 状态不能混淆（PRD §6.1、Batch/Receipt §6.5）。
- performance/slow-request 数据不得挤占高价值 error（PRD §15.2、SDK-13 规格 §2、SDK Architecture §5）。
- 不得创建插件自己的独立 transport；不得添加浏览器持久化队列；不得实现 G07 framework adapter。
- 事件 ID、协议版本、时间由 Core 生成（core-event-creation.md §5/§9）；不得建立第二套信封。
- Batch/Receipt 机器契约稳定：`maxEventsPerBatch=50`、`maxEventIdLength=128`、`maxRetryAfterMs=86400000`、四状态枚举、13 错误码（Batch/Receipt Contract §4.1）。
- 覆盖门禁：受影响包行 ≥85%、分支 ≥80%、函数 ≥85%、语句 ≥85%；不得降低门槛。
- 代码规范：strict TS、外部输入 `unknown`、无 `any`/`Function`/`Object`/`Record<string,any>`/非空断言/静默 catch；文件 kebab-case、类型 PascalCase、函数/变量 camelCase、布尔 `is/has/can/should`；不创建 `utils/helpers/common/misc`；公共 API 最小。
- 默认不采集请求/响应体、Cookie、Authorization、表单、完整 DOM/文本、完整行为轨迹、指纹、完整 IP；URL/Header/堆栈在入队前完成允许列表与去敏（SDK Architecture §5）。

---

## Design / File Structure

### `@aurora/sdk`（新增，层 `sdk-core`，只依赖 `@aurora/event-schema`）

| File | Responsibility |
|---|---|
| `packages/sdk/src/delivery-queue.ts` | SDK-15 有界内存队列：容量、溢出、优先级（error-first）、去重、clear/destroy、多实例隔离 |
| `packages/sdk/src/batch-builder.ts` | SDK-15 批次构造：envelopes → `IngestionBatchRequest`（引用 `BATCH_EVENT_LIMITS`） |
| `packages/sdk/src/transport-types.ts` | SDK-16 传输端口：`SdkBatchTransport` 与 `SdkTransportResult` 类型 |
| `packages/sdk/src/retry-classification.ts` | SDK-16 重试分类纯函数：HTTP 状态 / receipt 状态 / 传输原因 → retryable + retryAfterMs |
| `packages/sdk/src/retry-backoff.ts` | SDK-16 有界退避：capped exponential + equal jitter（注入熵） |
| `packages/sdk/src/delivery-chain.ts` | SDK-16 编排：enqueue→queue→drain→transport→receipt→retry/flush，有界诊断，宿主安全 |
| `packages/sdk/src/index.ts` | 追加导出上述公共符号（Modify） |

### `@aurora/core`（Modify，最小加法）

| File | Responsibility |
|---|---|
| `packages/core/src/event-entry.ts` | `CoreEventAccepted` 增加可选 `event?: EventEnvelope`，成功路径返回创建的信封（两条提交路径一致） |
| `packages/core/test/event-entry.test.ts` | 更新 exact-equality 断言，新增信封捕获断言（Modify） |

### `@aurora/browser`（Modify，层 `sdk-browser`）

| File | Responsibility |
|---|---|
| `packages/browser/src/delivery-transport.ts` | 新建浏览器 fetch transport：`POST {endpoint}/v1/batches`、`X-Aurora-Client-Key`/`X-Aurora-Environment`、状态→`SdkTransportResult`、不抛出 |
| `packages/browser/src/sdk-composition.ts` | Modify：注入 transport、创建 delivery chain、submitEvent 后 enqueue、pagehide→best-effort flush、destroy 清理 |
| `packages/browser/src/index.ts` | 追加导出 transport 工厂（Modify） |
| `packages/browser/test/sdk-composition.test.ts` | 追加 delivery 接线测试（Modify） |
| `packages/browser/test/delivery-transport.test.ts` | 新建 transport 单测（mock fetch） |

### Docs（Task 5）

`packages/sdk/README.md`、`packages/browser/README.md`、`packages/core/README.md`、`docs/sdk/sdk-reliable-delivery-chain.md`（新 approved 规格）、`docs/README.md`、`docs/architecture/sdk-architecture.md`、`docs/architecture/formalization-readiness.md`、`docs/architecture/aurora-v1-remaining-module-batches.md`、`docs/adr/ADR-004-asynchronous-event-processing.md`（追加证据）、`docs/adr/ADR-003-sdk-plugin-architecture.md`（追加证据）、`AGENTS.md`、`AURORA_RULES.md`、根 `README.md`。

---

## Task 1: Queue contract + bounded lifecycle (SDK-15)

**Files:**
- Create: `packages/sdk/src/delivery-queue.ts`
- Test: `packages/sdk/test/delivery-queue.test.ts`

**Interfaces:**
- Produces: `createSdkDeliveryQueue`, `SdkDeliveryQueue`, `SdkQueuedEvent`, `SdkEnqueueResult`, `SdkEnqueueCode`, `DEFAULT_DELIVERY_QUEUE_CAPACITY` — exact signatures in the test below.

**Approved semantics this task implements:** bounded (PRD §6.1/6.2), overflow stable with low-priority-drop and error never crowded out (PRD §15.2, SDK Architecture §5), lifecycle clear/destroy (SDK Architecture §3), multi-instance isolation (SDK Architecture §3), priority = `EventType.Error` high, others low.

- [ ] **Step 1: Write the failing test**

`packages/sdk/test/delivery-queue.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createSdkDeliveryQueue, DEFAULT_DELIVERY_QUEUE_CAPACITY } from '../src/index.js';

function errorEnvelope(eventId: string) {
  return { protocolVersion: 1, eventId, eventType: 'error', occurredAt: 1_800_000_000_000, body: { message: 'boom' } };
}
function requestEnvelope(eventId: string) {
  return { protocolVersion: 1, eventId, eventType: 'request', occurredAt: 1_800_000_000_000, body: { method: 'GET', url: 'https://api.test/x', startedAt: 1, durationMs: 100, outcome: 'success', statusCode: 200 } };
}
function performanceEnvelope(eventId: string) {
  return { protocolVersion: 1, eventId, eventType: 'performance', occurredAt: 1_800_000_000_000, body: { metricName: 'lcp', unit: 'millisecond', value: 100 } };
}

describe('createSdkDeliveryQueue', () => {
  it('defaults to a bounded capacity', () => {
    const queue = createSdkDeliveryQueue();
    expect(queue.capacity).toBe(DEFAULT_DELIVERY_QUEUE_CAPACITY);
  });

  it('enqueues and drains events', () => {
    const queue = createSdkDeliveryQueue({ capacity: 4 });
    expect(queue.enqueue(errorEnvelope('e1'), 1000).code).toBe('enqueued');
    expect(queue.enqueue(requestEnvelope('r1'), 1001).code).toBe('enqueued');
    expect(queue.size).toBe(2);
    const drained = queue.drain(10);
    expect(drained.map((i) => i.envelope.eventId).join(',')).toBe('e1,r1');
    expect(queue.size).toBe(0);
  });

  it('rejects duplicate event IDs already in queue', () => {
    const queue = createSdkDeliveryQueue({ capacity: 4 });
    expect(queue.enqueue(errorEnvelope('e1'), 1000).code).toBe('enqueued');
    expect(queue.enqueue(errorEnvelope('e1'), 1001).code).toBe('duplicate');
    expect(queue.size).toBe(1);
  });

  it('rejects invalid envelopes without throwing', () => {
    const queue = createSdkDeliveryQueue({ capacity: 4 });
    expect(queue.enqueue({ eventId: 123 }, 1000).code).toBe('invalid_envelope');
    expect(queue.enqueue(null, 1000).code).toBe('invalid_envelope');
    expect(queue.enqueue({ protocolVersion: 1, eventId: '', eventType: 'error', occurredAt: 1, body: {} }, 1000).code).toBe('invalid_envelope');
  });

  it('drains error events before lower-priority events', () => {
    const queue = createSdkDeliveryQueue({ capacity: 10 });
    queue.enqueue(performanceEnvelope('p1'), 1000);
    queue.enqueue(requestEnvelope('r1'), 1001);
    queue.enqueue(errorEnvelope('e1'), 1002);
    queue.enqueue(errorEnvelope('e2'), 1003);
    expect(queue.drain(10).map((i) => i.envelope.eventId).join(',')).toBe('e1,e2,p1,r1');
  });

  it('respects drain max batch size', () => {
    const queue = createSdkDeliveryQueue({ capacity: 10 });
    queue.enqueue(errorEnvelope('e1'), 1000);
    queue.enqueue(errorEnvelope('e2'), 1001);
    queue.enqueue(errorEnvelope('e3'), 1002);
    const first = queue.drain(2);
    expect(first.map((i) => i.envelope.eventId)).toEqual(['e1', 'e2']);
    expect(queue.size).toBe(1);
  });

  it('keeps memory bounded: on overflow admits error by evicting oldest low-priority', () => {
    const queue = createSdkDeliveryQueue({ capacity: 3 });
    queue.enqueue(performanceEnvelope('p1'), 1000);
    queue.enqueue(requestEnvelope('r1'), 1001);
    queue.enqueue(requestEnvelope('r2'), 1002);
    expect(queue.size).toBe(3);
    const result = queue.enqueue(errorEnvelope('e1'), 1003);
    expect(result.code).toBe('enqueued');
    expect(result.evictedEventId).toBe('p1');
    expect(queue.size).toBe(3);
    expect(queue.drain(10).map((i) => i.envelope.eventId).join(',')).toBe('e1,r1,r2');
  });

  it('drops a low-priority incoming event when the queue is full', () => {
    const queue = createSdkDeliveryQueue({ capacity: 2 });
    queue.enqueue(errorEnvelope('e1'), 1000);
    queue.enqueue(errorEnvelope('e2'), 1001);
    const result = queue.enqueue(performanceEnvelope('p1'), 1002);
    expect(result.code).toBe('queue_full');
    expect(queue.size).toBe(2);
  });

  it('reenqueue keeps the same event ID and increments attemptCount', () => {
    const queue = createSdkDeliveryQueue({ capacity: 4 });
    queue.enqueue(errorEnvelope('e1'), 1000);
    const item = queue.drain(1)[0];
    expect(item.envelope.eventId).toBe('e1');
    const retry = { envelope: item.envelope, attemptCount: 1, enqueuedAt: 2000 };
    expect(queue.reenqueue(retry, 2000).code).toBe('enqueued');
    expect(queue.drain(1)[0].attemptCount).toBe(1);
  });

  it('clear removes all events and resets dedup', () => {
    const queue = createSdkDeliveryQueue({ capacity: 4 });
    queue.enqueue(errorEnvelope('e1'), 1000);
    queue.clear();
    expect(queue.size).toBe(0);
    expect(queue.enqueue(errorEnvelope('e1'), 2000).code).toBe('enqueued');
  });

  it('destroy releases state and rejects further work', () => {
    const queue = createSdkDeliveryQueue({ capacity: 4 });
    queue.enqueue(errorEnvelope('e1'), 1000);
    queue.destroy();
    expect(queue.size).toBe(0);
    expect(queue.enqueue(errorEnvelope('e2'), 2000).code).toBe('destroyed');
    expect(queue.drain(10)).toEqual([]);
  });

  it('isolates instances (no shared mutable state)', () => {
    const a = createSdkDeliveryQueue({ capacity: 2 });
    const b = createSdkDeliveryQueue({ capacity: 2 });
    a.enqueue(errorEnvelope('e1'), 1000);
    expect(b.size).toBe(0);
    b.enqueue(errorEnvelope('e1'), 1000);
    a.destroy();
    expect(b.enqueue(errorEnvelope('e2'), 2000).code).toBe('enqueued');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aurora/sdk test -- test/delivery-queue.test.ts`
Expected: FAIL — module/exports not defined (no `delivery-queue.ts` yet).

- [ ] **Step 3: Implement the queue**

Create `packages/sdk/src/delivery-queue.ts`. Key behaviors:

- `DEFAULT_DELIVERY_QUEUE_CAPACITY = 256`; `normalizeCapacity` clamps to 1..1000 (like `createSdkActivityTrail`'s `normalizeCapacity`).
- Runtime-validate the incoming envelope: plain object; `eventType` passes `isEventType`; `eventId` is a non-empty string with length ≤ `EVENT_SCHEMA_LIMITS.maxEventIdLength`; otherwise `invalid_envelope`. (Full protocol validation already happened in Core; this is a light boundary check.)
- Store two internal arrays: `errorBucket` and `otherBucket` (each FIFO). `seen` = `Set<eventId>` of in-queue IDs (bounded by capacity).
- `enqueue(input, now)`:
  - destroyed → `{ ok:false, code:'destroyed' }`
  - invalid → `{ ok:false, code:'invalid_envelope' }`
  - duplicate (`seen.has(eventId)`) → `{ ok:false, code:'duplicate' }`
  - if `size < capacity` → push to bucket, add to `seen`, return `{ ok:true, code:'enqueued' }`
  - else overflow: if incoming is error → evict oldest from `otherBucket` (if any), push error, return `{ ok:true, code:'enqueued', evictedEventId }`; if incoming is low-priority or no low-priority to evict → return `{ ok:false, code:'queue_full' }`.
- `reenqueue(item, now)`: like enqueue but accepts a pre-built `SdkQueuedEvent` (envelope + attemptCount + enqueuedAt). If duplicate → `duplicate`; if destroyed → `destroyed`; if full → `queue_full` (retry items must not displace high-value errors arbitrarily — reenqueue of a retryable item when full drops it with `queue_full`).
- `drain(max)`: take up to `max` items error-first (drain `errorBucket` first, then `otherBucket`), remove from `seen`, return frozen copy.
- `clear()`: empty buckets + `seen`. `destroy()`: `clear()` + set destroyed flag.
- No module-level mutable state; every instance holds its own buckets, `seen`, and destroyed flag.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @aurora/sdk test -- test/delivery-queue.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/delivery-queue.ts packages/sdk/test/delivery-queue.test.ts packages/sdk/src/index.ts
git commit -m "feat(sdk): SDK-15 bounded delivery queue with priority, dedup, lifecycle"
```

---

## Task 2: Batching + dedup + SDK-15 integration (SDK-15)

**Files:**
- Create: `packages/sdk/src/batch-builder.ts`
- Test: `packages/sdk/test/batch-builder.test.ts`
- Modify: `packages/sdk/src/index.ts` (export `buildDeliveryBatch` + queue public surface), `packages/sdk/test/package-entry.test.ts` (assert new root exports)

**Interfaces:**
- Consumes: `createSdkDeliveryQueue`, `SdkQueuedEvent` (Task 1)
- Produces: `buildDeliveryBatch(events, receivedAt)` → `SdkBatchBuildResult`

- [ ] **Step 1: Write the failing test**

`packages/sdk/test/batch-builder.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { BATCH_EVENT_LIMITS, CURRENT_PROTOCOL_VERSION } from '@aurora/event-schema';
import { buildDeliveryBatch } from '../src/index.js';

function envelope(eventId: string) {
  return { protocolVersion: 1, eventId, eventType: 'error', occurredAt: 1_800_000_000_000, body: { message: 'x' } };
}

describe('buildDeliveryBatch', () => {
  it('builds a valid batch from envelopes', () => {
    const events = [envelope('e1'), envelope('e2')];
    const result = buildDeliveryBatch(events, 1_800_000_100_000);
    expect(result.ok).toBe(true);
    expect(result.ok && result.batch.protocolVersion).toBe(CURRENT_PROTOCOL_VERSION);
    expect(result.ok && result.batch.events.map((e) => e.eventId)).toEqual(['e1', 'e2']);
    expect(result.ok && result.batch.receivedAt).toBe(1_800_000_100_000);
  });

  it('rejects an empty batch', () => {
    expect(buildDeliveryBatch([], 1)).toEqual({ ok: false, code: 'empty' });
  });

  it('rejects more than maxEventsPerBatch events', () => {
    const events = Array.from({ length: BATCH_EVENT_LIMITS.maxEventsPerBatch + 1 }, (_, i) => envelope(`e${i}`));
    expect(buildDeliveryBatch(events, 1)).toEqual({ ok: false, code: 'too_many_events' });
  });

  it('freezes the produced batch and events array', () => {
    const result = buildDeliveryBatch([envelope('e1')], 1);
    expect(Object.isFrozen(result.ok ? result.batch : null)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aurora/sdk test -- test/batch-builder.test.ts`
Expected: FAIL — `buildDeliveryBatch` not exported.

- [ ] **Step 3: Implement the batch builder**

Create `packages/sdk/src/batch-builder.ts`:

```ts
import {
  BATCH_EVENT_LIMITS,
  CURRENT_PROTOCOL_VERSION,
  type EventEnvelope,
  type IngestionBatchRequest,
} from '@aurora/event-schema';

export interface SdkBatchBuildFailure {
  readonly ok: false;
  readonly code: 'empty' | 'too_many_events';
}
export type SdkBatchBuildResult =
  | { readonly ok: true; readonly batch: IngestionBatchRequest }
  | SdkBatchBuildFailure;

export function buildDeliveryBatch(
  events: readonly EventEnvelope[],
  receivedAt: number,
): SdkBatchBuildResult {
  if (events.length === 0) return Object.freeze({ ok: false, code: 'empty' });
  if (events.length > BATCH_EVENT_LIMITS.maxEventsPerBatch) {
    return Object.freeze({ ok: false, code: 'too_many_events' });
  }
  const batch: IngestionBatchRequest = {
    protocolVersion: CURRENT_PROTOCOL_VERSION,
    events: Object.freeze([...events]),
  };
  if (Number.isSafeInteger(receivedAt) && receivedAt > 0) batch.receivedAt = receivedAt;
  return Object.freeze({ ok: true, batch: Object.freeze(batch) });
}
```

Then export from `packages/sdk/src/index.ts`:
- `createSdkDeliveryQueue`, `DEFAULT_DELIVERY_QUEUE_CAPACITY`, `SdkDeliveryQueue`, `SdkQueuedEvent`, `SdkEnqueueResult`, `SdkEnqueueCode`
- `buildDeliveryBatch`, `SdkBatchBuildResult`, `SdkBatchBuildFailure`

Update `packages/sdk/test/package-entry.test.ts` to assert the new symbols (`createSdkDeliveryQueue`, `buildDeliveryBatch`) appear in the built root entry.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @aurora/sdk test -- test/delivery-queue.test.ts test/batch-builder.test.ts` and `pnpm --filter @aurora/sdk typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Run SDK-15 local test budget**

```bash
pnpm --filter @aurora/sdk test -- test/delivery-queue.test.ts test/batch-builder.test.ts
pnpm --filter @aurora/sdk typecheck
git diff --check
```

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/src/batch-builder.ts packages/sdk/src/index.ts packages/sdk/test/batch-builder.test.ts packages/sdk/test/package-entry.test.ts
git commit -m "feat(sdk): SDK-15 batch construction over bounded queue"
```

---

## === SDK-15 ACCEPTANCE ===

SDK-15 (memory queue/batching/deduplication) is independently verified when:

1. `packages/sdk/test/delivery-queue.test.ts` and `packages/sdk/test/batch-builder.test.ts` pass.
2. `packages/sdk` typecheck passes.
3. `git diff --check` is clean.
4. Key behaviors proven: bounded capacity/overflow (evict-lowest-priority / drop-incoming), batch construction (empty / >50 rejected), duplicate event not re-enqueued, event ID stable across reenqueue, clear/destroy cleanup, multi-instance isolation.
5. No network transport exists yet (no `transport` import; delivery-chain not present).

Record: **completed 58 → 59 / remaining 20 → 19.**

---

## Task 3: Transport port + retry classification (SDK-16)

**Files:**
- Create: `packages/sdk/src/transport-types.ts`, `packages/sdk/src/retry-classification.ts`, `packages/sdk/src/retry-backoff.ts`
- Test: `packages/sdk/test/retry-classification.test.ts`, `packages/sdk/test/retry-backoff.test.ts`

**Interfaces:**
- Produces: `SdkBatchTransport`, `SdkTransportContext`, `SdkTransportResult` (union), `classifySdkHttpStatus`, `classifySdkReceiptState`, `classifySdkTransportReason`, `calculateSdkRetryDelay`.

- [ ] **Step 1: Write the failing tests**

`packages/sdk/test/retry-classification.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { IngestionReceiptState } from '@aurora/event-schema';
import { classifySdkHttpStatus, classifySdkReceiptState, classifySdkTransportReason } from '../src/index.js';

describe('classifySdkHttpStatus', () => {
  it.each([400, 401, 403, 413, 415])('treats HTTP %i as non-retryable', (status) => {
    expect(classifySdkHttpStatus(status).retryable).toBe(false);
  });
  it('treats HTTP 0 (transport not configured) as non-retryable', () => {
    expect(classifySdkHttpStatus(0).retryable).toBe(false);
  });
  it.each([429, 500, 503, 408])('treats HTTP %i as retryable', (status) => {
    expect(classifySdkHttpStatus(status).retryable).toBe(true);
  });
  it('propagates server retryAfterMs for retryable status', () => {
    expect(classifySdkHttpStatus(429, 5000)).toEqual({ retryable: true, retryAfterMs: 5000 });
  });
  it('treats unknown 2xx/3xx/4xx as non-retryable (defensive)', () => {
    expect(classifySdkHttpStatus(200).retryable).toBe(false);
    expect(classifySdkHttpStatus(302).retryable).toBe(false);
  });
});

describe('classifySdkReceiptState', () => {
  it('treats permanently_rejected as non-retryable', () => {
    expect(classifySdkReceiptState(IngestionReceiptState.PermanentlyRejected).retryable).toBe(false);
  });
  it('treats temporarily_failed as retryable and propagates retryAfterMs', () => {
    expect(classifySdkReceiptState(IngestionReceiptState.TemporarilyFailed, 2500)).toEqual({ retryable: true, retryAfterMs: 2500 });
  });
  it.each([IngestionReceiptState.Accepted, IngestionReceiptState.DuplicateAccepted])(
    'treats %s as non-retryable success (no retry needed)',
    (state) => expect(classifySdkReceiptState(state).retryable).toBe(false),
  );
});

describe('classifySdkTransportReason', () => {
  it('treats network and timeout as retryable', () => {
    expect(classifySdkTransportReason('network').retryable).toBe(true);
    expect(classifySdkTransportReason('timeout').retryable).toBe(true);
  });
});
```

`packages/sdk/test/retry-backoff.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { calculateSdkRetryDelay } from '../src/index.js';

describe('calculateSdkRetryDelay', () => {
  it('grows exponentially from the base and is capped at maxDelayMs', () => {
    expect(calculateSdkRetryDelay({ attemptCount: 0, baseDelayMs: 500, maxDelayMs: 30_000, entropy: 0 })).toBeGreaterThanOrEqual(250);
    expect(calculateSdkRetryDelay({ attemptCount: 10, baseDelayMs: 500, maxDelayMs: 30_000, entropy: 0 })).toBeLessThanOrEqual(30_000);
  });
  it('uses server retryAfterMs when provided, capped at maxDelayMs', () => {
    expect(calculateSdkRetryDelay({ attemptCount: 0, baseDelayMs: 500, maxDelayMs: 30_000, entropy: 0, serverRetryAfterMs: 86400000 })).toBe(30_000);
    expect(calculateSdkRetryDelay({ attemptCount: 0, baseDelayMs: 500, maxDelayMs: 30_000, entropy: 0, serverRetryAfterMs: 1000 })).toBe(1000);
  });
  it('always returns a positive integer', () => {
    const delay = calculateSdkRetryDelay({ attemptCount: 3, baseDelayMs: 500, maxDelayMs: 30_000, entropy: 0.5 });
    expect(Number.isSafeInteger(delay)).toBe(true);
    expect(delay).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @aurora/sdk test -- test/retry-classification.test.ts test/retry-backoff.test.ts`
Expected: FAIL — symbols not exported.

- [ ] **Step 3: Implement the modules**

`transport-types.ts`:

```ts
import type { IngestionBatchRequest, IngestionRequestReceipt } from '@aurora/event-schema';

export type SdkTransportMode = 'normal' | 'best_effort';
export interface SdkTransportContext {
  readonly mode: SdkTransportMode;
}
export type SdkTransportSuccess = {
  readonly kind: 'success';
  readonly status: number;
  readonly receipt: IngestionRequestReceipt;
};
export type SdkTransportFailure =
  | { readonly kind: 'transport_failure'; readonly reason: 'network' | 'timeout'; readonly retryAfterMs?: number }
  | { readonly kind: 'http_error'; readonly status: number; readonly retryAfterMs?: number; readonly receipt?: IngestionRequestReceipt };
export type SdkTransportResult = SdkTransportSuccess | SdkTransportFailure;
export interface SdkBatchTransport {
  readonly send: (request: IngestionBatchRequest, context: SdkTransportContext) => Promise<SdkTransportResult>;
}
```

`retry-classification.ts`: pure functions per approved rules (PRD §6.3 + Batch/Receipt §6.3/6.4):

```ts
import { IngestionReceiptState } from '@aurora/event-schema';

export interface SdkRetryDecision {
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
}

const RETRYABLE_HTTP = new Set([408, 429, 500, 502, 503, 504]);

export function classifySdkHttpStatus(status: number, retryAfterMs?: number): SdkRetryDecision {
  if (RETRYABLE_HTTP.has(status)) return Object.freeze({ retryable: true, ...(retryAfterMs ? { retryAfterMs } : {}) });
  return Object.freeze({ retryable: false });
}

export function classifySdkReceiptState(state: IngestionReceiptState, retryAfterMs?: number): SdkRetryDecision {
  if (state === IngestionReceiptState.TemporarilyFailed) {
    return Object.freeze({ retryable: true, ...(retryAfterMs ? { retryAfterMs } : {}) });
  }
  return Object.freeze({ retryable: false });
}

export function classifySdkTransportReason(reason: 'network' | 'timeout', retryAfterMs?: number): SdkRetryDecision {
  return Object.freeze({ retryable: true, ...(retryAfterMs ? { retryAfterMs } : {}) });
}
```

`retry-backoff.ts`:

```ts
export interface SdkBackoffParams {
  readonly attemptCount: number;      // 0-based attempts already made
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly entropy: number;           // 0..1 jitter (injected)
  readonly serverRetryAfterMs?: number;
}

export function calculateSdkRetryDelay(params: SdkBackoffParams): number {
  const max = Math.max(1, Math.floor(params.maxDelayMs));
  if (params.serverRetryAfterMs !== undefined && Number.isSafeInteger(params.serverRetryAfterMs) && params.serverRetryAfterMs > 0) {
    return Math.min(max, params.serverRetryAfterMs);
  }
  const exponent = Math.max(0, Math.floor(params.attemptCount));
  const raw = Math.min(max, params.baseDelayMs * 2 ** exponent);
  const jitter = 0.5 + Math.min(1, Math.max(0, params.entropy)) * 0.5; // equal jitter 0.5..1.0
  return Math.max(1, Math.floor(raw * jitter));
}
```

Export all three modules' symbols from `packages/sdk/src/index.ts`. Update `packages/sdk/test/package-entry.test.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @aurora/sdk test -- test/retry-classification.test.ts test/retry-backoff.test.ts` and `pnpm --filter @aurora/sdk typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/transport-types.ts packages/sdk/src/retry-classification.ts packages/sdk/src/retry-backoff.ts packages/sdk/src/index.ts packages/sdk/test/retry-classification.test.ts packages/sdk/test/retry-backoff.test.ts packages/sdk/test/package-entry.test.ts
git commit -m "feat(sdk): SDK-16 transport port, retry classification, bounded backoff"
```

---

## Task 4: Delivery chain — flush, retry, partial receipt, host safety (SDK-16)

**Files:**
- Create: `packages/sdk/src/delivery-chain.ts`
- Test: `packages/sdk/test/delivery-chain.test.ts`

**Interfaces:**
- Consumes: `createSdkDeliveryQueue` + `buildDeliveryBatch` (Tasks 1–2), `SdkBatchTransport`/`SdkTransportResult`/`SdkTransportContext` + retry classifier/backoff (Task 3)
- Produces: `createSdkDeliveryChain`, `SdkDeliveryChain`, `SdkDeliveryChainOptions`, `SdkFlushResult`, `SdkDeliveryDiagnostic`, `DEFAULT_SDK_MAX_RETRIES`, `DEFAULT_SDK_BASE_RETRY_DELAY_MS`, `DEFAULT_SDK_MAX_RETRY_DELAY_MS`

- [ ] **Step 1: Write the failing test**

`packages/sdk/test/delivery-chain.test.ts` (core cases; a focused integration chain is included here and re-run at final acceptance):

```ts
import { describe, expect, it } from 'vitest';
import { IngestionErrorCode, IngestionReceiptState, type IngestionRequestReceipt } from '@aurora/event-schema';
import { createSdkDeliveryChain, type SdkBatchTransport, type SdkTransportResult } from '../src/index.js';

function errorEnvelope(eventId: string) {
  return { protocolVersion: 1, eventId, eventType: 'error', occurredAt: 1_800_000_000_000, body: { message: 'boom' } };
}
function receiptFor(events: readonly { eventId: string }[], states: readonly string[]): IngestionRequestReceipt {
  return {
    batchState: states.every((s) => s === 'accepted') ? 'accepted' : states.includes('temporarily_failed') ? 'temporarily_failed' : 'permanently_rejected',
    retryable: states.includes('temporarily_failed'),
    perEventResults: events.map((e, i) => ({
      eventId: e.eventId,
      state: states[i] as never,
      errorCode: states[i] === 'permanently_rejected' ? IngestionErrorCode.InvalidSchema : undefined,
      retryable: states[i] === 'temporarily_failed',
    })),
  };
}
function successTransport(events: readonly { eventId: string }[], states: readonly string[] = ['accepted']): SdkBatchTransport {
  return { send: async () => ({ kind: 'success', status: 200, receipt: receiptFor(events, states) }) };
}

describe('createSdkDeliveryChain', () => {
  it('sends an enqueued batch and removes accepted events', async () => {
    const sent: string[][] = [];
    const chain = createSdkDeliveryChain({ clientKey: 'k', environment: null }, {
      transport: { send: async (request) => { sent.push(request.events.map((e) => e.eventId)); return { kind: 'success', status: 200, receipt: receiptFor(request.events) }; } },
      schedule: (fn) => fn(),
      now: () => 1_000,
      entropy: () => 0,
    });
    expect(chain.enqueue(errorEnvelope('e1')).code).toBe('enqueued');
    const result = await chain.flush();
    expect(sent).toEqual([['e1']]);
    expect(result.eventsSent).toBe(1);
    expect(chain.size).toBe(0);
  });

  it('retries a network failure up to maxRetries then drops', async () => {
    let sends = 0;
    const chain = createSdkDeliveryChain({ clientKey: 'k', environment: null }, {
      transport: { send: async () => { sends += 1; return { kind: 'transport_failure', reason: 'network' }; } },
      maxRetries: 2,
      schedule: (fn) => fn(),
      now: () => 1_000,
      entropy: () => 0,
    });
    chain.enqueue(errorEnvelope('e1'));
    const result = await chain.flush();
    expect(sends).toBe(3); // first + 2 retries
    expect(result.eventsSent).toBe(0);
    expect(result.eventsDropped).toBe(1);
    expect(chain.size).toBe(0);
  });

  it('does NOT retry a non-retryable HTTP rejection', async () => {
    let sends = 0;
    const chain = createSdkDeliveryChain({ clientKey: 'k', environment: null }, {
      transport: { send: async () => { sends += 1; return { kind: 'http_error', status: 401 }; } },
      maxRetries: 3,
      schedule: (fn) => fn(),
      now: () => 1_000,
      entropy: () => 0,
    });
    chain.enqueue(errorEnvelope('e1'));
    const result = await chain.flush();
    expect(sends).toBe(1);
    expect(result.eventsDropped).toBe(1);
  });

  it('handles a partial receipt per-event: accepted done, permanent dropped, temporary retried', async () => {
    const sent: string[][] = [];
    const chain = createSdkDeliveryChain({ clientKey: 'k', environment: null }, {
      transport: {
        send: async (request) => {
          sent.push(request.events.map((e) => e.eventId));
          const states = request.events.map((e) =>
            e.eventId === 'ok' ? 'accepted' : e.eventId === 'bad' ? 'permanently_rejected' : 'accepted', // retry succeeds on the second attempt
          );
          return { kind: 'success', status: 200, receipt: receiptFor(request.events, states) };
        },
      },
      maxRetries: 2,
      schedule: (fn) => fn(), // synchronous: retries drain within the same flush
      now: () => 1_000,
      entropy: () => 0,
    });
    chain.enqueue(errorEnvelope('ok'));
    chain.enqueue(errorEnvelope('bad'));
    chain.enqueue(errorEnvelope('retry'));
    const result = await chain.flush();
    // first send: ok accepted, bad permanently dropped, retry temporarily_failed → reenqueued and resent within the same flush
    expect(sent).toHaveLength(2);
    expect(sent[0].sort()).toEqual(['bad', 'ok', 'retry']);
    expect(sent[1]).toEqual(['retry']);
    expect(result.eventsDropped).toBe(1); // only 'bad'
    expect(chain.size).toBe(0);
  });

  it('flush is controllable and terminates', async () => {
    const chain = createSdkDeliveryChain({ clientKey: 'k', environment: null }, {
      transport: successTransport([]),
      maxRetries: 1,
      schedule: (fn) => fn(),
      now: () => 1_000,
      entropy: () => 0,
    });
    chain.enqueue(errorEnvelope('e1'));
    const result = await chain.flush();
    expect(result.ok).toBe(true);
  });

  it('transport exceptions never escape to the caller', async () => {
    const chain = createSdkDeliveryChain({ clientKey: 'k', environment: null }, {
      transport: { send: async () => { throw new Error('boom'); } },
      maxRetries: 1,
      schedule: (fn) => fn(),
      now: () => 1_000,
      entropy: () => 0,
    });
    chain.enqueue(errorEnvelope('e1'));
    const result = await chain.flush();
    expect(result.ok).toBe(true); // caught, converted to failure + diagnostics
    expect(chain.getDiagnostics().some((d) => d.code === 'transport_failure')).toBe(true);
  });

  it('destroys and rejects further enqueue', async () => {
    const chain = createSdkDeliveryChain({ clientKey: 'k', environment: null }, {
      transport: successTransport([]),
      schedule: (fn) => fn(),
      now: () => 1_000,
      entropy: () => 0,
    });
    chain.destroy();
    expect(chain.enqueue(errorEnvelope('e1')).code).toBe('destroyed');
  });

  it('isolates instances', async () => {
    const sentA: string[][] = [];
    const a = createSdkDeliveryChain({ clientKey: 'k', environment: null }, {
      transport: { send: async (request) => { sentA.push(request.events.map((e) => e.eventId)); return { kind: 'success', status: 200, receipt: receiptFor(request.events) }; } },
      schedule: (fn) => fn(),
      now: () => 1_000,
      entropy: () => 0,
    });
    const b = createSdkDeliveryChain({ clientKey: 'k', environment: null }, {
      transport: successTransport([]),
      schedule: (fn) => fn(),
      now: () => 1_000,
      entropy: () => 0,
    });
    a.enqueue(errorEnvelope('e1'));
    await a.flush();
    expect(sentA).toEqual([['e1']]);
    expect(b.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aurora/sdk test -- test/delivery-chain.test.ts`
Expected: FAIL — `createSdkDeliveryChain` not exported.

- [ ] **Step 3: Implement the delivery chain**

Create `packages/sdk/src/delivery-chain.ts`. Key behaviors (each is a small, focused internal function; no `utils`/`helpers`):

- Defaults: `DEFAULT_SDK_MAX_RETRIES = 3`, `DEFAULT_SDK_BASE_RETRY_DELAY_MS = 500`, `DEFAULT_SDK_MAX_RETRY_DELAY_MS = 30_000`. `normalizeMaxRetries` clamps 0..10; `normalizeDelay` clamps to safe positive int.
- State per instance: `queue` (from Task 1), `isSending: boolean`, `isDestroyed: boolean`, `diagnostics` bounded array (capacity default 100) with `sequence` starting at 1.
- `enqueue(input)`: if destroyed → `{ ok:false, code:'destroyed' }`; `const result = queue.enqueue(input, now())`; if `result.ok` → schedule a drain (coalesced via `isDrainScheduled`); return result.
- `drainPass(bestEffort)`: the only place that sends.
  - Batch size = `BATCH_EVENT_LIMITS.maxEventsPerBatch` (50).
  - While `!isSending && queue.size > 0 && !isDestroyed`:
    - `items = queue.drain(batchSize)`; `batch = buildDeliveryBatch(items.map(i => i.envelope), now())`.
    - If `!batch.ok` → drop items (diagnostic `event_dropped`), continue (defensive; cannot normally happen).
    - `isSending = true`; wrap `transport.send(batch.batch, { mode: bestEffort ? 'best_effort' : 'normal' })` in try/catch (catch → `{ kind:'transport_failure', reason:'network' }`); `isSending = false`.
    - Handle `SdkTransportResult`:
      - `success`: diagnostic `batch_sent`. If `receipt.perEventResults.length === 0` → treat all items as accepted (done). Else for each item, look up its result by matching `eventId`:
        - `accepted`/`duplicate_accepted` → done (diagnostic `event_accepted`).
        - `permanently_rejected` → drop (diagnostic `event_dropped`), `eventsDropped++`.
        - `temporarily_failed` → `retryEvent(item)`.
      - `transport_failure`: diagnostic `transport_failure`. Retry all items via `retryEvent`.
      - `http_error`: `decision = classifySdkHttpStatus(status, retryAfterMs)`; if `!decision.retryable` → drop all items (diagnostic `batch_dropped`), `eventsDropped += items.length`; else → if a `receipt` is present with per-event results, handle per-event like success; otherwise retry all items via `retryEvent`.
  - `retryEvent(item)`: if `item.attemptCount >= maxRetries` → drop (diagnostic `event_retry_exhausted`), `eventsDropped++`; else → `next = { envelope: item.envelope, attemptCount: item.attemptCount + 1, enqueuedAt: now() }`; `const r = queue.reenqueue(next, now())`; if `r.ok` → schedule a delayed drain using `calculateSdkRetryDelay({ attemptCount: item.attemptCount, baseDelayMs, maxDelayMs, entropy: entropy(), serverRetryAfterMs })` (diagnostic `event_retry_scheduled`); else drop.
- `flush({ bestEffort })`: force a drain pass; return `SdkFlushResult { ok:true, sentBatches, eventsSent, eventsDropped, eventsPending: queue.size }`. Because retries are scheduled (not inline), `flush` returns after the current pass; `eventsPending` reflects re-queued retries honestly.
- `destroy()`: set destroyed; `queue.destroy()`; clear diagnostics; reject scheduling.
- `getDiagnostics()`: frozen copy of bounded diagnostics.
- Host safety: no exception from `send`, `schedule`, or `queue` operations escapes `flush`/`enqueue`; all wrapped.

Export the chain + defaults + types from `packages/sdk/src/index.ts`. Update `packages/sdk/test/package-entry.test.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @aurora/sdk test -- test/delivery-chain.test.ts` and `pnpm --filter @aurora/sdk typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Run SDK-16 local test budget**

```bash
pnpm --filter @aurora/sdk test -- test/retry-classification.test.ts test/retry-backoff.test.ts test/delivery-chain.test.ts
pnpm --filter @aurora/sdk typecheck
git diff --check
```

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/src/delivery-chain.ts packages/sdk/src/index.ts packages/sdk/test/delivery-chain.test.ts packages/sdk/test/package-entry.test.ts
git commit -m "feat(sdk): SDK-16 reliable delivery chain (flush, retry, partial receipt, host safety)"
```

---

## Task 5: Core envelope capture + browser composition + transport + focused integration + docs

**Files:**
- Modify: `packages/core/src/event-entry.ts`, `packages/core/src/index.ts`, `packages/core/test/event-entry.test.ts`
- Create: `packages/browser/src/delivery-transport.ts`
- Modify: `packages/browser/src/sdk-composition.ts`, `packages/browser/src/index.ts`
- Test: `packages/browser/test/delivery-transport.test.ts`, `packages/browser/test/sdk-composition.test.ts`
- Docs: see Design section.

**Why the core change is required:** PRD §6.1 requires a stable client-generated event ID reused on retry, and core-event-creation.md §9 requires transport retries to reuse the first-created envelope and ID. Core is the single envelope creator (core-event-creation.md §5). The delivery chain therefore needs the created `EventEnvelope` from Core's accepted result. `CoreEventAccepted` gains an **additive, optional** `event?: EventEnvelope`. This is backward-compatible (existing consumers check `ok`/`code`), does not change wire contract (`event-schema` untouched), and does not change Core behavior — it exposes the envelope Core already creates.

- [ ] **Step 1: Core envelope capture (write the failing test first)**

Add to `packages/core/test/event-entry.test.ts`:

```ts
it('exposes the created envelope (with stable eventId) on accepted draft submission', () => {
  const core = createCore({ eventIdProvider: { createEventId: () => 'evt-0001' }, eventTimeProvider: { now: () => 1_800_000_000_000 } });
  core.initialize();
  core.start();
  const result = core.submitEventDraft({ eventType: EventType.Error, body: { message: 'x' } });
  expect(result.ok).toBe(true);
  expect(result.ok && result.event?.eventId).toBe('evt-0001');
  expect(result.ok && result.event?.eventType).toBe('error');
});
```

Also update existing exact-equality assertions on `accepted` results (event-entry.test.ts lines ~20, ~121, ~170) from `.toEqual({...})` to `.toMatchObject({ ok:true, code:'accepted', state:'started', diagnosticsAdded:0 })` (or add `event: expect.objectContaining(...)`), because the success result now carries `event`.

Run `pnpm --filter @aurora/core test -- test/event-entry.test.ts` → expect FAIL on the new assertion.

Implement in `packages/core/src/event-entry.ts`:
- Add `import type { EventEnvelope } from '@aurora/event-schema';`
- `CoreEventAccepted` gains `readonly event?: EventEnvelope;`
- In `submitCoreEvent` success branch: `return Object.freeze({ ok:true, code:'accepted', state:'started', diagnosticsAdded:0, event: parsed.data });`
- This also covers the draft path (`submitCoreEventDraft` passes `created.event` through), so both `submitEvent` and `submitEventDraft` expose the envelope.
- The composition consumes `result.event` via narrowing (typed `EventEnvelope | undefined` from `CoreEventAccepted.event`); no additional type re-export is required.

Run `pnpm --filter @aurora/core test` and `pnpm --filter @aurora/core typecheck` → PASS.

- [ ] **Step 2: Browser transport (unit, mock fetch)**

Write failing test `packages/browser/test/delivery-transport.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IngestionErrorCode, IngestionReceiptState } from '@aurora/event-schema';
import { createBrowserBatchTransport } from '../src/index.js';

afterEach(() => vi.unstubAllGlobals());

function batch() {
  return { protocolVersion: 1, events: [{ protocolVersion: 1, eventId: 'e1', eventType: 'error', occurredAt: 1, body: {} }] };
}
function receipt() {
  return { batchState: 'accepted', retryable: false, perEventResults: [{ eventId: 'e1', state: 'accepted', retryable: false }] };
}

describe('createBrowserBatchTransport', () => {
  it('POSTs to {endpoint}/v1/batches with client headers', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(receipt()), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const transport = createBrowserBatchTransport({ clientKey: 'aurora_ingest_k1_s', environment: 'prod', ingestEndpoint: 'https://ingest.example.test', fetchImpl: fetchImpl as never });
    const result = await transport.send(batch() as never, { mode: 'normal' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://ingest.example.test/v1/batches');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['X-Aurora-Client-Key']).toBe('aurora_ingest_k1_s');
    expect((init.headers as Record<string, string>)['X-Aurora-Environment']).toBe('prod');
    expect(result.kind).toBe('success');
  });

  it('maps HTTP 429 to a retryable http_error with Retry-After', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ batchState: 'temporarily_failed', retryable: true, errorCode: 'rate_limited', perEventResults: [] }), { status: 429, headers: { 'Retry-After': '2' } }));
    const transport = createBrowserBatchTransport({ clientKey: 'k', environment: null, ingestEndpoint: 'https://ingest.example.test', fetchImpl: fetchImpl as never });
    const result = await transport.send(batch() as never, { mode: 'normal' });
    expect(result.kind).toBe('http_error');
    expect(result.status).toBe(429);
    expect(result.retryAfterMs).toBe(2000);
  });

  it('maps network failure to transport_failure and never throws', async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError('network down'); });
    const transport = createBrowserBatchTransport({ clientKey: 'k', environment: null, ingestEndpoint: 'https://ingest.example.test', fetchImpl: fetchImpl as never });
    const result = await transport.send(batch() as never, { mode: 'normal' });
    expect(result.kind).toBe('transport_failure');
  });

  it('uses fetch keepalive in best_effort mode', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(receipt()), { status: 200 }));
    const transport = createBrowserBatchTransport({ clientKey: 'k', environment: null, ingestEndpoint: 'https://ingest.example.test', fetchImpl: fetchImpl as never });
    await transport.send(batch() as never, { mode: 'best_effort' });
    expect((fetchImpl.mock.calls[0][1] as RequestInit).keepalive).toBe(true);
  });

  it('returns non-retryable http_error when no ingest endpoint is configured', async () => {
    const transport = createBrowserBatchTransport({ clientKey: 'k', environment: null, ingestEndpoint: '' });
    const result = await transport.send(batch() as never, { mode: 'normal' });
    expect(result.kind).toBe('http_error');
    expect(result.status).toBe(0);
  });
});
```

Run → expect FAIL. Implement `packages/browser/src/delivery-transport.ts`:

- `createBrowserBatchTransport({ clientKey, environment, ingestEndpoint, fetchImpl })`.
- If `!ingestEndpoint` → `send` returns `{ kind:'http_error', status:0 }` (non-retryable per classifier).
- Else `send(request, { mode })`: build `URL = ingestEndpoint + '/v1/batches'` (strip trailing `/` from endpoint if present); headers `Content-Type: application/json`, `X-Aurora-Client-Key`, `X-Aurora-Environment` (omit header when environment is null); `keepalive: mode === 'best_effort'`; `body: JSON.stringify(request)`.
- Wrap `fetchImpl(requestUrl, init)` in try/catch → reject → `{ kind:'transport_failure', reason:'network' }`.
- On response: parse `Retry-After` header → `retryAfterMs` (integer seconds → ms, `Number * 1000`). Read body text; if `response.ok` (2xx) → parse body via `parseIngestionRequestReceipt`; parse failure → `{ kind:'transport_failure', reason:'network' }`; success → `{ kind:'success', status, receipt }`. Else → try parse body via `parseIngestionRequestReceipt` (optional `receipt`) and return `{ kind:'http_error', status, retryAfterMs, receipt? }`.
- Never throws.

Export from `packages/browser/src/index.ts`.

Run `pnpm --filter @aurora/browser test -- test/delivery-transport.test.ts` → PASS.

- [ ] **Step 3: Composition wiring**

Write the failing additions to `packages/browser/test/sdk-composition.test.ts`:

```ts
import { createSdkDeliveryChain, type SdkBatchTransport } from '@aurora/sdk';
// inside a test:
it('wires accepted events into the delivery chain (fake transport captures batch)', async () => {
  const sent: string[][] = [];
  const transport: SdkBatchTransport = {
    send: async (request) => {
      sent.push(request.events.map((e) => e.eventId));
      return { kind: 'success', status: 200, receipt: { batchState: 'accepted', retryable: false, perEventResults: request.events.map((e) => ({ eventId: e.eventId, state: 'accepted', retryable: false })) } };
    },
  };
  const handle = createAuroraSdk({ config: { clientKey: 'k1' }, transport });
  await handle.start();
  probe.submit(errorDraft({ message: 'boom' }));
  await handle.delivery.flush();
  expect(sent.length).toBeGreaterThanOrEqual(1);
  await handle.destroy();
});

it('exposes delivery on the handle and destroys it with the handle', async () => {
  const handle = createAuroraSdk({ config: { clientKey: 'k1' }, transport: successTransport() });
  expect(handle.delivery).toBeDefined();
  await handle.destroy();
  expect(handle.delivery.enqueue({ protocolVersion: 1, eventId: 'e1', eventType: 'error', occurredAt: 1, body: {} }).code).toBe('destroyed');
});
```

Modify `packages/browser/src/sdk-composition.ts`:
- `CreateAuroraSdkInput` gains `ingestEndpoint?: string` and `transport?: SdkBatchTransport` (both additive, backward-compatible).
- `AuroraSdkHandle` gains `delivery: SdkDeliveryChain`.
- In `createAuroraSdk`: build `transport = input.transport ?? createBrowserBatchTransport({ clientKey: config.clientKey, environment: config.environment, ingestEndpoint: input.ingestEndpoint ?? '' })`; create `delivery = createSdkDeliveryChain({ clientKey: config.clientKey, environment: config.environment }, { transport })`.
- `wrapPlugin`'s `submitEvent`: after `const result = core.submitEventDraft(processed.event); if (result.ok && result.event) { void delivery.enqueue(result.event); } return result;`
- `start()`: after `core.start()` succeeds, subscribe page lifecycle: `const sub = environment.subscribePageLifecycle((event) => { if (event.type === PageLifecycleEventType.PageHide) void delivery.flush({ bestEffort: true }); });` store subscription; if `!sub.ok` ignore gracefully.
- `destroy()`: unsubscribe lifecycle (if subscribed), `delivery.destroy()`, `control.destroy()`, `core.destroy()`.
- Handle object gains `delivery`.

Run `pnpm --filter @aurora/browser test -- test/sdk-composition.test.ts` and typecheck → PASS.

- [ ] **Step 4: Focused integration chain (final gate, run once)**

Add `packages/sdk/test/delivery-chain.test.ts` already covers queue→batch→transport→partial-receipt (Task 4). At final acceptance run the delivery-chain suite as the single focused integration chain (queue → batch → transport → partial receipt → retry bounded), plus the browser composition wiring test above.

- [ ] **Step 5: Update docs and formal statuses**

- Create `docs/sdk/sdk-reliable-delivery-chain.md` (new approved formal spec; status `approved`/`implemented`) documenting SDK-15 + SDK-16 contracts: bounded queue + overflow/priority semantics, batch construction, dedup, transport port, retry classifier (PRD §6.3 mapping), bounded backoff, flush normal/best-effort, partial receipt handling, diagnostics, multi-instance, and the core envelope-capture note.
- Update `packages/sdk/README.md`, `packages/browser/README.md`, `packages/core/README.md`.
- Update `docs/README.md`, `docs/architecture/sdk-architecture.md` (queue/transport no longer absent), `docs/architecture/formalization-readiness.md`.
- Update `docs/architecture/aurora-v1-remaining-module-batches.md` (§5.4 SDK-15/16 rows → closed; counts 58→60 / 20→18).
- Append evidence to `docs/adr/ADR-004-asynchronous-event-processing.md` and `docs/adr/ADR-003-sdk-plugin-architecture.md` (ADR decision status unchanged; implementation evidence appended).
- Update `AGENTS.md` and `AURORA_RULES.md` (G06 entry: both leaves closed, completed 60 / remaining 18; queue/transport implemented; no new ADR).
- Update root `README.md` if the real-package list is affected.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/event-entry.ts packages/core/test/event-entry.test.ts packages/browser/src/delivery-transport.ts packages/browser/src/sdk-composition.ts packages/browser/src/index.ts packages/browser/test/delivery-transport.test.ts packages/browser/test/sdk-composition.test.ts docs/sdk/sdk-reliable-delivery-chain.md packages/sdk/README.md packages/browser/README.md packages/core/README.md docs/README.md docs/architecture/sdk-architecture.md docs/architecture/formalization-readiness.md docs/architecture/aurora-v1-remaining-module-batches.md docs/adr/ADR-004-asynchronous-event-processing.md docs/adr/ADR-003-sdk-plugin-architecture.md AGENTS.md AURORA_RULES.md README.md
git commit -m "feat(sdk): G06 SDK reliable delivery chain — core envelope capture + browser composition + transport"
```

---

## === SDK-16 ACCEPTANCE ===

SDK-16 (transport/retry/flush/partial receipt) is independently verified when:

1. `packages/sdk/test/retry-classification.test.ts`, `packages/sdk/test/retry-backoff.test.ts`, `packages/sdk/test/delivery-chain.test.ts` pass.
2. `packages/browser/test/delivery-transport.test.ts` and the composition wiring tests pass (Node, no Chromium).
3. `packages/sdk` + `packages/browser` + `packages/core` typecheck pass.
4. Key behaviors proven: success transport; network/timeout/temp-failure retry; non-retryable rejection does not retry; retry bounded (maxRetries); partial receipt per-event (accepted done / permanent dropped / temporary retried); flush controllable + terminates; page lifecycle best-effort (composition pagehide → `flush({bestEffort:true})`); host app exception safety (transport throw → caught).
5. `git diff --check` clean.

Record: **completed 59 → 60 / remaining 19 → 18.**

---

## G06 Final Reduced Acceptance (run once after both leaves)

Do NOT re-run every leaf's full suite. Run once:

```bash
# 1. affected lint (eslint scoped to changed packages)
pnpm exec eslint packages/sdk/src packages/sdk/test packages/core/src packages/core/test packages/browser/src packages/browser/test

# 2. affected typecheck
pnpm --filter @aurora/sdk typecheck
pnpm --filter @aurora/browser typecheck
pnpm --filter @aurora/core typecheck

# 3. affected SDK unit/integration tests
pnpm --filter @aurora/sdk test
pnpm --filter @aurora/browser test
pnpm --filter @aurora/core test

# 4. affected package-entry/build
pnpm --filter @aurora/sdk test:package
pnpm --filter @aurora/browser test:package
pnpm --filter @aurora/core test:package

# 5. necessary affected coverage (packages with coverage thresholds whose executable source changed)
pnpm --filter @aurora/sdk test:coverage
pnpm --filter @aurora/browser test:coverage
pnpm --filter @aurora/core test:coverage

# 6. focused integration chain (already in delivery-chain.test.ts; re-run as the single chain gate)
pnpm --filter @aurora/sdk test -- test/delivery-chain.test.ts

# 7. git diff check
git diff --check
```

No root `check`, no root `test`, no root `test:coverage`, no PostgreSQL/Redis/platform-api/Console/G11/ingestion/browser-matrix/Playwright-full/benchmark/perf. No Chromium this round (page lifecycle verified through the browser abstraction in Node).

---

## Git / PR

Use clear logical commits (one per Task boundary above). After both leaves pass:

1. Push `feature/g06-sdk-reliable-delivery`.
2. Create a G06 PR (base `main`), enable normal auto-merge if supported.
3. Query remote CI **once**. If `queued` or `in_progress` → output `G06_REMOTE_CI_IN_PROGRESS` and stop. Do not `gh run watch`, poll, re-push, or add empty commits.

Record known baseline debt that does not affect G06 packages as `KNOWN_BASELINE_DEBT` (e.g. platform-api coverage, Preview deployment, Console, Windows local type-resolution) — do not fix in G06.

---

## Conflict Self-Check (before commit)

- G05 config/privacy/sampling still compatible (additive changes only; `SdkConfigSnapshot` untouched).
- `event-schema` wire contract unchanged (only read `BATCH_EVENT_LIMITS`/parsers/`IngestionReceiptState`; no writes).
- Event ID stable across retries (retry re-enqueues the same `EventEnvelope`).
- Queue bounded (`capacity`); overflow explicit (evict lowest-priority / drop incoming).
- Retry bounded (`maxRetries`); no infinite retry; backoff capped.
- Partial receipt cannot duplicate accepted events (accepted/duplicate_accepted removed; only temporarily_failed retried).
- Rejected events never retried (permanently_rejected / 401 / 403 / 400 / 413 / 415 → drop).
- No browser persistence added (in-memory only).
- No sensitive info leaks (diagnostics carry eventId + stable codes only; no body/URL/credentials).
- No plugin-owned transport (single transport owned by the delivery chain).
- No G07 scope (no Vue/React adapters).
- Multi-instance isolated (per-instance closures, no module-level mutable state).
- Host page cannot be broken by transport exceptions (all throws converted to failures).

---

## Final Status Recording

- SDK-15 independent PASS → 59 / 19.
- SDK-16 independent PASS → 60 / 18.
- If remote CI has not finished: `G06 development = completed`, `G06 release = release-pending` (never claim deployed).
- This round does not auto-start G07.
