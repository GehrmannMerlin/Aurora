# SDK-18 React Framework Adapter Implementation Plan

> **For agentic workers:** 本计划由当前 Claude Code 主会话直接实施（用户明确不派 subagent/reviewer）。步骤使用 checkbox（`- [ ]`）语法跟踪。

**Goal:** 新增 `@aurora/plugin-react` 框架适配包，为 React 18 应用提供 `AuroraErrorBoundary`（class Error Boundary）与 SDK 句柄，把子树渲染/生命周期错误捕获为标准错误事件并进入既有统一管道，同时满足 StrictMode 双生命周期幂等、cleanup 恢复、多实例隔离与宿主安全。

**Architecture:** 框架适配层只依赖已公开 SDK 接口：工厂内部调用 `@aurora/browser` 的 `createAuroraSdk` 构建句柄；`AuroraErrorBoundary` 为 class 组件，`componentDidCatch` 把错误安全转换为 `JavaScriptErrorEventBody` 并经句柄公共管道（`control → core → delivery`）提交；`componentDidMount` 以实例幂等守卫启动 SDK；渲染/生命周期错误早于 start 完成时由**有界 pre-start 闩锁**（≤32 条）暂存后排空。全局 `window.onerror`/`unhandledrejection` 由 `@aurora/plugin-error` 默认覆盖，本包不重复监听宿主全局。不复制 Core/Browser/插件能力、不建第二套上报链、不改变事件协议。

**Tech Stack:** TypeScript 6.0.3（strict）、React 18（peerDependency `react`/`react-dom` ^18.3.0，dev 18.3.1）、`@aurora/browser`/`@aurora/core`/`@aurora/event-schema`（workspace:*）、vitest 4.1.10（jsdom）、Playwright 1.62（Chromium only）、`@types/react` 18.3.31、`@types/react-dom` 18.3.31。

## 固定回读与权威边界

| Module ID | 完整回读文件 | 重点章节 | 本计划不得改变的业务逻辑 | 缺失门禁 |
| --------- | ------------ | -------- | ------------------------ | -------- |
| SDK-18 | 与 SDK-17 相同的固定回读集合（`BASE-PRD`/`BASE-ARCH`/`BASE-IMPL`/`SDK-ARCH`/`SDK-CORE`/`SDK-SOURCES`/`SDK-PLUGINS`/`OPS-QUALITY`/`FORM`） | PRD §4.4.5、§5.1.1、§5.2、§6；架构规范 §2.4.4；SDK 架构 §2 框架适配行、§3、§5、§7—8 | React 框架错误默认采集并聚合为问题；框架适配只做生命周期接线/框架错误/组件与路由上下文/转换为标准事件/框架习惯初始化；不复制 Core/Browser/插件、不建第二上报链、不改事件协议；StrictMode 开发期双生命周期不得重复注册/重复发送；单框架适配 gzip ≤ 5 KiB（requires-benchmark） | 本增量经 G07_APPROVAL_PACKAGE 一次性批准（React 版本、公共接口、Error Boundary、StrictMode 语义）；无需新 ADR（实现 ADR-003 已批准分层架构） |

