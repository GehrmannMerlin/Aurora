---
title: Vue 框架适配器（SDK-17 第一增量）
status: approved
implementation-status: implemented
owner: sdk
created: 2026-08-11
last-reviewed: 2026-08-11
applies-to:
  - packages/plugin-vue
related:
  - ../../AGENTS.md
  - ../../AURORA_RULES.md
  - ../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md
  - '../../Aurora 架构规范.md'
  - '../../Aurora 代码规范.md'
  - '../../Aurora 测试规范.md'
  - '../../Aurora ADR 规范.md'
  - ../architecture/sdk-architecture.md
  - ../architecture/aurora-v1-remaining-module-batches.md
  - ../adr/ADR-003-sdk-plugin-architecture.md
  - ../adr/ADR-005-event-schema-source-of-truth.md
  - ../adr/ADR-006-one-way-dependencies.md
  - sdk-core-foundation.md
  - sdk-public-configuration-context-composition.md
  - sdk-reliable-delivery-chain.md
  - ../protocol/error-event-contract.md
  - ../superpowers/g07-approval-package.md
  - ../superpowers/plans/2026-08-11-sdk-17-vue-framework-adapter.md
supersedes: none
review-cycle: sdk-framework-adapter-public-api-or-lifecycle-change
---

# Vue 框架适配器（SDK-17 第一增量）

## 1. 定位与批准来源

本文冻结 G07 叶子 SDK-17「Vue 框架生命周期适配」的第一增量：新增 `@aurora/plugin-vue`，把 Vue 3 应用接入 Aurora SDK，捕获 Vue 框架错误为标准错误事件并进入既有统一管道，同时提供符合 Vue 习惯的 install/uninstall 生命周期、宿主原 errorHandler 恢复、重复初始化幂等与多实例隔离。架构边界以 approved [sdk-architecture.md](../architecture/sdk-architecture.md) §2 框架适配行与架构规范 §2.4.4 为准；错误正文以 approved [error-event-contract.md](../protocol/error-event-contract.md) 为准。

批准来源：G07_APPROVAL_PACKAGE 一次性批准（Vue 版本、公共接口、install/uninstall 语义、错误桥、路由上下文、多实例、隐私与排除范围）。无需新 ADR：本增量实现 ADR-003 已批准的四层架构中的框架适配层。

## 2. 实施证据（2026-08-11）

本增量已实施为真实私有包 `@aurora/plugin-vue`，并通过以下新鲜验证：

- `pnpm --filter @aurora/plugin-vue test`：5 个测试文件、21 个测试全部通过（error-bridge 6、lifecycle 6、host-safety 5、multi-instance 2、architecture-boundary 2）；
- `pnpm --filter @aurora/plugin-vue test:coverage`：statements 94.05%、branches 83.78%、functions 100%、lines 98.82%（门禁 85/80/85/85）；
- `pnpm --filter @aurora/plugin-vue typecheck`（含 test-browser）无诊断；
- `pnpm --filter @aurora/plugin-vue test:package`：构建根入口只暴露 `createVueAuroraPlugin`、`isVueRouterLike` 两个运行时值，私有子路径全部返回 `ERR_PACKAGE_PATH_NOT_EXPORTED`；
- `pnpm --filter @aurora/plugin-vue test:browser`：Playwright 1 个 Chromium 场景通过（真实 Vue 应用 mount → render 抛框架错误 → 标准错误事件经统一管道到达 transport、宿主原 errorHandler 先被调用、宿主继续运行、destroy 后原 errorHandler 恢复）；
- `pnpm check:boundaries`：新增 `sdk-framework` 层生效，`@aurora/plugin-vue` 依赖合规、无违规；`git diff --check` 无空白错误；
- 体积：dist 运行时 JS 为多文件 TypeScript 拼接的近似，单框架适配 gzip ≤ 5 KiB 门槛标记 `requires-benchmark`，非最终 tree-shaken 发布结论。

## 3. 采用方案与包边界

- 新增私有包 **`@aurora/plugin-vue`**（`aurora.layer: sdk-framework`），运行时依赖 `@aurora/browser`、`@aurora/core`、`@aurora/event-schema`（workspace:*），peerDependency `vue`（^3.4.0）；
- workspace-policy 层矩阵新增 **`sdk-framework`** 层，允许依赖目标 `{ sdk-core, sdk-browser, protocol }`（与 `sdk-plugin` 相同目标集），并在环境检查中复用 `sdk-plugin` 的禁止宿主全局/事件控制/宿主修改/模块级可变状态规则；
- 工厂内部调用 `@aurora/browser` 的 `createAuroraSdk` 构建 `AuroraSdkHandle`；框架事件只经句柄公共管道提交；
- 不采用全局单例或事件总线（破坏多实例隔离）；不复制 Core/Browser/插件能力；不建第二套上报链。

## 4. 公共 TypeScript 契约

以下符号全部从 `@aurora/plugin-vue` 根入口导出。包不提供第二个子路径出口。

```ts
import type { AuroraSdkHandle, CreateAuroraSdkInput } from '@aurora/browser';
import type { App } from 'vue';

export interface VueRouteLocationLike {
  readonly path?: unknown;
  readonly fullPath?: unknown;
}

export interface VueRouterLike {
  readonly afterEach: (hook: (to: VueRouteLocationLike) => void) => { (): void };
}

export function isVueRouterLike(value: unknown): value is VueRouterLike;

export interface VueAuroraOptions {
  readonly router?: unknown; // 可选 Vue Router，install 时经 isVueRouterLike 能力检查
}

export interface VueAuroraPlugin {
  readonly name: 'aurora-vue';
  install(app: App, options?: VueAuroraOptions): void;
  uninstall(app: App): void;
  readonly sdk: AuroraSdkHandle;
  destroy(): Promise<void>;
}

export function createVueAuroraPlugin(input: CreateAuroraSdkInput): VueAuroraPlugin;
```

