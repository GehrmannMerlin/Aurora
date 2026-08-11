---
title: React 框架适配器（SDK-18 第一增量）
status: approved
implementation-status: implemented
owner: sdk
created: 2026-08-11
last-reviewed: 2026-08-11
applies-to:
  - packages/plugin-react
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
  - vue-framework-adapter.md
  - ../protocol/error-event-contract.md
  - ../superpowers/g07-approval-package.md
  - ../superpowers/plans/2026-08-11-sdk-18-react-framework-adapter.md
supersedes: none
review-cycle: sdk-framework-adapter-public-api-or-lifecycle-change
---

# React 框架适配器（SDK-18 第一增量）

## 1. 定位与批准来源

本文冻结 G07 叶子 SDK-18「React 框架生命周期适配」的第一增量：新增 `@aurora/plugin-react`，为 React 18 应用提供 `AuroraErrorBoundary` 与 SDK 句柄，把子树渲染/生命周期错误捕获为标准错误事件并进入既有统一管道，同时满足 StrictMode 开发期双生命周期幂等、cleanup 恢复、多实例隔离与宿主安全。架构边界以 approved [sdk-architecture.md](../architecture/sdk-architecture.md) §2 框架适配行与架构规范 §2.4.4 为准；错误正文以 approved [error-event-contract.md](../protocol/error-event-contract.md) 为准。

批准来源：G07_APPROVAL_PACKAGE 一次性批准（React 版本、公共接口、Error Boundary、StrictMode/重复初始化语义、cleanup、多实例、隐私与排除范围）。无需新 ADR：本增量实现 ADR-003 已批准的四层架构中的框架适配层。

## 2. 实施证据（2026-08-11）

本增量已实施为真实私有包 `@aurora/plugin-react`，并通过以下新鲜验证：

- `pnpm --filter @aurora/plugin-react test`：5 个测试文件、18 个测试全部通过（error-bridge 6、lifecycle 5、host-safety 3、multi-instance 2、architecture-boundary 2）；
- `pnpm --filter @aurora/plugin-react test:coverage`：statements 94.59%、branches 86%、functions 100%、lines 98.41%（门禁 85/80/85/85）；
- `pnpm --filter @aurora/plugin-react typecheck`（含 test-browser）无诊断；
- `pnpm --filter @aurora/plugin-react test:package`：构建根入口只暴露 `createReactAuroraPlugin` 一个运行时值，私有子路径全部返回 `ERR_PACKAGE_PATH_NOT_EXPORTED`；
- `pnpm --filter @aurora/plugin-react test:browser`：Playwright 1 个 Chromium 场景通过（真实 React 应用 mount → 子树 render 抛框架错误 → 标准错误事件经统一管道到达 transport、宿主继续运行；StrictMode 双挂载 SDK 只启动一次、宿主元素仍可交互）；
- `pnpm check:boundaries`：`@aurora/plugin-react` 复用 `sdk-framework` 层依赖合规、无违规；`git diff --check` 无空白错误；
- 体积：dist 运行时 JS 为多文件 TypeScript 拼接的近似，单框架适配 gzip ≤ 5 KiB 门槛标记 `requires-benchmark`，非最终 tree-shaken 发布结论。

## 3. 采用方案与包边界

- 新增私有包 **`@aurora/plugin-react`**（`aurora.layer: sdk-framework`），运行时依赖 `@aurora/browser`、`@aurora/core`、`@aurora/event-schema`（workspace:*），peerDependencies `react`/`react-dom`（^18.3.0）；
- 复用 SDK-17 已添加的 `sdk-framework` 层（允许依赖目标 `{ sdk-core, sdk-browser, protocol }`），不改 workspace-policy；
- 工厂内部调用 `@aurora/browser` 的 `createAuroraSdk` 构建 `AuroraSdkHandle`；框架事件只经句柄公共管道提交；
- 不采用全局单例或事件总线；不复制 Core/Browser/插件能力；不建第二套上报链；不依赖 `@aurora/plugin-vue`。

## 4. 公共 TypeScript 契约

以下符号全部从 `@aurora/plugin-react` 根入口导出。包不提供第二个子路径出口。

```ts
import type { AuroraSdkHandle, CreateAuroraSdkInput } from '@aurora/browser';
import type { ComponentType, ReactNode } from 'react';

export interface AuroraErrorBoundaryProps {
  readonly children?: ReactNode;
  readonly fallback?: ReactNode; // 可选降级 UI；默认错误后渲染 null
}

export interface ReactAuroraPlugin {
  readonly name: 'aurora-react';
  readonly AuroraErrorBoundary: ComponentType<AuroraErrorBoundaryProps>;
  readonly sdk: AuroraSdkHandle;
  destroy(): Promise<void>;
}

export function createReactAuroraPlugin(input: CreateAuroraSdkInput): ReactAuroraPlugin;
```

