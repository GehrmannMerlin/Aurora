# Browser Performance Source (浏览器性能事实观测能力第一增量) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `@aurora/browser` 中扩展浏览器性能事实观测能力第一增量：通过 `subscribePerformance(listener)` 订阅 `page_load`/`lcp`/`cls`/`inp` 四类最小只读脱敏事实，复用现有订阅/取消/销毁/诊断契约，保持零运行时依赖。

**Architecture:** 镜像已有 `error-source.ts`/`request-source.ts` 模式：新增 `performance-source.ts` 作为实例级性能观测管理器，`BrowserEnvironment.subscribePerformance` 接线到它；每指标一个独立 `PerformanceObserver`（page_load 用 `performance.getEntriesByType('navigation')`），实例内多订阅者共享 observer（首个安装、最后一个取消时 disconnect）；原生 entry 通过 `readProperty`/`readMethod`/`callMethod` 安全读取并投影为冻结的最小事实；指标状态机只保留常数个数字状态（LCP 最大值、CLS 当前 session + 最大值、INP 全局最大值 + 当前 interaction），内存有界。能力探测扩展 `canObservePerformance`。

**Tech Stack:** TypeScript 6.0.3（root `strict`/`exactOptionalPropertyTypes`/`noUncheckedIndexedAccess`）、Vitest 4.1.10、@vitest/coverage-v8 4.1.10、Playwright 1.62.0（单 Chromium）、pnpm Workspace 11.17.0、Node.js ≥24.18.0。

**Plan status:** ready-for-implementation（联合模式自动审批通过；禁止 `git add`/`commit`/`push`）。

## Global Constraints

- 只修改 `packages/browser`，不修改 event-schema、Core、plugin-error、plugin-request 的公共接口，不创建新包。
- 指标范围严格限定为 PRD 5.1.9 批准的 `lcp`、`inp`、`cls`、`page_load` 四项；FCP/TTFB/FID/TBT/资源计时/导航分解不实现。
- 指标计算语义来自 W3C 规范（Largest Contentful Paint、Layout Instability、Event Timing、Navigation Timing），全部用原生 `PerformanceObserver` 实现，**不增加运行时依赖**（禁止 `web-vitals` 等库）。
- Browser 保持 `aurora.layer: sdk-browser`、`sideEffects: false`、单一根出口、零本地运行时依赖。
- 不修改 `PerformanceObserver`、`performance`、原生 prototype 或宿主全局；不影响其他库的 observer；不清空/消费宿主 buffered entries。
- 每订阅者每指标只保留常数个数字状态；不保留 entry/DOM/事件引用；诊断脱敏。
- 复用现有 `BrowserSubscribeResult`/`BrowserSubscription`/`BrowserUnsubscribeResult`/`BrowserDestroyResult`/`BrowserDiagnostic`，不新增结果体系。
- 复用 `safe-access.ts`（`readProperty`/`readMethod`/`callMethod`）与 `BrowserHostContext`；不复制 event-schema 校验逻辑。
- 文件 kebab-case，类型/接口 PascalCase，函数/变量 camelCase，布尔值 `is`/`has`/`can`/`should` 前缀。禁止无说明 `any`、`Object`、`Function`、`Record<string, any>`、双重断言、非空断言、`@ts-ignore`。
- 不创建 `utils`/`helpers`/`common`/`misc`。生产源码不使用 `console`、`preventDefault`/`stopPropagation`/`stopImmediatePropagation`、模块级可变状态、宿主修改。
- 覆盖率阈值 lines ≥ 85 / branches ≥ 80 / functions ≥ 85 / statements ≥ 85，由 `packages/browser/vitest.config.ts` 固定。
- ADR-003/005/006 保持 `accepted / in-progress`，ADR-007 保持 `accepted / implemented`，本计划不改变任何 ADR 状态。

---

## 文件树

```text
packages/browser/
├── src/
│   ├── capabilities.ts           # Modify：BrowserCapabilityName.PerformanceSource、canObservePerformance
│   ├── diagnostics.ts            # Modify：PerformanceEntryRejected 码、BrowserDiagnosticEventType 并入指标名
│   ├── performance-source.ts     # Create：性能事实投影、指标状态机、observer 安装/回滚/取消/销毁
│   ├── browser-environment.ts    # Modify：subscribePerformance 接线
│   └── index.ts                  # Modify：导出性能事实常量/类型
├── test/
│   ├── package-entry.test.ts     # Modify：性能符号与私有路径
│   ├── architecture-boundary.test.ts # Modify：禁止项扩展
│   ├── performance-source.test.ts    # Create：单元测试（能力/注册/page_load/LCP/CLS/INP/隔离）
│   ├── host-safety.test.ts           # Modify：性能回调隔离补充（如有必要）
│   └── multi-instance.test.ts        # Modify：性能多实例补充（如有必要）
└── test-browser/
    ├── fixture-server.ts         # Modify：性能 harness 与 API 端点
    └── performance-source.spec.ts# Create：Chromium 场景
```

根文件修改（跨 Task 使用）：`packages/browser/README.md`、根 `README.md`、`docs/README.md`、`docs/architecture/sdk-architecture.md`、`docs/architecture/formalization-readiness.md`、`docs/adr/ADR-003-sdk-plugin-architecture.md`、`docs/adr/ADR-006-one-way-dependencies.md`、`AGENTS.md`、`AURORA_RULES.md`。

---

### Task 1: 性能事实契约、能力探测与包出口

**Files:**
- Create: `packages/browser/src/performance-source.ts`（先建最小骨架：常量、类型、`createPerformanceObserverManager` 签名）
- Create: `packages/browser/test/performance-source.test.ts`（能力与契约测试）
- Modify: `packages/browser/src/capabilities.ts`
- Modify: `packages/browser/src/diagnostics.ts`
- Modify: `packages/browser/src/index.ts`
- Modify: `packages/browser/test/package-entry.test.ts`

