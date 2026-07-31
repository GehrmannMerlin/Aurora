# Browser

`@aurora/browser` 是 Aurora SDK 的浏览器环境能力与页面生命周期基础包。当前包保持私有；完成本增量不表示错误、请求、性能、资源、行为、传输或框架能力已经存在。

## 模块定位

本包位于环境无关 Core 之上，向获批的独立消费者提供浏览器能力快照、脱敏页面快照和页面生命周期订阅。当前没有 Core 环境注入或具体插件集成。

## 职责

- 安全识别 `window`、`document`、`navigator` 和 `performance`；
- 读取 URL 的 `origin + pathname`、User Agent、可见性和两类时间；
- 订阅 `visibilitychange`、`pagehide`、`pageshow`；
- 隔离 getter、监听器与回调异常；
- 提供实例级、固定 100 条的脱敏诊断；
- 支持幂等取消、幂等销毁和多实例隔离。

## 非职责

本包不采集错误、Promise 异常、资源、请求、性能指标或用户行为；不代理 fetch、XMLHttpRequest 或 History；不实现 Core 插件、事件信封、传输、队列、重试、持久化或 React/Vue 适配。

## 公共 API

```ts
import {
  createBrowserEnvironment,
  PageLifecycleEventType,
  PageVisibilityState,
  type BrowserEnvironment,
  type BrowserPageSnapshot,
  type BrowserSubscribeResult,
} from '@aurora/browser';
```

包只导出根入口。禁止导入 `src`、`internal` 或未声明子路径。

## 环境与降级

模块导入不读取浏览器全局。缺失环境返回 `false`、`null`、`unknown` 或稳定失败码；宿主 getter、时钟和监听器 API 抛错时不会向宿主页脚本传播。

## 隐私与宿主安全

页面地址只返回 HTTP(S) 的 `origin + pathname`，删除用户名、密码、查询和片段。包不读取 Cookie、Storage、表单、DOM 或页面文本，不记录异常文本和 User Agent，不覆盖 `window.onerror`、`window.onunhandledrejection`，不替换原生 API，不修改原型。

## 资源释放

成功订阅返回 `BrowserSubscription`。首次 `unsubscribe()` 逻辑停用并移除三个监听器，重复调用返回 `already_unsubscribed`。首次 `destroy()` 释放实例全部订阅，重复调用返回 `already_destroyed`；销毁后不允许重新订阅。

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

覆盖率门槛为行 85%、分支 80%、函数 85%、语句 85%。真实浏览器门禁只运行本地 Chromium。

## 权威来源

- [Browser 正式规格](../../docs/sdk/browser-environment-foundation.md)
- [SDK 架构](../../docs/architecture/sdk-architecture.md)
- [ADR-003](../../docs/adr/ADR-003-sdk-plugin-architecture.md)
- [ADR-006](../../docs/adr/ADR-006-one-way-dependencies.md)
- [测试策略](../../docs/testing/test-strategy.md)
