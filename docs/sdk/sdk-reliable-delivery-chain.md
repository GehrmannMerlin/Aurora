---
title: SDK 可靠发送链（SDK-15 内存队列/批次/去重 与 SDK-16 传输/重试/flush/部分回执）
status: approved
implementation-status: implemented
owner: sdk
created: 2026-08-11
last-reviewed: 2026-08-11
applies-to: @aurora/sdk 的有界内存发送队列、批次构造、去重、重试分类、有界退避与交付链；@aurora/browser 的浏览器传输与 composition 接线；@aurora/core 的信封捕获
related:
  - ../../AURORA_RULES.md
  - ../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md
  - '../../Aurora 架构规范.md'
  - '../../Aurora 代码规范.md'
  - '../../Aurora 测试规范.md'
  - '../../Aurora ADR 规范.md'
  - ../architecture/sdk-architecture.md
  - ../adr/ADR-003-sdk-plugin-architecture.md
  - ../adr/ADR-004-asynchronous-event-processing.md
  - ../adr/ADR-005-event-schema-source-of-truth.md
  - ../adr/ADR-009-ingestion-transport-and-client-credential.md
  - ../protocol/event-schema-foundation.md
  - ../protocol/ingestion-batch-and-receipt-contract.md
  - ../security/ingestion-transport-and-client-credential.md
  - ../api/ingestion-openapi.md
  - sdk-public-configuration-context-composition.md
  - sdk-sampling-policy.md
  - safe-activity-trail-and-bounded-buffer.md
  - core-event-creation.md
  - browser-environment-foundation.md
supersedes: none
review-cycle: sdk-public-api-or-delivery-change
---

# SDK 可靠发送链（SDK-15 + SDK-16）

## 1. 定位与批准来源

本文把 G06 叶子 SDK-15「内存队列、批次和去重」与 SDK-16「Transport、重试、flush 和部分回执」正式化为第一增量。它把 approved PRD §6（可靠性规则、简化项、重试原则）、accepted ADR-004（可靠接收与异步处理）、accepted ADR-009（传输与凭证语义）与已实施[批次与接收结果协议](../protocol/ingestion-batch-and-receipt-contract.md)落实为 `@aurora/sdk` 的可靠发送链，并接入 `@aurora/browser` composition。

批准来源：用户 G06 联合分组指令（SDK-15 → SDK-16 两个独立叶子验收），全部队列/传输规则已由 PRD §6、ADR-004、ADR-009 与批次/接收结果协议批准，本增量不创建新 ADR；队列容量、重试次数与退避参数属于普通实施细节。

## 2. 方案与包边界

- `@aurora/sdk`（`aurora.layer: sdk-core`，唯一运行时依赖 `@aurora/event-schema`）承载环境无关的交付链：有界内存队列、批次构造、去重、重试分类、有界退避、交付链编排与有界诊断。
- `@aurora/browser`（`aurora.layer: sdk-browser`）提供浏览器 fetch 传输（`createBrowserBatchTransport`）与 composition 接线（`createAuroraSdk` 把插件 → 控制面 → Core → 交付链串起来，并在 `pagehide` 时 best-effort flush）。
- `@aurora/core` 只做一处最小加法：`CoreEventAccepted` 增加可选 `event?: EventEnvelope`，把 Core 首次创建的信封返回给交付链。这是 PRD §6.1「同一事件重试时编号不变」与 core-event-creation.md §9「重试复用第一次创建的信封及 ID」的唯一实现路径；对既有消费者完全向后兼容，不改变 wire 契约。

## 3. 明确非职责

- 不实现浏览器持久化离线队列（PRD §6.2 明确第一版不做）；
- 不实现 Vue/React 适配（G07）；
- 不创建第二套信封/协议版本（ID/时间/版本由 Core 生成）；
- 不创建插件独立传输（唯一传输由交付链持有）；
- 不做采样外推、限流算法、服务端准入。

## 4. SDK-15：有界内存队列与批次

### 4.1 队列（`createSdkDeliveryQueue`）

