---
title: Browser 请求采集插件第一增量
status: approved
implementation-status: implemented
awaiting-user-approval: false
owner: sdk
created: 2026-07-31
last-reviewed: 2026-07-31
applies-to:
  - packages/plugin-request
related:
  - ../../AGENTS.md
  - ../../AURORA_RULES.md
  - ../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md
  - '../../Aurora 架构规范.md'
  - '../../Aurora 代码规范.md'
  - '../../Aurora 测试规范.md'
  - '../../Aurora 文档规范.md'
  - '../../Aurora ADR 规范.md'
  - ../protocol/request-event-contract.md
  - browser-request-source.md
  - core-event-creation.md
  - sdk-core-foundation.md
  - error-capture-plugin.md
  - ../architecture/sdk-architecture.md
  - ../testing/test-strategy.md
  - ../adr/ADR-003-sdk-plugin-architecture.md
  - ../adr/ADR-005-event-schema-source-of-truth.md
  - ../adr/ADR-006-one-way-dependencies.md
supersedes: none
review-cycle: request-plugin-public-api-or-host-safety-change
---

# Browser 请求采集插件第一增量

## 0. 状态声明

本文是 `packages/plugin-request` 请求采集插件第一增量的**正式规格**，已获用户批准并实施。

- status: `approved`
- implementation-status: `implemented`
- awaiting-user-approval: `false`

实施证据见第 0.1 节。ADR-003/005/006 的决策状态保持 `accepted`，实施状态保持 `in-progress`；ADR-007 保持 `accepted / implemented`。

### 0.1 实施证据（2026-07-31）

本增量已实施为真实私有包 `@aurora/plugin-request`，并通过以下新鲜验证：

- `pnpm --filter @aurora/plugin-request test`：7 个测试文件、31 个测试全部通过；
- `pnpm --filter @aurora/plugin-request test:coverage`：statements 93.44%、branches 92.5%、functions 100%、lines 93.26%（门禁 85/80/85/85）；
- `pnpm --filter @aurora/plugin-request test:package`：构建根入口只暴露 `REQUEST_CAPTURE_PLUGIN_NAME`、`RequestCaptureDiagnosticCode`、`RequestCaptureDiagnosticOperation`、`createRequestCapturePlugin` 四个运行时值，私有子路径全部返回 `ERR_PACKAGE_PATH_NOT_EXPORTED`；
- `pnpm --filter @aurora/plugin-request test:browser`：Playwright 9 个 Chromium 场景全部通过（真实 fetch 成功/HTTP 错误/网络失败、真实 XHR load/abort、每次请求只提交一次、宿主 fetch/XHR 身份恢复、plugin-error 共存、正文不被消费、stop 后不提交）；
- `pnpm --filter @aurora/plugin-request typecheck`（含 `tsconfig.no-dom.json`）与根 `pnpm check:boundaries` 均无诊断；
- 体积近似：dist 运行时 JS 原始 10934 字节、gzip 2139 字节；低于单插件 8 KiB gzip 预算，该值是多文件 TypeScript 拼接的近似，非最终 tree-shaken 发布结果，标记 `requires-benchmark`。

## 1. 定位、范围与权威来源

本文冻结 `packages/plugin-request` 的浏览器请求采集插件第一增量。该插件是 SDK 分层插件架构中消费 Browser 请求观测事实、经 event-schema 请求事件契约转换、通过 Core 最小草稿入口提交的第一个请求插件增量。

本文只依赖以下已批准或已实施事实：

- `docs/protocol/request-event-contract.md` 已实施请求事件协议契约第一增量：`RequestMethod`、`RequestOutcome`、`REQUEST_EVENT_LIMITS`、`parseRequestEventBody`/`parseRequestEventEnvelope` 与请求契约样本；
- `docs/sdk/browser-request-source.md` 已实施 Browser 请求观测能力：`subscribeRequests(listener)`、`BrowserRequestSourceEvent`（fetch/XHR 变体）、共享代理 + 每实例引用计数、脱敏 `origin + pathname` URL、`BrowserRequestMechanism`、`BrowserRequestOutcome`、`BrowserRequestSourceEventType`；
- `docs/sdk/core-event-creation.md` 已实施最小事件草稿 `{ eventType, body }` 与由 Core 生成协议版本、事件 ID、事件时间的提交边界，`CorePluginContext.submitEvent(input: unknown): CoreEventDraftResult`；
- `docs/sdk/sdk-core-foundation.md` 已实施 `CorePlugin` 生命周期、异常隔离和插件上下文最小化；
- `docs/sdk/error-capture-plugin.md` 已实施 `@aurora/plugin-error` 错误采集插件第一增量，作为本插件生命周期、诊断、所有权和宿主安全的模式参考；
- ADR-003、ADR-005、ADR-006 为 `accepted / in-progress`；
- ADR-007 为 `accepted / implemented`，继续使用 pnpm Workspace 与现有根任务入口。

