# Browser Error Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 扩展 `@aurora/browser`，提供 JavaScript 运行时错误、未处理 Promise 拒绝和资源加载错误的安全订阅、最小只读视图、完整释放、异常隔离和 Chromium 证据，不实现错误协议转换或 Core 插件。

**Architecture:** 在现有 `BrowserEnvironment` 中增加一个实例级错误源管理器。管理器只在调用 `subscribeErrorSources()` 时以 `addEventListener` 注册捕获阶段 `error` 和普通 `unhandledrejection`，把原生输入同步投影为冻结的 Browser 事实视图，复用现有订阅结果、URL 脱敏和有界诊断，并在取消或销毁时精确移除自己的监听器。它没有 Aurora 本地运行时依赖，不接触 Core、event-schema、网络、队列或持久化。

**Tech Stack:** Node.js `24.18.0`、pnpm `11.17.0`、TypeScript `6.0.3` strict/ESM、ESLint `10.8.0`、Vitest `4.1.10`、`@vitest/coverage-v8` `4.1.10`、Playwright `@playwright/test` `1.62.0`、Chromium、现有 `@aurora/workspace-policy`。

## Global Constraints

- 只实施 `packages/browser` 的“浏览器错误源订阅能力第一增量”；不创建 `packages/plugin-error`。
- 不修改 `packages/core`、`packages/event-schema` 的实现或公共 API，不从它们导入任何值或类型。
- `@aurora/browser` 保持零 Aurora 本地运行时依赖、`private: true`、单一根出口和 `sideEffects: false`；不修改 `pnpm-lock.yaml`。
- 只从捕获的 `windowTarget` 注册 `error` 和 `unhandledrejection`；`error` 注册/移除使用捕获参数 `true`，`unhandledrejection` 使用 `false`。
- 不覆盖 `window.onerror`、`window.onunhandledrejection`，不调用 `preventDefault()`、`stopPropagation()`、`stopImmediatePropagation()`，不修改事件、Error、Promise reason、DOM 或原型。
- 不替换或包装 `fetch`、XHR、History，不读取 Cookie、Storage、表单、完整 DOM、页面文本、用户输入、请求/响应体、指纹或 IP。
- 原生事件和 DOM 节点不进入公共视图；`error` 与 `reason` 只在同步回调期间作为 `unknown` 传递，Browser 不遍历、不复制、不序列化、不保留。
- URL 只通过现有 `sanitizePageUrl()` 返回 HTTP(S) `origin + pathname`；禁止保留查询、片段和凭据。
- 不生成协议正文、事件信封、ID 或时间，不复制 Promise 有界深复制、资源类型映射或 event-schema 限制。
- 所有 mutable 状态位于 `createBrowserEnvironment()` 或其管理器工厂内部；不得创建全局可变单例。
- 所有公共函数显式声明参数与返回类型；浏览器输入为 `unknown` 并立即收窄；禁止无说明 `any`、`Object`、`Function`、`Record<string, any>`、双重断言、非空断言和错误抑制。
- 文件名 `kebab-case`，类型/接口 `PascalCase`，函数/变量 `camelCase`，布尔名使用 `is`/`has`/`can`/`should` 前缀；不创建 `utils`、`helpers`、`common` 或 `misc`。
- 不在生产路径使用 `console`；异常用现有稳定、最多 100 条的脱敏诊断表达。
- 单元覆盖率门槛为 lines 85%、branches 80%、functions 85%、statements 85%；Chromium 不能由模拟 DOM 代替。
- 现有单插件 gzip 增量预算为 8 KiB；Browser 增量记录可重复 gzip 数值但标记 `requires-benchmark`，不得把未打包的 TSC 输出冒充最终 tree-shaking 证据。
- ADR-003/005/006 保持 `accepted / in-progress`，ADR-007 保持 `accepted / implemented`；本计划不创建 ADR，不因规划或实施计划存在而改变状态。
- 实施前重新运行 `git status --short --branch`、`git diff --cached --stat` 和 `git status --porcelain=v1 --untracked-files=all`；保护全部已有修改。未经独立授权不运行 Git 暂存、提交、推送、重置、清理或变基命令。

---

## Authoritative Inputs

Task 1 前完整读取：`CLAUDE.md`、`AGENTS.md`、`AURORA_RULES.md`、核心业务 PRD、六份 Aurora 长期规范、`docs/architecture/system-overview.md`、`docs/architecture/sdk-architecture.md`、`docs/architecture/monorepo-and-build.md`、`docs/protocol/event-schema-foundation.md`、`docs/protocol/error-event-contract.md`、`docs/sdk/sdk-core-foundation.md`、`docs/sdk/browser-environment-foundation.md`、`docs/sdk/browser-error-source.md`、`docs/testing/test-strategy.md`、`docs/architecture/formalization-readiness.md`、ADR-003/005/006/007、现有全部实施计划，以及当前 `packages/event-schema`、`packages/core`、`packages/browser`、`tooling/workspace-policy` 的源文件、测试、配置和公共出口。只有 approved 文档、accepted ADR 和真实公共接口是正式依据。

## Final Public API

完成 Task 3 后，`@aurora/browser` 根入口在保留全部现有导出的基础上增加：

```ts
export const BrowserErrorSourceEventType = Object.freeze({
  JavaScript: 'javascript_error',
  UnhandledRejection: 'unhandled_rejection',
  Resource: 'resource_error',
} as const);
export type BrowserErrorSourceEventType =
  (typeof BrowserErrorSourceEventType)[keyof typeof BrowserErrorSourceEventType];

export interface BrowserJavaScriptErrorSourceEvent {
  readonly type: typeof BrowserErrorSourceEventType.JavaScript;
  readonly message: string | null;
  readonly sourceUrl: string | null;
  readonly error: unknown;
}
export interface BrowserUnhandledRejectionSourceEvent {
  readonly type: typeof BrowserErrorSourceEventType.UnhandledRejection;
  readonly reason: unknown;
}
export interface BrowserResourceErrorSourceEvent {
  readonly type: typeof BrowserErrorSourceEventType.Resource;
  readonly tagName: string | null;
  readonly sourceUrl: string | null;
  readonly rel: string | null;
  readonly as: string | null;
}
export type BrowserErrorSourceEvent =
  | BrowserJavaScriptErrorSourceEvent
  | BrowserUnhandledRejectionSourceEvent
  | BrowserResourceErrorSourceEvent;
export type BrowserErrorSourceListener = (event: BrowserErrorSourceEvent) => void;

export interface BrowserCapabilities {
  readonly isBrowserEnvironment: boolean;
  readonly hasWindow: boolean;
  readonly hasDocument: boolean;
  readonly hasNavigator: boolean;
  readonly hasPerformance: boolean;
  readonly canReadPageUrl: boolean;
  readonly canReadUserAgent: boolean;
  readonly canReadVisibility: boolean;
  readonly canObservePageLifecycle: boolean;
  readonly canObserveErrorSources: boolean;
}

export interface BrowserEnvironment {
  getCapabilities(): BrowserCapabilities;
  readPageSnapshot(): BrowserPageSnapshot;
  subscribePageLifecycle(listener: BrowserLifecycleListener): BrowserSubscribeResult;
  subscribeErrorSources(listener: BrowserErrorSourceListener): BrowserSubscribeResult;
  destroy(): BrowserDestroyResult;
  getDiagnostics(): readonly BrowserDiagnostic[];
}
```

