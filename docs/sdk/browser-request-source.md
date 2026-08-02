# Aurora Browser 请求观测能力第一增量规格

- status: approved
- implementation-status: implemented
- last-updated: 2026-07-31
- scope: `packages/browser` 浏览器请求观测能力第一增量
- normative-sources:
  - `Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md`（5.1.1—5.1.8 请求监控、14.2 隐私）
  - `Aurora 架构规范.md`
  - `Aurora 代码规范.md`
  - `Aurora 测试规范.md`
  - `Aurora 文档规范.md`
  - `Aurora ADR 规范.md`
  - `docs/architecture/system-overview.md`
  - `docs/architecture/sdk-architecture.md`
  - `docs/architecture/monorepo-and-build.md`
  - `docs/sdk/browser-environment-foundation.md`
  - `docs/sdk/browser-error-source.md`
  - `docs/protocol/request-event-contract.md`
  - `docs/testing/test-strategy.md`
  - `docs/architecture/formalization-readiness.md`
  - `docs/adr/ADR-003-sdk-plugin-architecture.md`
  - `docs/adr/ADR-005-event-schema-source-of-truth.md`
  - `docs/adr/ADR-006-one-way-dependencies.md`
  - `docs/adr/ADR-007-workspace-package-and-task-tooling.md`

## 1. 选择结论与依赖理由

本增量选择扩展 `@aurora/browser`，不规划 `packages/plugin-request`。

真实公共接口检查得到以下结论：

1. `@aurora/browser` 已公开页面快照、生命周期订阅（`subscribePageLifecycle`）和错误源订阅（`subscribeErrorSources`），但没有请求观测能力；`src/` 中不存在 fetch/XHR 代理、请求事实视图或请求订阅方法；
2. `@aurora/event-schema` 的请求事件协议契约第一增量已实施：`RequestMethod`、`RequestOutcome`、`REQUEST_EVENT_LIMITS`、`parseRequestEventBody`/`parseRequestEventEnvelope` 与请求契约样本已存在；
3. 直接规划请求插件会迫使插件自行探测 `window.fetch`、自行包装 `XMLHttpRequest`、自行管理多订阅者与恢复，形成第二套 Browser 代理与资源管理能力，或访问 Browser 私有路径；这违反 Browser 分层、公共入口和宿主安全门禁；
4. PRD 5.1.1—5.1.8 已批准 fetch/XHR 请求监控的产品语义（method、URL、耗时、状态码、结果类别、同源默认、慢请求、URL 归一化、隐私边界）；
5. ADR-003（accepted）已批准分层架构，并明确"共享原生代理必须在最后一个使用者释放后恢复；引用计数是可选实现"——即共享代理 + 引用计数恢复策略已有长期批准依据，不属于本增量需要新 ADR 的高迁移成本决策。

因此，请求插件的直接上游条件尚不成立。本规格只补齐 Browser 层的安全请求观测能力；协议转换、Core 插件和事件提交均不进入本增量。

## 2. 职责

本增量负责：

- 通过 `@aurora/browser` 根入口提供 `subscribeRequests(listener)` 与 `BrowserSubscription`；
- 安全观测 `window.fetch`，保持参数透传、Promise 成功/拒绝语义、`this` 绑定和返回的 `Promise<Response>` 不被替换、不消费正文；
- 安全观测 `window.XMLHttpRequest`，保持 `instanceof`、`open`/`send`/`abort` 语义，不修改原生 prototype，不覆盖调用方 handler，不读取敏感 Headers 或正文；
- 将观测到的请求同步投影为最小、只读、冻结的 `BrowserRequestSourceEvent` 视图：机制、方法、安全 URL、开始时间、持续时间、HTTP 状态码和结果类别；
- 对请求 URL 使用现有 `sanitizePageUrl()` 脱敏，只保留 HTTP(S) `origin + pathname`，移除查询、片段、用户名和密码；
- 以实例级共享代理 + 引用计数管理 fetch 与 XHR 包装：第一个订阅者安装包装，最后一个订阅者释放后恢复原始宿主引用；
- 提供原子注册、部分失败回滚、幂等取消、实例销毁和销毁后稳定失败；
- 隔离宿主 getter、原生调用、单个订阅回调和单次投影异常；
- 保证多订阅者与多实例互不交叉；
- 复用现有有界、脱敏 Browser 诊断，不保存异常文本、请求、Response、XHR 或原生输入引用；
- 提供单元、包入口、Workspace Policy 和 Chromium 真实浏览器证据。