截至本文创建时，三个上游包（`@aurora/browser`、`@aurora/core`、`@aurora/event-schema`）与相邻插件 `@aurora/plugin-error` 的定向包入口和行为测试均通过，但 `packages/plugin-request` 尚不存在。

## 2. 问题与方案选择

Browser 已能安全观测 fetch 与 XHR 并投影最小只读请求事实，event-schema 已能校验请求正文并生成脱敏安全 URL，Core 已能接收 `{ eventType, body }` 草稿并统一生成系统字段。缺失的唯一边界是将三者组合为一个可独立启停、不会破坏宿主、不会旁路 Core 且不会重新包装 fetch/XHR 的具体请求插件。

采用的方案是：

1. 调用方显式创建并传入一个现有 `BrowserEnvironment`；
2. 工厂返回一个实现 `CorePlugin` 的 `RequestCapturePlugin`；
3. 插件在 `start()` 中通过 Browser 根入口 `subscribeRequests` 订阅，在 `stop()` 和 `destroy()` 中只取消自己拥有的 `BrowserSubscription`；
4. 插件同步把 Browser 请求事实转换为请求正文候选，调用 `parseRequestEventBody()` 获得新的安全正文；
5. 插件只调用 `CorePluginContext.submitEvent({ eventType: EventType.Request, body })`；
6. 插件使用每实例固定容量诊断表达局部失败，不向宿主抛出。

不采用“插件内部创建并销毁 BrowserEnvironment”，因为 Browser 实例可能被页面生命周期、错误插件或其他插件共享，插件无权销毁调用方资源。不采用“插件直接包装 fetch/XHR”，因为这会复制 Browser 的共享代理、引用计数和恢复逻辑，形成第二套 Browser 能力并违反分层。不采用“插件自行生成事件 ID、事件时间或协议版本”，因为 Core 草稿入口已统一这些系统字段。不采用全局单例或全局事件总线，因为它们破坏多实例隔离。

## 3. 职责

本增量负责：

- 提供私有包 `@aurora/plugin-request` 和唯一根公开出口；
- 实现固定名称的 `CorePlugin`；
- 通过 `@aurora/browser` 根入口 `subscribeRequests` 订阅 fetch 与 XHR 请求事实；
- 接收 `BrowserFetchRequestSourceEvent` 与 `BrowserXhrRequestSourceEvent` 两类请求事实；
- 把 Browser 请求事实映射为 `RequestEventBody` 候选：fetch/XHR 机制映射（只进入诊断，不进入正文）、HTTP 方法归一化映射、结果类别映射、脱敏 URL 透传、开始时间、持续时间取整、状态码透传；
- 使用 `@aurora/event-schema` 根入口的常量、限制、类型和 `parseRequestEventBody()`；
- 使用 Core 插件上下文提交最小草稿，不生成事件 ID、事件时间或协议版本；
- 定义同步、幂等且可释放的 `initialize`、`start`、`stop`、`destroy` 生命周期；
- 处理 Browser 原子订阅失败、取消诊断、单次转换失败和 Core 提交失败；
- 通过实例级重入门禁阻止插件处理路径形成同步递归采集；
- 不保留 Browser 请求事实、Request、Response、XHR、URL、方法、状态码或任何嵌套引用；
- 提供固定容量、冻结、脱敏的插件诊断；
- 证明多实例、与 plugin-error 共存、宿主请求不受影响、输入不可变和订阅完整释放；
- 提供单元、包入口、依赖负例和 Chromium 真实浏览器证据；
- 同步 README、正式文档和现有 ADR 的真实实施证据（仅在批准并实施后）。

## 4. 非职责与排除范围

本增量不实现：

- fetch 或 XHR 包装、代理、引用计数或宿主引用恢复；
- Browser 请求事实的观测逻辑（由 `@aurora/browser` 提供）；
- 请求或响应正文、请求或响应头、Cookie、Authorization、Token；
- 完整 URL 查询参数和片段（Browser 已脱敏为 `origin + pathname`，协议解析器再次移除残余查询/片段）；
- Request、Response、XMLHttpRequest 对象或任何原生输入的长期留存；
- 网络传输、队列、批量、重试、退避或持久化；
- 采样、请求去重、请求聚合、请求指标统计、慢请求阈值判断；
- 允许来源判断、同源判断、跨域允许列表、路径动态段归一化或开发者路径模板（属于 SDK 配置层与处理层）；
- 性能事件、行为事件、框架插件；
- React、Vue 或开发者主动上报 API；
- 用户上下文、Session、breadcrumb、release、environment、projectId、endpoint 或密钥；
- 服务端、数据库、管理平台、CI、发布、容器、IaC 或云资源；
- 第二套 EventEnvelope、协议版本、请求协议、Browser 环境检测或监听器体系；
- 通用插件框架、通用转换框架、事件总线、`utils`、`helpers`、`common` 或 `misc`。

