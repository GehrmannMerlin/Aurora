---
title: Browser 性能采集插件第一增量
status: approved
implementation-status: implemented
owner: sdk
created: 2026-08-01
last-reviewed: 2026-08-01
applies-to:
  - packages/plugin-performance
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
  - browser-performance-source.md
  - core-event-creation.md
  - sdk-core-foundation.md
  - error-capture-plugin.md
  - request-capture-plugin.md
  - ../architecture/sdk-architecture.md
  - ../testing/test-strategy.md
  - ../adr/ADR-003-sdk-plugin-architecture.md
  - ../adr/ADR-005-event-schema-source-of-truth.md
  - ../adr/ADR-006-one-way-dependencies.md
supersedes: none
review-cycle: performance-plugin-public-api-or-host-safety-change
---

# Browser 性能采集插件第一增量

## 0. 状态声明

本文冻结 `packages/plugin-performance` 的浏览器性能采集插件第一增量。本插件把 Browser 性能事实观测能力（`subscribePerformance`）产生的四项批准性能事实，经 event-schema 性能正文解析器校验后，通过 Core 插件上下文提交最小事件草稿。

- status: `approved`
- implementation-status: `implemented`

**实施证据（2026-08-01）**：本增量已实施为真实私有包 `@aurora/plugin-performance`，并通过以下新鲜验证：

- `pnpm --filter @aurora/plugin-performance test`：6 个测试文件、27 个测试全部通过（含生命周期、四项转换、提交、防重入、多实例、文档契约）；
- `pnpm --filter @aurora/plugin-performance test:coverage`：statements 93.1%、branches 93.18%、functions 100%、lines 93.82%（门禁 85/80/85/85）；
- `pnpm --filter @aurora/plugin-performance test:package`：构建根入口只暴露 `PERFORMANCE_CAPTURE_PLUGIN_NAME`、`PerformanceCaptureDiagnosticCode`、`PerformanceCaptureDiagnosticOperation`、`createPerformanceCapturePlugin` 四个运行时值，私有路径全部返回 `ERR_PACKAGE_PATH_NOT_EXPORTED`；
- `pnpm --filter @aurora/plugin-performance test:browser`：Playwright 7 个 Chromium 场景全部通过（page_load/LCP/CLS/INP 提交、每事实一次、stop 后不提交、三插件共存、隐私不泄露）；
- `pnpm --filter @aurora/plugin-performance typecheck`（含 `tsconfig.no-dom.json`）与根 `pnpm check:boundaries` 均无诊断；
- 体积近似：dist 运行时 JS 原始与 gzip 记录于第 17 节，标记 `requires-benchmark`。

本插件不执行任何采样（PRD 默认 10% 采样率的算法未在 approved 文档定义，按用户指令留待独立规格）。

## 1. 定位、范围与权威来源

本插件是 Aurora SDK 性能监控链路的最后一段：Browser 已观测四项性能事实（`lcp`、`inp`、`cls`、`page_load`），event-schema 已定义性能正文与解析器，Core 已提供草稿提交入口。本插件将三者组合为可独立启停、不破坏宿主、不旁路 Core 的具体插件。

权威来源：

- `docs/protocol/performance-event-contract.md`（已实施）：性能正文六字段允许列表、四个批准指标名、两个单位、`parsePerformanceEventBody`/`parsePerformanceEventEnvelope`；
- `docs/sdk/browser-performance-source.md`（已实施）：`BrowserPerformanceSourceEvent`（`metricName`/`value`/`unit`/`startedAt`/可选 `durationMs`）、`subscribePerformance`、四项指标最终事实语义；
- `docs/sdk/core-event-creation.md`（已实施）：`CorePluginContext.submitEvent({ eventType, body })` 最小草稿、Core 生成事件 ID/事件时间/协议版本；
- `docs/sdk/sdk-core-foundation.md`（已实施）：`CorePlugin` 生命周期、异常隔离、插件上下文最小化；
- `docs/sdk/error-capture-plugin.md` 与 `docs/sdk/request-capture-plugin.md`：生命周期、诊断、资源所有权与宿主安全模式参考；
- 核心业务 PRD 5.1.9：基础页面性能默认开启，采集 LCP、INP、CLS、页面加载耗时，默认采样率 10%；
- ADR-003（SDK 分层插件架构）、ADR-005（event-schema 单一来源）、ADR-006（单向依赖自动约束）。

