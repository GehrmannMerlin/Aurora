---
title: Aurora Browser 性能事实观测能力第一增量
status: approved
implementation-status: implemented
owner: sdk
created: 2026-08-01
last-reviewed: 2026-08-01
applies-to: packages/browser 的浏览器性能事实观测、page_load/LCP/CLS/INP 事实投影、订阅/回滚/取消/销毁与 Chromium 验证
related:
  - ../../AGENTS.md
  - ../../AURORA_RULES.md
  - ../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md
  - '../../Aurora 架构规范.md'
  - '../../Aurora 代码规范.md'
  - '../../Aurora 测试规范.md'
  - '../../Aurora 文档规范.md'
  - '../../Aurora ADR 规范.md'
  - ../protocol/performance-event-contract.md
  - browser-environment-foundation.md
  - browser-error-source.md
  - browser-request-source.md
  - ../architecture/sdk-architecture.md
  - ../testing/test-strategy.md
  - ../adr/ADR-003-sdk-plugin-architecture.md
  - ../adr/ADR-005-event-schema-source-of-truth.md
  - ../adr/ADR-006-one-way-dependencies.md
supersedes: none
review-cycle: browser-performance-public-api-or-host-safety-change
---

# Aurora Browser 性能事实观测能力第一增量

## 0. 状态声明

本文冻结 `packages/browser` 的浏览器性能事实观测能力第一增量。本文只从 approved PRD（页面性能 5.1.9）、approved 长期规范、现有 approved 协议/SDK 规格、accepted ADR-003/005/006/007，以及 W3C 性能规范（Largest Contentful Paint、Layout Instability、Event Timing、Navigation Timing）的无歧义派生推导。

- status: `approved`
- implementation-status: `implemented`

**实施证据（2026-08-01）**：本增量已实施为 `@aurora/browser` 的真实能力增量，并通过以下新鲜验证：

- `pnpm --filter @aurora/browser test`：90 个单元测试全部通过（含能力/注册/page_load/LCP/CLS/INP/隔离/多实例）；
- `pnpm --filter @aurora/browser test:coverage`：statements 88.88%、branches 82.2%、functions 93.75%、lines 90.54%（门禁 85/80/85/85）；
- `pnpm --filter @aurora/browser test:package`：构建根入口含 `BrowserPerformanceMetricName`、`BrowserPerformanceMetricUnit`，私有路径 `performance-source`/`performance-source-types` 全部返回 `ERR_PACKAGE_PATH_NOT_EXPORTED`；
- `pnpm --filter @aurora/browser test:browser`：19 个 Chromium 场景全部通过（真实 Navigation Timing/LCP/CLS/INP、页面隐藏收尾、隐私不泄露、多订阅者与多实例隔离，含既有 13 个请求/环境场景回归）；
- 体积近似：`performance-source` 与 `performance-source-types` 拼接 raw 与 gzip 记录于第 20 节，标记 `requires-benchmark`。

## 1. 定位、范围与权威来源

本文冻结 Browser 层的基础页面性能事实观测能力：把浏览器原生性能事件投影为最小、只读、脱敏的 `BrowserPerformanceSourceEvent` 视图，供未来性能采集插件消费。

权威来源：

- `docs/protocol/performance-event-contract.md`（已实施）：性能正文只允许 PRD 5.1.9 批准的四项指标 `lcp`、`inp`、`cls`、`page_load`；指标名/单位/数值限制已冻结；
- 核心业务 PRD 5.1.9：基础页面性能默认开启，采集 LCP、INP、CLS、页面加载耗时，默认采样率 10%（采样属于 SDK 采集层，不在本增量）；
- W3C 规范（作为既定平台语义）：Largest Contentful Paint API、Layout Instability API、Event Timing API、Navigation Timing Level 2；
- `browser-environment-foundation.md`：Browser 环境探测、宿主安全、异常隔离、多实例隔离与订阅结果契约；
- `browser-error-source.md` 与 `browser-request-source.md`：原子订阅、部分失败回滚、幂等取消、统一销毁、有界脱敏诊断与多实例模式；
- ADR-003（SDK 分层插件架构）、ADR-005（event-schema 单一来源）、ADR-006（单向依赖自动约束）。