本增量不修改 Core、Browser 或 event-schema 的公共接口。若现有上游公共接口无法支撑本插件，本增量必须停止并报告，不得把上游修改偷偷塞入本计划。

## 5. 分层和依赖边界

依赖方向固定为：

```text
@aurora/plugin-request
├── @aurora/core
├── @aurora/browser
└── @aurora/event-schema
```

- plugin-request 只从三个包的根公开出口导入；
- Core、Browser 和 event-schema 不反向依赖 plugin-request；
- plugin-request 不访问任何跨包 `src`、`internal`、测试入口或未导出子路径；
- Core 继续不依赖 Browser；
- event-schema 继续不依赖任何消费者；
- plugin-request 不依赖其他插件、框架、Node 专属运行时模块或网络包；
- `package.json` 使用 `aurora.layer: "sdk-plugin"` 和 `workspace:*` 本地依赖；
- 现有 Workspace Policy 的 `sdk-plugin -> sdk-core | sdk-browser | protocol` 允许矩阵与 sdk-plugin 环境扫描直接覆盖本包，不需要修改 tooling；
- TypeScript、ESLint 和 Workspace Policy 共同拒绝插件源码直接访问 DOM/宿主全局、Node 运行时、模块级可变状态、宿主修改和事件控制方法。

## 6. 公共 TypeScript 契约

以下符号全部从 `@aurora/plugin-request` 根入口导出。包不提供第二个子路径出口。

```ts
import type {
  BrowserEnvironment,
  BrowserRequestSourceEventType,
} from '@aurora/browser';
import type { CorePlugin, CorePluginContext } from '@aurora/core';

export const REQUEST_CAPTURE_PLUGIN_NAME = 'request-capture' as const;

export const RequestCaptureDiagnosticCode = Object.freeze({
  InvalidLifecycleCall: 'invalid_lifecycle_call',
  InvalidPluginContext: 'invalid_plugin_context',
  BrowserSubscriptionFailed: 'browser_subscription_failed',
  BrowserUnsubscribeFailed: 'browser_unsubscribe_failed',
  InvalidBrowserFact: 'invalid_browser_fact',
  UnsupportedMethod: 'unsupported_method',
  RequestBodyRejected: 'request_body_rejected',
  EventSubmissionFailed: 'event_submission_failed',
  RecursiveCaptureBlocked: 'recursive_capture_blocked',
  InternalError: 'internal_error',
} as const);

export type RequestCaptureDiagnosticCode =
  (typeof RequestCaptureDiagnosticCode)[keyof typeof RequestCaptureDiagnosticCode];

export const RequestCaptureDiagnosticOperation = Object.freeze({
  Initialize: 'initialize',
  Start: 'start',
  Stop: 'stop',
  Destroy: 'destroy',
  Convert: 'convert',
  Submit: 'submit',
  Notify: 'notify',
} as const);

export type RequestCaptureDiagnosticOperation =
  (typeof RequestCaptureDiagnosticOperation)[keyof typeof RequestCaptureDiagnosticOperation];

export interface RequestCaptureDiagnostic {
  readonly sequence: number;
  readonly code: RequestCaptureDiagnosticCode;
  readonly operation: RequestCaptureDiagnosticOperation;
  readonly mechanism?: BrowserRequestSourceEventType;
}

export interface RequestCapturePlugin extends CorePlugin {
  readonly name: typeof REQUEST_CAPTURE_PLUGIN_NAME;
  initialize(context: CorePluginContext): void;
  start(): void;
  stop(): void;
  destroy(): void;
  getDiagnostics(): readonly RequestCaptureDiagnostic[];
}

export function createRequestCapturePlugin(browser: BrowserEnvironment): RequestCapturePlugin;
```

`createRequestCapturePlugin()` 是同步且无副作用导入后的显式工厂。正常的精确类型调用不抛出；实现对运行时恶意 getter 做防御性读取，即使 JavaScript 调用方绕过类型传入异常对象，也返回一个可诊断为 Browser 不可用的插件实例，不把异常抛给宿主。

不公开转换函数、诊断存储、订阅端口、方法归一化函数或内部生命周期状态。

## 7. BrowserEnvironment 所有权

传入的 `BrowserEnvironment` 由调用方拥有。插件可以保存该公开环境对象并在 `start()` 时调用其公开 `subscribeRequests` 方法，但不得：

- 调用 `browser.destroy()`；
- 读取 Browser 私有状态；
- 从 Browser 诊断中复制异常内容；
- 移除其他订阅（包括 plugin-error 或其他请求订阅者）；
- 在模块导入或插件创建时订阅。

