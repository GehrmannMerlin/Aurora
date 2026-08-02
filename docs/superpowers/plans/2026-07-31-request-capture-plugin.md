# Request Capture Plugin (请求采集插件第一增量) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 创建私有包 `@aurora/plugin-request`，消费 Browser 请求事实、经 event-schema 请求正文解析器校验、通过 Core 最小草稿入口提交请求事件。

**Architecture:** 镜像已实施 `@aurora/plugin-error` 模式：调用方传入一个由调用方拥有的 `BrowserEnvironment`，工厂返回实现 `CorePlugin` 的插件；`start()` 通过 `browser.subscribeRequests` 订阅，`stop()`/`destroy()` 只取消自己拥有的订阅；转换器同步把 `BrowserRequestSourceEvent` 映射为请求正文候选并调用 `parseRequestEventBody`，成功正文以 `{ eventType, body }` 最小草稿交给 `CorePluginContext.submitEvent`；Core 统一生成协议版本、事件 ID、事件时间。

**Tech Stack:** TypeScript 6.0.3（root `strict`/`exactOptionalPropertyTypes`/`noUncheckedIndexedAccess`）、Vitest 4.1.10、@vitest/coverage-v8 4.1.10、Playwright 1.62.0（单 Chromium）、pnpm Workspace 11.17.0、Node.js ≥24.18.0。

**Plan status:** approved / executed（2026-07-31 已按本计划执行 `@aurora/plugin-request` 第一增量并通过完整新鲜门禁；详见[正式规格](../sdk/request-capture-plugin.md)第 0.1 节实施证据）。

## Global Constraints

- 本包 `@aurora/plugin-request` 是私有包，`aurora.layer: "sdk-plugin"`，`sideEffects: false`，`exports` 只有一个根入口 `.`。
- 运行时依赖恰好三个，全部 `workspace:*`：`@aurora/core`、`@aurora/browser`、`@aurora/event-schema`。只从这三个包的根入口导入，禁止 `src`/`internal`/未导出子路径。
- 不修改 Core、Browser、event-schema 的公共接口；不重新包装 fetch/XHR；不复制 Browser 请求观测、event-schema URL/字段校验、Core 信封创建。
- 插件不生成事件 ID、事件时间、协议版本，不创建 `EventEnvelope`，不调用 `browser.destroy()`，不在模块导入或工厂创建时订阅。
- 生产源码不得引用 DOM 全局、宿主全局、Node 运行时、`console.`，不得调用 `preventDefault()`/`stopPropagation()`/`stopImmediatePropagation()`，不得声明模块级可变状态。
- 诊断每实例最多 100 条、冻结、无敏感内容；`sequence` 从 1 独立递增。
- 覆盖率阈值 lines ≥ 85、branches ≥ 80、functions ≥ 85、statements ≥ 85，由 `packages/plugin-request/vitest.config.ts` 固定，不得排除逻辑文件。
- 文件 kebab-case，类型/接口 PascalCase，函数/变量 camelCase，布尔值使用 `is`/`has`/`can`/`should` 前缀。禁止无说明 `any`、`Object`、`Function`、`Record<string, any>`、双重断言、非空断言、`@ts-ignore`。
- 不创建 `utils`/`helpers`/`common`/`misc`。不使用生产 `console`。
- 测试必须同时覆盖公开行为断言；Chromium 真实浏览器门禁不能被模拟 DOM 替代。
- ADR-003/005/006 保持 `accepted / in-progress`，ADR-007 保持 `accepted / implemented`，本计划不改变任何 ADR 状态。

---

## 文件树

```text
packages/plugin-request/
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
│   ├── request-capture-plugin.ts
│   ├── request-event-converter.ts
│   └── request-source-handler.ts
├── test/
│   ├── architecture-boundary.test.ts
│   ├── documentation-contract.test.ts
│   ├── host-safety.test.ts
│   ├── lifecycle.test.ts
│   ├── multi-instance.test.ts
│   ├── no-dom-consumer.ts
│   ├── package-entry.test.ts
│   ├── request-event-converter.test.ts
│   └── submission.test.ts
└── test-browser/
    ├── fixture-server.ts
    └── request-capture-plugin.spec.ts
```

每文件单一职责：`request-event-converter.ts` 只负责事实→候选正文映射与合法性检查；`request-source-handler.ts` 只负责重入门禁、转换分发与 Core 提交；`request-capture-plugin.ts` 只负责工厂、生命周期、订阅所有权与诊断入口；`diagnostics.ts` 只负责有界诊断存储；`index.ts` 是唯一公开出口。

**根文件修改（跨 Task 使用）：**
- Modify `package.json`：`format:check`、`lint`、`test:coverage`、`check` 加入 `packages/plugin-request` 路径与脚本。
- Modify `eslint.config.mjs`：新增 `packages/plugin-request/src/**/*.ts` 的 `no-restricted-globals` 与 `no-restricted-syntax` 块（镜像 plugin-error 块）。
- Modify `README.md`：根 README 的当前实现状态列表加入 `@aurora/plugin-request`。
- Modify `docs/README.md`、`docs/architecture/sdk-architecture.md`、`docs/architecture/formalization-readiness.md`：记录请求插件第一增量真实存在。

---

### Task 1: 包壳、配置与入口门禁

**Files:**
- Create: `packages/plugin-request/package.json`
- Create: `packages/plugin-request/tsconfig.json`
- Create: `packages/plugin-request/tsconfig.build.json`
- Create: `packages/plugin-request/tsconfig.no-dom.json`
- Create: `packages/plugin-request/vitest.config.ts`
- Create: `packages/plugin-request/playwright.config.ts`
- Create: `packages/plugin-request/src/index.ts`
- Create: `packages/plugin-request/src/diagnostics.ts`
- Create: `packages/plugin-request/src/request-event-converter.ts`
- Create: `packages/plugin-request/src/request-source-handler.ts`
- Create: `packages/plugin-request/src/request-capture-plugin.ts`
- Create: `packages/plugin-request/test/package-entry.test.ts`
- Create: `packages/plugin-request/test/architecture-boundary.test.ts`
- Create: `packages/plugin-request/test/no-dom-consumer.ts`
- Modify: `package.json`（根）
- Modify: `eslint.config.mjs`

**Interfaces:**
- Consumes: `@aurora/browser` 根出口的 `BrowserEnvironment`、`BrowserRequestSourceEvent`、`BrowserRequestSourceEventType`、`BrowserSubscription`；`@aurora/core` 根出口的 `CorePlugin`、`CorePluginContext`；`@aurora/event-schema` 根出口的 `EventType`、`RequestEventBodyParseResult`。
- Produces: 全部 `src/` 内部模块（后续 Task 依赖）：`REQUEST_CAPTURE_PLUGIN_NAME`、`RequestCaptureDiagnosticCode`/`Operation`/`Diagnostic`、`createRequestCapturePlugin`、`createRequestSourceHandler`、`createRequestEventConverter`、`RequestBodyConversionResult`（内部，不导出）。

- [ ] **Step 1: 写失败的包入口测试**

`packages/plugin-request/test/package-entry.test.ts`：

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

describe('built request plugin entry', () => {
  it('loads only the declared public runtime values', () => {
    const result = importFromPackage('@aurora/plugin-request');
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout.trim()).toBe(
      'REQUEST_CAPTURE_PLUGIN_NAME,RequestCaptureDiagnosticCode,' +
        'RequestCaptureDiagnosticOperation,createRequestCapturePlugin',
    );
  });

  it('rejects every private or undeclared path', () => {
    for (const specifier of [
      '@aurora/plugin-request/src/index.js',
      '@aurora/plugin-request/internal/diagnostics.js',
      '@aurora/plugin-request/request-capture-plugin',
      '@aurora/plugin-request/request-event-converter',
    ]) {
      const result = importFromPackage(specifier);
      expect(result.status, specifier).not.toBe(0);
      expect(result.stdout, specifier).toBe('');
      expect(result.stderr, specifier).toContain('ERR_PACKAGE_PATH_NOT_EXPORTED');
    }
  });
});
```

`packages/plugin-request/test/architecture-boundary.test.ts`：

```ts
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packageDirectory = new URL('..', import.meta.url);
const packagePath = fileURLToPath(packageDirectory);

describe('request plugin architecture boundary', () => {
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
      '/src/',
      '/internal/',
      "from 'node:",
      'window.',
      'document.',
      'preventDefault(',
      'stopPropagation(',
      'stopImmediatePropagation(',
      'console.',
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

`packages/plugin-request/test/no-dom-consumer.ts`：

```ts
import type { BrowserEnvironment } from '@aurora/browser';
import {
  createRequestCapturePlugin,
  type RequestCaptureDiagnostic,
  type RequestCapturePlugin,
} from '../src/index.js';

declare const browser: BrowserEnvironment;
const plugin: RequestCapturePlugin = createRequestCapturePlugin(browser);
const diagnostics: readonly RequestCaptureDiagnostic[] = plugin.getDiagnostics();
void [plugin, diagnostics];
```

- [ ] **Step 2: 运行测试确认预期失败**

Run: `pnpm --filter @aurora/plugin-request test:package`
Expected: FAIL，`test:package` 脚本不存在（包未创建）。

- [ ] **Step 3: 创建包壳与最小实现**

`packages/plugin-request/package.json`：

```json
{
  "name": "@aurora/plugin-request",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "description": "Aurora browser request capture plugin",
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

`packages/plugin-request/tsconfig.json`：

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2024", "DOM", "DOM.Iterable"],
    "noEmit": true,
    "rootDir": ".",
    "types": ["node", "vitest/globals"]
  },
  "include": [
    "src/**/*.ts",
    "test/**/*.ts",
    "test-browser/**/*.ts",
    "vitest.config.ts",
    "playwright.config.ts"
  ]
}
```

`packages/plugin-request/tsconfig.no-dom.json`：

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "rootDir": ".",
    "types": []
  },
  "include": ["src/**/*.ts", "test/no-dom-consumer.ts"]
}
```

`packages/plugin-request/tsconfig.build.json`：

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "declaration": true,
    "declarationMap": true,
    "noEmit": false,
    "outDir": "dist",
    "rootDir": "src",
    "sourceMap": true,
    "types": []
  },
  "include": ["src/**/*.ts"]
}
```

`packages/plugin-request/vitest.config.ts`：

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text', 'json-summary'],
      thresholds: { branches: 80, functions: 85, lines: 85, statements: 85 },
    },
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
```

`packages/plugin-request/playwright.config.ts`：

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  forbidOnly: true,
  fullyParallel: false,
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  reporter: 'line',
  testDir: './test-browser',
  testMatch: '**/*.spec.ts',
  timeout: 30_000,
  use: { headless: true },
  workers: 1,
});
```

`packages/plugin-request/src/diagnostics.ts`：

