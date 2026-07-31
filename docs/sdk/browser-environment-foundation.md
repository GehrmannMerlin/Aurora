# Aurora Browser 环境与页面生命周期基础规格

- status: approved
- implementation-status: implemented
- last-updated: 2026-07-30
- scope: `packages/browser` 浏览器环境能力与页面生命周期基础第一增量
- normative-sources:
  - `Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md`
  - `Aurora 架构规范.md`
  - `Aurora 代码规范.md`
  - `Aurora 测试规范.md`
  - `Aurora 文档规范.md`
  - `docs/architecture/sdk-architecture.md`
  - `docs/testing/test-strategy.md`
  - `docs/adr/ADR-003-sdk-plugin-architecture.md`
  - `docs/adr/ADR-006-one-way-dependencies.md`
  - `docs/adr/ADR-007-workspace-package-and-task-tooling.md`

## 1. 目的与模块职责

`@aurora/browser` 是 Aurora SDK 的浏览器环境层基础包。本增量只建立以下能力：

1. 在模块导入和调用阶段安全识别浏览器环境与当前可用能力；
2. 安全读取经过脱敏的页面地址、User Agent、页面可见性、Unix 时间和单调性能时间；
3. 以稳定事件类型订阅 `visibilitychange`、`pagehide` 和 `pageshow`；
4. 为每次订阅提供可重复调用的取消句柄，并为实例提供可重复调用的整体销毁；
5. 隔离浏览器 getter、监听器 API 和调用方回调异常；
6. 以固定上限的结构化诊断表达内部异常，不泄露异常文本和宿主数据；
7. 保证实例之间没有共享可变状态，且一个实例的取消或销毁不影响其他实例。

该包只提供浏览器环境事实与页面生命周期事实，不生成 Aurora 事件信封，也不负责把这些事实送入 Core。

## 2. 明确非职责

本增量不负责：

- JavaScript 错误、Promise 异常或资源错误采集；
- `fetch`、`XMLHttpRequest`、History 或其他原生 API 代理；
- Web Vitals、Navigation Timing、Resource Timing 或其他性能指标采集；
- 点击、输入、滚动、页面文本、DOM 或其他用户行为采集；
- 任何具体 `CorePlugin`、插件生命周期适配或 Core 环境注入；
- 事件信封、采样、队列、批量、重试、传输、持久化或上报；
- React、Vue 或其他框架适配；
- 服务端、CI、发布、容器、IaC、云资源或浏览器全矩阵；
- 通用 Hook 系统、通用事件总线、通用代理框架或为未批准能力预留的抽象。

## 3. 分层与依赖方向

依赖方向固定为：

```text
具体插件 / 框架适配
          ↓
       Browser
          ↓（仅在存在真实需要时）
        Core
          ↓
    event-schema
```

本增量中的 `@aurora/browser` 没有 Aurora 本地运行时依赖。它不得反向被 `@aurora/core` 依赖，不得依赖具体插件、React、Vue、应用或工具实现。若 Browser 使用 Core 类型，只能从 `@aurora/core` 根公开入口进行类型导入；禁止访问任何包的 `src`、`internal`、测试目录或未导出子路径。

现有 `CorePluginContext` 只公开 `submitEvent(input: unknown): CoreEventResult`，没有 Browser 环境注入端口。本规格不得虚构该端口。Browser 与 Core 的直接装配、环境注入或具体插件集成属于独立增量；若届时确实需要修改 Core 公共 API，必须单独规格化并重新判断 ADR 和兼容性影响。

Workspace Policy 必须把 `sdk-browser` 固定为只允许依赖 `sdk-core` 和 `protocol` 的层，并以通过和失败夹具证明：

- `sdk-browser -> sdk-core` 与 `sdk-browser -> protocol` 允许；
- `sdk-browser -> sdk-plugin`、`framework`、应用、工具或未分类包拒绝；
- `sdk-core -> sdk-browser` 拒绝；
- 深层私有路径和循环依赖拒绝。

