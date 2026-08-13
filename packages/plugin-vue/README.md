# @aurora/plugin-vue

Aurora SDK Vue 3 框架适配器（`aurora.layer: sdk-framework`）。负责把 Vue 3 应用接入 Aurora SDK：框架生命周期接线、Vue 特有错误桥、可选路由上下文，并把框架信息转换为标准错误事件进入既有统一管道。

## 职责与非职责

**职责**

- 提供 Vue 插件对象 `createVueAuroraPlugin(input)`，经 `app.use(plugin)` 安装；
- 包装 Vue `app.config.errorHandler`：先调用宿主原 handler 保持宿主语义，再把 `err` 安全转换为 `JavaScriptErrorEventBody` 并经 `AuroraSdkHandle` 公共管道（`control.processEvent → core.submitEventDraft → delivery.enqueue → flush`）提交；
- 可选 Vue Router 集成：把路由变化记录为安全活动轨迹 `route_change`；
- 卸载/销毁恢复宿主原 errorHandler、移除路由钩子；重复初始化幂等；多实例隔离；内部失败不向宿主抛出。

**非职责**

- 不复制 Core/Browser/采集插件能力（window 错误由 `@aurora/plugin-error` 覆盖，本包不重复监听）；
- 不创建第二套队列/传输（复用 `AuroraSdkHandle.delivery`）；
- 不改变事件协议、不采集 Vue `instance` 内部状态或组件敏感内容；
- 不保存原生 Error/组件引用。

## 安装

```bash
pnpm add @aurora/plugin-vue
```

`vue`（^3.4.0）是 peerDependency，由宿主项目提供。

## 使用

```ts
import { createApp } from 'vue';
import { createVueAuroraPlugin } from '@aurora/plugin-vue';

const aurora = createVueAuroraPlugin({
  config: {
    clientKey: '你的客户端上报密钥',
    environment: 'production',
  },
});

const app = createApp(App);
app.use(aurora, { router }); // router 可选
app.mount('#app');
```

## 公共 API

```ts
createVueAuroraPlugin(input: CreateAuroraSdkInput): VueAuroraPlugin
```

| 成员                     | 类型                                        | 说明                                                                           |
| ------------------------ | ------------------------------------------- | ------------------------------------------------------------------------------ |
| `install(app, options?)` | `(app, options?: VueAuroraOptions) => void` | Vue 插件安装点：包装 errorHandler、注册可选路由钩子、启动 SDK；重复安装幂等    |
| `uninstall(app)`         | `(app) => void`                             | 恢复原 errorHandler（仅当仍为本实例包装）、移除路由钩子、销毁 SDK              |
| `sdk`                    | `AuroraSdkHandle`                           | 底层 SDK 句柄（`start/stop/destroy/config/control/delivery/getActivityTrail`） |
| `destroy()`              | `() => Promise<void>`                       | 释放全部资源并恢复宿主状态；幂等                                               |

```ts
interface VueAuroraOptions {
  readonly router?: unknown; // 可选 Vue Router（结构性 afterEach 能力检查）
}
```

## 生命周期与错误桥

- `install` 把 `app.config.errorHandler` 替换为 Aurora 包装 handler，先保存原 handler；
- 框架错误（render/setup/lifecycle 钩子抛错）触发包装 handler：先调宿主原 handler，再把 `err` 安全读取 `name/message/stack`（getter 异常隔离、空 message 用稳定回退 `"Unknown Vue error"`），经 `parseErrorEventBody` 成功后作为 `EventType.Error` 提交统一管道；
- mount 阶段同步渲染错误发生在 `sdk.start()` 完成前：适配器用**有界 pre-start 闩锁**（≤32 条）暂存草稿，start 完成后排空到同一统一管道；这不是第二条上报链；
- `uninstall`/`destroy` 只恢复仍属于本实例的包装 handler，不踩宿主之后新设的 handler。

## 隐私与宿主安全

- 不采集请求/响应体、Cookie、Authorization、表单、组件 props/state、完整 DOM/文本；
- 不调用 `preventDefault`/`stopPropagation`；不修改宿主全局；
- 内部解析/提交失败静默丢弃，不向宿主抛出；
- 每插件实例独立状态，无模块级可变状态。

## 体积

单框架适配 gzip ≤ 5 KiB 是发布门槛，当前构建为多文件 TypeScript 拼接的近似测量，标记 `requires-benchmark`；不得把该值描述为最终发布包体结论。
