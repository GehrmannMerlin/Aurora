# Aurora Browser 错误源订阅能力第一增量规格

- status: approved
- implementation-status: implemented
- last-updated: 2026-07-31
- scope: `packages/browser` 浏览器错误源订阅能力第一增量
- normative-sources:
  - `Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md`
  - `Aurora 架构规范.md`
  - `Aurora 代码规范.md`
  - `Aurora 测试规范.md`
  - `Aurora 文档规范.md`
  - `Aurora ADR 规范.md`
  - `docs/architecture/system-overview.md`
  - `docs/architecture/sdk-architecture.md`
  - `docs/architecture/monorepo-and-build.md`
  - `docs/sdk/browser-environment-foundation.md`
  - `docs/protocol/event-schema-foundation.md`
  - `docs/protocol/error-event-contract.md`
  - `docs/testing/test-strategy.md`
  - `docs/architecture/formalization-readiness.md`
  - `docs/adr/ADR-003-sdk-plugin-architecture.md`
  - `docs/adr/ADR-005-event-schema-source-of-truth.md`
  - `docs/adr/ADR-006-one-way-dependencies.md`
  - `docs/adr/ADR-007-workspace-package-and-task-tooling.md`

## 1. 选择结论与依赖理由

本增量选择扩展 `@aurora/browser`，不规划 `packages/plugin-error`。

真实公共接口检查得到以下结论：

1. `@aurora/browser` 只公开页面快照和 `visibilitychange`、`pagehide`、`pageshow` 生命周期订阅，没有 `error` 或 `unhandledrejection` 错误源订阅；
2. `@aurora/core` 的 `CorePluginContext` 只有 `submitEvent(input: unknown): CoreEventResult`，没有浏览器环境端口、事件 ID、时钟或信封工厂；
3. `@aurora/event-schema` 的错误解析器接收已经符合协议形态的对象，负责校验、复制和资源 URL 脱敏，不负责从原生浏览器事件生成信封、事件 ID、时间或原始 Promise 拒绝值；
4. 直接规划错误插件会迫使插件自行探测 `window`、注册全局监听器，形成第二套 Browser 环境与资源管理能力，或访问 Browser 私有路径；这违反 Browser 分层、公共入口和宿主安全门禁。

因此，错误插件的直接上游条件尚不成立。本规格只补齐 Browser 层的安全错误源订阅能力；协议转换、Core 插件和事件提交均不进入本增量。

## 2. 职责

本增量负责：

- 通过 `addEventListener` 安全订阅 `window` 的捕获阶段 `error`；
- 通过 `addEventListener` 安全订阅 `window` 的 `unhandledrejection`；
- 区分 JavaScript 运行时错误、未处理 Promise 拒绝和资源加载错误；
- 将原生事件同步投影为最小、只读、冻结的 Browser 错误源视图；
- 对资源地址和 JavaScript 源地址使用现有 Browser URL 脱敏能力，仅保留 HTTP(S) `origin + pathname`；
- 原子注册两个监听器，第二个注册失败时回滚第一个；
- 提供幂等取消、实例销毁和销毁后稳定失败；
- 隔离宿主 getter、监听器方法、单个订阅回调和单次事件投影异常；
- 保证多实例与多订阅相互隔离；
- 复用现有有界、脱敏 Browser 诊断，不保存异常文本或原生输入；
- 提供单元、包入口、Workspace Policy 和 Chromium 真实浏览器证据。

## 3. 非职责与排除范围

本增量不负责：

- 创建 `packages/plugin-error` 或任何 `CorePlugin`；
- 导入或调用 `@aurora/core`、`@aurora/event-schema`；
- 将原生错误转换为 `ErrorEventBody` 或 `ErrorEventEnvelope`；
- 生成事件 ID、协议版本、发生时间或其他信封字段；
- 递归复制、序列化或规范化 Promise 拒绝原因；
- 将资源元素映射为 event-schema 的 `ErrorResourceType`；
- 错误去重、分组、指纹、Source Map 或 Stack Frame 解析；
- 采样、队列、批量、传输、重试、持久化或网络能力；
- 请求、性能、行为、框架、服务端、数据库或管理平台能力；
- CI、发布、容器、IaC 或云资源；
- 通用事件总线、通用监听器框架、通用采集框架或第二套诊断系统。