## 4. 允许访问与禁止修改的宿主能力

### 4.1 允许读取或监听

本增量只允许按需访问：

- `globalThis.window`；
- `globalThis.document`；
- `globalThis.navigator`；
- `globalThis.performance`；
- `window.location.href`；
- `navigator.userAgent`；
- `document.visibilityState`；
- `Date.now()`；
- `performance.now()`；
- `window.addEventListener` / `window.removeEventListener`；
- `document.addEventListener` / `document.removeEventListener`；
- 生命周期事件对象的 `persisted` 布尔属性。

所有通过浏览器对象取得的值先视为 `unknown`，完成运行时类型检查后才能进入公共结果。模块顶层不得读取这些宿主对象，确保 Node.js、SSR、Worker 和浏览器 API 缺失环境的导入安全。

### 4.2 禁止写入或替换

本增量不得：

- 修改任何原生对象原型；
- 赋值或覆盖 `window.onerror`；
- 赋值或覆盖 `window.onunhandledrejection`；
- 替换或包装 `fetch`；
- 替换或包装 `XMLHttpRequest`；
- 替换或包装 `history`、`history.pushState` 或 `history.replaceState`；
- 读写 Cookie、Local Storage、Session Storage、IndexedDB 或表单；
- 向 `window`、`document`、`navigator` 或其他宿主对象挂载 Aurora 状态；
- 修改调用方传入的监听函数或其他对象；
- 在生产路径输出控制台日志。

本增量不创建任何原生 API 代理。正常取消和销毁必须调用与注册对应的原生 `removeEventListener`；若宿主移除方法抛错，则实例必须先完成逻辑停用，使残留原生回调立即成为无副作用空操作，并记录脱敏诊断。

## 5. 公共出口与完整 TypeScript 契约

包只公开根入口 `@aurora/browser`，且运行时导出只包含以下 `const` 对象与 `createBrowserEnvironment`。所有类型从同一根入口导出。