**指标范围**：本插件只处理 PRD 5.1.9 批准的四项指标 `lcp`、`inp`、`cls`、`page_load`。FCP、TTFB、FID、TBT 等未批准指标一律不处理。

**采样边界**：PRD 5.1.9 批准默认采样率 10%，但采样算法、采样发生位置、确定性/随机性、配置来源和更新方式均未在 approved 文档中定义。按用户指令，**本插件第一增量不执行任何采样**：Browser 每产生一个已完成性能事实，插件最多提交一个对应草稿。采样作为独立后续能力记录，不因缺少采样而阻塞当前纯转换和提交插件。不使用 `Math.random()` 或任何私有概率配置。

## 2. 模块职责与明确非职责

### 2.1 职责

- 提供私有包 `@aurora/plugin-performance` 和唯一根公开出口；
- 实现固定名称的 `CorePlugin`；
- 通过 `@aurora/browser` 根入口 `subscribePerformance` 订阅四项性能事实；
- 接收 `BrowserPerformanceSourceEvent` 性能事实；
- 把 Browser 性能事实映射为 `PerformanceEventBody` 候选（metricName/unit/value/startedAt/durationMs 直通映射，不重新计算指标）；
- 使用 `@aurora/event-schema` 根入口的常量、限制、类型和 `parsePerformanceEventBody()`；
- 使用 Core 插件上下文提交最小草稿，不生成事件 ID、事件时间或协议版本；
- 定义同步、幂等且可释放的 `initialize`/`start`/`stop`/`destroy` 生命周期；
- 处理 Browser 原子订阅失败、取消诊断、单次转换失败和 Core 提交失败；
- 通过实例级重入门禁阻止插件处理路径形成同步递归；
- 不保留 Browser 性能事实或任何原生引用；
- 提供固定容量、冻结、脱敏的插件诊断；
- 证明多实例、与 plugin-error/plugin-request 共存、宿主不受影响、输入不可变和订阅完整释放；
- 提供单元、包入口、依赖负例和 Chromium 真实浏览器证据；
- 同步 README、正式文档和现有 ADR 的真实实施证据（仅在批准并实施后）。

### 2.2 明确非职责

- 不实现采样、采样配置、性能聚合、指标去重、批次合并、传输、队列、批量、重试或持久化；
- 不实现新性能指标或 FCP/TTFB/FID/TBT 等未批准指标；
- 不重新实现 Browser 性能观测逻辑、`PerformanceObserver` 或指标计算（session window、interaction 聚合、LCP 候选选择）；
- 不实现行为/资源插件、框架适配、React/Vue；
- 不访问 Core/Browser/event-schema 的私有状态或诊断；
- 不调用 `BrowserEnvironment.destroy()`，不拥有整个 BrowserEnvironment；
- 不创建第二套 `EventEnvelope`、协议版本或系统字段；
- 不建立发送器、队列或通用事件总线；
- 不实现服务端、数据库、平台、CI、发布、容器、IaC 或云资源；
- 不创建 `utils`/`helpers`/`common`/`misc`。

本插件不修改 Core、Browser 或 event-schema 的公共接口。

## 3. 前置依赖

| 前置 | 状态 | 本插件消费方式 |
| ---- | ---- | -------------- |
| `@aurora/browser` 性能事实观测能力 | 已实施 | `subscribePerformance(listener)`、`BrowserPerformanceSourceEvent`、`BrowserSubscription` |
| `@aurora/event-schema` 性能事件契约 | 已实施 | `PerformanceMetricName`/`Unit`/`PERFORMANCE_EVENT_LIMITS`/`parsePerformanceEventBody`/`EventType` |
| `@aurora/core` 插件生命周期与草稿提交 | 已实施 | `CorePlugin`、`CorePluginContext.submitEvent`、`CoreEventDraftResult` |