插件只拥有 `start()` 成功返回的 `BrowserSubscription`。停止或销毁时先把本实例标记为不再接收事件，再调用该订阅的 `unsubscribe()`，随后清除引用。Browser 的原子注册与回滚仍是唯一监听器实现。

## 8. 精确生命周期

所有插件钩子为同步 `void`，符合 Core 允许的 `void | Promise<void>` 上界。

### 8.1 initialize

- 第一次收到合法 `CorePluginContext` 时安全快照其 `submitEvent` 方法，并进入 initialized；
- 重复初始化为幂等空操作，不替换第一次成功快照；
- 非法上下文记录 `invalid_plugin_context / initialize`，保持未初始化；后续合法上下文可以正常初始化；
- 销毁后初始化记录 `invalid_lifecycle_call / initialize`，不得恢复；
- 初始化不订阅、不提交事件。

### 8.2 start

- 未初始化或已销毁时记录 `invalid_lifecycle_call / start`，不订阅；
- 已有活动订阅时为幂等空操作；
- 调用 Browser 根公开接口 `subscribeRequests` 订阅一个实例级 Listener；
- 订阅失败时 Browser 已负责部分注册回滚；插件记录 `browser_subscription_failed / start` 并保持未启动；
- 订阅成功后保存唯一 `BrowserSubscription` 并开始接收事件；
- Browser 订阅的预期失败不抛出，因此不会错误地使 Core 永久隔离插件；下一轮 Core `stop()`/`start()` 可以重试。

### 8.3 stop

- 未启动时为幂等空操作；
- 先逻辑停用并清除活动订阅引用，再调用 `unsubscribe()`；
- `unsubscribe()` 返回 `diagnosticsAdded > 0` 表示物理移除存在 Browser 诊断，插件追加 `browser_unsubscribe_failed / stop`；
- `unsubscribe()` 的意外抛出被捕获并转换为同一插件诊断；
- 停止后残留的宿主回调不能提交事件；
- 停止后可以再次 `start()`，重新获得新订阅。

### 8.4 destroy

- 首次销毁执行与 stop 相同的释放语义，随后清除 Core 提交方法并永久标记 destroyed；
- 从未初始化或未启动状态销毁同样成功；
- 重复销毁为幂等空操作；
- 销毁后 `initialize`/`start` 不会恢复插件，任何残留回调均为空操作；
- Core 从 started 销毁时会先调用 stop 再调用 destroy，插件必须允许这两个调用连续发生且只取消一次。

## 9. Browser 请求事实到协议正文的映射

全部转换都发生在 Browser Listener 的同步调用栈内。插件从不保存 `BrowserRequestSourceEvent`。

### 9.1 请求正文候选

插件为每个 Browser 请求事实构造一个新的候选正文对象，只包含请求协议允许的六个字段：

```ts
const candidate: unknown = {
  method,                                  // RequestMethod，转换后
  url: event.url,                          // Browser 已脱敏的 origin + pathname
  startedAt: event.startedAt,              // 正安全整数 Unix epoch 毫秒
  durationMs: Math.round(event.durationMs), // 非负安全整数
  outcome,                                 // RequestOutcome，转换后
  ...(statusCode === null ? {} : { statusCode }),
};
```

`statusCode === null` 时省略字段；否则保留。候选构造后只调用 `parseRequestEventBody(candidate)`。

### 9.2 机制映射（只用于诊断）

| Browser 事实 mechanism | 诊断 mechanism |
| ---------------------- | -------------- |
| `BrowserRequestMechanism.Fetch` | `BrowserRequestSourceEventType.Fetch` |
| `BrowserRequestMechanism.XmlHttpRequest` | `BrowserRequestSourceEventType.Xhr` |

`mechanism` 不进入请求正文，因为请求协议正文没有机制字段。fetch 与 XHR 两类事实都映射到同一 `RequestEventBody` 形状。

### 9.3 HTTP method 映射

Browser 的 `method` 是任意字符串（可能为小写，因为包装器直接读取 `init.method`，未经 fetch 的方法规范化）。插件固定执行：

1. 把字符串转为大写；
2. 大写结果匹配 `RequestMethod` 的七个枚举值之一时返回对应枚举值；
3. 不匹配（如 `CONNECT`、`TRACE`、自定义方法、空串之外的任意值）时返回 `unsupported_method` 转换失败，不提交事件。

该映射使 `get`/`Get`/`GET` 都规范化为 `GET`，同时不伪造协议枚举之外的方法。协议解析器仍是大写值之外所有剩余非法输入（如恶意 getter 返回非字符串）的最终门禁。

### 9.4 结果类别映射

Browser `BrowserRequestOutcome` 与协议 `RequestOutcome` 的字符串值一一对应：

