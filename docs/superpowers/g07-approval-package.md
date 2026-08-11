# G07 APPROVAL PACKAGE — SDK 框架适配器（Vue / React）

**日期：2026-08-11（创建）；2026-08-11（用户正式批准）**
**分支：`feature/g07-framework-adapters`（基于 origin/main `84ff7b7`，G06 PR #16 merged）**
**状态：✅ 用户已于 2026-08-11 一次性批准全部推荐方案（V1—V6、R1—R6、S1—S2）**

> **批准记录**：用户于 2026-08-11 对本包作出整体正式批准（"批准"）。
>
> **批准后执行**：SDK-17 writing-plans → SDK-17 实施/验收（completed 60→61）→ SDK-18 writing-plans → SDK-18 实施/验收（completed 61→62）→ G07 精简组验收 → feature PR/CI → merge main。两份正式规格 [vue-framework-adapter.md](../sdk/vue-framework-adapter.md)（SDK-17）与 [react-framework-adapter.md](../sdk/react-framework-adapter.md)（SDK-18）已 approved + implemented（2026-08-11 真实实施证据见各自规格第 2 节）。

---

## 一、G07 基线事实

- 当前正式叶子：**completed = 60 / remaining = 18**（G05、G06 completed；PR #16 已 merge main）。
- G07 两个叶子独立验收通过后：SDK-17 → 61/17、SDK-18 → 62/16；只有叶子独立验收成功才更新计数。
- G05 已交付 `@aurora/sdk`（`aurora.layer: sdk-core`，仅依赖 `@aurora/event-schema`）公共控制面（配置模型/`createSdkControlPlane`/请求分类/统一隐私过滤/`beforeSend`/确定性采样/安全轨迹有界缓冲）。
- G06 已交付可靠发送链（`createSdkDeliveryQueue` 有界 256、`buildDeliveryBatch`、`SdkBatchTransport` 端口、重试分类 PRD §6.3、`calculateSdkRetryDelay` 有界退避、`createSdkDeliveryChain` enqueue→batch→transport→receipt、`flush`/best-effort）、`@aurora/core` `CoreEventAccepted.event` 信封捕获、`@aurora/browser` `createBrowserBatchTransport` 与 composition 接线（pagehide → best-effort flush）。
- `@aurora/browser` composition 入口 `createAuroraSdk(input): AuroraSdkHandle` 已实施，是框架适配器的公共接线点（解析配置 → 创建环境/Core/控制面/交付链 → 包装注入插件 → 暴露 `start/stop/destroy/config/core/control/delivery/getActivityTrail`）。
- 错误事件协议契约已实现三类正文；`parseErrorEventBody()`、`ErrorCategory`、`ERROR_EVENT_LIMITS` 从 `@aurora/event-schema` 根入口导出。错误契约**不定义** React/Vue 框架专用来源字段（见 error-event-contract.md §"不定义 React/Vue 框架错误或开发者主动上报错误的专用来源字段"）。
- 安全活动轨迹已有 `route_change` 条目（`{ kind: 'route_change', pathname }`），经 `handle.control.recordActivity` 记录。

## 二、G07 最小 readiness 结果