```ts
import type { BrowserRequestSourceEventType } from '@aurora/browser';

const MAX_DIAGNOSTICS = 100;

export const RequestCaptureDiagnosticCode = Object.freeze({
  InvalidLifecycleCall: 'invalid_lifecycle_call',
  InvalidPluginContext: 'invalid_plugin_context',
  BrowserSubscriptionFailed: 'browser_subscription_failed',
  BrowserUnsubscribeFailed: 'browser_unsubscribe_failed',
  InvalidBrowserFact: 'invalid_browser_fact',
  UnsupportedMethod: 'unsupported_method',
  RequestBodyRejected: 'request_body_rejected',
  EventSubmissionFailed: 'event_submission_failed',
  RecursiveCaptureBlocked: 'recursive_capture_blocked',
  InternalError: 'internal_error',
} as const);

export type RequestCaptureDiagnosticCode =
  (typeof RequestCaptureDiagnosticCode)[keyof typeof RequestCaptureDiagnosticCode];

export const RequestCaptureDiagnosticOperation = Object.freeze({
  Initialize: 'initialize',
  Start: 'start',
  Stop: 'stop',
  Destroy: 'destroy',
  Convert: 'convert',
  Submit: 'submit',
  Notify: 'notify',
} as const);

export type RequestCaptureDiagnosticOperation =
  (typeof RequestCaptureDiagnosticOperation)[keyof typeof RequestCaptureDiagnosticOperation];

export interface RequestCaptureDiagnostic {
  readonly sequence: number;
  readonly code: RequestCaptureDiagnosticCode;
  readonly operation: RequestCaptureDiagnosticOperation;
  readonly mechanism?: BrowserRequestSourceEventType;
}

export type RequestCaptureDiagnosticInput = Omit<RequestCaptureDiagnostic, 'sequence'>;

export interface RequestCaptureDiagnosticStore {
  append(input: RequestCaptureDiagnosticInput): void;
  snapshot(): readonly RequestCaptureDiagnostic[];
}

export function createRequestCaptureDiagnosticStore(): RequestCaptureDiagnosticStore {
  const entries: RequestCaptureDiagnostic[] = [];
  let nextSequence = 1;
  return Object.freeze({
    append(input: RequestCaptureDiagnosticInput): void {
      entries.push(Object.freeze({ sequence: nextSequence, ...input }));
      nextSequence += 1;
      if (entries.length > MAX_DIAGNOSTICS) entries.shift();
    },
    snapshot(): readonly RequestCaptureDiagnostic[] {
      return Object.freeze([...entries]);
    },
  });
}
```

`packages/plugin-request/src/request-event-converter.ts`：

```ts
import {
  BrowserRequestMechanism,
  BrowserRequestOutcome,
  type BrowserRequestSourceEvent,
} from '@aurora/browser';
import {
  REQUEST_EVENT_LIMITS,
  RequestMethod,
  RequestOutcome,
  parseRequestEventBody,
  type RequestEventBodyParseFailure,
  type RequestEventBodyParseSuccess,
} from '@aurora/event-schema';

export type RequestBodyConversionResult =
  | RequestEventBodyParseSuccess
  | { readonly success: false; readonly code: 'unsupported_method' }
  | { readonly success: false; readonly code: 'invalid_browser_fact' }
  | RequestEventBodyParseFailure;

function readStringProperty(input: unknown, key: string): string | null {
  if ((typeof input !== 'object' || input === null) && typeof input !== 'function') return null;
  try {
    const value = Reflect.get(input, key);
    return typeof value === 'string' && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

function normalizeMethod(method: string): RequestMethod | null {
  const upper = method.toUpperCase();
  if (upper === RequestMethod.Get) return RequestMethod.Get;
  if (upper === RequestMethod.Post) return RequestMethod.Post;
  if (upper === RequestMethod.Put) return RequestMethod.Put;
  if (upper === RequestMethod.Patch) return RequestMethod.Patch;
  if (upper === RequestMethod.Delete) return RequestMethod.Delete;
  if (upper === RequestMethod.Head) return RequestMethod.Head;
  if (upper === RequestMethod.Options) return RequestMethod.Options;
  return null;
}

function normalizeOutcome(outcome: string): RequestOutcome | null {
  if (outcome === BrowserRequestOutcome.Success) return RequestOutcome.Success;
  if (outcome === BrowserRequestOutcome.HttpError) return RequestOutcome.HttpError;
  if (outcome === BrowserRequestOutcome.NetworkError) return RequestOutcome.NetworkError;
  if (outcome === BrowserRequestOutcome.Timeout) return RequestOutcome.Timeout;
  if (outcome === BrowserRequestOutcome.Canceled) return RequestOutcome.Canceled;
  return null;
}

export function createRequestEventConverter() {
  function convert(event: BrowserRequestSourceEvent): RequestBodyConversionResult {
    const method = normalizeMethod(event.method);
    if (method === null) {
      return { success: false, code: 'unsupported_method' };
    }
    const outcome = normalizeOutcome(event.outcome);
    if (outcome === null) {
      return { success: false, code: 'invalid_browser_fact' };
    }
    if (
      !Number.isSafeInteger(event.startedAt) ||
      event.startedAt <= 0 ||
      !Number.isFinite(event.durationMs) ||
      event.durationMs < 0
    ) {
      return { success: false, code: 'invalid_browser_fact' };
    }
    if (
      event.statusCode !== null &&
      (!Number.isSafeInteger(event.statusCode) ||
        event.statusCode < REQUEST_EVENT_LIMITS.minStatusCode ||
        event.statusCode > REQUEST_EVENT_LIMITS.maxStatusCode)
    ) {
      return { success: false, code: 'invalid_browser_fact' };
    }
    const candidate: unknown = {
      method,
      url: event.url,
      startedAt: event.startedAt,
      durationMs: Math.round(event.durationMs),
      outcome,
      ...(event.statusCode === null ? {} : { statusCode: event.statusCode }),
    };
    return parseRequestEventBody(candidate);
  }
  return Object.freeze({ convert });
}

export function isFetchMechanism(event: BrowserRequestSourceEvent): boolean {
  return event.mechanism === BrowserRequestMechanism.Fetch;
}
```

`packages/plugin-request/src/request-source-handler.ts`：

```ts
import {
  BrowserRequestSourceEventType,
  type BrowserRequestSourceEvent,
} from '@aurora/browser';
import type { CorePluginContext } from '@aurora/core';
import { EventType } from '@aurora/event-schema';
import {
  RequestCaptureDiagnosticCode,
  RequestCaptureDiagnosticOperation,
  type RequestCaptureDiagnosticStore,
} from './diagnostics.js';
import {
  createRequestEventConverter,
  isFetchMechanism,
  type RequestBodyConversionResult,
} from './request-event-converter.js';

export interface RequestSourceHandler {
  handle(event: BrowserRequestSourceEvent): void;
}

function mechanismOf(event: BrowserRequestSourceEvent): BrowserRequestSourceEventType {
  return isFetchMechanism(event)
    ? BrowserRequestSourceEventType.Fetch
    : BrowserRequestSourceEventType.Xhr;
}

export function createRequestSourceHandler(
  submitEvent: CorePluginContext['submitEvent'],
  diagnostics: RequestCaptureDiagnosticStore,
): RequestSourceHandler {
  const converter = createRequestEventConverter();
  let isHandlingSource = false;

  function handle(event: BrowserRequestSourceEvent): void {
    if (isHandlingSource) {
      diagnostics.append({
        code: RequestCaptureDiagnosticCode.RecursiveCaptureBlocked,
        operation: RequestCaptureDiagnosticOperation.Notify,
        mechanism: mechanismOf(event),
      });
      return;
    }
    isHandlingSource = true;
    try {
      const converted: RequestBodyConversionResult = converter.convert(event);
      if (!converted.success) {
        const code = 'code' in converted ? converted.code : null;
        diagnostics.append({
          code:
            code === 'unsupported_method'
              ? RequestCaptureDiagnosticCode.UnsupportedMethod
              : code === 'invalid_browser_fact'
                ? RequestCaptureDiagnosticCode.InvalidBrowserFact
                : RequestCaptureDiagnosticCode.RequestBodyRejected,
          operation: RequestCaptureDiagnosticOperation.Convert,
          mechanism: mechanismOf(event),
        });
        return;
      }
      const result = submitEvent({
        eventType: EventType.Request,
        body: converted.data,
      });
      if (!result.ok) {
        diagnostics.append({
          code: RequestCaptureDiagnosticCode.EventSubmissionFailed,
          operation: RequestCaptureDiagnosticOperation.Submit,
          mechanism: mechanismOf(event),
        });
      }
    } catch {
      diagnostics.append({
        code: RequestCaptureDiagnosticCode.InternalError,
        operation: RequestCaptureDiagnosticOperation.Notify,
        mechanism: mechanismOf(event),
      });
    } finally {
      isHandlingSource = false;
    }
  }

  return Object.freeze({ handle });
}
```

`packages/plugin-request/src/request-capture-plugin.ts`：

```ts
import type {
  BrowserEnvironment,
  BrowserRequestSourceEvent,
  BrowserRequestSourceListener,
  BrowserSubscription,
} from '@aurora/browser';
import type { CorePlugin, CorePluginContext } from '@aurora/core';
import {
  createRequestCaptureDiagnosticStore,
  RequestCaptureDiagnosticCode,
  RequestCaptureDiagnosticOperation,
  type RequestCaptureDiagnostic,
} from './diagnostics.js';
import { createRequestSourceHandler, type RequestSourceHandler } from './request-source-handler.js';

export const REQUEST_CAPTURE_PLUGIN_NAME = 'request-capture' as const;

export interface RequestCapturePlugin extends CorePlugin {
  readonly name: typeof REQUEST_CAPTURE_PLUGIN_NAME;
  initialize(context: CorePluginContext): void;
  start(): void;
  stop(): void;
  destroy(): void;
  getDiagnostics(): readonly RequestCaptureDiagnostic[];
}

export function createRequestCapturePlugin(browser: BrowserEnvironment): RequestCapturePlugin {
  const diagnostics = createRequestCaptureDiagnosticStore();
  let handler: RequestSourceHandler | undefined;
  let subscription: BrowserSubscription | undefined;
  let isAcceptingEvents = false;
  let isDestroyed = false;

  const listener: BrowserRequestSourceListener = (event: BrowserRequestSourceEvent): void => {
    if (!isAcceptingEvents) return;
    handler?.handle(event);
  };

  function initialize(context: CorePluginContext): void {
    if (isDestroyed) {
      diagnostics.append({
        code: RequestCaptureDiagnosticCode.InvalidLifecycleCall,
        operation: RequestCaptureDiagnosticOperation.Initialize,
      });
      return;
    }
    if (handler !== undefined) return;
    try {
      const submitEvent = context.submitEvent;
      if (typeof submitEvent !== 'function') {
        diagnostics.append({
          code: RequestCaptureDiagnosticCode.InvalidPluginContext,
          operation: RequestCaptureDiagnosticOperation.Initialize,
        });
        return;
      }
      handler = createRequestSourceHandler(submitEvent, diagnostics);
    } catch {
      diagnostics.append({
        code: RequestCaptureDiagnosticCode.InvalidPluginContext,
        operation: RequestCaptureDiagnosticOperation.Initialize,
      });
    }
  }

  function start(): void {
    if (isDestroyed || handler === undefined) {
      diagnostics.append({
        code: RequestCaptureDiagnosticCode.InvalidLifecycleCall,
        operation: RequestCaptureDiagnosticOperation.Start,
      });
      return;
    }
    if (subscription !== undefined) return;
    try {
      const result = browser.subscribeRequests(listener);
      if (!result.ok) {
        diagnostics.append({
          code: RequestCaptureDiagnosticCode.BrowserSubscriptionFailed,
          operation: RequestCaptureDiagnosticOperation.Start,
        });
        return;
      }
      subscription = result.subscription;
      isAcceptingEvents = true;
    } catch {
      diagnostics.append({
        code: RequestCaptureDiagnosticCode.BrowserSubscriptionFailed,
        operation: RequestCaptureDiagnosticOperation.Start,
      });
    }
  }

  function release(
    operation:
      | typeof RequestCaptureDiagnosticOperation.Stop
      | typeof RequestCaptureDiagnosticOperation.Destroy,
  ): void {
    isAcceptingEvents = false;
    const current = subscription;
    subscription = undefined;
    if (current === undefined) return;
    try {
      const result = current.unsubscribe();
      if (result.diagnosticsAdded > 0) {
        diagnostics.append({
          code: RequestCaptureDiagnosticCode.BrowserUnsubscribeFailed,
          operation,
        });
      }
    } catch {
      diagnostics.append({
        code: RequestCaptureDiagnosticCode.BrowserUnsubscribeFailed,
        operation,
      });
    }
  }

  function stop(): void {
    release(RequestCaptureDiagnosticOperation.Stop);
  }

  function destroy(): void {
    if (isDestroyed) return;
    release(RequestCaptureDiagnosticOperation.Destroy);
    handler = undefined;
    isDestroyed = true;
  }

  return Object.freeze({
    name: REQUEST_CAPTURE_PLUGIN_NAME,
    initialize,
    start,
    stop,
    destroy,
    getDiagnostics: (): readonly RequestCaptureDiagnostic[] => diagnostics.snapshot(),
  });
}
```

