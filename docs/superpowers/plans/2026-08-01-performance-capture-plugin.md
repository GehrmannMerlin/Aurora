# Performance Capture Plugin (性能采集插件第一增量) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 创建私有包 `@aurora/plugin-performance`，消费 Browser 性能事实、经 event-schema 性能正文解析器校验、通过 Core 最小草稿入口提交性能事件，完成性能监控链路。

**Architecture:** 镜像已实施 `@aurora/plugin-error`/`@aurora/plugin-request` 模式：调用方传入一个由调用方拥有的 `BrowserEnvironment`，工厂返回实现 `CorePlugin` 的插件；`start()` 通过 `browser.subscribePerformance` 订阅，`stop()`/`destroy()` 只取消自己拥有的订阅；转换器同步把 `BrowserPerformanceSourceEvent` 直通映射为性能正文候选（不重新计算指标）并调用 `parsePerformanceEventBody`，成功正文以 `{ eventType, body }` 最小草稿交给 `CorePluginContext.submitEvent`；Core 统一生成协议版本、事件 ID、事件时间。**本插件不执行任何采样**（PRD 默认 10% 采样率的算法/位置/配置未在 approved 文档定义，按用户指令留待独立规格）。

**Tech Stack:** TypeScript 6.0.3（root `strict`/`exactOptionalPropertyTypes`/`noUncheckedIndexedAccess`）、Vitest 4.1.10、@vitest/coverage-v8 4.1.10、Playwright 1.62.0（单 Chromium）、pnpm Workspace 11.17.0、Node.js ≥24.18.0。

**Plan status:** ready-for-implementation（联合模式自动审批通过；禁止 `git add`/`commit`/`push`）。

## Global Constraints

- 本包 `@aurora/plugin-performance` 是私有包，`aurora.layer: "sdk-plugin"`，`sideEffects: false`，`exports` 只有一个根入口 `.`。
- 运行时依赖恰好三个，全部 `workspace:*`：`@aurora/core`、`@aurora/browser`、`@aurora/event-schema`。只从这三个包的根入口导入，禁止 `src`/`internal`/未导出子路径。
- 不修改 Core、Browser、event-schema 的公共接口；不复制 Browser 性能观测逻辑、event-schema 校验、Core 信封创建。
- 插件不生成事件 ID、事件时间、协议版本，不创建 `EventEnvelope`，不调用 `browser.destroy()`，不在模块导入或工厂创建时订阅。
- **不执行任何采样**：不使用 `Math.random()` 或任何私有概率配置；Browser 每产生一个性能事实，插件最多提交一个对应草稿。采样作为独立后续能力记录，不阻塞本插件。
- 生产源码不得引用 DOM 全局、宿主全局、Node 运行时、`console.`，不得调用 `preventDefault()`/`stopPropagation()`/`stopImmediatePropagation()`，不得声明模块级可变状态。
- 诊断每实例最多 100 条、冻结、无敏感内容；`sequence` 从 1 独立递增。
- 覆盖率阈值 lines ≥ 85、branches ≥ 80、functions ≥ 85、statements ≥ 85，由 `packages/plugin-performance/vitest.config.ts` 固定，不得排除逻辑文件。
- 文件 kebab-case，类型/接口 PascalCase，函数/变量 camelCase，布尔值使用 `is`/`has`/`can`/`should` 前缀。禁止无说明 `any`、`Object`、`Function`、`Record<string, any>`、双重断言、非空断言、`@ts-ignore`。
- 不创建 `utils`/`helpers`/`common`/`misc`。不使用生产 `console`。
- 测试必须同时覆盖公开行为断言；Chromium 真实浏览器门禁不能被模拟 DOM 替代。
- ADR-003/005/006 保持 `accepted / in-progress`，ADR-007 保持 `accepted / implemented`，本计划不改变任何 ADR 状态。

---

## 文件树

```text
packages/plugin-performance/
├── README.md
├── package.json
├── playwright.config.ts
├── tsconfig.build.json
├── tsconfig.json
├── tsconfig.no-dom.json
├── vitest.config.ts
├── src/
│   ├── diagnostics.ts
│   ├── index.ts
│   ├── performance-capture-plugin.ts
│   ├── performance-event-converter.ts
│   └── performance-source-handler.ts
├── test/
│   ├── architecture-boundary.test.ts
│   ├── documentation-contract.test.ts
│   ├── lifecycle.test.ts
│   ├── multi-instance.test.ts
│   ├── no-dom-consumer.ts
│   ├── package-entry.test.ts
│   ├── performance-event-converter.test.ts
│   └── submission.test.ts
└── test-browser/
    ├── fixture-server.ts
    └── performance-capture-plugin.spec.ts
```

每文件单一职责：`performance-event-converter.ts` 只负责 Browser 性能事实到候选正文的直通映射与最小字段检查；`performance-source-handler.ts` 只负责重入门禁、转换分发与 Core 提交；`performance-capture-plugin.ts` 只负责工厂、生命周期、订阅所有权与诊断入口；`diagnostics.ts` 只负责有界诊断存储；`index.ts` 是唯一公开出口。

**根文件修改（跨 Task 使用）：**
- Modify `package.json`：`format:check`、`lint`、`test:coverage`、`check` 加入 `packages/plugin-performance` 路径与脚本。
- Modify `eslint.config.mjs`：新增 `packages/plugin-performance/src/**/*.ts` 的 `no-restricted-globals` 与 `no-restricted-syntax` 块（镜像 plugin-request 块），并加入类型信息覆盖块。
- Modify `README.md`（根）、`docs/README.md`、`docs/architecture/sdk-architecture.md`、`docs/architecture/formalization-readiness.md`、`AGENTS.md`、`AURORA_RULES.md`、三个 ADR 追加证据。