## 3. 非职责与排除范围

本增量不负责：

- 创建 `packages/plugin-request` 或任何 `CorePlugin`；
- 导入或调用 `@aurora/core`、`@aurora/event-schema` 的请求解析器；
- 将请求事实转换为 `RequestEventBody` 或 `RequestEventEnvelope`；
- 生成事件 ID、协议版本、发生时间或其他信封字段；
- 请求去重、分组、指纹、Source Map、问题聚合或代表样本；
- 允许来源判断、同源判断、跨域允许列表、路径动态段归一化或开发者路径模板（这些属于 SDK 配置层与插件/处理层）；
- 慢请求阈值判断、采样率或任何采样；
- 队列、批量、网络传输、重试、退避或持久化；
- 请求/响应正文、请求/响应头、Cookie、凭据、表单数据或尺寸；
- 完整 URL 查询参数和片段；
- 性能、行为、框架、服务端、数据库或管理平台能力；
- CI、发布、容器、IaC 或云资源；
- 通用事件总线、通用代理框架、通用 Hook 系统或第二套诊断系统。

## 4. 公共接口

本增量只对 `@aurora/browser` 根入口作加法扩展。现有方法、结果码和语义保持不变。

```ts
export const BrowserRequestMechanism = Object.freeze({
  Fetch: 'fetch',
  XmlHttpRequest: 'xhr',
} as const);

export type BrowserRequestMechanism =
  (typeof BrowserRequestMechanism)[keyof typeof BrowserRequestMechanism];

export const BrowserRequestOutcome = Object.freeze({
  Success: 'success',
  HttpError: 'http_error',
  NetworkError: 'network_error',
  Timeout: 'timeout',
  Canceled: 'canceled',
} as const);

export type BrowserRequestOutcome =
  (typeof BrowserRequestOutcome)[keyof typeof BrowserRequestOutcome];

export interface BrowserFetchRequestSourceEvent {
  readonly mechanism: typeof BrowserRequestMechanism.Fetch;
  readonly method: string;
  readonly url: string;
  readonly startedAt: number;
  readonly durationMs: number;
  readonly outcome: BrowserRequestOutcome;
  readonly statusCode: number | null;
}

export interface BrowserXhrRequestSourceEvent {
  readonly mechanism: typeof BrowserRequestMechanism.XmlHttpRequest;
  readonly method: string;
  readonly url: string;
  readonly startedAt: number;
  readonly durationMs: number;
  readonly outcome: BrowserRequestOutcome;
  readonly statusCode: number | null;
}

export type BrowserRequestSourceEvent =
  | BrowserFetchRequestSourceEvent
  | BrowserXhrRequestSourceEvent;

export type BrowserRequestSourceListener = (event: BrowserRequestSourceEvent) => void;

export interface BrowserCapabilities {
  // 现有字段保持不变
  readonly canObserveRequests: boolean;
}

export interface BrowserEnvironment {
  // 现有方法保持不变
  subscribeRequests(listener: BrowserRequestSourceListener): BrowserSubscribeResult;
}
```

同时将 `BrowserCapabilityName` 增加 `RequestSource: 'request_source'`，并将 `BrowserDiagnostic.eventType` 与内部诊断输入的类型扩为 `PageLifecycleEventType | BrowserErrorSourceEventType | BrowserRequestSourceEventType`，其中新增：

```ts
export const BrowserRequestSourceEventType = Object.freeze({
  Fetch: 'fetch',
  Xhr: 'xhr',
} as const);

export type BrowserRequestSourceEventType =
  (typeof BrowserRequestSourceEventType)[keyof typeof BrowserRequestSourceEventType];
```