**Global Constraints**
- 框架适配包只允许依赖 `@aurora/browser`、`@aurora/core`、`@aurora/event-schema`（根公开出口），peerDependencies `react`/`react-dom`；禁止依赖其他 `@aurora/*`（含 `@aurora/plugin-vue`）、禁止私有路径导入、禁止循环依赖。
- 框架适配源码禁止直接引用宿主全局（`window`/`document`/`navigator`/`location`/`fetch`/`globalThis`/`XMLHttpRequest`/`localStorage`/`sessionStorage`/Node 运行时）——由 `sdk-framework` 层强制（SDK-17 已添加该层，本增量复用，无需再改 workspace-policy）。
- 事件只经 `AuroraSdkHandle` 公共管道提交；不绕过隐私过滤/beforeSend/采样；不创建独立队列/传输；pre-start 闩锁 ≤32 条且排空到同一管道。
- Error Boundary 不采集 React `errorInfo.componentStack`/组件 props/state 敏感内容；不保存原生 Error 引用；不 rethrow（V1 渲染 fallback 或透明）。
- StrictMode 双生命周期：`componentDidMount` 幂等守卫；`componentWillUnmount` 无副作用；同一实例不重复注册监听/不重复发送同一框架事实。
- 包不捆绑 `react`；`sideEffects: false`；根出口只暴露 `createReactAuroraPlugin` 与类型。
- 单框架适配 gzip ≤ 5 KiB 为发布门槛（`requires-benchmark`，本轮只记录近似字节）。
- 本轮测试预算：只跑本包 targeted tests + 1 条 Chromium React smoke + 受影响 lint/typecheck/build；不跑 root check/PostgreSQL/Redis/其他包/G05/G06 全套/Firefox/WebKit。
- 文件命名 kebab-case、类型 PascalCase、函数 camelCase；无说明 `any`、非空断言、双重断言禁用。

---

## File Structure

```
packages/plugin-react/                       # 新包
├── README.md
├── package.json                             # aurora.layer: sdk-framework；deps browser/core/event-schema；peer react/react-dom
├── playwright.config.ts                     # Chromium only
├── tsconfig.json                            # extends base；lib ES2024+DOM；types node+vitest/globals
├── tsconfig.build.json
├── vitest.config.ts                         # include test/**；85/80/85/85 门禁；jsdom（按文件）
├── src/
│   ├── index.ts                             # 公共出口：createReactAuroraPlugin + 类型
│   ├── react-error-bridge.ts                # React error → ErrorDescriptor → parseErrorEventBody
│   └── react-plugin.ts                      # createReactAuroraPlugin 工厂 + AuroraErrorBoundary + 生命周期
├── test/
│   ├── architecture-boundary.test.ts
│   ├── error-bridge.test.ts
│   ├── lifecycle.test.ts                    # init/错误桥/StrictMode 双生命周期/cleanup/重复 init/多实例
│   ├── host-safety.test.ts                  # 原宿主错误不吞、内部失败隔离、pre-start 缓冲、引用释放
│   ├── multi-instance.test.ts
│   └── package-entry.test.ts
└── test-browser/
    ├── fixture-server.ts                    # 服务 adapter/browser/core/sdk/event-schema dist + react UMD + scheduler
    └── react-adapter.spec.ts                # 1 条 Chromium smoke
```

> 依赖 SDK-17 已完成的 `sdk-framework` 层与 `@aurora/plugin-vue` 前例；本增量不改 workspace-policy。

---

### Task 1: `@aurora/plugin-react` 包骨架 + 错误桥 + 公共契约

**Files:**
- Create: `packages/plugin-react/package.json`、`tsconfig.json`、`tsconfig.build.json`、`vitest.config.ts`
- Create: `packages/plugin-react/src/react-error-bridge.ts`
- Create: `packages/plugin-react/src/index.ts`（Task 1 最小占位，Task 2 替换为最终出口）
- Test: `packages/plugin-react/test/error-bridge.test.ts`、`packages/plugin-react/test/architecture-boundary.test.ts`

**Interfaces:**
- Consumes: `@aurora/event-schema` 根导出 `ErrorCategory`、`parseErrorEventBody`、`ErrorEventBody`、`ERROR_EVENT_LIMITS`。
- Produces: `buildReactErrorDraft(err: unknown): { ok: true; body: ErrorEventBody } | { ok: false; reason: 'no_error' | 'schema_rejected' }`（Task 2/3 内部使用）。

- [ ] **Step 1: 创建包配置**

