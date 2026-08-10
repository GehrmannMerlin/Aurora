# Browser

`@aurora/browser` 是 Aurora SDK 的浏览器环境能力、页面生命周期、错误源订阅、请求观测与性能事实观测基础包。当前包保持私有；完成本增量不表示错误、请求、性能、资源、行为、传输或框架能力已经存在。错误源订阅已实现 JavaScript 运行时错误、未处理 Promise 拒绝和资源加载错误的安全监听与最小只读视图；请求观测已实现 fetch 与 XMLHttpRequest 的最小只读请求事实投影与宿主恢复，不执行协议转换、Core 提交或请求插件；性能观测已实现 PRD 5.1.9 批准的四项页面性能事实（LCP、INP、CLS、页面加载耗时）的最小只读投影，不执行协议转换或采样。

## 模块定位

本包位于环境无关 Core 之上，向获批的独立消费者提供浏览器能力快照、脱敏页面快照、页面生命周期订阅和请求观测能力。当前没有 Core 环境注入或具体插件集成。

## 职责

- 安全识别 `window`、`document`、`navigator` 和 `performance`；
- 读取 URL 的 `origin + pathname`、User Agent、可见性和两类时间；
- 订阅 `visibilitychange`、`pagehide`、`pageshow` 生命周期；
- 通过 `addEventListener` 安全订阅 `error`（捕获）和 `unhandledrejection`；
- 将原生错误事件投影为最小、只读、冻结的 Browser 事实视图；
- 资源 URL 通过 `origin + pathname` 脱敏，不保留查询或片段；
- `error` 和 `reason` 仅在同步回调期间作为 `unknown` 传递；
- 通过 `subscribeRequests` 安全观测 `window.fetch` 与 `window.XMLHttpRequest`；
- 将请求完成事实投影为最小、只读、冻结的 Browser 请求视图；
- 请求 URL 通过 `origin + pathname` 脱敏，不读取请求/响应正文或敏感 Headers；
- 共享代理 + 每实例引用计数：首个订阅者安装包装，最后一个订阅者释放后恢复原始宿主引用；
- 隔离 getter、监听器与回调异常；
- 提供实例级、固定 100 条的脱敏诊断；
- 支持幂等取消、幂等销毁和多实例隔离。

## 非职责

本包不执行错误/请求/性能协议转换、Core 插件、事件 ID/时间生成、错误去重/分组/指纹、Source Map、采样、队列、传输、重试或持久化；不读取请求/响应正文、请求/响应头、Cookie、凭据或表单；不实现资源或行为信号的捕获、FCP/TTFB/FID/TBT 等未批准性能指标；不创建 `packages/plugin-error`、`packages/plugin-request`、`packages/plugin-performance` 或 React/Vue 适配。

## 公共 API

浏览器 SDK composition：`createAuroraSdk({ config, plugins?, pageOrigin? })` 把配置、Core、控制面（`@aurora/sdk`）与注入插件组装为完整 SDK 句柄（配置快照、Core、控制面、生命周期），插件事件经统一控制面（隐私过滤 → beforeSend → 请求分类 → 采样）后进入 Core（SDK-10）。

```ts
import {
  createBrowserEnvironment,
  createAuroraSdk,
  BrowserErrorSourceEventType,
  BrowserPerformanceMetricName,
  BrowserPerformanceMetricUnit,
  BrowserRequestMechanism,
  BrowserRequestOutcome,
  BrowserRequestSourceEventType,
  PageLifecycleEventType,
  PageVisibilityState,
  type BrowserEnvironment,
  type BrowserErrorSourceEvent,
  type BrowserErrorSourceListener,
  type BrowserPageSnapshot,
  type BrowserPerformanceSourceEvent,
  type BrowserPerformanceSourceListener,
  type BrowserRequestSourceEvent,
  type BrowserRequestSourceListener,
  type BrowserSubscribeResult,
} from '@aurora/browser';
```

`subscribeErrorSources(listener)` 以捕获模式注册 `error` 和 `unhandledrejection`。两个监听器全部注册成功后才视为订阅成功；第二个注册失败时回滚第一个。首次 `unsubscribe()` 逆序移除监听器（`unhandledrejection` 先、`error` 后，`error` 移除使用 `capture: true`）。

`subscribeRequests(listener)` 在第一个订阅者时安装 `window.fetch` 与 `window.XMLHttpRequest` 包装，之后共享同一包装；最后一个订阅者取消或实例销毁时恢复原始宿主引用。包装保持 fetch 参数透传、Promise 语义、Response 不被消费，保持 XHR `instanceof`、`open`/`send`/`abort` 语义、调用方 handler 不被覆盖、正文与敏感 Headers 不被读取。