工厂是同步且非副作用导入后的显式工厂。内部转换函数（`buildVueErrorDraft`）不公开。

## 5. 生命周期语义

- **install(app, options?)**：同步。若已 destroyed 或已绑定其他 app → 幂等 no-op；保存原 `app.config.errorHandler`；设置包装 handler（先调原 handler，再提交框架错误）；可选 router `afterEach` 记录 `route_change`；`void sdk.start()`（start 完成后把 pre-start 缓冲排空到统一管道）。
- **uninstall(app)**：仅当 `app.config.errorHandler` 仍为本实例包装 handler 时恢复原 handler（原 handler 为 undefined 时用 `delete` 清除，不踩宿主之后新设的 handler）；移除路由钩子；`void sdk.destroy()`。
- **destroy()**：对已绑定 app 执行与 uninstall 相同恢复；清除 pre-start 缓冲；置 destroyed；`await sdk.destroy()`；幂等。destroyed 后 install 为 no-op。
- **重复初始化**：同一实例对已绑定 app 二次 install 为 no-op，不重复包装监听。

## 6. 框架错误桥

Vue 的 `errorHandler(err, instance, info)` 是框架错误入口。包装 handler 顺序固定为：

1. 先调用宿主原 handler（保持宿主语义）；
2. 把 `err` 安全转换为 `ErrorDescriptor`：只读取 `name`/`message`/`stack`（每个经 try/catch，getter 异常隔离）；非对象/空 message 用稳定回退 `"Unknown Vue error"`；字符串直接作为 message；
3. 经 `parseErrorEventBody({ category: ErrorCategory.JavaScript, error })` 校验，成功后作为 `EventType.Error` 提交；
4. 提交路径固定为 `sdk.control.processEvent → sdk.core.submitEventDraft → sdk.delivery.enqueue → flush`（与 composition 包装插件一致，走统一管道：隐私过滤 → beforeSend → 采样 → 队列/批次 → 传输）；
5. 全程 try/catch，任何内部失败静默丢弃，不向宿主抛出。

**不采集** `instance` 内部状态、`info` 字符串、组件 props/state（无 wire 契约字段且为隐私边界）。不保存原生 Error/组件引用。

## 7. 有界 pre-start 闩锁

Vue 的 `errorHandler` 在 mount 的**同步渲染**中触发，早于 `sdk.start()` 的微任务完成；此时 core 尚未 started，直接提交会返回 `not_started` 而丢失首个框架错误。适配器使用**有界 pre-start 闩锁**（≤32 条 `ErrorEventBody`，溢出丢最旧）：core started 前暂存草稿，`sdk.start()` 成功后排空到同一统一管道。该闩锁不是第二条上报链，不绕过隐私过滤/采样/传输。

## 8. 路由与组件上下文

- **路由上下文**：`VueAuroraOptions.router` 可选。经 `isVueRouterLike` 能力检查后注册 `afterEach`，把 `fullPath`（或 `path`）安全字符串记录为安全活动轨迹 `route_change` 条目（`sdk.control.recordActivity`）；uninstall/destroy 移除钩子。`vue-router` 不成为硬依赖（结构性接口，宿主自带）。
- **组件上下文**：第一版不采集（错误事件协议无组件字段；隐私优先）。`instance`/`info` 仅作为转换输入的安全忽略。

## 9. 多实例与宿主安全

- 每插件实例独立状态（boundApp、原/包装 handler、路由钩子、pre-start 缓冲、coreStarted）；无模块级可变状态（workspace-policy 强制）；
- 两个实例各自 install 独立 app；一实例 uninstall/destroy 不影响另一实例；
- 不修改宿主全局；不调用事件控制方法；原 handler 先被调用；卸载只恢复仍属于本实例的包装 handler。

## 10. 隐私

默认不采集请求/响应体、Cookie、Authorization、表单内容、组件 props/state、完整 DOM/文本、完整行为轨迹、控制台正文、完整 IP 或指纹。错误正文只含 `name/message/stack`（受协议限制），路由轨迹只含 pathname。

## 11. 排除范围

本增量不实现：浏览器持久化离线队列（PRD §6.2 deferred）、完整浏览器矩阵（G14 OPS-02）、采样算法、行为插件、用户上下文 wire 行为、React 适配（SDK-18 单独计划）、Console 页面。本增量不修改 Core/Browser/event-schema 的公共接口（`createAuroraSdk` 输入与句柄按原样复用）。

## 12. 测试与覆盖率

- 单元/契约：错误桥转换（Error/字符串/非对象/回退/getter 异常/schema 拒绝）、生命周期（install/重复 install/uninstall 恢复/destroy 后 no-op/未安装 uninstall）、宿主安全（原 handler 先调、不踩宿主新 handler、内部失败隔离、pre-start 缓冲、不保留原生 Error 引用）、多实例隔离、架构边界；
- 覆盖率：lines ≥ 85%、branches ≥ 80%、functions ≥ 85%、statements ≥ 85%（实际 94.05/83.78/100/98.82）；
- Chromium 真实浏览器：1 个场景（真实 Vue 应用 mount → 框架错误 → 标准事件 → 宿主继续 → destroy 恢复）；完整 Chromium/Firefox/WebKit 矩阵留给 G14 OPS-02。