| Browser 值        | 协议值         |
| ----------------- | -------------- |
| `Success`         | `RequestOutcome.Success` |
| `HttpError`       | `RequestOutcome.HttpError` |
| `NetworkError`    | `RequestOutcome.NetworkError` |
| `Timeout`         | `RequestOutcome.Timeout` |
| `Canceled`        | `RequestOutcome.Canceled` |

转换器按 Browser 常量逐值映射。运行时不匹配任何已知值的 outcome 返回 `invalid_browser_fact` 转换失败，不提交事件。

### 9.5 字段合法性检查

- `startedAt`：必须是通过 `Number.isSafeInteger(startedAt) && startedAt > 0` 的正安全整数，否则 `invalid_browser_fact`；
- `durationMs`：必须是通过 `Number.isFinite(durationMs) && durationMs >= 0` 的有限非负数值，随后 `Math.round` 取整为安全整数，否则 `invalid_browser_fact`（Browser 由 `performance.now()` 差值产生，可能是浮点，协议要求安全整数，因此取整是插件职责）；
- `url`：必须是非空字符串（Browser 保证，防御性检查），否则 `invalid_browser_fact`；
- `statusCode`：`null` 省略字段；非 `null` 时必须是通过 `Number.isSafeInteger(statusCode)` 的安全整数，否则 `invalid_browser_fact`；`100..599` 范围由协议解析器校验（Browser 可能观测到非标准状态码，如 `600` 或 `0`，此类由解析器以 `invalid_number` 拒绝并记录 `request_body_rejected`）；
- 超出上述类型的 Browser 事实视为非法 Browser 事实。

### 9.6 转换结果

```ts
export type RequestBodyConversionResult =
  | RequestEventBodyParseSuccess
  | { readonly success: false; readonly code: 'unsupported_method' }
  | { readonly success: false; readonly code: 'invalid_browser_fact' }
  | RequestEventBodyParseFailure;
```

`convertRequestSourceEvent(event: BrowserRequestSourceEvent): RequestBodyConversionResult` 是本包内部转换入口，不导出到包根。成功结果直接来自 `parseRequestEventBody` 的 `data`，不保存原始 Browser 事实。

### 9.7 转换不变性

转换器：

- 不修改 Browser 请求事实；
- 不持有 Request、Response 或 XHR 引用；
- 不读取正文；
- 不恢复或再次处理完整 URL 查询参数（Browser 已移除，协议解析器对残余 `?`/`#` 再截断）；
- 使用 event-schema 公共解析器作为最终协议边界；
- 只把 `eventType` 和 `body` 等最小草稿提交给 Core；
- 不覆盖 Core 系统字段。

## 10. 协议校验与 Core 提交

每个候选正文固定执行：

```ts
const parsed = parseRequestEventBody(candidate);
if (parsed.success) {
  context.submitEvent({
    eventType: EventType.Request,
    body: parsed.data,
  });
}
```

- 插件不创建、导入或缓存 `EventEnvelope`；
- 插件不读取 `CURRENT_PROTOCOL_VERSION`；
- 插件不生成事件 ID 或事件时间；
- 插件不能向草稿加入 `protocolVersion`、`eventId` 或 `occurredAt`；
- 解析失败记录 `request_body_rejected / convert`，诊断不复制 issue、路径、消息或输入；
- 转换失败（`unsupported_method` / `invalid_browser_fact`）记录对应诊断，不提交事件；
- Core 返回 `ok: false` 时记录 `event_submission_failed / submit`；
- Core 返回 `accepted` 只表示草稿已由 Core 创建为合法信封并通过现有入口，不表示排队、发送或持久化；
- 单次解析、转换或提交失败不会停止订阅，也不会阻止下一请求事实。

## 11. 递归防护与异常隔离

每个插件实例拥有独立的 `isHandlingSource` 布尔状态。Listener 处理顺序固定为：

1. 检查插件仍活动（`isAcceptingEvents`）；
2. 若 `isHandlingSource` 已为 true，记录 `recursive_capture_blocked / notify` 并返回；
3. 设为 true；
4. 转换、解析和提交；
5. 捕获所有意外异常，记录 `internal_error`；
6. 在 `finally` 中恢复 false。

本插件自身不发起任何网络请求，因此本增量内部不产生自递归网络链路；该门禁是防御性宿主保护，防止恶意 getter/Proxy 造成的同步重入，不执行去重或跨事件抑制。所有内部错误都在 Browser Listener 返回前被捕获，因此不会制造新的未捕获错误或拒绝，也不会递归触发 Aurora。Browser 自身的回调异常隔离仍作为第二道宿主保护。

## 12. 输入不可变与引用释放