## 4. 公共 TypeScript 契约

以下符号全部从 `@aurora/plugin-performance` 根入口导出。包不提供第二个子路径出口。

```ts
import type {
  BrowserEnvironment,
  BrowserPerformanceMetricName,
  BrowserPerformanceSourceEvent,
} from '@aurora/browser';
import type { CorePlugin, CorePluginContext } from '@aurora/core';

export const PERFORMANCE_CAPTURE_PLUGIN_NAME = 'performance-capture' as const;

export const PerformanceCaptureDiagnosticCode = Object.freeze({
  InvalidLifecycleCall: 'invalid_lifecycle_call',
  InvalidPluginContext: 'invalid_plugin_context',
  BrowserSubscriptionFailed: 'browser_subscription_failed',
  BrowserUnsubscribeFailed: 'browser_unsubscribe_failed',
  PerformanceFactInvalid: 'performance_fact_invalid',
  PerformanceSchemaRejected: 'performance_schema_rejected',
  EventSubmissionFailed: 'event_submission_failed',
  RecursiveCaptureBlocked: 'recursive_capture_blocked',
  InternalError: 'internal_error',
} as const);

export type PerformanceCaptureDiagnosticCode =
  (typeof PerformanceCaptureDiagnosticCode)[keyof typeof PerformanceCaptureDiagnosticCode];

export const PerformanceCaptureDiagnosticOperation = Object.freeze({
  Initialize: 'initialize',
  Start: 'start',
  Stop: 'stop',
  Destroy: 'destroy',
  Convert: 'convert',
  Submit: 'submit',
  Notify: 'notify',
} as const);

export type PerformanceCaptureDiagnosticOperation =
  (typeof PerformanceCaptureDiagnosticOperation)[keyof typeof PerformanceCaptureDiagnosticOperation];

export interface PerformanceCaptureDiagnostic {
  readonly sequence: number;
  readonly code: PerformanceCaptureDiagnosticCode;
  readonly operation: PerformanceCaptureDiagnosticOperation;
  readonly metricName?: BrowserPerformanceMetricName;
}

export interface PerformanceCapturePlugin extends CorePlugin {
  readonly name: typeof PERFORMANCE_CAPTURE_PLUGIN_NAME;
  initialize(context: CorePluginContext): void;
  start(): void;
  stop(): void;
  destroy(): void;
  getDiagnostics(): readonly PerformanceCaptureDiagnostic[];
}

export function createPerformanceCapturePlugin(browser: BrowserEnvironment): PerformanceCapturePlugin;
```

`createPerformanceCapturePlugin()` 是同步且无副作用导入后的显式工厂。正常的精确类型调用不抛出；实现对运行时恶意 getter 做防御性读取，即使 JavaScript 调用方绕过类型传入异常对象，也返回一个可诊断为 Browser 不可用的插件实例，不把异常抛给宿主。

不公开转换函数、诊断存储、订阅端口或内部生命周期状态。

## 5. BrowserEnvironment 所有权

传入的 `BrowserEnvironment` 由调用方拥有。插件可以保存该公开环境对象并在 `start()` 时调用其公开 `subscribePerformance` 方法，但不得：

- 调用 `browser.destroy()`；
- 读取 Browser 私有状态；
- 从 Browser 诊断中复制异常内容；
- 移除其他订阅（包括 plugin-error、plugin-request 或其他性能订阅者）；
- 在模块导入或插件创建时订阅。

插件只拥有 `start()` 成功返回的 `BrowserSubscription`。停止或销毁时先把本实例标记为不再接收事件，再调用该订阅的 `unsubscribe()`，随后清除引用。Browser 的原子注册与回滚仍是唯一监听器实现。

## 6. 精确生命周期

所有插件钩子为同步 `void`，符合 Core 允许的 `void | Promise<void>` 上界。