`subscribePerformance(listener)` 观测 PRD 5.1.9 批准的四项页面性能事实：`page_load`（Navigation Timing）、`lcp`（Largest Contentful Paint）、`cls`（Layout Instability session window）、`inp`（Event Timing interaction 聚合）。每项指标使用独立 `PerformanceObserver`（`buffered: false`，不消费宿主已有 entries），实例内多订阅者共享 observer（首个订阅者安装、最后一个取消时 `disconnect`）。事实只在收尾（页面隐藏、`pagehide`、取消或销毁）时发送最终候选；`page_load` 在订阅时若 Navigation Timing 已就绪则立即发送。不修改 `PerformanceObserver`/`performance`/原生 prototype，不影响其他库的 observer。`destroy()` 释放错误源、页面生命周期、请求观测与性能观测全部活动订阅。包只导出根入口。禁止导入 `src`、`internal` 或未声明子路径。

## 环境与降级

模块导入不读取浏览器全局。缺失环境返回 `false`、`null`、`unknown` 或稳定失败码；宿主 getter、时钟、监听器 API 与请求观测安装/恢复抛错时不会向宿主页脚本传播。fetch 与 XHR 任一缺失时，另一机制仍可被观测。

## 隐私与宿主安全

页面地址只返回 HTTP(S) 的 `origin + pathname`，删除用户名、密码、查询和片段。请求 URL 同样只保留 `origin + pathname`。`error`、`reason` 与请求事实仅在同步回调期间传递，Browser 不遍历、不复制、不序列化、不保留，回调返回后不保存。性能事实只投影四项批准指标的最小数值（LCP/INP/page_load 毫秒、CLS 比率），不读取 `PerformanceEntry` 的 `element`、`url`、`sources`、`target` 等 DOM 关联字段，不保留原生 entry 引用。包不读取 Cookie、Storage、表单、DOM、页面文本、请求/响应正文或敏感 Headers，不记录异常文本、URL 原值或 User Agent，不覆盖 `window.onerror`、`window.onunhandledrejection`、`window.onload` 等 handler，不调用 `preventDefault()`、`stopPropagation()`，不修改 `XMLHttpRequest.prototype`。请求观测按 ADR-003 授权有意赋值 `window.fetch` 与 `window.XMLHttpRequest` 并在最后释放时恢复；恢复失败不会影响宿主请求。性能观测不修改 `PerformanceObserver`、`performance` 或原生 prototype。

## 资源释放

成功订阅返回 `BrowserSubscription`。首次 `unsubscribe()` 逻辑停用并移除监听器，重复调用返回 `already_unsubscribed`。请求订阅的引用计数归零时恢复原始 `window.fetch`/`window.XMLHttpRequest`；性能订阅计数归零时对每个 `PerformanceObserver` 执行 `disconnect()` 并移除页面隐藏监听。首次 `destroy()` 释放实例全部订阅，重复调用返回 `already_destroyed`；销毁后不允许重新订阅。

## 开发与测试

```bash
pnpm --filter @aurora/browser typecheck
pnpm --filter @aurora/browser test
pnpm --filter @aurora/browser test:coverage
pnpm --filter @aurora/browser build
pnpm --filter @aurora/browser test:package
pnpm --filter @aurora/browser exec playwright install chromium
pnpm --filter @aurora/browser test:browser
pnpm check:ci
```

覆盖率门槛为行 85%、分支 80%、函数 85%、语句 85%。真实浏览器门禁只运行本地 Chromium，并验证真实 fetch/XHR 请求事实、正文不被消费、宿主身份恢复、`instanceof` 保持、多订阅者与多实例隔离，以及真实 Navigation Timing/LCP/CLS/INP 性能事实、页面隐藏收尾与隐私不泄露。

## 权威来源

- [Browser 正式规格](../../docs/sdk/browser-environment-foundation.md)
- [错误源订阅规格](../../docs/sdk/browser-error-source.md)
- [请求观测能力规格](../../docs/sdk/browser-request-source.md)
- [性能事实观测能力规格](../../docs/sdk/browser-performance-source.md)
- [SDK 架构](../../docs/architecture/sdk-architecture.md)
- [错误事件协议契约](../../docs/protocol/error-event-contract.md)
- [请求事件协议契约](../../docs/protocol/request-event-contract.md)
- [ADR-003](../../docs/adr/ADR-003-sdk-plugin-architecture.md)
- [ADR-006](../../docs/adr/ADR-006-one-way-dependencies.md)
- [测试策略](../../docs/testing/test-strategy.md)