**Interfaces:**
- Consumes: `BrowserCapabilityName`、`BrowserCapabilities`、`BrowserHostContext`、`BrowserDiagnostic`/`BrowserDiagnosticStore`、`BrowserSubscribeResult`/`BrowserSubscription`/`BrowserUnsubscribeResult`/`BrowserDestroyResult`、`readProperty`/`readMethod`/`callMethod`。
- Produces: `BrowserPerformanceMetricName`、`BrowserPerformanceMetricUnit`、`BrowserPerformanceSourceEvent`、`BrowserPerformanceSourceListener`、`BrowserPerformanceObserverManager`（后续 Task 依赖）、`BrowserCapabilityName.PerformanceSource`、`BrowserCapabilities.canObservePerformance`。

- [ ] **Step 1: 写失败的能力与契约测试**

`packages/browser/test/performance-source.test.ts`：

```ts
import {
  BrowserPerformanceMetricName,
  BrowserPerformanceMetricUnit,
} from '../src/index.js';
import { BrowserCapabilityName } from '../src/capabilities.js';
import { createPerformanceObserverManager, type PerformanceObserverManager } from '../src/performance-source.js';
import { createDiagnosticStore } from '../src/diagnostics.js';
import { describe, expect, it } from 'vitest';

describe('browser performance source contract', () => {
  it('exposes exactly the four approved metric names and two units', () => {
    expect(BrowserPerformanceMetricName).toEqual({
      Lcp: 'lcp',
      Inp: 'inp',
      Cls: 'cls',
      PageLoad: 'page_load',
    });
    expect(BrowserPerformanceMetricUnit).toEqual({
      Millisecond: 'millisecond',
      Ratio: 'ratio',
    });
  });

  it('adds PerformanceSource capability without breaking existing names', () => {
    expect(BrowserCapabilityName.PerformanceSource).toBe('performance_source');
    expect(BrowserCapabilityName.RequestSource).toBe('request_source');
  });

  it('creates a manager with empty state and exposes subscribe/destroy', () => {
    const diagnostics = createDiagnosticStore();
    const manager = createPerformanceObserverManager({} as never, diagnostics);
    expect(typeof manager.subscribe).toBe('function');
    expect(typeof manager.destroy).toBe('function');
    expect(diagnostics.getDiagnostics()).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行测试确认预期失败**

Run: `pnpm --filter @aurora/browser exec vitest run test/performance-source.test.ts`
Expected: FAIL，`../src/performance-source.js` 不存在、`BrowserCapabilityName.PerformanceSource` 不存在。

- [ ] **Step 3: 写最小实现**

`packages/browser/src/performance-source.ts`：

```ts
import type {
  BrowserPerformanceMetricName,
  BrowserPerformanceMetricUnit,
  BrowserPerformanceSourceEvent,
  BrowserPerformanceSourceListener,
} from './performance-source-types.js';
import { BrowserCapabilityName, type BrowserHostContext } from './capabilities.js';
import {
  BrowserDiagnosticCode,
  BrowserDiagnosticOperation,
  type BrowserDiagnosticStore,
} from './diagnostics.js';
import type {
  BrowserDestroyResult,
  BrowserSubscribeResult,
  BrowserSubscription,
  BrowserUnsubscribeResult,
} from './page-lifecycle.js';

export interface PerformanceObserverManager {
  subscribe(listener: BrowserPerformanceSourceListener): BrowserSubscribeResult;
  destroy(): BrowserDestroyResult;
}

export function createPerformanceObserverManager(
  host: BrowserHostContext,
  diagnostics: BrowserDiagnosticStore,
): PerformanceObserverManager {
  const listeners = new Set<BrowserPerformanceSourceListener>();
  let isDestroyed = false;

  function notify(event: BrowserPerformanceSourceEvent): void {
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch {
        diagnostics.append({
          code: BrowserDiagnosticCode.CallbackFailed,
          operation: BrowserDiagnosticOperation.Notify,
          capability: BrowserCapabilityName.PerformanceSource,
        });
      }
    }
  }

  function subscribe(listener: BrowserPerformanceSourceListener): BrowserSubscribeResult {
    if (typeof listener !== 'function') {
      return Object.freeze({
        ok: false,
        code: 'invalid_listener' as const,
        diagnosticsAdded: 0,
      });
    }
    if (isDestroyed) {
      return Object.freeze({
        ok: false,
        code: 'destroyed' as const,
        diagnosticsAdded: 0,
      });
    }
    listeners.add(listener);
    const subscription: BrowserSubscription = Object.freeze({
      unsubscribe: (): BrowserUnsubscribeResult => {
        if (!listeners.has(listener)) {
          return Object.freeze({
            ok: true,
            code: 'already_unsubscribed' as const,
            diagnosticsAdded: 0,
          });
        }
        listeners.delete(listener);
        return Object.freeze({
          ok: true,
          code: 'unsubscribed' as const,
          diagnosticsAdded: 0,
        });
      },
    });
    return Object.freeze({
      ok: true,
      code: 'subscribed' as const,
      subscription,
      diagnosticsAdded: 0,
    });
  }

  function destroy(): BrowserDestroyResult {
    if (isDestroyed) {
      return Object.freeze({
        ok: true,
        code: 'already_destroyed' as const,
        diagnosticsAdded: 0,
      });
    }
    isDestroyed = true;
    listeners.clear();
    return Object.freeze({
      ok: true,
      code: 'destroyed' as const,
      diagnosticsAdded: 0,
    });
  }

  return Object.freeze({ subscribe, destroy });
}
```

注意：`performance-source-types.ts` 在 Task 2 创建；本 Task 中 `BrowserPerformanceMetricName`/`Unit`/`SourceEvent`/`SourceListener` 从 `./performance-source-types.js` 导入。为让本 Task 可独立编译，在 `src/index.ts` 直接导出内联常量与类型（见 Step 4），并将 `performance-source.ts` 的 import 改为从 `./performance-source-types.js`；本 Task Step 3 先创建最小 `performance-source-types.ts`：

`packages/browser/src/performance-source-types.ts`：

```ts
export const BrowserPerformanceMetricName = Object.freeze({
  Lcp: 'lcp',
  Inp: 'inp',
  Cls: 'cls',
  PageLoad: 'page_load',
} as const);