**指标范围**：本增量只观测 PRD 5.1.9 批准的 `lcp`、`inp`、`cls`、`page_load` 四项。FCP、TTFB、FID、TBT、资源计时、导航分解等未批准指标一律不实现。

**采样边界**：PRD 默认采样率 10% 属于 SDK 配置/采集层，本增量观测**全部**四项事实，不做采样。

## 2. 模块职责与明确非职责

### 2.1 职责

- 在 `@aurora/browser` 中扩展浏览器性能能力探测与 `subscribePerformance(listener)` 订阅；
- 把原生 `PerformanceEntry` 投影为最小、只读、冻结的 `BrowserPerformanceSourceEvent`；
- 实现 `page_load`（Navigation Timing）、`lcp`（Largest Contentful Paint）、`cls`（Layout Instability session window）、`inp`（Event Timing interaction 聚合）四类事实；
- 复用现有 `BrowserSubscription`、`BrowserSubscribeResult`、`BrowserUnsubscribeResult`、`BrowserDestroyResult` 与 `BrowserDiagnostic`；
- 提供原子注册、部分失败回滚、幂等取消、统一销毁与销毁后稳定失败；
- 保证多订阅者与多实例互不交叉，回调异常隔离；
- 使用有界、脱敏的 Browser 诊断，不保留原生 entry、DOM 或事件引用；
- 提供单元、包入口、Workspace Policy、ESLint 与 Chromium 真实浏览器证据。

### 2.2 明确非职责

- 不创建 `packages/plugin-performance`，不实现 Core 草稿提交、事件 ID、事件时间或协议版本；
- 不创建 `EventEnvelope` 或性能事件正文；
- 不实现采样、指标上传、队列、批量、网络传输、重试或持久化；
- 不实现性能聚合、指标统计或问题识别；
- 不实现 FCP、TTFB、FID、TBT、资源计时、请求性能或用户行为指标；
- 不采集 DOM 节点、element、selector、页面文本、用户输入、URL、资源名、Event Timing target；
- 不修改 `PerformanceObserver`、`performance`、原生 prototype 或宿主全局；
- 不清空或消费宿主已有 performance entries，不影响其他库的 PerformanceObserver；
- 不实现 `utils`/`helpers`/`common`/`misc`。

## 3. 支持矩阵与平台语义

| 指标 | entry type 来源 | 单位 | 平台语义权威来源 |
| ---- | --------------- | ---- | ---------------- |
| `page_load` | `navigation`（PerformanceNavigationTiming） | `millisecond` | Navigation Timing Level 2 |
| `lcp` | `largest-contentful-paint` | `millisecond` | Largest Contentful Paint API |
| `cls` | `layout-shift` | `ratio` | Layout Instability API（session window） |
| `inp` | `event` + `first-input` | `millisecond` | Event Timing API（interaction 聚合） |

四项指标全部可通过原生 `PerformanceObserver` 准确实现，**不需要 `web-vitals` 或任何第三方运行时库**。本增量不新增任何运行时依赖。

### 3.1 能力探测

`BrowserCapabilityName` 增加 `PerformanceSource: 'performance_source'`。`canObservePerformance` 为 `true` 当且仅当：`host.performanceTarget` 是对象、`performance.getEntriesByType` 是函数、`performance.getEntries` 是函数、`PerformanceObserver` 是构造器函数。fetch/XHR/错误源能力探测不变。

各指标独立可观测性在订阅时逐项判断：某 entry type 不受支持时该指标不产生事实，不使整体订阅失败（部分可用语义）。

## 4. 公共 TypeScript 契约

本增量只对 `@aurora/browser` 根入口作加法扩展。现有方法、结果码和语义保持不变。常量与类型定义在独立文件 `src/performance-source-types.ts` 中，从包根再导出。