### 6.1 initialize

- 第一次收到合法 `CorePluginContext` 时安全快照其 `submitEvent` 方法，并进入 initialized；
- 重复初始化为幂等空操作，不替换第一次成功快照；
- 非法上下文记录 `invalid_plugin_context / initialize`，保持未初始化；
- 销毁后初始化记录 `invalid_lifecycle_call / initialize`，不得恢复；
- 初始化不订阅、不提交事件。

### 6.2 start

- 未初始化或已销毁时记录 `invalid_lifecycle_call / start`，不订阅；
- 已有活动订阅时为幂等空操作；
- **先启用事件接收（`isAcceptingEvents = true`），再调用 Browser 根公开接口 `subscribePerformance` 订阅**——因为性能源在订阅返回前同步发送 `page_load` 事实，若接收标志在订阅后设置会丢失该事实；订阅失败时回退接收标志为 false；
- 订阅失败时 Browser 已负责部分注册回滚；插件记录 `browser_subscription_failed / start` 并保持未启动；
- 订阅成功后保存唯一 `BrowserSubscription` 并开始接收事件；
- Browser 订阅的预期失败不抛出，因此不会错误地使 Core 永久隔离插件；下一轮 Core `stop()`/`start()` 可以重试。

### 6.3 stop

- 未启动时为幂等空操作；
- 先逻辑停用并清除活动订阅引用，再调用 `unsubscribe()`；
- `unsubscribe()` 返回 `diagnosticsAdded > 0` 表示物理移除存在 Browser 诊断，插件追加 `browser_unsubscribe_failed / stop`；
- `unsubscribe()` 的意外抛出被捕获并转换为同一插件诊断；
- 停止后残留的宿主回调不能提交事件；
- 停止后可以再次 `start()`，重新获得新订阅。

### 6.4 destroy

- 首次销毁执行与 stop 相同的释放语义，随后清除 Core 提交方法并永久标记 destroyed；
- 从未初始化或未启动状态销毁同样成功；
- 重复销毁为幂等空操作；
- 销毁后 `initialize`/`start` 不会恢复插件，任何残留回调均为空操作；
- Core 从 started 销毁时会先调用 stop 再调用 destroy，插件必须允许这两个调用连续发生且只取消一次。

## 7. Browser 性能事实到协议正文的映射

全部转换都发生在 Browser Listener 的同步调用栈内。插件从不保存 `BrowserPerformanceSourceEvent`。

### 7.1 四指标直通映射

Browser 性能事实与 event-schema 性能正文的字段语义一一对应（Browser 已完成最终指标计算），插件只做字段直通映射：

| Browser 事实字段 | event-schema 正文候选字段 | 映射规则 |
| ---------------- | ------------------------- | -------- |
| `metricName`     | `metricName`              | Browser 四值（`lcp`/`inp`/`cls`/`page_load`）与协议四值语义完全一致，直通；`metricCategory` 固定为 `page` |
| `value`          | `value`                   | 直通，不重新计算 |
| `unit`           | `unit`                    | Browser `millisecond`/`ratio` 与协议两单位一致，直通 |
| `startedAt`      | `startedAt`               | 直通 |
| `durationMs`     | `durationMs`（可选）      | 存在时直通，缺失时省略 |

候选构造：

```ts
const candidate: unknown = {
  metricCategory: PerformanceMetricCategory.Page,
  metricName: event.metricName,
  value: event.value,
  unit: event.unit,
  startedAt: event.startedAt,
  ...(event.durationMs === undefined ? {} : { durationMs: event.durationMs }),
};
```

### 7.2 非法事实处理