- 不写入 Browser 请求事实视图或任何嵌套对象；
- 不调用 `preventDefault()`、`stopPropagation()` 或 `stopImmediatePropagation()`；
- 不修改 `window.fetch`、`window.XMLHttpRequest` 或任何宿主全局、原生对象或 handler；
- 不保留 Browser 请求事实、Request、Response、XHR、URL、method、statusCode 或候选正文引用；
- 只把解析成功后的新正文同步提交；
- Core 草稿入口不修改正文，插件不在提交后保存正文；
- 停止或销毁后只保留有界诊断，不保留事件数据。

## 13. 诊断

每实例最多保留最新 100 条 `RequestCaptureDiagnostic`。`sequence` 从 1 独立递增。`getDiagnostics()` 返回冻结的新数组，条目冻结且不能反向修改内部状态。

诊断只包含：

- 递增序号；
- 稳定 code；
- 稳定 operation；
- 可选的 Browser 请求源事件类型（`fetch` / `xhr`）。

诊断禁止包含异常对象、异常消息、堆栈、事件正文、请求事实、URL、method、statusCode、Cookie、Token、Authorization、Storage、请求/响应数据、表单、页面文本、用户输入、配置或 Core 结果详情。生产代码不使用 `console`。预期的重复 start/stop/destroy 不增加诊断；非法生命周期调用、实际失败和递归阻断必须可见。

## 14. 多实例与共享 Browser

每次 `createRequestCapturePlugin()` 拥有独立的：

- 生命周期状态；
- Core 提交方法快照；
- BrowserSubscription 引用；
- 重入布尔值；
- 诊断序列和容量。

不得存在模块级可变注册表、计数器、Set、Map、数组或缓存。两个插件可以共享一个 BrowserEnvironment，也可以使用不同 BrowserEnvironment；一个插件停止或销毁只取消自己的订阅。一个实例的转换、提交、诊断或销毁失败不能改变另一个实例。plugin-request 不得释放 plugin-error 或其他请求订阅者的订阅。

## 15. 宿主安全与隐私

实现和测试必须证明：

- 模块导入与工厂创建均不注册监听器；
- 只通过 Browser 公开接口订阅，不直接访问 DOM 或浏览器全局；
- 不覆盖 handler、不控制事件默认行为或传播、不修改原生对象或宿主全局；
- 回调异常不影响宿主脚本；
- 一个请求事实失败后下一事实仍可提交；
- 停止和销毁后订阅完整释放或至少逻辑失效；
- 请求与响应正文仍可由宿主正常使用（插件不消费正文）；
- 多实例不交叉移除；
- 插件内部失败不产生未捕获错误或 Promise 拒绝；
- 没有原生引用跨出同步回调；
- 诊断和测试样本不含真实敏感信息。

不得采集或记录 Cookie、Token、Authorization、Storage、请求/响应正文、请求/响应头、表单、DOM、页面文本、用户输入、完整 URL 查询或片段、用户名/密码、指纹、原始 IP 或请求协议未允许的上下文。

## 16. 包、文件与代码规范

最终包使用：

```text
packages/plugin-request/
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
│   ├── request-capture-plugin.ts
│   ├── request-event-converter.ts
│   └── request-source-handler.ts
├── test/
│   ├── architecture-boundary.test.ts
│   ├── documentation-contract.test.ts
│   ├── host-safety.test.ts
│   ├── lifecycle.test.ts
│   ├── multi-instance.test.ts
│   ├── no-dom-consumer.ts
│   ├── package-entry.test.ts
│   ├── request-event-converter.test.ts
│   └── submission.test.ts
└── test-browser/
    ├── fixture-server.ts
    └── request-capture-plugin.spec.ts
```

- TypeScript 使用根 `strict`、`exactOptionalPropertyTypes` 和 `noUncheckedIndexedAccess`；
- 不可信运行时值保持 `unknown`，精确 Browser 联合类型按判别字段穷尽处理；
- 禁止无说明 `any`、`Object`、`Function`、`Record<string, any>`、双重断言、非空断言和错误抑制；
- 公共函数显式声明参数和返回类型；
- 文件名 `kebab-case`，类型/接口 `PascalCase`，函数/变量 `camelCase`，布尔值使用 `is`、`has`、`can`、`should` 前缀；
- 文件和函数单一职责，不创建杂物目录；
- 不复制 Browser 请求观测、event-schema URL/字段校验或 Core 信封创建；
- 不随意使用类型断言；必要的局部断言必须紧邻已完成的运行时检查并解释原因；
- `sideEffects: false`，只导出第 6 节 API；
- 不使用生产 `console`。

`request-event-converter.ts` 只负责 Browser 请求事实到候选正文的映射与合法性检查；`request-source-handler.ts` 只负责重入门禁、转换分发与 Core 提交；`request-capture-plugin.ts` 只负责工厂、生命周期、订阅所有权与诊断入口；`diagnostics.ts` 只负责有界诊断存储。

## 17. 自动架构门禁

实施必须建立以下可执行证据：