```ts
export const BrowserPerformanceMetricName = Object.freeze({
  Lcp: 'lcp',
  Inp: 'inp',
  Cls: 'cls',
  PageLoad: 'page_load',
} as const);

export type BrowserPerformanceMetricName =
  (typeof BrowserPerformanceMetricName)[keyof typeof BrowserPerformanceMetricName];

export const BrowserPerformanceMetricUnit = Object.freeze({
  Millisecond: 'millisecond',
  Ratio: 'ratio',
} as const);

export type BrowserPerformanceMetricUnit =
  (typeof BrowserPerformanceMetricUnit)[keyof typeof BrowserPerformanceMetricUnit];

export interface BrowserPerformanceSourceEvent {
  readonly metricName: BrowserPerformanceMetricName;
  readonly value: number;
  readonly unit: BrowserPerformanceMetricUnit;
  readonly startedAt: number;
  readonly durationMs?: number;
}

export type BrowserPerformanceSourceListener = (event: BrowserPerformanceSourceEvent) => void;

export interface BrowserCapabilities {
  // 现有字段保持不变
  readonly canObservePerformance: boolean;
}

export interface BrowserEnvironment {
  // 现有方法保持不变
  subscribePerformance(listener: BrowserPerformanceSourceListener): BrowserSubscribeResult;
}
```

同时将 `BrowserCapabilityName` 增加 `PerformanceSource: 'performance_source'`，并将 `BrowserDiagnostic.eventType` 与内部诊断输入的类型扩为 `PageLifecycleEventType | BrowserErrorSourceEventType | BrowserRequestSourceEventType | BrowserPerformanceMetricName`（诊断 eventType 字段复用 `BrowserPerformanceMetricName`，表示来源指标）。

本增量复用现有 `BrowserSubscribeResult`、`BrowserSubscription`、`BrowserUnsubscribeResult` 与 `BrowserDestroyResult`，不新增重复的结果体系。

`BrowserPerformanceSourceEvent` 是同步通知期间的只读投影。Browser 不保留 `PerformanceEntry`、`PerformanceObserverEntryList`、DOM、Event Timing target 或任何嵌套对象引用；回调返回后这些值不再被读取。

事实字段语义：

- `metricName`：四项批准指标之一；
- `value`：`millisecond` 时为非负安全整数毫秒；`ratio` 时为 `0..1` 有限非负 CLS 值；
- `unit`：`millisecond` 或 `ratio`；
- `startedAt`：正安全整数 Unix epoch 毫秒（测量周期开始时间）；
- `durationMs`：可选，非负安全整数毫秒（如 page_load 的加载耗时）。

## 5. page_load 语义

### 5.1 来源与计算

- 来源：`performance.getEntriesByType('navigation')[0]`（PerformanceNavigationTiming）；
- `startedAt`：`entry.startTime` 相对 `performance.timeOrigin` 的绝对 Unix epoch 毫秒（即 `performance.timeOrigin + entry.startTime`，四舍五入到安全整数）；
- 终点：`entry.loadEventEnd`；
- `value`：`Math.round(entry.loadEventEnd - entry.startTime)`，即页面加载耗时毫秒（`durationMs` 与 `value` 相同）。

### 5.2 行为规则

- `getEntriesByType` 缺失、空数组、entry 非对象或数值字段缺失/非有限/非法时**不产生事实**，记录 `property_read_failed` 或 `performance_entry_rejected` 诊断（不记录原始 entry）；
- `loadEventEnd - startTime < 0` 时不产生事实（非法数值），不伪造负值；
- 订阅时若 navigation entry 已存在且页面尚未触发 `load` 事件，`loadEventEnd` 可能为 0：此时**不立即发送**，等待后续事实（本增量对 page_load 采用"订阅时读取已有 entry；loadEventEnd 为 0 时延后"的语义）；
- 重复订阅：每次订阅时重新读取当前 navigation entry，发送一次 page_load 事实（若 loadEventEnd 已合法）；
- bfcache 恢复（`pageshow`，`persisted === true`）：不重复发送 page_load（页面加载耗时只代表首次加载）；
- 不保留原生 entry 引用。