## 4. 公共接口

本增量只对 `@aurora/browser` 根入口作加法扩展。现有方法、结果码和语义保持不变。

```ts
export const BrowserErrorSourceEventType = Object.freeze({
  JavaScript: 'javascript_error',
  UnhandledRejection: 'unhandled_rejection',
  Resource: 'resource_error',
} as const);

export type BrowserErrorSourceEventType =
  (typeof BrowserErrorSourceEventType)[keyof typeof BrowserErrorSourceEventType];

export interface BrowserJavaScriptErrorSourceEvent {
  readonly type: typeof BrowserErrorSourceEventType.JavaScript;
  readonly message: string | null;
  readonly sourceUrl: string | null;
  readonly error: unknown;
}

export interface BrowserUnhandledRejectionSourceEvent {
  readonly type: typeof BrowserErrorSourceEventType.UnhandledRejection;
  readonly reason: unknown;
}

export interface BrowserResourceErrorSourceEvent {
  readonly type: typeof BrowserErrorSourceEventType.Resource;
  readonly tagName: string | null;
  readonly sourceUrl: string | null;
  readonly rel: string | null;
  readonly as: string | null;
}

export type BrowserErrorSourceEvent =
  | BrowserJavaScriptErrorSourceEvent
  | BrowserUnhandledRejectionSourceEvent
  | BrowserResourceErrorSourceEvent;

export type BrowserErrorSourceListener = (event: BrowserErrorSourceEvent) => void;

export interface BrowserCapabilities {
  // 现有字段保持不变
  readonly canObserveErrorSources: boolean;
}

export interface BrowserEnvironment {
  // 现有方法保持不变
  subscribeErrorSources(listener: BrowserErrorSourceListener): BrowserSubscribeResult;
}
```

同时将 `BrowserCapabilityName` 增加 `ErrorSource: 'error_source'`，并将 `BrowserDiagnostic.eventType` 与内部诊断输入的类型扩为 `PageLifecycleEventType | BrowserErrorSourceEventType`。本增量复用现有 `BrowserSubscribeResult`、`BrowserSubscription`、`BrowserUnsubscribeResult` 和 `BrowserDestroyResult`，不新增重复的结果体系。

`error`、`reason` 是同步通知期间的原始 `unknown` 事实。Browser 不遍历、不复制、不序列化、不诊断输出且不在回调返回后保留它们。原生 `Event`、`ErrorEvent`、`PromiseRejectionEvent` 和 DOM 元素本身永不进入公共视图。

## 5. 精确生命周期

### 5.1 创建

`createBrowserEnvironment()` 仍在调用时捕获宿主引用并形成实例级状态。模块导入时不得读取全局或注册监听器。能力探测同时计算 `canObserveErrorSources`：仅当 `window` 的 `addEventListener` 与 `removeEventListener` 均可安全读取为函数时为 `true`。

### 5.2 订阅

`subscribeErrorSources(listener)` 按以下顺序执行：

1. 非函数返回 `invalid_listener`；
2. Browser 实例已销毁返回 `destroyed`；
3. 监听器能力缺失返回 `environment_unavailable`；
4. 以捕获模式注册 `error`；
5. 注册 `unhandledrejection`；
6. 第二次注册失败时，以完全相同的事件名、回调和捕获参数移除已注册的 `error`；
7. 全部成功后返回冻结的 `BrowserSubscription`。

注册期间不得调用或替换 `window.onerror`、`window.onunhandledrejection`。

### 5.3 通知

每次原生事件只进入该订阅对应的一个回调：