- Browser 性能事实的字段类型由 `BrowserPerformanceSourceEvent` 保证，但插件对防御性输入仍做最小检查：`metricName` 必须是 `lcp`/`inp`/`cls`/`page_load` 之一，`unit` 必须是 `millisecond`/`ratio` 之一，`value`/`startedAt` 必须是有限数值，`durationMs`（若存在）必须是有限数值；不匹配时记录 `performance_fact_invalid / convert`，不提交；
- `NaN`、`Infinity`、负数值、越界 CLS（`> 1`）、缺失必填字段等，最终由 `parsePerformanceEventBody` 以 `invalid_number` 等稳定 code 拒绝，插件记录 `performance_schema_rejected / convert`，不提交；
- 两类失败通过转换器返回类型区分（`performance_fact_invalid` 与解析器 issue 拒绝），handler 据此记录不同诊断；
- 非法事实安全失败并形成有界诊断，不产生近似指标。

### 7.3 转换不变性

- 不修改 Browser 性能事实；
- 不重新计算指标（不重新执行 session window、interaction 聚合、LCP 候选选择）；
- 不包含 DOM、URL、页面文本、用户输入或原始 `PerformanceEntry`；
- 使用 `parsePerformanceEventBody` 作为最终正文边界；
- 只提交 `eventType` + `body` 等 Core 允许的最小草稿；
- 不提交 ID、事件时间或协议版本；
- 每个 Browser 性能事实最多提交一次。

## 8. 协议校验与 Core 提交

每个候选正文固定执行：

```ts
const parsed = parsePerformanceEventBody(candidate);
if (parsed.success) {
  context.submitEvent({
    eventType: EventType.Performance,
    body: parsed.data,
  });
}
```

- 插件不创建、导入或缓存 `EventEnvelope`；
- 插件不读取 `CURRENT_PROTOCOL_VERSION`；
- 插件不生成事件 ID 或事件时间；
- 插件不能向草稿加入 `protocolVersion`、`eventId` 或 `occurredAt`；
- 解析失败记录 `performance_schema_rejected / convert`，诊断不复制 issue、路径、消息或输入；
- 转换失败（`performance_fact_invalid`）记录对应诊断，不提交事件；
- Core 返回 `ok: false` 时记录 `event_submission_failed / submit`；
- Core 返回 `accepted` 只表示草稿已由 Core 创建为合法信封并通过现有入口，不表示排队、发送或持久化；
- 单次解析、转换或提交失败不会停止订阅，也不会阻止下一性能事实。

## 9. 失败与诊断

每实例最多保留最新 100 条 `PerformanceCaptureDiagnostic`。`sequence` 从 1 独立递增。`getDiagnostics()` 返回冻结的新数组，条目冻结且不能反向修改内部状态。

诊断只包含：

- 递增序号；
- 稳定 code；
- 稳定 operation；
- 可选的 Browser 性能指标名（`lcp`/`inp`/`cls`/`page_load`）。

诊断禁止包含性能正文、原始 Browser 性能事实、异常对象、异常消息、堆栈、Core 结果详情、DOM、entry、URL、Cookie、Token、Authorization、Storage、页面文本或用户输入。生产代码不使用 `console`。预期的重复 start/stop/destroy 不增加诊断；非法生命周期调用、实际失败和递归阻断必须可见。

稳定诊断码：

- `invalid_lifecycle_call`：非法生命周期调用；
- `invalid_plugin_context`：上下文缺少 `submitEvent`；
- `browser_subscription_failed`：订阅失败；
- `browser_unsubscribe_failed`：取消释放失败；
- `performance_fact_invalid`：Browser 事实字段非法；
- `performance_schema_rejected`：`parsePerformanceEventBody` 拒绝；
- `event_submission_failed`：Core 提交失败；
- `recursive_capture_blocked`：同步重入阻断；
- `internal_error`：未分类内部异常。

## 10. 防重入

每个插件实例拥有独立的 `isHandlingFact` 布尔状态。Listener 处理顺序固定为：

1. 检查插件仍活动（`isAcceptingEvents`）；
2. 若 `isHandlingFact` 已为 true，记录 `recursive_capture_blocked / notify` 并返回（嵌套事实直接丢弃，不排队）；
3. 设为 true；
4. 转换、解析和提交；
5. 捕获所有意外异常，记录 `internal_error`；
6. 在 `finally` 中恢复 false。