```ts
export const BrowserCapabilityName = {
  Window: 'window',
  Document: 'document',
  Navigator: 'navigator',
  Performance: 'performance',
  PageUrl: 'page_url',
  UserAgent: 'user_agent',
  Visibility: 'visibility',
  PageLifecycle: 'page_lifecycle',
} as const;

export type BrowserCapabilityName =
  (typeof BrowserCapabilityName)[keyof typeof BrowserCapabilityName];

export interface BrowserCapabilities {
  readonly isBrowserEnvironment: boolean;
  readonly hasWindow: boolean;
  readonly hasDocument: boolean;
  readonly hasNavigator: boolean;
  readonly hasPerformance: boolean;
  readonly canReadPageUrl: boolean;
  readonly canReadUserAgent: boolean;
  readonly canReadVisibility: boolean;
  readonly canObservePageLifecycle: boolean;
}

export const PageVisibilityState = {
  Visible: 'visible',
  Hidden: 'hidden',
  Unknown: 'unknown',
} as const;

export type PageVisibilityState = (typeof PageVisibilityState)[keyof typeof PageVisibilityState];

export interface BrowserClockSnapshot {
  readonly unixMilliseconds: number | null;
  readonly monotonicMilliseconds: number | null;
}

export interface BrowserPageSnapshot {
  readonly pageUrl: string | null;
  readonly userAgent: string | null;
  readonly visibilityState: PageVisibilityState;
  readonly clock: BrowserClockSnapshot;
}

export const PageLifecycleEventType = {
  VisibilityChange: 'visibility_change',
  PageHide: 'page_hide',
  PageShow: 'page_show',
} as const;

export type PageLifecycleEventType =
  (typeof PageLifecycleEventType)[keyof typeof PageLifecycleEventType];

export interface VisibilityChangeLifecycleEvent {
  readonly type: typeof PageLifecycleEventType.VisibilityChange;
  readonly visibilityState: PageVisibilityState;
}

export interface PageHideLifecycleEvent {
  readonly type: typeof PageLifecycleEventType.PageHide;
  readonly isPersisted: boolean | null;
}

export interface PageShowLifecycleEvent {
  readonly type: typeof PageLifecycleEventType.PageShow;
  readonly isPersisted: boolean | null;
}

export type PageLifecycleEvent =
  VisibilityChangeLifecycleEvent | PageHideLifecycleEvent | PageShowLifecycleEvent;

export type BrowserLifecycleListener = (event: PageLifecycleEvent) => void;

export const BrowserDiagnosticCode = {
  GlobalAccessFailed: 'global_access_failed',
  PropertyReadFailed: 'property_read_failed',
  ClockReadFailed: 'clock_read_failed',
  ListenerRegistrationFailed: 'listener_registration_failed',
  ListenerRemovalFailed: 'listener_removal_failed',
  CallbackFailed: 'callback_failed',
} as const;

export type BrowserDiagnosticCode =
  (typeof BrowserDiagnosticCode)[keyof typeof BrowserDiagnosticCode];

export const BrowserDiagnosticOperation = {
  Create: 'create',
  ReadCapabilities: 'read_capabilities',
  ReadSnapshot: 'read_snapshot',
  Subscribe: 'subscribe',
  Unsubscribe: 'unsubscribe',
  Destroy: 'destroy',
  Notify: 'notify',
} as const;

export type BrowserDiagnosticOperation =
  (typeof BrowserDiagnosticOperation)[keyof typeof BrowserDiagnosticOperation];

export interface BrowserDiagnostic {
  readonly sequence: number;
  readonly code: BrowserDiagnosticCode;
  readonly operation: BrowserDiagnosticOperation;
  readonly capability?: BrowserCapabilityName;
  readonly eventType?: PageLifecycleEventType;
}

export const BrowserSubscribeCode = {
  Subscribed: 'subscribed',
  InvalidListener: 'invalid_listener',
  EnvironmentUnavailable: 'environment_unavailable',
  Destroyed: 'destroyed',
  ListenerRegistrationFailed: 'listener_registration_failed',
} as const;

export type BrowserSubscribeFailureCode =
  | typeof BrowserSubscribeCode.InvalidListener
  | typeof BrowserSubscribeCode.EnvironmentUnavailable
  | typeof BrowserSubscribeCode.Destroyed
  | typeof BrowserSubscribeCode.ListenerRegistrationFailed;

export interface BrowserSubscribeSuccess {
  readonly ok: true;
  readonly code: typeof BrowserSubscribeCode.Subscribed;
  readonly subscription: BrowserSubscription;
  readonly diagnosticsAdded: number;
}

export interface BrowserSubscribeFailure {
  readonly ok: false;
  readonly code: BrowserSubscribeFailureCode;
  readonly diagnosticsAdded: number;
}

export type BrowserSubscribeResult = BrowserSubscribeSuccess | BrowserSubscribeFailure;

export const BrowserUnsubscribeCode = {
  Unsubscribed: 'unsubscribed',
  AlreadyUnsubscribed: 'already_unsubscribed',
} as const;

export interface BrowserUnsubscribeResult {
  readonly ok: true;
  readonly code:
    typeof BrowserUnsubscribeCode.Unsubscribed | typeof BrowserUnsubscribeCode.AlreadyUnsubscribed;
  readonly diagnosticsAdded: number;
}

export interface BrowserSubscription {
  unsubscribe(): BrowserUnsubscribeResult;
}

export const BrowserDestroyCode = {
  Destroyed: 'destroyed',
  AlreadyDestroyed: 'already_destroyed',
} as const;

export interface BrowserDestroyResult {
  readonly ok: true;
  readonly code: typeof BrowserDestroyCode.Destroyed | typeof BrowserDestroyCode.AlreadyDestroyed;
  readonly diagnosticsAdded: number;
}

export interface BrowserEnvironment {
  getCapabilities(): BrowserCapabilities;
  readPageSnapshot(): BrowserPageSnapshot;
  subscribePageLifecycle(listener: BrowserLifecycleListener): BrowserSubscribeResult;
  destroy(): BrowserDestroyResult;
  getDiagnostics(): readonly BrowserDiagnostic[];
}

export function createBrowserEnvironment(): BrowserEnvironment;
```