```ts
export const DEFAULT_DELIVERY_QUEUE_CAPACITY = 256;

export interface SdkQueuedEvent {
  readonly envelope: EventEnvelope; // Core 创建的信封，eventId 稳定
  readonly attemptCount: number;   // 0 起，重试自增
  readonly enqueuedAt: number;
}

export type SdkEnqueueCode =
  | 'enqueued' | 'duplicate' | 'queue_full' | 'invalid_envelope' | 'destroyed';

export interface SdkEnqueueResult {
  readonly ok: boolean;
  readonly code: SdkEnqueueCode;
  readonly evictedEventId?: string; // 溢出时被逐出的低优先级事件 ID
}

export function createSdkDeliveryQueue(options?: { readonly capacity?: number }): SdkDeliveryQueue;
```

- 容量有界（默认 256，钳制 1..1000），不存在无限内存增长。
- 优先级：`EventType.Error` 高优先级，其余低优先级；`drain(max)` error-first（各桶内 FIFO）。
- 溢出：队列满时，高优先级 error 通过逐出最旧低优先级事件入队（`evictedEventId`），否则拒绝入队（`queue_full`）。落实 PRD §15.2「性能和慢请求数据不能挤占错误事件发送队列」。
- 去重：以 `eventId` 去重，已在队列中的重复 ID 返回 `duplicate` 不入队；去重集合与容量同界。
- `reenqueue`：重试重新入队，保留同一 `EventEnvelope`（eventId 稳定），`attemptCount` 递增。
- 生命周期：`clear` 清空并重置去重；`destroy` 释放并拒绝后续操作。
- 多实例隔离：每次 `createSdkDeliveryQueue` 独立持有桶与去重集合，无模块级可变状态。

### 4.2 批次构造（`buildDeliveryBatch`）

```ts
export function buildDeliveryBatch(
  events: readonly EventEnvelope[],
  receivedAt: number,
): SdkBatchBuildResult; // { ok:true, batch } | { ok:false, code:'empty'|'too_many_events' }
```

- 引用 `BATCH_EVENT_LIMITS.maxEventsPerBatch = 50` 与 `CURRENT_PROTOCOL_VERSION = 1`；
- 空数组 → `empty`；超 50 → `too_many_events`；否则返回冻结的 `IngestionBatchRequest`（`receivedAt` 仅在正安全整数时带上）。

## 5. SDK-16：传输、重试、flush 与部分回执

### 5.1 传输端口（`SdkBatchTransport`）

```ts
export interface SdkTransportContext {
  readonly mode: SdkTransportMode;      // 'normal' | 'best_effort'
  readonly headers: Readonly<Record<string, string>>; // X-Aurora-Client-Key / X-Aurora-Environment / Content-Type
}
export type SdkTransportResult =
  | { kind: 'success'; status: number; receipt: IngestionRequestReceipt }
  | { kind: 'transport_failure'; reason: 'network' | 'timeout'; retryAfterMs?: number }
  | { kind: 'http_error'; status: number; retryAfterMs?: number; receipt?: IngestionRequestReceipt };
export function createBrowserBatchTransport(options: {
  readonly ingestEndpoint: string;
  readonly fetchImpl?: typeof fetch;
}): SdkBatchTransport;
```

- 浏览器传输发送 `POST {endpoint}/v1/batches`，使用交付链提供的 Header；`best_effort` 模式启用 `keepalive`（页面退出）。
- HTTP/网络结果稳定映射为 `SdkTransportResult`；永不抛出。无 endpoint 时返回 `{ kind:'http_error', status:0 }`（永久配置问题，不重试）。

### 5.2 重试分类（PRD §6.3 + Batch/Receipt §6.3/6.4）

```ts
export function classifySdkHttpStatus(status: number, retryAfterMs?: number): SdkRetryDecision;
export function classifySdkReceiptState(state: IngestionReceiptState, retryAfterMs?: number): SdkRetryDecision;
export function classifySdkTransportReason(reason: 'network' | 'timeout', retryAfterMs?: number): SdkRetryDecision;
```

- 可重试：网络失败、超时（408）、429（尊重 `retryAfterMs`）、500/502/503/504、receipt `temporarily_failed`。
- 不重试：400/401/403/413/415/0（无效载荷/密钥/来源/环境/体积/未配置）、receipt `permanently_rejected`；`accepted`/`duplicate_accepted` 为终态成功。

### 5.3 有界退避（`calculateSdkRetryDelay`）

capped exponential backoff + equal jitter（`base * 2^attempt` 封顶 `maxDelayMs`）；服务端 `retryAfterMs` 直接采用但同样封顶。重试有上限（默认 `maxRetries = 3`）。

