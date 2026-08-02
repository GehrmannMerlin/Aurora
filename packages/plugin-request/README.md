# @aurora/plugin-request

Aurora 的浏览器请求采集插件第一增量。它通过 `@aurora/browser` 的 `subscribeRequests` 接收 fetch 与 XMLHttpRequest 请求事实，用 `@aurora/event-schema` 根入口的 `parseRequestEventBody` 校验请求正文，并通过 `@aurora/core` 插件上下文提交最小事件草稿。

## 使用

```ts
import { createBrowserEnvironment } from '@aurora/browser';
import { createCore } from '@aurora/core';
import { createRequestCapturePlugin } from '@aurora/plugin-request';

const browser = createBrowserEnvironment();
const core = createCore();
const requestPlugin = createRequestCapturePlugin(browser);

core.registerPlugin(requestPlugin);
await core.initialize();
await core.start();

await core.stop();
await core.destroy();
browser.destroy();
```

BrowserEnvironment 由调用方拥有；插件只取消自己的请求订阅，不调用 `browser.destroy()`。Core 必须在 Browser 之前停止并销毁插件，最后再由调用方销毁 Browser。

## 公开 API

- `createRequestCapturePlugin(browser: BrowserEnvironment): RequestCapturePlugin`
- `REQUEST_CAPTURE_PLUGIN_NAME`
- `RequestCaptureDiagnosticCode`
- `RequestCaptureDiagnosticOperation`
- `RequestCapturePlugin`
- `RequestCaptureDiagnostic`

插件钩子同步且幂等。Browser 订阅、单次转换和 Core 提交失败不会抛回宿主；稳定结果写入每实例最新 100 条的冻结诊断。诊断不含 URL、method、statusCode、请求事实、异常消息或敏感值。

## 边界

- 只从 Core、Browser 和 event-schema 包根导入；
- 不生成事件 ID、时间或协议版本；
- 不创建 EventEnvelope；
- 不直接访问 DOM，不覆盖宿主 handler，不控制事件传播；
- 不包装 fetch 或 XMLHttpRequest，不消费请求或响应正文；
- 不保留 Browser 请求事实或原生引用；
- 不实现采样、队列、传输、重试或持久化；
- 不实现允许来源/同源判断、慢请求阈值、去重、聚合或问题识别。

正式契约见 `docs/sdk/request-capture-plugin.md`。