`packages/plugin-react/package.json`（name `@aurora/plugin-react`、`aurora.layer: sdk-framework`、`exports "."→dist`、`sideEffects:false`、`engines node >=24.18.0 <25`；scripts `build/typecheck/test/test:coverage/test:package/test:browser`；dependencies `@aurora/browser|core|event-schema` workspace:*；peerDependencies `react: "^18.3.0"`、`react-dom: "^18.3.0"`；devDependencies `react 18.3.1`、`react-dom 18.3.1`、`@types/react 18.3.31`、`@types/react-dom 18.3.31`、`jsdom 30.0.1`、`@playwright/test 1.62.1`、`@types/node 24.13.3`、`@vitest/coverage-v8 4.1.10`、`typescript 6.0.3`、`vitest 4.1.10`）。
`tsconfig.json`：extends base，`lib ["ES2024","DOM"]`，include `src/test/test-browser/vitest.config`；`tsconfig.build.json` 同 SDK-17；`vitest.config.ts` 含 `include: ['test/**/*.test.ts']` 与 85/80/85/85 门禁（环境：jsdom 按文件标记）。

- [ ] **Step 2: 运行 pnpm install 更新 lockfile**

Run: `pnpm install`
Expected: lockfile 包含 `@aurora/plugin-react` 与 react/react-dom/@types 解析；无 peer 冲突。

- [ ] **Step 3: 写错误桥失败测试**

`test/error-bridge.test.ts`：与 SDK-17 `error-bridge.test.ts` 同构（Error 值→javascript body、null/非对象→no_error、字符串回退、空 message 稳定回退、hostile getter 隔离、超长 message schema_rejected），import `buildReactErrorDraft`。

- [ ] **Step 4: 运行确认失败**

Run: `pnpm --filter @aurora/plugin-react test -- test/error-bridge.test.ts` Expected: FAIL。

- [ ] **Step 5: 最小实现错误桥**

`src/react-error-bridge.ts`：复制 SDK-17 的 `readErrorDescriptor`/`readSafeString` 私有逻辑（两个框架适配器互不依赖；校验仍只由 event-schema `parseErrorEventBody` 负责），导出 `buildReactErrorDraft`。`src/index.ts` 占位 `export {}`。

- [ ] **Step 6: 运行通过**

Run: `pnpm --filter @aurora/plugin-react test -- test/error-bridge.test.ts` Expected: PASS。

- [ ] **Step 7: 写并跑架构边界测试**

`test/architecture-boundary.test.ts`：manifest `aurora.layer` 为 `sdk-framework`、dependencies 只含 `@aurora/browser|core|event-schema`、peerDependencies 含 `react`/`react-dom`；src 扫描禁止 `@aurora/*/` 私有路径、`window.`/`document.`/`console.`/`preventDefault(`/`Math.random`/`EventEnvelope`/`CURRENT_PROTOCOL_VERSION`/`node:` 等。Run: `pnpm --filter @aurora/plugin-react test -- test/architecture-boundary.test.ts`。
Run: `pnpm check:boundaries` Expected: 无新 violation（`sdk-framework` 层已存在）。

- [ ] **Step 8: 记录提交边界（本叶子结束时统一提交）**

---

### Task 2: AuroraErrorBoundary + 生命周期（StrictMode 幂等、pre-start 缓冲、多实例）

**Files:**
- Create: `packages/plugin-react/src/react-plugin.ts`
- Modify: `packages/plugin-react/src/index.ts`（最终公共出口替换占位）
- Test: `packages/plugin-react/test/lifecycle.test.ts`、`packages/plugin-react/test/host-safety.test.ts`、`packages/plugin-react/test/multi-instance.test.ts`

**Interfaces:**
- Consumes: `createAuroraSdk`/`AuroraSdkHandle`/`CreateAuroraSdkInput`（`@aurora/browser`）；`buildReactErrorDraft`（Task 1）；`EventType`（`@aurora/event-schema`）；`react` 的 `Component`/`ComponentType`/`ReactNode` 类型。
- Produces:
```ts
export interface AuroraErrorBoundaryProps {
  readonly children?: ReactNode;
  readonly fallback?: ReactNode;
}
export interface ReactAuroraPlugin {
  readonly name: 'aurora-react';
  readonly AuroraErrorBoundary: ComponentType<AuroraErrorBoundaryProps>;
  readonly sdk: AuroraSdkHandle;
  destroy(): Promise<void>;
}
export function createReactAuroraPlugin(input: CreateAuroraSdkInput): ReactAuroraPlugin;
```