本增量复用现有 `BrowserSubscribeResult`、`BrowserSubscription`、`BrowserUnsubscribeResult` 和 `BrowserDestroyResult`，不新增重复的结果体系。`BrowserCapabilityName.RequestSource` 用于订阅、能力探测与诊断 capability 字段。

请求事实是同步通知期间的只读投影。Browser 不保留 `Request`、`RequestInit`、`Response`、`XMLHttpRequest`、原生事件或任何嵌套对象引用；回调返回后这些值不再被读取。

## 5. 精确生命周期

### 5.1 创建

`createBrowserEnvironment()` 仍在调用时捕获宿主引用并形成实例级状态。模块导入时不得读取全局或安装代理。能力探测同时计算 `canObserveRequests`：仅当 `window.fetch` 可安全读取为函数，且 `window.XMLHttpRequest` 可安全读取为函数/构造器时为 `true`。fetch 与 XHR 二者中任一缺失仍可订阅（缺失的一方不产生事实）。

### 5.2 订阅

`subscribeRequests(listener)` 按以下顺序执行：

1. 非函数返回 `invalid_listener`；
2. Browser 实例已销毁返回 `destroyed`；
3. 监听器能力缺失（fetch 与 XHR 均不可观测）返回 `environment_unavailable`；
4. 在实例级共享代理状态上登记一个订阅者（引用计数加一）；第一个订阅者安装 fetch/XHR 包装；
5. 若包装安装过程中宿主读取或调用抛错，回滚该订阅者登记并返回 `listener_registration_failed`；
6. 全部成功返回冻结的 `BrowserSubscription`。

注册期间不得调用或替换 `window.onerror`、`window.onunhandledrejection`，不得修改 `Request`、`Response`、`XMLHttpRequest` 的原型或静态成员。

### 5.3 通知

每次被观测请求完成（成功、HTTP 错误、网络失败、超时或取消）时，仅通知该请求开始后仍处于活动状态的订阅者；一次请求对一个订阅者最多产生一条请求完成事实。事实在同步投影中冻结；单个订阅者抛错只追加一条脱敏 `callback_failed / notify` 诊断，不向宿主传播，也不阻止同一实例或其他实例的订阅者收到该请求事实。

### 5.4 取消、停止与销毁

首次 `unsubscribe()` 先逻辑停用该订阅者，再从共享代理的引用计数中移除；当计数归零时恢复原始 `window.fetch` 与 `window.XMLHttpRequest` 引用。重复取消返回 `already_unsubscribed`。

`BrowserEnvironment.destroy()` 释放页面生命周期、错误源与请求观测的全部活动订阅，并在最后一个请求订阅者释放时恢复原始 fetch/XHR 引用。首次调用返回 `destroyed`，重复调用返回 `already_destroyed`。销毁后残留的原生回调与已保留的请求 Promise 完成回调必须成为无副作用空操作，不得通知消费者。销毁后请求订阅方法返回 `destroyed`。

本增量不定义独立的插件 `initialize/start/stop/destroy`；这些 Core 生命周期规则对 Browser 前置能力不适用。

## 6. fetch 数据流与宿主兼容

```text
调用方 fetch(input, init)
        ↓
Browser 共享包装 fetch（仅首个订阅者安装，最后一个订阅者释放时恢复）
        ↓
安全读取 method/url（不读取正文，不修改 input/init）
        ↓
调用原始 fetch（透传全部参数，保留 this 与返回值语义）
        ↓
Promise 完成 → 读取 response.status（不消费 response.body）
        ↓
同步投影冻结的 fetch 请求事实 → 通知活动订阅者
```

宿主兼容硬约束：