## 6. LCP 语义

### 6.1 来源与计算

- 来源：`PerformanceObserver` 观察 `entryType: 'largest-contentful-paint'`；
- 每次回调中取当前渲染时间（`renderTime`，缺失时用 `loadTime`）与已记录的候选最大值比较，保留最大值；
- `startedAt`：首个候选 entry 的 `startTime` 相对 `timeOrigin` 的绝对毫秒；
- `value`：最终候选的渲染时间毫秒（安全整数）；
- 收尾：`visibilitychange` 到 `hidden`、`pagehide`、销毁或取消时，发送最终候选（若有）；无候选则不发送。

### 6.2 候选更新规则

- 新 entry 的渲染时间必须严格大于当前候选才替换（严格大于，避免零长度震荡）；
- 渲染时间非有限或非正数时忽略该 entry，不发送中间事实；
- LCP 在页面生命周期内可能多次更新候选；本增量在**每个候选更新时不发送**，只在收尾时发送最终值一次（与 Chromium LCP 报告语义一致：最终 LCP 值）；
- 收尾时若有已记录的最终候选，发送一条 `lcp` 事实（`startedAt` 为最终候选的开始时间，`value` 为最终渲染时间）；
- 无任何候选时收尾不发送。

### 6.3 隐私

- 绝不读取或暴露 entry 的 `element`、`url`、`id`、`sizes` 或任何 DOM 关联字段；
- 只读取 `renderTime`、`loadTime`、`startTime`；
- 不保留原始 entry 引用。

### 6.4 unsupported

- `largest-contentful-paint` entry type 不受支持（observer 构造失败或 observe 抛错）时，该指标标记为不支持，不产生 LCP 事实，其他指标继续。

## 7. CLS 语义

### 7.1 来源与计算

- 来源：`PerformanceObserver` 观察 `entryType: 'layout-shift'`；
- **忽略** `hadRecentInput === true` 的 entry（不把用户主动输入引起的偏移计入 CLS）；
- 按 Layout Instability 规范的 session window 算法累加：
  - 首个计入的 shift 开启一个 session；
  - session 内每个计入 shift 的 `value` 累加；
  - 若当前 shift 与 session 内**最后一个**计入 shift 的间隔 ≤ `1 秒`，且 session 总时长 ≤ `5 秒`，则并入当前 session；否则开启新 session；
  - 保留所有已关闭 session 与当前 session 的累加值，CLS 取**所有 session 累加值的最大值**；
- 每个计入的 `value` 为非负有限数值（可能为小数，允许浮点）；负数或非有限值忽略；
- `startedAt`：CLS 观测开始时间（订阅时刻或首个 shift 的时间，取订阅时）；
- `value`：最大 session 累加值（`ratio` 单位）；
- 收尾：`visibilitychange` 到 `hidden`、`pagehide`、销毁或取消时，发送最终 CLS（若有 session）；无任何计入 shift 则不发送。

### 7.2 内存上限

- 只保留**当前 session 累加值 + 已观测的最大 session 值**两个数字，不保留 entry 数组、不保留每 entry 时间戳数组；
- session 判定只需当前 shift 时间与 session 内最后一个 shift 时间，因此只需记录**当前 session 内最后一个计入 shift 的 `startTime` 与当前 session 累加值**两个状态；
- 关闭的 session 只保留其最大值，不累积。

### 7.3 隐私

- 只读取 `value`、`hadRecentInput`、`startTime`；
- 不读取 `sources`（LayoutShiftAttribution 数组）、`elements` 或任何 DOM 关联；
- 不保留原始 entry 引用。

### 7.4 unsupported

- `layout-shift` 不受支持时该指标不产生事实，其他指标继续。

## 8. INP 语义

### 8.1 来源与计算