---

### Task 1: 包壳、配置与入口门禁

**Files:**
- Create: `packages/plugin-performance/package.json`
- Create: `packages/plugin-performance/tsconfig.json`
- Create: `packages/plugin-performance/tsconfig.build.json`
- Create: `packages/plugin-performance/tsconfig.no-dom.json`
- Create: `packages/plugin-performance/vitest.config.ts`
- Create: `packages/plugin-performance/playwright.config.ts`
- Create: `packages/plugin-performance/src/index.ts`
- Create: `packages/plugin-performance/src/diagnostics.ts`
- Create: `packages/plugin-performance/src/performance-event-converter.ts`
- Create: `packages/plugin-performance/src/performance-source-handler.ts`
- Create: `packages/plugin-performance/src/performance-capture-plugin.ts`
- Create: `packages/plugin-performance/test/package-entry.test.ts`
- Create: `packages/plugin-performance/test/architecture-boundary.test.ts`
- Create: `packages/plugin-performance/test/no-dom-consumer.ts`
- Modify: `package.json`（根）、`eslint.config.mjs`

**Interfaces:**
- Consumes: `@aurora/browser` 根出口的 `BrowserEnvironment`、`BrowserPerformanceSourceEvent`、`BrowserPerformanceMetricName`、`BrowserSubscription`；`@aurora/core` 根出口的 `CorePlugin`、`CorePluginContext`；`@aurora/event-schema` 根出口的 `EventType`、`PerformanceEventBodyParseResult`。
- Produces: 全部 `src/` 内部模块（后续 Task 依赖）：`PERFORMANCE_CAPTURE_PLUGIN_NAME`、`PerformanceCaptureDiagnosticCode`/`Operation`/`Diagnostic`、`createPerformanceCapturePlugin`、`createPerformanceSourceHandler`、`createPerformanceEventConverter`、`PerformanceBodyConversionResult`（内部，不导出）。

- [ ] **Step 1: 写失败的包入口测试**

`packages/plugin-performance/test/package-entry.test.ts`：

```ts
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

function importFromPackage(specifier: string) {
  return spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `const module = await import(${JSON.stringify(specifier)}); console.log(Object.keys(module).sort().join(','));`,
    ],
    { cwd: new URL('..', import.meta.url), encoding: 'utf8' },
  );
}

describe('built performance plugin entry', () => {
  it('loads only the declared public runtime values', () => {
    const result = importFromPackage('@aurora/plugin-performance');
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout.trim()).toBe(
      'PERFORMANCE_CAPTURE_PLUGIN_NAME,PerformanceCaptureDiagnosticCode,' +
        'PerformanceCaptureDiagnosticOperation,createPerformanceCapturePlugin',
    );
  });

  it('rejects every private or undeclared path', () => {
    for (const specifier of [
      '@aurora/plugin-performance/src/index.js',
      '@aurora/plugin-performance/internal/diagnostics.js',
      '@aurora/plugin-performance/performance-capture-plugin',
      '@aurora/plugin-performance/performance-event-converter',
    ]) {
      const result = importFromPackage(specifier);
      expect(result.status, specifier).not.toBe(0);
      expect(result.stdout, specifier).toBe('');
      expect(result.stderr, specifier).toContain('ERR_PACKAGE_PATH_NOT_EXPORTED');
    }
  });
});
```

`packages/plugin-performance/test/architecture-boundary.test.ts`：

```ts
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packageDirectory = new URL('..', import.meta.url);
const packagePath = fileURLToPath(packageDirectory);

describe('performance plugin architecture boundary', () => {
  it('is private, side-effect free, sdk-plugin, and exposes one root', async () => {
    const manifest = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    ) as {
      private?: unknown;
      sideEffects?: unknown;
      exports?: unknown;
      aurora?: unknown;
      dependencies?: unknown;
    };
    expect(manifest.private).toBe(true);
    expect(manifest.sideEffects).toBe(false);
    expect(manifest.exports).toEqual({
      '.': { types: './dist/index.d.ts', import: './dist/index.js' },
    });
    expect(manifest.aurora).toEqual({ layer: 'sdk-plugin' });
    expect(manifest.dependencies).toEqual({
      '@aurora/browser': 'workspace:*',
      '@aurora/core': 'workspace:*',
      '@aurora/event-schema': 'workspace:*',
    });
  });

  it('uses only the three package roots and no host or Node runtime', async () => {
    const sourceDirectory = new URL('../src/', import.meta.url);
    const names = (await readdir(sourceDirectory)).filter((name) => name.endsWith('.ts'));
    const source = (
      await Promise.all(names.map((name) => readFile(join(packagePath, 'src', name), 'utf8')))
    ).join('\n');
    for (const forbidden of [
      '@aurora/core/',
      '@aurora/browser/',
      '@aurora/event-schema/',
      '@aurora/plugin-error',
      '@aurora/plugin-request',
      '/src/',
      '/internal/',
      "from 'node:",
      'window.',
      'document.',
      'preventDefault(',
      'stopPropagation(',
      'stopImmediatePropagation(',
      'console.',
      'Math.random',
      'EventEnvelope',
      'CURRENT_PROTOCOL_VERSION',
      'randomUUID',
      'Date.now',
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });
});
```

`packages/plugin-performance/test/no-dom-consumer.ts`：

```ts
import type { BrowserEnvironment } from '@aurora/browser';
import {
  createPerformanceCapturePlugin,
  type PerformanceCaptureDiagnostic,
  type PerformanceCapturePlugin,
} from '../src/index.js';

declare const browser: BrowserEnvironment;
const plugin: PerformanceCapturePlugin = createPerformanceCapturePlugin(browser);
const diagnostics: readonly PerformanceCaptureDiagnostic[] = plugin.getDiagnostics();
void [plugin, diagnostics];
```