`BrowserCapabilityName` 增加 `ErrorSource: 'error_source'`。`BrowserDiagnostic.eventType` 和内部 `BrowserDiagnosticInput.eventType` 扩为 `PageLifecycleEventType | BrowserErrorSourceEventType`。不得新增另一套 subscribe/unsubscribe/destroy 结果类型。

## Complete File Tree and Single Responsibilities

```text
packages/browser/
├── package.json                              # 保持 sideEffects:false、命令与零运行时依赖
├── README.md                                 # 错误源职责、隐私、释放、命令与排除范围
├── src/
│   ├── browser-environment.ts                # 组合生命周期与错误源管理器并统一销毁
│   ├── capabilities.ts                       # error_source 能力与 canObserveErrorSources
│   ├── diagnostics.ts                        # 诊断 eventType 的加法联合
│   ├── error-source.ts                       # 错误源视图、注册、通知、取消和销毁
│   └── index.ts                              # 唯一根出口
├── test/
│   ├── capabilities.test.ts                  # 错误源能力正常/缺失/getter 抛错
│   ├── error-source-contract.test.ts         # 公共常量、类型与根出口
│   ├── error-source-view.test.ts             # 三类投影、脱敏和不保留原生引用
│   ├── error-source.test.ts                  # 注册回滚、取消、销毁、失败隔离
│   ├── host-safety.test.ts                   # handler/API/事件身份和防递归
│   ├── multi-instance.test.ts                # 实例释放隔离
│   ├── import-safety.test.ts                 # 导入无副作用
│   ├── package-entry.test.ts                 # 新根运行时出口和私有路径拒绝
│   └── documentation-contract.test.ts        # README/规格/ADR 实施证据
└── test-browser/
    ├── browser-environment.spec.ts            # Chromium 三源、宿主安全、释放、多实例
    └── fixture-server.ts                      # 真实错误触发与缺失资源夹具
tooling/workspace-policy/
├── src/environment.ts                        # 禁止 Browser 控制事件默认行为/传播
├── src/types.ts                              # 新稳定违规代码
└── test/environment.test.ts                  # preventDefault/传播控制负例
package.json                                  # 纳入新规格的格式门禁，保持根命令名称
README.md                                     # 真实 Browser 能力清单
AGENTS.md / AURORA_RULES.md                   # verified 实施状态与决策队列
docs/README.md                                # 正式规格和实施证据索引
docs/architecture/system-overview.md          # Browser 真实能力边界
docs/architecture/sdk-architecture.md         # 分层与插件仍 absent
docs/architecture/monorepo-and-build.md       # 包出口/门禁事实
docs/architecture/formalization-readiness.md  # Browser 增量状态和 plugin-error 阻塞
docs/testing/test-strategy.md                  # 单元/Chromium/体积门禁
docs/sdk/browser-error-source.md               # 本规格；完成后仅改实施状态和证据
docs/adr/ADR-003-sdk-plugin-architecture.md   # 追加实施证据，状态不升级
docs/adr/ADR-006-one-way-dependencies.md      # 追加实施证据，状态不升级
```

---

### Task 1: 冻结错误源公共契约与能力探测

**Files:**

- Create: `packages/browser/src/error-source.ts`
- Create: `packages/browser/test/error-source-contract.test.ts`
- Modify: `packages/browser/src/capabilities.ts`
- Modify: `packages/browser/src/diagnostics.ts`
- Modify: `packages/browser/src/index.ts`
- Modify: `packages/browser/test/capabilities.test.ts`

**Consumes:** 现有 `BrowserCapabilities`、`BrowserCapabilityName`、`BrowserDiagnostic`、根出口和 `readMethod()`。

**Produces:** `BrowserErrorSourceEventType`、三类只读视图、联合类型、Listener 类型、`ErrorSource` 能力名、`canObserveErrorSources` 和诊断联合。

- [ ] **Step 1: 写失败的公共契约测试**

Create `packages/browser/test/error-source-contract.test.ts`:

```ts
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  BrowserErrorSourceEventType,
  type BrowserErrorSourceEvent,
  type BrowserErrorSourceListener,
} from '../src/index.js';

describe('Browser error source public contract', () => {
  it('exposes exactly three source event types', () => {
    expect(BrowserErrorSourceEventType).toEqual({
      JavaScript: 'javascript_error',
      UnhandledRejection: 'unhandled_rejection',
      Resource: 'resource_error',
    });
    expect(Object.isFrozen(BrowserErrorSourceEventType)).toBe(true);
  });

  it('exposes one exact discriminated listener input', () => {
    expectTypeOf<BrowserErrorSourceListener>()
      .parameter(0)
      .toEqualTypeOf<BrowserErrorSourceEvent>();
  });
});
```

Append to `capabilities.test.ts` normal and missing expectations:

```ts
expect(capabilities.canObserveErrorSources).toBe(false);
// in the usable-window case
expect(capabilities.canObserveErrorSources).toBe(true);
expect(capabilities).toHaveProperty('canObserveErrorSources');
```

- [ ] **Step 2: 确认预期失败**

Run:

```powershell
pnpm --filter @aurora/browser exec vitest run test/error-source-contract.test.ts test/capabilities.test.ts
```

Expected: exit `1`；根入口缺少 `BrowserErrorSourceEventType` 和 Listener 类型，能力对象缺少 `canObserveErrorSources`。不得修改旧断言制造其他失败。

- [ ] **Step 3: 写最小公共类型与能力实现**

Create the public type section of `src/error-source.ts` exactly as follows; Task 2 appends private view construction and Task 3 appends the manager:

```ts
export const BrowserErrorSourceEventType = Object.freeze({
  JavaScript: 'javascript_error',
  UnhandledRejection: 'unhandled_rejection',
  Resource: 'resource_error',
} as const);
export type BrowserErrorSourceEventType =
  (typeof BrowserErrorSourceEventType)[keyof typeof BrowserErrorSourceEventType];

export interface BrowserJavaScriptErrorSourceEvent {
  readonly type: typeof BrowserErrorSourceEventType.JavaScript;
  readonly message: string | null;
  readonly sourceUrl: string | null;
  readonly error: unknown;
}
export interface BrowserUnhandledRejectionSourceEvent {
  readonly type: typeof BrowserErrorSourceEventType.UnhandledRejection;
  readonly reason: unknown;
}
export interface BrowserResourceErrorSourceEvent {
  readonly type: typeof BrowserErrorSourceEventType.Resource;
  readonly tagName: string | null;
  readonly sourceUrl: string | null;
  readonly rel: string | null;
  readonly as: string | null;
}
export type BrowserErrorSourceEvent =
  | BrowserJavaScriptErrorSourceEvent
  | BrowserUnhandledRejectionSourceEvent
  | BrowserResourceErrorSourceEvent;
export type BrowserErrorSourceListener = (event: BrowserErrorSourceEvent) => void;
```

In `capabilities.ts`, add the constant/field and compute it from the already captured `windowTarget`:

```ts
// BrowserCapabilityName
ErrorSource: 'error_source',

// BrowserCapabilities
readonly canObserveErrorSources: boolean;

// detectBrowserCapabilities return object
canObserveErrorSources: hasListenerPair(
  host.windowTarget,
  diagnostics,
  BrowserCapabilityName.ErrorSource,
),
```

Change `hasListenerPair` to accept its capability explicitly and pass `PageLifecycle` at the existing two call sites:

```ts
function hasListenerPair(
  target: unknown,
  diagnostics: BrowserDiagnosticStore,
  capability: typeof BrowserCapabilityName.PageLifecycle | typeof BrowserCapabilityName.ErrorSource,
): boolean;
```

In `diagnostics.ts`, use the additive union:

```ts
import type { BrowserErrorSourceEventType } from './error-source.js';
import type { PageLifecycleEventType } from './page-lifecycle.js';

export type BrowserDiagnosticEventType = PageLifecycleEventType | BrowserErrorSourceEventType;
```

Set both public and input `eventType?: BrowserDiagnosticEventType`. Export the error-source constants/types from `src/index.ts`. Task 1 does not add `BrowserEnvironment.subscribeErrorSources`; Task 3 adds that method together with its first real implementation so no inert public behavior exists between tasks.

- [ ] **Step 4: 确认通过并运行回归**

Run:

```powershell
pnpm --filter @aurora/browser exec vitest run test/error-source-contract.test.ts test/capabilities.test.ts test/import-safety.test.ts
pnpm --filter @aurora/browser typecheck
pnpm --filter @aurora/browser test
pnpm check:boundaries
```

Expected: all exit `0`；旧能力字段仍存在，Node 导入安全，边界无输出。

- [ ] **Step 5: 记录建议提交边界**

建议提交信息：`feat(browser): define error source contract`。只有执行会话另获 Git 授权时才提交 Task 1 文件。

---

### Task 2: 三类原生输入的最小只读视图与 URL 隐私

**Files:**

- Create: `packages/browser/test/error-source-view.test.ts`
- Modify: `packages/browser/src/error-source.ts`

**Consumes:** `BrowserHostContext`、`BrowserDiagnosticStore`、`readProperty()`、`sanitizePageUrl()` 和 Task 1 事件类型。

**Produces:** 包私有 `createErrorSourceEvent(nativeType, nativeEvent, host, diagnostics)`，不暴露原生事件或 DOM。

- [ ] **Step 1: 写失败的视图测试**

Create `test/error-source-view.test.ts` with a local host/diagnostic fixture and these executable cases:

```ts
import { describe, expect, it } from 'vitest';
import type { BrowserHostContext } from '../src/capabilities.js';
import { createDiagnosticStore } from '../src/diagnostics.js';
import { createErrorSourceEvent } from '../src/error-source.js';

const windowTarget = Object.freeze({ name: 'window' });
const host: BrowserHostContext = Object.freeze({
  windowTarget,
  documentTarget: undefined,
  navigatorTarget: undefined,
  performanceTarget: undefined,
});

describe('Browser error source views', () => {
  it('projects JavaScript facts and strips URL secrets', () => {
    const nativeError = new Error('synthetic');
    const nativeEvent = {
      target: windowTarget,
      message: 'Synthetic failure',
      filename: 'https://user:pass@example.test/app.js?token=secret#frame',
      error: nativeError,
    };
    const event = createErrorSourceEvent('error', nativeEvent, host, createDiagnosticStore());
    expect(event).toEqual({
      type: 'javascript_error',
      message: 'Synthetic failure',
      sourceUrl: 'https://example.test/app.js',
      error: nativeError,
    });
    expect(event).not.toHaveProperty('target');
    expect(Object.isFrozen(event)).toBe(true);
  });

  it('passes a rejection reason without walking or copying it', () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    const event = createErrorSourceEvent(
      'unhandledrejection',
      { reason: cyclic },
      host,
      createDiagnosticStore(),
    );
    expect(event).toEqual({ type: 'unhandled_rejection', reason: cyclic });
    expect(event).not.toHaveProperty('promise');
  });

  it.each([
    new Error('Synthetic rejection'),
    'Synthetic rejection',
    { code: 7, tags: ['synthetic'] },
  ])('preserves the exact rejection reason identity %#', (reason) => {
    const event = createErrorSourceEvent(
      'unhandledrejection',
      { reason },
      host,
      createDiagnosticStore(),
    );
    expect(event).toMatchObject({ type: 'unhandled_rejection' });
    if (event.type !== 'unhandled_rejection') throw new Error('unexpected source type');
    expect(event.reason).toBe(reason);
  });

  it('does not invent a missing JavaScript Error object', () => {
    expect(
      createErrorSourceEvent(
        'error',
        { target: windowTarget, message: 'Script error.', filename: '' },
        host,
        createDiagnosticStore(),
      ),
    ).toEqual({
      type: 'javascript_error',
      message: 'Script error.',
      sourceUrl: null,
      error: undefined,
    });
  });

  it('copies resource facts without retaining the DOM-like target', () => {
    const target = {
      tagName: 'LINK',
      currentSrc: '',
      src: '',
      href: 'https://static.example.test/app.css?key=secret#x',
      rel: 'STYLESHEET',
      as: '',
    };
    const event = createErrorSourceEvent('error', { target }, host, createDiagnosticStore());
    expect(event).toEqual({
      type: 'resource_error',
      tagName: 'link',
      sourceUrl: 'https://static.example.test/app.css',
      rel: 'stylesheet',
      as: null,
    });
    expect(Object.values(event)).not.toContain(target);
  });

  it('keeps an unknown resource tag as a raw Browser fact', () => {
    const event = createErrorSourceEvent(
      'error',
      {
        target: {
          tagName: 'VIDEO',
          currentSrc: 'https://static.example.test/movie.mp4?token=secret#track',
        },
      },
      host,
      createDiagnosticStore(),
    );
    expect(event).toEqual({
      type: 'resource_error',
      tagName: 'video',
      sourceUrl: 'https://static.example.test/movie.mp4',
      rel: null,
      as: null,
    });
  });

  it('contains throwing getters and does not leak their text', () => {
    const nativeEvent = Object.defineProperty({ target: windowTarget }, 'message', {
      get(): never {
        throw new Error('authorization=secret');
      },
    });
    const diagnostics = createDiagnosticStore();
    expect(() => createErrorSourceEvent('error', nativeEvent, host, diagnostics)).not.toThrow();
    expect(createErrorSourceEvent('error', nativeEvent, host, diagnostics)).toMatchObject({
      type: 'javascript_error',
      message: null,
    });
    expect(JSON.stringify(diagnostics.getDiagnostics())).not.toContain('secret');
  });
});
```

- [ ] **Step 2: 确认预期失败**

Run:

```powershell
pnpm --filter @aurora/browser exec vitest run test/error-source-view.test.ts
```

Expected: exit `1` because `createErrorSourceEvent` does not exist。

- [ ] **Step 3: 写最小视图实现**

Append these private helpers and the test-visible internal function to `src/error-source.ts`; do not export it from the package root:

```ts
import { BrowserCapabilityName, type BrowserHostContext } from './capabilities.js';
import {
  BrowserDiagnosticCode,
  BrowserDiagnosticOperation,
  type BrowserDiagnosticStore,
} from './diagnostics.js';
import { readProperty, sanitizePageUrl } from './safe-access.js';

type NativeErrorSourceType = 'error' | 'unhandledrejection';

function readValue(
  target: unknown,
  key: PropertyKey,
  eventType: BrowserErrorSourceEventType,
  diagnostics: BrowserDiagnosticStore,
): unknown {
  const result = readProperty(target, key);
  if (!result.ok && result.reason === 'threw')
    diagnostics.append({
      code: BrowserDiagnosticCode.PropertyReadFailed,
      operation: BrowserDiagnosticOperation.Notify,
      capability: BrowserCapabilityName.ErrorSource,
      eventType,
    });
  return result.ok ? result.value : undefined;
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function lowerString(value: unknown): string | null {
  const text = optionalString(value);
  return text === null ? null : text.toLowerCase();
}

function readSourceUrl(
  target: unknown,
  keys: readonly PropertyKey[],
  eventType: BrowserErrorSourceEventType,
  diagnostics: BrowserDiagnosticStore,
): string | null {
  for (const key of keys) {
    const sanitized = sanitizePageUrl(readValue(target, key, eventType, diagnostics));
    if (sanitized !== null) return sanitized;
  }
  return null;
}

function isResourceTarget(
  target: unknown,
  host: BrowserHostContext,
  diagnostics: BrowserDiagnosticStore,
): boolean {
  if (target === undefined || target === null || target === host.windowTarget) return false;
  const tagName = readValue(target, 'tagName', BrowserErrorSourceEventType.Resource, diagnostics);
  return typeof tagName === 'string' && tagName.length > 0;
}

export function createErrorSourceEvent(
  nativeType: NativeErrorSourceType,
  nativeEvent: unknown,
  host: BrowserHostContext,
  diagnostics: BrowserDiagnosticStore,
): BrowserErrorSourceEvent {
  if (nativeType === 'unhandledrejection')
    return Object.freeze({
      type: BrowserErrorSourceEventType.UnhandledRejection,
      reason: readValue(
        nativeEvent,
        'reason',
        BrowserErrorSourceEventType.UnhandledRejection,
        diagnostics,
      ),
    });

  const target = readValue(
    nativeEvent,
    'target',
    BrowserErrorSourceEventType.JavaScript,
    diagnostics,
  );
  if (isResourceTarget(target, host, diagnostics)) {
    const eventType = BrowserErrorSourceEventType.Resource;
    return Object.freeze({
      type: eventType,
      tagName: lowerString(readValue(target, 'tagName', eventType, diagnostics)),
      sourceUrl: readSourceUrl(target, ['currentSrc', 'src', 'href'], eventType, diagnostics),
      rel: lowerString(readValue(target, 'rel', eventType, diagnostics)),
      as: lowerString(readValue(target, 'as', eventType, diagnostics)),
    });
  }
  const eventType = BrowserErrorSourceEventType.JavaScript;
  return Object.freeze({
    type: eventType,
    message: optionalString(readValue(nativeEvent, 'message', eventType, diagnostics)),
    sourceUrl: sanitizePageUrl(readValue(nativeEvent, 'filename', eventType, diagnostics)),
    error: readValue(nativeEvent, 'error', eventType, diagnostics),
  });
}
```

The internal named export exists only for source-level tests; `package.json` still exposes only `src/index.ts`, and `src/index.ts` must not re-export `createErrorSourceEvent`.

- [ ] **Step 4: 确认通过并运行隐私回归**

Run:

```powershell
pnpm --filter @aurora/browser exec vitest run test/error-source-view.test.ts test/page-snapshot.test.ts
pnpm --filter @aurora/browser typecheck
pnpm --filter @aurora/browser test
```

Expected: all exit `0`；查询、片段和凭据不出现在视图或诊断；循环 reason 未被遍历；旧页面 URL 规则不变。

- [ ] **Step 5: 记录建议提交边界**

建议提交信息：`feat(browser): project privacy-safe error source views`。只有执行会话另获 Git 授权时才提交 Task 2 文件。

---

### Task 3: 原子注册、幂等取消与统一销毁

**Files:**

- Create: `packages/browser/test/error-source.test.ts`
- Modify: `packages/browser/src/error-source.ts`
- Modify: `packages/browser/src/browser-environment.ts`

**Consumes:** Task 2 视图、现有 `BrowserSubscribeResult`/`BrowserSubscription`/`BrowserDestroyResult`、`readMethod()`、`callMethod()` 和实例诊断。

**Produces:** `createErrorSourceManager()`、真实 `subscribeErrorSources()`、两个监听器的部分失败回滚、逻辑停用、幂等取消和统一销毁。

- [ ] **Step 1: 写失败的资源管理测试**

Create `test/error-source.test.ts` with a fake target that records the capture flag:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrowserEnvironment } from '../src/index.js';

interface Registration {
  readonly type: string;
  readonly listener: (event: unknown) => void;
  readonly capture: boolean;
}
function createTarget(
  options: { readonly throwOnAdd?: string; readonly shouldThrowOnRemove?: boolean } = {},
) {
  const registrations: Registration[] = [];
  return {
    registrations,
    addEventListener(type: string, listener: (event: unknown) => void, capture = false): void {
      if (type === options.throwOnAdd) throw new Error('token=registration-secret');
      registrations.push({ type, listener, capture });
    },
    removeEventListener(type: string, listener: (event: unknown) => void, capture = false): void {
      if (options.shouldThrowOnRemove === true) throw new Error('token=removal-secret');
      const index = registrations.findIndex(
        (item) => item.type === type && item.listener === listener && item.capture === capture,
      );
      if (index >= 0) registrations.splice(index, 1);
    },
    dispatch(type: string, event: unknown): void {
      for (const item of [...registrations]) if (item.type === type) item.listener(event);
    },
  };
}
afterEach(() => vi.unstubAllGlobals());