export type BrowserPerformanceMetricName =
  (typeof BrowserPerformanceMetricName)[keyof typeof BrowserPerformanceMetricName];

export const BrowserPerformanceMetricUnit = Object.freeze({
  Millisecond: 'millisecond',
  Ratio: 'ratio',
} as const);

export type BrowserPerformanceMetricUnit =
  (typeof BrowserPerformanceMetricUnit)[keyof typeof BrowserPerformanceMetricUnit];

export interface BrowserPerformanceSourceEvent {
  readonly metricName: BrowserPerformanceMetricName;
  readonly value: number;
  readonly unit: BrowserPerformanceMetricUnit;
  readonly startedAt: number;
  readonly durationMs?: number;
}

export type BrowserPerformanceSourceListener = (event: BrowserPerformanceSourceEvent) => void;
```

- [ ] **Step 4: 修改 capabilities、diagnostics 与 index**

`packages/browser/src/capabilities.ts` 追加：

```ts
  PerformanceSource: 'performance_source',
```

加入 `BrowserCapabilityName`，并在 `BrowserCapabilities` 增加 `canObservePerformance: boolean`。在 `detectBrowserCapabilities` 中计算：

```ts
  const perfMethods = readMethod(host.performanceTarget, 'getEntriesByType');
  const perfGetEntries = readMethod(host.performanceTarget, 'getEntries');
  const perfObserver = readProperty(host.windowTarget, 'PerformanceObserver');
  if (!perfMethods.ok && perfMethods.reason === 'threw')
    diagnostics.append({
      code: BrowserDiagnosticCode.PropertyReadFailed,
      operation: BrowserDiagnosticOperation.ReadCapabilities,
      capability: BrowserCapabilityName.PerformanceSource,
    });
  const canObservePerformance =
    isObjectLike(host.performanceTarget) &&
    perfMethods.ok &&
    perfGetEntries.ok &&
    perfObserver.ok &&
    typeof perfObserver.value === 'function';
```

返回对象加入 `canObservePerformance`。

`packages/browser/src/diagnostics.ts` 追加 `PerformanceEntryRejected` 到 `BrowserDiagnosticCode`，并把 `BrowserDiagnosticEventType` 扩为：

```ts
export type BrowserDiagnosticEventType =
  | PageLifecycleEventType
  | BrowserErrorSourceEventType
  | BrowserRequestSourceEventType
  | BrowserPerformanceMetricName;
```

`packages/browser/src/index.ts` 追加：

```ts
export {
  BrowserPerformanceMetricName,
  BrowserPerformanceMetricUnit,
} from './performance-source-types.js';
export type {
  BrowserPerformanceSourceEvent,
  BrowserPerformanceSourceListener,
} from './performance-source-types.js';
```

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm --filter @aurora/browser exec vitest run test/performance-source.test.ts`
Expected: PASS。

Run: `pnpm --filter @aurora/browser typecheck`
Expected: PASS。

- [ ] **Step 6: 相关回归**

Run: `pnpm --filter @aurora/browser exec vitest run test/capabilities.test.ts test/package-entry.test.ts test/architecture-boundary.test.ts`
Expected: PASS。

- [ ] **Step 7: 建议提交边界**

不执行 `git add`/`commit`。若另行授权，本 Task 边界为 performance-source 骨架、performance-source-types、capabilities/diagnostics/index 修改与能力测试。

---

### Task 2: page_load 事实投影与 manager 接线

**Files:**
- Modify: `packages/browser/src/performance-source.ts`
- Modify: `packages/browser/src/browser-environment.ts`
- Modify: `packages/browser/test/performance-source.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `PerformanceObserverManager`、`BrowserPerformanceSourceEvent`/`Listener`；`BrowserHostContext`；`readProperty`/`readMethod`/`callMethod`。
- Produces: `subscribePerformance` 在 `BrowserEnvironment` 上的接线；page_load 事实投影（Task 3 的 LCP 复用 manager 订阅/通知框架）。

- [ ] **Step 1: 写失败的 page_load 测试**

`packages/browser/test/performance-source.test.ts` 追加：

```ts
describe('browser performance page_load projection', () => {
  it('produces a page_load fact from a valid navigation entry', () => {
    const host = createHostWithNavigation(1_800_000_000_000, 100, 1500);
    const diagnostics = createDiagnosticStore();
    const manager = createPerformanceObserverManager(host, diagnostics);
    const facts: BrowserPerformanceSourceEvent[] = [];
    const result = manager.subscribe((event) => facts.push(event));
    expect(result.ok).toBe(true);
    expect(facts).toHaveLength(1);
    expect(facts[0]).toEqual({
      metricName: 'page_load',
      value: 1400,
      unit: 'millisecond',
      startedAt: 1_800_000_000_100,
      durationMs: 1400,
    });
  });

  it('does not emit page_load when loadEventEnd is zero (load not finished)', () => {
    const host = createHostWithNavigation(1_800_000_000_000, 100, 0);
    const diagnostics = createDiagnosticStore();
    const manager = createPerformanceObserverManager(host, diagnostics);
    const facts: BrowserPerformanceSourceEvent[] = [];
    manager.subscribe((event) => facts.push(event));
    expect(facts).toEqual([]);
  });

  it('does not emit page_load for a negative or invalid duration', () => {
    const host = createHostWithNavigation(1_800_000_000_000, 2000, 500);
    const diagnostics = createDiagnosticStore();
    const manager = createPerformanceObserverManager(host, diagnostics);
    const facts: BrowserPerformanceSourceEvent[] = [];
    manager.subscribe((event) => facts.push(event));
    expect(facts).toEqual([]);
    expect(diagnostics.getDiagnostics().some((d) => d.code === 'performance_entry_rejected')).toBe(true);
  });

  it('does not retain the native entry reference', () => {
    const host = createHostWithNavigation(1_800_000_000_000, 100, 1500);
    const diagnostics = createDiagnosticStore();
    const manager = createPerformanceObserverManager(host, diagnostics);
    const facts: BrowserPerformanceSourceEvent[] = [];
    manager.subscribe((event) => facts.push(event));
    expect(facts[0]).not.toEqual(expect.any(Object));
  });
});