工厂是同步且非副作用导入后的显式工厂。内部转换函数（`buildReactErrorDraft`）不公开。

## 5. 错误桥

React 的框架错误入口是 Error Boundary 的 `componentDidCatch(error, errorInfo)`。捕获顺序固定为：

1. 把 `error` 安全转换为 `ErrorDescriptor`：只读取 `name`/`message`/`stack`（每个经 try/catch，getter 异常隔离）；非对象/空 message 用稳定回退 `"Unknown React error"`；字符串直接作为 message；
2. **不采集** `errorInfo.componentStack`、组件 props/state（隐私边界，且错误事件协议无组件字段）；
3. 经 `parseErrorEventBody({ category: ErrorCategory.JavaScript, error })` 校验，成功后作为 `EventType.Error` 提交；
4. 提交路径固定为 `sdk.control.processEvent → sdk.core.submitEventDraft → sdk.delivery.enqueue → flush`（与 composition 包装插件一致，走统一管道）；
5. 全程 try/catch，任何内部失败静默丢弃，不向宿主抛出；`componentDidCatch` 本身永不抛出。

不保存原生 Error/组件引用。

## 6. 有界 pre-start 闩锁

React 在 commit 阶段（`componentDidMount` 之前）触发 `componentDidCatch`，早于 `sdk.start()` 完成；此时 core 尚未 started，直接提交会返回 `not_started` 而丢失首个框架错误。适配器使用**有界 pre-start 闩锁**（≤32 条 `ErrorEventBody`，溢出丢最旧）：core started 前暂存草稿，`sdk.start()` 成功后排空到同一统一管道。该闩锁不是第二条上报链。

## 7. StrictMode 语义

React 18 StrictMode 开发期双调用 constructor/render/生命周期。本增量保证：

- 不注册任何全局监听（全局 `window.onerror`/`unhandledrejection` 由 `@aurora/plugin-error` 覆盖，本包不重复监听）——无双注册问题；
- `componentDidMount` 经 `ensureStarted()` 实例幂等守卫：StrictMode 双挂载只调用一次 `sdk.start()`（activity trail 只有一条 `page_enter`）；
- `componentWillUnmount` 无副作用（无宿主全局可恢复），卸载不残留、不销毁共享 SDK；
- 错误只在实际抛出时提交一次（同一错误不重复发送）。

## 8. 生命周期与多实例

- `AuroraErrorBoundary.render`：`hasError ? (fallback ?? null) : children`；V1 不 rethrow（`fallback` 由宿主 props 决定）。
- `destroy()`：清 pre-start 缓冲、置 destroyed、`await sdk.destroy()`；destroy 后边界提交为 no-op；幂等。
- 每插件实例独立状态（closed over factory closure）：SDK 句柄、coreStarted/startRequested 守卫、缓冲、destroyed；无模块级可变状态；两实例各自 handle 与边界类，互不干扰。

## 9. 隐私与宿主安全

- 默认不采集请求/响应体、Cookie、Authorization、表单内容、组件 props/state、`errorInfo.componentStack`、完整 DOM/文本、完整行为轨迹、控制台正文、完整 IP 或指纹；
- 错误正文只含 `name/message/stack`（受协议限制）；不调用事件控制方法；不修改宿主全局；
- 内部失败静默丢弃；原宿主错误处理语义（React Error Boundary 是官方错误捕获机制）不被吞掉或改变。

## 10. 排除范围

本增量不实现：浏览器持久化离线队列（PRD §6.2 deferred）、完整浏览器矩阵（G14 OPS-02）、采样算法、行为插件、用户上下文 wire 行为、Vue 适配（SDK-17 单独包）、Console 页面。本增量不修改 Core/Browser/event-schema 的公共接口；不依赖 `@aurora/plugin-vue`。

## 11. 测试与覆盖率

- 单元/契约（jsdom）：错误桥转换、生命周期（正常渲染/错误捕获/StrictMode 单次启动/unmount 无残留/destroy no-op）、宿主安全（不泄露 componentStack、内部失败隔离、pre-start 缓冲）、多实例隔离、架构边界；
- 覆盖率：lines ≥ 85%、branches ≥ 80%、functions ≥ 85%、statements ≥ 85%（实际 94.59/86/100/98.41）；
- Chromium 真实浏览器：1 个场景（真实 React 应用 mount → 框架错误 → 标准事件 → 宿主继续 → StrictMode 安全）；完整 Chromium/Firefox/WebKit 矩阵留给 G14 OPS-02。