公共接口不得再导出浏览器宿主对象、内部安全访问函数、资源注册记录、诊断存储或测试夹具。

## 6. 环境与能力检测语义

`createBrowserEnvironment()` 不接收参数，不修改调用方对象，并在创建时为该实例捕获当前宿主能力引用。环境和能力快照在该实例生命周期内保持稳定；宿主随后增加或删除 API 不会改变 `getCapabilities()` 的结果。需要重新探测时必须新建实例。

检测规则如下：

- `hasWindow`：安全取得的 `window` 是非空对象或函数；
- `hasDocument`：安全取得的 `document` 是非空对象或函数；
- `hasNavigator`：安全取得的 `navigator` 是非空对象或函数；
- `hasPerformance`：安全取得的 `performance` 是非空对象或函数；
- `isBrowserEnvironment`：`hasWindow && hasDocument`；
- `canReadPageUrl`：可以安全读取 `window.location.href`，且能得到受支持的脱敏 HTTP(S) 地址；
- `canReadUserAgent`：可以安全读取非空字符串 `navigator.userAgent`；
- `canReadVisibility`：可以安全读取字符串 `document.visibilityState`；
- `canObservePageLifecycle`：`window` 与 `document` 都具备可调用的 `addEventListener` 和 `removeEventListener`。

缺失对象或方法是正常降级，不得导致导入、创建、读取或销毁抛错。访问全局属性或能力 getter 抛错时记录诊断；诊断不能保留异常对象、异常消息或读取到的原始值。

`getCapabilities()` 返回冻结的只读对象。调用方无法通过修改返回对象改变实例行为。

## 7. 页面 URL 与 User Agent 读取语义

`readPageSnapshot()` 每次调用都重新读取当前值，但只使用创建实例时捕获的宿主对象。

页面地址规则：

1. 读取 `window.location.href`；
2. 仅接受可解析的 `http:` 或 `https:` URL；
3. 删除用户名、密码、查询字符串和片段；
4. 返回标准化的 `origin + pathname`，保留协议、主机、端口和路径；
5. 缺失、空值、非法 URL、非 HTTP(S) 协议或 getter 抛错时返回 `null`；
6. 原始 URL、查询参数、片段、用户名和密码不得进入诊断或日志。

例如 `https://user:secret@example.test:8443/orders/42?token=x#detail` 必须返回 `https://example.test:8443/orders/42`。

User Agent 规则：安全读取 `navigator.userAgent`；非空字符串原样返回，缺失、非字符串、空字符串或 getter 抛错时返回 `null`。User Agent 只作为调用结果返回，不得写入诊断、日志、Storage 或全局对象。

## 8. 时间与性能时钟语义

`BrowserClockSnapshot` 同时表达两种不可互换的时间：

- `unixMilliseconds`：`Date.now()` 返回的 Unix epoch 毫秒；只有有限的安全整数才有效，否则为 `null`；
- `monotonicMilliseconds`：`performance.now()` 返回的、相对当前 Performance time origin 的单调毫秒；只有有限且不小于零的数值才有效，否则为 `null`。

`performance` 缺失、`now` 不可调用或调用抛错时，不影响 Unix 时间。`Date.now()` 抛错时，不影响性能时间。两者均失败时返回两个 `null`，且调用不抛错。时间值不互相回退，不把性能时间伪装为绝对时间，也不在本增量计算性能指标。

## 9. 页面可见性语义

`document.visibilityState` 精确等于 `visible` 时返回 `PageVisibilityState.Visible`，精确等于 `hidden` 时返回 `PageVisibilityState.Hidden`。缺失、非字符串、其他浏览器值或 getter 抛错时返回 `PageVisibilityState.Unknown`。