describe('Browser error source subscription', () => {
  it('registers exact listeners and cancels idempotently', () => {
    const target = createTarget();
    vi.stubGlobal('window', { ...target, location: { href: 'https://example.test/' } });
    vi.stubGlobal('document', {});
    const browser = createBrowserEnvironment();
    const events: unknown[] = [];
    const result = browser.subscribeErrorSources((event) => events.push(event));
    expect(result).toMatchObject({ ok: true, code: 'subscribed', diagnosticsAdded: 0 });
    expect(target.registrations.map(({ type, capture }) => ({ type, capture }))).toEqual([
      { type: 'error', capture: true },
      { type: 'unhandledrejection', capture: false },
    ]);
    target.dispatch('error', { target: window, message: 'Synthetic', error: new Error('x') });
    expect(events).toHaveLength(1);
    if (!result.ok) throw new Error('subscription must succeed');
    expect(result.subscription.unsubscribe().code).toBe('unsubscribed');
    expect(result.subscription.unsubscribe().code).toBe('already_unsubscribed');
    expect(target.registrations).toEqual([]);
  });

  it('rolls back error when unhandledrejection registration fails', () => {
    const target = createTarget({ throwOnAdd: 'unhandledrejection' });
    vi.stubGlobal('window', { ...target, location: { href: 'https://example.test/' } });
    vi.stubGlobal('document', {});
    const browser = createBrowserEnvironment();
    expect(browser.subscribeErrorSources(() => undefined)).toMatchObject({
      ok: false,
      code: 'listener_registration_failed',
    });
    expect(target.registrations).toEqual([]);
    expect(JSON.stringify(browser.getDiagnostics())).not.toContain('secret');
  });

  it('logically disables a subscription when physical removal throws', () => {
    const target = createTarget({ shouldThrowOnRemove: true });
    vi.stubGlobal('window', { ...target, location: { href: 'https://example.test/' } });
    vi.stubGlobal('document', {});
    const browser = createBrowserEnvironment();
    let calls = 0;
    const result = browser.subscribeErrorSources(() => {
      calls += 1;
    });
    if (!result.ok) throw new Error('subscription must succeed');
    expect(result.subscription.unsubscribe()).toMatchObject({
      ok: true,
      code: 'unsubscribed',
      diagnosticsAdded: 2,
    });
    target.dispatch('error', { target: window, message: 'Synthetic' });
    expect(calls).toBe(0);
    expect(JSON.stringify(browser.getDiagnostics())).not.toContain('removal-secret');
  });

  it('returns stable failures for invalid listeners and missing window methods', () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('document', {});
    const browser = createBrowserEnvironment();
    // null is intentional untrusted runtime input; production code uses no assertion.
    expect(browser.subscribeErrorSources(null as never)).toEqual({
      ok: false,
      code: 'invalid_listener',
      diagnosticsAdded: 0,
    });
    expect(browser.subscribeErrorSources(() => undefined)).toEqual({
      ok: false,
      code: 'environment_unavailable',
      diagnosticsAdded: 0,
    });
  });

  it('destroys all subscriptions, rejects new ones, and never revives', () => {
    const target = createTarget();
    vi.stubGlobal('window', { ...target, location: { href: 'https://example.test/' } });
    vi.stubGlobal('document', {});
    const browser = createBrowserEnvironment();
    browser.subscribeErrorSources(() => undefined);
    expect(browser.destroy().code).toBe('destroyed');
    expect(browser.destroy().code).toBe('already_destroyed');
    expect(browser.subscribeErrorSources(() => undefined)).toEqual({
      ok: false,
      code: 'destroyed',
      diagnosticsAdded: 0,
    });
    expect(target.registrations).toEqual([]);
  });
});
```

- [ ] **Step 2: 确认预期失败**

Run:

```powershell
pnpm --filter @aurora/browser exec vitest run test/error-source.test.ts
```

Expected: exit `1`；`BrowserEnvironment` 尚无 `subscribeErrorSources`，没有监听器、回滚或通知。

- [ ] **Step 3: 写最小错误源管理器**

Append to `src/error-source.ts`:

```ts
import {
  BrowserDestroyCode,
  BrowserSubscribeCode,
  BrowserUnsubscribeCode,
  type BrowserDestroyResult,
  type BrowserSubscribeResult,
  type BrowserSubscription,
  type BrowserUnsubscribeResult,
} from './page-lifecycle.js';
import { callMethod, readMethod, type UnknownCallable } from './safe-access.js';

interface ErrorSourceRegistration {
  readonly type: 'error' | 'unhandledrejection';
  readonly listener: UnknownCallable;
  readonly capture: boolean;
  readonly remove: UnknownCallable;
}
interface ErrorSourceRecord {
  isActive: boolean;
  readonly registrations: ErrorSourceRegistration[];
}
export interface ErrorSourceManager {
  subscribe(listener: BrowserErrorSourceListener): BrowserSubscribeResult;
  destroy(): BrowserDestroyResult;
}

export function createErrorSourceManager(
  host: BrowserHostContext,
  diagnostics: BrowserDiagnosticStore,
): ErrorSourceManager {
  const active = new Set<ErrorSourceRecord>();
  let isDestroyed = false;

  function notify(
    record: ErrorSourceRecord,
    listener: BrowserErrorSourceListener,
    nativeType: 'error' | 'unhandledrejection',
    nativeEvent: unknown,
  ): void {
    if (!record.isActive) return;
    const event = createErrorSourceEvent(nativeType, nativeEvent, host, diagnostics);
    try {
      listener(event);
    } catch {
      diagnostics.append({
        code: BrowserDiagnosticCode.CallbackFailed,
        operation: BrowserDiagnosticOperation.Notify,
        eventType: event.type,
      });
    }
  }

  function removeAll(
    record: ErrorSourceRecord,
    operation:
      typeof BrowserDiagnosticOperation.Unsubscribe | typeof BrowserDiagnosticOperation.Destroy,
  ): number {
    if (!record.isActive) return 0;
    record.isActive = false;
    active.delete(record);
    const before = diagnostics.getTotalCount();
    for (const registration of [...record.registrations].reverse()) {
      const removed = callMethod(registration.remove, host.windowTarget, [
        registration.type,
        registration.listener,
        registration.capture,
      ]);
      if (!removed.ok)
        diagnostics.append({
          code: BrowserDiagnosticCode.ListenerRemovalFailed,
          operation,
          capability: BrowserCapabilityName.ErrorSource,
        });
    }
    return diagnostics.getTotalCount() - before;
  }

  function subscribe(listener: BrowserErrorSourceListener): BrowserSubscribeResult {
    if (typeof listener !== 'function')
      return Object.freeze({
        ok: false,
        code: BrowserSubscribeCode.InvalidListener,
        diagnosticsAdded: 0,
      });
    if (isDestroyed)
      return Object.freeze({
        ok: false,
        code: BrowserSubscribeCode.Destroyed,
        diagnosticsAdded: 0,
      });
    const add = readMethod(host.windowTarget, 'addEventListener');
    const remove = readMethod(host.windowTarget, 'removeEventListener');
    if (!add.ok || !remove.ok) {
      const before = diagnostics.getTotalCount();
      const hasThrown =
        (!add.ok && add.reason === 'threw') || (!remove.ok && remove.reason === 'threw');
      if (hasThrown)
        diagnostics.append({
          code: BrowserDiagnosticCode.ListenerRegistrationFailed,
          operation: BrowserDiagnosticOperation.Subscribe,
          capability: BrowserCapabilityName.ErrorSource,
        });
      return Object.freeze({
        ok: false,
        code: hasThrown
          ? BrowserSubscribeCode.ListenerRegistrationFailed
          : BrowserSubscribeCode.EnvironmentUnavailable,
        diagnosticsAdded: diagnostics.getTotalCount() - before,
      });
    }

    const record: ErrorSourceRecord = { isActive: true, registrations: [] };
    const requests = [
      {
        type: 'error' as const,
        capture: true,
        listener: (event: unknown): void => notify(record, listener, 'error', event),
      },
      {
        type: 'unhandledrejection' as const,
        capture: false,
        listener: (event: unknown): void => notify(record, listener, 'unhandledrejection', event),
      },
    ];
    for (const request of requests) {
      const added = callMethod(add.value, host.windowTarget, [
        request.type,
        request.listener,
        request.capture,
      ]);
      if (!added.ok) {
        const before = diagnostics.getTotalCount();
        diagnostics.append({
          code: BrowserDiagnosticCode.ListenerRegistrationFailed,
          operation: BrowserDiagnosticOperation.Subscribe,
          capability: BrowserCapabilityName.ErrorSource,
        });
        removeAll(record, BrowserDiagnosticOperation.Unsubscribe);
        return Object.freeze({
          ok: false,
          code: BrowserSubscribeCode.ListenerRegistrationFailed,
          diagnosticsAdded: diagnostics.getTotalCount() - before,
        });
      }
      record.registrations.push({ ...request, remove: remove.value });
    }
    active.add(record);
    const subscription: BrowserSubscription = Object.freeze({
      unsubscribe(): BrowserUnsubscribeResult {
        if (!record.isActive)
          return Object.freeze({
            ok: true,
            code: BrowserUnsubscribeCode.AlreadyUnsubscribed,
            diagnosticsAdded: 0,
          });
        return Object.freeze({
          ok: true,
          code: BrowserUnsubscribeCode.Unsubscribed,
          diagnosticsAdded: removeAll(record, BrowserDiagnosticOperation.Unsubscribe),
        });
      },
    });
    return Object.freeze({
      ok: true,
      code: BrowserSubscribeCode.Subscribed,
      subscription,
      diagnosticsAdded: 0,
    });
  }

  function destroy(): BrowserDestroyResult {
    const before = diagnostics.getTotalCount();
    if (isDestroyed)
      return Object.freeze({
        ok: true,
        code: BrowserDestroyCode.AlreadyDestroyed,
        diagnosticsAdded: 0,
      });
    isDestroyed = true;
    for (const record of [...active]) removeAll(record, BrowserDiagnosticOperation.Destroy);
    return Object.freeze({
      ok: true,
      code: BrowserDestroyCode.Destroyed,
      diagnosticsAdded: diagnostics.getTotalCount() - before,
    });
  }
  return Object.freeze({ subscribe, destroy });
}
```

In `browser-environment.ts`, create `errorSources`, forward the new method, and make the environment own the composite destroy state:

```ts
const errorSources = createErrorSourceManager(host, diagnostics);
let isDestroyed = false;

