# SDK-17 Vue Framework Adapter Implementation Plan

> **For agentic workers:** 本计划由当前 Claude Code 主会话直接实施（用户明确不派 subagent/reviewer）。步骤使用 checkbox（`- [ ]`）语法跟踪。

**Goal:** 新增 `@aurora/plugin-vue` 框架适配包，把 Vue 3 应用安装到 Aurora SDK，捕获 Vue 框架错误为标准错误事件并进入既有统一管道，同时提供符合 Vue 习惯的 install/uninstall 生命周期、宿主原 errorHandler 恢复、重复初始化幂等与多实例隔离。

**Architecture:** 框架适配层只依赖已公开 SDK 接口：工厂内部调用 `@aurora/browser` 的 `createAuroraSdk` 构建 SDK 句柄，错误桥包装 Vue `app.config.errorHandler`（先调宿主原 handler 保持语义），把 `err` 安全转换为 `JavaScriptErrorEventBody` 并经句柄的 `control → core → delivery` 公共管道提交；可选 router 集成把路由变化记录为安全活动轨迹 `route_change`。不复制 Core/Browser/插件能力、不维护第二套上报链、不改变事件协议。

**Tech Stack:** TypeScript 6.0.3（strict）、Vue 3（peerDependency `vue` ^3.4.0，dev `vue` 3.5.41）、`@aurora/browser`/`@aurora/core`/`@aurora/event-schema`（workspace:*）、vitest 4.1.10（jsdom）、Playwright 1.62（Chromium only）、@vue/test-utils 2.4.11。

## 固定回读与权威边界

| Module ID | 完整回读文件 | 重点章节 | 本计划不得改变的业务逻辑 | 缺失门禁 |
| --------- | ------------ | -------- | ------------------------ | -------- |
| SDK-17 | `BASE-PRD`（[核心业务 PRD](../../Auroa-PRD-业务逻辑汇总-v2.1-核心业务定稿版.md)）、`BASE-ARCH`（[架构规范](../../Aurora 架构规范.md) + system-overview）、`BASE-IMPL`（代码/测试/ADR/文档规范）、`SDK-ARCH`（[sdk-architecture](./../architecture/sdk-architecture.md) + ADR-003/004/005/006）、`SDK-CORE`（[sdk-core-foundation](../sdk/sdk-core-foundation.md)、[core-event-creation](../sdk/core-event-creation.md)、[browser-environment-foundation](../sdk/browser-environment-foundation.md)）、`SDK-SOURCES`（browser error/request/performance source）、`SDK-PLUGINS`（error/request/performance capture plugin）、`OPS-QUALITY`（[test-strategy](../testing/test-strategy.md)、测试/部署/发布设计）、`FORM`（formalization-readiness、ADR 索引） | PRD §4.4.5、§5.1.1、§5.2、§6；架构规范 §2.4.4；SDK 架构 §2 框架适配行、§3、§5、§7—8 | Vue 框架错误默认采集并聚合为问题；框架适配只做生命周期接线/框架错误/组件与路由上下文/转换为标准事件/框架习惯初始化；不复制 Core/Browser/插件、不建第二上报链、不改事件协议；单框架适配 gzip ≤ 5 KiB（requires-benchmark） | 本增量经 G07_APPROVAL_PACKAGE 一次性批准（Vue 版本、公共接口、install/uninstall 语义）；无需新 ADR（实现 ADR-003 已批准分层架构） |