未知值不是错误枚举扩展，不得把 `prerender` 等未批准状态直接穿透公共 API。getter 抛错记录脱敏诊断；普通缺失或未识别字符串只表现为 `unknown`。

## 10. 页面生命周期事件模型

一次成功订阅必须原子注册以下监听器：

| 原生目标   | 原生事件           | 公共事件            | 负载语义                                  |
| ---------- | ------------------ | ------------------- | ----------------------------------------- |
| `document` | `visibilitychange` | `visibility_change` | 通知时安全重读并归一化 `visibilityState`  |
| `window`   | `pagehide`         | `page_hide`         | `persisted` 是布尔值时传出，否则为 `null` |
| `window`   | `pageshow`         | `page_show`         | `persisted` 是布尔值时传出，否则为 `null` |

本增量不纳入 `beforeunload`、`unload`、`freeze`、`resume`、`DOMContentLoaded`、`load` 或 History 事件。公共事件对象必须冻结，不能暴露原生 `Event`、`Window` 或 `Document` 引用。

事件同步交付给订阅回调。单个回调抛错必须在该实例内被捕获并记录 `callback_failed`；异常不得逃逸到宿主页脚本，也不得阻止其他订阅或其他 Browser 实例接收同一原生事件。

## 11. 订阅、取消与销毁语义

### 11.1 订阅

`subscribePageLifecycle(listener)` 的 `listener` 由 TypeScript 精确约束；运行时仍必须确认其可调用，非法值返回 `invalid_listener`。环境不可用或监听方法缺失时返回 `environment_unavailable`。实例销毁后返回 `destroyed`。任何原生注册抛错时：

1. 立即将该未完成订阅标记为停用；
2. 逆序移除此前已成功注册的监听器；
3. 移除抛错只记录诊断，不替换原始注册失败结果；
4. 返回 `listener_registration_failed`，不暴露半完成句柄。

成功时返回冻结的 `BrowserSubscription`。每次订阅拥有独立的三个原生监听器和独立逻辑状态；本增量不建立通用事件总线。

### 11.2 取消

首次 `unsubscribe()` 必须先逻辑停用，再逆序尝试移除该订阅成功注册的全部监听器，并返回 `unsubscribed`。原生移除抛错时仍视为逻辑取消成功，通过 `diagnosticsAdded` 和 `listener_removal_failed` 诊断表达物理移除失败；残留回调检查到停用状态后不得调用用户回调。

重复 `unsubscribe()` 返回 `already_unsubscribed`、`diagnosticsAdded: 0`，不得重复调用原生移除方法，也不得新增诊断。取消一个订阅不得影响同实例的其他订阅。

### 11.3 整体销毁

首次 `destroy()` 必须先把实例标记为已销毁，再逐个停用并移除所有活动订阅，返回 `destroyed`。销毁期间的原生移除异常只增加诊断，不得使 `destroy()` 抛错，也不得恢复实例。

重复 `destroy()` 返回 `already_destroyed`、`diagnosticsAdded: 0`。销毁后：

- 不允许重新订阅；
- 既有订阅句柄再取消返回 `already_unsubscribed`；
- 原生残留回调不得通知调用方；
- `getCapabilities()`、`readPageSnapshot()` 和 `getDiagnostics()` 仍可安全调用；
- 需要新的监听生命周期时创建新实例。

## 12. 安全降级与异常隔离

所有公共方法均不得因浏览器环境缺失、属性 getter、URL 解析、时钟调用、监听器注册、监听器移除或用户回调异常而向外抛出异常。降级矩阵如下：