function createHostWithNavigation(
  timeOrigin: number,
  startTime: number,
  loadEventEnd: number,
): unknown {
  const navigationEntry = Object.freeze({ startTime, loadEventEnd });
  return Object.freeze({
    windowTarget: Object.freeze({}),
    documentTarget: Object.freeze({}),
    navigatorTarget: Object.freeze({}),
    performanceTarget: Object.freeze({
      timeOrigin,
      getEntriesByType: (type: string) => (type === 'navigation' ? [navigationEntry] : []),
      getEntries: () => [navigationEntry],
    }),
  });
}
```

- [ ] **Step 2: 运行测试确认预期失败**

Run: `pnpm --filter @aurora/browser exec vitest run test/performance-source.test.ts`
Expected: FAIL，`createPerformanceObserverManager` 不产生 page_load 事实。

- [ ] **Step 3: 写最小实现**

在 `performance-source.ts` 中实现 `readPageLoadFact` 并在 `subscribe` 时调用：

```ts
import { BrowserPerformanceMetricName, BrowserPerformanceMetricUnit, type BrowserPerformanceSourceEvent } from './performance-source-types.js';

function readFiniteNumber(target: unknown, key: string): number | null {
  const value = readProperty(target, key);
  return value.ok && typeof value.value === 'number' && Number.isFinite(value.value)
    ? value.value
    : null;
}

function readPageLoadFact(host: BrowserHostContext, diagnostics: BrowserDiagnosticStore): BrowserPerformanceSourceEvent | null {
  const entries = callMethod(
    readMethod(host.performanceTarget, 'getEntriesByType') as never,
    host.performanceTarget,
    ['navigation'],
  );
  if (!entries.ok) {
    diagnostics.append({
      code: BrowserDiagnosticCode.PerformanceEntryRejected,
      operation: BrowserDiagnosticOperation.Notify,
      capability: BrowserCapabilityName.PerformanceSource,
      eventType: BrowserPerformanceMetricName.PageLoad,
    });
    return null;
  }
  if (!Array.isArray(entries.value) || entries.value.length === 0) return null;
  const entry = entries.value[0];
  const timeOrigin = readFiniteNumber(host.performanceTarget, 'timeOrigin');
  const startTime = readFiniteNumber(entry, 'startTime');
  const loadEventEnd = readFiniteNumber(entry, 'loadEventEnd');
  if (timeOrigin === null || startTime === null || loadEventEnd === null) {
    diagnostics.append({
      code: BrowserDiagnosticCode.PerformanceEntryRejected,
      operation: BrowserDiagnosticOperation.Notify,
      capability: BrowserCapabilityName.PerformanceSource,
      eventType: BrowserPerformanceMetricName.PageLoad,
    });
    return null;
  }
  const duration = loadEventEnd - startTime;
  if (duration < 0) {
    diagnostics.append({
      code: BrowserDiagnosticCode.PerformanceEntryRejected,
      operation: BrowserDiagnosticOperation.Notify,
      capability: BrowserCapabilityName.PerformanceSource,
      eventType: BrowserPerformanceMetricName.PageLoad,
    });
    return null;
  }
  if (loadEventEnd === 0) return null; // load 尚未完成，延后
  const value = Math.round(duration);
  return Object.freeze({
    metricName: BrowserPerformanceMetricName.PageLoad,
    value,
    unit: BrowserPerformanceMetricUnit.Millisecond,
    startedAt: Math.round(timeOrigin + startTime),
    durationMs: value,
  });
}
```

在 `subscribe(listener)` 中，登记成功后调用 `readPageLoadFact(host, diagnostics)`，非 null 时 `notify(fact)`。

- [ ] **Step 4: 接线到 BrowserEnvironment**

`browser-environment.ts` 追加：

```ts
import { createPerformanceObserverManager, type PerformanceObserverManager } from './performance-source.js';
import type { BrowserPerformanceSourceListener } from './performance-source-types.js';
// ...
  const performanceSource: PerformanceObserverManager = createPerformanceObserverManager(host, diagnostics);
// ...
    performanceSource.destroy();
// ...
    subscribePerformance: (listener: BrowserPerformanceSourceListener): BrowserSubscribeResult =>
      performanceSource.subscribe(listener),
```

并删除不再使用的 `notify`/`listeners` 骨架逻辑（保留 manager 框架）。

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm --filter @aurora/browser exec vitest run test/performance-source.test.ts`
Expected: PASS。

Run: `pnpm --filter @aurora/browser typecheck`
Expected: PASS。

- [ ] **Step 6: 相关回归**

Run: `pnpm --filter @aurora/browser exec vitest run test/browser-environment.test.ts test/package-entry.test.ts`
Expected: PASS。

- [ ] **Step 7: 建议提交边界**

不执行 `git add`/`commit`。若另行授权，本 Task 边界为 page_load 投影、manager 接线、BrowserEnvironment.subscribePerformance 与测试。

---

### Task 3: LCP 指标状态机与收尾

**Files:**
- Modify: `packages/browser/src/performance-source.ts`
- Modify: `packages/browser/test/performance-source.test.ts`