1. `sdk-plugin` 层允许依赖矩阵（`sdk-core`、`sdk-browser`、`protocol`）对 `@aurora/plugin-request` 生效；
2. Core、Browser、protocol 依赖 plugin 时返回 `forbidden-layer-dependency`；
3. plugin 依赖 plugin、framework 或 tooling 时返回 `forbidden-layer-dependency`；
4. 插件跨包导入 `src`、`internal` 或未导出路径返回 `private-path-import`；
5. 依赖图循环、未声明依赖均失败；
6. 插件源码直接访问 DOM/宿主全局、Node 运行时、模块级可变状态、宿主修改或事件控制均失败；
7. `tsc -p packages/plugin-request/tsconfig.no-dom.json --noEmit` 通过；
8. 包根可加载，私有转换器路径返回 `ERR_PACKAGE_PATH_NOT_EXPORTED`；
9. 构建产物只暴露一个根入口和第 6 节批准符号；
10. 多实例测试证明无全局可变状态。

## 18. 测试与覆盖率

覆盖率固定为：

- lines ≥ 85%；
- branches ≥ 80%；
- functions ≥ 85%；
- statements ≥ 85%。

测试通过公开行为断言，不只验证内部函数调用次数。请求插件是宿主安全和协议正确性相关插件，必须同时提供单元测试与 Chromium 真实浏览器证据，模拟 DOM 不能替代 Chromium 证据。

### 18.1 公共契约与生命周期

- 包根公共出口；
- 插件工厂、插件 ID；
- initialize、start、重复 start、stop、重复 stop、stop 后重新 start、destroy、重复 destroy、destroy 后禁止重新启动；
- 注册失败回滚、释放失败隔离。

### 18.2 fetch 转换

- 成功响应、HTTP 非 2xx 结果、网络拒绝、同步异常事实；
- GET/POST 等标准方法、小写标准方法、非标准 method；
- URL 已脱敏（不含查询/片段）；
- durationMs 取整、startedAt 透传、statusCode 透传/省略；
- 输入对象不变；
- 每个 Browser 事实只提交一次。

### 18.3 XHR 转换

- load 成功、HTTP 错误、error、abort、timeout；
- method、URL、durationMs 和 statusCode；
- 输入对象不变；
- 每个事实只提交一次。

### 18.4 协议与 Core

- 转换结果通过 `parseRequestEventBody`；
- 草稿通过 Core 标准入口提交；
- 插件不提供 ID、时间或协议版本；
- schema 校验失败；
- Core 提交失败（`invalid_event_draft`、`event_creation_failed`、`invalid_event`、`not_started`、`destroyed`、`internal_error`）；
- 一次失败后仍能处理后续请求事实；
- 不修改 schema 解析结果；
- 不绕过 Core 完整信封创建边界。

### 18.5 多实例与隔离

- 两个插件实例、两个 BrowserEnvironment、共享 BrowserEnvironment 的两个插件实例；
- 一个实例停止不影响另一个；
- 一个实例销毁不影响另一个；
- plugin-error 与 plugin-request 可同时运行；
- plugin-request 不释放 plugin-error 的错误订阅；
- 不使用全局状态。

## 19. Chromium 真实浏览器门禁

Playwright 使用现有版本和单 Chromium 项目，加载构建后的四个上游包与 plugin-request 根入口。fixture 使用 import map 映射包根，不访问私有源码。

至少验证：

- 真实 fetch 成功、真实 fetch HTTP 错误、真实 fetch 网络失败各提交一次；
- 真实 XHR 成功、真实 XHR abort、timeout 或 error 中本规格要求的场景各提交一次；
- 每个请求只提交一次；
- 最终事件通过 `parseRequestEventEnvelope()`，并由真实 `createCore()` 的 `submitEventDraft()` 返回 `accepted`；
- Core 生成事件 ID、事件时间和协议版本；
- `window.fetch` 与 `window.XMLHttpRequest` 身份在订阅、停止、销毁后正确；`instanceof` 行为不变；
- stop 后不再提交，destroy 后订阅释放；
- plugin-error 与 plugin-request 同时运行且互不影响；
- 插件内部失败不破坏宿主请求，请求/响应正文仍可由宿主正常使用；
- 没有递归收集。

模拟 DOM 不能替代这些证据。

## 20. 体积、构建和根任务

包继续使用现有 TypeScript 库构建，不新增 bundler 或发布系统。实施记录：

- `dist` 中运行时 JavaScript 的原始总字节数；
- 对固定文件顺序拼接后的 gzip 字节数；
- `package.json` 保持 `sideEffects: false`。

批准的单插件 gzip 增量预算为 8 KiB（见 `docs/testing/test-strategy.md` 第 71—73 行“单个可选插件 gzip 增量 ≤ 8 KiB”），但 TypeScript 多文件拼接不是最终 tree-shaking/bundler 结果，因此本轮只记录可重复的近似数据并标记 `requires-benchmark`；不得把该值描述为发布包体结论，也不得为此增加构建依赖。