- `unhandledrejection` 生成一个 `UnhandledRejection` 视图；
- 捕获阶段 `error` 若具有非 `window` 的资源目标事实，生成一个 `Resource` 视图；
- 其他 `error` 生成一个 `JavaScript` 视图。

投影完成后立即调用订阅者。一个订阅者抛错只追加一条脱敏 `callback_failed / notify` 诊断，不向宿主传播，也不阻止同一实例或其他实例的订阅者收到该事件。投影读取失败以 `null` 降级并记录有界诊断，不得抛出原始异常。

### 5.4 取消、停止与销毁

首次 `unsubscribe()` 先将订阅逻辑停用，再逆序移除 `unhandledrejection` 与 `error`。`error` 移除必须使用捕获参数 `true`。重复取消返回 `already_unsubscribed`。

`BrowserEnvironment.destroy()` 释放页面生命周期和错误源的全部活动订阅。首次调用返回 `destroyed`，重复调用返回 `already_destroyed`。销毁后已有残留原生回调即使因宿主移除失败而被调用，也必须成为无副作用空操作；不得通知消费者。销毁后两类订阅方法均返回 `destroyed`。

本增量不定义独立的插件 `initialize/start/stop/destroy`；这些 Core 生命周期规则对 Browser 前置能力不适用。

## 6. 数据流

```text
window error / unhandledrejection
              ↓
Browser 安全读取与分类
              ↓
冻结的最小只读错误源视图
              ↓
同步调用 BrowserErrorSourceListener
```

数据流在 Listener 返回时结束。没有 event-schema 协议对象、Core 提交、队列、网络或持久化分支。

## 7. 三类错误输入

### 7.1 JavaScript 运行时错误

Browser 只读取原生 `error` 事件的 `message`、`filename` 和 `error`。`message` 仅接受字符串，否则为 `null`；`filename` 通过现有 `sanitizePageUrl()` 形成 `sourceUrl`，非法、非 HTTP(S) 或读取失败时为 `null`；`error` 保持 `unknown`，只在同步回调期间传递。

缺少 `error` 对象、跨域脚本只提供字符串消息或非标准事件时仍可生成 JavaScript 视图，不伪造 `Error`。

### 7.2 未处理 Promise 拒绝

Browser 只安全读取 `reason` 并作为 `unknown` 同步传递。Browser 不调用 `JSON.stringify`，不递归遍历，不尝试处理循环或超深对象，不把 Promise 或事件对象放入视图。循环、深度、字段和协议安全值限制由未来错误插件调用 event-schema 公共能力处理，不在本增量复制。

### 7.3 资源加载错误

Browser 不公开 DOM 目标。它只在同步处理期间从目标复制以下事实：

- 小写 `tagName`；
- 从 `currentSrc`、`src`、`href` 中按顺序取得的第一个非空字符串，并经 `sanitizePageUrl()` 形成 `sourceUrl`；
- 小写 `rel`；
- 小写 `as`。

读取失败或未知资源类型以 `null` 表示。Browser 不把 `script`、`link`、`img`、`font` 等事实映射为协议枚举，不修改目标元素，也不保留元素引用。

## 8. 隐私与数据最小化

本增量禁止读取、存储、诊断或输出：Cookie、Authorization、Token、Storage、请求/响应体、表单、完整 DOM、页面文本、用户输入、DOM 元素引用、原生事件引用、完整 URL 查询或片段、用户指纹、原始 IP 和无限对象图。

URL 仅允许现有 Browser 脱敏结果 `origin + pathname`。错误消息是错误协议已经允许的候选事实，但 Browser 不记录它；仅同步交给调用方。`error` 和 `reason` 不进入实例状态、诊断、日志、返回结果或异步任务。

## 9. 宿主安全

实现和测试必须证明：