**Interfaces:**
- Consumes: Task 1/2 的 manager、`readFiniteNumber`、`notify`、`readProperty`/`callMethod`；`BrowserPerformanceMetricName`/`Unit`。
- Produces: LCP 事实投影（最终候选收尾）、observer 安装模式（CLS/INP 复用）。

- [ ] **Step 1: 写失败的 LCP 测试**

`packages/browser/test/performance-source.test.ts` 追加：

```ts
describe('browser performance LCP projection', () => {
  function hostWithObserver(): { host: unknown; observers: { options: unknown; callback: (list: unknown) => void }[] } {
    const observers: { options: unknown; callback: (list: unknown) => void }[] = [];
    const Observer = function (this: unknown, callback: (list: unknown) => void) {
      (this as { callback: (list: unknown) => void }).callback = callback;
    } as unknown as new (cb: (list: unknown) => void) => { callback: (list: unknown) => void };
    const proto = Observer.prototype as { observe?: (opts: unknown) => void; disconnect?: () => void };
    proto.observe = function (this: unknown, options: unknown) {
      observers.push({ options, callback: (this as { callback: (l: unknown) => void }).callback });
    };
    proto.disconnect = function (this: unknown): void {
      // no-op
    };
    return {
      host: Object.freeze({
        windowTarget: Object.freeze({ PerformanceObserver: Observer }),
        documentTarget: Object.freeze({}),
        navigatorTarget: Object.freeze({}),
        performanceTarget: Object.freeze({
          timeOrigin: 1_800_000_000_000,
          getEntriesByType: () => [],
          getEntries: () => [],
        }),
      }),
      observers,
    };
  }

  it('tracks the largest LCP candidate and emits on dispose', () => {
    const { host, observers } = hostWithObserver();
    const diagnostics = createDiagnosticStore();
    const manager = createPerformanceObserverManager(host, diagnostics);
    const facts: BrowserPerformanceSourceEvent[] = [];
    const sub = manager.subscribe((event) => facts.push(event));
    expect(sub.ok).toBe(true);
    const lcpObserver = observers.find((o) => (o.options as { type?: string }).type === 'largest-contentful-paint');
    expect(lcpObserver).toBeDefined();
    lcpObserver?.callback({ getEntries: () => [{ startTime: 100, renderTime: 800, loadTime: 900 }] });
    lcpObserver?.callback({ getEntries: () => [{ startTime: 200, renderTime: 1200, loadTime: 1300 }] });
    sub.subscription.unsubscribe();
    expect(facts.map((f) => f.metricName)).toContain('lcp');
    const lcp = facts.find((f) => f.metricName === 'lcp');
    expect(lcp?.value).toBe(1200);
    expect(lcp?.startedAt).toBe(1_800_000_000_200);
    expect(lcp?.unit).toBe('millisecond');
  });

  it('ignores non-positive renderTime entries', () => {
    const { host, observers } = hostWithObserver();
    const diagnostics = createDiagnosticStore();
    const manager = createPerformanceObserverManager(host, diagnostics);
    const facts: BrowserPerformanceSourceEvent[] = [];
    const sub = manager.subscribe((event) => facts.push(event));
    const lcpObserver = observers.find((o) => (o.options as { type?: string }).type === 'largest-contentful-paint');
    lcpObserver?.callback({ getEntries: () => [{ startTime: 100, renderTime: 0, loadTime: 0 }] });
    sub.subscription.unsubscribe();
    expect(facts.filter((f) => f.metricName === 'lcp')).toHaveLength(0);
  });

  it('does not leak element or url from the entry', () => {
    const { host, observers } = hostWithObserver();
    const diagnostics = createDiagnosticStore();
    const manager = createPerformanceObserverManager(host, diagnostics);
    const facts: BrowserPerformanceSourceEvent[] = [];
    const sub = manager.subscribe((event) => facts.push(event));
    const lcpObserver = observers.find((o) => (o.options as { type?: string }).type === 'largest-contentful-paint');
    lcpObserver?.callback({ getEntries: () => [{ startTime: 100, renderTime: 800, loadTime: 900, element: { id: 'secret' }, url: 'https://x.test/a' }] });
    sub.subscription.unsubscribe();
    const lcp = facts.find((f) => f.metricName === 'lcp');
    expect(lcp).toBeDefined();
    expect(JSON.stringify(lcp)).not.toContain('secret');
    expect(JSON.stringify(lcp)).not.toContain('x.test');
  });
});
```

- [ ] **Step 2: 运行测试确认预期失败**

Run: `pnpm --filter @aurora/browser exec vitest run test/performance-source.test.ts`
Expected: FAIL，LCP observer 未安装或事实未发送。

- [ ] **Step 3: 写最小实现**

在 `performance-source.ts` 中增加 LCP 状态机：

- 每个订阅者记录 `lcpCandidate: { renderTime: number; startTime: number } | null`；
- 首个订阅者安装 `largest-contentful-paint` observer，回调中：

```ts
function updateLcpCandidate(
  candidate: { renderTime: number; startTime: number } | null,
  entries: unknown,
  diagnostics: BrowserDiagnosticStore,
): { renderTime: number; startTime: number } | null {
  let next = candidate;
  const list = entries as { getEntries: () => unknown };
  const entryList = readMethod(list, 'getEntries');
  if (!entryList.ok) {
    diagnostics.append({
      code: BrowserDiagnosticCode.PerformanceEntryRejected,
      operation: BrowserDiagnosticOperation.Notify,
      capability: BrowserCapabilityName.PerformanceSource,
      eventType: BrowserPerformanceMetricName.Lcp,
    });
    return next;
  }
  const result = callMethod(entryList.value, list, []);
  if (!result.ok || !Array.isArray(result.value)) return next;
  for (const raw of result.value) {
    const renderTime = readFiniteNumber(raw, 'renderTime') ?? readFiniteNumber(raw, 'loadTime');
    const startTime = readFiniteNumber(raw, 'startTime');
    if (renderTime === null || renderTime <= 0 || startTime === null) continue;
    if (next === null || renderTime > next.renderTime) {
      next = { renderTime, startTime };
    }
  }
  return next;
}
```