- 来源：`PerformanceObserver` 观察 `entryType: ['event', 'first-input']`；
- 按 `interactionId` 分组：
  - 每个交互（interaction）由 `interactionId` 标识；
  - 同一 interactionId 的多个 `event` entry 取 `duration` 最大值作为该 interaction 的候选时长；
  - `duration` 必须是非负有限安全整数毫秒（`Math.round`），非法值忽略该 entry；
- 最终 INP 候选：取**当前所有 interaction 候选时长的最大值**（即页面当前观测到的最大交互时长）；
- `startedAt`：INP 观测开始时间；
- `value`：当前最大 interaction 时长毫秒；
- 收尾：`visibilitychange` 到 `hidden`、`pagehide`、销毁或取消时，发送最终 INP（若有 interaction）；无任何 interaction 则不发送。

### 8.2 interactionId 处理

- `interactionId` 缺失、非数字或非法时：若 entry type 为 `first-input`，用该 entry 作为单 interaction 候选；否则忽略该 entry；
- `interactionId` 出现新的合法值时开启新 interaction；
- 同一 interaction 后续 entry 更新该 interaction 的时长上限。

### 8.3 候选集合上限

- 只保留当前最大 interaction 时长 + 一个"当前正在更新的 interaction"的时长，共两个数字状态，不保留 per-interaction 记录数组；
- 由于 INP 最终取最大值，只需保留全局最大值；正在处理的 interaction 只需一个临时最大值；
- 内存有界：不随交互数量增长。

### 8.4 隐私

- 绝不读取 entry 的 `target`、`interactionId` 之外的任何字段，不读取 DOM 节点、`relatedTarget`、`inputType` 之外无需要素；
- 只读取 `duration`、`interactionId`、`startTime`、`entryType`；
- 不保留原始 entry 引用。

### 8.5 unsupported

- `event`/`first-input` entry type 均不受支持时该指标不产生事实，其他指标继续。

## 9. 生命周期

### 9.1 创建

`createBrowserEnvironment()` 仍在调用时捕获宿主引用并形成实例级状态。模块导入时不得读取全局或创建 observer。能力探测同时计算 `canObservePerformance`。

### 9.2 订阅

`subscribePerformance(listener)` 按以下顺序执行：

1. 非函数返回 `invalid_listener`；
2. Browser 实例已销毁返回 `destroyed`；
3. 性能能力缺失（`canObservePerformance === false`）返回 `environment_unavailable`；
4. 在实例级性能观测管理器上登记一个订阅者；首个订阅者安装共享 `PerformanceObserver` 集合；
5. 若 observer 构造或 `observe` 抛错，回滚该订阅者登记与已安装 observer，返回 `listener_registration_failed`；
6. 全部成功返回冻结的 `BrowserSubscription`。

### 9.3 通知

每项指标在收尾（hidden/pagehide/取消/销毁）或订阅时（page_load 已可用）产生一条事实；一次订阅周期内每项指标至多发送一条事实。单个订阅者抛错只追加一条脱敏 `callback_failed / notify` 诊断，不向宿主传播，也不阻止同一实例或其他实例的订阅者收到该指标事实。

### 9.4 取消、停止与销毁

首次 `unsubscribe()` 先逻辑停用该订阅者，再执行该订阅者的指标收尾（发送最终候选，若有）；当订阅者计数归零时对每个已安装 observer 执行 `disconnect()`。重复取消返回 `already_unsubscribed`。

`BrowserEnvironment.destroy()` 释放页面生命周期、错误源、请求观测与性能观测的全部活动订阅，并对性能 observer 执行 `disconnect()`。首次调用返回 `destroyed`，重复调用返回 `already_destroyed`。销毁后残留的原生回调必须成为无副作用空操作。销毁后 `subscribePerformance` 返回 `destroyed`。

本增量不定义独立的插件 `initialize/start/stop/destroy`；这些 Core 生命周期规则对 Browser 前置能力不适用。

## 10. observer 所有权与共享规则