- [ ] **Step 2: 运行测试确认预期失败**

Run: `pnpm --filter @aurora/plugin-performance test:package`
Expected: FAIL，`test:package` 脚本不存在（包未创建）。

- [ ] **Step 3: 创建包壳与最小实现**

`packages/plugin-performance/package.json`：

```json
{
  "name": "@aurora/plugin-performance",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "description": "Aurora browser performance capture plugin",
  "sideEffects": false,
  "engines": {
    "node": ">=24.18.0 <25"
  },
  "aurora": {
    "layer": "sdk-plugin"
  },
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": [
    "dist",
    "README.md"
  ],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "test": "vitest run --exclude test/package-entry.test.ts",
    "test:coverage": "vitest run --coverage --exclude test/package-entry.test.ts",
    "test:package": "pnpm build && vitest run test/package-entry.test.ts",
    "test:browser": "pnpm build && playwright test --config playwright.config.ts",
    "typecheck": "tsc -p tsconfig.json --noEmit && tsc -p tsconfig.no-dom.json --noEmit"
  },
  "dependencies": {
    "@aurora/browser": "workspace:*",
    "@aurora/core": "workspace:*",
    "@aurora/event-schema": "workspace:*"
  },
  "devDependencies": {
    "@playwright/test": "1.62.0",
    "@types/node": "24.13.3",
    "@vitest/coverage-v8": "4.1.10",
    "typescript": "6.0.3",
    "vitest": "4.1.10"
  }
}
```

`tsconfig.json`/`tsconfig.build.json`/`tsconfig.no-dom.json`/`vitest.config.ts`/`playwright.config.ts` 与 `packages/plugin-request` 对应文件逐字节一致（除路径）。

`packages/plugin-performance/src/diagnostics.ts`：

```ts
import type { BrowserPerformanceMetricName } from '@aurora/browser';

const MAX_DIAGNOSTICS = 100;

export const PerformanceCaptureDiagnosticCode = Object.freeze({
  InvalidLifecycleCall: 'invalid_lifecycle_call',
  InvalidPluginContext: 'invalid_plugin_context',
  BrowserSubscriptionFailed: 'browser_subscription_failed',
  BrowserUnsubscribeFailed: 'browser_unsubscribe_failed',
  PerformanceFactInvalid: 'performance_fact_invalid',
  PerformanceSchemaRejected: 'performance_schema_rejected',
  EventSubmissionFailed: 'event_submission_failed',
  RecursiveCaptureBlocked: 'recursive_capture_blocked',
  InternalError: 'internal_error',
} as const);

export type PerformanceCaptureDiagnosticCode =
  (typeof PerformanceCaptureDiagnosticCode)[keyof typeof PerformanceCaptureDiagnosticCode];

export const PerformanceCaptureDiagnosticOperation = Object.freeze({
  Initialize: 'initialize',
  Start: 'start',
  Stop: 'stop',
  Destroy: 'destroy',
  Convert: 'convert',
  Submit: 'submit',
  Notify: 'notify',
} as const);

export type PerformanceCaptureDiagnosticOperation =
  (typeof PerformanceCaptureDiagnosticOperation)[keyof typeof PerformanceCaptureDiagnosticOperation];

export interface PerformanceCaptureDiagnostic {
  readonly sequence: number;
  readonly code: PerformanceCaptureDiagnosticCode;
  readonly operation: PerformanceCaptureDiagnosticOperation;
  readonly metricName?: BrowserPerformanceMetricName;
}

export type PerformanceCaptureDiagnosticInput = Omit<PerformanceCaptureDiagnostic, 'sequence'>;

export interface PerformanceCaptureDiagnosticStore {
  append(input: PerformanceCaptureDiagnosticInput): void;
  snapshot(): readonly PerformanceCaptureDiagnostic[];
}

export function createPerformanceCaptureDiagnosticStore(): PerformanceCaptureDiagnosticStore {
  const entries: PerformanceCaptureDiagnostic[] = [];
  let nextSequence = 1;
  return Object.freeze({
    append(input: PerformanceCaptureDiagnosticInput): void {
      entries.push(Object.freeze({ sequence: nextSequence, ...input }));
      nextSequence += 1;
      if (entries.length > MAX_DIAGNOSTICS) entries.shift();
    },
    snapshot(): readonly PerformanceCaptureDiagnostic[] {
      return Object.freeze([...entries]);
    },
  });
}
```

`packages/plugin-performance/src/performance-event-converter.ts`：

```ts
import {
  BrowserPerformanceMetricName,
  BrowserPerformanceMetricUnit,
  type BrowserPerformanceSourceEvent,
} from '@aurora/browser';
import {
  PerformanceMetricCategory,
  parsePerformanceEventBody,
  type PerformanceEventBodyParseResult,
} from '@aurora/event-schema';

export type PerformanceBodyConversionResult =
  | PerformanceEventBodyParseResult
  | { readonly success: false; readonly code: 'performance_fact_invalid' };

export function createPerformanceEventConverter() {
  const metricNames: ReadonlySet<string> = new Set(Object.values(BrowserPerformanceMetricName));
  const metricUnits: ReadonlySet<string> = new Set(Object.values(BrowserPerformanceMetricUnit));

  function convert(event: BrowserPerformanceSourceEvent): PerformanceBodyConversionResult {
    if (
      !metricNames.has(event.metricName) ||
      !metricUnits.has(event.unit) ||
      !Number.isFinite(event.value) ||
      !Number.isFinite(event.startedAt) ||
      (event.durationMs !== undefined && !Number.isFinite(event.durationMs))
    ) {
      return { success: false, code: 'performance_fact_invalid' };
    }
    const candidate: unknown = {
      metricCategory: PerformanceMetricCategory.Page,
      metricName: event.metricName,
      value: event.value,
      unit: event.unit,
      startedAt: event.startedAt,
      ...(event.durationMs === undefined ? {} : { durationMs: event.durationMs }),
    };
    return parsePerformanceEventBody(candidate);
  }
  return Object.freeze({ convert });
}
```