- 收尾（unsubscribe/destroy/销毁）：若候选存在，`notify({ metricName: 'lcp', value: Math.round(候选.renderTime), unit: 'millisecond', startedAt: Math.round(timeOrigin + 候选.startTime) })`；
- 最后一个订阅者取消时对 LCP observer 执行 `disconnect()`。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @aurora/browser exec vitest run test/performance-source.test.ts`
Expected: PASS。

- [ ] **Step 5: 相关回归**

Run: `pnpm --filter @aurora/browser typecheck` 与 `pnpm --filter @aurora/browser exec vitest run test/browser-environment.test.ts`
Expected: PASS。

- [ ] **Step 6: 建议提交边界**

不执行 `git add`/`commit`。若另行授权，本 Task 边界为 LCP 状态机、observer 安装/收尾与测试。

---

### Task 4: CLS session window 状态机

**Files:**
- Modify: `packages/browser/src/performance-source.ts`
- Modify: `packages/browser/test/performance-source.test.ts`

**Interfaces:**
- Consumes: Task 3 的 observer 安装/收尾框架、`readFiniteNumber`、`readProperty`。
- Produces: CLS 事实（session window 算法）、`hadRecentInput` 过滤。

- [ ] **Step 1: 写失败的 CLS 测试**

`packages/browser/test/performance-source.test.ts` 追加（复用 Task 3 的 `hostWithObserver`，type 用 `layout-shift`）：

```ts
describe('browser performance CLS projection', () => {
  it('ignores shifts with hadRecentInput true', () => {
    // 观察 layout-shift，推送 { value: 0.1, hadRecentInput: true }，收尾后无 cls 事实
  });

  it('accumulates within a session window and emits the max session on dispose', () => {
    // 推入 { value: 0.1, hadRecentInput: false, startTime: 100 }、{ value: 0.2, ..., startTime: 150 }
    // 收尾后 cls value === 0.3（同一 session）
  });

  it('starts a new session after the 1s gap', () => {
    // session A: startTime 100、150（累计 0.3）；session B: startTime 1300（0.5）
    // 收尾后 cls value === 0.5（取最大 session）
  });

  it('caps a session at the 5s window', () => {
    // session A: startTime 100、6000 —— 6000 距 session 最后一个 100 超过 5s 且 gap 超过 1s，开启新 session
    // 收尾后取较大者
  });

  it('does not leak sources array from the entry', () => {
    // entry 含 sources: [{ node: { id: 'secret' } }]，收尾后 JSON.stringify 不含 'secret'
  });
});
```

每测试完整断言：收尾（unsubscribe）后 `facts` 中含一条 `cls`，`unit === 'ratio'`，`value` 为期望值。

- [ ] **Step 2: 运行测试确认预期失败**

Run: `pnpm --filter @aurora/browser exec vitest run test/performance-source.test.ts`
Expected: FAIL，CLS 无事实或值错误。

- [ ] **Step 3: 写最小实现**

每个订阅者记录 CLS 状态：`{ currentSessionValue: number; lastShiftStartTime: number | null; maxSessionValue: number }`。

`updateClsCandidate` 对每个计入 entry（`hadRecentInput !== true`、`value` 非负有限、`startTime` 非负有限）：

```ts
const SHIFT_GAP_MS = 1000;
const SESSION_WINDOW_MS = 5000;

function updateCls(
  state: { currentSessionValue: number; lastShiftStartTime: number | null; maxSessionValue: number },
  value: number,
  startTime: number,
): void {
  const gapOk =
    state.lastShiftStartTime === null || startTime - state.lastShiftStartTime <= SHIFT_GAP_MS;
  const windowOk =
    state.lastShiftStartTime === null ||
    startTime - state.lastShiftStartTime <= SESSION_WINDOW_MS;
  if (!gapOk || !windowOk) {
    state.maxSessionValue = Math.max(state.maxSessionValue, state.currentSessionValue);
    state.currentSessionValue = 0;
  }
  state.currentSessionValue += value;
  state.lastShiftStartTime = startTime;
}
```

- 收尾时 `finalCls = Math.max(state.currentSessionValue, state.maxSessionValue)`；若 `> 0` 发送 `{ metricName: 'cls', value: finalCls, unit: 'ratio', startedAt }`；
- 收尾后重置状态（该订阅者只发一次）。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @aurora/browser exec vitest run test/performance-source.test.ts`
Expected: PASS。

- [ ] **Step 5: 建议提交边界**

不执行 `git add`/`commit`。若另行授权，本 Task 边界为 CLS session 状态机与测试。

---

### Task 5: INP interaction 聚合状态机

**Files:**
- Modify: `packages/browser/src/performance-source.ts`
- Modify: `packages/browser/test/performance-source.test.ts`

**Interfaces:**
- Consumes: Task 3/4 的 observer 框架、`readFiniteNumber`、`readProperty`。
- Produces: INP 事实（interaction 分组、取最大时长）。

- [ ] **Step 1: 写失败的 INP 测试**

`packages/browser/test/performance-source.test.ts` 追加（观察 `['event', 'first-input']`）：

```ts
describe('browser performance INP projection', () => {
  it('aggregates multiple entries of one interaction to the longest duration', () => {
    // interactionId 42: entry1 duration 100、entry2 duration 250
    // 收尾后 inp value === 250
  });

  it('takes the max duration across interactions', () => {
    // interactionId 1: duration 120；interactionId 2: duration 300
    // 收尾后 inp value === 300
  });

  it('falls back to first-input when interactionId is missing', () => {
    // entryType 'first-input'、无 interactionId、duration 180
    // 收尾后 inp value === 180
  });

  it('ignores entries with invalid duration', () => {
    // duration -1 或 NaN 的 entry 忽略，无 inp 事实
  });

  it('does not leak target from the entry', () => {
    // entry 含 target: { id: 'secret' }，收尾后 JSON.stringify 不含 'secret'
  });
});
```

