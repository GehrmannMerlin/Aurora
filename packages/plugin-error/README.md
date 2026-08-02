# @aurora/plugin-error

Aurora 的浏览器错误采集插件第一增量。它通过 `@aurora/browser` 接收 JavaScript、未处理 Promise 拒绝和资源加载错误事实，用 `@aurora/event-schema` 根入口校验错误正文，并通过 `@aurora/core` 插件上下文提交最小事件草稿。

## 使用

```ts
import { createBrowserEnvironment } from '@aurora/browser';
import { createCore } from '@aurora/core';
import { createErrorCapturePlugin } from '@aurora/plugin-error';

const browser = createBrowserEnvironment();
const core = createCore();
const errorPlugin = createErrorCapturePlugin(browser);

core.registerPlugin(errorPlugin);
await core.initialize();
await core.start();

await core.stop();
await core.destroy();
browser.destroy();
```

BrowserEnvironment 由调用方拥有；插件只取消自己的错误源订阅，不调用 `browser.destroy()`。Core 必须在 Browser 之前停止并销毁插件，最后再由调用方销毁 Browser。

## 公开 API

- `createErrorCapturePlugin(browser: BrowserEnvironment): ErrorCapturePlugin`
- `ERROR_CAPTURE_PLUGIN_NAME`
- `ErrorCaptureDiagnosticCode`
- `ErrorCaptureDiagnosticOperation`
- `ErrorCapturePlugin`
- `ErrorCaptureDiagnostic`

插件钩子同步且幂等。Browser 订阅、单次转换和 Core 提交失败不会抛回宿主；稳定结果写入每实例最新 100 条的冻结诊断。诊断不含错误消息、堆栈、URL、正文或敏感值。

## 边界

- 只从 Core、Browser 和 event-schema 包根导入；
- 不生成事件 ID、时间或协议版本；
- 不创建 EventEnvelope；
- 不直接访问 DOM，不覆盖宿主 handler，不控制事件传播；
- 不保留原生 Event、DOM、Error 或 Promise reason；
- 不实现采样、队列、传输、重试或持久化；
- 不实现去重、分组、指纹、Source Map 或框架错误。

正式契约见 `docs/sdk/error-capture-plugin.md`。