| 失败点                                                   | 公共结果                                    | 诊断                           |
| -------------------------------------------------------- | ------------------------------------------- | ------------------------------ |
| `window` / `document` / `navigator` / `performance` 缺失 | 能力为 `false`，对应读取为 `null`/`unknown` | 无，缺失是可预期环境           |
| 全局属性 getter 抛错                                     | 对应能力为 `false`                          | `global_access_failed`         |
| 页面属性 getter 或 URL 解析抛错                          | `null` 或 `unknown`                         | `property_read_failed`         |
| `Date.now` / `performance.now` 抛错或返回非法数值        | 对应时间为 `null`                           | `clock_read_failed`            |
| 订阅能力缺失                                             | `environment_unavailable`                   | 无，失败结果已显式表达         |
| 订阅回调不可调用                                         | `invalid_listener`                          | 无，失败结果已显式表达         |
| 原生注册抛错                                             | `listener_registration_failed`              | `listener_registration_failed` |
| 原生移除抛错                                             | 逻辑取消/销毁成功                           | `listener_removal_failed`      |
| 用户回调抛错                                             | 其他回调继续                                | `callback_failed`              |

本规格不承诺对 JavaScript 引擎自身的不可恢复错误进行隔离。

## 13. 诊断与敏感信息边界

每个 Browser 实例持有独立诊断序列，固定最多保留最新 100 条。`sequence` 从 1 开始单调递增，即使旧记录被淘汰也不复用。`getDiagnostics()` 返回冻结数组和冻结条目；调用方不能修改内部诊断。

诊断只允许包含契约中列出的 `sequence`、`code`、`operation`、`capability` 和 `eventType`。不得包含：

- 原始异常、异常名称、异常消息或堆栈；
- Cookie、Token、Authorization 或任何凭据；
- 完整 URL、查询参数、片段、用户名或密码；
- User Agent；
- Storage、DOM、页面文本、表单值或用户输入；
- 回调函数、宿主对象或调用方对象。

正常降级通过 `null`、`unknown`、能力布尔值或稳定结果码表达；真正异常通过有界诊断表达，不得静默吞掉，也不得大量打印控制台日志。

## 14. 多实例与全局状态

每次 `createBrowserEnvironment()` 必须创建独立的：

- 宿主能力快照；
- 销毁状态；
- 活动订阅集合；
- 诊断存储与序列号。

模块级只允许不可变标量常量和纯函数，不得存在模块级可变对象、数组、Map、Set、计数器、当前实例或默认单例。不同实例可以各自向同一宿主注册监听器；取消或销毁其中一个实例只移除该实例注册的监听器。

## 15. TypeScript、命名与文件边界

- 使用根 `strict` TypeScript 约束，并为 Browser 源码增加 `DOM` 与 `DOM.Iterable` lib；
- `tsconfig.build.json` 只构建 `src`，测试可使用 Node 与 Vitest 类型；
- 所有公共函数和方法显式声明参数与返回类型；
- 浏览器对象读取结果先使用 `unknown`，再通过窄化进入精确类型；
- 禁止无说明 `any`、`Object`、`Function`、`Record<string, any>`、非空断言和双重类型断言；
- 仅在 DOM 标准签名无法由运行时窄化表达时使用局部、单一类型断言，并在相邻注释说明不变量；
- 文件使用 `kebab-case`，类型使用 `PascalCase`，函数和变量使用 `camelCase`；
- 布尔变量与属性使用 `is`、`has`、`can` 或 `should` 前缀；
- 每个文件只承担一种职责，不创建 `utils`、`helpers`、`common` 或 `misc`；
- 不增加当前契约未使用的泛型 Hook、代理、适配器或配置系统；
- 所有公共返回对象和事件对象冻结；调用方传入对象不得被修改。

函数长度、圈复杂度、文件体积和注释规则按 `Aurora 代码规范.md` 执行。数据库、SQL、HTTP API、服务端日志、前端组件样式、React/Vue 命名规则不适用于本增量，因为该包不包含这些内容；排除不降低适用的通用 TypeScript、安全、错误和隐私规则。

## 16. 文件结构与单一职责

计划中的目标结构为：