| # | 检查项 | 结果 |
|---|---|---|
| A | G05 SDK public API 稳定 | ✅ 是——`@aurora/sdk` 与 `@aurora/browser` composition approved + implemented，公共导出稳定 |
| B | G06 delivery API 稳定 | ✅ 是——`createSdkDeliveryChain`/`SdkBatchTransport`/`createBrowserBatchTransport` approved + implemented，composition 已接线 |
| C | Vue 支持版本已 approved | ❌ 否——SDK 无 Vue 版本批准；ADR-025 的 Vue 3 只约束管理平台 `apps/console`，不约束 SDK 框架适配 |
| D | Vue adapter 公共接口已 approved | ❌ 否——无规格；formalization-readiness 中 `docs/sdk/framework-integrations.md` 状态 planned/blocked 且文件不存在 |
| E | Vue install/uninstall/lifecycle 语义已 approved | ❌ 否——SDK 架构 §3 只固定行为类别，实际签名与安装/卸载语义仍 deferred |
| F | React 支持版本已 approved | ❌ 否——SDK 无 React 版本批准 |
| G | React adapter 公共接口已 approved | ❌ 否——无规格 |
| H | React StrictMode / duplicate initialization 语义已 approved | ❌ 否——无规格 |
| I | framework browser compatibility matrix 已 approved | ❌ 否——完整矩阵 deferred 到 G14 OPS-02；测试策略 §4 只要求"Vue/React 适配与 Core/Browser 的版本组合必须通过正式示例和契约测试" |
| J | workspace-policy 层矩阵是否覆盖框架适配层 | ❌ 否——现有层矩阵只有 `protocol/sdk-core/sdk-browser/sdk-plugin/data/service/contract/tooling`，无 `sdk-framework` 层 |

**结论**：存在 required approved 规格缺口（C—J）。按本轮规则**不调用 brainstorming**，以下一次性列出 Vue + React 全部缺口及基于现有 PRD/架构的最小推荐方案。请一次性批准（可逐项调整）。

## 三、统一 ADR / 权威来源判定

### 已有 accepted 来源（可直接使用，无需新 ADR）

| 决策 | 来源 |
|---|---|
| SDK Core、Browser、采集插件、框架适配四层架构与依赖方向 | ADR-003（accepted）+ 架构规范 §2.4.4 + SDK 架构 §2 |
| 框架适配层只负责框架生命周期接线、框架特有错误、组件/路由上下文、转换为标准事件、框架习惯初始化接口；禁止复制 Core/Browser、维护另一条上报通道、改变事件协议 | 架构规范 §2.4.4 + SDK 架构 §2 框架适配行 |
| 事件统一管道（能力检查 → 规范化 → 隐私过滤 → Schema → 采样 → 队列/批次 → 传输），任何层不得在管道外发送 | SDK 架构 §4 + 架构规范 §2.4 |
| React/Vue 框架错误默认 100% 采集并聚合为问题 | PRD §5.1.1 |
| React/Vue 项目接入引导追加对应框架插件说明 | PRD §4.4.5 |
| 框架错误无专用协议字段，应转换为标准错误正文 | error-event-contract.md（approved / implemented） |
| 单框架适配 gzip 增量预算 ≤ 5 KiB（发布门槛，非已测结果，标记 `requires-benchmark`） | SDK 架构 §7 + 测试策略 §4 |
| 宿主安全：不吞宿主行为、恢复原 handler、异常隔离、多实例隔离、重复初始化幂等 | SDK 架构 §3/§5 + 代码/测试规范 |

### 明确 deferred / not-started（G07 不得越界）

- 浏览器持久化离线队列（PRD §6.2 deferred）；
- 完整 Chromium/Firefox/WebKit 兼容矩阵与参考应用（G14 OPS-02）；
- 采样算法、行为插件、用户上下文 wire 行为（SDK-10 规格明确 deferred）；
- 通用资源事件正文、行为事件正文；
- 管理平台 Console 的 React/Vue 页面（与 SDK 框架适配无关，G11/G12）；
- Source Map、告警、用量、保留（G04/G12）。

## 四、G07 一次性批准项

### 4.1 SDK-17 Vue 框架适配器（缺口 C、D、E）