- 包装 `fetch` 必须向原始 `fetch` 透传与调用方收到的一模一样的参数，包括 `input`（字符串、`URL` 或 `Request`）与 `init`；不解析、不规范化、不复制、不修改这些对象；
- 返回的必须是原始 `fetch` 返回的同一个 Promise 对象，其成功值（`Response`）与拒绝原因（如 `TypeError`）原样保留；Browser 不消费 `response.body`、不调用 `response.clone()`、不读取任何响应正文；
- 同步阶段（包装函数体内）安全读取 method/url；读取失败不抛给调用方，不改变调用方获得的 Promise 语义；
- 若原始 `fetch` 同步抛错，包装必须把同一异常原样抛给调用方；若异步拒绝，包装不替换拒绝原因；
- 包装函数与原始函数以同一 receiver 绑定调用，保持 `this` 行为；
- `Request` 与 `RequestInit` 保持原引用，包装不写属性、不删除字段；
- 单次请求完成通知在 Promise 已 settle 后的微任务中同步投影（读取 `response.status` 不消费正文）；订阅者抛错被隔离，不影响 Promise 本身；
- 最后一个订阅者释放后，`window.fetch` 恢复为原始引用；此后调用方行为与未安装时完全一致；
- 若原始 `fetch` 不可观测或读取抛错，`subscribeRequests` 仍可在 XHR 可用时成功；该请求机制不产生事实。

### 6.1 fetch 结果类别与状态码

| 观察到的情形                    | outcome             | statusCode |
| ------------------------------- | ------------------- | ---------- |
| `response` 成功，status 2xx/3xx | `success`           | 实际值     |
| `response` 成功，status 4xx/5xx | `http_error`        | 实际值     |
| Promise 拒绝（网络失败等）      | `network_error`     | `null`     |
| 同步抛错                        | 原样抛给调用方       | 不适用     |
| 调用方通过 AbortController 取消 | `canceled`           | `null`     |

本增量不区分 timeout 与网络失败（fetch 的 `AbortSignal.timeout` 由调用方决定）；fetch 取消以取消后的 Promise 拒绝（`AbortError`）与调用方中止信号共同判断为 `canceled`。慢请求阈值、采样与超时策略属于插件/配置层，不进入本增量。

### 6.2 fetch 方法/URL 读取规则

- `input` 为字符串：method 取 `init?.method` 的字符串值，缺省为 `GET`；url 为该字符串；
- `input` 为 `URL`：method 同上；url 为该 URL 的 href 字符串；
- `input` 为 `Request`：method 优先取 `request.method` 字符串值，否则取 `init?.method`，再缺省 `GET`；url 取 `request.url`；
- 所有读取使用 `readProperty` 安全访问；读取失败或取值不是字符串时，method 使用 `'GET'` 降级、url 使用 `null` 降级，且该请求不产生事实（不伪造 URL）；
- url 经 `sanitizePageUrl()` 脱敏后形成 `url`；脱敏失败为 `null` 时不产生事实。

## 7. XHR 数据流与宿主兼容

```text
调用方 new XMLHttpRequest() / open() / send() / abort()
        ↓
Browser 共享包装（仅首个订阅者安装，最后一个订阅者释放时恢复）
        ↓
原生对象原样创建与使用；open/send/abort 透传
        ↓
浏览器自身 load/error/abort/timeout 完成
        ↓
同步投影冻结的 XHR 请求事实 → 通知活动订阅者
```

宿主兼容硬约束：

- 不修改 `XMLHttpRequest.prototype` 或静态成员；`new XMLHttpRequest()` 仍创建原生实例，`instanceof XMLHttpRequest` 行为不变；
- `open(method, url, async?, user?, password?)` 与 `send(body?)`、`abort()` 的参数和返回语义原样透传；包装不改写调用方参数对象；
- 包装不读取 `response`、`responseText`、`responseXML` 或任何响应正文；不读取 `getAllResponseHeaders()` 或任何敏感 Headers；
- 不覆盖调用方设置的 `onload`、`onerror`、`onabort`、`ontimeout` 或 `onreadystatechange` handler；不在发送后替换这些属性；
- 不阻止已有事件监听器；不调用 `preventDefault()`/`stopPropagation()`/`stopImmediatePropagation()`；
- 完整清理内部监听器；`abort()`、`send()` 失败或实例销毁后不再通知；
- `open()` 中安全读取 method/url；读取失败不抛给调用方，不改变 `open` 返回值；
- 同一原生 XHR 实例的请求完成事实在一个订阅周期内至多通知一次；
- 最后一个订阅者释放后恢复原始 `window.XMLHttpRequest` 引用。