```text
packages/browser/
├── package.json
├── README.md
├── playwright.config.ts
├── tsconfig.build.json
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── browser-environment.ts   # 实例编排、订阅资源和销毁
│   ├── capabilities.ts          # 能力快照与公开能力类型
│   ├── diagnostics.ts           # 固定上限诊断存储与公开诊断类型
│   ├── index.ts                 # 唯一公共出口
│   ├── page-lifecycle.ts        # 生命周期事件类型和事件转换
│   ├── page-snapshot.ts         # URL、UA、可见性和时钟读取
│   └── safe-access.ts           # 对宿主属性和方法的安全窄化调用
├── test/
│   ├── architecture-boundary.test.ts
│   ├── capabilities.test.ts
│   ├── documentation-contract.test.ts
│   ├── host-safety.test.ts
│   ├── import-safety.test.ts
│   ├── multi-instance.test.ts
│   ├── package-entry.test.ts
│   ├── page-lifecycle.test.ts
│   └── page-snapshot.test.ts
└── test-browser/
    ├── browser-environment.spec.ts
    └── fixture-server.ts
```

测试夹具可在测试文件中定义；不得把测试注入端口放入公共 API。

## 17. 单元测试范围

单元测试必须通过公共 `createBrowserEnvironment()` 和公开返回值验证行为，并使用可恢复的 Vitest 全局桩模拟宿主。至少覆盖：

- Node/非浏览器环境导入安全；
- `window`、`document`、`navigator`、`performance` 分别缺失；
- 全局或浏览器属性 getter 抛错；
- 正常 HTTP(S) URL；
- 查询、片段和凭据被移除，诊断不泄露原值；
- 非 HTTP(S) 与非法 URL 返回 `null`；
- User Agent 正常、缺失、空值和抛错；
- 可见、隐藏、未识别和 getter 抛错的可见性；
- Unix 时间、性能时间、独立失败和非法返回值；
- 单次订阅、同实例多次订阅与三种事件负载；
- 非函数订阅输入返回稳定失败；
- 取消、重复取消和取消后不通知；
- 原子注册失败与已注册监听器回滚；
- 移除抛错后的逻辑停用；
- 销毁、重复销毁、销毁后订阅失败和销毁后不通知；
- 回调抛错隔离、诊断脱敏和诊断上限；
- 多实例独立注册、取消、销毁和诊断；
- 不修改宿主对象、原生函数、原型或调用方输入；
- 无模块级可变状态；
- 根包入口可导入且私有子路径不可导入。

测试必须断言对外结果、事件和宿主可观察状态，不以“内部函数被调用”作为唯一证据。

## 18. 真实浏览器测试范围

使用批准测试技术栈中的 Playwright，只配置本地 Chromium。依赖固定为 `@playwright/test@1.62.0`；该版本要求 Node `>=20`，与 Workspace 的 Node `24.18.0` 兼容，且发布时间满足当前最小发布年龄策略。

真实浏览器门禁必须验证：

- 构建后的 `@aurora/browser` 在 Chromium 页面中加载；
- 页面可见性读取与真实 `document.visibilityState` 一致；
- 真实 DOM `visibilitychange`、`pagehide` 和 `pageshow` 监听与稳定事件转换；
- 取消后不通知，重复取消安全；
- 重复创建和销毁安全；
- 创建、订阅和销毁前后 `window.onerror` 与 `window.onunhandledrejection` 身份不变；
- `fetch`、`XMLHttpRequest`、`history` 及其关键方法身份不变，原型不变；
- 回调抛错不产生未处理页面错误，宿主页脚本继续执行；
- 销毁一个实例不会取消另一个实例的监听器。

安装与执行命令固定为：

```bash
pnpm install --frozen-lockfile
pnpm --filter @aurora/browser exec playwright install chromium
pnpm --filter @aurora/browser test:browser
```

本增量不增加 Firefox/WebKit 矩阵，不创建 CI 工作流，不下载未使用浏览器。

## 19. 覆盖率与质量门禁

`Aurora 测试规范.md` 对未列为关键核心包的默认最低门槛是行 70%、分支 60%。Browser 直接管理宿主监听器、异常隔离和资源恢复，因此本模块采用更高的本地门槛：