- [ ] **Step 1: 写生命周期失败测试（jsdom）**

`test/lifecycle.test.ts`：`// @vitest-environment jsdom`。用 `createRoot`+`act` 渲染：
- `createReactAuroraPlugin` 返回 `AuroraErrorBoundary`/`sdk`；边界渲染 children 正常；
- 子树抛错（render 抛 `new Error('boom')`）→ `componentDidCatch` 捕获 → 经 sdk 提交（fake transport 记录 1 条 javascript 事件）；fallback 渲染或 null；
- StrictMode 包裹下挂载两次（mount→unmount→mount）→ `sdk.start()` 只触发一次（实例幂等守卫）、不重复注册、提交只发生在真实错误时；
- 卸载（unmount）后无残留资源（再次触发无新提交）；重复初始化（两次 `createReactAuroraPlugin`）独立；
- `destroy()` 后组件提交为 no-op。

fake transport 与 SDK-17 `host-safety` 同构（`as const` 结构化 success receipt，空 perEventResults）。

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @aurora/plugin-react test -- test/lifecycle.test.ts` Expected: FAIL。

- [ ] **Step 3: 实现 `react-plugin.ts`**

工厂内部 `const sdk = createAuroraSdk(input)`；闭包状态：`destroyed`、`coreStarted`、`startRequested`、有界 pre-start 缓冲（≤32）。`submitBody`/`bufferBody`/`drainPending`/`submitFrameworkError` 与 SDK-17 同构（`sdk.control.processEvent → sdk.core.submitEventDraft → sdk.delivery.enqueue → flush`，`not_started` 前缓冲）。`ensureStarted()`：若 `!startRequested && !destroyed`，置 `startRequested = true`，`void sdk.start().then((r) => { if (r.ok) { coreStarted = true; drainPending(); } })`。class `AuroraErrorBoundary extends Component<Props, { hasError: boolean }>`：`state = { hasError: false }`；`static getDerivedStateFromError()` 返回 `{ hasError: true }`；`componentDidCatch(error)` 调 `submitFrameworkError(error)`；`componentDidMount()` 调 `ensureStarted()`；`componentWillUnmount()` 空实现（无宿主全局可恢复）；`render()` 返回 `this.state.hasError ? (this.props.fallback ?? null) : this.props.children`。工厂 `Object.freeze({ name: 'aurora-react', AuroraErrorBoundary, sdk, async destroy() { destroyed = true; pending=[]; coreStarted=false; await sdk.destroy(); } })`。`index.ts` 最终导出 `createReactAuroraPlugin` 与类型。

- [ ] **Step 4: 写并跑宿主安全 + 多实例测试**

`host-safety.test.ts`：内部失败隔离（超长 message 草稿不抛、后续合法事件仍提交）、pre-start 缓冲（start 完成前错误经缓冲后送达）、提交正文不等于原始 Error（引用释放）、不采集 `errorInfo.componentStack`。`multi-instance.test.ts`：两个插件实例各自边界，一实例 destroy 不影响另一实例提交。Run: `pnpm --filter @aurora/plugin-react test` Expected: PASS。

- [ ] **Step 5: 记录提交边界（本叶子结束时统一提交）**

---

### Task 3: 包入口/文档 + Chromium smoke + 精简门禁

**Files:**
- Create: `packages/plugin-react/test/package-entry.test.ts`、`packages/plugin-react/README.md`、`packages/plugin-react/playwright.config.ts`、`packages/plugin-react/test-browser/fixture-server.ts`、`packages/plugin-react/test-browser/react-adapter.spec.ts`
- Modify: 根 `package.json`（`format:check` 与 `lint` 显式清单追加 `packages/plugin-react` 条目）
- Test: 全包 targeted gates

- [ ] **Step 1: 写并跑包入口测试**

`package-entry.test.ts`：构建后 `import('@aurora/plugin-react')` 只输出 `createReactAuroraPlugin`（运行时值）；私有路径（`src/index.js`、`internal/*`、`react-error-bridge`、`react-plugin`）返回 `ERR_PACKAGE_PATH_NOT_EXPORTED`。Run: `pnpm --filter @aurora/plugin-react test:package`。

- [ ] **Step 2: 更新根 lint/format 清单**

根 `package.json` `format:check` 与 `lint` 追加 `packages/plugin-react` 的 package.json/tsconfig/vitest/playwright/README/src/test/test-browser 条目（对齐 plugin-vue 追加方式）。

- [ ] **Step 3: 实现 Chromium smoke**

`playwright.config.ts`：chromium only。`fixture-server.ts`：服务 `packages/plugin-react|browser|core|sdk|event-schema` dist 与 `react/umd/react.development.js`、`react-dom/umd/react-dom.development.js`、`scheduler/umd/scheduler.development.js`（script 标签按 react → scheduler → react-dom 顺序加载，暴露全局 `React`/`ReactDOM`；importmap 只映射 `@aurora/*` 包）；页面 harness 用 `React.createElement`（无 JSX）创建 `createReactAuroraPlugin`、`React.createElement(React.StrictMode, null, React.createElement(plugin.AuroraErrorBoundary, null, 抛错组件))`，经 `ReactDOM.createRoot(...).render(...)`。
`react-adapter.spec.ts` 1 个测试：真实 React 应用 mount → 子树 render 抛错 → `AuroraErrorBoundary.componentDidCatch` → 标准 javascript 事件经统一管道到达 transport、宿主其余元素继续可点击、StrictMode 不重复发送、unmount/destroy 后无残留。
Run: `pnpm --filter @aurora/plugin-react test:browser` Expected: 1 Chromium 场景 PASS。

- [ ] **Step 4: 完整精简门禁**

Run（按顺序）：`pnpm --filter @aurora/plugin-react test` → `test:coverage`（85/80/85/85）→ `typecheck` → `test:package` → `test:browser` → `pnpm check:boundaries` → `git diff --check`。Expected: 全部通过；记录 coverage 真实数字。

- [ ] **Step 5: 写 README**

`packages/plugin-react/README.md`：职责/非职责、安装组合、公开 API、Error Boundary 用法、StrictMode 语义、pre-start 闩锁、隐私与排除范围、peer react 版本、gzip ≤5 KiB 标注 `requires-benchmark`。

- [ ] **Step 6: 记录提交边界（本叶子验收后统一提交）**

---

## Self-Review（SDK-18）

- **React 版本**：peer `react`/`react-dom` ^18.3.0、dev 18.3.1——与 G07_APPROVAL_PACKAGE 一致。
- **StrictMode 语义**：`componentDidMount` 经 `startRequested` 幂等守卫；`componentWillUnmount` 无副作用；双挂载不重复注册/不重复启动；错误只在实际抛出时提交一次。
- **公共 API**：`createReactAuroraPlugin(input)`/`AuroraErrorBoundary`/`sdk`/`destroy()`——与批准接口一致。
- **依赖方向**：`sdk-framework → sdk-core | sdk-browser | protocol`；只依赖根出口；不依赖 `@aurora/plugin-vue`。
- **不复制 SDK 运行时**：复用 `createAuroraSdk` 句柄；不创建第二套 Core/队列/传输。
- **cleanup**：boundary 无全局监听注册；unmount 无副作用；`destroy()` 清缓冲并幂等。
- **重复初始化**：每工厂独立 handle；boundary 幂等守卫；destroy 后提交 no-op。
- **多实例**：全部状态存于闭包/类实例，无模块级可变状态。
- **宿主安全**：不吞宿主错误（boundary 是 React 官方错误捕获机制）、不 rethrow、内部失败隔离、引用释放。
- **隐私**：不采集 `errorInfo.componentStack`/组件 props/state/表单/DOM 文本。
- **包入口**：`sideEffects:false`，构建只暴露批准符号。
- **测试不过量**：5 个单测文件 + 1 条 Chromium smoke。
- **无 Vue 范围重复**：错误桥私有逻辑独立复制（不依赖 plugin-vue），校验仍由 event-schema 单一来源。
- **无 TODO/TBD**。