- 不覆盖 `window.onerror` 或 `window.onunhandledrejection`；
- 只使用监听器，不赋值事件处理属性；
- 不调用 `preventDefault()`、`stopPropagation()` 或 `stopImmediatePropagation()`；
- 不改变事件传播、`defaultPrevented` 或浏览器默认行为；
- 不修改原生对象原型；
- 不替换 `fetch`、XHR、History 或其他原生 API；
- 不修改原生事件、Error、Promise reason 或资源 DOM 元素；
- 一个回调异常不影响其他回调或宿主脚本；
- 单次投影失败不阻止后续事件；
- 所有监听器可释放，重复取消和销毁安全；
- 一个实例的取消或销毁不移除其他实例的监听器；
- 没有全局可变单例。

错误源能力本身不执行 SDK 协议转换或 Core 提交，因此不会由自身处理错误再触发 Aurora 错误提交。回调抛出的错误由同步 `try/catch` 隔离，不重新抛出、不调度 Promise、不写控制台，从源头阻断无限递归通知。

## 10. 失败与诊断

复用现有最大 100 条、实例级、冻结的 `BrowserDiagnostic`。允许的诊断只包含序号、稳定代码、操作、能力和事件类型：

- 全局或方法 getter 失败：`global_access_failed` / `property_read_failed`；
- 注册失败：`listener_registration_failed / subscribe / error_source`；
- 移除失败：`listener_removal_failed / unsubscribe|destroy / error_source`；
- 视图属性读取失败：`property_read_failed / notify / error_source / <event-type>`；
- 调用方回调失败：`callback_failed / notify / <event-type>`。

不得记录异常对象、异常文本、堆栈、URL 原值、消息、reason、事件、DOM 或调用方数据。普通输入降级不得静默：可表达的宿主异常进入诊断，类型缺失按公开 `null` 语义返回。

## 11. 资源释放与多实例

每个订阅拥有自己的两个原生回调和精确注册参数；每个 Browser 实例拥有自己的错误源管理器和活动订阅集合。不得使用模块级 `Set`、`Map`、数组或可变对象保存订阅。

部分注册失败必须回滚该订阅已经完成的注册。取消或销毁先逻辑停用，再执行物理移除；移除异常不会恢复活动状态。多实例测试必须证明一个实例销毁后另一个仍能接收事件，且最终销毁后对应监听器数量归零。

## 12. 依赖与禁止依赖

本增量不增加 `@aurora/browser` 的运行时依赖。Browser 继续保持 `aurora.layer: sdk-browser`、单一根出口和 `sideEffects: false`。

自动门禁必须证明：Core、event-schema 和任何现有包均不依赖 Browser 错误源实现；Browser 不依赖具体插件；不存在循环；不存在跨包 `src`、`internal` 或未导出路径；不存在 event-schema 类型或第二套错误协议；不存在网络、队列或持久化依赖。

Workspace Policy、ESLint、TypeScript、包入口测试、私有路径负例和依赖图负例共同承担门禁。现有 `forbidden-host-mutation` 规则必须继续拒绝事件处理属性、原生 API 和原型修改。

## 13. 代码规范映射

- 所有生产和测试 TypeScript 继续启用 `strict`、`exactOptionalPropertyTypes` 和现有严格规则；
- 原生事件入口参数使用 `unknown`，通过 `readProperty()` 立即收窄；
- 禁止无说明的 `any`、`Object`、`Function`、`Record<string, any>`、双重断言、非空断言和错误抑制；
- 公共函数与方法显式声明参数和返回类型；
- 文件名使用 `kebab-case`，类型使用 `PascalCase`，函数和变量使用 `camelCase`，布尔值使用 `is`、`has`、`can`、`should` 前缀；
- `error-source.ts` 只负责错误源视图、订阅和释放；不得创建 `utils`、`helpers`、`common` 或 `misc`；
- 公共 API 只增加本规格列出的类型、常量和一个方法；
- 只复用当前包内已有 `safe-access`、URL 脱敏、诊断和订阅结果契约；
- 错误不静默吞掉，不输出敏感日志，不在生产路径使用 `console`；
- 不设计通用插件框架、采集总线、协议或 Browser 之外的监听体系。