- 行覆盖率不低于 85%；
- 分支覆盖率不低于 80%；
- 函数覆盖率不低于 85%；
- 语句覆盖率不低于 85%。

这是本模块的安全门禁，不修改全仓长期最低基线。覆盖率只统计 `packages/browser/src/**/*.ts`，排除类型入口和测试夹具时必须由配置明确说明，不能通过排除高风险实现降低门槛。

完整质量门禁包括：

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm check:boundaries
pnpm build
pnpm --filter @aurora/event-schema test:package
pnpm --filter @aurora/core test:package
pnpm --filter @aurora/browser test:package
pnpm --filter @aurora/browser test:browser
pnpm check:ci
```

## 20. 架构约束的可执行证据

以下要求不能只写在文档里：

| 要求                                           | 强制证据                                            |
| ---------------------------------------------- | --------------------------------------------------- |
| Core 不依赖 Browser，Browser 不依赖插件/框架   | Workspace Policy 层矩阵与负例夹具                   |
| 只使用公开包入口、无私有路径、无循环           | Workspace Policy 导入/图检查与包入口失败测试        |
| Browser 使用 strict DOM 类型且 Core 保持无 DOM | Browser typecheck、Core `tsconfig.no-dom.json` 回归 |
| 无模块级可变单例                               | Workspace Policy 源码检查与多实例测试               |
| 不覆盖错误处理器或原生 API、不修改原型         | ESLint 限制、Node 宿主安全测试、Chromium 身份测试   |
| 所有监听器可释放、重复释放安全                 | 单元监听计数、失败降级测试与 Chromium 测试          |
| 异常不影响宿主且诊断脱敏                       | 回调/getter/监听器抛错测试与页面错误监听            |
| URL 不泄露查询或凭据                           | URL 单元测试、诊断序列化负断言                      |

## 21. 文档与 ADR 实施证据同步

实施时必须同步：

- `packages/browser/README.md`：职责、非职责、公共 API、环境降级、隐私、测试和权威来源；
- 根 `README.md`：真实包清单和 Browser 本地命令；
- `docs/architecture/system-overview.md` 与 `docs/architecture/sdk-architecture.md`：Browser 第一增量的真实状态和边界；
- `docs/architecture/monorepo-and-build.md`：`sdk-browser` 层与真实浏览器命令；
- `docs/testing/test-strategy.md`：Browser 单元/Chromium 门禁和模块覆盖率；
- `docs/architecture/formalization-readiness.md`、`AGENTS.md`、`AURORA_RULES.md`：仅同步真实完成状态和决策队列；
- ADR-003 与 ADR-006：只追加 Browser 实施证据，保持 `accepted / in-progress`；
- ADR-005：保持当前真实状态；
- ADR-007：保持 `accepted / implemented`。

仅生成本规格和实施计划不改变任何 ADR implementation-status。普通 Browser 文件和接口不需要新 ADR；本规格没有引入新的高迁移成本长期决策。

## 22. 与采集插件的衔接边界

错误、请求、性能、资源和行为能力只能在各自获批的独立增量中：

1. 依赖 `@aurora/browser` 根公开入口取得环境或生命周期事实；
2. 依赖 `@aurora/core` 根公开入口实现获批插件契约；
3. 依赖 `@aurora/event-schema` 根公开入口使用获批事件类型和信封；
4. 自行承担该领域的隐私裁剪、数据边界、失败语义与测试。

它们不得访问 Browser 内部宿主引用、订阅记录或诊断存储，不得借 Browser 基础包建立独立上报通道。本增量不为这些消费者预定义正文、采样、代理或传输接口。

## 23. 本增量排除清单

为避免范围漂移，下列内容明确排除：错误/Promise/资源采集、请求代理、History 代理、性能指标、用户行为、具体 Core 插件、Core 公共 API 扩展、事件正文、传输、队列、批量、重试、持久化、框架适配、服务端、CI、发布、容器、IaC、云资源、Firefox/WebKit 全矩阵、通用 Hook、通用事件总线和通用代理框架。