function destroy(): BrowserDestroyResult {
  if (isDestroyed)
    return Object.freeze({
      ok: true,
      code: BrowserDestroyCode.AlreadyDestroyed,
      diagnosticsAdded: 0,
    });
  isDestroyed = true;
  const before = diagnostics.getTotalCount();
  errorSources.destroy();
  lifecycle.destroy();
  return Object.freeze({
    ok: true,
    code: BrowserDestroyCode.Destroyed,
    diagnosticsAdded: diagnostics.getTotalCount() - before,
  });
}
```

The returned object uses `subscribeErrorSources: errorSources.subscribe` and `destroy`. Both managers are destroyed exactly once; existing page lifecycle results remain unchanged.

- [ ] **Step 4: 确认通过并运行生命周期回归**

Run:

```powershell
pnpm --filter @aurora/browser exec vitest run test/error-source.test.ts test/page-lifecycle.test.ts
pnpm --filter @aurora/browser typecheck
pnpm --filter @aurora/browser test
pnpm check:boundaries
```

Expected: all exit `0`；两个监听器参数精确、部分失败回滚、两类订阅均由环境销毁、旧生命周期行为不变。

- [ ] **Step 5: 记录建议提交边界**

建议提交信息：`feat(browser): manage browser error source listeners`。只有执行会话另获 Git 授权时才提交 Task 3 文件。

---

### Task 4: 宿主事件控制门禁、异常隔离与多实例

**Files:**

- Modify: `packages/browser/test/host-safety.test.ts`
- Modify: `packages/browser/test/multi-instance.test.ts`
- Modify: `tooling/workspace-policy/src/types.ts`
- Modify: `tooling/workspace-policy/src/environment.ts`
- Modify: `tooling/workspace-policy/test/environment.test.ts`

**Consumes:** Task 3 资源管理、现有 `forbidden-host-mutation`、Browser AST 扫描和实例诊断。

**Produces:** `forbidden-host-event-control` 自动门禁、回调失败隔离、防递归、原始对象不变和跨实例释放证据。

- [ ] **Step 1: 写失败的策略负例和宿主行为测试**

Append to Workspace Policy `environment.test.ts`:

```ts
it.each([
  'event.preventDefault();',
  'event.stopPropagation();',
  'event.stopImmediatePropagation();',
])('rejects sdk-browser event control: %s', async (statement) => {
  fixture = await createBrowserSource(
    `export function handle(event: Event): void { ${statement} }`,
  );
  const result = await checkWorkspace(fixture.rootDir);
  expect(result.violations).toEqual(
    expect.arrayContaining([expect.objectContaining({ code: 'forbidden-host-event-control' })]),
  );
});
```

Append executable Browser cases:

```ts
it('contains a callback error, preserves input objects, and handles the next event', () => {
  const nativeError = new Error('authorization=private');
  const nativeEvent = Object.freeze({
    target: window,
    message: 'Synthetic',
    filename: 'https://example.test/app.js?token=private',
    error: nativeError,
    defaultPrevented: false,
  });
  let healthyCalls = 0;
  browser.subscribeErrorSources((): never => {
    throw new Error('callback-private');
  });
  browser.subscribeErrorSources(() => {
    healthyCalls += 1;
  });
  windowTarget.dispatch('error', nativeEvent);
  windowTarget.dispatch('error', nativeEvent);
  expect(healthyCalls).toBe(2);
  expect(nativeEvent.defaultPrevented).toBe(false);
  expect(nativeError.message).toBe('authorization=private');
  expect(JSON.stringify(browser.getDiagnostics())).not.toMatch(/authorization|callback-private/);
});

it('destroying one instance leaves another error subscription active', () => {
  const first = createBrowserEnvironment();
  const second = createBrowserEnvironment();
  let firstCalls = 0;
  let secondCalls = 0;
  first.subscribeErrorSources(() => {
    firstCalls += 1;
  });
  second.subscribeErrorSources(() => {
    secondCalls += 1;
  });
  first.destroy();
  windowTarget.dispatch('error', { target: window, message: 'Synthetic' });
  expect({ firstCalls, secondCalls }).toEqual({ firstCalls: 0, secondCalls: 1 });
  second.destroy();
});
```

The test fixture must snapshot `window.onerror`, `window.onunhandledrejection`, `fetch`, `XMLHttpRequest`, `history`, native prototypes and original event properties before subscribing, then assert identity/value equality after unsubscribe and destroy. Spy on `console.error`, `console.warn`, and `console.log` and require zero calls.

- [ ] **Step 2: 确认预期失败**

Run:

```powershell
pnpm --filter @aurora/workspace-policy exec vitest run test/environment.test.ts
```

Expected: exit `1` because `forbidden-host-event-control` is not defined or emitted。Browser behavior tests may already pass; this Task 的 red evidence is the missing automatic host-event-control gate。

- [ ] **Step 3: 写最小 AST 门禁**

Add to `WorkspaceViolationCode`:

```ts
| 'forbidden-host-event-control'
```

Add and call this predicate only for `sdk-browser` source in `environment.ts`:

```ts
const forbiddenEventControlMethods: ReadonlySet<string> = new Set([
  'preventDefault',
  'stopPropagation',
  'stopImmediatePropagation',
]);

function isHostEventControl(node: ts.Node): boolean {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    forbiddenEventControlMethods.has(node.expression.name.text)
  );
}