注意：转换器返回区分两类失败——`performance_fact_invalid`（Browser 事实字段非法，如 NaN/未知 metricName）与 `parsePerformanceEventBody` 的 issue 拒绝（如越界 CLS/缺失字段）。handler 据此分别记 `performance_fact_invalid` 与 `performance_schema_rejected` 诊断。`BrowserPerformanceMetricName`/`Unit` 的值与 event-schema 常量语义完全一致，直通后由 `parsePerformanceEventBody` 做最终校验；插件不复制枚举映射。

`packages/plugin-performance/src/performance-source-handler.ts`：

```ts
import type { BrowserPerformanceSourceEvent } from '@aurora/browser';
import type { CorePluginContext } from '@aurora/core';
import { EventType } from '@aurora/event-schema';
import {
  PerformanceCaptureDiagnosticCode,
  PerformanceCaptureDiagnosticOperation,
  type PerformanceCaptureDiagnosticStore,
} from './diagnostics.js';
import {
  createPerformanceEventConverter,
  type PerformanceBodyConversionResult,
} from './performance-event-converter.js';

export interface PerformanceSourceHandler {
  handle(event: BrowserPerformanceSourceEvent): void;
}

export function createPerformanceSourceHandler(
  submitEvent: CorePluginContext['submitEvent'],
  diagnostics: PerformanceCaptureDiagnosticStore,
): PerformanceSourceHandler {
  const converter = createPerformanceEventConverter();
  let isHandlingFact = false;

  function handle(event: BrowserPerformanceSourceEvent): void {
    if (isHandlingFact) {
      diagnostics.append({
        code: PerformanceCaptureDiagnosticCode.RecursiveCaptureBlocked,
        operation: PerformanceCaptureDiagnosticOperation.Notify,
        metricName: event.metricName,
      });
      return;
    }
    isHandlingFact = true;
    try {
      const converted: PerformanceBodyConversionResult = converter.convert(event);
      if (!converted.success) {
        const code = 'code' in converted ? converted.code : null;
        diagnostics.append({
          code:
            code === 'performance_fact_invalid'
              ? PerformanceCaptureDiagnosticCode.PerformanceFactInvalid
              : PerformanceCaptureDiagnosticCode.PerformanceSchemaRejected,
          operation: PerformanceCaptureDiagnosticOperation.Convert,
          metricName: event.metricName,
        });
        return;
      }
      const result = submitEvent({
        eventType: EventType.Performance,
        body: converted.data,
      });
      if (!result.ok) {
        diagnostics.append({
          code: PerformanceCaptureDiagnosticCode.EventSubmissionFailed,
          operation: PerformanceCaptureDiagnosticOperation.Submit,
          metricName: event.metricName,
        });
      }
    } catch {
      diagnostics.append({
        code: PerformanceCaptureDiagnosticCode.InternalError,
        operation: PerformanceCaptureDiagnosticOperation.Notify,
        metricName: event.metricName,
      });
    } finally {
      isHandlingFact = false;
    }
  }

  return Object.freeze({ handle });
}
```

`packages/plugin-performance/src/performance-capture-plugin.ts`：