### 7.1 XHR 结果类别与状态码

| 观察到的情形           | outcome          | statusCode         |
| ---------------------- | ---------------- | ------------------ |
| `load`，status 2xx/3xx | `success`        | `xhr.status`       |
| `load`，status 4xx/5xx | `http_error`     | `xhr.status`       |
| `error` 事件           | `network_error`  | `null`             |
| `abort` 事件           | `canceled`       | `null`             |
| `timeout` 事件         | `timeout`        | `null`             |
| `open`/`send` 同步抛错 | 原样抛给调用方    | 不适用             |

`xhr.status` 通过安全读取；非数字或读取失败时 `statusCode` 为 `null`。method/url 在 `open()` 时安全读取并脱敏；url 脱敏失败或 method 非字符串时该请求不产生事实。

## 8. 多订阅者与引用计数

- 实例内多个 `subscribeRequests` 订阅者共享同一对 fetch/XHR 包装；包装内部只安装一次原生代理；
- 订阅者独立持有自己的活动状态与取消句柄；取消一个订阅者不移除其他订阅者的通知；
- 引用计数为实例级（每个 `createBrowserEnvironment()` 独立）；计数归零时恢复原始 fetch/XHR 引用；
- 若宿主后续修改了 `window.fetch`（例如调用方自身替换），本实例只保存并恢复自己安装时的原始引用，不覆盖调用方后续安装的其他包装；
- 不同 Browser 实例各自安装并恢复自己的原始引用；一个实例销毁不影响其他实例的包装与引用计数；
- 不使用模块级 `Set`、`Map`、数组或可变对象保存订阅者或引用计数。

## 9. 隐私与数据最小化

本增量禁止读取、存储、诊断或输出：Cookie、Authorization、Token、Storage、请求/响应正文、请求/响应头、表单、完整 DOM、页面文本、用户输入、DOM 元素引用、原生 `Request`/`Response`/`XMLHttpRequest`/事件引用、完整 URL 查询或片段、用户名/密码、用户指纹、原始 IP 和无限对象图。

URL 仅允许现有 Browser 脱敏结果 `origin + pathname`。method、statusCode 与结果类别是请求协议已批准的候选事实；Browser 只同步交给调用方，不写入实例状态、诊断、日志、返回结果或异步任务。请求事实在回调返回后不再被读取或保留。

## 10. 宿主安全

实现和测试必须证明：

- 不覆盖 `window.onerror` 或 `window.onunhandledrejection`；
- 不调用 `preventDefault()`、`stopPropagation()` 或 `stopImmediatePropagation()`；
- 不修改 `Request`、`Response`、`RequestInit`、`XMLHttpRequest.prototype` 或任何原生对象原型；
- 共享代理在第一个订阅者安装、最后一个订阅者释放后恢复；恢复后 `window.fetch`/`window.XMLHttpRequest` 身份与原始一致；
- 多订阅者不会重复多层包装；一个订阅者取消不会移除其他订阅者的通知；
- 包装 `fetch` 保持参数透传、Promise 成功/拒绝语义、`this` 行为和返回对象；
- 包装 `XMLHttpRequest` 不破坏 `instanceof`、`open`/`send`/`abort` 语义，不覆盖调用方 handler，不读取正文或敏感 Headers；
- 单个观测回调失败不影响网络请求、Promise 或宿主脚本；一个订阅者失败不影响其他订阅者；
- 一个实例销毁不影响其他实例；
- 不形成 SDK 自身递归观测机制（上报请求不在本增量处理；插件层的上报排除属于后续增量）；
- 没有全局可变单例。

请求观测本身不执行 SDK 协议转换或 Core 提交，因此不会由自身处理错误再触发 Aurora 请求提交。回调抛出的错误由同步 `try/catch` 隔离，不重新抛出、不调度 Promise、不写控制台，从源头阻断无限递归通知。

## 11. 失败与诊断

复用现有最大 100 条、实例级、冻结的 `BrowserDiagnostic`。允许的诊断只包含序号、稳定代码、操作、能力和事件类型：