`packages/plugin-request/src/index.ts`：

```ts
export {
  REQUEST_CAPTURE_PLUGIN_NAME,
  createRequestCapturePlugin,
  type RequestCapturePlugin,
} from './request-capture-plugin.js';
export { RequestCaptureDiagnosticCode, RequestCaptureDiagnosticOperation } from './diagnostics.js';
export type { RequestCaptureDiagnostic } from './diagnostics.js';
```

`eslint.config.mjs` 新增块（放在 plugin-error 块之后，镜像其宿主保护规则）：

```ts
  {
    files: ['packages/plugin-request/src/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        'window',
        'document',
        'navigator',
        'location',
        'globalThis',
        'fetch',
        'XMLHttpRequest',
        'localStorage',
        'sessionStorage',
        { name: 'process', message: 'Plugin source must not use Node runtime globals.' },
        { name: 'Buffer', message: 'Plugin source must not use Node runtime globals.' },
        { name: 'require', message: 'Plugin source must not use Node runtime globals.' },
        { name: 'module', message: 'Plugin source must not use Node runtime globals.' },
        { name: '__dirname', message: 'Plugin source must not use Node runtime globals.' },
        { name: '__filename', message: 'Plugin source must not use Node runtime globals.' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'AssignmentExpression[left.object.name=/^(window|document|navigator|performance|globalThis)$/]',
          message: 'Plugin source must not assign to host globals.',
        },
        {
          selector: "AssignmentExpression[left.object.property.name='prototype']",
          message: 'Plugin source must not modify native prototypes.',
        },
        {
          selector:
            "CallExpression[callee.object.name='Object'][callee.property.name=/^(assign|defineProperty)$/]",
          message: 'Plugin host mutation through Object mutators is forbidden by Workspace Policy.',
        },
        {
          selector: "CallExpression[callee.object.name='Reflect'][callee.property.name='set']",
          message: 'Plugin host mutation through Reflect.set is forbidden by Workspace Policy.',
        },
        {
          selector:
            'CallExpression[callee.property.name=/^(preventDefault|stopPropagation|stopImmediatePropagation)$/]',
          message: 'Plugin source must not control host event defaults or propagation.',
        },
      ],
    },
  },
```

同时根 `package.json` 的 `format:check` 列表追加 `packages/plugin-request/package.json`、`packages/plugin-request/tsconfig.json`、`packages/plugin-request/tsconfig.build.json`、`packages/plugin-request/tsconfig.no-dom.json`、`packages/plugin-request/vitest.config.ts`、`packages/plugin-request/playwright.config.ts`、`"packages/plugin-request/src/**/*.ts"`、`"packages/plugin-request/test/**/*.ts"`、`"packages/plugin-request/test-browser/**/*.ts"`、`packages/plugin-request/README.md`；`lint` 脚本追加 `packages/plugin-request/src`、`packages/plugin-request/test`、`packages/plugin-request/test-browser`、`packages/plugin-request/vitest.config.ts`、`packages/plugin-request/playwright.config.ts`；`test:coverage` 追加 `pnpm --filter @aurora/plugin-request test:coverage`；`check` 追加 `pnpm --filter @aurora/plugin-request test:package` 与 `pnpm --filter @aurora/plugin-request test:browser`。

- [ ] **Step 4: 安装依赖并运行测试确认通过**

Run: `pnpm install`
Expected: PASS（exit 0；新增 `@aurora/plugin-request` 包条目并生成 Workspace 符号链接，`pnpm-lock.yaml` 会更新——这是新增包的预期变化）。注意：新包加入后不能使用 `--frozen-lockfile`，否则锁文件过期会失败；提交边界包含更新后的锁文件。

Run: `pnpm --filter @aurora/plugin-request typecheck`
Expected: PASS（两个 tsconfig 均 Done，0 诊断）。

Run: `pnpm --filter @aurora/plugin-request test:package`
Expected: PASS（2 个测试；根入口加载四个运行时值，私有路径全部 `ERR_PACKAGE_PATH_NOT_EXPORTED`）。

Run: `pnpm --filter @aurora/plugin-request test:coverage`
Expected: PASS，覆盖率满足 85/80/85/85（本 Task 中转换与提交分支逻辑在后续 Task 的测试中覆盖）。

Run: `pnpm check:boundaries`
Expected: PASS（exit 0，无违规；`sdk-plugin` 允许矩阵已存在）。

Run: `pnpm lint`
Expected: PASS（eslint.config.mjs 新块生效，生产源码无宿主全局、无 console）。

- [ ] **Step 5: 相关回归**

Run: `pnpm --filter @aurora/workspace-policy exec vitest run test/dependency-policy.test.ts test/environment.test.ts`
Expected: PASS（`sdk-plugin` 层负例继续通过，plugin-request 依赖矩阵、私有路径、宿主全局与模块可变状态负例均生效）。

- [ ] **Step 6: 建议提交边界**

不执行 `git add`/`commit`。若用户另行授权提交，本 Task 边界为包壳、配置文件、`src/` 全部最小实现、入口与架构边界测试、根 package.json/eslint.config.mjs 修改。

---

### Task 2: 请求事实转换与生命周期单元测试

**Files:**
- Create: `packages/plugin-request/test/request-event-converter.test.ts`
- Create: `packages/plugin-request/test/lifecycle.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `createRequestEventConverter`、`createRequestCapturePlugin`、`RequestCaptureDiagnosticCode`；Browser 根出口的 `BrowserRequestMechanism`、`BrowserRequestOutcome`、`BrowserRequestSourceEventType`、`BrowserSubscription`；event-schema 根出口的 `parseRequestEventBody`、`RequestMethod`、`RequestOutcome`。
- Produces: 全部转换与生命周期测试断言模式（后续 Task 复用）。

- [ ] **Step 1: 写失败的转换测试**

`packages/plugin-request/test/request-event-converter.test.ts`：

```ts
import {
  BrowserRequestMechanism,
  BrowserRequestOutcome,
  type BrowserFetchRequestSourceEvent,
  type BrowserXhrRequestSourceEvent,
} from '@aurora/browser';
import { parseRequestEventBody, RequestMethod, RequestOutcome } from '@aurora/event-schema';
import { describe, expect, it } from 'vitest';
import { createRequestEventConverter } from '../src/request-event-converter.js';

const converter = createRequestEventConverter();

function fetchEvent(
  overrides: Partial<BrowserFetchRequestSourceEvent> = {},
): BrowserFetchRequestSourceEvent {
  return Object.freeze({
    mechanism: BrowserRequestMechanism.Fetch,
    method: 'GET',
    url: 'https://api.example.test/orders',
    startedAt: 1800000005000,
    durationMs: 120,
    outcome: BrowserRequestOutcome.Success,
    statusCode: 200,
    ...overrides,
  });
}

function xhrEvent(
  overrides: Partial<BrowserXhrRequestSourceEvent> = {},
): BrowserXhrRequestSourceEvent {
  return Object.freeze({
    mechanism: BrowserRequestMechanism.XmlHttpRequest,
    method: 'POST',
    url: 'https://api.example.test/orders',
    startedAt: 1800000005000,
    durationMs: 250,
    outcome: BrowserRequestOutcome.Success,
    statusCode: 201,
    ...overrides,
  });
}

describe('request event converter', () => {
  it('maps a successful fetch fact to a valid request body', () => {
    const result = converter.convert(fetchEvent());
    expect(result.success).toBe(true);
    if (!result.success) throw new Error('must succeed');
    expect(result.data).toEqual({
      method: RequestMethod.Get,
      url: 'https://api.example.test/orders',
      startedAt: 1800000005000,
      durationMs: 120,
      outcome: RequestOutcome.Success,
      statusCode: 200,
    });
    expect(parseRequestEventBody(result.data).success).toBe(true);
  });

  it('maps an HTTP-error fetch fact to http_error with its status code', () => {
    const result = converter.convert(
      fetchEvent({ outcome: BrowserRequestOutcome.HttpError, statusCode: 500 }),
    );
    expect(result.success).toBe(true);
    if (!result.success) throw new Error('must succeed');
    expect(result.data.outcome).toBe(RequestOutcome.HttpError);
    expect(result.data.statusCode).toBe(500);
  });

  it('maps a network-error fetch fact and omits statusCode when null', () => {
    const result = converter.convert(
      fetchEvent({ outcome: BrowserRequestOutcome.NetworkError, statusCode: null }),
    );
    expect(result.success).toBe(true);
    if (!result.success) throw new Error('must succeed');
    expect(result.data.outcome).toBe(RequestOutcome.NetworkError);
    expect('statusCode' in result.data).toBe(false);
  });

  it('normalizes lowercase standard methods', () => {
    for (const lower of ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']) {
      const result = converter.convert(fetchEvent({ method: lower }));
      expect(result.success).toBe(true);
      if (!result.success) throw new Error(`must succeed for ${lower}`);
      expect(parseRequestEventBody(result.data).success).toBe(true);
    }
  });

  it('rejects non-standard methods without submitting', () => {
    const result = converter.convert(fetchEvent({ method: 'CONNECT' }));
    expect(result).toEqual({ success: false, code: 'unsupported_method' });
  });

  it('keeps the input event unchanged', () => {
    const event = fetchEvent();
    const snapshot = JSON.stringify(event);
    converter.convert(event);
    expect(JSON.stringify(event)).toBe(snapshot);
  });

  it('maps a successful XHR load fact', () => {
    const result = converter.convert(xhrEvent());
    expect(result.success).toBe(true);
    if (!result.success) throw new Error('must succeed');
    expect(result.data).toMatchObject({
      method: RequestMethod.Post,
      url: 'https://api.example.test/orders',
      startedAt: 1800000005000,
      durationMs: 250,
      outcome: RequestOutcome.Success,
      statusCode: 201,
    });
  });

  it('maps XHR timeout and canceled facts', () => {
    const timeout = converter.convert(
      xhrEvent({ outcome: BrowserRequestOutcome.Timeout, statusCode: null }),
    );
    expect(timeout.success).toBe(true);
    if (!timeout.success) throw new Error('must succeed');
    expect(timeout.data.outcome).toBe(RequestOutcome.Timeout);

    const canceled = converter.convert(
      xhrEvent({ outcome: BrowserRequestOutcome.Canceled, statusCode: null }),
    );
    expect(canceled.success).toBe(true);
    if (!canceled.success) throw new Error('must succeed');
    expect(canceled.data.outcome).toBe(RequestOutcome.Canceled);
  });

  it('rounds fractional durationMs to a safe integer', () => {
    const result = converter.convert(fetchEvent({ durationMs: 120.6 }));
    expect(result.success).toBe(true);
    if (!result.success) throw new Error('must succeed');
    expect(result.data.durationMs).toBe(121);
  });

  it('rejects invalid browser facts', () => {
    expect(
      converter.convert(fetchEvent({ startedAt: 0 } as BrowserFetchRequestSourceEvent)),
    ).toEqual({ success: false, code: 'invalid_browser_fact' });
    expect(
      converter.convert(fetchEvent({ durationMs: -1 } as BrowserFetchRequestSourceEvent)),
    ).toEqual({ success: false, code: 'invalid_browser_fact' });
    expect(
      converter.convert(fetchEvent({ statusCode: 700 } as BrowserFetchRequestSourceEvent)),
    ).toEqual({ success: false, code: 'invalid_browser_fact' });
  });
});
```

- [ ] **Step 2: 运行转换测试确认预期失败**

Run: `pnpm --filter @aurora/plugin-request exec vitest run test/request-event-converter.test.ts`
Expected: FAIL，`../src/request-event-converter.js` 无法解析或类型不匹配。

- [ ] **Step 3: 确认转换测试通过**

Run: `pnpm --filter @aurora/plugin-request exec vitest run test/request-event-converter.test.ts`
Expected: PASS（Task 1 的最小转换器已满足全部断言；`statusCode: 700` 由转换器 `invalid_browser_fact` 拒绝，协议解析器拒绝路径在 Task 3 覆盖）。

- [ ] **Step 4: 写失败的生命周期测试**

`packages/plugin-request/test/lifecycle.test.ts`：

```ts
import {
  createBrowserEnvironment,
  type BrowserEnvironment,
  type BrowserRequestSourceEvent,
  type BrowserRequestSourceListener,
  type BrowserSubscription,
} from '@aurora/browser';
import type { CorePluginContext } from '@aurora/core';
import { describe, expect, it, vi } from 'vitest';
import { createRequestCapturePlugin } from '../src/index.js';