**Global Constraints**
- 框架适配包只允许依赖 `@aurora/browser`、`@aurora/core`、`@aurora/event-schema`（根公开出口），peerDependency `vue`；禁止依赖其他 `@aurora/*`、禁止私有路径导入、禁止循环依赖。
- 框架适配源码禁止直接引用宿主全局（`window`/`document`/`navigator`/`location`/`fetch`/`globalThis`/`XMLHttpRequest`/`localStorage`/`sessionStorage`/Node 运行时）——由 workspace-policy 新 `sdk-framework` 层强制。
- 事件只经 `AuroraSdkHandle` 公共管道（`control.processEvent → core.submitEventDraft → delivery.enqueue → flush`）提交；不绕过隐私过滤/beforeSend/采样；不创建独立队列/传输。
- 错误桥不采集 Vue `instance` 内部状态、不保存原生 Error 引用、不修改 `preventDefault`/传播；原 `errorHandler` 先被调用、卸载只恢复仍属于本适配器的包装 handler。
- 包不捆绑 `vue`；`sideEffects: false`；根出口只暴露 `createVueAuroraPlugin` 与类型。
- 单框架适配 gzip ≤ 5 KiB 为发布门槛（`requires-benchmark`，本轮只记录近似字节，不 claim 最终包体结论）。
- 本轮测试预算：只跑本包 targeted tests + 1 条 Chromium Vue smoke + 受影响 lint/typecheck/build；不跑 root check/PostgreSQL/Redis/其他包/G05/G06 全套/Firefox/WebKit。
- 文件命名 kebab-case、类型 PascalCase、函数 camelCase、布尔 `is/has/can/should` 前缀；无说明 `any`、非空断言、双重断言禁用。

---

## File Structure

```
packages/plugin-vue/                       # 新包
├── README.md
├── package.json                           # aurora.layer: sdk-framework；deps browser/core/event-schema；peer vue
├── playwright.config.ts                   # Chromium only，与既有 plugin 一致
├── tsconfig.json                          # extends base；lib ES2024+DOM（vue 类型需要）；types node+vitest/globals
├── tsconfig.build.json                    # 同 sdk 包模式；rootDir src → dist
├── vitest.config.ts                       # 85/80/85/85 门禁 + environment jsdom
├── src/
│   ├── index.ts                           # 公共出口：createVueAuroraPlugin + 类型
│   ├── vue-error-bridge.ts                # Vue err → ErrorDescriptor → parseErrorEventBody
│   └── vue-plugin.ts                      # createVueAuroraPlugin 工厂 + install/uninstall/destroy + 路由钩子
├── test/
│   ├── architecture-boundary.test.ts      # 层依赖/环境负例（对齐 plugin 模式）
│   ├── error-bridge.test.ts               # 转换：Error/字符串/非对象/读取失败/回退
│   ├── lifecycle.test.ts                  # install/uninstall/destroy/重复初始化/原 handler 保留与恢复
│   ├── host-safety.test.ts                # 原 handler 先调、只恢复自己的 wrapper、内部失败不抛
│   ├── multi-instance.test.ts             # 两实例独立、一实例销毁不影响另一
│   └── package-entry.test.ts              # 构建出口只暴露批准符号 + 私有路径拒绝
└── test-browser/
    ├── fixture-server.ts                  # 服务 adapter/browser/core/event-schema dist + vue ESM
    └── vue-adapter.spec.ts                # 1 条 Chromium smoke
```

`tooling/workspace-policy/src/graph.ts`、`environment.ts` 与 `tooling/workspace-policy/test/dependency-policy.test.ts` 同步新增 `sdk-framework` 层。

---

### Task 1: `sdk-framework` 层 + `@aurora/plugin-vue` 包骨架 + 错误桥

**Files:**
- Modify: `tooling/workspace-policy/src/graph.ts:31`
- Modify: `tooling/workspace-policy/src/environment.ts`（`inspectSource` 层联合与 `findEnvironmentViolations`）
- Modify: `tooling/workspace-policy/test/dependency-policy.test.ts`
- Create: `packages/plugin-vue/package.json`、`tsconfig.json`、`tsconfig.build.json`、`vitest.config.ts`
- Create: `packages/plugin-vue/src/vue-error-bridge.ts`
- Create: `packages/plugin-vue/src/index.ts`（Task 1 先建最小根出口占位，Task 2 替换为最终公共出口）
- Test: `packages/plugin-vue/test/error-bridge.test.ts`、`packages/plugin-vue/test/architecture-boundary.test.ts`