- **每个指标一个独立 `PerformanceObserver`**（page_load 不使用 observer，使用 `getEntriesByType`）；
- **实例级共享**：同一 `createBrowserEnvironment()` 实例内的多个订阅者共享同一组 observer（首个订阅者安装，最后一个订阅者取消时 disconnect）；不同 Browser 实例的 observer 完全独立；
- 不修改 `PerformanceObserver.prototype`、不修改 `performance`、不替换全局 `PerformanceObserver` 构造器；
- 观察 options：`type: <entryType>, buffered: false`（不消费宿主 buffered entries，避免影响其他观察者）；LCP/CLS/INP 三个 observer 分别观察 `largest-contentful-paint`、`layout-shift`、`['event','first-input']`；
- 一个指标 observer 安装失败不影响其他指标（部分可用语义），但该订阅者的该指标标记为不支持；
- 回调异常被同步隔离，不导致 observer 失效；下一个 entry 仍被处理。

## 11. 注册、回滚、取消与销毁

- 登记订阅者时先建立记录（isActive、指标状态），再安装 observer；任一 observer 构造或 observe 抛错时，回滚该订阅者已安装的全部 observer 并返回 `listener_registration_failed`；
- 取消先逻辑停用（阻止后续通知），再收尾发送最终候选，最后在计数归零时 disconnect；
- 销毁执行与取消相同的释放语义，并对所有订阅者执行；
- 销毁后重订阅被拒绝（`destroyed`），残留回调为空操作。

## 12. 多订阅者与多实例

- 实例内多个订阅者共享一组 observer；每个订阅者独立持有活动状态与指标候选状态；
- 一个订阅者取消不移除其他订阅者的通知；
- 不同 Browser 实例各自安装自己的 observer；一个实例销毁不影响其他实例的 observer 与订阅；
- 不使用模块级 `Set`、`Map`、数组或可变对象保存订阅者、observer 或指标状态。

## 13. 宿主安全与性能开销

- 模块导入与工厂创建均不创建 observer；
- 不修改 `PerformanceObserver`、`performance`、原生 prototype 或宿主全局；
- 不影响其他库的 PerformanceObserver（不替换构造器，不消费 buffered entries，observe 只附加本实例需要的 entry type）；
- 不阻止页面事件，不调用 `preventDefault`/`stopPropagation`/`stopImmediatePropagation`；
- 回调处理有界：每指标只做常数级状态更新（最大值/累加值），不执行 DOM 查询、不遍历 entry 列表、不保留数组；
- 内存上限：每订阅者每指标只保留常数个数字状态（见第 6/7/8 节）；不长期积累无限数组或 interaction 记录；
- 单个订阅者回调抛错、单个指标处理抛错均被隔离，不阻止后续事实；
- 生产路径不使用 `console`。

## 14. 隐私与数据最小化

本增量禁止读取、存储、诊断或输出：DOM 节点、element、selector、页面文本、用户输入、URL、资源名、Event Timing target、`sources`（LayoutShiftAttribution）、Cookie、Token、Authorization、Storage、请求/响应数据、原始 `PerformanceEntry`、原始 `PerformanceObserverEntryList`、无限对象图。

每指标只读取批准字段：

| 指标 | 只读字段 |
| ---- | -------- |
| page_load | `startTime`、`loadEventEnd` |
| lcp | `renderTime`、`loadTime`、`startTime` |
| cls | `value`、`hadRecentInput`、`startTime` |
| inp | `duration`、`interactionId`、`startTime`、`entryType` |

诊断不包含原始 entry、指标来源对象或页面数据。

## 15. 错误与诊断

复用现有最大 100 条、实例级、冻结的 `BrowserDiagnostic`。允许的诊断只包含序号、稳定代码、操作、能力与可选指标名：