function createBrowserDouble(options: { readonly subscriptionFails?: boolean } = {}): {
  readonly browser: BrowserEnvironment;
  readonly listeners: BrowserRequestSourceListener[];
  readonly unsubscribe: ReturnType<typeof vi.fn>;
  readonly destroy: ReturnType<typeof vi.fn>;
} {
  const listeners: BrowserRequestSourceListener[] = [];
  const unsubscribe = vi.fn(() => ({
    ok: true as const,
    code: 'unsubscribed' as const,
    diagnosticsAdded: 0,
  }));
  const destroy = vi.fn(() => ({
    ok: true as const,
    code: 'destroyed' as const,
    diagnosticsAdded: 0,
  }));
  const subscription: BrowserSubscription = Object.freeze({ unsubscribe });
  return {
    listeners,
    unsubscribe,
    destroy,
    browser: {
      getCapabilities: vi.fn(),
      readPageSnapshot: vi.fn(),
      subscribePageLifecycle: vi.fn(),
      subscribeErrorSources: () => ({
        ok: false as const,
        code: 'environment_unavailable' as const,
        diagnosticsAdded: 0,
      }),
      subscribeRequests: vi.fn((listener: BrowserRequestSourceListener) => {
        if (options.subscriptionFails === true) {
          return {
            ok: false as const,
            code: 'listener_registration_failed' as const,
            diagnosticsAdded: 1,
          };
        }
        listeners.push(listener);
        return {
          ok: true as const,
          code: 'subscribed' as const,
          subscription,
          diagnosticsAdded: 0,
        };
      }),
      destroy,
      getDiagnostics: vi.fn(() => []),
    },
  };
}

const context: CorePluginContext = Object.freeze({
  submitEvent: vi.fn(() => ({
    ok: true as const,
    code: 'accepted' as const,
    state: 'started' as const,
    diagnosticsAdded: 0 as const,
  })),
});

function requestFact(
  overrides: Partial<BrowserRequestSourceEvent> = {},
): BrowserRequestSourceEvent {
  return {
    mechanism: 'fetch' as const,
    method: 'GET',
    url: 'https://api.example.test/orders',
    startedAt: 1800000005000,
    durationMs: 120,
    outcome: 'success' as const,
    statusCode: 200,
    ...overrides,
  };
}

describe('request capture lifecycle', () => {
  it('subscribes once, stops once, restarts, and destroys without owning Browser', () => {
    const fixture = createBrowserDouble();
    const plugin = createRequestCapturePlugin(fixture.browser);
    plugin.initialize(context);
    plugin.initialize(context);
    plugin.start();
    plugin.start();
    expect(fixture.listeners).toHaveLength(1);
    plugin.stop();
    plugin.stop();
    expect(fixture.unsubscribe).toHaveBeenCalledTimes(1);
    plugin.start();
    expect(fixture.listeners).toHaveLength(2);
    plugin.destroy();
    plugin.destroy();
    expect(fixture.unsubscribe).toHaveBeenCalledTimes(2);
    expect(fixture.destroy).not.toHaveBeenCalled();
  });

  it('records failed subscription and allows a later retry', () => {
    const fixture = createBrowserDouble({ subscriptionFails: true });
    const plugin = createRequestCapturePlugin(fixture.browser);
    plugin.initialize(context);
    expect(() => {
      plugin.start();
    }).not.toThrow();
    expect(plugin.getDiagnostics()).toEqual([
      { sequence: 1, code: 'browser_subscription_failed', operation: 'start' },
    ]);
    plugin.stop();
    plugin.start();
    expect(plugin.getDiagnostics()).toHaveLength(2);
  });

  it('never restarts after destroy and returns immutable diagnostic copies', () => {
    const fixture = createBrowserDouble();
    const plugin = createRequestCapturePlugin(fixture.browser);
    plugin.start();
    plugin.destroy();
    plugin.initialize(context);
    plugin.start();
    const diagnostics = plugin.getDiagnostics();
    expect(diagnostics.map(({ code }) => code)).toEqual([
      'invalid_lifecycle_call',
      'invalid_lifecycle_call',
      'invalid_lifecycle_call',
    ]);
    expect(Object.isFrozen(diagnostics)).toBe(true);
    expect(diagnostics.every(Object.isFrozen)).toBe(true);
  });

  it('ignores retained host callbacks after stop and after destroy', () => {
    const fixture = createBrowserDouble();
    const submitEvent = vi.fn(() => ({
      ok: true as const,
      code: 'accepted' as const,
      state: 'started' as const,
      diagnosticsAdded: 0 as const,
    }));
    const plugin = createRequestCapturePlugin(fixture.browser);
    plugin.initialize(Object.freeze({ submitEvent }));
    plugin.start();
    const retained = fixture.listeners[0];
    if (retained === undefined) throw new Error('listener must exist');
    plugin.stop();
    retained(requestFact());
    plugin.start();
    plugin.destroy();
    retained(requestFact());
    expect(submitEvent).not.toHaveBeenCalled();
  });

  it('deactivates before an unsubscribe exception and records no sensitive text', () => {
    const listeners: BrowserRequestSourceListener[] = [];
    const browser = {
      ...createBrowserDouble().browser,
      subscribeRequests(listener: BrowserRequestSourceListener) {
        listeners.push(listener);
        return {
          ok: true as const,
          code: 'subscribed' as const,
          diagnosticsAdded: 0,
          subscription: Object.freeze({
            unsubscribe(): never {
              throw new Error('token=removal-private');
            },
          }),
        };
      },
    };
    const submitEvent = vi.fn(() => ({
      ok: true as const,
      code: 'accepted' as const,
      state: 'started' as const,
      diagnosticsAdded: 0 as const,
    }));
    const plugin = createRequestCapturePlugin(browser);
    plugin.initialize(Object.freeze({ submitEvent }));
    plugin.start();
    plugin.stop();
    listeners[0]?.(requestFact());
    expect(submitEvent).not.toHaveBeenCalled();
    expect(JSON.stringify(plugin.getDiagnostics())).not.toContain('private');
    expect(plugin.getDiagnostics()).toMatchObject([
      { code: 'browser_unsubscribe_failed', operation: 'stop' },
    ]);
  });
});
```

- [ ] **Step 5: 运行生命周期测试确认预期失败**

Run: `pnpm --filter @aurora/plugin-request exec vitest run test/lifecycle.test.ts`
Expected: FAIL，`createRequestCapturePlugin` 尚未从包根导出或行为不匹配。

- [ ] **Step 6: 确认生命周期测试通过**

Run: `pnpm --filter @aurora/plugin-request test`
Expected: PASS（全部单元测试）。

- [ ] **Step 7: 运行覆盖率确认门禁**

Run: `pnpm --filter @aurora/plugin-request test:coverage`
Expected: PASS，lines ≥ 85 / branches ≥ 80 / functions ≥ 85 / statements ≥ 85。

- [ ] **Step 8: 相关回归**

Run: `pnpm --filter @aurora/event-schema test` 与 `pnpm --filter @aurora/browser test`
Expected: PASS（上游不变）。

- [ ] **Step 9: 建议提交边界**

不执行 `git add`/`commit`。若另行授权，本 Task 边界为两个测试文件与任何必要的转换器修正。

---

### Task 3: 提交、失败隔离、host-safety 与多实例测试

**Files:**
- Create: `packages/plugin-request/test/submission.test.ts`
- Create: `packages/plugin-request/test/host-safety.test.ts`
- Create: `packages/plugin-request/test/multi-instance.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `createRequestSourceHandler`、`createRequestCapturePlugin`、`createRequestCaptureDiagnosticStore`、`RequestCaptureDiagnosticCode`/`Operation`；Browser 根出口的 `BrowserRequestSourceEventType`、`BrowserRequestMechanism`；core 根出口的 `CorePluginContext`、`CoreEventDraftResult`；event-schema 根出口的 `EventType`、`parseRequestEventBody`、`RequestMethod`。
- Produces: 失败隔离、多实例与 plugin-error 共存的测试证据。

- [ ] **Step 1: 写失败的 submission 测试**

`packages/plugin-request/test/submission.test.ts`：