**Interfaces:**
- Consumes: `@aurora/event-schema` 根导出 `ErrorCategory`、`parseErrorEventBody`、`ErrorEventBody`、`ERROR_EVENT_LIMITS`；workspace-policy 层矩阵。
- Produces: `buildVueErrorDraft(err: unknown): { ok: true; body: ErrorEventBody } | { ok: false; reason: 'no_error' | 'schema_rejected' }`（Task 2/3 内部使用）；`sdk-framework` 层允许 `{ sdk-core, sdk-browser, protocol }`。

- [ ] **Step 1: workspace-policy 新增 `sdk-framework` 层**

在 `graph.ts` 的 `allowedLocalDependencyLayers` 中加入一行：
```ts
['sdk-framework', new Set<string>(['sdk-core', 'sdk-browser', 'protocol'])],
```
在 `environment.ts` 把 `inspectSource` 的 `layer` 参数联合类型改为 `'protocol' | 'sdk-core' | 'sdk-browser' | 'sdk-plugin' | 'sdk-framework'`，并把三处 `layer === 'sdk-plugin'` 判断改为 `layer === 'sdk-plugin' || layer === 'sdk-framework'`；`findEnvironmentViolations` 的层白名单加入 `'sdk-framework'`。

- [ ] **Step 2: 为 sdk-framework 层写 workspace-policy 失败测试**

在 `dependency-policy.test.ts` 追加：
```ts
it.each(['sdk-core', 'sdk-browser', 'protocol'] as const)(
  'allows sdk-framework to depend on %s',
  async (targetLayer) => { /* 构造 framework 包依赖 targetLayer，expect checkWorkspace ok:true */ },
);
it.each(['sdk-plugin', 'framework', 'tooling'] as const)(
  'rejects sdk-framework dependency on %s',
  async (targetLayer) => { /* expect forbidden-layer-dependency */ },
);
```

- [ ] **Step 3: 运行 policy 测试确认失败/通过**

Run: `pnpm --filter @aurora/workspace-policy test`
Expected: 新增层用例通过；现有用例不回退。

- [ ] **Step 4: 创建包配置**

`packages/plugin-vue/package.json`（name `@aurora/plugin-vue`、`aurora.layer: sdk-framework`、`exports "."→dist`、`sideEffects:false`、`engines node >=24.18.0 <25`；scripts `build/test/test:coverage/test:package/test:browser/typecheck`；dependencies `@aurora/browser|core|event-schema` workspace:*；peerDependencies `vue: "^3.4.0"`；devDependencies `vue 3.5.41`、`@vue/test-utils 2.4.11`、`jsdom 30.0.1`、`@playwright/test 1.62.1`、`@types/node 24.13.3`、`@vitest/coverage-v8 4.1.10`、`typescript 6.0.3`、`vitest 4.1.10`）。
`tsconfig.json`：extends `../../tsconfig.base.json`，覆盖 `compilerOptions.lib: ["ES2024", "DOM"]`、`noEmit:true`、`rootDir:"."`、`types:["node","vitest/globals"]`，include `src/**/*.ts`、`test/**/*.ts`、`vitest.config.ts`。
`tsconfig.build.json`：同 `packages/sdk/tsconfig.build.json`（declaration/outDir dist/rootDir src/sourceMap/types[]），include `src/**/*.ts`。
`vitest.config.ts`：同 `packages/sdk/vitest.config.ts` 且加 `environment: 'jsdom'`。

- [ ] **Step 5: 运行 pnpm install 更新 lockfile**

Run: `pnpm install`
Expected: lockfile 包含 `@aurora/plugin-vue` 与 vue/dev 依赖解析；无 peer 冲突报错。

- [ ] **Step 6: 写错误桥失败测试**