if (layer === 'sdk-browser' && isHostEventControl(node)) {
  violations.push({
    code: 'forbidden-host-event-control',
    packageName: workspacePackage.name,
    file: relative(workspacePackage.directory, file).replaceAll('\\', '/'),
    message: 'sdk-browser source must not control host event defaults or propagation',
  });
}
```

This rule intentionally rejects all three method calls in Browser production source. Tests may use those methods only to assert host behavior; Workspace Policy scans `src`, not tests.

- [ ] **Step 4: 确认安全、隔离和策略通过**

Run:

```powershell
pnpm --filter @aurora/browser exec vitest run test/host-safety.test.ts test/multi-instance.test.ts test/error-source.test.ts
pnpm --filter @aurora/workspace-policy exec vitest run test/environment.test.ts test/dependency-policy.test.ts
pnpm lint
pnpm check:boundaries
```

Expected: all exit `0`；三个事件控制负例返回新违规代码；一个订阅抛错不影响另一个；连续两次原生事件均处理；宿主身份、事件和 Error 不变；诊断无敏感文本；实例不交叉取消。

- [ ] **Step 5: 记录建议提交边界**

建议提交信息：`test(browser): enforce error source host safety`。只有执行会话另获 Git 授权时才提交 Task 4 文件。

---

### Task 5: Chromium 三类真实错误与释放门禁

**Files:**

- Modify: `packages/browser/test-browser/fixture-server.ts`
- Modify: `packages/browser/test-browser/browser-environment.spec.ts`

**Consumes:** 构建后的 Browser 根入口、现有临时 HTTP 服务、Playwright Chromium 和 Task 3 公共 API。

**Produces:** 真实 JavaScript、Promise、资源错误、宿主 handler、默认行为、取消、销毁、回调隔离和多实例证据。

- [ ] **Step 1: 写失败的 Chromium 测试**

Append tests that invoke explicit fixture methods:

```ts
test('captures three real error sources once without replacing host handlers', async ({ page }) => {
  expect(await invoke(page, 'triggerThreeErrorSources')).toEqual({
    types: ['javascript_error', 'unhandled_rejection', 'resource_error'],
    counts: { javascript_error: 1, unhandled_rejection: 1, resource_error: 1 },
    onerrorIdentity: true,
    onunhandledrejectionIdentity: true,
    onerrorCalls: 1,
    onunhandledrejectionCalls: 1,
    everyDefaultPrevented: false,
    hasNativeReference: false,
  });
});

test('stops after unsubscribe and destroy without cross-cancelling instances', async ({ page }) => {
  expect(await invoke(page, 'verifyErrorSourceRelease')).toEqual({
    afterUnsubscribe: 0,
    afterDestroy: 0,
    survivingInstance: 1,
  });
});

test('contains callback failure without recursive collection or page damage', async ({ page }) => {
  const result = await invoke(page, 'verifyErrorCallbackIsolation');
  expect(result).toMatchObject({ healthyCalls: 2, callbackDiagnostics: 2 });
  expect(await page.evaluate(() => 20 + 22)).toBe(42);
});
```

- [ ] **Step 2: 确认预期失败**

Run:

```powershell
pnpm --filter @aurora/browser test:browser
```

Expected: exit `1`；fixture harness 缺少三个方法。现有五个 Chromium 测试必须仍通过，不接受构建或语法错误作为 red 原因。

- [ ] **Step 3: 写真实浏览器夹具实现**

In the served page, establish host handlers before creating the environment, subscribe explicitly, and add these trigger primitives:

```js
let onerrorCalls = 0;
let onunhandledrejectionCalls = 0;
const originalOnerror = () => {
  onerrorCalls += 1;
  return false;
};
const originalOnunhandledrejection = () => {
  onunhandledrejectionCalls += 1;
  return false;
};
window.onerror = originalOnerror;
window.onunhandledrejection = originalOnunhandledrejection;

