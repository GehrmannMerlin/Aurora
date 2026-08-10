---
title: SDK 采样策略（SDK-13 第一增量）
status: approved
owner: sdk
created: 2026-08-10
last-reviewed: 2026-08-10
applies-to: @aurora/sdk 的确定性采样决策模块与控制面采样阶段
related:
  - ../../AURORA_RULES.md
  - ../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md
  - '../../Aurora 架构规范.md'
  - '../../Aurora 代码规范.md'
  - '../../Aurora 测试规范.md'
  - '../../Aurora ADR 规范.md'
  - ../architecture/sdk-architecture.md
  - ../adr/ADR-003-sdk-plugin-architecture.md
  - ../protocol/event-schema-foundation.md
  - sdk-public-configuration-context-composition.md
  - request-allowlist-path-normalization-classification.md
  - unified-privacy-filtering-and-beforesend.md
supersedes: none
review-cycle: sdk-public-api-or-sampling-change
---

# SDK 采样策略（SDK-13 第一增量）

## 1. 定位与批准来源

本文把 G05 叶子 SDK-13「客户端采样策略」正式化为第一增量。它把 approved PRD §5.1.14、§15.1—15.2、§15.7 的采样规则落实为 `@aurora/sdk` 的**确定性**采样决策。

批准来源：G05_APPROVAL_PACKAGE 缺口 5，用户 2026-08-10 批准全部推荐方案。采样只决定是否保留一条完整事件；**不进行任何采样外推**。

## 2. 默认采样率（PRD §15.2）

| 数据类型 | 默认采样率 |
|---|---:|
| 错误、请求网络失败、429、5xx | 1.0（100%） |
| 慢请求 | 0.2（20%） |
| 页面性能 | 0.1（10%） |

规则（PRD §15.2）：

- 采样决定是否发送某条完整数据；
- 错误总量只能基于实际收到的数据估算，页面需说明采样影响（服务端/平台侧）；
- 开发者主动上报的严重错误默认不采样（`errors` 默认 1.0）；
- 性能和慢请求数据不能挤占错误事件发送队列（队列为 G06，采样阶段只保证 error 优先保留）；
- 采样率必须限制在 0 至 1；
- 无效采样配置回退到安全默认值；
- 第一版不建设动态采样规则编辑器。

## 3. 确定性算法

采用基于事件标识的确定性采样，保证**同一事件在重试/重复处理时采样判定一致**：

```ts
export function decideSdkSample(
  eventId: string,
  rate: number,
  hash: SdkHashInput,                    // 注入的确定性哈希函数（默认 FNV-1a 64 位，可测试注入）
): boolean;                              // true = 保留，false = 丢弃
```

- `rate <= 0` → 恒 false；`rate >= 1` → 恒 true；
- `rate` 在 (0,1)：`hash(eventId) / 2^64 < rate` 则保留；
- `eventId` 为空或不可哈希 → 按 `rate < 1` 时的安全默认（丢弃）并记录 fix；
- 哈希函数确定性、无外部状态、不依赖时间与随机数，保证多实例与重试一致性。

## 4. 公共 TypeScript 契约（`@aurora/sdk`）

```ts
export type SdkEventClass = 'error' | 'slow' | 'performance' | 'other';

export interface SdkSamplingContext {
  readonly eventId: string;                 // 事件稳定标识（草稿阶段使用 Core 事件 ID Provider 输出或草稿 eventId）
  readonly class: SdkEventClass;            // 由请求分类（SDK-11）或事件类型推导
  readonly rateOverride?: number;           // 可选按事件覆盖采样率
}

export interface SdkSamplingDecision {
  readonly sampled: boolean;                // true = 保留
  readonly rate: number;                    // 实际采用的采样率
}

export function decideEventSample(
  event: SdkEventDraft,
  config: SdkConfigSnapshot,
  context: SdkSamplingContext,
  hash?: SdkHashInput,
): SdkSamplingDecision;
```

- 事件类别映射：
  - `EventType.Error` → `error`，使用 `sampleRates.errors`；
  - `EventType.Request` → 按请求分类结果：`class==='error'` 用 `sampleRates.errors`（PRD：网络失败/429/5xx 100% 默认），否则 `class==='slow'` 用 `sampleRates.slowRequests`，否则 `other`（normal 请求默认 1.0，不采样）；normal 请求不采样是因为普通成功请求不生成事件（SDK-11 分类已排除），防御性按 1.0；
  - `EventType.Performance` → `performance`，使用 `sampleRates.performance`；
  - 其他事件类型 → `other`，使用 1.0（保留）。
- `rateOverride` 覆盖对应事件类别采样率；非法（非 0..1）忽略。
- 采样**不使用**、不产生任何外推系数；被采样丢弃的事件不进入后续队列（G06），不产生 trace 或推算统计。

## 5. 控制面集成

`SdkControlPlane.processEvent` 在 beforeSend 之后、请求分类之后执行采样：`sampled === false` → `SdkDroppedEvent { code:'sampled_out' }`；`sampled === true` → `SdkProcessedEvent { sampledOut:false }` 继续提交 Core。

请求分类结果（SDK-11）已保证：error（网络失败/429/5xx/扩展状态码）优先按 100% 保留；slow 按慢请求采样率；性能按性能采样率。

## 6. 测试与门禁

- 采样：rate 0/1 边界、0..1 内确定性（同一 eventId 多次判定一致）、不同 eventId 分布、`rateOverride`、非法 rate 回退、eventId 缺失安全默认；
- 类别映射：error/slow/performance/other 各自使用对应采样率；
- 集成：beforeSend → 采样顺序、sampled_out 丢弃码、保留事件继续提交；
- 多实例：两个控制面各自独立判定、无共享状态；
- 包入口、无 DOM 编译、覆盖率门槛（行 85/分支 80/函数 85/语句 85）；
- 既有 `@aurora/event-schema`/`@aurora/core`/插件测试无回归。

## 7. 文档与 ADR 同步

- `packages/sdk/README.md`：记录采样公共入口、默认值表、确定性算法、无外推保证；
- `docs/README.md`：索引本规格；
- `docs/architecture/sdk-architecture.md`：把采样从未实现更新为 SDK-13 已实现；
- ADR-003：追加 SDK-13 实施证据，保持 `in-progress`；
- `AGENTS.md`/`AURORA_RULES.md`：同步 G05 状态（SDK-13 关闭后计数）。

## 8. deferred 与边界

- 采样外推（用量/容量估算）不实现（PRD §15.2，服务端/平台侧）；
- 「问题再次出现的事件优先保留」依赖服务端问题状态，**deferred 到服务端优先级**（SDK 只做概率采样）；
- 服务端限流/降级优先级（PRD §15.5）归服务端，不在 SDK；
- 队列/传输（G06）不提前实现。