`packages/plugin-vue/test/error-bridge.test.ts`：
```ts
import { describe, expect, it } from 'vitest';
import { buildVueErrorDraft } from '../src/vue-error-bridge.js';

describe('buildVueErrorDraft', () => {
  it('converts an Error value into a javascript error body', () => {
    const result = buildVueErrorDraft(new Error('boom'));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body.category).toBe('javascript');
      expect(result.body.error.message).toBe('boom');
      expect(result.body.error.name).toBe('Error');
    }
  });
  it('rejects null/non-object values as no_error', () => {
    expect(buildVueErrorDraft(null).ok).toBe(false);
  });
  it('falls back for a plain string value', () => {
    const result = buildVueErrorDraft('plain string');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.body.error.message).toBe('plain string');
  });
  it('does not throw on hostile getters', () => {
    const hostile = {} as Record<string, unknown>;
    Object.defineProperty(hostile, 'message', { get() { throw new Error('trap'); } });
    const result = buildVueErrorDraft(hostile);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.body.error.message).toMatch(/Unknown Vue error/);
  });
});
```

- [ ] **Step 7: 运行确认失败**

Run: `pnpm --filter @aurora/plugin-vue test -- test/error-bridge.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 8: 最小实现错误桥**

`packages/plugin-vue/src/vue-error-bridge.ts`：见上方 `Interfaces` 签名。`readErrorDescriptor` 安全读取 `name/message/stack`（每个经 try/catch），非对象/空 message 用稳定回退 `"Unknown Vue error"`；只把 `{ category: ErrorCategory.JavaScript, error: descriptor }` 交给 `parseErrorEventBody`，成功返回 `parsed.data`，失败返回 `schema_rejected`。
`packages/plugin-vue/src/index.ts` 本 Task 只建最小占位（如 `export {}` 并注释最终出口于 Task 2 替换）。错误桥测试直接 `import { buildVueErrorDraft } from '../src/vue-error-bridge.js'`。

- [ ] **Step 9: 运行通过**

Run: `pnpm --filter @aurora/plugin-vue test -- test/error-bridge.test.ts`
Expected: PASS。

- [ ] **Step 10: 写并跑架构边界测试**

`architecture-boundary.test.ts`：直接 `import ... from '@aurora/plugin-vue'` 与私有路径（`@aurora/plugin-vue/src/vue-error-bridge`）导入断言——私有路径导入失败（`ERR_PACKAGE_PATH_NOT_EXPORTED` 由构建后包入口决定，本 Task 先断言层/依赖违规）；断言 `@aurora/plugin-vue` 只能依赖 `@aurora/browser|core|event-schema`（读 `package.json` dependencies 键），任何其他 `@aurora/*` 依赖返回 `forbidden-layer-dependency`。根出口符号面断言归 Task 3 的 `package-entry.test.ts`。
Run: `pnpm --filter @aurora/plugin-vue test -- test/architecture-boundary.test.ts`
Run: `pnpm check:boundaries` Expected: 无新 violation（新增 `sdk-framework` 包被允许）。

- [ ] **Step 11: 记录提交边界（本叶子结束时统一提交）**

---

### Task 2: Vue 生命周期集成（install/uninstall/destroy、errorHandler 包装与恢复、重复初始化、可选路由上下文）

**Files:**
- Create: `packages/plugin-vue/src/vue-plugin.ts`
- Modify: `packages/plugin-vue/src/index.ts`（最终公共出口替换临时导出）
- Test: `packages/plugin-vue/test/lifecycle.test.ts`、`packages/plugin-vue/test/host-safety.test.ts`

**Interfaces:**
- Consumes: `createAuroraSdk`/`AuroraSdkHandle`/`CreateAuroraSdkInput`（`@aurora/browser`）；`buildVueErrorDraft`（Task 1）；`EventType`（`@aurora/event-schema`）；`type { App } from 'vue'`。
- Produces:
```ts
export interface VueRouteLocationLike { readonly path?: unknown; readonly fullPath?: unknown; }
export interface VueRouterLike {
  readonly afterEach: (hook: (to: VueRouteLocationLike) => void) => { (): void };
}
export interface VueAuroraOptions { readonly router?: unknown; }
export interface VueAuroraPlugin {
  readonly name: 'aurora-vue';
  install(app: App, options?: VueAuroraOptions): void;
  uninstall(app: App): void;
  readonly sdk: AuroraSdkHandle;
  destroy(): Promise<void>;
}
export function createVueAuroraPlugin(input: CreateAuroraSdkInput): VueAuroraPlugin;
export function isVueRouterLike(value: unknown): value is VueRouterLike;
```

- [ ] **Step 1: 写生命周期失败测试**

`lifecycle.test.ts`：`createVueAuroraPlugin({ config: { clientKey: 'test-key' }, transport: fakeTransport })` 后：
- `install(app)` 设置 `app.config.errorHandler` 为函数且原 handler 引用被保存；
- 同一实例对同一 app 重复 `install` 幂等（errorHandler 身份不变，不重复包装）；
- `uninstall(app)` 恢复原 handler（身份严格等于原引用）；
- `install` 后再 `destroy()` 后再次 `install` 为 no-op（不恢复已销毁实例）；
- 传入 `{ router }` 时注册 `afterEach`，路由触发后 `sdk.getActivityTrail()` 出现 `route_change` 条目；`uninstall` 后移除钩子（再触发不新增条目）。

`fakeTransport`：实现 `SdkBatchTransport` 端口的空实现（`send` 返回成功 `{ ok: true, receipts: [] }`），避免 Node 中真实 fetch。测试用 `createApp({})`（不挂载），errorHandler 在未挂载 app 上直接可调用。

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @aurora/plugin-vue test -- test/lifecycle.test.ts`
Expected: FAIL（`vue-plugin.ts` 不存在）。

- [ ] **Step 3: 实现 `vue-plugin.ts`**

工厂内部 `const sdk = createAuroraSdk({ ...input, plugins: [...(input.plugins ?? [])] })`（不追加内部插件——框架事件直接走句柄公共管道）。实例状态仅存于闭包/实例字段（无模块级可变状态）：
- `errorHandlerByApp: WeakMap<App, { original?: App['config']['errorHandler']; wrapped: App['config']['errorHandler'] }>`；
- `destroyed: boolean`；`routeOff: (() => void) | undefined`。
- `install(app, options?)`：若 destroyed → no-op；若已登记该 app → no-op；登记并保存 `original = app.config.errorHandler`，设置 `wrapped = (err, instance, info) => { if (original) original(err, instance, info); this.handleFrameworkError(err); }`（先调原 handler）。若 `options?.router` 且 `isVueRouterLike` 通过，`routeOff = router.afterEach((to) => this.recordRouteChange(to))`；然后 `void sdk.start()`（fire-and-forget，install 保持同步）。
- `uninstall(app)`：仅当 `app.config.errorHandler === wrapped` 时恢复为 `original`（防止覆盖宿主之后新设的 handler）；`routeOff?.()` 并置 undefined；`void sdk.destroy()`；从 WeakMap 删除该 app。
- `destroy()`：对已登记的每个 app 执行与 uninstall 相同恢复；置 `destroyed = true`；`await sdk.destroy()`。
- `handleFrameworkError(err)`：`buildVueErrorDraft(err)` 成功时经 `sdk.control.processEvent` →（`sampledOut` 则返回）→ `sdk.core.submitEventDraft` → 成功且 `event` 存在时 `sdk.delivery.enqueue(event)` + `void sdk.delivery.flush()`；全程 try/catch，任何内部失败静默丢弃（宿主安全）。
- `recordRouteChange(to)`：`const pathname = typeof to.fullPath === 'string' ? to.fullPath : typeof to.path === 'string' ? to.path : null; if (pathname !== null && pathname !== '') void sdk.control.recordActivity({ kind: 'route_change', occurredAt: Date.now(), pathname });`。
- `isVueRouterLike(value)`：`typeof value === 'object' && value !== null && typeof (value as { afterEach?: unknown }).afterEach === 'function'` 的类型守卫。

`index.ts` 最终导出：
```ts
export { createVueAuroraPlugin, isVueRouterLike } from './vue-plugin.js';
export type { VueAuroraOptions, VueAuroraPlugin, VueRouterLike, VueRouteLocationLike } from './vue-plugin.js';
```
不再导出 `buildVueErrorDraft`（私有转换函数不公开）。

- [ ] **Step 4: 写并跑宿主安全测试**

`host-safety.test.ts`：
- 原 handler 先被调用且收到相同 `(err, instance, info)` 参数；宿主可 `preventDefault`-like 语义不受影响（errorHandler 返回值不改变——只验证原 handler 被调用）；
- 宿主在 install 后新设了 errorHandler，`uninstall` 不覆盖它（原保存的 handler 也不恢复，避免踩掉宿主新 handler）；
- Vue 组件内 throw 后页面脚本继续（内部失败隔离：给一个让 `parseErrorEventBody` 必然失败的草稿，确认不抛、后续正常事件仍提交）；
- 不保存原生 Error 引用（提交正文不等于原 err 对象）。
Run: `pnpm --filter @aurora/plugin-vue test -- test/host-safety.test.ts` Expected: PASS。

- [ ] **Step 5: 记录提交边界（本叶子结束时统一提交）**

---

### Task 3: 多实例隔离 + 包入口/文档 + Chromium smoke + 精简门禁

**Files:**
- Create: `packages/plugin-vue/test/multi-instance.test.ts`、`packages/plugin-vue/test/package-entry.test.ts`、`packages/plugin-vue/README.md`、`packages/plugin-vue/playwright.config.ts`、`packages/plugin-vue/test-browser/fixture-server.ts`、`packages/plugin-vue/test-browser/vue-adapter.spec.ts`
- Modify: `packages/plugin-vue/test/architecture-boundary.test.ts`（完整断言）、根 `package.json`（`format:check` 与 `lint` 的显式文件清单追加新包路径）、`docs/architecture/sdk-architecture.md`、`docs/architecture/formalization-readiness.md`、`docs/README.md`、`AGENTS.md`/`AURORA_RULES.md`（SDK-17 状态与计数，本叶子验收后同步）、ADR-003（追加实施证据，保持 in-progress）
- Test: 全包 targeted gates

**Interfaces:**
- Consumes: Task 1/2 公共面；`@aurora/browser` dist、`@aurora/core` dist、`@aurora/event-schema` dist、`vue` ESM（fixture）。
- Produces: 可验收的 `@aurora/plugin-vue` 包。

- [ ] **Step 1: 写并跑多实例测试**

`multi-instance.test.ts`：两个 `createVueAuroraPlugin` 实例各 install 各自 app，一实例 uninstall/destroy 不影响另一实例的 errorHandler 包装与提交；无模块级可变状态（两实例诊断/状态互不共享）。
Run: `pnpm --filter @aurora/plugin-vue test -- test/multi-instance.test.ts` Expected: PASS。

- [ ] **Step 2: 写并跑包入口测试**

`package-entry.test.ts` 对齐 `packages/plugin-performance/test/package-entry.test.ts`：构建后 `import('@aurora/plugin-vue')` 只输出 `createVueAuroraPlugin,isVueRouterLike`（运行时值排序）；私有路径（`src/index.js`、`internal/*`、`vue-error-bridge`、`vue-plugin`）返回 `ERR_PACKAGE_PATH_NOT_EXPORTED`。
Run: `pnpm --filter @aurora/plugin-vue test:package` Expected: PASS。

- [ ] **Step 3: 更新根 lint/format 清单**

根 `package.json` 的 `format:check` 与 `lint` 文件列表追加 `packages/plugin-vue/package.json`、`tsconfig.json`、`tsconfig.build.json`、`vitest.config.ts`、`playwright.config.ts`、`packages/plugin-vue/README.md`、`"packages/plugin-vue/src/**/*.ts"`、`"packages/plugin-vue/test/**/*.ts"`、`"packages/plugin-vue/test-browser/**/*.ts"`。Run: `pnpm lint -- packages/plugin-vue` 与 `pnpm format:check` 局部校验。