- [ ] **Step 2: 运行测试确认预期失败**

Run: `pnpm --filter @aurora/browser exec vitest run test/performance-source.test.ts`
Expected: FAIL，INP 无事实或值错误。

- [ ] **Step 3: 写最小实现**

每个订阅者记录 INP 状态：`{ currentInteractionId: number | null; currentInteractionMax: number; globalMax: number }`。

`updateInpCandidate` 对每个 entry：

```ts
function updateInp(
  state: { currentInteractionId: number | null; currentInteractionMax: number; globalMax: number },
  entryType: unknown,
  interactionId: unknown,
  duration: number,
): void {
  if (!Number.isSafeInteger(duration) || duration < 0) return;
  if (typeof interactionId === 'number' && Number.isSafeInteger(interactionId) && interactionId > 0) {
    if (state.currentInteractionId !== interactionId) {
      state.globalMax = Math.max(state.globalMax, state.currentInteractionMax);
      state.currentInteractionId = interactionId;
      state.currentInteractionMax = 0;
    }
    state.currentInteractionMax = Math.max(state.currentInteractionMax, duration);
  } else if (entryType === 'first-input') {
    state.globalMax = Math.max(state.globalMax, duration);
  }
}
```

- 收尾时 `finalInp = Math.max(state.globalMax, state.currentInteractionMax)`；若 `> 0` 发送 `{ metricName: 'inp', value: finalInp, unit: 'millisecond', startedAt }`；
- 收尾后重置状态。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @aurora/browser exec vitest run test/performance-source.test.ts`
Expected: PASS。

- [ ] **Step 5: 建议提交边界**

不执行 `git add`/`commit`。若另行授权，本 Task 边界为 INP 聚合状态机与测试。

---

### Task 6: 隔离、多实例、注册回滚与隐私边界

**Files:**
- Modify: `packages/browser/src/performance-source.ts`
- Create: `packages/browser/test/performance-source-isolation.test.ts`

**Interfaces:**
- Consumes: 全部前述指标状态机、manager。
- Produces: 隔离/多实例/回滚/隐私测试证据。

- [ ] **Step 1: 写失败的隔离与多实例测试**

`packages/browser/test/performance-source-isolation.test.ts`：

```ts
import { createPerformanceObserverManager } from '../src/performance-source.js';
import { createDiagnosticStore } from '../src/diagnostics.js';
import { describe, expect, it } from 'vitest';

describe('browser performance source isolation', () => {
  it('keeps one subscriber callback failure isolated and notifies others', () => {
    // 两个订阅者，第一个回调抛错，第二个仍收到 page_load
  });

  it('does not let one metric failure stop other metrics', () => {
    // 让 LCP observer observe 抛错（部分失败），page_load 仍产生
  });

  it('keeps two manager instances independent', () => {
    // 两个 manager + 各自 host，一个 destroy 不影响另一个
  });

  it('rejects subscribe after destroy', () => {
    // manager.destroy() 后 subscribe 返回 destroyed
  });

  it('does not mutate global PerformanceObserver or performance', () => {
    // 记录订阅前后全局 PerformanceObserver 与 performance.getEntriesByType 身份一致
  });

  it('bounds memory by not growing arrays per interaction', () => {
    // 推送大量 INP entries，断言内部状态不随数量增长（通过重复收尾/再订阅后行为验证）
  });
});
```

- [ ] **Step 2: 运行测试确认预期失败**

Run: `pnpm --filter @aurora/browser exec vitest run test/performance-source-isolation.test.ts`
Expected: FAIL，隔离/多实例/回滚行为未实现。

- [ ] **Step 3: 写最小实现**

在 `performance-source.ts` 中补齐：

- 注册时先验证 listener 为函数、未销毁；然后安装各指标 observer（LCP/CLS/INP），任一 observe 抛错时回滚该订阅者已安装的 observer 并返回 `listener_registration_failed`；page_load 失败不使订阅失败（只是无 page_load 事实）；
- 订阅者取消：逻辑停用（后续 observer 回调对该订阅者不再处理）→ 对该订阅者执行各指标收尾发送 → 若计数归零对 observer disconnect；
- destroy：对所有订阅者执行取消语义并 disconnect 全部 observer；
- observer 回调：遍历活动订阅者，对每个调用对应指标 update；单订阅者抛错记录 `callback_failed` 不中断；
- 不保留 entry/DOM 引用：所有 entry 读取立即投影为数字状态后丢弃。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @aurora/browser exec vitest run test/performance-source.test.ts test/performance-source-isolation.test.ts`
Expected: PASS。

- [ ] **Step 5: 运行覆盖率**

Run: `pnpm --filter @aurora/browser test:coverage`
Expected: PASS，lines ≥ 85 / branches ≥ 80 / functions ≥ 85 / statements ≥ 85。

- [ ] **Step 6: 建议提交边界**

不执行 `git add`/`commit`。若另行授权，本 Task 边界为隔离/回滚实现与隔离测试。

---

### Task 7: Chromium 真实浏览器、README、文档、ADR 与完整门禁

**Files:**
- Create: `packages/browser/test-browser/performance-source.spec.ts`
- Modify: `packages/browser/test-browser/fixture-server.ts`
- Modify: `packages/browser/README.md`
- Modify: `docs/architecture/sdk-architecture.md`、`docs/architecture/formalization-readiness.md`、`docs/README.md`
- Modify: `docs/adr/ADR-003-sdk-plugin-architecture.md`、`docs/adr/ADR-006-one-way-dependencies.md`
- Modify: `AGENTS.md`、`AURORA_RULES.md`、根 `README.md`

**Interfaces:**
- Consumes: 全部前述 Task 交付物。
- Produces: Chromium 证据、包入口/架构负例、README 文档契约、正式文档同步、ADR 证据与根级完整门禁。