```ts
import type {
  BrowserEnvironment,
  BrowserPerformanceSourceEvent,
  BrowserPerformanceSourceListener,
  BrowserSubscription,
} from '@aurora/browser';
import type { CorePlugin, CorePluginContext } from '@aurora/core';
import {
  createPerformanceCaptureDiagnosticStore,
  PerformanceCaptureDiagnosticCode,
  PerformanceCaptureDiagnosticOperation,
  type PerformanceCaptureDiagnostic,
} from './diagnostics.js';
import {
  createPerformanceSourceHandler,
  type PerformanceSourceHandler,
} from './performance-source-handler.js';

export const PERFORMANCE_CAPTURE_PLUGIN_NAME = 'performance-capture' as const;

export interface PerformanceCapturePlugin extends CorePlugin {
  readonly name: typeof PERFORMANCE_CAPTURE_PLUGIN_NAME;
  initialize(context: CorePluginContext): void;
  start(): void;
  stop(): void;
  destroy(): void;
  getDiagnostics(): readonly PerformanceCaptureDiagnostic[];
}

export function createPerformanceCapturePlugin(browser: BrowserEnvironment): PerformanceCapturePlugin {
  const diagnostics = createPerformanceCaptureDiagnosticStore();
  let handler: PerformanceSourceHandler | undefined;
  let subscription: BrowserSubscription | undefined;
  let isAcceptingEvents = false;
  let isDestroyed = false;

  const listener: BrowserPerformanceSourceListener = (event: BrowserPerformanceSourceEvent): void => {
    if (!isAcceptingEvents) return;
    handler?.handle(event);
  };

  function initialize(context: CorePluginContext): void {
    if (isDestroyed) {
      diagnostics.append({
        code: PerformanceCaptureDiagnosticCode.InvalidLifecycleCall,
        operation: PerformanceCaptureDiagnosticOperation.Initialize,
      });
      return;
    }
    if (handler !== undefined) return;
    try {
      const submitEvent = context.submitEvent;
      if (typeof submitEvent !== 'function') {
        diagnostics.append({
          code: PerformanceCaptureDiagnosticCode.InvalidPluginContext,
          operation: PerformanceCaptureDiagnosticOperation.Initialize,
        });
        return;
      }
      handler = createPerformanceSourceHandler(submitEvent, diagnostics);
    } catch {
      diagnostics.append({
        code: PerformanceCaptureDiagnosticCode.InvalidPluginContext,
        operation: PerformanceCaptureDiagnosticOperation.Initialize,
      });
    }
  }

  function start(): void {
    if (isDestroyed || handler === undefined) {
      diagnostics.append({
        code: PerformanceCaptureDiagnosticCode.InvalidLifecycleCall,
        operation: PerformanceCaptureDiagnosticOperation.Start,
      });
      return;
    }
    if (subscription !== undefined) return;
    // 性能源在订阅返回前同步发送 page_load 事实，因此先启用接收再订阅；
    // 订阅失败时回退为不接收。
    isAcceptingEvents = true;
    try {
      const result = browser.subscribePerformance(listener);
      if (!result.ok) {
        isAcceptingEvents = false;
        diagnostics.append({
          code: PerformanceCaptureDiagnosticCode.BrowserSubscriptionFailed,
          operation: PerformanceCaptureDiagnosticOperation.Start,
        });
        return;
      }
      subscription = result.subscription;
    } catch {
      isAcceptingEvents = false;
      diagnostics.append({
        code: PerformanceCaptureDiagnosticCode.BrowserSubscriptionFailed,
        operation: PerformanceCaptureDiagnosticOperation.Start,
      });
    }
  }

  function release(
    operation:
      | typeof PerformanceCaptureDiagnosticOperation.Stop
      | typeof PerformanceCaptureDiagnosticOperation.Destroy,
  ): void {
    isAcceptingEvents = false;
    const current = subscription;
    subscription = undefined;
    if (current === undefined) return;
    try {
      const result = current.unsubscribe();
      if (result.diagnosticsAdded > 0) {
        diagnostics.append({
          code: PerformanceCaptureDiagnosticCode.BrowserUnsubscribeFailed,
          operation,
        });
      }
    } catch {
      diagnostics.append({
        code: PerformanceCaptureDiagnosticCode.BrowserUnsubscribeFailed,
        operation,
      });
    }
  }

  function stop(): void {
    release(PerformanceCaptureDiagnosticOperation.Stop);
  }

  function destroy(): void {
    if (isDestroyed) return;
    release(PerformanceCaptureDiagnosticOperation.Destroy);
    handler = undefined;
    isDestroyed = true;
  }

  return Object.freeze({
    name: PERFORMANCE_CAPTURE_PLUGIN_NAME,
    initialize,
    start,
    stop,
    destroy,
    getDiagnostics: (): readonly PerformanceCaptureDiagnostic[] => diagnostics.snapshot(),
  });
}
```

`packages/plugin-performance/src/index.ts`：

```ts
export {
  PERFORMANCE_CAPTURE_PLUGIN_NAME,
  createPerformanceCapturePlugin,
  type PerformanceCapturePlugin,
} from './performance-capture-plugin.js';
export {
  PerformanceCaptureDiagnosticCode,
  PerformanceCaptureDiagnosticOperation,
} from './diagnostics.js';
export type { PerformanceCaptureDiagnostic } from './diagnostics.js';
```

- [ ] **Step 4: 安装依赖并运行测试确认通过**

Run: `pnpm install`
Expected: PASS（exit 0；新增 `@aurora/plugin-performance` 包条目，`pnpm-lock.yaml` 更新——新增包的预期变化）。

Run: `pnpm --filter @aurora/plugin-performance typecheck`
Expected: PASS（两个 tsconfig 均 Done，0 诊断）。

Run: `pnpm --filter @aurora/plugin-performance test:package`
Expected: PASS（2 个测试；根入口加载四个运行时值，私有路径全部 `ERR_PACKAGE_PATH_NOT_EXPORTED`）。

Run: `pnpm check:boundaries`
Expected: PASS（exit 0，无违规；`sdk-plugin` 允许矩阵已存在）。

Run: `pnpm lint`
Expected: PASS（eslint.config.mjs 新块生效，生产源码无宿主全局、无 `Math.random`、无 console）。

- [ ] **Step 5: 相关回归**

Run: `pnpm --filter @aurora/workspace-policy exec vitest run test/dependency-policy.test.ts test/environment.test.ts`
Expected: PASS（`sdk-plugin` 层负例继续通过）。

- [ ] **Step 6: 建议提交边界**

不执行 `git add`/`commit`。若用户另行授权提交，本 Task 边界为包壳、配置文件、`src/` 全部最小实现、入口与架构边界测试、根 package.json/eslint.config.mjs 修改。

---

### Task 2: 四项性能事实转换测试

**Files:**
- Create: `packages/plugin-performance/test/performance-event-converter.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `createPerformanceEventConverter`；Browser 根出口 `BrowserPerformanceMetricName`/`Unit`；event-schema 根出口 `parsePerformanceEventBody`。
- Produces: 四项指标直通映射、非法事实拒绝、输入不变、每事实一次提交的测试证据。

- [ ] **Step 1: 写失败的转换测试**

`packages/plugin-performance/test/performance-event-converter.test.ts`：

```ts
import {
  BrowserPerformanceMetricName,
  BrowserPerformanceMetricUnit,
  type BrowserPerformanceSourceEvent,
} from '@aurora/browser';
import { parsePerformanceEventBody } from '@aurora/event-schema';
import { describe, expect, it } from 'vitest';
import { createPerformanceEventConverter } from '../src/performance-event-converter.js';

const converter = createPerformanceEventConverter();