- [ ] **Step 4: 实现 Chromium smoke**

`playwright.config.ts`：对齐 `packages/plugin-performance/playwright.config.ts`（chromium only、testDir `./test-browser`）。
`fixture-server.ts`：服务 `packages/plugin-vue/dist`、`packages/browser/dist`、`packages/core/dist`、`packages/event-schema/dist` 与 `node_modules/vue/dist/vue.esm-browser.prod.js`；页面 importmap 映射 `@aurora/plugin-vue`/`@aurora/browser`/`@aurora/core`/`@aurora/event-schema`/`vue`。
`vue-adapter.spec.ts` 一个场景：加载真实 Vue app → `createApp({ template: '<button id="go">Go</button>' })` + `app.use(createVueAuroraPlugin({ config: { clientKey: 'browser-key' }, transport: stubTransport }))` → `app.mount('#app')` → 触发 `app.config.errorHandler` 记录的框架错误场景（组件内 throw 或直接调用宿主 errorHandler）→ 断言 Aurora 通过 `sdk.control.processEvent` 收到 `category:'javascript'` 事件、宿主页面按钮仍可点击、`uninstall` 后原 handler 恢复。
Run: `pnpm --filter @aurora/plugin-vue test:browser` Expected: 1 Chromium 场景 PASS。