| # | 缺口 | 最小推荐方案（基于现有 PRD/架构） |
|---|---|---|
| V1 | **Vue 支持版本** | **Vue 3（peerDependency `vue` ^3.4）**。Vue 2 已于 2023-12 EOL，第一版只支持 Vue 3。SDK 包不捆绑 Vue；安装 `@aurora/plugin-vue` 时宿主自带 Vue。 |
| V2 | **新包与层** | 新增私有包 **`@aurora/plugin-vue`**，`aurora.layer: sdk-framework`。运行时依赖（workspace 本地）：`@aurora/browser`（composition）、`@aurora/core`（`CorePlugin`/生命周期类型）、`@aurora/event-schema`（`parseErrorEventBody`/`ErrorCategory`/`ERROR_EVENT_LIMITS`）。peerDependencies：`vue`。 |
| V3 | **公共接口** | `createVueAuroraPlugin(input): VueAuroraPlugin`，其中 `input` 复用 `CreateAuroraSdkInput`（config/environment/plugins/pageOrigin/ingestEndpoint/transport），内部调用 `createAuroraSdk` 并持有 `AuroraSdkHandle`。返回：
```ts
interface VueAuroraPlugin {
  readonly name: 'aurora-vue';
  install(app: App, options?: VueAuroraOptions): void;   // Vue 插件安装点
  uninstall(app: App): void;                              // 卸载并恢复宿主状态
  readonly sdk: AuroraSdkHandle;                          // 底层 SDK 句柄（start/stop/destroy/config/control/…）
  destroy(): Promise<void>;                               // 释放全部资源
}
interface VueAuroraOptions {
  readonly router?: Router;        // 可选：注入后记录 route_change 到安全活动轨迹
}
```
框架错误桥采用 Vue 标准错误入口 **`app.config.errorHandler`**（包装：保存原 handler → 先调用原 handler 保持宿主语义 → 再把 err 转换为标准错误事件）。 |
| V4 | **install/卸载/生命周期语义** | `install(app)`：创建/绑定 `AuroraSdkHandle` → 包装 `app.config.errorHandler`（保存原引用）→ 注册可选 router `afterEach`（记录 `route_change`）→ `await sdk.start()`。`uninstall(app)`/`destroy()`：恢复原 `errorHandler` 引用 → 移除 router hook → `sdk.destroy()`。重复 install 幂等（同一实例对同一 app 二次 install 为 no-op，不重复包监听）。 |
| V5 | **框架错误 → 标准事件** | Vue errorHandler 收到的 `err` 任意值安全读取 `name/message/stack`（读取失败不抛）；message 缺失用稳定回退；经 `parseErrorEventBody({ category: ErrorCategory.JavaScript, error })` 成功后作为 `EventType.Error` 提交，**走 composition 已接线的统一管道**（隐私过滤 → beforeSend → 采样 → 队列/批次 → 传输）。不采集 `instance` 内部状态；不保存原生 Error 引用。 |
| V6 | **多实例 / 宿主安全** | 每插件实例独立状态（无模块级可变状态/注册表）；不吞原 errorHandler 行为；恢复后宿主行为不变；卸载/销毁幂等。 |

### 4.2 SDK-18 React 框架适配器（缺口 F、G、H）

| # | 缺口 | 最小推荐方案（基于现有 PRD/架构） |
|---|---|---|
| R1 | **React 支持版本** | **React 18（peerDependency `react`/`react-dom` ^18.3）**，同时兼容 React 19。使用 Error Boundary class 组件 API（React 18 稳定契约），不依赖 React 19 专有 root 选项。SDK 包不捆绑 React。 |
| R2 | **新包与层** | 新增私有包 **`@aurora/plugin-react`**，`aurora.layer: sdk-framework`。运行时依赖（workspace 本地）：`@aurora/browser`、`@aurora/core`、`@aurora/event-schema`。peerDependencies：`react`、`react-dom`。 |
| R3 | **公共接口** | `createReactAuroraPlugin(input): ReactAuroraPlugin`，`input` 复用 `CreateAuroraSdkInput`，内部调用 `createAuroraSdk`。返回：
```ts
interface ReactAuroraPlugin {
  readonly name: 'aurora-react';
  readonly AuroraErrorBoundary: ComponentType<AuroraErrorBoundaryProps>; // class Error Boundary
  readonly sdk: AuroraSdkHandle;
  destroy(): Promise<void>;
}
interface AuroraErrorBoundaryProps {
  readonly children?: ReactNode;
  readonly fallback?: ReactNode;      // 可选渲染降级 UI；默认透明传子
}
```
全局 `window.onerror`/`unhandledrejection` 已由 `@aurora/plugin-error` 默认覆盖（PRD §5.1.1 默认完整采集），React adapter **不重复监听**宿主全局错误。 |
| R4 | **错误桥** | `AuroraErrorBoundary` 为 class 组件：`componentDidCatch`/`getDerivedStateFromError` 捕获子树渲染与生命周期错误 → 转换为标准错误事件（`ErrorDescriptor` → `parseErrorEventBody` → 提交统一管道）。可选 `fallback` 降级 UI；错误处理后再 `throw`/rethrow 与否由宿主决定（V1 默认不 rethrow、渲染 fallback 或透明，遵守宿主 props）。 |
| R5 | **StrictMode / 重复初始化语义** | React 18 StrictMode 开发期会双调用 mount/unmount/effect/constructor。adapter 必须：同一 Boundary 实例挂载两次不重复注册监听；`componentDidMount`/`componentWillUnmount` 对称且幂等；cleanup 完整恢复；不重复发送同一框架事实；`destroy()` 幂等。**不得创建第二套 SDK、第二套监听、重复发送。** |
| R6 | **多实例 / 宿主安全** | 每插件实例独立状态；无模块级可变状态；错误事件只走统一管道；不采集组件 props/state 敏感内容；unmount/cleanup 恢复宿主。 |