- 全局或方法 getter 失败：`global_access_failed` / `property_read_failed`；
- 包装安装失败：`listener_registration_failed / subscribe / request_source`；
- 恢复失败：`listener_removal_failed / unsubscribe|destroy / request_source`；
- 事实属性读取失败：`property_read_failed / notify / request_source / fetch|xhr`；
- 调用方回调失败：`callback_failed / notify / request_source / fetch|xhr`。

不得记录异常对象、异常文本、堆栈、URL 原值、method、statusCode、响应、请求、XHR、事件或调用方数据。普通输入降级不得静默：可表达的宿主异常进入诊断，类型缺失按公开 `null`/不产生事实语义返回。

## 12. 资源释放与多实例

每个订阅者拥有独立活动状态；每个 Browser 实例拥有独立的请求观测管理器、引用计数和活动订阅者集合。不得使用模块级 `Set`、`Map`、数组或可变对象保存订阅者或计数。

部分订阅失败必须回滚该订阅者的登记与已安装的包装。取消或销毁先逻辑停用，再从引用计数中移除；恢复异常不会恢复活动状态。多实例测试必须证明一个实例销毁后另一个仍能接收请求事实，且最终销毁后 `window.fetch`/`window.XMLHttpRequest` 身份恢复。

## 13. 依赖与禁止依赖

本增量不增加 `@aurora/browser` 的运行时依赖。Browser 继续保持 `aurora.layer: sdk-browser`、单一根出口和 `sideEffects: false`。

自动门禁必须证明：Core、event-schema 和任何现有包均不依赖 Browser 请求观测实现；Browser 不依赖具体插件；不存在循环；不存在跨包 `src`、`internal` 或未导出路径；不存在请求协议类型或第二套请求协议；不存在网络、队列或持久化依赖。

Workspace Policy、ESLint、TypeScript、包入口测试、私有路径负例和依赖图负例共同承担门禁。现有 `forbidden-host-mutation` 规则必须继续拒绝原型修改；新增 ESLint 限制禁止 Browser 请求源源码直接赋值 `window.fetch`/`window.XMLHttpRequest` 之外的宿主全局、修改 `XMLHttpRequest.prototype`、覆盖 `on*` handler 属性和读取 `responseText`/`getAllResponseHeaders`。

## 14. 代码规范映射

- 所有生产和测试 TypeScript 继续启用 `strict`、`exactOptionalPropertyTypes` 和现有严格规则；
- 原生入口参数使用 `unknown`，通过 `readProperty()` 立即收窄；
- 禁止无说明的 `any`、`Object`、`Function`、`Record<string, any>`、双重断言、非空断言和错误抑制；
- 公共函数与方法显式声明参数和返回类型；
- 文件名使用 `kebab-case`，类型使用 `PascalCase`，函数和变量使用 `camelCase`，布尔值使用 `is`、`has`、`can`、`should` 前缀；
- `request-source.ts` 只负责请求事实视图、共享代理、引用计数、订阅与释放；`request-observer.ts`（或等价的单一职责文件）只负责 fetch 与 XHR 的安装/恢复；不创建 `utils`、`helpers`、`common` 或 `misc`；
- 公共 API 只增加本规格列出的类型、常量和一个方法；
- 只复用当前包内已有 `safe-access`、URL 脱敏、诊断和订阅结果契约；
- 错误不静默吞掉，不输出敏感日志，不在生产路径使用 `console`；
- 不设计通用插件框架、采集总线、协议或 Browser 之外的监听体系。

与 Core 插件注册、事件信封运行时校验、协议消费者契约有关的代码规范在本 Browser 增量不适用，因为本增量不创建插件、不构造协议对象、不提交事件。

## 15. 测试与覆盖率

单元测试至少覆盖：公共常量与联合类型、能力探测、无环境、非法 listener、正常订阅、fetch 字符串/URL/Request 输入、fetch init method 覆盖、fetch 成功/HTTP 错误/网络拒绝/取消、fetch 同步抛错原样透传、fetch Response 未被消费、Request/RequestInit 不变、XHR load/error/abort/timeout、open/send 异常透传、open 安全读取、XHR handler 不覆盖、XHR 敏感 Header/正文不读取、URL 脱敏、注册失败回滚、引用计数安装/恢复、取消与重复取消、销毁与重复销毁、销毁后拒绝订阅、恢复失败诊断、回调抛错隔离、单次失败后继续、多订阅者、多实例、宿主 API 恢复、无原生对象引用保留、防递归和多实例隔离。