- 全局或方法 getter 失败：`global_access_failed` / `property_read_failed` / `create` / `performance_source`；
- 能力读取失败：`property_read_failed` / `read_capabilities` / `performance_source`；
- observer 构造失败：`listener_registration_failed` / `subscribe` / `performance_source` / `<metric>`；
- observe 失败：`listener_registration_failed` / `subscribe` / `performance_source` / `<metric>`；
- entry 读取失败：`performance_entry_rejected` / `notify` / `performance_source` / `<metric>`；
- 回调失败：`callback_failed` / `notify` / `performance_source` / `<metric>`；
- 取消失败：`listener_removal_failed` / `unsubscribe|destroy` / `performance_source`。

新增诊断码：`performance_entry_rejected`（entry 字段非法或缺失时记录，不记录 entry 内容）。

## 16. 依赖与禁止依赖

本增量不增加 `@aurora/browser` 的运行时依赖。Browser 继续保持 `aurora.layer: sdk-browser`、单一根出口和 `sideEffects: false`。

自动门禁必须证明：Core、event-schema 和任何现有包均不依赖 Browser 性能观测实现；Browser 不依赖具体插件；不存在循环；不存在跨包 `src`/`internal`/未导出路径；不存在性能协议类型或第二套性能协议；不存在网络、队列或持久化依赖。现有 Workspace Policy 的 `sdk-browser -> sdk-core | protocol` 允许矩阵与 Browser 环境扫描直接覆盖本增量，不需要修改 tooling。ESLint 继续拒绝宿主全局赋值、原型修改与事件控制。

## 17. 包、文件与代码规范

```text
packages/browser/
├── src/
│   ├── capabilities.ts          # Modify：BrowserCapabilityName.PerformanceSource、canObservePerformance
│   ├── browser-environment.ts   # Modify：subscribePerformance
│   ├── diagnostics.ts           # Modify：BrowserDiagnosticEventType 扩展
│   ├── index.ts                 # Modify：导出性能事实常量/类型
│   └── performance-source.ts    # Create：性能事实投影、指标管理器、observer 安装/回滚/取消/销毁
├── test/
│   ├── package-entry.test.ts     # Modify：性能符号与私有路径
│   ├── architecture-boundary.test.ts # Modify：禁止项扩展
│   ├── performance-source.test.ts    # Create：单元测试
│   └── ...
└── test-browser/
    ├── fixture-server.ts         # Modify：性能 fixture 端点与 harness
    └── performance-source.spec.ts# Create：Chromium 场景
```

- TypeScript 使用根 `strict`、`exactOptionalPropertyTypes` 和 `noUncheckedIndexedAccess`；
- 原生入口参数使用 `unknown`，通过 `readProperty`/`readMethod`/`callMethod` 立即收窄；
- 禁止无说明 `any`、`Object`、`Function`、`Record<string, any>`、双重断言、非空断言和错误抑制；
- 公共函数显式声明参数和返回类型；
- 文件名 `kebab-case`，类型/接口 `PascalCase`，函数/变量 `camelCase`，布尔值使用 `is`/`has`/`can`/`should` 前缀；
- `performance-source.ts` 只负责性能事实视图、指标状态机、observer 安装/回滚/取消/销毁；不创建 `utils`/`helpers`/`common`/`misc`；
- 公共 API 只增加本规格列出的类型、常量和一个方法；
- 只复用当前包内已有 `safe-access`、能力探测、诊断和订阅结果契约；
- 错误不静默吞掉，不输出敏感日志，不在生产路径使用 `console`；
- 不设计通用指标系统、采集总线或 Browser 之外的监听体系。

## 18. 测试与覆盖率

覆盖率门槛固定为 lines 85%、branches 80%、functions 85%、statements 85%。不得通过排除逻辑文件、删除失败测试或降低阈值恢复门禁。

### 18.1 能力与注册

- `PerformanceObserver` 不存在、entry type 不支持、observer 构造抛错、observe 抛错、部分注册失败回滚、正常订阅、多订阅者、取消、重复取消、destroy、重复 destroy、destroy 后拒绝订阅。

### 18.2 page_load