本插件自身不发起网络请求，因此不产生自递归网络链路；该门禁是防御性宿主保护，防止恶意 getter/Proxy 造成的同步重入。防重入语义与 plugin-error/plugin-request 现有模式一致（实例级布尔、不建立队列、处理结束或抛错均可靠释放）。所有内部错误都在 Browser Listener 返回前被捕获，不向宿主传播。

## 11. 多实例与插件共存

每次 `createPerformanceCapturePlugin()` 拥有独立的：

- 生命周期状态；
- Core 提交方法快照；
- BrowserSubscription 引用；
- 重入布尔值；
- 诊断序列和容量。

不得存在模块级可变注册表、计数器、Set、Map、数组或缓存。插件可以共享 BrowserEnvironment 或使用不同实例；一个插件停止或销毁只取消自己的性能订阅。plugin-error、plugin-request、plugin-performance 可以同时运行：每个插件只释放自己拥有的订阅，不交叉移除；一个实例的转换、提交、诊断或销毁失败不改变其他实例。

## 12. 宿主安全与隐私

实现和测试必须证明：

- 模块导入与工厂创建均不注册监听器；
- 只通过 Browser 公开接口订阅，不直接访问 DOM 或浏览器全局；
- 不覆盖 handler、不控制事件默认行为或传播、不修改原生对象或宿主全局；
- 回调异常不影响宿主脚本；
- 一个性能事实失败后下一事实仍可提交；
- 停止和销毁后订阅完整释放或至少逻辑失效；
- 多实例不交叉移除；
- 插件内部失败不产生未捕获错误或 Promise 拒绝；
- 没有原生引用跨出同步回调；
- 诊断和测试样本不含真实敏感信息；
- 不调用 `BrowserEnvironment.destroy()`，不影响错误源/请求源订阅。

不得采集或记录 DOM、entry、URL、页面文本、用户输入、Cookie、Token、Authorization、Storage、请求/响应数据或性能协议未允许的上下文。

## 13. 包、文件与代码规范

最终包使用：

```text
packages/plugin-performance/
├── README.md
├── package.json
├── playwright.config.ts
├── tsconfig.build.json
├── tsconfig.json
├── tsconfig.no-dom.json
├── vitest.config.ts
├── src/
│   ├── diagnostics.ts
│   ├── index.ts
│   ├── performance-capture-plugin.ts
│   ├── performance-event-converter.ts
│   └── performance-source-handler.ts
├── test/
│   ├── architecture-boundary.test.ts
│   ├── documentation-contract.test.ts
│   ├── lifecycle.test.ts
│   ├── multi-instance.test.ts
│   ├── no-dom-consumer.ts
│   ├── package-entry.test.ts
│   ├── performance-event-converter.test.ts
│   └── submission.test.ts
└── test-browser/
    ├── fixture-server.ts
    └── performance-capture-plugin.spec.ts
```

- TypeScript 使用根 `strict`、`exactOptionalPropertyTypes` 和 `noUncheckedIndexedAccess`；
- 不可信运行时值保持 `unknown`，精确 Browser 联合类型按判别字段穷尽处理；
- 禁止无说明 `any`、`Object`、`Function`、`Record<string, any>`、双重断言、非空断言和错误抑制；
- 公共函数显式声明参数和返回类型；
- 文件名 `kebab-case`，类型/接口 `PascalCase`，函数/变量 `camelCase`，布尔值使用 `is`/`has`/`can`/`should` 前缀；
- 文件和函数单一职责，不创建杂物目录；
- 不复制 Browser 性能观测、event-schema 校验或 Core 信封创建；
- `sideEffects: false`，只导出第 4 节 API；
- 不使用生产 `console`。

`performance-event-converter.ts` 只负责 Browser 性能事实到候选正文的直通映射与最小字段检查；`performance-source-handler.ts` 只负责重入门禁、转换分发与 Core 提交；`performance-capture-plugin.ts` 只负责工厂、生命周期、订阅所有权与诊断入口；`diagnostics.ts` 只负责有界诊断存储。