- [ ] **Step 1: 写失败的 Chromium 测试**

`packages/browser/test-browser/performance-source.spec.ts`（使用现有 `invoke` 模式与 fixture server）：

```ts
test('produces page_load from real Navigation Timing', async ({ page }) => {
  const result = (await invoke(page, 'performancePageLoad')) as {
    facts: { metricName: string; value: number; unit: string }[];
  };
  const pageLoad = result.facts.find((f) => f.metricName === 'page_load');
  expect(pageLoad?.unit).toBe('millisecond');
  expect(typeof pageLoad?.value).toBe('number');
});

test('tracks a real LCP candidate on content render', async ({ page }) => {
  const result = (await invoke(page, 'performanceLcp')) as {
    facts: { metricName: string; value: number; unit: string }[];
  };
  const lcp = result.facts.find((f) => f.metricName === 'lcp');
  expect(lcp?.unit).toBe('millisecond');
  expect(typeof lcp?.value).toBe('number');
});

test('captures CLS from a controlled layout shift', async ({ page }) => {
  const result = (await invoke(page, 'performanceCls')) as {
    facts: { metricName: string; value: number; unit: string }[];
  };
  const cls = result.facts.find((f) => f.metricName === 'cls');
  expect(cls?.unit).toBe('ratio');
  expect(typeof cls?.value).toBe('number');
});

test('captures INP from a real interaction or reports unsupported', async ({ page }) => {
  const result = (await invoke(page, 'performanceInp')) as {
    facts: { metricName: string; value: number; unit: string }[];
    supported: boolean;
  };
  const inp = result.facts.find((f) => f.metricName === 'inp');
  if (result.supported) {
    expect(inp?.unit).toBe('millisecond');
  } else {
    expect(inp).toBeUndefined();
  }
});

test('emits final candidates on hidden and does not resend on unsubscribe', async ({ page }) => {
  const result = (await invoke(page, 'performanceHiddenAndUnsubscribe')) as {
    beforeHidden: number;
    afterHidden: number;
    afterUnsubscribe: number;
  };
  expect(result.beforeHidden).toBe(0);
  expect(result.afterHidden).toBe(1);
  expect(result.afterUnsubscribe).toBe(1); // unsubscribe 不重复发送最终候选
});

test('does not leak DOM or entries and keeps the page running', async ({ page }) => {
  const result = (await invoke(page, 'performancePrivacy')) as {
    serialized: string;
    pageStillRuns: number;
  };
  expect(result.serialized).not.toContain('secret');
  expect(result.pageStillRuns).toBe(42);
});
```

fixture-server 增加 `performance*` harness 方法，使用**事件与条件等待**（不任意 sleep）：在 harness 内用 `waitFor` 轮询订阅收到的事实集合，或通过真实渲染/交互触发后轮询。

- [ ] **Step 2: 运行 Chromium 测试确认预期失败**

Run: `pnpm --filter @aurora/browser test:browser`
Expected: FAIL，性能 harness 不存在。

- [ ] **Step 3: 实现 fixture harness 并确认通过**

在 `fixture-server.ts` 的页面模块中实现 `performancePageLoad`/`performanceLcp`/`performanceCls`/`performanceInp`/`performanceHiddenAndUnsubscribe`/`performancePrivacy` harness 方法（订阅性能源、触发真实渲染/交互、条件轮询、返回事实与隐私断言数据）。

Run: `pnpm --filter @aurora/browser test:browser`
Expected: PASS（全部 Chromium 场景，含既有 13 个）。

- [ ] **Step 4: 更新包入口与架构边界测试**

`package-entry.test.ts` 追加性能符号断言；`architecture-boundary.test.ts` 禁止项追加 `PerformanceObserver.` 之外的 `performance.` 只读校验（生产源码不得赋值 `performance.` 或 `PerformanceObserver`）。同时新增私有路径负例：`@aurora/browser/performance-source`。

Run: `pnpm --filter @aurora/browser test:package` 与 `pnpm --filter @aurora/browser exec vitest run test/architecture-boundary.test.ts`
Expected: PASS。

- [ ] **Step 5: 更新 README 与正式文档**

- `packages/browser/README.md`：追加性能观测能力章节（subscribePerformance、四项指标、不消费 buffered entries、隐私）；
- `docs/architecture/sdk-architecture.md`、`docs/architecture/formalization-readiness.md`、`docs/README.md`、根 `README.md`：记录 Browser 性能事实观测能力已实施，性能采集插件仍不存在；
- `docs/adr/ADR-003-sdk-plugin-architecture.md` 与 `docs/adr/ADR-006-one-way-dependencies.md`：追加 Browser 性能事实观测能力实施证据，保持 `accepted / in-progress`；
- `AGENTS.md` 与 `AURORA_RULES.md`：更新当前真实能力与决策队列。

- [ ] **Step 6: 根级完整质量门禁**

Run: `pnpm install --frozen-lockfile` / `pnpm format:check` / `pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm test:coverage` / `pnpm check:boundaries` / `pnpm build` / `pnpm check:ci` / `git diff --check`
Expected: 全部 PASS（exit 0）。

- [ ] **Step 7: 测量体积并记录**

Run: `node -e "const fs=require('fs'),z=require('zlib');const f=['performance-source','performance-source-types'];const r=f.map(x=>fs.readFileSync('packages/browser/dist/'+x+'.js','utf8')).join('\n');console.log('raw',Buffer.byteLength(r),'gzip',z.gzipSync(r).length);"`

Expected: 输出 raw/gzip 字节数，记录到规格第 20 节，标记 `requires-benchmark`。

- [ ] **Step 8: 建议提交边界**

不执行 `git add`/`commit`。若另行授权，本 Task 边界为 Chromium 测试、fixture harness、README、正式文档、ADR 证据、入口快照。