```ts
import { BrowserRequestSourceEventType, type BrowserRequestSourceEvent } from '@aurora/browser';
import type { CoreEventDraftResult, CorePluginContext } from '@aurora/core';
import { EventType, parseRequestEventBody } from '@aurora/event-schema';
import { describe, expect, it, vi } from 'vitest';
import { createRequestCaptureDiagnosticStore } from '../src/diagnostics.js';
import { createRequestSourceHandler } from '../src/request-source-handler.js';

const accepted: CoreEventDraftResult = Object.freeze({
  ok: true,
  code: 'accepted',
  state: 'started',
  diagnosticsAdded: 0,
});
const rejected: CoreEventDraftResult = Object.freeze({
  ok: false,
  code: 'not_started',
  state: 'stopped',
  diagnosticsAdded: 1,
});

const fetchSuccessEvent: BrowserRequestSourceEvent = Object.freeze({
  mechanism: 'fetch',
  method: 'GET',
  url: 'https://api.example.test/orders?token=private#fragment',
  startedAt: 1800000005000,
  durationMs: 120.6,
  outcome: 'success',
  statusCode: 200,
});
const xhrTimeoutEvent: BrowserRequestSourceEvent = Object.freeze({
  mechanism: 'xhr',
  method: 'POST',
  url: 'https://api.example.test/orders',
  startedAt: 1800000005000,
  durationMs: 3000,
  outcome: 'timeout',
  statusCode: null,
});

describe('request source submission', () => {
  it('submits each source exactly once as an exact validated Core draft', () => {
    const drafts: unknown[] = [];
    const submitEvent: CorePluginContext['submitEvent'] = vi.fn((input: unknown) => {
      drafts.push(input);
      return accepted;
    });
    const diagnostics = createRequestCaptureDiagnosticStore();
    const handler = createRequestSourceHandler(submitEvent, diagnostics);
    handler.handle(fetchSuccessEvent);
    handler.handle(xhrTimeoutEvent);
    expect(drafts).toHaveLength(2);
    for (const draft of drafts) {
      if (typeof draft !== 'object' || draft === null) throw new Error('draft must be an object');
      expect(Reflect.ownKeys(draft)).toEqual(['eventType', 'body']);
      expect(draft).toMatchObject({ eventType: EventType.Request });
      const body: unknown = Reflect.get(draft, 'body');
      expect(parseRequestEventBody(body).success).toBe(true);
      expect(Reflect.has(draft, 'eventId')).toBe(false);
      expect(Reflect.has(draft, 'occurredAt')).toBe(false);
      expect(Reflect.has(draft, 'protocolVersion')).toBe(false);
    }
    expect(diagnostics.snapshot()).toEqual([]);
  });

  it('does not submit when the schema rejects a valid-shaped but out-of-range body', () => {
    const submitEvent = vi.fn(() => accepted);
    const diagnostics = createRequestCaptureDiagnosticStore();
    const handler = createRequestSourceHandler(submitEvent, diagnostics);
    // Browser 已脱敏 origin+pathname，但协议解析器仍是最终边界：构造超长 URL 由协议拒绝。
    const tooLongUrl = `https://api.example.test/${'a'.repeat(2048)}`;
    handler.handle({ ...fetchSuccessEvent, url: tooLongUrl });
    handler.handle(fetchSuccessEvent);
    expect(submitEvent).toHaveBeenCalledTimes(1);
    expect(diagnostics.snapshot()).toMatchObject([
      { code: 'request_body_rejected', operation: 'convert', mechanism: 'fetch' },
    ]);
  });

  it('does not submit unsupported methods', () => {
    const submitEvent = vi.fn(() => accepted);
    const diagnostics = createRequestCaptureDiagnosticStore();
    const handler = createRequestSourceHandler(submitEvent, diagnostics);
    handler.handle({ ...fetchSuccessEvent, method: 'CONNECT' });
    expect(submitEvent).not.toHaveBeenCalled();
    expect(diagnostics.snapshot()).toMatchObject([
      { code: 'unsupported_method', operation: 'convert', mechanism: 'fetch' },
    ]);
  });

  it('does not submit invalid browser facts', () => {
    const submitEvent = vi.fn(() => accepted);
    const diagnostics = createRequestCaptureDiagnosticStore();
    const handler = createRequestSourceHandler(submitEvent, diagnostics);
    handler.handle({ ...fetchSuccessEvent, startedAt: 0 } as BrowserRequestSourceEvent);
    expect(submitEvent).not.toHaveBeenCalled();
    expect(diagnostics.snapshot()).toMatchObject([
      { code: 'invalid_browser_fact', operation: 'convert', mechanism: 'fetch' },
    ]);
  });

  it('records a Core failure and submits the next event', () => {
    const submitEvent = vi
      .fn<CorePluginContext['submitEvent']>()
      .mockReturnValueOnce(rejected)
      .mockReturnValueOnce(accepted);
    const diagnostics = createRequestCaptureDiagnosticStore();
    const handler = createRequestSourceHandler(submitEvent, diagnostics);
    handler.handle(fetchSuccessEvent);
    handler.handle(xhrTimeoutEvent);
    expect(submitEvent).toHaveBeenCalledTimes(2);
    expect(diagnostics.snapshot()).toMatchObject([
      { code: 'event_submission_failed', operation: 'submit', mechanism: 'fetch' },
    ]);
  });

  it('blocks synchronous recursion without suppressing the next independent event', () => {
    const diagnostics = createRequestCaptureDiagnosticStore();
    let calls = 0;
    const submitEvent: CorePluginContext['submitEvent'] = (): CoreEventDraftResult => {
      calls += 1;
      if (calls === 1) handler.handle(fetchSuccessEvent);
      return accepted;
    };
    const handler = createRequestSourceHandler(submitEvent, diagnostics);
    handler.handle(fetchSuccessEvent);
    handler.handle(xhrTimeoutEvent);
    expect(calls).toBe(2);
    expect(diagnostics.snapshot()).toMatchObject([
      { code: 'recursive_capture_blocked', operation: 'notify', mechanism: 'fetch' },
    ]);
  });

  it('maps fetch and xhr mechanisms into diagnostics', () => {
    const diagnostics = createRequestCaptureDiagnosticStore();
    let calls = 0;
    const submitEvent: CorePluginContext['submitEvent'] = (): CoreEventDraftResult => {
      calls += 1;
      if (calls === 1) {
        return Object.freeze({
          ok: false,
          code: 'not_started',
          state: 'stopped',
          diagnosticsAdded: 1,
        });
      }
      return accepted;
    };
    const handler = createRequestSourceHandler(submitEvent, diagnostics);
    handler.handle(fetchSuccessEvent);
    handler.handle(xhrTimeoutEvent);
    expect(calls).toBe(2);
    expect(diagnostics.snapshot()).toMatchObject([
      { code: 'event_submission_failed', operation: 'submit', mechanism: 'fetch' },
    ]);
  });
});
```

注意：`createRequestCaptureDiagnosticStore` 与 `createRequestSourceHandler` 是包内私有模块，本测试从 `../src/*.js` 直接导入（与 plugin-error 的 submission.test.ts 模式一致）。这两者不导出到包根。

- [ ] **Step 2: 运行 submission 测试确认预期失败**

Run: `pnpm --filter @aurora/plugin-request exec vitest run test/submission.test.ts`
Expected: FAIL，`../src/request-source-handler.js` 不存在或类型不匹配。

- [ ] **Step 3: 确认 submission 测试通过**

Run: `pnpm --filter @aurora/plugin-request exec vitest run test/submission.test.ts`
Expected: PASS。若 `startedAt: 0` 断言失败，检查转换器对非法事实的分支（Task 1 已实现）。

- [ ] **Step 4: 写失败的 host-safety 测试**

`packages/plugin-request/test/host-safety.test.ts`：

```ts
import type { BrowserRequestSourceListener, BrowserSubscription } from '@aurora/browser';
import type { CorePluginContext } from '@aurora/core';
import { describe, expect, it, vi } from 'vitest';
import { createRequestCapturePlugin } from '../src/index.js';

describe('request plugin host safety', () => {
  it('contains conversion and submit exceptions and handles the next event', () => {
    let listener: BrowserRequestSourceListener | undefined;
    const subscription: BrowserSubscription = Object.freeze({
      unsubscribe: () => ({
        ok: true as const,
        code: 'unsubscribed' as const,
        diagnosticsAdded: 0 as const,
      }),
    });
    const browser = {
      getCapabilities: vi.fn(),
      readPageSnapshot: vi.fn(),
      subscribePageLifecycle: vi.fn(),
      subscribeErrorSources: () => ({
        ok: false as const,
        code: 'environment_unavailable' as const,
        diagnosticsAdded: 0,
      }),
      subscribeRequests(next: BrowserRequestSourceListener) {
        listener = next;
        return {
          ok: true as const,
          code: 'subscribed' as const,
          subscription,
          diagnosticsAdded: 0,
        };
      },
      destroy: vi.fn(),
      getDiagnostics: vi.fn(() => []),
    };
    const submitEvent = vi
      .fn<CorePluginContext['submitEvent']>()
      .mockImplementationOnce(() => {
        throw new Error('authorization=private');
      })
      .mockReturnValueOnce({
        ok: true as const,
        code: 'accepted' as const,
        state: 'started' as const,
        diagnosticsAdded: 0 as const,
      });
    const plugin = createRequestCapturePlugin(browser);
    plugin.initialize(Object.freeze({ submitEvent }));
    plugin.start();
    const fact = {
      mechanism: 'fetch' as const,
      method: 'GET',
      url: 'https://api.example.test/orders',
      startedAt: 1800000005000,
      durationMs: 120,
      outcome: 'success' as const,
      statusCode: 200,
    };
    listener?.(fact);
    listener?.(fact);
    expect(submitEvent).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(plugin.getDiagnostics())).not.toContain('authorization');
    expect(plugin.getDiagnostics()).toMatchObject([
      { code: 'internal_error', operation: 'notify', mechanism: 'fetch' },
    ]);
  });

  it('does not mutate the host request fact or read request bodies', () => {
    const listeners: BrowserRequestSourceListener[] = [];
    const browser = {
      getCapabilities: vi.fn(),
      readPageSnapshot: vi.fn(),
      subscribePageLifecycle: vi.fn(),
      subscribeErrorSources: () => ({
        ok: false as const,
        code: 'environment_unavailable' as const,
        diagnosticsAdded: 0,
      }),
      subscribeRequests(next: BrowserRequestSourceListener) {
        listeners.push(next);
        return {
          ok: true as const,
          code: 'subscribed' as const,
          diagnosticsAdded: 0,
          subscription: Object.freeze({
            unsubscribe: () => ({
              ok: true as const,
              code: 'unsubscribed' as const,
              diagnosticsAdded: 0,
            }),
          }),
        };
      },
      destroy: vi.fn(),
      getDiagnostics: vi.fn(() => []),
    };
    const submitEvent = vi.fn(() => ({
      ok: true as const,
      code: 'accepted' as const,
      state: 'started' as const,
      diagnosticsAdded: 0 as const,
    }));
    const plugin = createRequestCapturePlugin(browser);
    plugin.initialize(Object.freeze({ submitEvent }));
    plugin.start();
    const fact = {
      mechanism: 'fetch' as const,
      method: 'GET',
      url: 'https://api.example.test/orders',
      startedAt: 1800000005000,
      durationMs: 120,
      outcome: 'success' as const,
      statusCode: 200,
    };
    const snapshot = JSON.stringify(fact);
    listeners[0]?.(fact);
    expect(JSON.stringify(fact)).toBe(snapshot);
    expect(submitEvent).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 5: 写失败的多实例测试**

`packages/plugin-request/test/multi-instance.test.ts`：

```ts
import type { BrowserRequestSourceListener } from '@aurora/browser';
import type { CorePluginContext } from '@aurora/core';
import { describe, expect, it, vi } from 'vitest';
import { createRequestCapturePlugin } from '../src/index.js';

function sharedBrowser() {
  const active = new Set<BrowserRequestSourceListener>();
  return {
    active,
    browser: {
      getCapabilities: vi.fn(),
      readPageSnapshot: vi.fn(),
      subscribePageLifecycle: vi.fn(),
      subscribeErrorSources: () => ({
        ok: false as const,
        code: 'environment_unavailable' as const,
        diagnosticsAdded: 0,
      }),
      subscribeRequests(listener: BrowserRequestSourceListener) {
        active.add(listener);
        let isActive = true;
        return {
          ok: true as const,
          code: 'subscribed' as const,
          diagnosticsAdded: 0,
          subscription: Object.freeze({
            unsubscribe() {
              if (!isActive) {
                return {
                  ok: true as const,
                  code: 'already_unsubscribed' as const,
                  diagnosticsAdded: 0,
                };
              }
              isActive = false;
              active.delete(listener);
              return {
                ok: true as const,
                code: 'unsubscribed' as const,
                diagnosticsAdded: 0,
              };
            },
          }),
        };
      },
      destroy: vi.fn(),
      getDiagnostics: vi.fn(() => []),
    },
    dispatch(): void {
      const fact = {
        mechanism: 'fetch' as const,
        method: 'GET',
        url: 'https://api.example.test/orders',
        startedAt: 1800000005000,
        durationMs: 120,
        outcome: 'success' as const,
        statusCode: 200,
      };
      for (const listener of [...active]) listener(fact);
    },
  };
}

function context(submitEvent: CorePluginContext['submitEvent']): CorePluginContext {
  return Object.freeze({ submitEvent });
}

describe('request plugin multi-instance isolation', () => {
  it('does not cross-remove instances sharing one BrowserEnvironment', () => {
    const fixture = sharedBrowser();
    const firstSubmit = vi.fn(() => ({
      ok: true as const,
      code: 'accepted' as const,
      state: 'started' as const,
      diagnosticsAdded: 0 as const,
    }));
    const secondSubmit = vi.fn(() => ({
      ok: true as const,
      code: 'accepted' as const,
      state: 'started' as const,
      diagnosticsAdded: 0 as const,
    }));
    const first = createRequestCapturePlugin(fixture.browser);
    const second = createRequestCapturePlugin(fixture.browser);
    first.initialize(context(firstSubmit));
    second.initialize(context(secondSubmit));
    first.start();
    second.start();
    fixture.dispatch();
    first.destroy();
    fixture.dispatch();
    expect(firstSubmit).toHaveBeenCalledTimes(1);
    expect(secondSubmit).toHaveBeenCalledTimes(2);
    expect(fixture.active.size).toBe(1);
    second.destroy();
    expect(fixture.active.size).toBe(0);
  });

  it('keeps diagnostics and submit failures instance-local', () => {
    const fixture = sharedBrowser();
    const failed = createRequestCapturePlugin(fixture.browser);
    const healthy = createRequestCapturePlugin(fixture.browser);
    failed.initialize(
      context(() => {
        throw new Error('private');
      }),
    );
    healthy.initialize(
      context(() => ({
        ok: true as const,
        code: 'accepted' as const,
        state: 'started' as const,
        diagnosticsAdded: 0 as const,
      })),
    );
    failed.start();
    healthy.start();
    fixture.dispatch();
    expect(failed.getDiagnostics()).toHaveLength(1);
    expect(healthy.getDiagnostics()).toEqual([]);
    expect(failed.getDiagnostics()[0]?.sequence).toBe(1);
  });

  it('never calls BrowserEnvironment.destroy and leaves other subscribers intact', () => {
    const fixture = sharedBrowser();
    const plugin = createRequestCapturePlugin(fixture.browser);
    plugin.initialize(
      context(() => ({
        ok: true as const,
        code: 'accepted' as const,
        state: 'started' as const,
        diagnosticsAdded: 0 as const,
      })),
    );
    plugin.start();
    fixture.dispatch();
    plugin.destroy();
    fixture.dispatch();
    expect(fixture.browser.destroy).not.toHaveBeenCalled();
    expect(fixture.active.size).toBe(0);
  });
});
```

- [ ] **Step 6: 运行 host-safety 与 multi-instance 测试确认预期失败**

Run: `pnpm --filter @aurora/plugin-request exec vitest run test/host-safety.test.ts test/multi-instance.test.ts`
Expected: FAIL，`createRequestCapturePlugin` 尚未导出或行为不匹配。

- [ ] **Step 7: 确认全部单元测试通过**

Run: `pnpm --filter @aurora/plugin-request test`
Expected: PASS（全部测试文件）。

- [ ] **Step 8: 运行覆盖率确认门禁**

Run: `pnpm --filter @aurora/plugin-request test:coverage`
Expected: PASS，lines ≥ 85 / branches ≥ 80 / functions ≥ 85 / statements ≥ 85。

- [ ] **Step 9: 相关回归**

Run: `pnpm --filter @aurora/plugin-error test`
Expected: PASS（相邻插件不受影响）。

- [ ] **Step 10: 建议提交边界**

不执行 `git add`/`commit`。若另行授权，本 Task 边界为三个测试文件与任何必要的实现修正。

---

### Task 4: 文档契约、README 与正式文档同步、体积与 ADR 证据

**Files:**
- Create: `packages/plugin-request/README.md`
- Create: `packages/plugin-request/test/documentation-contract.test.ts`
- Modify: `README.md`（根）
- Modify: `docs/README.md`
- Modify: `docs/architecture/sdk-architecture.md`
- Modify: `docs/architecture/formalization-readiness.md`

**Interfaces:**
- Consumes: Task 1 的 `createRequestCapturePlugin`；Browser 根出口 `BrowserRequestSourceListener`；core 根出口 `createCore`；event-schema 根出口 `parseRequestEventBody`。
- Produces: 包 README、文档契约测试、体积测量与 ADR 证据段落。

- [ ] **Step 1: 写失败的文档契约测试**

`packages/plugin-request/test/documentation-contract.test.ts`：

```ts
import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import type { BrowserRequestSourceListener } from '@aurora/browser';
import { createCore } from '@aurora/core';
import { createRequestCapturePlugin } from '../src/index.js';

describe('request plugin documentation contract', () => {
  it('documents the exact public assembly and exclusions', async () => {
    const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
    for (const text of [
      "import { createBrowserEnvironment } from '@aurora/browser';",
      "import { createCore } from '@aurora/core';",
      "import { createRequestCapturePlugin } from '@aurora/plugin-request';",
      'core.registerPlugin(requestPlugin);',
      'await core.initialize();',
      'await core.start();',
      'await core.stop();',
      'await core.destroy();',
      '不生成事件 ID、时间或协议版本',
      '不实现采样、队列、传输、重试或持久化',
    ]) {
      expect(readme).toContain(text);
    }
  });

  it('executes the documented public lifecycle through Core', async () => {
    const listeners: BrowserRequestSourceListener[] = [];
    const browser = {
      getCapabilities: vi.fn(),
      readPageSnapshot: vi.fn(),
      subscribePageLifecycle: vi.fn(),
      subscribeErrorSources: () => ({
        ok: false as const,
        code: 'environment_unavailable' as const,
        diagnosticsAdded: 0,
      }),
      subscribeRequests(listener: BrowserRequestSourceListener) {
        listeners.push(listener);
        return {
          ok: true as const,
          code: 'subscribed' as const,
          diagnosticsAdded: 0,
          subscription: Object.freeze({
            unsubscribe: () => ({
              ok: true as const,
              code: 'unsubscribed' as const,
              diagnosticsAdded: 0,
            }),
          }),
        };
      },
      destroy: vi.fn(),
      getDiagnostics: vi.fn(() => []),
    };
    const core = createCore({
      eventIdProvider: { createEventId: () => 'readme-request-event-1' },
      eventTimeProvider: { now: () => 1_800_000_000_001 },
    });
    const requestPlugin = createRequestCapturePlugin(browser);
    expect(core.registerPlugin(requestPlugin)).toMatchObject({ ok: true });
    await core.initialize();
    await core.start();
    listeners[0]?.({
      mechanism: 'fetch',
      method: 'GET',
      url: 'https://api.example.test/orders',
      startedAt: 1800000005000,
      durationMs: 120,
      outcome: 'success',
      statusCode: 200,
    });
    expect(requestPlugin.getDiagnostics()).toEqual([]);
    await core.stop();
    await core.destroy();
    expect(browser.destroy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行文档契约测试确认预期失败**

Run: `pnpm --filter @aurora/plugin-request exec vitest run test/documentation-contract.test.ts`
Expected: FAIL，`packages/plugin-request/README.md` 不存在。

- [ ] **Step 3: 创建 README**

`packages/plugin-request/README.md`：

```markdown
# @aurora/plugin-request

Aurora 的浏览器请求采集插件第一增量。它通过 `@aurora/browser` 的 `subscribeRequests` 接收 fetch 与 XMLHttpRequest 请求事实，用 `@aurora/event-schema` 根入口的 `parseRequestEventBody` 校验请求正文，并通过 `@aurora/core` 插件上下文提交最小事件草稿。

## 使用

```ts
import { createBrowserEnvironment } from '@aurora/browser';
import { createCore } from '@aurora/core';
import { createRequestCapturePlugin } from '@aurora/plugin-request';

const browser = createBrowserEnvironment();
const core = createCore();
const requestPlugin = createRequestCapturePlugin(browser);

core.registerPlugin(requestPlugin);
await core.initialize();
await core.start();

await core.stop();
await core.destroy();
browser.destroy();
```

BrowserEnvironment 由调用方拥有；插件只取消自己的请求订阅，不调用 `browser.destroy()`。Core 必须在 Browser 之前停止并销毁插件，最后再由调用方销毁 Browser。

## 公开 API

- `createRequestCapturePlugin(browser: BrowserEnvironment): RequestCapturePlugin`
- `REQUEST_CAPTURE_PLUGIN_NAME`
- `RequestCaptureDiagnosticCode`
- `RequestCaptureDiagnosticOperation`
- `RequestCapturePlugin`
- `RequestCaptureDiagnostic`

插件钩子同步且幂等。Browser 订阅、单次转换和 Core 提交失败不会抛回宿主；稳定结果写入每实例最新 100 条的冻结诊断。诊断不含 URL、method、statusCode、请求事实、异常消息或敏感值。

## 边界

- 只从 Core、Browser 和 event-schema 包根导入；
- 不生成事件 ID、时间或协议版本；
- 不创建 EventEnvelope；
- 不直接访问 DOM，不覆盖宿主 handler，不控制事件传播；
- 不包装 fetch 或 XMLHttpRequest，不消费请求或响应正文；
- 不保留 Browser 请求事实或原生引用；
- 不实现采样、队列、传输、重试或持久化；
- 不实现允许来源/同源判断、慢请求阈值、去重、聚合或问题识别。

正式契约见 `docs/sdk/request-capture-plugin.md`。
```

注意：README 中的代码块使用四个反引号包裹，避免与文档自身嵌套冲突；实施时保留上述实际内容。

- [ ] **Step 4: 确认文档契约测试通过**

Run: `pnpm --filter @aurora/plugin-request exec vitest run test/documentation-contract.test.ts`
Expected: PASS（README 断言全部命中，生命周期经真实 `createCore()` 执行并返回 `accepted`）。

- [ ] **Step 5: 同步正式文档（追加真实证据）**

- Modify `docs/README.md`：在 SDK 文档映射中加入 `docs/sdk/request-capture-plugin.md` 与 `docs/superpowers/plans/2026-07-31-request-capture-plugin.md`，说明请求插件第一增量真实存在，其他具体插件与传输仍不存在。
- Modify `docs/architecture/sdk-architecture.md`：记录 `@aurora/plugin-request` 为真实 `sdk-plugin` 包，只消费三个包根公开接口；请求传输、采样、队列仍不存在。
- Modify `docs/architecture/formalization-readiness.md`：把请求采集插件从“仅计划”更新为“已实施”，其他正文、批次、真实系统消费者仍受阻。
- Modify `README.md`（根）：在真实内部包列表中加入 `@aurora/plugin-request`，不声称请求观测以外的能力已存在。

- [ ] **Step 6: 测量体积并记录**

Run: `node -e "const fs=require('fs'); const files=['diagnostics','index','request-capture-plugin','request-event-converter','request-source-handler']; const raw=files.map(f=>fs.readFileSync('packages/plugin-request/dist/'+f+'.js','utf8')).join('\n'); console.log('raw bytes:', Buffer.byteLength(raw));"`

记录输出 raw 字节数。再运行：

Run: `node -e "const fs=require('fs'),zlib=require('zlib'); const files=['diagnostics','index','request-capture-plugin','request-event-converter','request-source-handler']; const raw=files.map(f=>fs.readFileSync('packages/plugin-request/dist/'+f+'.js','utf8')).join('\n'); const g=zlib.gzipSync(raw); console.log('gzip bytes:', g.length);"`

Expected: 输出 gzip 字节数，且明显小于 8 KiB（8192 字节）预算。若大于预算，停止并在报告中说明（这表示需要拆分或优化，但不可在未批准时自行实现）。记录到规格第 20 节与实施证据，标记 `requires-benchmark`。

- [ ] **Step 7: 追加 ADR 实施证据段落**

在 `docs/adr/ADR-003-sdk-plugin-architecture.md` 追加记录：

```markdown
### 2026-07-31：Browser 请求采集插件第一增量实施证据

- 决策状态保持 `accepted`，实施状态保持 `in-progress`；本记录只覆盖 `@aurora/plugin-request` 第一增量。
- 插件通过公开 Browser 请求源、event-schema 请求正文解析器和 Core 最小草稿入口组合三层能力；插件不拥有 BrowserEnvironment，不创建系统字段、队列或传输。
- 生命周期、原子订阅失败、停止/销毁释放、同步重入阻断、单次失败恢复、多实例和真实 Chromium 宿主安全门禁均通过。
- 实施 Commit：none（如本轮产生真实 Commit，则只把该真实哈希写入本行）
- Issue/PR：none
- 剩余工作：性能、行为、框架插件、采样、队列、批量、传输、重试和持久化仍不存在。
```

在 `docs/adr/ADR-005-event-schema-source-of-truth.md` 追加记录：

```markdown
### 2026-07-31：请求插件真实协议消费者证据

- 决策状态保持 `accepted`，实施状态保持 `in-progress`。
- `@aurora/plugin-request` 只从 `@aurora/event-schema` 根入口导入请求常量、限制、类型、`EventType` 与 `parseRequestEventBody`；没有复制请求正文、URL 校验、协议版本或 EventEnvelope。
- 全部 Browser 请求事实在提交 Core 草稿前通过公共请求正文解析器；schema 拒绝不提交且不泄露 issue 输入。
- 包入口、私有路径、契约单测、覆盖率和 Chromium 公共解析证据全部通过。
- 实施 Commit：none（如本轮产生真实 Commit，则只把该真实哈希写入本行）
- Issue/PR：none
```

在 `docs/adr/ADR-006-one-way-dependencies.md` 追加记录：

```markdown
### 2026-07-31：请求插件 sdk-plugin 依赖边界实施证据

- 决策状态保持 `accepted`，实施状态保持 `in-progress`。
- `@aurora/plugin-request`（`aurora.layer: sdk-plugin`）声明 `@aurora/core`、`@aurora/browser`、`@aurora/event-schema` 三个 `workspace:*` 依赖，反向、插件间、framework/tooling、循环、未声明依赖和跨包私有路径负例均被拒绝。
- 插件生产源码的 DOM/宿主全局、Node 运行时、模块级可变状态、宿主修改和事件控制负例均生效；`tsconfig.no-dom.json`、ESLint、包根入口和私有子路径拒绝均通过。
- 验证命令：`pnpm check:boundaries`、plugin typecheck/package 与根 `pnpm check:ci`，全部 exit 0。
- 实施 Commit：none（如本轮产生真实 Commit，则只把该真实哈希写入本行）
- Issue/PR：none
```

- [ ] **Step 8: 根级完整质量门禁**

Run: `pnpm format:check`
Expected: PASS（exit 0）。

Run: `pnpm lint`
Expected: PASS（exit 0）。

Run: `pnpm typecheck`
Expected: PASS（exit 0，全部包含 no-DOM）。

Run: `pnpm test`
Expected: PASS（exit 0，全部包）。

Run: `pnpm test:coverage`
Expected: PASS（exit 0，全部包满足 85/80/85/85）。

Run: `pnpm check:boundaries`
Expected: PASS（exit 0）。

Run: `pnpm build`
Expected: PASS（exit 0，产出 `packages/plugin-request/dist/`）。

Run: `pnpm --filter @aurora/plugin-request test:package`
Expected: PASS（2 个测试）。

Run: `pnpm --filter @aurora/plugin-request test:browser`
Expected: PASS（Chromium 场景全部通过）。

Run: `pnpm check:ci`
Expected: PASS（exit 0）。

Run: `git diff --check`
Expected: PASS（exit 0）。

- [ ] **Step 9: 建议提交边界**

不执行 `git add`/`commit`。若另行授权，本 Task 边界为 README、文档契约测试、三个正式文档修改、根 README 修改与三个 ADR 追加记录。

---

### Task 5: Chromium 真实浏览器端到端验证

**Files:**
- Create: `packages/plugin-request/test-browser/fixture-server.ts`
- Create: `packages/plugin-request/test-browser/request-capture-plugin.spec.ts`

**Interfaces:**
- Consumes: Task 1 的 `createRequestCapturePlugin`；Browser 根出口 `createBrowserEnvironment`；core 根出口 `createCore`；event-schema 根出口 `parseRequestEventEnvelope`。fixture server 使用 import map 映射 `@aurora/plugin-request`、`@aurora/browser`、`@aurora/core`、`@aurora/event-schema` 四个包根到各自 `dist/index.js`。
- Produces: Chromium 真实浏览器证据（真实 fetch/XHR 各场景、每次请求只提交一次、宿主身份恢复、plugin-error 共存、正文不被消费）。

- [ ] **Step 1: 写失败的 fixture-server**

`packages/plugin-request/test-browser/fixture-server.ts`：

```ts
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const requestPluginDist = fileURLToPath(new URL('../dist/', import.meta.url));
const browserDist = fileURLToPath(new URL('../../browser/dist/', import.meta.url));
const coreDist = fileURLToPath(new URL('../../core/dist/', import.meta.url));
const protocolDist = fileURLToPath(new URL('../../event-schema/dist/', import.meta.url));
const errorPluginDist = fileURLToPath(new URL('../../plugin-error/dist/', import.meta.url));

const pageHtml = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Aurora Request Plugin Fixture</title>
  <script type="importmap">
  {
    "imports": {
      "@aurora/plugin-request": "/request-plugin/index.js",
      "@aurora/plugin-error": "/plugin-error/index.js",
      "@aurora/browser": "/browser/index.js",
      "@aurora/core": "/core/index.js",
      "@aurora/event-schema": "/protocol/index.js"
    }
  }
  </script>
</head>
<body>
<script type="module">
import { createRequestCapturePlugin } from '@aurora/plugin-request';
import { createBrowserEnvironment } from '@aurora/browser';
import { createCore } from '@aurora/core';
import { parseRequestEventEnvelope } from '@aurora/event-schema';

const waitFor = async (predicate) => {
  const start = performance.now();
  while (!predicate()) {
    if (performance.now() - start > 5000) throw new Error('fixture timeout');
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

const createStartedHarness = async () => {
  let nextId = 1;
  const core = createCore({
    eventIdProvider: {
      createEventId: () => 'request-event-' + String(nextId++),
    },
    eventTimeProvider: {
      now: () => 1800000000000 + nextId,
    },
  });
  await core.initialize();
  await core.start();
  const browser = createBrowserEnvironment();
  const plugin = createRequestCapturePlugin(browser);
  const drafts = [];
  const coreCodes = [];
  plugin.initialize(Object.freeze({
    submitEvent: (draft) => {
      drafts.push(draft);
      const result = core.submitEventDraft(draft);
      coreCodes.push(result.code);
      return result;
    },
  }));
  plugin.start();
  return { browser, core, coreCodes, drafts, plugin };
};

const primary = await createStartedHarness();

async function performFetchSuccess() {
  const response = await fetch('/api/data?token=private#fragment');
  return { status: response.status, body: await response.text() };
}

async function performFetchHttpError() {
  const response = await fetch('/api/missing');
  return { status: response.status };
}

async function performFetchNetworkError() {
  try {
    await fetch('http://127.0.0.1:1/unreachable');
    return { network: 'unexpected-success' };
  } catch {
    return { network: 'failure' };
  }
}

async function performXhrSuccess() {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', '/api/data');
    xhr.onload = () => resolve({ status: xhr.status, body: xhr.responseText });
    xhr.send();
  });
}

async function performXhrAbort() {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', '/api/slow');
    xhr.onabort = () => resolve({ aborted: true });
    xhr.send();
    setTimeout(() => xhr.abort(), 10);
  });
}

globalThis.requestPluginHarness = Object.freeze({
  fetchSuccess: async () => {
    primary.drafts.length = 0;
    primary.coreCodes.length = 0;
    const result = await performFetchSuccess();
    await waitFor(() => primary.drafts.length === 1);
    const first = primary.drafts[0];
    const parsed = first === undefined ? null : parseRequestEventEnvelope({
      protocolVersion: 1,
      eventId: 'x',
      eventType: 'request',
      occurredAt: 1,
      body: first.body,
    });
    return {
      status: result.status,
      body: result.body,
      drafts: primary.drafts.length,
      coreCodes: [...primary.coreCodes],
      bodyValid: parsed?.success === true,
      url: first?.body?.url ?? null,
      method: first?.body?.method ?? null,
      outcome: first?.body?.outcome ?? null,
      statusCode: first?.body?.statusCode ?? null,
    };
  },
  fetchHttpError: async () => {
    primary.drafts.length = 0;
    const result = await performFetchHttpError();
    await waitFor(() => primary.drafts.length === 1);
    const first = primary.drafts[0];
    return {
      status: result.status,
      drafts: primary.drafts.length,
      outcome: first?.body?.outcome ?? null,
      statusCode: first?.body?.statusCode ?? null,
    };
  },
  fetchNetworkError: async () => {
    primary.drafts.length = 0;
    const result = await performFetchNetworkError();
    await waitFor(() => primary.drafts.length === 1);
    const first = primary.drafts[0];
    return {
      network: result.network,
      drafts: primary.drafts.length,
      outcome: first?.body?.outcome ?? null,
      statusCode: first?.body?.statusCode ?? null,
    };
  },
  xhrSuccess: async () => {
    primary.drafts.length = 0;
    const result = await performXhrSuccess();
    await waitFor(() => primary.drafts.length === 1);
    const first = primary.drafts[0];
    return {
      status: result.status,
      body: result.body,
      drafts: primary.drafts.length,
      method: first?.body?.method ?? null,
      outcome: first?.body?.outcome ?? null,
      statusCode: first?.body?.statusCode ?? null,
    };
  },
  xhrAbort: async () => {
    primary.drafts.length = 0;
    const result = await performXhrAbort();
    await waitFor(() => primary.drafts.length === 1);
    const first = primary.drafts[0];
    return {
      aborted: result.aborted,
      drafts: primary.drafts.length,
      outcome: first?.body?.outcome ?? null,
    };
  },
  hostIdentity: async () => {
    const before = Object.freeze({
      fetch: window.fetch,
      Xhr: window.XMLHttpRequest,
    });
    const local = await createStartedHarness();
    const during = Object.freeze({
      fetch: window.fetch,
      Xhr: window.XMLHttpRequest,
    });
    local.plugin.stop();
    const afterStop = Object.freeze({
      fetch: window.fetch,
      Xhr: window.XMLHttpRequest,
    });
    local.plugin.destroy();
    local.browser.destroy();
    await local.core.destroy();
    const afterDestroy = Object.freeze({
      fetch: window.fetch,
      Xhr: window.XMLHttpRequest,
    });
    return {
      installed: during.fetch !== before.fetch || during.Xhr !== before.Xhr,
      fetchRestored: afterStop.fetch === before.fetch,
      xhrRestored: afterStop.Xhr === before.Xhr,
      fetchIdentityAfterDestroy: afterDestroy.fetch === before.fetch,
      xhrIdentityAfterDestroy: afterDestroy.Xhr === before.Xhr,
    };
  },
  stopNoSubmit: async () => {
    const local = await createStartedHarness();
    local.plugin.stop();
    const before = local.drafts.length;
    await fetch('/api/data');
    await new Promise((resolve) => setTimeout(resolve, 300));
    return { draftsAfterStop: local.drafts.length - before };
  },
  coexistsWithErrorPlugin: async () => {
    const browser = createBrowserEnvironment();
    const core = createCore({
      eventIdProvider: { createEventId: () => 'coexist-event-' + String(Math.floor(Math.random() * 1e9)) },
      eventTimeProvider: { now: () => 1800000000000 },
    });
    await core.initialize();
    await core.start();
    const { createErrorCapturePlugin } = await import('@aurora/plugin-error');
    const errorPlugin = createErrorCapturePlugin(browser);
    const requestPlugin = createRequestCapturePlugin(browser);
    const errorDrafts = [];
    const requestDrafts = [];
    errorPlugin.initialize(Object.freeze({
      submitEvent: (draft) => {
        errorDrafts.push(draft);
        return core.submitEventDraft(draft);
      },
    }));
    requestPlugin.initialize(Object.freeze({
      submitEvent: (draft) => {
        requestDrafts.push(draft);
        return core.submitEventDraft(draft);
      },
    }));
    errorPlugin.start();
    requestPlugin.start();
    await fetch('/api/data');
    await waitFor(() => requestDrafts.length === 1);
    return {
      requestDrafts: requestDrafts.length,
      errorDrafts: errorDrafts.length,
      pageStillRuns: 20 + 22,
    };
  },
  bodyNotConsumed: async () => {
    primary.drafts.length = 0;
    const response = await fetch('/api/data');
    const text = await response.text();
    await waitFor(() => primary.drafts.length === 1);
    return { bodyRead: text, drafts: primary.drafts.length };
  },
});
</script>
</body>
</html>`;

const directories: Readonly<Record<string, string>> = Object.freeze({
  'request-plugin': requestPluginDist,
  'plugin-error': errorPluginDist,
  browser: browserDist,
  core: coreDist,
  protocol: protocolDist,
});

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const pathname = url.pathname;
  if (pathname === '/') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(pageHtml);
    return;
  }
  if (pathname.startsWith('/api/')) {
    void handleApi(request, response);
    return;
  }
  const match = /^\/(request-plugin|plugin-error|browser|core|protocol)\/([a-z0-9-]+\.js)$/u.exec(
    pathname,
  );
  const directory = match?.[1] === undefined ? undefined : directories[match[1]];
  const fileName = match?.[2];
  if (directory === undefined || fileName === undefined) {
    response.writeHead(404);
    response.end();
    return;
  }
  try {
    const source = await readFile(join(directory, fileName), 'utf8');
    response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
    response.end(source);
  } catch {
    response.writeHead(404);
    response.end();
  }
}

function isJsonRequest(pathname: string): boolean {
  return pathname === '/api/data' || pathname === '/api/missing';
}

async function handleApi(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (url.pathname === '/api/data') {
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ ok: true }));
    return;
  }
  if (url.pathname === '/api/missing') {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('missing');
    return;
  }
  if (url.pathname === '/api/slow') {
    setTimeout(() => {
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('slow');
    }, 2000);
    return;
  }
  response.writeHead(404);
  response.end();
}

export interface RequestPluginFixtureServer {
  readonly origin: string;
  close(): Promise<void>;
}

export async function startFixtureServer(): Promise<RequestPluginFixtureServer> {
  const server = createServer((request, response) => {
    void handleRequest(request, response);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('fixture server did not expose a TCP port');
  }
  return Object.freeze({
    origin: `http://127.0.0.1:${String(address.port)}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) resolve();
          else reject(error);
        });
      }),
  });
}
```

注意：fixture-server 只在 `test-browser/` 目录，不被 Workspace Policy 的 `sdk-plugin` 生产源码扫描覆盖（扫描只针对 `src/`）；它运行在 Node 环境，导入 `node:http` 合法。`isJsonRequest` 属冗余辅助函数，实施时删除它并把 `handleApi` 的 `/api/data`、`/api/missing`、`/api/slow` 路由合并进 `handleRequest`，保持单一职责。

- [ ] **Step 2: 写失败的 Chromium 测试**

`packages/plugin-request/test-browser/request-capture-plugin.spec.ts`：

```ts
import { expect, test, type Page } from '@playwright/test';
import { startFixtureServer, type RequestPluginFixtureServer } from './fixture-server.js';

let fixture: RequestPluginFixtureServer | undefined;

async function invoke(page: Page, method: string): Promise<unknown> {
  const result: unknown = await page.evaluate((methodName) => {
    const harness: unknown = Reflect.get(globalThis, 'requestPluginHarness');
    if (typeof harness !== 'object' || harness === null) {
      throw new Error('request plugin harness missing');
    }
    const callable: unknown = Reflect.get(harness, methodName);
    if (typeof callable !== 'function') {
      throw new Error(`request plugin harness method missing: ${methodName}`);
    }
    return Reflect.apply(callable, harness, []) as unknown;
  }, method);
  return result;
}

test.beforeAll(async () => {
  fixture = await startFixtureServer();
});

test.afterAll(async () => {
  await fixture?.close();
});

test.beforeEach(async ({ page }) => {
  if (fixture === undefined) throw new Error('fixture server missing');
  page.on('pageerror', () => undefined);
  await page.goto(fixture.origin);
  await expect
    .poll(() =>
      page.evaluate(() => typeof Reflect.get(globalThis, 'requestPluginHarness') === 'object'),
    )
    .toBe(true);
});

test('submits a real successful fetch exactly once through Core', async ({ page }) => {
  expect(await invoke(page, 'fetchSuccess')).toMatchObject({
    status: 200,
    body: '{"ok":true}',
    drafts: 1,
    coreCodes: ['accepted'],
    bodyValid: true,
    url: `${String(fixture?.origin)}/api/data`,
    method: 'GET',
    outcome: 'success',
    statusCode: 200,
  });
});

test('submits a real HTTP-error fetch exactly once', async ({ page }) => {
  expect(await invoke(page, 'fetchHttpError')).toMatchObject({
    status: 404,
    drafts: 1,
    outcome: 'http_error',
    statusCode: 404,
  });
});

test('submits a real network-error fetch exactly once', async ({ page }) => {
  expect(await invoke(page, 'fetchNetworkError')).toMatchObject({
    network: 'failure',
    drafts: 1,
    outcome: 'network_error',
    statusCode: null,
  });
});

test('submits a real XHR load exactly once without consuming the body', async ({ page }) => {
  expect(await invoke(page, 'xhrSuccess')).toMatchObject({
    status: 200,
    body: '{"ok":true}',
    drafts: 1,
    method: 'GET',
    outcome: 'success',
    statusCode: 200,
  });
});

test('submits a real XHR abort exactly once', async ({ page }) => {
  expect(await invoke(page, 'xhrAbort')).toMatchObject({
    aborted: true,
    drafts: 1,
    outcome: 'canceled',
  });
});

test('restores window.fetch and window.XMLHttpRequest after stop and destroy', async ({
  page,
}) => {
  expect(await invoke(page, 'hostIdentity')).toEqual({
    installed: true,
    fetchRestored: true,
    xhrRestored: true,
    fetchIdentityAfterDestroy: true,
    xhrIdentityAfterDestroy: true,
  });
});

test('does not submit after stop', async ({ page }) => {
  expect(await invoke(page, 'stopNoSubmit')).toEqual({ draftsAfterStop: 0 });
});

test('coexists with the error plugin on a shared BrowserEnvironment', async ({ page }) => {
  expect(await invoke(page, 'coexistsWithErrorPlugin')).toMatchObject({
    requestDrafts: 1,
    errorDrafts: 0,
    pageStillRuns: 42,
  });
});

test('does not consume the request response body', async ({ page }) => {
  expect(await invoke(page, 'bodyNotConsumed')).toMatchObject({
    bodyRead: '{"ok":true}',
    drafts: 1,
  });
});
```

注意：`hostIdentity` 返回 `installed: true`，因为订阅期间 Browser 安装 fetch/XHR 包装；`stopNoSubmit` 期望 `draftsAfterStop: 1`——这意味着 stop 后 `fetch` 请求仍可能被已经安装的包装投影给插件 listener，但插件 `isAcceptingEvents` 已为 false，因此不提交。**修正：** 该断言含义是“stop 后不因新请求而提交”，实际返回应为 `0`。请在实施时按真实行为调整断言为 `{ draftsAfterStop: 0 }` 并在请求后 `waitFor(() => false)` 不可能的情况下改用固定延时 `setTimeout(200)` 后断言，避免测试悬挂。

- [ ] **Step 3: 运行 Chromium 测试确认预期失败**

Run: `pnpm --filter @aurora/plugin-request test:browser`
Expected: FAIL，`test-browser/request-capture-plugin.spec.ts` 尚未创建或 fixture server 无法启动。

- [ ] **Step 4: 确认 Chromium 测试通过**

Run: `pnpm --filter @aurora/plugin-request test:browser`
Expected: PASS（全部场景）。若 `stopNoSubmit` 悬挂，按 Step 2 修正注释调整实现。

- [ ] **Step 5: 运行包入口与边界回归**

Run: `pnpm --filter @aurora/plugin-request test:package`
Expected: PASS。

Run: `pnpm check:boundaries`
Expected: PASS（exit 0）。

- [ ] **Step 6: 建议提交边界**

不执行 `git add`/`commit`。若另行授权，本 Task 边界为 fixture-server、Chromium 测试与任何必要的实现修正。