## 14. 自动架构门禁

实施必须建立以下可执行证据：

1. `sdk-plugin` 层允许依赖矩阵（`sdk-core`、`sdk-browser`、`protocol`）对 `@aurora/plugin-performance` 生效；
2. Core、Browser、protocol 依赖 plugin 时返回 `forbidden-layer-dependency`；
3. plugin 依赖 plugin、framework 或 tooling 时返回 `forbidden-layer-dependency`（含 plugin-performance 依赖 plugin-error/plugin-request）；
4. 插件跨包导入 `src`、`internal` 或未导出路径返回 `private-path-import`；
5. 依赖图循环、未声明依赖均失败；
6. 插件源码直接访问 DOM/宿主全局、Node 运行时、模块级可变状态、宿主修改或事件控制均失败；
7. `tsc -p packages/plugin-performance/tsconfig.no-dom.json --noEmit` 通过；
8. 包根可加载，私有转换器路径返回 `ERR_PACKAGE_PATH_NOT_EXPORTED`；
9. 构建产物只暴露一个根入口和第 4 节批准符号；
10. 多实例测试证明无全局可变状态。

## 15. 测试与覆盖率

覆盖率固定为：

- lines ≥ 85%；
- branches ≥ 80%；
- functions ≥ 85%；
- statements ≥ 85%。

测试通过公开行为断言，不只验证内部函数调用次数。性能采集插件是宿主安全和协议正确性相关插件，必须同时提供单元测试与 Chromium 真实浏览器证据。

### 15.1 公共契约与生命周期

- 包根公共出口、插件工厂、插件 ID；
- initialize、start、重复 start、stop、重复 stop、stop 后重新 start、destroy、重复 destroy、destroy 后拒绝 start；
- 订阅失败回滚、释放失败隔离。

### 15.2 四项指标转换

- 每项指标（`lcp`/`inp`/`cls`/`page_load`）至少测试合法 Browser 事实、正确 eventType、正确 metricName、正确 unit、正确 value、正确 startedAt、正确可选 durationMs、输入事实不被修改、每个事实最多提交一次；
- 非法 metricName、非法 unit、NaN、Infinity、负数、越界 CLS、缺失必填字段、schema 拒绝；
- 不重新计算 Browser 指标（转换结果与 Browser 事实逐字段一致）。

### 15.3 协议与 Core

- 转换结果通过 `parsePerformanceEventBody`；
- 草稿通过 Core 标准入口提交；
- 插件不提供 ID、时间或协议版本；
- 成功提交、Core 提交失败、一次失败后后续事实仍能处理；
- 并发或嵌套回调、防重入门禁释放。

### 15.4 多实例与共存

- 两个插件实例、两个 BrowserEnvironment、共享 BrowserEnvironment；
- 一个实例 stop 不影响另一个、一个实例 destroy 不影响另一个；
- 与 plugin-error 同时运行、与 plugin-request 同时运行、三个插件同时运行；
- plugin-performance 不释放错误源或请求源订阅；
- 无全局状态。

## 16. Chromium 真实浏览器门禁

Playwright 使用现有版本和单 Chromium 项目，加载构建后的四个上游包与 plugin-performance 根入口。fixture 使用 import map 映射包根，不访问私有源码。

至少验证：

- `page_load` 事实产生并提交；
- LCP 事实产生并提交（用真实文本内容触发）；
- CLS 事实产生并提交（用可靠布局偏移触发）；
- INP 事实产生并提交，或当前 Chromium 能力不足时按 Browser 规格处理；
- 最终草稿通过 event-schema 公共解析器，并由真实 `createCore()` 的 `submitEventDraft()` 返回 `accepted`；
- Core 生成事件 ID、事件时间和协议版本；
- 每个最终性能事实只提交一次；
- stop 后不再提交，destroy 后性能订阅释放；
- plugin-error、plugin-request 和 plugin-performance 同时运行；
- 插件内部失败不破坏页面脚本；
- 不泄露 DOM、entry、URL 或用户输入。