function fact(
  overrides: Partial<BrowserPerformanceSourceEvent> = {},
): BrowserPerformanceSourceEvent {
  return {
    metricName: BrowserPerformanceMetricName.Lcp,
    value: 2500,
    unit: BrowserPerformanceMetricUnit.Millisecond,
    startedAt: 1800000005000,
    ...overrides,
  };
}

describe('performance event converter', () => {
  it('maps all four approved metrics to valid bodies without recomputation', () => {
    const cases: ReadonlyArray<{
      readonly metricName: BrowserPerformanceSourceEvent['metricName'];
      readonly unit: BrowserPerformanceSourceEvent['unit'];
      readonly value: number;
    }> = [
      { metricName: 'lcp', unit: 'millisecond', value: 2500 },
      { metricName: 'inp', unit: 'millisecond', value: 180 },
      { metricName: 'cls', unit: 'ratio', value: 0.125 },
      { metricName: 'page_load', unit: 'millisecond', value: 3200 },
    ];
    for (const c of cases) {
      const result = converter.convert(fact({ metricName: c.metricName, unit: c.unit, value: c.value }));
      expect(result.success).toBe(true);
      if (!result.success) throw new Error(`must succeed for ${c.metricName}`);
      expect(result.data).toMatchObject({
        metricCategory: 'page',
        metricName: c.metricName,
        value: c.value,
        unit: c.unit,
        startedAt: 1800000005000,
      });
      expect(parsePerformanceEventBody(result.data).success).toBe(true);
    }
  });

  it('preserves the optional durationMs when present', () => {
    const result = converter.convert(fact({ metricName: 'page_load', durationMs: 3400 }));
    expect(result.success).toBe(true);
    if (!result.success) throw new Error('must succeed');
    expect(result.data.durationMs).toBe(3400);
  });

  it('omits durationMs when undefined', () => {
    const result = converter.convert(fact());
    expect(result.success).toBe(true);
    if (!result.success) throw new Error('must succeed');
    expect('durationMs' in result.data).toBe(false);
  });

  it('does not modify the input fact', () => {
    const input = fact();
    const snapshot = JSON.stringify(input);
    converter.convert(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('rejects invalid metric names and units', () => {
    expect(converter.convert(fact({ metricName: 'fcp' as never })).success).toBe(false);
    expect(converter.convert(fact({ unit: 'second' as never })).success).toBe(false);
  });

  it('rejects NaN, Infinity, and negative values through the schema', () => {
    expect(converter.convert(fact({ value: Number.NaN })).success).toBe(false);
    expect(converter.convert(fact({ value: Number.POSITIVE_INFINITY })).success).toBe(false);
    expect(converter.convert(fact({ value: -1 })).success).toBe(false);
  });

  it('rejects out-of-range CLS through the schema', () => {
    expect(converter.convert(fact({ metricName: 'cls', unit: 'ratio', value: 1.5 })).success).toBe(false);
  });

  it('rejects missing startedAt through the schema', () => {
    expect(converter.convert(fact({ startedAt: 0 })).success).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试确认预期失败**

Run: `pnpm --filter @aurora/plugin-performance exec vitest run test/performance-event-converter.test.ts`
Expected: FAIL（若 Task 1 转换器已实现则直接 PASS；若未实现则 `../src/performance-event-converter.js` 缺失）。

- [ ] **Step 3: 确认转换测试通过**

Run: `pnpm --filter @aurora/plugin-performance exec vitest run test/performance-event-converter.test.ts`
Expected: PASS（Task 1 的最小转换器已满足全部断言）。

- [ ] **Step 4: 建议提交边界**

不执行 `git add`/`commit`。若另行授权，本 Task 边界为转换测试文件。

---

### Task 3: 生命周期、提交、失败隔离与防重入测试

**Files:**
- Create: `packages/plugin-performance/test/lifecycle.test.ts`
- Create: `packages/plugin-performance/test/submission.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `createPerformanceCapturePlugin`、`createPerformanceSourceHandler`、`createPerformanceCaptureDiagnosticStore`、诊断码；Browser 根出口 `BrowserSubscription`、`BrowserPerformanceSourceEvent`；core 根出口 `CoreEventDraftResult`。
- Produces: 生命周期、订阅失败回滚、释放失败隔离、Core 失败隔离、防重入门禁测试证据。

- [ ] **Step 1: 写失败的生命周期测试**

`packages/plugin-performance/test/lifecycle.test.ts`（镜像 plugin-request 的 `lifecycle.test.ts`，把 `subscribeRequests` 换成 `subscribePerformance`，`requestFact` 换成 `performanceFact`）：

- `subscribes once, stops once, restarts, and destroys without owning Browser`；
- `records failed subscription and allows a later retry`；
- `never restarts after destroy and returns immutable diagnostic copies`；
- `ignores retained host callbacks after stop and after destroy`；
- `deactivates before an unsubscribe exception and records no sensitive text`。

`performanceFact` 构造：

```ts
function performanceFact(): BrowserPerformanceSourceEvent {
  return {
    metricName: 'lcp',
    value: 2500,
    unit: 'millisecond',
    startedAt: 1800000005000,
  };
}
```

- [ ] **Step 2: 运行生命周期测试确认预期失败**

Run: `pnpm --filter @aurora/plugin-performance exec vitest run test/lifecycle.test.ts`
Expected: FAIL（`createPerformanceCapturePlugin` 未从包根导出或行为不匹配）。

- [ ] **Step 3: 确认生命周期测试通过**

Run: `pnpm --filter @aurora/plugin-performance exec vitest run test/lifecycle.test.ts`
Expected: PASS。

- [ ] **Step 4: 写失败的提交与防重入测试**

`packages/plugin-performance/test/submission.test.ts`（镜像 plugin-request 的 `submission.test.ts`）：

- `submits each performance fact exactly once as an exact validated Core draft`：草稿只含 `['eventType', 'body']`，`eventType === EventType.Performance`，body 通过 `parsePerformanceEventBody`，无 `eventId`/`occurredAt`/`protocolVersion`；
- `does not submit invalid performance facts`：`{ startedAt: 0 }` 等非法事实 → `performance_schema_rejected` 诊断，不提交；
- `records a Core failure and submits the next fact`：Core 首次返回 `not_started`、二次 `accepted` → 一条 `event_submission_failed` 诊断，两次提交；
- `blocks synchronous recursion without suppressing the next independent fact`：submitEvent 内嵌套 `handler.handle(...)` → `recursive_capture_blocked` 诊断，外层调用次数正确；
- `maps metric names into diagnostics`：`performance_fact_invalid` 诊断含 metricName。

- [ ] **Step 5: 运行提交测试确认预期失败**

Run: `pnpm --filter @aurora/plugin-performance exec vitest run test/submission.test.ts`
Expected: FAIL（`../src/performance-source-handler.js` 未导出或行为不匹配）。

- [ ] **Step 6: 确认全部单元测试通过**

Run: `pnpm --filter @aurora/plugin-performance test`
Expected: PASS（全部测试文件）。

Run: `pnpm --filter @aurora/plugin-performance test:coverage`
Expected: PASS，lines ≥ 85 / branches ≥ 80 / functions ≥ 85 / statements ≥ 85。

- [ ] **Step 7: 相关回归**

Run: `pnpm --filter @aurora/plugin-error test` 与 `pnpm --filter @aurora/plugin-request test`
Expected: PASS（相邻插件不受影响）。

- [ ] **Step 8: 建议提交边界**

不执行 `git add`/`commit`。若另行授权，本 Task 边界为生命周期与提交测试文件。

---

### Task 4: 多实例、三插件共存与架构负例

**Files:**
- Create: `packages/plugin-performance/test/multi-instance.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `createPerformanceCapturePlugin`、`createPerformanceCaptureDiagnosticStore`；plugin-error/plugin-request 的工厂。
- Produces: 多实例隔离、三插件共存、不交叉释放订阅的测试证据。

- [ ] **Step 1: 写失败的多实例与共存测试**

`packages/plugin-performance/test/multi-instance.test.ts`：

- `does not cross-remove instances sharing one BrowserEnvironment`：两实例共享 mock Browser，各订阅性能，一实例 destroy 后另一实例仍收事实；
- `keeps diagnostics and submit failures instance-local`：一个实例 submitEvent 抛错，另一实例诊断为空；
- `never calls BrowserEnvironment.destroy`：destroy 后 `fixture.browser.destroy` 未被调用；
- `coexists with plugin-error and plugin-request on one BrowserEnvironment`：三插件各订阅自己的源（performance/error/request），dispatch 各自事实后互不影响，性能插件不释放错误源/请求源订阅；
- `does not use global state`：多次创建插件实例后各自独立。

- [ ] **Step 2: 运行多实例测试确认预期失败**

Run: `pnpm --filter @aurora/plugin-performance exec vitest run test/multi-instance.test.ts`
Expected: FAIL（多实例/共存行为未实现或断言不匹配）。

- [ ] **Step 3: 确认多实例测试通过**

Run: `pnpm --filter @aurora/plugin-performance test`
Expected: PASS。

- [ ] **Step 4: 运行覆盖率**

Run: `pnpm --filter @aurora/plugin-performance test:coverage`
Expected: PASS，全部阈值满足。

- [ ] **Step 5: 建议提交边界**

不执行 `git add`/`commit`。若另行授权，本 Task 边界为多实例/共存测试文件。

---

### Task 5: Chromium 真实浏览器端到端验证

**Files:**
- Create: `packages/plugin-performance/test-browser/fixture-server.ts`
- Create: `packages/plugin-performance/test-browser/performance-capture-plugin.spec.ts`

**Interfaces:**
- Consumes: Task 1 的 `createPerformanceCapturePlugin`；Browser 根出口 `createBrowserEnvironment`；core 根出口 `createCore`；event-schema 根出口 `parsePerformanceEventEnvelope`；plugin-error/plugin-request 工厂。fixture server 使用 import map 映射五个包根到各自 `dist/index.js`。
- Produces: Chromium 真实浏览器证据（page_load/LCP/CLS/INP 提交、每事实一次、Core 系统字段、stop/destroy 释放、三插件共存、隐私不泄露）。

- [ ] **Step 1: 写失败的 fixture-server 与 spec**

`packages/plugin-performance/test-browser/fixture-server.ts` 镜像 plugin-request 的 fixture（`createStartedHarness` 用 `subscribePerformance`），harness 方法：

- `performancePageLoad`：订阅后返回 page_load 草稿；
- `performanceLcp`：插入真实文本内容触发 LCP，收尾后返回草稿；
- `performanceCls`：已有内容 + prepend 触发可靠 CLS（参照 browser 性能 fixture 的触发模式），收尾后返回草稿；
- `performanceInp`：真实交互触发 INP 或返回 unsupported；
- `performanceStopNoSubmit`：stop 后触发事实不提交；
- `performanceThreePlugins`：plugin-error + plugin-request + plugin-performance 同时运行；
- `performancePrivacy`：触发事实后断言序列化不含 `secret`。

`packages/plugin-performance/test-browser/performance-capture-plugin.spec.ts` 镜像 plugin-request 的 spec，断言：

- page_load 提交且 `parsePerformanceEventEnvelope` 通过；
- LCP/CLS 提交且 body 合法；
- INP 提交或按 Browser 规格处理；
- 每个最终性能事实只提交一次；
- Core 生成 `eventId`/`occurredAt`/`protocolVersion`；
- stop 后不再提交，destroy 后订阅释放；
- 三插件共存；
- 不泄露 DOM/entry/URL/用户输入。

- [ ] **Step 2: 运行 Chromium 测试确认预期失败**

Run: `pnpm --filter @aurora/plugin-performance test:browser`
Expected: FAIL（harness 或插件未实现）。

- [ ] **Step 3: 实现 fixture harness 并确认通过**

按 browser 性能 fixture 的可靠触发模式实现 harness（真实文本内容触发 LCP、已有内容 + prepend 触发 CLS），用条件等待避免任意 sleep。

Run: `pnpm --filter @aurora/plugin-performance test:browser`
Expected: PASS（全部场景）。

- [ ] **Step 4: 相关回归**

Run: `pnpm --filter @aurora/browser test:browser` 与 `pnpm --filter @aurora/plugin-request test:browser`
Expected: PASS（上游 Chromium 不受影响）。

- [ ] **Step 5: 建议提交边界**

不执行 `git add`/`commit`。若另行授权，本 Task 边界为 fixture-server、Chromium 测试。

---

### Task 6: README、正式文档、ADR 证据与入口快照

**Files:**
- Create: `packages/plugin-performance/README.md`
- Create: `packages/plugin-performance/test/documentation-contract.test.ts`
- Modify: `docs/adr/ADR-003-sdk-plugin-architecture.md`、`docs/adr/ADR-005-event-schema-source-of-truth.md`、`docs/adr/ADR-006-one-way-dependencies.md`
- Modify: `docs/README.md`、`docs/architecture/sdk-architecture.md`、`docs/architecture/formalization-readiness.md`、根 `README.md`、`AGENTS.md`、`AURORA_RULES.md`

**Interfaces:**
- Consumes: 全部前述 Task 交付物。
- Produces: 包 README、文档契约测试、正式文档同步、ADR 证据与入口快照。

- [ ] **Step 1: 写失败的文档契约测试**

`packages/plugin-performance/test/documentation-contract.test.ts` 断言 README 包含：
- `import { createBrowserEnvironment } from '@aurora/browser';`、`import { createCore } from '@aurora/core';`、`import { createPerformanceCapturePlugin } from '@aurora/plugin-performance';`、`core.registerPlugin(performancePlugin);`、生命周期命令；
- `不生成事件 ID、时间或协议版本`、`不实现采样、队列、传输、重试或持久化`；
- 并通过真实 `createCore()` 执行完整生命周期。

- [ ] **Step 2: 创建 README 并确认文档契约通过**

`packages/plugin-performance/README.md`：职责（消费 `subscribePerformance` 四项性能事实、经 `parsePerformanceEventBody` 校验、Core 草稿提交）、公开 API（`createPerformanceCapturePlugin` 等四个运行时值）、边界（不采样、不重新计算指标、不创建 EventEnvelope、不调用 browser.destroy、不读取 DOM/entry/URL）。

Run: `pnpm --filter @aurora/plugin-performance exec vitest run test/documentation-contract.test.ts`
Expected: PASS。

- [ ] **Step 3: 追加 ADR 实施证据**

- `docs/adr/ADR-003-sdk-plugin-architecture.md`：性能采集插件第一增量实施证据（订阅/转换/提交/生命周期/防重入/多实例/Chromium），保持 `accepted / in-progress`；
- `docs/adr/ADR-005-event-schema-source-of-truth.md`：性能插件真实协议消费者证据，保持 `accepted / in-progress`；
- `docs/adr/ADR-006-one-way-dependencies.md`：`sdk-plugin` 依赖矩阵与私有入口证据，保持 `accepted / in-progress`。

- [ ] **Step 4: 同步正式文档与入口**

- `docs/README.md`：性能采集插件条目加入正式文档索引；
- `docs/architecture/sdk-architecture.md`：性能插件已实施，采样/传输仍不存在；
- `docs/architecture/formalization-readiness.md`：性能链路模块状态更新为已实施，剩余模块统计更新；
- 根 `README.md`、`AGENTS.md`、`AURORA_RULES.md`：更新当前真实包与决策队列。

- [ ] **Step 5: 建议提交边界**

不执行 `git add`/`commit`。若另行授权，本 Task 边界为 README、文档契约测试、正式文档、ADR 证据、入口快照。

---

### Task 7: 根级完整质量门禁与体积测量

**Files:**
- 无新增；运行全量验证。

- [ ] **Step 1: 根级完整质量门禁**

Run: `pnpm install --frozen-lockfile` / `pnpm format:check` / `pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm test:coverage` / `pnpm check:boundaries` / `pnpm build` / `pnpm check:ci` / `git diff --check`
Expected: 全部 PASS（exit 0）。

- [ ] **Step 2: 测量体积并记录**

Run: `node -e "const fs=require('fs'),z=require('zlib');const f=['diagnostics','index','performance-capture-plugin','performance-event-converter','performance-source-handler'];const r=f.map(x=>fs.readFileSync('packages/plugin-performance/dist/'+x+'.js','utf8')).join('\n');console.log('raw',Buffer.byteLength(r),'gzip',z.gzipSync(r).length);"`

Expected: 输出 raw/gzip 字节数，与单插件 8 KiB gzip 预算比较；标记 `requires-benchmark`。

- [ ] **Step 3: 更新规格实施状态**

规格 `docs/sdk/performance-capture-plugin.md` 的 `implementation-status` 更新为 `implemented`，追加实施证据。

- [ ] **Step 4: 建议提交边界**

不执行 `git add`/`commit`。若另行授权，本 Task 边界为规格状态更新与全量门禁相关文件。
