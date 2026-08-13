# @aurora/plugin-react

Aurora SDK React 18 框架适配器（`aurora.layer: sdk-framework`）。为 React 18 应用提供 `AuroraErrorBoundary`（class Error Boundary）与 SDK 句柄，把子树渲染/生命周期错误捕获为标准错误事件进入既有统一管道，并满足 StrictMode 开发期双生命周期的幂等、cleanup 恢复、多实例隔离与宿主安全。

## 职责与非职责

**职责**

- 提供 `createReactAuroraPlugin(input)`，返回 `{ AuroraErrorBoundary, sdk, destroy() }`；
- `AuroraErrorBoundary` 捕获子树渲染/生命周期错误，经 `componentDidCatch` 转换为 `JavaScriptErrorEventBody` 并经 `AuroraSdkHandle` 公共管道（`control.processEvent → core.submitEventDraft → delivery.enqueue → flush`）提交；
- `componentDidMount` 以实例幂等守卫启动 SDK；渲染错误早于 start 完成时经**有界 pre-start 闩锁**（≤32 条）暂存后排空到同一统一管道；
- StrictMode 开发期双 mount/unmount 不重复注册、不重复启动、不重复发送同一框架事实。

**非职责**

- 不复制 Core/Browser/采集插件能力（全局 `window.onerror`/`unhandledrejection` 由 `@aurora/plugin-error` 默认覆盖，本包不重复监听宿主全局）；
- 不创建第二套队列/传输（复用 `AuroraSdkHandle.delivery`）；
- 不改变事件协议、不采集 React `errorInfo.componentStack`/组件 props/state 敏感内容；
- 不保存原生 Error/组件引用。

## 安装

```bash
pnpm add @aurora/plugin-react
```

`react`、`react-dom`（^18.3.0）是 peerDependencies，由宿主项目提供。

## 使用

```tsx
import { createReactAuroraPlugin } from '@aurora/plugin-react';

const aurora = createReactAuroraPlugin({
  config: {
    clientKey: '你的客户端上报密钥',
    environment: 'production',
  },
});

// 用 AuroraErrorBoundary 包裹需要捕获错误的子树
const App = () => (
  <aurora.AuroraErrorBoundary>
    <YourPage />
  </aurora.AuroraErrorBoundary>
);
```

## 公共 API

```ts
createReactAuroraPlugin(input: CreateAuroraSdkInput): ReactAuroraPlugin
```

| 成员                  | 类型                                      | 说明                                                                             |
| --------------------- | ----------------------------------------- | -------------------------------------------------------------------------------- |
| `AuroraErrorBoundary` | `ComponentType<AuroraErrorBoundaryProps>` | class Error Boundary；捕获子树错误，`fallback` 可选渲染降级 UI，默认错误后渲染空 |
| `sdk`                 | `AuroraSdkHandle`                         | 底层 SDK 句柄（`start/stop/destroy/config/control/delivery/getActivityTrail`）   |
| `destroy()`           | `() => Promise<void>`                     | 释放全部资源；幂等；destroy 后边界提交为 no-op                                   |

```ts
interface AuroraErrorBoundaryProps {
  readonly children?: ReactNode;
  readonly fallback?: ReactNode; // 可选降级 UI；默认错误后渲染 null
}
```

## 错误桥与生命周期

- `componentDidCatch(error)`：把 `error` 安全读取 `name/message/stack`（getter 异常隔离、空 message 用稳定回退 `"Unknown React error"`），经 `parseErrorEventBody` 成功后作为 `EventType.Error` 提交统一管道；**不采集** `errorInfo.componentStack`（隐私）；
- `componentDidMount`：`ensureStarted()` 实例幂等守卫，StrictMode 双挂载只启动一次 SDK；
- `componentWillUnmount`：无副作用（本包不注册全局监听，卸载无需恢复宿主状态）；
- pre-start 闩锁：commit 阶段（componentDidCatch 早于 componentDidMount/start）的错误先缓冲，`sdk.start()` 成功后排空到同一统一管道；溢出丢最旧。

## StrictMode

React 18 StrictMode 开发期双调用 constructor/render/生命周期。本包安全保证：

- 不注册任何全局监听（无重复注册）；
- `ensureStarted` 幂等守卫（只启动一次 SDK，activity trail 只有一条 `page_enter`）；
- `componentWillUnmount` 无副作用（卸载不残留）；
- 错误只在实际抛出时提交一次。

## 隐私与宿主安全

- 不采集请求/响应体、Cookie、Authorization、表单、组件 props/state、`errorInfo.componentStack`、完整 DOM/文本；
- 不调用 `preventDefault`/`stopPropagation`；不修改宿主全局；
- 内部解析/提交失败静默丢弃，不向宿主抛出；
- 每插件实例独立状态，无模块级可变状态；两实例可共享页面但互不干扰。

## 体积

单框架适配 gzip ≤ 5 KiB 是发布门槛，当前构建为多文件 TypeScript 拼接的近似测量，标记 `requires-benchmark`；不得把该值描述为最终发布包体结论。