- [ ] **Step 5: 完整精简门禁**

Run（按顺序）：
1. `pnpm --filter @aurora/plugin-vue test`（全部单测 + jsdom）
2. `pnpm --filter @aurora/plugin-vue test:coverage`（85/80/85/85）
3. `pnpm --filter @aurora/plugin-vue typecheck`
4. `pnpm --filter @aurora/plugin-vue test:package`
5. `pnpm --filter @aurora/plugin-vue test:browser`（Chromium smoke ×1）
6. `pnpm check:boundaries`（`sdk-framework` 层生效）
7. `git diff --check`
Expected: 全部通过；记录 coverage 真实数字。

- [ ] **Step 6: 写 README 与文档同步**

`packages/plugin-vue/README.md`：职责/非职责、安装组合（`app.use(createVueAuroraPlugin({ config }))`）、公开 API、生命周期、错误桥、可选 router、隐私与排除范围、peer `vue` 版本、单框架适配 ≤5 KiB 标注 `requires-benchmark`。
同步 `docs/architecture/sdk-architecture.md`（框架适配层真实存在）、`formalization-readiness.md`（`framework-integrations.md` → 本规格与 react 规格）、`docs/README.md`。ADR-003 追加 Vue 适配实施证据，状态保持 `accepted / in-progress`。