覆盖率门槛固定为 lines 85%、branches 80%、functions 85%、statements 85%。不得通过排除逻辑文件、删除失败测试或降低阈值恢复门禁。

## 16. Chromium 真实浏览器验证

现有 Playwright Chromium 门禁必须扩展并验证：

- 构建后的根模块可加载，导入时不安装代理；
- 真实 `fetch` 成功（含字符串与 Request 输入）各产生一次事实；
- 真实 `fetch` 网络失败（不存在的端点）产生 `network_error`；
- 真实 XHR 成功与 `abort` 各产生一次事实；
- 请求与响应正文未被消费（fetch 的 `Response` 可被调用方正常读取，XHR 的 `responseText` 可被调用方正常读取）；
- `window.fetch` 与 `window.XMLHttpRequest` 身份在订阅前、订阅后、取消后、销毁后正确恢复；`instanceof` 行为不变；
- 调用方 `fetch` 的成功/拒绝语义、返回对象和 `this` 行为不变；
- 调用方 XHR 的 `onload`/`onerror`/`onabort` handler 正常执行且不被覆盖；
- 取消后不再通知，销毁后代理恢复；
- 多订阅者各收到一次事实，一个取消不影响另一个；
- 多实例不交叉移除，一个实例销毁后另一个仍接收；
- 回调内部抛错不产生未处理页面错误、不破坏页面请求、不产生无限递归。

模拟 DOM 不能替代这些证据。

## 17. 体积与副作用

`@aurora/browser` 继续设置 `sideEffects: false`。模块导入不得自动创建环境、安装代理或写入宿主；调用方必须显式创建实例并显式订阅。

测试/发布设计中的单插件预算为 gzip 增量不超过 8 KiB。该预算不直接把 Browser 基础包等同为一个插件，但本增量必须记录新增 `dist` 请求观测产物的可重复 gzip 大小，并检查完整 Browser 构建产物的变化。当前 `tsc` 构建不是最终 bundler/tree-shaking 证据，因此发布前体积结论标记为 `requires-benchmark`；本增量不得为此引入发布系统或 bundler。

## 18. 文档与 ADR

实施完成后必须同步 `packages/browser/README.md`、根 README、正式文档索引、系统/SDK/Monorepo 架构、测试策略、正式化追踪、`AGENTS.md` 和 `AURORA_RULES.md` 的真实实现状态。

ADR-003 和 ADR-006 只追加 Browser 请求观测能力的真实实施证据并保持 `accepted / in-progress`；ADR-005 保持 `accepted / in-progress`，因为本增量不消费或修改协议；ADR-007 保持 `accepted / implemented`。计划或规格的存在不改变任何 ADR 状态和实施状态。本增量不需要新 ADR：共享原生代理 + 引用计数恢复是 ADR-003 已批准的长期决策，请求监控的产品语义已由 PRD 批准，未引入新的高迁移成本长期选择。

## 19. 后续模块衔接

本增量通过后，独立的请求采集插件规格可以只从 `@aurora/browser` 根入口消费 `subscribeRequests()`，再经 event-schema 请求契约与 Core 草稿入口完成转换与提交。请求插件仍必须单独解决允许来源/同源判断、慢请求阈值、URL 路径归一化、采样、事件 ID/时间边界和 Core 提交行为；本规格不替它批准这些接口或实现，也不授权在本增量内创建 `packages/plugin-request`。

## 20. 完成定义

只有当公共契约、共享代理安装/恢复、引用计数、释放、异常隔离、隐私、宿主不变、多订阅者、多实例、单元覆盖率、包入口、Workspace Policy 和 Chromium 真实浏览器门禁全部以新鲜输出通过，且文档与 ADR 证据同步，才能把 `implementation-status` 改为 `implemented`。本规格被批准不表示代码已经存在。
