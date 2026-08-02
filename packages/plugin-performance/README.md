# @aurora/plugin-performance

Aurora 的浏览器性能采集插件第一增量。它通过 `@aurora/browser` 的 `subscribePerformance` 接收 LCP、INP、CLS、页面加载耗时四项性能事实，用 `@aurora/event-schema` 根入口的 `parsePerformanceEventBody` 校验性能正文，并通过 `@aurora/core` 插件上下文提交最小事件草稿。

## 使用

```ts
import { createBrowserEnvironment } from '@aurora/browser';
import { createCore } from '@aurora/core';
import { createPerformanceCapturePlugin } from '@aurora/plugin-performance';

const browser = createBrowserEnvironment();
const core = createCore();
const performancePlugin = createPerformanceCapturePlugin(browser);

core.registerPlugin(performancePlugin);
await core.initialize();
await core.start();

await core.stop();
await core.destroy();
browser.destroy();
```

BrowserEnvironment 由调用方拥有；插件只取消自己的性能订阅，不调用 `browser.destroy()`。Core 必须在 Browser 之前停止并销毁插件，最后再由调用方销毁 Browser。

## 公开 API

- `createPerformanceCapturePlugin(browser: BrowserEnvironment): PerformanceCapturePlugin`
- `PERFORMANCE_CAPTURE_PLUGIN_NAME`
- `PerformanceCaptureDiagnosticCode`
- `PerformanceCaptureDiagnosticOperation`
- `PerformanceCapturePlugin`
- `PerformanceCaptureDiagnostic`

插件钩子同步且幂等。Browser 订阅、单次转换和 Core 提交失败不会抛回宿主；稳定结果写入每实例最新 100 条的冻结诊断。诊断不含性能正文、原始性能事实、DOM、entry、URL 或敏感值。

## 边界

- 只从 Core、Browser 和 event-schema 包根导入；
- 不生成事件 ID、时间或协议版本；
- 不创建 EventEnvelope；
- 不直接访问 DOM，不覆盖宿主 handler，不控制事件传播；
- 不重新实现 Browser 性能观测或指标计算（session window、interaction 聚合、LCP 候选选择）；
- 不实现采样、队列、传输、重试或持久化；
- 不调用 `BrowserEnvironment.destroy()`，不影响 plugin-error/plugin-request 订阅；
- 不包含 FCP/TTFB/FID/TBT 等未批准指标。

正式契约见 `docs/sdk/performance-capture-plugin.md`。