- [ ] **Step 7: 记录提交边界（本叶子验收后统一提交）**

---

## Self-Review（SDK-17）

- **Vue 版本**：peer `vue` ^3.4.0、dev 3.5.41——与 G07_APPROVAL_PACKAGE 一致。
- **公共 API**：`createVueAuroraPlugin(input)`/`install(app, options?)`/`uninstall(app)`/`sdk`/`destroy()`——与批准接口逐字段一致；无额外运行时导出。
- **依赖方向**：`sdk-framework → sdk-core | sdk-browser | protocol`；只依赖根出口。
- **不复制 Core/Browser/Plugin**：错误桥只做 Vue err → 标准正文转换（复用 event-schema 公共解析器）；不订阅 window 错误（plugin-error 职责）；不建队列/传输（复用 handle.delivery）。
- **不绕过 G06 管道**：`control.processEvent → core.submitEventDraft → delivery.enqueue → flush`，与 composition wrapPlugin 路径一致。
- **错误 handler 恢复**：原 handler 先被调用；uninstall 只恢复仍属于本实例的 wrapper（WeakMap 记录），不踩宿主新 handler。
- **重复初始化**：同一实例对同一 app 二次 install no-op；destroyed 后 install no-op。
- **destroy**：恢复全部已登记 app、移除路由钩子、`await sdk.destroy()`、幂等。
- **多实例**：全部状态存于实例，无模块级可变状态；workspace-policy 强制。
- **隐私**：不采集 `instance`/`info`/组件状态；不保存原生 Error 引用；route_change 只记 pathname。
- **包出口**：`sideEffects:false`，构建只暴露批准符号，私有路径拒绝。
- **测试不过量**：5 个单测文件 + 1 条 Chromium smoke；不引入 Firefox/WebKit。
- **无 Vue 外范围**：不涉及 React（SDK-18 单独计划）。
- **无 TODO/TBD**：全部步骤含真实代码与命令。