### 5.4 交付链（`createSdkDeliveryChain`）

```ts
export function createSdkDeliveryChain(
  identity: { clientKey: string; environment: string | null },
  options: SdkDeliveryChainOptions, // transport + schedule（必填）+ 有界参数
): SdkDeliveryChain; // { size, enqueue, flush({bestEffort}), destroy, getDiagnostics }
```

- `enqueue` 入队；`flush` 强制排空并返回计数（`sentBatches`/`eventsSent`/`eventsDropped`/`eventsPending`），可控且可结束。
- 发送批次后按 `perEventResults` 逐事件处理：`accepted`/`duplicate_accepted` 完成移除；`permanently_rejected` 丢弃不重试；`temporarily_failed` 在 `attemptCount < maxRetries` 时重试（尊重退避），否则丢弃。**单条失败不使整批失败**；**accepted/rejected 绝不混淆**。
- 请求级 `http_error` 永久拒绝（400/401/403/413/415/0）丢弃整批；可重试（429/5xx）整批重试。
- `flush({ bestEffort:true })`：页面退出路径，只发一次、不重试，配合 keepalive 传输尽力发送高价值错误。
- 宿主安全：transport/schedule/queue 异常全部捕获并转为稳定结果与诊断，绝不向宿主抛异常。
- 有界诊断（默认 100 条）只记录稳定 code、eventId、attemptCount、status，不含正文/URL/凭据。
- 多实例隔离：每次 `createSdkDeliveryChain` 独立持有队列、计数器与诊断。

### 5.5 composition（`@aurora/browser`）

`createAuroraSdk` 新增可选 `ingestEndpoint`/`transport`；句柄新增 `delivery`。包装插件的 `submitEvent` 在 Core 接受后把信封入队并触发 flush；`pagehide` 订阅触发 `flush({bestEffort:true})`；`destroy` 取消生命周期订阅并销毁交付链。默认浏览器传输在未配置 endpoint 时安全拒发（status 0 永久丢弃），不影响宿主。

## 6. 测试与门禁

- 队列：容量、溢出（逐低优先级/拒入队）、去重、重试 ID 稳定、clear/destroy、多实例隔离。
- 批次：合法/空/超上限、冻结输出。
- 重试分类：HTTP/receipt/传输原因映射、`retryAfterMs` 传递。
- 退避：封顶、jitter 有界、服务端 `retryAfterMs` 优先。
- 交付链：成功发送、网络失败有界重试、永久拒绝不重试、partial receipt 逐事件、flush 终止、best-effort 一次、transport 异常不逃逸、destroy、多实例隔离。
- 浏览器传输：mock fetch——URL/Header、429→Retry-After、网络失败→transport_failure、keepalive、无 endpoint 拒发。
- composition：接受事件流入交付链、`delivery` 暴露与销毁、pagehide best-effort。
- 覆盖率：`@aurora/sdk`/`@aurora/browser`/`@aurora/core` 行 ≥85%、分支 ≥80%、函数 ≥85%、语句 ≥85%。
- 无真实浏览器/外网依赖；page 生命周期经浏览器抽象在 Node 验证。

## 7. 文档与 ADR 同步

- `packages/sdk/README.md`、`packages/browser/README.md`、`packages/core/README.md` 记录新公共入口；
- `docs/README.md` 索引本文；
- `docs/architecture/sdk-architecture.md` 把队列/传输从未实现更新为已实现；
- `docs/architecture/formalization-readiness.md`、`docs/architecture/aurora-v1-remaining-module-batches.md` 更新 SDK-15/16 状态与计数；
- `docs/adr/ADR-004-asynchronous-event-processing.md`、`docs/adr/ADR-003-sdk-plugin-architecture.md` 只追加 G06 SDK 发送链实施证据，ADR 决策状态不变；
- `AGENTS.md`/`AURORA_RULES.md` 同步 G06 状态（SDK-15/SDK-16 关闭，`completed` 58→60 / `remaining` 20→18）。

## 8. 明确排除范围

- 浏览器持久化离线队列（PRD §6.2 deferred）；
- 框架适配（G07）、行为插件、通用资源事件；
- 服务端限流/采样外推/额度；
- Source Map、请求/响应正文采集；
- 第二套信封、插件独立传输。