const waitFor = async (predicate) => {
  const started = performance.now();
  while (!predicate()) {
    if (performance.now() - started > 3000) throw new Error('fixture observation timeout');
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

const triggerJavaScript = async () => {
  setTimeout(() => {
    throw new Error('Synthetic Chromium runtime error');
  }, 0);
  await waitFor(() => errorEvents.some((event) => event.type === 'javascript_error'));
};
const triggerRejection = async () => {
  void Promise.reject(new Error('Synthetic Chromium rejection'));
  await waitFor(() => errorEvents.some((event) => event.type === 'unhandled_rejection'));
};
const triggerResource = async () => {
  const script = document.createElement('script');
  script.src = '/missing-error-source.js?token=private#fragment';
  document.head.append(script);
  await waitFor(() => errorEvents.some((event) => event.type === 'resource_error'));
  script.remove();
};
```

Add a separate observer for `defaultPrevented`; it must not call any control method. The harness serializes only `Object.keys(view)` and primitive fields, then asserts no key/value is a native `Event`, `ErrorEvent`, `PromiseRejectionEvent` or `Node`. `triggerThreeErrorSources()` clears prior observations, invokes the three triggers sequentially, and returns the exact object asserted above. Release and isolation methods create fresh environments/subscriptions, trigger synthetic `ErrorEvent` instances after each transition, and return the exact counters. Callback isolation triggers two `ErrorEvent` instances; the failed callback throws synchronously and the healthy callback increments.

Do not return raw `Error`, rejection reason, event or node across `page.evaluate`; return only the declared primitive evidence object.

- [ ] **Step 4: 确认 Chromium 与包回归通过**

Run:

```powershell
pnpm --filter @aurora/browser test:browser
pnpm --filter @aurora/browser test
pnpm --filter @aurora/browser typecheck
pnpm --filter @aurora/browser test:package
```

Expected: all exit `0`；Playwright summary `8 passed`；三类真实错误各一次；两个 handler 身份不变且执行；默认行为未阻止；释放、多实例和页面脚本安全通过。

- [ ] **Step 5: 记录建议提交边界**

建议提交信息：`test(browser): verify error sources in chromium`。只有执行会话另获 Git 授权时才提交 Task 5 文件。

---

### Task 6: 包入口、覆盖率、体积、文档与完整门禁

**Files:**

- Modify: `packages/browser/test/package-entry.test.ts`
- Modify: `packages/browser/test/import-safety.test.ts`
- Modify: `packages/browser/test/documentation-contract.test.ts`
- Modify: `packages/browser/README.md`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `docs/README.md`
- Modify: `docs/architecture/system-overview.md`
- Modify: `docs/architecture/sdk-architecture.md`
- Modify: `docs/architecture/monorepo-and-build.md`
- Modify: `docs/architecture/formalization-readiness.md`
- Modify: `docs/testing/test-strategy.md`
- Modify: `docs/sdk/browser-error-source.md`
- Modify: `docs/adr/ADR-003-sdk-plugin-architecture.md`
- Modify: `docs/adr/ADR-006-one-way-dependencies.md`
- Modify: `AGENTS.md`
- Modify: `AURORA_RULES.md`

**Consumes:** Tasks 1—5 的真实行为、现有根命令、文档规范、覆盖率阈值、8 KiB 单插件预算和 ADR 状态规则。

**Produces:** built 根出口/私有路径证据、导入零副作用、85/80/85/85 覆盖率、可重复 gzip 数值、`requires-benchmark` 记录、模块 README、正式状态与 ADR 实施证据。

- [ ] **Step 1: 写失败的包、导入和文档契约**

Change the expected built runtime exports to:

```text
BrowserCapabilityName,BrowserDestroyCode,BrowserDiagnosticCode,BrowserDiagnosticOperation,BrowserErrorSourceEventType,BrowserSubscribeCode,BrowserUnsubscribeCode,PageLifecycleEventType,PageVisibilityState,createBrowserEnvironment
```

Add `@aurora/browser/error-source` to private-path rejection. Extend `import-safety.test.ts` by stubbing `window.addEventListener` and asserting it has zero calls after importing `../src/index.js` and after importing built `@aurora/browser` in a child process.

Append documentation assertions:

```ts
expect(await rootFile('packages/browser/README.md')).toContain('subscribeErrorSources');
expect(await rootFile('docs/sdk/browser-error-source.md')).toContain(
  'implementation-status: implemented',
);
expect(await rootFile('docs/architecture/sdk-architecture.md')).toContain('错误插件仍不存在');
expect(await rootFile('docs/adr/ADR-003-sdk-plugin-architecture.md')).toContain(
  'implementation-status: in-progress',
);
expect(await rootFile('docs/adr/ADR-006-one-way-dependencies.md')).toContain(
  'implementation-status: in-progress',
);
```

Run before docs/entry updates:

```powershell
pnpm --filter @aurora/browser exec vitest run test/package-entry.test.ts test/import-safety.test.ts test/documentation-contract.test.ts
```

Expected: exit `1`；旧 package-entry 列表、README 和规格实施状态未包含新能力。ADR 状态断言必须已通过，不得更改它们制造 red。

- [ ] **Step 2: 锁定根出口与导入副作用**

Export only the Final Public API from `src/index.ts`; do not export `createErrorSourceEvent` or `createErrorSourceManager`. Build and run:

```powershell
pnpm --filter @aurora/browser build
pnpm --filter @aurora/browser exec vitest run test/package-entry.test.ts test/import-safety.test.ts
pnpm check:boundaries
```

Expected: all exit `0`；root loads the exact ten runtime names；`src`、`internal`、`page-lifecycle`、`error-source` private paths all fail with `ERR_PACKAGE_PATH_NOT_EXPORTED`；imports register zero listeners；boundary CLI silent。

- [ ] **Step 3: 写 README 和准确实施证据**

Update `packages/browser/README.md` with exact sections for error-source responsibility, Final Public API usage, synchronous lifetime of `error`/`reason`, URL `origin + pathname`, two-listener registration, capture flag, rollback, idempotent release, diagnostics, Chromium and exclusions. It must state that error protocol conversion, Core plugin, event ID/time, dedupe, grouping, Source Map, sampling, queue, transport and persistence do not exist.

After Tasks 1—5 and focused gates pass, update only this metadata in `docs/sdk/browser-error-source.md`:

```yaml
status: approved
implementation-status: implemented
last-updated: 2026-07-31
```

Synchronize the current-state sentences in root/architecture/testing/index/entry docs. `formalization-readiness.md` must say Browser error-source prerequisite is implemented but `packages/plugin-error` remains absent and still needs its own approved specification. Append exact, dated evidence to ADR-003 and ADR-006 while retaining their metadata. Do not edit ADR-005 except an index assertion if its current state is already shown elsewhere; it remains `accepted / in-progress`. ADR-007 remains `accepted / implemented`.

Extend root `format:check` with `docs/sdk/browser-error-source.md`; preserve every existing script name and path. No dependency or lockfile change is allowed.

- [ ] **Step 4: 运行覆盖率和可重复体积检查**

Run:

```powershell
pnpm --filter @aurora/browser test:coverage
pnpm --filter @aurora/browser build
node --input-type=module --eval "import { readFile } from 'node:fs/promises'; import { gzipSync } from 'node:zlib'; const source = await readFile('packages/browser/dist/error-source.js'); console.log(JSON.stringify({ file: 'dist/error-source.js', rawBytes: source.byteLength, gzipBytes: gzipSync(source, { level: 9 }).byteLength }));"
```

Expected: commands exit `0`；coverage reports lines `>=85`、branches `>=80`、functions `>=85`、statements `>=85`；Node prints one JSON object with actual positive byte counts. Copy that value into the implementation evidence; do not invent a number. Record `requires-benchmark` because raw ESM gzip is not a consumer bundle/tree-shaking result. Assert `package.json.sideEffects === false` and no import-time listener registration.

- [ ] **Step 5: 运行文档、Chromium 和根级完整质量门禁**

Run each command separately and retain complete output:

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm check:boundaries
pnpm build
pnpm --filter @aurora/event-schema test:package
pnpm --filter @aurora/core test:package
pnpm --filter @aurora/browser test:package
pnpm --filter @aurora/browser test:browser
pnpm check:ci
```

Expected: every command exits `0`；Browser unit/coverage/package/Chromium all pass；event-schema and Core package regressions pass；boundary CLI silent；`check:ci` repeats the complete final tree gate。Do not rerun or edit unrelated failures without first identifying whether they pre-existed。

- [ ] **Step 6: 做最终负例、diff 和状态审查**

Run:

```powershell
git diff --check
git diff -- packages/browser tooling/workspace-policy package.json README.md docs AGENTS.md AURORA_RULES.md
git status --short --branch
git diff --cached --stat
Get-ChildItem -LiteralPath packages/browser/src -File | Select-String -Pattern 'preventDefault|stopPropagation|stopImmediatePropagation|window\.onerror\s*=|window\.onunhandledrejection\s*=|fetch\s*=|XMLHttpRequest\s*=|history\.(pushState|replaceState)\s*=|@aurora/core|@aurora/event-schema|document\.cookie|localStorage|sessionStorage|console\.'
Get-ChildItem -LiteralPath packages/browser/src -File | Select-String -Pattern '/src/|/internal/'
```

Expected: `git diff --check` exit `0`；两个 source searches return no matches；diff contains only this plan's files plus protected user changes；staged set remains execution-session authorized state；no plugin, protocol conversion, Core API, network, queue, persistence, framework, server, CI, release, container, IaC or cloud file appears。

- [ ] **Step 7: 记录建议提交边界**

建议提交信息：`docs(browser): record error source evidence and gates`。只有执行会话另获 Git 授权时才提交 Task 6 文件，不得混入用户已有无关修改。

---

## Task-to-Spec Traceability

| 正式规格要求                               | 实施 Task               |
| ------------------------------------------ | ----------------------- |
| 模块选择、职责、非职责、最小公共 API       | 1、6                    |
| JavaScript/Promise/资源三类只读视图        | 2                       |
| URL 脱敏、无事件/DOM 保留、reason 不遍历   | 2、4、5                 |
| 两监听器、捕获参数、部分失败回滚           | 3                       |
| 取消、重复取消、销毁、重复销毁、销毁后失败 | 3、5                    |
| 回调/投影/移除异常隔离与有界诊断           | 2—5                     |
| handler/default/传播/API/原型宿主安全      | 4、5                    |
| 多订阅与多实例隔离、防递归                 | 3—5                     |
| strict、命名、单一职责、无私有导入/循环    | 1—4、6                  |
| 包入口、导入无副作用、sideEffects          | 1、6                    |
| Chromium 真实浏览器范围                    | 5                       |
| 85/80/85/85 覆盖率                         | 6                       |
| gzip 实测与 requires-benchmark             | 6                       |
| README、架构、测试、入口与 ADR 证据        | 6                       |
| Core/event-schema/plugin/网络等排除        | Global Constraints、2—6 |

## Suggested Review and Commit Boundaries

Task 1 审公共契约；Task 2 审原生事实和隐私；Task 3 审资源状态机；Task 4 审宿主安全和自动策略；Task 5 审 Chromium；Task 6 审出口、质量、体积和文档。建议提交边界不构成 Git 授权。

## Completion Definition

只有 Task 1—6 全部完成、每个 red 原因被实际观察、最小实现和任务级回归通过、根级完整门禁以新鲜输出通过、规格/README/架构/ADR 证据同步、体积数值来自真实命令且最终负例无匹配时，才能报告 Browser 错误源第一增量已实施。本计划本身不执行代码、不改变 ADR 状态，也不使 `packages/plugin-error` 成为已存在模块。