- 正常 Navigation Timing、尚未完成 load（`loadEventEnd === 0` 延后）、缺失 navigation entry、非法数值、负 duration、重复订阅、bfcache/pageshow 场景、输入 entry 不被保留。

### 18.3 LCP

- 单候选、多候选取最终值、hidden 收尾、pagehide 收尾、observer disconnect、entry 含 element/url 时不泄露、unsupported。

### 18.4 CLS

- 单次 shift、`hadRecentInput=true` 被忽略、session gap、session window 上限、多 session 取正确值、hidden/pagehide 收尾、浮点边界、不保留 entry。

### 18.5 INP

- 单 interaction、同一 interaction 多 entry、多 interaction、interactionId 缺失/非法、duration 非法、候选集合上限、hidden/pagehide 收尾、不泄露 target、unsupported。

### 18.6 隔离与稳定性

- 一个订阅者回调抛错、一个指标处理抛错、后续事实仍可发送、多实例、一个实例销毁不影响另一个、不修改全局 `PerformanceObserver`、不保留原始对象、有界内存、文档示例可执行。

## 19. Chromium 真实浏览器门禁

Playwright 使用现有版本和单 Chromium 项目。至少验证：

- Browser 包可在 Chromium 加载且导入时不创建 observer；
- Navigation Timing 能生成 `page_load` 事实；
- LCP observer 能产生或正确收尾（用可控渲染内容触发）；
- CLS 可由可控布局变化触发（插入元素改变布局）；
- INP 可由真实交互触发，或在环境能力不足时按规格返回 unsupported；
- 页面隐藏或 pagehide 收尾发送最终候选；
- 取消后不再通知，destroy 后 observer 释放；
- 多订阅者和多实例；
- 回调异常不破坏页面脚本；
- 不暴露 DOM 或原始 entry。

Chromium 测试必须避免任意 sleep；使用事件、条件和明确超时。

## 20. 体积、构建和根任务

包继续使用现有 TypeScript 库构建，不新增 bundler 或发布系统。实施记录 `dist` 中性能观测产物的原始与 gzip 字节数。当前 `tsc` 构建不是最终 bundler/tree-shaking 证据，因此发布前体积结论标记为 `requires-benchmark`；本增量不得为此引入发布系统或 bundler。

## 21. 文档与 ADR

实施完成后必须同步 `packages/browser/README.md`、根 README、正式文档索引、系统/SDK 架构、正式化追踪、`AGENTS.md` 与 `AURORA_RULES.md` 的真实实现状态。

ADR-003 和 ADR-006 只追加 Browser 性能事实观测能力的真实实施证据并保持 `accepted / in-progress`；ADR-005 保持 `accepted / in-progress`（本增量不消费或修改协议）；ADR-007 保持 `accepted / implemented`。计划或规格的存在不改变任何 ADR 状态和实施状态。本增量不需要新 ADR：指标计算语义来自 W3C 标准与 Chromium 平台语义，四项指标均由 approved PRD 批准，共享 observer + 引用计数是 ADR-003 已批准的长期决策，未引入新的高迁移成本长期选择，未增加运行时依赖。

## 22. 后续模块衔接

本增量通过后，独立的性能采集插件规格（`docs/sdk/performance-capture-plugin.md`）可以只从 `@aurora/browser` 根入口消费 `subscribePerformance()`，再经 event-schema 性能契约与 Core 草稿入口完成转换与提交。性能插件仍必须单独解决采样率（PRD 默认 10%）、指标转换与 Core 提交行为；本规格不替它批准这些接口或实现，也不授权在本增量内创建 `packages/plugin-performance`。

## 23. 完成定义

只有当公共契约、四项指标语义、observer 所有权/释放、注册回滚、多订阅者、多实例、单元覆盖率、包入口、Workspace Policy、隐私/内存上限与 Chromium 真实浏览器门禁全部以新鲜输出通过，且文档与 ADR 证据同步，才能把 `implementation-status` 改为 `implemented`。本规格被批准不表示代码已经存在。