与 Core 插件注册、事件信封运行时校验、协议消费者契约有关的代码规范在本 Browser 增量不适用，因为本增量不创建插件、不构造协议对象、不提交事件。

## 14. 测试与覆盖率

单元测试至少覆盖：公共常量与联合类型、能力探测、无环境、非法 listener、正常注册、捕获参数、第二次注册失败回滚、JavaScript Error、缺失 `error`、字符串消息、Promise Error/string/有限对象/循环/超深 reason 的不遍历透传、资源 `script/link/img`、未知资源目标、URL 查询与片段脱敏、getter 抛错、回调抛错、单次失败后继续、取消与重复取消、销毁与重复销毁、销毁后拒绝订阅、移除抛错后的逻辑停用、无原生事件/DOM 保留、宿主对象不修改、防递归和多实例隔离。

覆盖率门槛固定为 lines 85%、branches 80%、functions 85%、statements 85%。不得通过排除逻辑文件、删除失败测试或降低阈值恢复门禁。

## 15. Chromium 真实浏览器验证

现有 Playwright Chromium 门禁必须扩展并验证：

- 构建后的根模块可加载，导入时不注册监听器；
- 捕获同步 JavaScript 运行时错误；
- 捕获未处理 Promise 拒绝；
- 捕获资源加载错误；
- 每个原生错误对每个订阅最多通知一次；
- 原有 `window.onerror` 与 `window.onunhandledrejection` 身份不变且仍执行；
- `defaultPrevented` 保持 `false`，宿主默认行为和传播不被改变；
- 取消后不再通知，销毁后监听器逻辑失效；
- 多实例不交叉移除；
- 回调内部抛错不产生无限递归、不破坏页面脚本；
- 事件视图不含原生事件或 DOM 节点。

模拟 DOM 不能替代这些证据。

## 16. 体积与副作用

`@aurora/browser` 继续设置 `sideEffects: false`。模块导入不得自动创建环境、注册监听器或写入宿主；调用方必须显式创建实例并显式订阅。

测试/发布设计中的单插件预算为 gzip 增量不超过 8 KiB。该预算不直接把 Browser 基础包等同为一个插件，但本增量必须记录 `dist/error-source.js` 的可重复 gzip 大小，并检查完整 Browser 构建产物的变化。当前 `tsc` 构建不是最终 bundler/tree-shaking 证据，因此发布前体积结论标记为 `requires-benchmark`；本增量不得为此引入发布系统或 bundler。

## 17. 文档与 ADR

实施完成后必须同步 `packages/browser/README.md`、根 README、正式文档索引、系统/SDK/Monorepo 架构、测试策略、正式化追踪、`AGENTS.md` 和 `AURORA_RULES.md` 的真实实现状态。

ADR-003 和 ADR-006 只追加 Browser 错误源能力的真实实施证据并保持 `accepted / in-progress`；ADR-005 保持 `accepted / in-progress`，因为本增量不消费或修改协议；ADR-007 保持 `accepted / implemented`。计划或规格的存在不改变任何 ADR 状态和实施状态。本增量不需要新 ADR。

## 18. 后续模块衔接

本增量通过后，独立的错误插件规格可以只从 `@aurora/browser` 根入口消费 `subscribeErrorSources()`，不再自行探测环境或管理全局监听器。错误插件仍必须单独解决原始错误到 event-schema 正文的安全规范化、事件 ID/时间边界和 Core 提交行为；本规格不替它批准这些接口或实现。

## 19. 完成定义

只有当公共契约、注册回滚、释放、异常隔离、隐私、宿主不变、多实例、单元覆盖率、包入口、Workspace Policy 和 Chromium 真实浏览器门禁全部以新鲜输出通过，且文档与 ADR 证据同步，才能把 `implementation-status` 改为 `implemented`。本规格被批准不表示代码已经存在。