### 4.3 共享缺口（I、J）

| # | 缺口 | 最小推荐方案 |
|---|---|---|
| S1 | **framework browser compatibility matrix** | 完整矩阵 **deferred 到 G14 OPS-02**（本轮测试预算硬限制不跑 Firefox/WebKit）。G07 本轮满足测试策略 §4 最低要求：每个框架 **1 条 Chromium smoke**（真实 Vue/React 应用 → adapter → 框架错误/生命周期场景 → Aurora 接到标准事件 → 宿主继续正常 → destroy 后状态恢复）+ 契约/单元测试（unit/jsdom）。 |
| S2 | **workspace-policy 层矩阵** | 在 `tooling/workspace-policy` 层矩阵新增 **`sdk-framework`** 层，允许依赖目标 `{ 'sdk-core', 'sdk-browser', 'protocol' }`（与 `sdk-plugin` 相同目标集）。依据：架构规范 §2.4.4 与 ADR-003 明确区分采集插件层与框架适配层。`sdk-plugin`/反向/循环/私有路径/宿主修改负例保持不变。 |

## 五、正式规格落档（批准后创建）

| 叶子 | 正式规格（approved 后） | 说明 |
|---|---|---|
| SDK-17 | `docs/sdk/vue-framework-adapter.md` | 冻结 Vue 版本、公共接口、install/uninstall/lifecycle、错误桥、路由上下文、多实例、隐私与排除范围 |
| SDK-18 | `docs/sdk/react-framework-adapter.md` | 冻结 React 版本、公共接口、Error Boundary、StrictMode 语义、cleanup、多实例、隐私与排除范围 |

同时把 `docs/architecture/formalization-readiness.md` 中 `framework-integrations.md`（planned/blocked）更新为上述两份规格。

## 六、测试与预算（按本轮硬限制）

- SDK-17：单元/jsdom 覆盖 install、错误桥、原 handler 保留、重复初始化、卸载恢复、多实例隔离；1 条 Chromium Vue smoke。**不跑 Firefox/WebKit。**
- SDK-18：单元/jsdom 覆盖 init、错误桥、StrictMode 双生命周期、cleanup/unmount、重复初始化、多实例；1 条 Chromium React smoke。**不跑 Firefox/WebKit。**
- 禁止 root pnpm check / root test / root coverage / PostgreSQL / Redis / Platform API / Console / G11 / ingestion 全套 / G05 全套 / G06 全套 / benchmark / performance suite。
- 两叶子完成后只跑一次精简组验收（Vue/React targeted tests + lint + typecheck + build/package-entry + 必要 package coverage + 2×Chromium smoke + `git diff --check`）。