Chromium 测试禁止任意 sleep，使用条件、事件和明确超时。

## 17. 体积、构建和根任务

包继续使用现有 TypeScript 库构建，不新增 bundler 或发布系统。实施记录 `dist` 中运行时 JS 的原始与 gzip 字节数，与已批准单插件 gzip 增量 8 KiB 预算比较。当前 `tsc` 构建不是最终 bundler/tree-shaking 证据，因此发布前体积结论标记为 `requires-benchmark`；本增量不得为此引入发布系统或 bundler。

根 `format:check`、`lint`、`typecheck`、`test`、`test:coverage`、`check:boundaries`、`build`、plugin-performance 包入口、plugin-performance Chromium 和 `check:ci` 必须纳入新包。

## 18. 文档与 ADR 实施证据

只有代码实施且完整新鲜门禁通过后，才同步：

- `packages/plugin-performance/README.md`：职责、安装组合、公开 API、生命周期、诊断、采样边界、隐私和排除范围；
- 根 `README.md` 与 `docs/README.md`：记录性能采集插件第一增量真实存在；
- `docs/architecture/sdk-architecture.md`、`docs/architecture/formalization-readiness.md` 和 `docs/testing/test-strategy.md`：记录插件层、边界和 Chromium 证据；
- `AGENTS.md` 与 `AURORA_RULES.md`：更新当前真实包和决策顺序；
- ADR-003：追加具体性能插件、生命周期、释放、宿主安全和多实例证据，保持 `accepted / in-progress`；
- ADR-005：追加真实插件只消费 event-schema 根入口并调用公共性能解析器的证据，保持 `accepted / in-progress`；
- ADR-006：追加 `sdk-plugin` 依赖矩阵、环境负例、私有入口和循环负例证据，保持 `accepted / in-progress`；
- ADR-007 保持 `accepted / implemented`，除非实施发现既有工具事实错误。

本文和实施计划本身不得修改 ADR 决策状态或实施状态。本增量不需要新 ADR：性能监控产品语义由 PRD 批准，插件分层与共享代理恢复由 ADR-003 批准，插件只消费三个包根公开接口由 ADR-006 批准，协议单一来源与运行时校验由 ADR-005 批准。采样、队列、传输等需要新长期决策时先创建 proposed ADR 并阻塞。

## 19. 排除范围与后续模块衔接

### 19.1 排除范围

- 采样算法、采样配置、性能聚合、指标去重、批次合并、传输、队列、批量、重试、持久化；
- 新性能指标（FCP/TTFB/FID/TBT 等）、自定义业务指标；
- Browser 性能观测逻辑、`PerformanceObserver`、指标计算；
- 行为/资源插件、框架适配、React/Vue；
- 服务端、数据库、平台、CI、发布、容器、IaC、云资源；
- 通用性能框架、事件总线、`utils`/`helpers`/`common`/`misc`。

### 19.2 后续模块衔接

- **采样**：PRD 默认采样率 10% 的算法、位置、配置来源需独立 approved 规格定义；采样应在插件转换前或 Core 管道中实施，不改变本插件公共契约；
- **性能正文扩展**：新增指标需独立 approved 协议规格；
- **传输/队列**：独立模块在各自 approved 规格与必要 ADR 门禁后实施，本插件 `accepted` 结果不承诺保留或发送。

## 20. 规格自检

- 只处理 PRD 5.1.9 批准的四项指标；
- 采样边界明确：本插件不采样，PRD 10% 采样率留待独立规格；
- 未修改上游公共接口，未创建第二套协议或指标算法；
- 转换只做字段直通映射，不重新计算 Browser 指标；
- 使用 `parsePerformanceEventBody` 作为最终正文边界；
- 只提交 `eventType` + `body` 最小草稿，不生成系统字段；
- 防重入有界、诊断脱敏、资源可释放；
- 多实例与三插件共存有测试证据；
- 无占位、无未定义接口、单模块范围。