根 `format:check`、`lint`、`typecheck`、`test`、`test:coverage`、`check:boundaries`、`build`、plugin-request 包入口、plugin-request Chromium 和 `check:ci` 必须纳入新包。

## 21. 递归与未来传输边界

代码规范“禁止不稳定运行”已明确：上报请求必须带有内部标记以避免递归监控（见 `Aurora 代码规范.md` 第 424 行）。该规则已存在，但内部标记的具体机制（Header 名、URL 前缀或其他标记）属于未来传输模块的设计，当前仓库没有传输模块可承载该机制。

本插件自身不发起任何网络请求，因此本增量内部不产生自递归网络链路，也不需要在当前增量内实现内部标记。本插件不实现也不发明私有 Header、URL 黑名单、全局标记或请求对象变异方案。

未来传输模块设计时必须：

1. 在传输层为上报请求加内部标记；
2. 在请求采集插件或配置层按该标记过滤，防止上报请求被再次采集；
3. 该机制进入独立 approved 规格与必要 ADR 门禁。

本增量将该机制记录为 `deferred / blocked on future transport integration`，不阻塞当前纯采集插件。

## 22. 后续模块衔接

本增量通过后，以下能力属于各自独立规格与必要门禁，不自动开始：

- **允许来源/同源判断**：PRD 5.1.4 要求默认只监控同源请求、跨域业务接口由开发者显式加入允许列表。该判断属于 SDK 配置层/处理层，不在本增量；未来可在独立配置规格中定义，并把判断放在请求插件或采集前过滤。
- **慢请求阈值与采样**：PRD 5.1.3 定义 3 秒阈值与 20% 默认采样率。采样和阈值判断属于独立模块，本增量不引入任何采样。
- **URL 路径动态段归一化**：PRD 5.1.1 要求归一化 URL 避免接口拆散，实现属于处理层，本增量不实现。
- **请求去重、聚合与问题识别**：属于数据接入/处理系统，本增量不实现。
- **请求传输与上报排除**：见第 21 节，传输模块必须定义内部标记并防止递归采集。
- **性能、行为、框架插件**：各自独立规格。

未来请求插件版本可以在 approved 规格中扩展配置输入，但必须保持本增量公共 API 的向后兼容。

## 23. 文档和 ADR 实施证据

只有代码实施且完整新鲜门禁通过后，才同步：

- `packages/plugin-request/README.md`：职责、安装组合、公开 API、生命周期、诊断、隐私和排除范围；
- 根 `README.md` 与 `docs/README.md`：记录请求插件第一增量真实存在；
- `docs/architecture/sdk-architecture.md`、`docs/architecture/formalization-readiness.md` 和 `docs/testing/test-strategy.md`：记录插件层、边界和 Chromium 证据；
- `AGENTS.md` 与 `AURORA_RULES.md`：更新当前真实包和决策顺序；
- ADR-003：追加具体请求插件、生命周期、释放、宿主安全和多实例证据，保持 `accepted / in-progress`；
- ADR-005：追加真实插件只消费 event-schema 根入口并调用公共请求解析器的证据，保持 `accepted / in-progress`；
- ADR-006：追加 `sdk-plugin` 依赖矩阵、环境负例、私有入口和循环负例证据，保持 `accepted / in-progress`；
- ADR-007 保持 `accepted / implemented`，除非实施发现既有工具事实错误。

本文和实施计划本身不得修改 ADR 决策状态或实施状态。本增量不需要新 ADR：请求监控产品语义由 PRD 批准，插件分层与共享代理恢复由 ADR-003 批准，插件只消费三个包根公开接口由 ADR-006 批准，协议单一来源与运行时校验由 ADR-005 批准。真正需要长期、高迁移成本决策（如改变协议版本策略、允许协议依赖业务包、删除或重释公共字段、放宽隐私默认值）时，必须先创建 proposed ADR、将当前计划标记 blocked 并停止等待用户审批，不得自行 accepted。

## 24. 完成定义

只有当：

- 第 6 节公共 API 与构建出口一致；
- fetch/XHR 转换、生命周期、回滚、释放、失败隔离和重入门禁全部通过；
- 诊断有界、冻结且无敏感内容；
- 覆盖率达到 85/80/85/85；
- Workspace Policy、ESLint、TypeScript、no-DOM、包入口和依赖负例通过；
- Chromium 门禁全部通过；
- 文档和 ADR 只追加真实新鲜证据；
- 没有排除范围中的实现；

才能把本文 `implementation-status` 改为 `implemented`。本文当前 `implementation-status` 为 `not-started`，且必须在用户批准后才可能开始实施。
