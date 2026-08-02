# Browser Error Capture Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first `@aurora/plugin-error` increment that converts three public Browser error-source facts into validated error event bodies and submits only minimal drafts through the public Core plugin context.

**Architecture:** The caller owns and injects one public `BrowserEnvironment`; the plugin owns only its subscription and per-instance bounded diagnostics. Conversion is synchronous and source-specific, every candidate body is normalized by `@aurora/event-schema`, and only `{ eventType: EventType.Error, body }` reaches Core, so ID, time, protocol version, envelope creation, and final submission remain Core responsibilities.

**Tech Stack:** TypeScript 6.0.3 strict mode, pnpm 11.17.0 Workspace, Node.js 24.18.x task runtime, Vitest 4.1.10, V8 coverage, Playwright 1.62.0 with Chromium, ESLint 10.8.0, Prettier 3.9.6, existing `@aurora/workspace-policy`.

## Global Constraints

- Implement only `packages/plugin-error`; do not add request, performance, behavior, framework, server, database, platform, CI, release, container, IaC, or cloud code.
- Runtime dependencies are exactly `@aurora/core`, `@aurora/browser`, and `@aurora/event-schema`, each imported only through its package root.
- Do not change the public API of Core, Browser, or event-schema.
- Do not create an `EventEnvelope`, protocol version, event ID, event time, queue, batch, sender, retry path, persistence layer, sampler, deduplicator, grouping key, fingerprint, Source Map, Stack Frame mapper, or general event bus.
- Do not access `window`, `document`, DOM types, Node runtime modules, Browser private listener code, Core private state, event-schema private validation code, or any cross-package `src`/`internal` path from plugin production source.
- Do not overwrite `window.onerror` or `window.onunhandledrejection`; do not call `preventDefault()`, `stopPropagation()`, or `stopImmediatePropagation()`; do not mutate native events, Error objects, Promise reasons, DOM nodes, globals, or prototypes.
- Never retain native Event, DOM, Error, or raw Promise reason references after the synchronous Browser callback.
- Diagnostics are per instance, fixed at the latest 100 entries, frozen, bounded, and limited to sequence, stable code, stable operation, and optional public source type.
- Production diagnostics and logs contain no exception object/message/stack, event body, URL, Cookie, Token, Authorization, Storage, request/response body, form, DOM, page text, user input, fingerprint, or IP; production source does not call `console`.
- TypeScript remains `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `useUnknownInCatchVariables`; public functions have explicit parameter and return types.
- Do not use unexplained `any`, `Object`, `Function`, `Record<string, any>`, double assertions, non-null assertions, or error-suppression directives.
- Files use `kebab-case`; types/interfaces use `PascalCase`; functions/variables use `camelCase`; booleans use `is`, `has`, `can`, or `should`.
- Do not create `utils`, `helpers`, `common`, or `misc`; every source file has the single responsibility listed below.
- Coverage thresholds are lines 85%, branches 80%, functions 85%, and statements 85%; do not exclude production decision files or lower thresholds.
- Each task uses the red-green-minimal implementation-regression sequence and ends with a suggested, narrowly scoped commit boundary. Do not stage or commit unrelated pre-existing work.
- The specification is `docs/sdk/error-capture-plugin.md`; if code and this plan differ, stop and resolve the specification before broadening the implementation.

## Complete File Tree and Responsibilities

```text
packages/plugin-error/
├── README.md                         # Public use, lifecycle, diagnostics, privacy, exclusions
├── package.json                      # Private sdk-plugin manifest, scripts, exact dependencies
├── playwright.config.ts              # One headless Chromium project
├── tsconfig.build.json               # ES-only production declaration build
├── tsconfig.json                     # Strict package/test/browser-test checking
├── tsconfig.no-dom.json              # Proves production API needs no direct DOM
├── vitest.config.ts                  # Unit scope and fixed 85/80/85/85 thresholds
├── src/
│   ├── diagnostics.ts                # Fixed public diagnostic constants and per-instance store
│   ├── error-capture-plugin.ts       # Factory, CorePlugin lifecycle, Browser subscription ownership
│   ├── error-descriptor.ts           # Safe bounded Error text reading and minimal free-text redaction
│   ├── index.ts                      # The only public package root
│   ├── javascript-error-converter.ts # JavaScript source fact to parsed JavaScript body
│   ├── promise-rejection-converter.ts# Promise source fact to parsed rejection body
│   ├── resource-error-converter.ts   # Browser resource fact to parsed protocol resource body
│   └── source-event-handler.ts       # Discrimination, re-entry guard, submit result isolation
├── test/
│   ├── architecture-boundary.test.ts # Manifest, exports, imports, side effects, forbidden source scan
│   ├── contract.test.ts              # Exact public runtime and TypeScript contract
│   ├── documentation-contract.test.ts# README example compiles and exercises public behavior
│   ├── host-safety.test.ts           # No mutation/control/retention; callback failures contained
│   ├── javascript-error-converter.test.ts
│   ├── lifecycle.test.ts             # Hook idempotency, rollback result, release, restart, destroy
│   ├── multi-instance.test.ts        # Independent subscriptions, failures, diagnostics, destruction
│   ├── no-dom-consumer.ts            # ES-only consumer of the public production contract
│   ├── package-entry.test.ts         # Built root loads; private subpaths fail
│   ├── promise-rejection-converter.test.ts
│   ├── resource-error-converter.test.ts
│   └── submission.test.ts            # Schema/Core failures, drafts, recovery, recursion
└── test-browser/
    ├── error-capture-plugin.spec.ts  # Real Chromium three-source, host, release, isolation checks
    └── fixture-server.ts             # Local import-map server for built public roots
```

Existing files modified by this plan:

```text
package.json
pnpm-lock.yaml
eslint.config.mjs
tooling/workspace-policy/README.md
tooling/workspace-policy/src/environment.ts
tooling/workspace-policy/src/graph.ts
tooling/workspace-policy/test/dependency-policy.test.ts
tooling/workspace-policy/test/environment.test.ts
README.md
AGENTS.md
AURORA_RULES.md
docs/README.md
docs/architecture/sdk-architecture.md
docs/architecture/formalization-readiness.md
docs/testing/test-strategy.md
docs/adr/ADR-003-sdk-plugin-architecture.md
docs/adr/ADR-005-event-schema-source-of-truth.md
docs/adr/ADR-006-one-way-dependencies.md
docs/sdk/error-capture-plugin.md
```

## Frozen Public Signatures

```ts
import type { BrowserEnvironment, BrowserErrorSourceEventType } from '@aurora/browser';
import type { CorePlugin, CorePluginContext } from '@aurora/core';

export const ERROR_CAPTURE_PLUGIN_NAME = 'error-capture' as const;

export const ErrorCaptureDiagnosticCode: Readonly<{
  InvalidLifecycleCall: 'invalid_lifecycle_call';
  InvalidPluginContext: 'invalid_plugin_context';
  BrowserSubscriptionFailed: 'browser_subscription_failed';
  BrowserUnsubscribeFailed: 'browser_unsubscribe_failed';
  UnsupportedSource: 'unsupported_source';
  ErrorBodyRejected: 'error_body_rejected';
  EventSubmissionFailed: 'event_submission_failed';
  RecursiveCaptureBlocked: 'recursive_capture_blocked';
  InternalError: 'internal_error';
}>;

export type ErrorCaptureDiagnosticCode =
  (typeof ErrorCaptureDiagnosticCode)[keyof typeof ErrorCaptureDiagnosticCode];

export const ErrorCaptureDiagnosticOperation: Readonly<{
  Initialize: 'initialize';
  Start: 'start';
  Stop: 'stop';
  Destroy: 'destroy';
  Convert: 'convert';
  Submit: 'submit';
  Notify: 'notify';
}>;

export type ErrorCaptureDiagnosticOperation =
  (typeof ErrorCaptureDiagnosticOperation)[keyof typeof ErrorCaptureDiagnosticOperation];

export interface ErrorCaptureDiagnostic {
  readonly sequence: number;
  readonly code: ErrorCaptureDiagnosticCode;
  readonly operation: ErrorCaptureDiagnosticOperation;
  readonly sourceType?: BrowserErrorSourceEventType;
}

export interface ErrorCapturePlugin extends CorePlugin {
  readonly name: typeof ERROR_CAPTURE_PLUGIN_NAME;
  initialize(context: CorePluginContext): void;
  start(): void;
  stop(): void;
  destroy(): void;
  getDiagnostics(): readonly ErrorCaptureDiagnostic[];
}

export function createErrorCapturePlugin(browser: BrowserEnvironment): ErrorCapturePlugin;
```

The factory and all hooks are synchronous. Expected lifecycle and source failures do not throw; they append a stable diagnostic. Repeated initialize/start/stop/destroy calls are idempotent, except initialize/start after destroy append `invalid_lifecycle_call`. A failed Browser subscription leaves the plugin inactive and permits a later stop/start retry. Destroy permanently prevents restart.

---

### Task 1: Add the Package Shell and Enforce the `sdk-plugin` Dependency Layer

**Files:**

- Create: `packages/plugin-error/package.json`
- Create: `packages/plugin-error/tsconfig.json`
- Create: `packages/plugin-error/tsconfig.build.json`
- Create: `packages/plugin-error/tsconfig.no-dom.json`
- Create: `packages/plugin-error/vitest.config.ts`
- Create: `packages/plugin-error/playwright.config.ts`
- Create: `packages/plugin-error/src/index.ts`
- Create: `packages/plugin-error/test/no-dom-consumer.ts`
- Modify: `tooling/workspace-policy/src/graph.ts`
- Modify: `tooling/workspace-policy/src/environment.ts`
- Modify: `tooling/workspace-policy/test/dependency-policy.test.ts`
- Modify: `tooling/workspace-policy/test/environment.test.ts`
- Modify: `tooling/workspace-policy/README.md`
- Modify: `eslint.config.mjs`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Consumes: Workspace manifest field `aurora.layer`, `checkWorkspace(rootDir: string): Promise<WorkspaceCheckResult>`, existing violation codes `forbidden-layer-dependency`, `private-path-import`, `dependency-cycle`, `forbidden-runtime-global`, `mutable-module-state`, `forbidden-host-mutation`, `forbidden-host-event-control`.
- Produces: a private `@aurora/plugin-error` package with one root export, `sdk-plugin -> sdk-core | sdk-browser | protocol` policy, and no-DOM production compilation.

- [ ] **Step 1: Write the failing Workspace Policy tests**

Append these cases to `tooling/workspace-policy/test/dependency-policy.test.ts`:

```ts
it.each(['sdk-core', 'sdk-browser', 'protocol'] as const)(
  'allows sdk-plugin to depend on %s',
  async (layer) => {
    const plugin = validManifest('@aurora/plugin-error');
    plugin.aurora = { layer: 'sdk-plugin' };
    plugin.dependencies = { '@aurora/target': 'workspace:*' };
    const target = validManifest('@aurora/target');
    target.aurora = { layer };
    fixture = await createWorkspaceFixture([
      { directory: 'packages/plugin-error', manifest: plugin },
      { directory: 'packages/target', manifest: target },
    ]);
    await expect(checkWorkspace(fixture.rootDir)).resolves.toEqual({
      ok: true,
      violations: [],
    });
  },
);

it.each(['sdk-plugin', 'framework', 'tooling'] as const)(
  'rejects sdk-plugin dependency on %s',
  async (layer) => {
    const plugin = validManifest('@aurora/plugin-error');
    plugin.aurora = { layer: 'sdk-plugin' };
    plugin.dependencies = { '@aurora/target': 'workspace:*' };
    const target = validManifest('@aurora/target');
    target.aurora = { layer };
    fixture = await createWorkspaceFixture([
      { directory: 'packages/plugin-error', manifest: plugin },
      { directory: 'packages/target', manifest: target },
    ]);
    const result = await checkWorkspace(fixture.rootDir);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'forbidden-layer-dependency',
          packageName: '@aurora/plugin-error',
        }),
      ]),
    );
  },
);

it('rejects plugin private imports and reverse dependencies', async () => {
  const plugin = validManifest('@aurora/plugin-error');
  plugin.aurora = { layer: 'sdk-plugin' };
  plugin.dependencies = { '@aurora/core': 'workspace:*' };
  const core = validManifest('@aurora/core');
  core.aurora = { layer: 'sdk-core' };
  core.dependencies = { '@aurora/plugin-error': 'workspace:*' };
  fixture = await createWorkspaceFixture([
    {
      directory: 'packages/plugin-error',
      manifest: plugin,
      files: {
        'src/index.ts': "import type { CorePlugin } from '@aurora/core/src/plugin-contract.js';",
      },
    },
    { directory: 'packages/core', manifest: core },
  ]);
  const result = await checkWorkspace(fixture.rootDir);
  expect(result.violations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: 'private-path-import' }),
      expect.objectContaining({
        code: 'forbidden-layer-dependency',
        packageName: '@aurora/core',
      }),
      expect.objectContaining({ code: 'dependency-cycle' }),
    ]),
  );
});
```

Add a `createPluginSource` fixture and these cases to `tooling/workspace-policy/test/environment.test.ts`:

```ts
async function createPluginSource(source: string): Promise<WorkspaceFixture> {
  const plugin = validManifest('@aurora/plugin-error');
  plugin.aurora = { layer: 'sdk-plugin' };
  return createWorkspaceFixture([
    { directory: 'packages/plugin-error', manifest: plugin, files: { 'src/index.ts': source } },
  ]);
}

describe('sdk-plugin source policy', () => {
  it.each([
    'export const leaked = window;',
    'export const leaked = document;',
    'export const leaked = navigator;',
    'export const leaked = globalThis;',
    "import { randomUUID } from 'node:crypto'; export const id = randomUUID();",
  ])('rejects direct environment access: %s', async (source) => {
    fixture = await createPluginSource(source);
    const result = await checkWorkspace(fixture.rootDir);
    expect(result.violations).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'forbidden-runtime-global' })]),
    );
  });

  it.each([
    'let active = false; export const read = (): boolean => active;',
    'const entries: string[] = []; export const read = (): number => entries.length;',
    'const listeners = new Set<string>(); export const read = (): number => listeners.size;',
  ])('rejects module-level mutable state: %s', async (source) => {
    fixture = await createPluginSource(source);
    const result = await checkWorkspace(fixture.rootDir);
    expect(result.violations).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'mutable-module-state' })]),
    );
  });

  it.each([
    'window.onerror = null;',
    'event.preventDefault();',
    'event.stopPropagation();',
    'event.stopImmediatePropagation();',
  ])('rejects host mutation or event control: %s', async (statement) => {
    fixture = await createPluginSource(`export function run(event: Event): void { ${statement} }`);
    const result = await checkWorkspace(fixture.rootDir);
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests and verify the expected failure**

Run:

```powershell
pnpm --filter @aurora/workspace-policy exec vitest run test/dependency-policy.test.ts test/environment.test.ts
```

Expected: exit 1. The allow cases fail because `sdk-plugin` has no allowed dependency row, and environment cases fail because the source inspector does not yet inspect `sdk-plugin`.

- [ ] **Step 3: Implement the layer and source-policy minimum**

Add the row to `allowedLocalDependencyLayers` in `tooling/workspace-policy/src/graph.ts`:

```ts
['sdk-plugin', new Set<string>(['sdk-core', 'sdk-browser', 'protocol'])],
```

In `tooling/workspace-policy/src/environment.ts`, extend the inspected layer union to:

```ts
type InspectedLayer = 'protocol' | 'sdk-core' | 'sdk-browser' | 'sdk-plugin';
```

Use these plugin-specific sets:

```ts
const forbiddenPluginRuntimeNames: ReadonlySet<string> = new Set([
  'window',
  'document',
  'navigator',
  'location',
  'globalThis',
  'fetch',
  'XMLHttpRequest',
  'localStorage',
  'sessionStorage',
  'process',
  'Buffer',
  'require',
  'module',
  '__dirname',
  '__filename',
]);
```

Apply the existing module-level mutable-state rule to `sdk-plugin`; apply the existing host-mutation and host-event-control predicates to both `sdk-browser` and `sdk-plugin`; for `sdk-plugin`, emit `forbidden-runtime-global` for the set above and every `node:` import. Extend `findEnvironmentViolations()` so `sdk-plugin` reaches `inspectSource()`.

Create `packages/plugin-error/package.json` exactly as:

```json
{
  "name": "@aurora/plugin-error",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "description": "Aurora browser error capture plugin",
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
  "files": ["dist", "README.md"],
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

Create the configs:

```json
// packages/plugin-error/tsconfig.json
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

```json
// packages/plugin-error/tsconfig.build.json
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

```json
// packages/plugin-error/tsconfig.no-dom.json
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

```ts
// packages/plugin-error/vitest.config.ts
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

```ts
// packages/plugin-error/playwright.config.ts
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

Create the package's valid zero-export baseline; Task 2 replaces this complete file:

```ts
// packages/plugin-error/src/index.ts
export {};
```

Create the no-DOM consumer:

```ts
// packages/plugin-error/test/no-dom-consumer.ts
import type { BrowserEnvironment } from '@aurora/browser';
import type { CorePlugin } from '@aurora/core';
import type { ErrorEventBody } from '@aurora/event-schema';

export type PluginBoundaryProof = readonly [BrowserEnvironment, CorePlugin, ErrorEventBody];
```

Extend the common ESLint typed file glob to include `packages/plugin-error/**/*.ts`; add a `packages/plugin-error/src/**/*.ts` block that forbids the same direct runtime globals, host mutation selectors, and event-control call selectors used by Workspace Policy.

Run `pnpm install --lockfile-only` once to add only the new Workspace importer using versions already present in the lockfile. Verify the diff contains no dependency upgrade.

- [ ] **Step 4: Verify the package and policy pass**

Run:

```powershell
pnpm --filter @aurora/workspace-policy exec vitest run test/dependency-policy.test.ts test/environment.test.ts
pnpm --filter @aurora/plugin-error typecheck
pnpm check:boundaries
```

Expected: each command exits 0; Workspace tests report all selected files passed; typecheck emits no diagnostics; boundary output is empty.

- [ ] **Step 5: Run the relevant regression**

Run:

```powershell
pnpm --filter @aurora/workspace-policy test
pnpm --filter @aurora/core typecheck
pnpm --filter @aurora/browser typecheck
pnpm --filter @aurora/event-schema typecheck
```

Expected: exit 0 for every command. Core still passes its no-DOM check; no upstream source file changes.

- [ ] **Step 6: Record the suggested commit boundary**

Suggested commands for the later implementation session:

```powershell
git add packages/plugin-error/package.json packages/plugin-error/tsconfig.json packages/plugin-error/tsconfig.build.json packages/plugin-error/tsconfig.no-dom.json packages/plugin-error/vitest.config.ts packages/plugin-error/playwright.config.ts packages/plugin-error/src/index.ts packages/plugin-error/test/no-dom-consumer.ts tooling/workspace-policy/src/graph.ts tooling/workspace-policy/src/environment.ts tooling/workspace-policy/test/dependency-policy.test.ts tooling/workspace-policy/test/environment.test.ts tooling/workspace-policy/README.md eslint.config.mjs pnpm-lock.yaml
git commit -m "build: add error plugin package boundary"
```

### Task 2: Freeze the Public Contract, Diagnostics, and Lifecycle Shell

**Files:**

- Create: `packages/plugin-error/src/diagnostics.ts`
- Create: `packages/plugin-error/src/error-capture-plugin.ts`
- Modify: `packages/plugin-error/src/index.ts`
- Create: `packages/plugin-error/test/contract.test.ts`
- Create: `packages/plugin-error/test/lifecycle.test.ts`

**Interfaces:**

- Consumes: `BrowserEnvironment.subscribeErrorSources(listener): BrowserSubscribeResult`, `BrowserSubscription.unsubscribe(): BrowserUnsubscribeResult`, `CorePlugin`, `CorePluginContext`.
- Produces: all frozen public signatures in this plan, `DiagnosticStore.append(input): void`, `DiagnosticStore.snapshot(): readonly ErrorCaptureDiagnostic[]`, and a lifecycle-correct plugin whose listener intentionally performs no conversion until Tasks 3–7.

- [ ] **Step 1: Write the failing public and lifecycle tests**

Create `packages/plugin-error/test/contract.test.ts`:

```ts
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { CorePlugin, CorePluginContext } from '@aurora/core';
import {
  ERROR_CAPTURE_PLUGIN_NAME,
  ErrorCaptureDiagnosticCode,
  ErrorCaptureDiagnosticOperation,
  createErrorCapturePlugin,
  type ErrorCaptureDiagnostic,
  type ErrorCapturePlugin,
} from '../src/index.js';

describe('error capture public contract', () => {
  it('exports the exact stable runtime constants', () => {
    expect(ERROR_CAPTURE_PLUGIN_NAME).toBe('error-capture');
    expect(ErrorCaptureDiagnosticCode).toEqual({
      InvalidLifecycleCall: 'invalid_lifecycle_call',
      InvalidPluginContext: 'invalid_plugin_context',
      BrowserSubscriptionFailed: 'browser_subscription_failed',
      BrowserUnsubscribeFailed: 'browser_unsubscribe_failed',
      UnsupportedSource: 'unsupported_source',
      ErrorBodyRejected: 'error_body_rejected',
      EventSubmissionFailed: 'event_submission_failed',
      RecursiveCaptureBlocked: 'recursive_capture_blocked',
      InternalError: 'internal_error',
    });
    expect(ErrorCaptureDiagnosticOperation).toEqual({
      Initialize: 'initialize',
      Start: 'start',
      Stop: 'stop',
      Destroy: 'destroy',
      Convert: 'convert',
      Submit: 'submit',
      Notify: 'notify',
    });
    expect(Object.isFrozen(ErrorCaptureDiagnosticCode)).toBe(true);
    expect(Object.isFrozen(ErrorCaptureDiagnosticOperation)).toBe(true);
  });

  it('is exactly a CorePlugin plus frozen diagnostics', () => {
    expectTypeOf<ErrorCapturePlugin>().toMatchTypeOf<CorePlugin>();
    expectTypeOf<ErrorCapturePlugin['initialize']>()
      .parameter(0)
      .toEqualTypeOf<CorePluginContext>();
    expectTypeOf<ErrorCapturePlugin['getDiagnostics']>().returns.toEqualTypeOf<
      readonly ErrorCaptureDiagnostic[]
    >();
    expectTypeOf(createErrorCapturePlugin).parameters.toHaveLength(1);
  });
});
```

Create `packages/plugin-error/test/lifecycle.test.ts`:

```ts
import type {
  BrowserEnvironment,
  BrowserErrorSourceListener,
  BrowserSubscription,
} from '@aurora/browser';
import type { CorePluginContext } from '@aurora/core';
import { describe, expect, it, vi } from 'vitest';
import { createErrorCapturePlugin } from '../src/index.js';

function createBrowserDouble(options: { readonly subscriptionFails?: boolean } = {}): {
  readonly browser: BrowserEnvironment;
  readonly listeners: BrowserErrorSourceListener[];
  readonly unsubscribe: ReturnType<typeof vi.fn>;
  readonly destroy: ReturnType<typeof vi.fn>;
} {
  const listeners: BrowserErrorSourceListener[] = [];
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
      subscribeErrorSources: vi.fn((listener: BrowserErrorSourceListener) => {
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

describe('error capture lifecycle', () => {
  it('subscribes once, stops once, restarts, and destroys without owning Browser', () => {
    const fixture = createBrowserDouble();
    const plugin = createErrorCapturePlugin(fixture.browser);
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
    const plugin = createErrorCapturePlugin(fixture.browser);
    plugin.initialize(context);
    expect(() => plugin.start()).not.toThrow();
    expect(plugin.getDiagnostics()).toEqual([
      {
        sequence: 1,
        code: 'browser_subscription_failed',
        operation: 'start',
      },
    ]);
    plugin.stop();
    plugin.start();
    expect(plugin.getDiagnostics()).toHaveLength(2);
  });

  it('never restarts after destroy and returns immutable diagnostic copies', () => {
    const fixture = createBrowserDouble();
    const plugin = createErrorCapturePlugin(fixture.browser);
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
});
```

- [ ] **Step 2: Run the tests and verify the expected failure**

Run:

```powershell
pnpm --filter @aurora/plugin-error exec vitest run test/contract.test.ts test/lifecycle.test.ts
```

Expected: exit 1 with missing exports from `src/index.ts`.

- [ ] **Step 3: Implement diagnostics and the minimal lifecycle**

Create `packages/plugin-error/src/diagnostics.ts`:

```ts
import type { BrowserErrorSourceEventType } from '@aurora/browser';

const MAX_DIAGNOSTICS = 100;

export const ErrorCaptureDiagnosticCode = Object.freeze({
  InvalidLifecycleCall: 'invalid_lifecycle_call',
  InvalidPluginContext: 'invalid_plugin_context',
  BrowserSubscriptionFailed: 'browser_subscription_failed',
  BrowserUnsubscribeFailed: 'browser_unsubscribe_failed',
  UnsupportedSource: 'unsupported_source',
  ErrorBodyRejected: 'error_body_rejected',
  EventSubmissionFailed: 'event_submission_failed',
  RecursiveCaptureBlocked: 'recursive_capture_blocked',
  InternalError: 'internal_error',
} as const);

export type ErrorCaptureDiagnosticCode =
  (typeof ErrorCaptureDiagnosticCode)[keyof typeof ErrorCaptureDiagnosticCode];

export const ErrorCaptureDiagnosticOperation = Object.freeze({
  Initialize: 'initialize',
  Start: 'start',
  Stop: 'stop',
  Destroy: 'destroy',
  Convert: 'convert',
  Submit: 'submit',
  Notify: 'notify',
} as const);

export type ErrorCaptureDiagnosticOperation =
  (typeof ErrorCaptureDiagnosticOperation)[keyof typeof ErrorCaptureDiagnosticOperation];

export interface ErrorCaptureDiagnostic {
  readonly sequence: number;
  readonly code: ErrorCaptureDiagnosticCode;
  readonly operation: ErrorCaptureDiagnosticOperation;
  readonly sourceType?: BrowserErrorSourceEventType;
}

export type ErrorCaptureDiagnosticInput = Omit<ErrorCaptureDiagnostic, 'sequence'>;

export interface ErrorCaptureDiagnosticStore {
  append(input: ErrorCaptureDiagnosticInput): void;
  snapshot(): readonly ErrorCaptureDiagnostic[];
}

export function createErrorCaptureDiagnosticStore(): ErrorCaptureDiagnosticStore {
  const entries: ErrorCaptureDiagnostic[] = [];
  let nextSequence = 1;
  return Object.freeze({
    append(input: ErrorCaptureDiagnosticInput): void {
      entries.push(Object.freeze({ sequence: nextSequence, ...input }));
      nextSequence += 1;
      if (entries.length > MAX_DIAGNOSTICS) entries.shift();
    },
    snapshot(): readonly ErrorCaptureDiagnostic[] {
      return Object.freeze([...entries]);
    },
  });
}
```

Create the lifecycle shell in `packages/plugin-error/src/error-capture-plugin.ts`:

```ts
import type {
  BrowserEnvironment,
  BrowserErrorSourceListener,
  BrowserSubscription,
} from '@aurora/browser';
import type { CorePlugin, CorePluginContext } from '@aurora/core';
import {
  createErrorCaptureDiagnosticStore,
  ErrorCaptureDiagnosticCode,
  ErrorCaptureDiagnosticOperation,
  type ErrorCaptureDiagnostic,
} from './diagnostics.js';

export const ERROR_CAPTURE_PLUGIN_NAME = 'error-capture' as const;

export interface ErrorCapturePlugin extends CorePlugin {
  readonly name: typeof ERROR_CAPTURE_PLUGIN_NAME;
  initialize(context: CorePluginContext): void;
  start(): void;
  stop(): void;
  destroy(): void;
  getDiagnostics(): readonly ErrorCaptureDiagnostic[];
}

export function createErrorCapturePlugin(browser: BrowserEnvironment): ErrorCapturePlugin {
  const diagnostics = createErrorCaptureDiagnosticStore();
  let context: CorePluginContext | undefined;
  let subscription: BrowserSubscription | undefined;
  let isDestroyed = false;
  const listener: BrowserErrorSourceListener = (): void => undefined;

  function initialize(nextContext: CorePluginContext): void {
    if (isDestroyed) {
      diagnostics.append({
        code: ErrorCaptureDiagnosticCode.InvalidLifecycleCall,
        operation: ErrorCaptureDiagnosticOperation.Initialize,
      });
      return;
    }
    if (context !== undefined) return;
    try {
      const submitEvent = nextContext.submitEvent;
      if (typeof submitEvent !== 'function') {
        diagnostics.append({
          code: ErrorCaptureDiagnosticCode.InvalidPluginContext,
          operation: ErrorCaptureDiagnosticOperation.Initialize,
        });
        return;
      }
      context = Object.freeze({
        submitEvent: (input: unknown) => submitEvent(input),
      });
    } catch {
      diagnostics.append({
        code: ErrorCaptureDiagnosticCode.InvalidPluginContext,
        operation: ErrorCaptureDiagnosticOperation.Initialize,
      });
    }
  }

  function start(): void {
    if (isDestroyed || context === undefined) {
      diagnostics.append({
        code: ErrorCaptureDiagnosticCode.InvalidLifecycleCall,
        operation: ErrorCaptureDiagnosticOperation.Start,
      });
      return;
    }
    if (subscription !== undefined) return;
    try {
      const result = browser.subscribeErrorSources(listener);
      if (!result.ok) {
        diagnostics.append({
          code: ErrorCaptureDiagnosticCode.BrowserSubscriptionFailed,
          operation: ErrorCaptureDiagnosticOperation.Start,
        });
        return;
      }
      subscription = result.subscription;
    } catch {
      diagnostics.append({
        code: ErrorCaptureDiagnosticCode.BrowserSubscriptionFailed,
        operation: ErrorCaptureDiagnosticOperation.Start,
      });
    }
  }

  function release(
    operation:
      typeof ErrorCaptureDiagnosticOperation.Stop | typeof ErrorCaptureDiagnosticOperation.Destroy,
  ): void {
    const current = subscription;
    subscription = undefined;
    if (current === undefined) return;
    try {
      const result = current.unsubscribe();
      if (result.diagnosticsAdded > 0) {
        diagnostics.append({
          code: ErrorCaptureDiagnosticCode.BrowserUnsubscribeFailed,
          operation,
        });
      }
    } catch {
      diagnostics.append({
        code: ErrorCaptureDiagnosticCode.BrowserUnsubscribeFailed,
        operation,
      });
    }
  }

  function stop(): void {
    release(ErrorCaptureDiagnosticOperation.Stop);
  }

  function destroy(): void {
    if (isDestroyed) return;
    release(ErrorCaptureDiagnosticOperation.Destroy);
    context = undefined;
    isDestroyed = true;
  }

  return Object.freeze({
    name: ERROR_CAPTURE_PLUGIN_NAME,
    initialize,
    start,
    stop,
    destroy,
    getDiagnostics: (): readonly ErrorCaptureDiagnostic[] => diagnostics.snapshot(),
  });
}
```

Replace `packages/plugin-error/src/index.ts` with:

```ts
export {
  ERROR_CAPTURE_PLUGIN_NAME,
  createErrorCapturePlugin,
  type ErrorCapturePlugin,
} from './error-capture-plugin.js';
export {
  ErrorCaptureDiagnosticCode,
  ErrorCaptureDiagnosticOperation,
  type ErrorCaptureDiagnostic,
  type ErrorCaptureDiagnosticCode,
  type ErrorCaptureDiagnosticOperation,
} from './diagnostics.js';
```

- [ ] **Step 4: Run the tests and verify they pass**

Run:

```powershell
pnpm --filter @aurora/plugin-error exec vitest run test/contract.test.ts test/lifecycle.test.ts
pnpm --filter @aurora/plugin-error typecheck
```

Expected: exit 0; 2 test files pass; typecheck emits no diagnostics.

- [ ] **Step 5: Run Task-level regression**

Run:

```powershell
pnpm --filter @aurora/browser exec vitest run test/error-source-contract.test.ts test/error-source.test.ts
pnpm --filter @aurora/core exec vitest run test/plugin-lifecycle.test.ts test/event-creation.test.ts
```

Expected: exit 0; Browser subscription and Core plugin/draft behavior remain green.

- [ ] **Step 6: Record the suggested commit boundary**

```powershell
git add packages/plugin-error/src/diagnostics.ts packages/plugin-error/src/error-capture-plugin.ts packages/plugin-error/src/index.ts packages/plugin-error/test/contract.test.ts packages/plugin-error/test/lifecycle.test.ts
git commit -m "feat: add error capture plugin lifecycle"
```

### Task 3: Convert JavaScript Error Sources with Bounded, Redacted Descriptors

**Files:**

- Create: `packages/plugin-error/src/error-descriptor.ts`
- Create: `packages/plugin-error/src/javascript-error-converter.ts`
- Create: `packages/plugin-error/test/javascript-error-converter.test.ts`

**Interfaces:**

- Consumes: `BrowserJavaScriptErrorSourceEvent`, `ERROR_EVENT_LIMITS`, `ErrorCategory.JavaScript`, `parseErrorEventBody(input: unknown): ErrorEventBodyParseResult`.
- Produces: `sanitizeErrorText(input: unknown, maxLength: number): string | undefined`, `createErrorDescriptor(input: unknown, fallbackMessage: string): ErrorDescriptor`, `convertJavaScriptError(event): ErrorEventBodyParseResult`.

- [ ] **Step 1: Write the failing converter tests**

Create `packages/plugin-error/test/javascript-error-converter.test.ts`:

```ts
import { BrowserErrorSourceEventType } from '@aurora/browser';
import { ErrorCategory } from '@aurora/event-schema';
import { describe, expect, it } from 'vitest';
import { convertJavaScriptError } from '../src/javascript-error-converter.js';

describe('JavaScript error conversion', () => {
  it('copies a bounded Error descriptor without retaining the Error', () => {
    const error = new Error('Synthetic failure token=private');
    error.name = 'SyntheticError';
    const result = convertJavaScriptError({
      type: BrowserErrorSourceEventType.JavaScript,
      message: 'ignored',
      sourceUrl: 'https://app.example.test/main.js',
      error,
    });
    expect(result).toMatchObject({
      success: true,
      data: {
        category: ErrorCategory.JavaScript,
        error: { name: 'SyntheticError', message: 'Synthetic failure token=[redacted]' },
      },
    });
    if (!result.success) throw new Error('conversion must pass');
    expect(result.data.error).not.toBe(error);
  });

  it('uses the ErrorEvent message when no Error exists and removes URL suffixes', () => {
    const result = convertJavaScriptError({
      type: BrowserErrorSourceEventType.JavaScript,
      message: 'Failed at https://app.example.test/a.js?token=private#frame',
      sourceUrl: 'https://app.example.test/a.js',
      error: undefined,
    });
    expect(result).toMatchObject({
      success: true,
      data: {
        error: { message: 'Failed at https://app.example.test/a.js' },
      },
    });
  });

  it('contains hostile getters and uses a stable fallback', () => {
    const hostile = Object.create(null, {
      message: {
        get(): never {
          throw new Error('authorization=private');
        },
      },
    });
    expect(
      convertJavaScriptError({
        type: BrowserErrorSourceEventType.JavaScript,
        message: null,
        sourceUrl: null,
        error: hostile,
      }),
    ).toMatchObject({
      success: true,
      data: { error: { message: 'Unknown JavaScript error' } },
    });
  });

  it('does not modify the source view or Error', () => {
    const error = new Error('Stable');
    const event = Object.freeze({
      type: BrowserErrorSourceEventType.JavaScript,
      message: 'Stable',
      sourceUrl: null,
      error,
    });
    const before = { name: error.name, message: error.message, stack: error.stack };
    convertJavaScriptError(event);
    expect({ name: error.name, message: error.message, stack: error.stack }).toEqual(before);
  });
});
```

- [ ] **Step 2: Run and verify the missing-module failure**

Run:

```powershell
pnpm --filter @aurora/plugin-error exec vitest run test/javascript-error-converter.test.ts
```

Expected: exit 1 because `javascript-error-converter.js` does not exist.

- [ ] **Step 3: Implement bounded Error text and JavaScript conversion**

Create `packages/plugin-error/src/error-descriptor.ts`:

```ts
import { ERROR_EVENT_LIMITS, type ErrorDescriptor } from '@aurora/event-schema';

function removeUrlSuffix(input: string): string {
  const queryIndex = input.indexOf('?');
  const fragmentIndex = input.indexOf('#');
  const suffixIndex =
    queryIndex < 0
      ? fragmentIndex
      : fragmentIndex < 0
        ? queryIndex
        : Math.min(queryIndex, fragmentIndex);
  return suffixIndex < 0 ? input : input.slice(0, suffixIndex);
}

export function sanitizeErrorText(input: unknown, maxLength: number): string | undefined {
  if (typeof input !== 'string' || input.length === 0) return undefined;
  const urlPattern = /https?:\/\/[^\s"'<>]+/giu;
  const credentialPattern =
    /\b(authorization|cookie|token|access_token|refresh_token|password|session)\s*[:=]\s*[^\s,;]+/giu;
  const withoutUrlSecrets = input.replace(urlPattern, removeUrlSuffix);
  const redacted = withoutUrlSecrets.replace(
    credentialPattern,
    (match: string): string => `${match.slice(0, match.search(/[:=]/u)).trim()}=[redacted]`,
  );
  const bounded = redacted.slice(0, maxLength);
  return bounded.length === 0 ? undefined : bounded;
}

function readProperty(input: unknown, key: 'name' | 'message' | 'stack'): unknown {
  if ((typeof input !== 'object' || input === null) && typeof input !== 'function') {
    return undefined;
  }
  try {
    return Reflect.get(input, key);
  } catch {
    return undefined;
  }
}

export function createErrorDescriptor(input: unknown, fallbackMessage: string): ErrorDescriptor {
  const name = sanitizeErrorText(
    readProperty(input, 'name'),
    ERROR_EVENT_LIMITS.maxErrorNameLength,
  );
  const message =
    sanitizeErrorText(readProperty(input, 'message'), ERROR_EVENT_LIMITS.maxErrorMessageLength) ??
    sanitizeErrorText(fallbackMessage, ERROR_EVENT_LIMITS.maxErrorMessageLength) ??
    'Unknown error';
  const stack = sanitizeErrorText(readProperty(input, 'stack'), ERROR_EVENT_LIMITS.maxStackLength);
  return {
    ...(name === undefined ? {} : { name }),
    message,
    ...(stack === undefined ? {} : { stack }),
  };
}
```

Create `packages/plugin-error/src/javascript-error-converter.ts`:

```ts
import type { BrowserJavaScriptErrorSourceEvent } from '@aurora/browser';
import {
  ERROR_EVENT_LIMITS,
  ErrorCategory,
  parseErrorEventBody,
  type ErrorEventBodyParseResult,
} from '@aurora/event-schema';
import { createErrorDescriptor, sanitizeErrorText } from './error-descriptor.js';

const fallbackMessage = 'Unknown JavaScript error';

export function convertJavaScriptError(
  event: BrowserJavaScriptErrorSourceEvent,
): ErrorEventBodyParseResult {
  const message =
    sanitizeErrorText(event.message, ERROR_EVENT_LIMITS.maxErrorMessageLength) ?? fallbackMessage;
  return parseErrorEventBody({
    category: ErrorCategory.JavaScript,
    error:
      event.error instanceof Error
        ? createErrorDescriptor(event.error, message)
        : createErrorDescriptor(undefined, message),
  });
}
```

- [ ] **Step 4: Run and verify the converter passes**

Run:

```powershell
pnpm --filter @aurora/plugin-error exec vitest run test/javascript-error-converter.test.ts
pnpm --filter @aurora/plugin-error typecheck
```

Expected: exit 0; all four cases pass; no type diagnostics.

- [ ] **Step 5: Run protocol regression**

Run:

```powershell
pnpm --filter @aurora/event-schema exec vitest run test/javascript-error-event.test.ts test/error-event-types.test.ts
```

Expected: exit 0; public protocol behavior remains unchanged.

- [ ] **Step 6: Record the suggested commit boundary**

```powershell
git add packages/plugin-error/src/error-descriptor.ts packages/plugin-error/src/javascript-error-converter.ts packages/plugin-error/test/javascript-error-converter.test.ts
git commit -m "feat: convert browser javascript errors"
```

### Task 4: Convert Promise Rejections Through the Public Bounded Parser

**Files:**

- Create: `packages/plugin-error/src/promise-rejection-converter.ts`
- Create: `packages/plugin-error/test/promise-rejection-converter.test.ts`

**Interfaces:**

- Consumes: `BrowserUnhandledRejectionSourceEvent.reason: unknown`, `PromiseRejectionReasonKind`, `parseErrorEventBody`, `createErrorDescriptor`, `sanitizeErrorText`.
- Produces: `convertPromiseRejection(event: BrowserUnhandledRejectionSourceEvent): ErrorEventBodyParseResult`; no recursive copier or retained raw reason.

- [ ] **Step 1: Write the failing Promise tests**

Create `packages/plugin-error/test/promise-rejection-converter.test.ts`:

```ts
import { BrowserErrorSourceEventType } from '@aurora/browser';
import { ErrorCategory, PromiseRejectionReasonKind } from '@aurora/event-schema';
import { describe, expect, it } from 'vitest';
import { convertPromiseRejection } from '../src/promise-rejection-converter.js';

function event(reason: unknown) {
  return { type: BrowserErrorSourceEventType.UnhandledRejection, reason } as const;
}

describe('Promise rejection conversion', () => {
  it('normalizes Error and string reasons', () => {
    expect(convertPromiseRejection(event(new TypeError('Rejected token=private')))).toMatchObject({
      success: true,
      data: {
        category: ErrorCategory.UnhandledRejection,
        reason: {
          kind: PromiseRejectionReasonKind.Error,
          error: { name: 'TypeError', message: 'Rejected token=[redacted]' },
        },
      },
    });
    expect(convertPromiseRejection(event('Rejected at https://x.test/a?token=x#f'))).toMatchObject({
      success: true,
      data: {
        reason: {
          kind: PromiseRejectionReasonKind.String,
          value: 'Rejected at https://x.test/a',
        },
      },
    });
  });

  it('delegates finite non-standard values to event-schema and returns a copy', () => {
    const reason = { code: 42, nested: [true, null] };
    const result = convertPromiseRejection(event(reason));
    expect(result).toMatchObject({
      success: true,
      data: {
        reason: {
          kind: PromiseRejectionReasonKind.NonStandard,
          value: { code: 42, nested: [true, null] },
        },
      },
    });
    if (!result.success || result.data.category !== ErrorCategory.UnhandledRejection) {
      throw new Error('conversion must pass');
    }
    const converted = result.data.reason;
    if (converted.kind !== PromiseRejectionReasonKind.NonStandard) {
      throw new Error('non-standard reason required');
    }
    expect(converted.value).not.toBe(reason);
  });

  it('rejects cycles, excessive depth, forbidden fields, and unsupported values', () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    let deep: unknown = 'leaf';
    for (let index = 0; index < 10; index += 1) deep = { child: deep };
    for (const reason of [cyclic, deep, { token: 'private' }, undefined, 1n, () => undefined]) {
      expect(convertPromiseRejection(event(reason)).success).toBe(false);
    }
  });

  it('uses a stable fallback for an empty string and leaves input unchanged', () => {
    const reason = Object.freeze({ code: 'stable' });
    expect(convertPromiseRejection(event(''))).toMatchObject({
      success: true,
      data: { reason: { value: 'Unhandled promise rejection' } },
    });
    convertPromiseRejection(event(reason));
    expect(reason).toEqual({ code: 'stable' });
  });
});
```

- [ ] **Step 2: Run and verify the missing-module failure**

Run:

```powershell
pnpm --filter @aurora/plugin-error exec vitest run test/promise-rejection-converter.test.ts
```

Expected: exit 1 because `promise-rejection-converter.js` does not exist.

- [ ] **Step 3: Implement the three reason kinds**

Create `packages/plugin-error/src/promise-rejection-converter.ts`:

```ts
import type { BrowserUnhandledRejectionSourceEvent } from '@aurora/browser';
import {
  ERROR_EVENT_LIMITS,
  ErrorCategory,
  PromiseRejectionReasonKind,
  parseErrorEventBody,
  type ErrorEventBodyParseResult,
} from '@aurora/event-schema';
import { createErrorDescriptor, sanitizeErrorText } from './error-descriptor.js';

const fallbackMessage = 'Unhandled promise rejection';

export function convertPromiseRejection(
  event: BrowserUnhandledRejectionSourceEvent,
): ErrorEventBodyParseResult {
  const reason = event.reason;
  if (reason instanceof Error) {
    return parseErrorEventBody({
      category: ErrorCategory.UnhandledRejection,
      reason: {
        kind: PromiseRejectionReasonKind.Error,
        error: createErrorDescriptor(reason, fallbackMessage),
      },
    });
  }
  if (typeof reason === 'string') {
    return parseErrorEventBody({
      category: ErrorCategory.UnhandledRejection,
      reason: {
        kind: PromiseRejectionReasonKind.String,
        value:
          sanitizeErrorText(reason, ERROR_EVENT_LIMITS.maxRejectionStringLength) ?? fallbackMessage,
      },
    });
  }
  return parseErrorEventBody({
    category: ErrorCategory.UnhandledRejection,
    reason: {
      kind: PromiseRejectionReasonKind.NonStandard,
      value: reason,
    },
  });
}
```

- [ ] **Step 4: Run and verify pass**

Run:

```powershell
pnpm --filter @aurora/plugin-error exec vitest run test/promise-rejection-converter.test.ts
pnpm --filter @aurora/plugin-error typecheck
```

Expected: exit 0; all four cases pass; no type diagnostics.

- [ ] **Step 5: Run protocol regression**

Run:

```powershell
pnpm --filter @aurora/event-schema exec vitest run test/promise-rejection-error-event.test.ts test/value-boundaries.test.ts
```

Expected: exit 0. The plugin added no competing recursion, cycle, depth, or forbidden-field implementation.

- [ ] **Step 6: Record the suggested commit boundary**

```powershell
git add packages/plugin-error/src/promise-rejection-converter.ts packages/plugin-error/test/promise-rejection-converter.test.ts
git commit -m "feat: convert promise rejection errors"
```

### Task 5: Map Resource Facts and Delegate URL Validation

**Files:**

- Create: `packages/plugin-error/src/resource-error-converter.ts`
- Create: `packages/plugin-error/test/resource-error-converter.test.ts`

**Interfaces:**

- Consumes: `BrowserResourceErrorSourceEvent`, `ErrorResourceType`, `parseErrorEventBody`.
- Produces: `convertResourceError(event): ErrorEventBodyParseResult | { readonly success: false; readonly unsupportedSource: true }`.

- [ ] **Step 1: Write the failing resource tests**

Create `packages/plugin-error/test/resource-error-converter.test.ts`:

```ts
import { BrowserErrorSourceEventType } from '@aurora/browser';
import { ErrorResourceType } from '@aurora/event-schema';
import { describe, expect, it } from 'vitest';
import { convertResourceError } from '../src/resource-error-converter.js';

function resource(
  tagName: string | null,
  sourceUrl: string | null,
  rel: string | null = null,
  as: string | null = null,
) {
  return {
    type: BrowserErrorSourceEventType.Resource,
    tagName,
    sourceUrl,
    rel,
    as,
  } as const;
}

describe('resource error conversion', () => {
  it.each([
    [resource('script', 'https://static.example.test/app.js'), ErrorResourceType.Script],
    [
      resource('link', 'https://static.example.test/app.css', 'stylesheet'),
      ErrorResourceType.Stylesheet,
    ],
    [resource('img', 'https://static.example.test/a.png'), ErrorResourceType.Image],
    [
      resource('link', 'https://static.example.test/a.woff2', 'preload', 'font'),
      ErrorResourceType.Font,
    ],
  ] as const)('maps the supported resource %#', (input, type) => {
    expect(convertResourceError(input)).toMatchObject({
      success: true,
      data: { resource: { type } },
    });
  });

  it('uses event-schema to remove query and fragment', () => {
    expect(
      convertResourceError(
        resource('script', 'https://static.example.test/app.js?token=private#fragment'),
      ),
    ).toMatchObject({
      success: true,
      data: { resource: { url: 'https://static.example.test/app.js' } },
    });
  });

  it('returns explicit unsupported source instead of inventing other', () => {
    expect(convertResourceError(resource('video', 'https://static.example.test/a.mp4'))).toEqual({
      success: false,
      unsupportedSource: true,
    });
  });

  it.each([null, 'file:///app.js', '/relative.js'])(
    'rejects missing or unsafe URL %s through the public parser',
    (url) => {
      const result = convertResourceError(resource('script', url));
      expect(result.success).toBe(false);
      expect('unsupportedSource' in result).toBe(false);
    },
  );
});
```

- [ ] **Step 2: Run and verify the missing-module failure**

Run:

```powershell
pnpm --filter @aurora/plugin-error exec vitest run test/resource-error-converter.test.ts
```

Expected: exit 1 because `resource-error-converter.js` does not exist.

- [ ] **Step 3: Implement only the approved mapping**

Create `packages/plugin-error/src/resource-error-converter.ts`:

```ts
import type { BrowserResourceErrorSourceEvent } from '@aurora/browser';
import {
  ErrorCategory,
  ErrorResourceType,
  parseErrorEventBody,
  type ErrorEventBodyParseResult,
} from '@aurora/event-schema';

export type ResourceErrorConversionResult =
  ErrorEventBodyParseResult | { readonly success: false; readonly unsupportedSource: true };

function includesRelToken(rel: string | null, token: string): boolean {
  return rel?.split(/\s+/u).includes(token) === true;
}

function mapResourceType(event: BrowserResourceErrorSourceEvent): ErrorResourceType | undefined {
  if (event.tagName === 'script' || event.as === 'script') return ErrorResourceType.Script;
  if (
    (event.tagName === 'link' && includesRelToken(event.rel, 'stylesheet')) ||
    event.as === 'style'
  ) {
    return ErrorResourceType.Stylesheet;
  }
  if (event.tagName === 'img' || event.as === 'image') return ErrorResourceType.Image;
  if (event.as === 'font') return ErrorResourceType.Font;
  return undefined;
}

export function convertResourceError(
  event: BrowserResourceErrorSourceEvent,
): ResourceErrorConversionResult {
  const type = mapResourceType(event);
  if (type === undefined) return { success: false, unsupportedSource: true };
  return parseErrorEventBody({
    category: ErrorCategory.Resource,
    resource: { type, url: event.sourceUrl },
  });
}
```

- [ ] **Step 4: Run and verify pass**

Run:

```powershell
pnpm --filter @aurora/plugin-error exec vitest run test/resource-error-converter.test.ts
pnpm --filter @aurora/plugin-error typecheck
```

Expected: exit 0; all selected resource cases pass.

- [ ] **Step 5: Run Browser and protocol regression**

Run:

```powershell
pnpm --filter @aurora/browser exec vitest run test/error-source-view.test.ts
pnpm --filter @aurora/event-schema exec vitest run test/resource-error-event.test.ts
```

Expected: exit 0. Browser still only projects facts; event-schema remains the sole URL validator.

- [ ] **Step 6: Record the suggested commit boundary**

```powershell
git add packages/plugin-error/src/resource-error-converter.ts packages/plugin-error/test/resource-error-converter.test.ts
git commit -m "feat: convert resource loading errors"
```

### Task 6: Add the Single Source Handler, Core Draft Submission, and Re-entry Guard

**Files:**

- Create: `packages/plugin-error/src/source-event-handler.ts`
- Create: `packages/plugin-error/test/submission.test.ts`

**Interfaces:**

- Consumes: the three converter functions, `CorePluginContext['submitEvent']`, `EventType.Error`, internal `ErrorCaptureDiagnosticStore`.
- Produces: `ErrorSourceHandler.handle(event: BrowserErrorSourceEvent): void` and `createErrorSourceHandler(submitEvent, diagnostics): ErrorSourceHandler`; every accepted body is submitted once as an exact two-key draft.

- [ ] **Step 1: Write failing submission, recovery, and recursion tests**

Create `packages/plugin-error/test/submission.test.ts`:

```ts
import { BrowserErrorSourceEventType, type BrowserErrorSourceEvent } from '@aurora/browser';
import type { CoreEventDraftResult, CorePluginContext } from '@aurora/core';
import { ErrorCategory, EventType, parseErrorEventBody } from '@aurora/event-schema';
import { describe, expect, it, vi } from 'vitest';
import { createErrorCaptureDiagnosticStore } from '../src/diagnostics.js';
import { createErrorSourceHandler } from '../src/source-event-handler.js';

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

const javascriptEvent: BrowserErrorSourceEvent = Object.freeze({
  type: BrowserErrorSourceEventType.JavaScript,
  message: 'Synthetic JavaScript failure',
  sourceUrl: null,
  error: new Error('Synthetic JavaScript failure'),
});
const promiseEvent: BrowserErrorSourceEvent = Object.freeze({
  type: BrowserErrorSourceEventType.UnhandledRejection,
  reason: 'Synthetic rejection',
});
const resourceEvent: BrowserErrorSourceEvent = Object.freeze({
  type: BrowserErrorSourceEventType.Resource,
  tagName: 'script',
  sourceUrl: 'https://static.example.test/app.js?token=private#fragment',
  rel: null,
  as: null,
});

describe('error source submission', () => {
  it('submits each source exactly once as an exact validated Core draft', () => {
    const drafts: unknown[] = [];
    const submitEvent: CorePluginContext['submitEvent'] = vi.fn((input: unknown) => {
      drafts.push(input);
      return accepted;
    });
    const diagnostics = createErrorCaptureDiagnosticStore();
    const handler = createErrorSourceHandler(submitEvent, diagnostics);
    handler.handle(javascriptEvent);
    handler.handle(promiseEvent);
    handler.handle(resourceEvent);
    expect(drafts).toHaveLength(3);
    for (const draft of drafts) {
      if (typeof draft !== 'object' || draft === null) throw new Error('draft must be an object');
      expect(Reflect.ownKeys(draft)).toEqual(['eventType', 'body']);
      expect(draft).toMatchObject({ eventType: EventType.Error });
      const body = Reflect.get(draft, 'body');
      expect(parseErrorEventBody(body).success).toBe(true);
      expect(Reflect.has(draft, 'eventId')).toBe(false);
      expect(Reflect.has(draft, 'occurredAt')).toBe(false);
      expect(Reflect.has(draft, 'protocolVersion')).toBe(false);
    }
    expect(diagnostics.snapshot()).toEqual([]);
  });

  it('does not submit rejected schema input and accepts the next event', () => {
    const submitEvent = vi.fn(() => accepted);
    const diagnostics = createErrorCaptureDiagnosticStore();
    const handler = createErrorSourceHandler(submitEvent, diagnostics);
    handler.handle({
      type: BrowserErrorSourceEventType.Resource,
      tagName: 'script',
      sourceUrl: null,
      rel: null,
      as: null,
    });
    handler.handle(javascriptEvent);
    expect(submitEvent).toHaveBeenCalledTimes(1);
    expect(diagnostics.snapshot()).toMatchObject([
      { code: 'error_body_rejected', operation: 'convert', sourceType: 'resource_error' },
    ]);
  });

  it('records a Core failure and submits the next event', () => {
    const submitEvent = vi
      .fn<CorePluginContext['submitEvent']>()
      .mockReturnValueOnce(rejected)
      .mockReturnValueOnce(accepted);
    const diagnostics = createErrorCaptureDiagnosticStore();
    const handler = createErrorSourceHandler(submitEvent, diagnostics);
    handler.handle(javascriptEvent);
    handler.handle(promiseEvent);
    expect(submitEvent).toHaveBeenCalledTimes(2);
    expect(diagnostics.snapshot()).toMatchObject([
      { code: 'event_submission_failed', operation: 'submit' },
    ]);
  });

  it('blocks synchronous recursion without suppressing the next independent event', () => {
    const diagnostics = createErrorCaptureDiagnosticStore();
    let handler: ReturnType<typeof createErrorSourceHandler> | undefined;
    let calls = 0;
    const submitEvent: CorePluginContext['submitEvent'] = (): CoreEventDraftResult => {
      calls += 1;
      if (calls === 1) handler?.handle(promiseEvent);
      return accepted;
    };
    handler = createErrorSourceHandler(submitEvent, diagnostics);
    handler.handle(javascriptEvent);
    handler.handle(promiseEvent);
    expect(calls).toBe(2);
    expect(diagnostics.snapshot()).toMatchObject([
      { code: 'recursive_capture_blocked', operation: 'notify' },
    ]);
  });

  it('maps all three public categories without retaining input wrappers', () => {
    const categories: string[] = [];
    const submitEvent: CorePluginContext['submitEvent'] = (input: unknown) => {
      if (typeof input !== 'object' || input === null) throw new Error('draft must be an object');
      const body = Reflect.get(input, 'body');
      const parsed = parseErrorEventBody(body);
      if (!parsed.success) throw new Error('body must be valid');
      categories.push(parsed.data.category);
      return accepted;
    };
    const handler = createErrorSourceHandler(submitEvent, createErrorCaptureDiagnosticStore());
    handler.handle(javascriptEvent);
    handler.handle(promiseEvent);
    handler.handle(resourceEvent);
    expect(categories).toEqual([
      ErrorCategory.JavaScript,
      ErrorCategory.UnhandledRejection,
      ErrorCategory.Resource,
    ]);
  });
});
```

- [ ] **Step 2: Run and verify the expected failure**

Run:

```powershell
pnpm --filter @aurora/plugin-error exec vitest run test/submission.test.ts
```

Expected: exit 1 because `source-event-handler.js` does not exist.

- [ ] **Step 3: Implement the handler without storing source inputs**

Create `packages/plugin-error/src/source-event-handler.ts`:

```ts
import { BrowserErrorSourceEventType, type BrowserErrorSourceEvent } from '@aurora/browser';
import type { CorePluginContext } from '@aurora/core';
import { EventType, type ErrorEventBodyParseResult } from '@aurora/event-schema';
import {
  ErrorCaptureDiagnosticCode,
  ErrorCaptureDiagnosticOperation,
  type ErrorCaptureDiagnosticStore,
} from './diagnostics.js';
import { convertJavaScriptError } from './javascript-error-converter.js';
import { convertPromiseRejection } from './promise-rejection-converter.js';
import {
  convertResourceError,
  type ResourceErrorConversionResult,
} from './resource-error-converter.js';

export interface ErrorSourceHandler {
  handle(event: BrowserErrorSourceEvent): void;
}

type ConversionResult = ErrorEventBodyParseResult | ResourceErrorConversionResult;

function convertSource(event: BrowserErrorSourceEvent): ConversionResult {
  if (event.type === BrowserErrorSourceEventType.JavaScript) {
    return convertJavaScriptError(event);
  }
  if (event.type === BrowserErrorSourceEventType.UnhandledRejection) {
    return convertPromiseRejection(event);
  }
  return convertResourceError(event);
}

export function createErrorSourceHandler(
  submitEvent: CorePluginContext['submitEvent'],
  diagnostics: ErrorCaptureDiagnosticStore,
): ErrorSourceHandler {
  let isHandlingSource = false;

  function handle(event: BrowserErrorSourceEvent): void {
    if (isHandlingSource) {
      diagnostics.append({
        code: ErrorCaptureDiagnosticCode.RecursiveCaptureBlocked,
        operation: ErrorCaptureDiagnosticOperation.Notify,
        sourceType: event.type,
      });
      return;
    }
    isHandlingSource = true;
    try {
      const converted = convertSource(event);
      if (!converted.success) {
        diagnostics.append({
          code:
            'unsupportedSource' in converted
              ? ErrorCaptureDiagnosticCode.UnsupportedSource
              : ErrorCaptureDiagnosticCode.ErrorBodyRejected,
          operation: ErrorCaptureDiagnosticOperation.Convert,
          sourceType: event.type,
        });
        return;
      }
      const result = submitEvent({
        eventType: EventType.Error,
        body: converted.data,
      });
      if (!result.ok) {
        diagnostics.append({
          code: ErrorCaptureDiagnosticCode.EventSubmissionFailed,
          operation: ErrorCaptureDiagnosticOperation.Submit,
          sourceType: event.type,
        });
      }
    } catch {
      diagnostics.append({
        code: ErrorCaptureDiagnosticCode.InternalError,
        operation: ErrorCaptureDiagnosticOperation.Notify,
        sourceType: event.type,
      });
    } finally {
      isHandlingSource = false;
    }
  }

  return Object.freeze({ handle });
}
```

- [ ] **Step 4: Run and verify pass**

Run:

```powershell
pnpm --filter @aurora/plugin-error exec vitest run test/submission.test.ts
pnpm --filter @aurora/plugin-error typecheck
```

Expected: exit 0; all five tests pass; no type diagnostics.

- [ ] **Step 5: Run converter and Core draft regression**

Run:

```powershell
pnpm --filter @aurora/plugin-error exec vitest run test/javascript-error-converter.test.ts test/promise-rejection-converter.test.ts test/resource-error-converter.test.ts test/submission.test.ts
pnpm --filter @aurora/core exec vitest run test/event-creation.test.ts test/event-entry.test.ts
```

Expected: exit 0. The handler creates no system fields and the Core public draft contract remains unchanged.

- [ ] **Step 6: Record the suggested commit boundary**

```powershell
git add packages/plugin-error/src/source-event-handler.ts packages/plugin-error/test/submission.test.ts
git commit -m "feat: submit validated error event drafts"
```

### Task 7: Connect the Handler to Browser Subscription Ownership and Complete Release Semantics

**Files:**

- Modify: `packages/plugin-error/src/error-capture-plugin.ts`
- Modify: `packages/plugin-error/test/lifecycle.test.ts`
- Create: `packages/plugin-error/test/host-safety.test.ts`

**Interfaces:**

- Consumes: `createErrorSourceHandler(submitEvent, diagnostics)`, Browser atomic subscription and idempotent unsubscribe.
- Produces: final factory behavior: inactive callbacks are no-ops, start activates only after successful subscription, stop/destroy deactivate before physical removal, Browser is never destroyed.

- [ ] **Step 1: Add failing active-callback and removal-failure tests**

Append to `packages/plugin-error/test/lifecycle.test.ts`:

First change its Browser import to:

```ts
import {
  createBrowserEnvironment,
  type BrowserEnvironment,
  type BrowserErrorSourceListener,
  type BrowserSubscription,
} from '@aurora/browser';
```

```ts
it('ignores retained native callbacks after stop and after destroy', () => {
  const fixture = createBrowserDouble();
  const submitEvent = vi.fn(() => ({
    ok: true as const,
    code: 'accepted' as const,
    state: 'started' as const,
    diagnosticsAdded: 0 as const,
  }));
  const plugin = createErrorCapturePlugin(fixture.browser);
  plugin.initialize(Object.freeze({ submitEvent }));
  plugin.start();
  const retained = fixture.listeners[0];
  if (retained === undefined) throw new Error('listener must exist');
  plugin.stop();
  retained({
    type: 'javascript_error',
    message: 'after stop',
    sourceUrl: null,
    error: new Error('after stop'),
  });
  plugin.start();
  plugin.destroy();
  retained({
    type: 'unhandled_rejection',
    reason: 'after destroy',
  });
  expect(submitEvent).not.toHaveBeenCalled();
});

it('deactivates before an unsubscribe exception and records no sensitive text', () => {
  const listeners: BrowserErrorSourceListener[] = [];
  const browser = {
    ...createBrowserDouble().browser,
    subscribeErrorSources(listener: BrowserErrorSourceListener) {
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
  const plugin = createErrorCapturePlugin(browser);
  plugin.initialize(Object.freeze({ submitEvent }));
  plugin.start();
  plugin.stop();
  listeners[0]?.({
    type: 'javascript_error',
    message: 'retained',
    sourceUrl: null,
    error: undefined,
  });
  expect(submitEvent).not.toHaveBeenCalled();
  expect(JSON.stringify(plugin.getDiagnostics())).not.toContain('private');
  expect(plugin.getDiagnostics()).toMatchObject([
    { code: 'browser_unsubscribe_failed', operation: 'stop' },
  ]);
});

it('observes Browser public atomic rollback when the second registration fails', () => {
  const registrations: Array<{
    readonly type: string;
    readonly listener: (event: unknown) => void;
    readonly capture: boolean;
  }> = [];
  const host = {
    location: { href: 'https://app.example.test/' },
    addEventListener(type: string, listener: (event: unknown) => void, capture = false): void {
      if (type === 'unhandledrejection') throw new Error('registration-private');
      registrations.push({ type, listener, capture });
    },
    removeEventListener(type: string, listener: (event: unknown) => void, capture = false): void {
      const index = registrations.findIndex(
        (entry) => entry.type === type && entry.listener === listener && entry.capture === capture,
      );
      if (index >= 0) registrations.splice(index, 1);
    },
  };
  vi.stubGlobal('window', host);
  vi.stubGlobal('document', {});
  try {
    const browser = createBrowserEnvironment();
    const plugin = createErrorCapturePlugin(browser);
    plugin.initialize(context);
    plugin.start();
    expect(registrations).toEqual([]);
    expect(plugin.getDiagnostics()).toMatchObject([
      { code: 'browser_subscription_failed', operation: 'start' },
    ]);
    plugin.destroy();
    browser.destroy();
  } finally {
    vi.unstubAllGlobals();
  }
});
```

Create `packages/plugin-error/test/host-safety.test.ts`:

```ts
import type { BrowserErrorSourceListener, BrowserSubscription } from '@aurora/browser';
import type { CorePluginContext } from '@aurora/core';
import { describe, expect, it, vi } from 'vitest';
import { createErrorCapturePlugin } from '../src/index.js';

describe('error plugin host safety', () => {
  it('contains conversion and submit exceptions and handles the next event', () => {
    let listener: BrowserErrorSourceListener | undefined;
    const subscription: BrowserSubscription = Object.freeze({
      unsubscribe: () => ({
        ok: true,
        code: 'unsubscribed',
        diagnosticsAdded: 0,
      }),
    });
    const browser = {
      getCapabilities: vi.fn(),
      readPageSnapshot: vi.fn(),
      subscribePageLifecycle: vi.fn(),
      subscribeErrorSources(next: BrowserErrorSourceListener) {
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
        ok: true,
        code: 'accepted',
        state: 'started',
        diagnosticsAdded: 0,
      });
    const plugin = createErrorCapturePlugin(browser);
    plugin.initialize(Object.freeze({ submitEvent }));
    plugin.start();
    expect(() =>
      listener?.({
        type: 'javascript_error',
        message: 'first',
        sourceUrl: null,
        error: new Error('first'),
      }),
    ).not.toThrow();
    listener?.({ type: 'unhandled_rejection', reason: 'second' });
    expect(submitEvent).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(plugin.getDiagnostics())).not.toContain('private');
  });

  it('does not access a raw rejection again after the synchronous callback', () => {
    let listener: BrowserErrorSourceListener | undefined;
    const browser = {
      getCapabilities: vi.fn(),
      readPageSnapshot: vi.fn(),
      subscribePageLifecycle: vi.fn(),
      subscribeErrorSources(next: BrowserErrorSourceListener) {
        listener = next;
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
    const target = { code: 7 };
    const revocable = Proxy.revocable(target, {});
    const plugin = createErrorCapturePlugin(browser);
    plugin.initialize(
      Object.freeze({
        submitEvent: () => ({
          ok: true,
          code: 'accepted',
          state: 'started',
          diagnosticsAdded: 0,
        }),
      }),
    );
    plugin.start();
    listener?.({ type: 'unhandled_rejection', reason: revocable.proxy });
    revocable.revoke();
    expect(() => {
      plugin.stop();
      plugin.start();
      plugin.destroy();
      plugin.getDiagnostics();
    }).not.toThrow();
  });
});
```

- [ ] **Step 2: Run and verify the expected failure**

Run:

```powershell
pnpm --filter @aurora/plugin-error exec vitest run test/lifecycle.test.ts test/host-safety.test.ts
```

Expected: exit 1 because the lifecycle shell still subscribes a no-op Listener, so active errors are not submitted and retained-callback assertions expose missing activation control.

- [ ] **Step 3: Replace the shell with the final lifecycle integration**

Replace `packages/plugin-error/src/error-capture-plugin.ts` with:

```ts
import type {
  BrowserEnvironment,
  BrowserErrorSourceEvent,
  BrowserErrorSourceListener,
  BrowserSubscription,
} from '@aurora/browser';
import type { CorePlugin, CorePluginContext } from '@aurora/core';
import {
  createErrorCaptureDiagnosticStore,
  ErrorCaptureDiagnosticCode,
  ErrorCaptureDiagnosticOperation,
  type ErrorCaptureDiagnostic,
} from './diagnostics.js';
import { createErrorSourceHandler, type ErrorSourceHandler } from './source-event-handler.js';

export const ERROR_CAPTURE_PLUGIN_NAME = 'error-capture' as const;

export interface ErrorCapturePlugin extends CorePlugin {
  readonly name: typeof ERROR_CAPTURE_PLUGIN_NAME;
  initialize(context: CorePluginContext): void;
  start(): void;
  stop(): void;
  destroy(): void;
  getDiagnostics(): readonly ErrorCaptureDiagnostic[];
}

export function createErrorCapturePlugin(browser: BrowserEnvironment): ErrorCapturePlugin {
  const diagnostics = createErrorCaptureDiagnosticStore();
  let handler: ErrorSourceHandler | undefined;
  let subscription: BrowserSubscription | undefined;
  let isAcceptingEvents = false;
  let isDestroyed = false;

  const listener: BrowserErrorSourceListener = (event: BrowserErrorSourceEvent): void => {
    if (!isAcceptingEvents) return;
    handler?.handle(event);
  };

  function initialize(context: CorePluginContext): void {
    if (isDestroyed) {
      diagnostics.append({
        code: ErrorCaptureDiagnosticCode.InvalidLifecycleCall,
        operation: ErrorCaptureDiagnosticOperation.Initialize,
      });
      return;
    }
    if (handler !== undefined) return;
    try {
      const submitEvent = context.submitEvent;
      if (typeof submitEvent !== 'function') {
        diagnostics.append({
          code: ErrorCaptureDiagnosticCode.InvalidPluginContext,
          operation: ErrorCaptureDiagnosticOperation.Initialize,
        });
        return;
      }
      handler = createErrorSourceHandler(submitEvent, diagnostics);
    } catch {
      diagnostics.append({
        code: ErrorCaptureDiagnosticCode.InvalidPluginContext,
        operation: ErrorCaptureDiagnosticOperation.Initialize,
      });
    }
  }

  function start(): void {
    if (isDestroyed || handler === undefined) {
      diagnostics.append({
        code: ErrorCaptureDiagnosticCode.InvalidLifecycleCall,
        operation: ErrorCaptureDiagnosticOperation.Start,
      });
      return;
    }
    if (subscription !== undefined) return;
    try {
      const result = browser.subscribeErrorSources(listener);
      if (!result.ok) {
        diagnostics.append({
          code: ErrorCaptureDiagnosticCode.BrowserSubscriptionFailed,
          operation: ErrorCaptureDiagnosticOperation.Start,
        });
        return;
      }
      subscription = result.subscription;
      isAcceptingEvents = true;
    } catch {
      diagnostics.append({
        code: ErrorCaptureDiagnosticCode.BrowserSubscriptionFailed,
        operation: ErrorCaptureDiagnosticOperation.Start,
      });
    }
  }

  function release(
    operation:
      typeof ErrorCaptureDiagnosticOperation.Stop | typeof ErrorCaptureDiagnosticOperation.Destroy,
  ): void {
    isAcceptingEvents = false;
    const current = subscription;
    subscription = undefined;
    if (current === undefined) return;
    try {
      const result = current.unsubscribe();
      if (result.diagnosticsAdded > 0) {
        diagnostics.append({
          code: ErrorCaptureDiagnosticCode.BrowserUnsubscribeFailed,
          operation,
        });
      }
    } catch {
      diagnostics.append({
        code: ErrorCaptureDiagnosticCode.BrowserUnsubscribeFailed,
        operation,
      });
    }
  }

  function stop(): void {
    release(ErrorCaptureDiagnosticOperation.Stop);
  }

  function destroy(): void {
    if (isDestroyed) return;
    release(ErrorCaptureDiagnosticOperation.Destroy);
    handler = undefined;
    isDestroyed = true;
  }

  return Object.freeze({
    name: ERROR_CAPTURE_PLUGIN_NAME,
    initialize,
    start,
    stop,
    destroy,
    getDiagnostics: (): readonly ErrorCaptureDiagnostic[] => diagnostics.snapshot(),
  });
}
```

- [ ] **Step 4: Run and verify pass**

Run:

```powershell
pnpm --filter @aurora/plugin-error exec vitest run test/lifecycle.test.ts test/host-safety.test.ts test/submission.test.ts
pnpm --filter @aurora/plugin-error typecheck
```

Expected: exit 0; all selected tests pass; no type diagnostics.

- [ ] **Step 5: Run complete plugin unit regression**

Run:

```powershell
pnpm --filter @aurora/plugin-error test
```

Expected: exit 0. Every plugin test created through Task 7 passes.

- [ ] **Step 6: Record the suggested commit boundary**

```powershell
git add packages/plugin-error/src/error-capture-plugin.ts packages/plugin-error/test/lifecycle.test.ts packages/plugin-error/test/host-safety.test.ts
git commit -m "feat: connect error plugin to browser sources"
```

### Task 8: Prove Multi-instance, Package-entry, and Static Host Boundaries

**Files:**

- Create: `packages/plugin-error/test/multi-instance.test.ts`
- Create: `packages/plugin-error/test/architecture-boundary.test.ts`
- Create: `packages/plugin-error/test/package-entry.test.ts`
- Modify: `packages/plugin-error/test/no-dom-consumer.ts`

**Interfaces:**

- Consumes: final root API and built package `exports`.
- Produces: black-box proof that instances, failures, release, public exports, private paths, imports, host safety, and module state remain isolated.

- [ ] **Step 1: Write the failing package and architecture tests**

Create `packages/plugin-error/test/multi-instance.test.ts`:

```ts
import type { BrowserErrorSourceListener } from '@aurora/browser';
import type { CorePluginContext } from '@aurora/core';
import { describe, expect, it, vi } from 'vitest';
import { createErrorCapturePlugin } from '../src/index.js';

function sharedBrowser() {
  const active = new Set<BrowserErrorSourceListener>();
  return {
    active,
    browser: {
      getCapabilities: vi.fn(),
      readPageSnapshot: vi.fn(),
      subscribePageLifecycle: vi.fn(),
      subscribeErrorSources(listener: BrowserErrorSourceListener) {
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
      for (const listener of [...active]) {
        listener({
          type: 'javascript_error',
          message: 'Synthetic',
          sourceUrl: null,
          error: new Error('Synthetic'),
        });
      }
    },
  };
}

function context(submitEvent: CorePluginContext['submitEvent']): CorePluginContext {
  return Object.freeze({ submitEvent });
}

describe('error plugin multi-instance isolation', () => {
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
    const first = createErrorCapturePlugin(fixture.browser);
    const second = createErrorCapturePlugin(fixture.browser);
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
    const failed = createErrorCapturePlugin(fixture.browser);
    const healthy = createErrorCapturePlugin(fixture.browser);
    failed.initialize(
      context(() => {
        throw new Error('private');
      }),
    );
    healthy.initialize(
      context(() => ({
        ok: true,
        code: 'accepted',
        state: 'started',
        diagnosticsAdded: 0,
      })),
    );
    failed.start();
    healthy.start();
    fixture.dispatch();
    expect(failed.getDiagnostics()).toHaveLength(1);
    expect(healthy.getDiagnostics()).toEqual([]);
    expect(failed.getDiagnostics()[0]?.sequence).toBe(1);
  });
});
```

Create `packages/plugin-error/test/architecture-boundary.test.ts`:

```ts
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packageDirectory = new URL('..', import.meta.url);
const packagePath = fileURLToPath(packageDirectory);

describe('error plugin architecture boundary', () => {
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

Create `packages/plugin-error/test/package-entry.test.ts`:

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

describe('built error plugin entry', () => {
  it('loads only the declared public runtime values', () => {
    const result = importFromPackage('@aurora/plugin-error');
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout.trim()).toBe(
      'ERROR_CAPTURE_PLUGIN_NAME,ErrorCaptureDiagnosticCode,' +
        'ErrorCaptureDiagnosticOperation,createErrorCapturePlugin',
    );
  });

  it('rejects every private or undeclared path', () => {
    for (const specifier of [
      '@aurora/plugin-error/src/index.js',
      '@aurora/plugin-error/internal/diagnostics.js',
      '@aurora/plugin-error/error-capture-plugin',
      '@aurora/plugin-error/promise-rejection-converter',
    ]) {
      const result = importFromPackage(specifier);
      expect(result.status, specifier).not.toBe(0);
      expect(result.stdout, specifier).toBe('');
      expect(result.stderr, specifier).toContain('ERR_PACKAGE_PATH_NOT_EXPORTED');
    }
  });
});
```

Replace `packages/plugin-error/test/no-dom-consumer.ts` with this production-contract consumer:

```ts
import type { BrowserEnvironment } from '@aurora/browser';
import {
  createErrorCapturePlugin,
  type ErrorCaptureDiagnostic,
  type ErrorCapturePlugin,
} from '../src/index.js';

declare const browser: BrowserEnvironment;
const plugin: ErrorCapturePlugin = createErrorCapturePlugin(browser);
const diagnostics: readonly ErrorCaptureDiagnostic[] = plugin.getDiagnostics();
void [plugin, diagnostics];
```

- [ ] **Step 2: Run and verify the expected package-entry failure**

Run:

```powershell
pnpm --filter @aurora/plugin-error exec vitest run test/multi-instance.test.ts test/architecture-boundary.test.ts
pnpm --filter @aurora/plugin-error exec vitest run test/package-entry.test.ts
```

Expected: the first command exits 0 after Tasks 1–7; the second exits 1 because `dist` has not been freshly built with the new public root.

- [ ] **Step 3: Build the public root and correct only evidence-backed defects**

Run:

```powershell
pnpm --filter @aurora/plugin-error build
```

Expected: exit 0 and creation of `dist/index.js`, declarations, maps, and private internal modules without adding package subpath exports.

- [ ] **Step 4: Verify all static and package gates pass**

Run:

```powershell
pnpm --filter @aurora/plugin-error exec vitest run test/multi-instance.test.ts test/architecture-boundary.test.ts
pnpm --filter @aurora/plugin-error test:package
pnpm --filter @aurora/plugin-error typecheck
pnpm check:boundaries
```

Expected: each exits 0; built root lists exactly four runtime values; every private import fails with `ERR_PACKAGE_PATH_NOT_EXPORTED`; no boundary output.

- [ ] **Step 5: Run dependency and upstream package-entry regression**

Run:

```powershell
pnpm --filter @aurora/workspace-policy exec vitest run test/dependency-policy.test.ts test/environment.test.ts
pnpm --filter @aurora/core test:package
pnpm --filter @aurora/browser test:package
pnpm --filter @aurora/event-schema test:package
```

Expected: exit 0. Upstream public roots are unchanged and none exposes plugin implementation.

- [ ] **Step 6: Record the suggested commit boundary**

```powershell
git add packages/plugin-error/test/multi-instance.test.ts packages/plugin-error/test/architecture-boundary.test.ts packages/plugin-error/test/package-entry.test.ts packages/plugin-error/test/no-dom-consumer.ts
git commit -m "test: enforce error plugin isolation boundaries"
```

### Task 9: Verify the Built Plugin in Real Chromium

**Files:**

- Create: `packages/plugin-error/test-browser/fixture-server.ts`
- Create: `packages/plugin-error/test-browser/error-capture-plugin.spec.ts`

**Interfaces:**

- Consumes: built public roots `@aurora/plugin-error`, `@aurora/browser`, `@aurora/core`, `@aurora/event-schema`; real Chromium `error` and `unhandledrejection`.
- Produces: real-browser evidence for three sources, exactly-once submission, public schema validation, Core draft acceptance, handler preservation, no event control, stop/destroy release, failure recovery, and multi-instance isolation.

- [ ] **Step 1: Create the browser test before the fixture server**

Create `packages/plugin-error/test-browser/error-capture-plugin.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test';
import { startFixtureServer, type PluginFixtureServer } from './fixture-server.js';

let fixture: PluginFixtureServer | undefined;

async function invoke(page: Page, method: string): Promise<unknown> {
  return page.evaluate(async (methodName) => {
    const harness: unknown = Reflect.get(globalThis, 'errorPluginHarness');
    if (typeof harness !== 'object' || harness === null) {
      throw new Error('error plugin harness missing');
    }
    const callable: unknown = Reflect.get(harness, methodName);
    if (typeof callable !== 'function') {
      throw new Error(`error plugin harness method missing: ${methodName}`);
    }
    return Reflect.apply(callable, harness, []);
  }, method);
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
      page.evaluate(() => typeof Reflect.get(globalThis, 'errorPluginHarness') === 'object'),
    )
    .toBe(true);
});

test('submits JavaScript, Promise, and resource errors exactly once through Core', async ({
  page,
}) => {
  expect(await invoke(page, 'triggerThreeSources')).toEqual({
    categories: ['javascript', 'unhandled_rejection', 'resource'],
    counts: { javascript: 1, unhandled_rejection: 1, resource: 1 },
    coreCodes: ['accepted', 'accepted', 'accepted'],
    allBodiesValid: true,
    resourceUrl: `${fixture?.origin}/missing-plugin-resource.js`,
  });
});

test('preserves host handlers and event defaults', async ({ page }) => {
  expect(await invoke(page, 'hostSafety')).toEqual({
    onerrorIdentity: true,
    onunhandledrejectionIdentity: true,
    onerrorCalls: 1,
    onunhandledrejectionCalls: 1,
    defaultPrevented: false,
    propagationObserved: true,
    pageStillRuns: 42,
  });
});

test('stops, destroys, and never revives', async ({ page }) => {
  expect(await invoke(page, 'release')).toEqual({
    beforeStop: 1,
    afterStop: 1,
    afterRestart: 2,
    afterDestroy: 2,
    destroyedStartDiagnostic: 'invalid_lifecycle_call',
  });
});

test('isolates instances and leaves the surviving instance active', async ({ page }) => {
  expect(await invoke(page, 'multiInstance')).toEqual({
    first: 1,
    second: 2,
  });
});

test('contains an internal submission failure and processes the next event', async ({ page }) => {
  expect(await invoke(page, 'failureIsolation')).toEqual({
    calls: 2,
    diagnosticCodes: ['event_submission_failed'],
    pageStillRuns: 42,
  });
});
```

- [ ] **Step 2: Run and verify the expected fixture failure**

Run:

```powershell
pnpm --filter @aurora/plugin-error test:browser
```

Expected: exit 1 because `fixture-server.js` does not exist.

- [ ] **Step 3: Implement the public-root fixture server**

Create `packages/plugin-error/test-browser/fixture-server.ts`:

```ts
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginDist = fileURLToPath(new URL('../dist/', import.meta.url));
const browserDist = fileURLToPath(new URL('../../browser/dist/', import.meta.url));
const coreDist = fileURLToPath(new URL('../../core/dist/', import.meta.url));
const protocolDist = fileURLToPath(new URL('../../event-schema/dist/', import.meta.url));

const pageHtml = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Aurora Error Plugin Fixture</title>
  <script type="importmap">
  {
    "imports": {
      "@aurora/plugin-error": "/plugin/index.js",
      "@aurora/browser": "/browser/index.js",
      "@aurora/core": "/core/index.js",
      "@aurora/event-schema": "/protocol/index.js"
    }
  }
  </script>
</head>
<body>
<script type="module">
import { createErrorCapturePlugin } from '@aurora/plugin-error';
import { createBrowserEnvironment } from '@aurora/browser';
import { createCore } from '@aurora/core';
import { parseErrorEventBody } from '@aurora/event-schema';

const waitFor = async (predicate) => {
  const start = performance.now();
  while (!predicate()) {
    if (performance.now() - start > 3000) throw new Error('fixture timeout');
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

const createStartedHarness = async () => {
  let nextId = 1;
  const core = createCore({
    eventIdProvider: {
      createEventId: () => 'chromium-event-' + String(nextId++),
    },
    eventTimeProvider: {
      now: () => 1800000000000 + nextId,
    },
  });
  await core.initialize();
  await core.start();
  const browser = createBrowserEnvironment();
  const plugin = createErrorCapturePlugin(browser);
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
const baseline = Object.freeze({
  onerror: window.onerror,
  onunhandledrejection: window.onunhandledrejection,
});
let onerrorCalls = 0;
let onunhandledrejectionCalls = 0;
window.onerror = (...args) => {
  onerrorCalls += 1;
  return baseline.onerror ? baseline.onerror.apply(window, args) : false;
};
window.onunhandledrejection = (event) => {
  onunhandledrejectionCalls += 1;
  return baseline.onunhandledrejection
    ? baseline.onunhandledrejection.call(window, event)
    : false;
};
const installedHandlers = Object.freeze({
  onerror: window.onerror,
  onunhandledrejection: window.onunhandledrejection,
});
let propagationObserved = false;
window.addEventListener('error', () => {
  propagationObserved = true;
});

async function triggerJavaScript(message) {
  setTimeout(() => {
    throw new Error(message);
  }, 0);
}

async function triggerPromise(message) {
  void Promise.reject(new Error(message));
}

async function triggerResource() {
  const script = document.createElement('script');
  script.src = '/missing-plugin-resource.js?token=private#fragment';
  document.head.append(script);
  await waitFor(() =>
    primary.drafts.some((draft) => draft.body.category === 'resource'),
  );
  script.remove();
}

globalThis.errorPluginHarness = Object.freeze({
  triggerThreeSources: async () => {
    primary.drafts.length = 0;
    primary.coreCodes.length = 0;
    await triggerJavaScript('Synthetic Chromium JavaScript failure');
    await waitFor(() =>
      primary.drafts.some((draft) => draft.body.category === 'javascript'),
    );
    await triggerPromise('Synthetic Chromium Promise rejection');
    await waitFor(() =>
      primary.drafts.some((draft) => draft.body.category === 'unhandled_rejection'),
    );
    await triggerResource();
    const categories = primary.drafts.map((draft) => draft.body.category);
    const counts = {};
    for (const category of categories) counts[category] = (counts[category] || 0) + 1;
    const resource = primary.drafts.find((draft) => draft.body.category === 'resource');
    return {
      categories,
      counts,
      coreCodes: [...primary.coreCodes],
      allBodiesValid: primary.drafts.every((draft) => parseErrorEventBody(draft.body).success),
      resourceUrl: resource?.body.resource.url ?? null,
    };
  },
  hostSafety: async () => {
    onerrorCalls = 0;
    onunhandledrejectionCalls = 0;
    propagationObserved = false;
    const event = new ErrorEvent('error', {
      message: 'Synthetic host safety',
      error: new Error('Synthetic host safety'),
    });
    window.dispatchEvent(event);
    void Promise.reject(new Error('Synthetic host promise safety'));
    await waitFor(() => onunhandledrejectionCalls === 1);
    return {
      onerrorIdentity: window.onerror === installedHandlers.onerror,
      onunhandledrejectionIdentity:
        window.onunhandledrejection === installedHandlers.onunhandledrejection,
      onerrorCalls,
      onunhandledrejectionCalls,
      defaultPrevented: event.defaultPrevented,
      propagationObserved,
      pageStillRuns: 20 + 22,
    };
  },
  release: async () => {
    const local = await createStartedHarness();
    const event = () =>
      window.dispatchEvent(
        new ErrorEvent('error', {
          message: 'Synthetic release',
          error: new Error('Synthetic release'),
        }),
      );
    event();
    const beforeStop = local.drafts.length;
    local.plugin.stop();
    event();
    const afterStop = local.drafts.length;
    local.plugin.start();
    event();
    const afterRestart = local.drafts.length;
    local.plugin.destroy();
    event();
    const afterDestroy = local.drafts.length;
    local.plugin.start();
    const destroyedStartDiagnostic =
      local.plugin.getDiagnostics().at(-1)?.code ?? null;
    local.browser.destroy();
    await local.core.destroy();
    return {
      beforeStop,
      afterStop,
      afterRestart,
      afterDestroy,
      destroyedStartDiagnostic,
    };
  },
  multiInstance: async () => {
    const browser = createBrowserEnvironment();
    const first = createErrorCapturePlugin(browser);
    const second = createErrorCapturePlugin(browser);
    let firstCalls = 0;
    let secondCalls = 0;
    const accepted = Object.freeze({
      ok: true,
      code: 'accepted',
      state: 'started',
      diagnosticsAdded: 0,
    });
    first.initialize(Object.freeze({
      submitEvent: () => {
        firstCalls += 1;
        return accepted;
      },
    }));
    second.initialize(Object.freeze({
      submitEvent: () => {
        secondCalls += 1;
        return accepted;
      },
    }));
    first.start();
    second.start();
    window.dispatchEvent(
      new ErrorEvent('error', { message: 'first', error: new Error('first') }),
    );
    first.destroy();
    window.dispatchEvent(
      new ErrorEvent('error', { message: 'second', error: new Error('second') }),
    );
    second.destroy();
    browser.destroy();
    return { first: firstCalls, second: secondCalls };
  },
  failureIsolation: async () => {
    const browser = createBrowserEnvironment();
    const plugin = createErrorCapturePlugin(browser);
    let calls = 0;
    plugin.initialize(Object.freeze({
      submitEvent: () => {
        calls += 1;
        if (calls === 1) {
          return Object.freeze({
            ok: false,
            code: 'not_started',
            state: 'stopped',
            diagnosticsAdded: 1,
          });
        }
        return Object.freeze({
          ok: true,
          code: 'accepted',
          state: 'started',
          diagnosticsAdded: 0,
        });
      },
    }));
    plugin.start();
    window.dispatchEvent(
      new ErrorEvent('error', { message: 'failed', error: new Error('failed') }),
    );
    window.dispatchEvent(
      new ErrorEvent('error', { message: 'healthy', error: new Error('healthy') }),
    );
    const diagnosticCodes = plugin.getDiagnostics().map((entry) => entry.code);
    plugin.destroy();
    browser.destroy();
    return { calls, diagnosticCodes, pageStillRuns: 20 + 22 };
  },
});
</script>
</body>
</html>`;

const directories: Readonly<Record<string, string>> = Object.freeze({
  plugin: pluginDist,
  browser: browserDist,
  core: coreDist,
  protocol: protocolDist,
});

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
  if (pathname === '/') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(pageHtml);
    return;
  }
  const match = /^\/(plugin|browser|core|protocol)\/([a-z0-9-]+\.js)$/u.exec(pathname);
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

export interface PluginFixtureServer {
  readonly origin: string;
  close(): Promise<void>;
}

export async function startFixtureServer(): Promise<PluginFixtureServer> {
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

- [ ] **Step 4: Run Chromium and verify pass**

Run:

```powershell
pnpm --filter @aurora/core build
pnpm --filter @aurora/browser build
pnpm --filter @aurora/event-schema build
pnpm --filter @aurora/plugin-error test:browser
```

Expected: every command exits 0; Playwright reports 5 passed Chromium tests, no retries, no skipped tests.

- [ ] **Step 5: Run Browser real-browser regression**

Run:

```powershell
pnpm --filter @aurora/browser test:browser
```

Expected: exit 0; all existing Browser Chromium tests remain green.

- [ ] **Step 6: Record the suggested commit boundary**

```powershell
git add packages/plugin-error/test-browser/fixture-server.ts packages/plugin-error/test-browser/error-capture-plugin.spec.ts
git commit -m "test: verify error plugin in chromium"
```

### Task 10: Close Documentation, Coverage, Size, ADR Evidence, and Root Quality Gates

**Files:**

- Create: `packages/plugin-error/README.md`
- Create: `packages/plugin-error/test/documentation-contract.test.ts`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `docs/README.md`
- Modify: `docs/sdk/error-capture-plugin.md`
- Modify: `docs/architecture/sdk-architecture.md`
- Modify: `docs/architecture/formalization-readiness.md`
- Modify: `docs/testing/test-strategy.md`
- Modify: `docs/adr/ADR-003-sdk-plugin-architecture.md`
- Modify: `docs/adr/ADR-005-event-schema-source-of-truth.md`
- Modify: `docs/adr/ADR-006-one-way-dependencies.md`
- Modify: `AGENTS.md`
- Modify: `AURORA_RULES.md`

**Interfaces:**

- Consumes: final public root, complete unit/coverage/package/Chromium output, Workspace boundary output.
- Produces: executable README example, root task inclusion, actual implementation status, bounded ADR evidence, repeatable provisional size evidence, and one root `check:ci` gate.

- [ ] **Step 1: Write the failing README contract test**

Create `packages/plugin-error/test/documentation-contract.test.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import type { BrowserErrorSourceListener } from '@aurora/browser';
import { createCore } from '@aurora/core';
import { createErrorCapturePlugin } from '../src/index.js';

describe('error plugin documentation contract', () => {
  it('documents the exact public assembly and exclusions', async () => {
    const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
    for (const text of [
      "import { createBrowserEnvironment } from '@aurora/browser';",
      "import { createCore } from '@aurora/core';",
      "import { createErrorCapturePlugin } from '@aurora/plugin-error';",
      'core.registerPlugin(errorPlugin);',
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
    const listeners: BrowserErrorSourceListener[] = [];
    const browser = {
      getCapabilities: vi.fn(),
      readPageSnapshot: vi.fn(),
      subscribePageLifecycle: vi.fn(),
      subscribeErrorSources(listener: BrowserErrorSourceListener) {
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
      eventIdProvider: { createEventId: () => 'readme-event-1' },
      eventTimeProvider: { now: () => 1_800_000_000_001 },
    });
    const errorPlugin = createErrorCapturePlugin(browser);
    expect(core.registerPlugin(errorPlugin)).toMatchObject({ ok: true });
    await core.initialize();
    await core.start();
    listeners[0]?.({
      type: 'javascript_error',
      message: 'Synthetic README error',
      sourceUrl: null,
      error: new Error('Synthetic README error'),
    });
    expect(errorPlugin.getDiagnostics()).toEqual([]);
    await core.stop();
    await core.destroy();
    expect(browser.destroy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run and verify the missing-README failure**

Run:

```powershell
pnpm --filter @aurora/plugin-error exec vitest run test/documentation-contract.test.ts
```

Expected: exit 1 with `ENOENT` for `packages/plugin-error/README.md`.

- [ ] **Step 3: Write the exact package README**

Create `packages/plugin-error/README.md` with:

````markdown
# @aurora/plugin-error

Aurora 的浏览器错误采集插件第一增量。它通过 `@aurora/browser` 接收 JavaScript、未处理 Promise 拒绝和资源加载错误事实，用 `@aurora/event-schema` 根入口校验错误正文，并通过 `@aurora/core` 插件上下文提交最小事件草稿。

## 使用

```ts
import { createBrowserEnvironment } from '@aurora/browser';
import { createCore } from '@aurora/core';
import { createErrorCapturePlugin } from '@aurora/plugin-error';

const browser = createBrowserEnvironment();
const core = createCore();
const errorPlugin = createErrorCapturePlugin(browser);

core.registerPlugin(errorPlugin);
await core.initialize();
await core.start();

await core.stop();
await core.destroy();
browser.destroy();
```

BrowserEnvironment 由调用方拥有；插件只取消自己的错误源订阅，不调用 `browser.destroy()`。Core 必须在 Browser 之前停止并销毁插件，最后再由调用方销毁 Browser。

## 公开 API

- `createErrorCapturePlugin(browser: BrowserEnvironment): ErrorCapturePlugin`
- `ERROR_CAPTURE_PLUGIN_NAME`
- `ErrorCaptureDiagnosticCode`
- `ErrorCaptureDiagnosticOperation`
- `ErrorCapturePlugin`
- `ErrorCaptureDiagnostic`

插件钩子同步且幂等。Browser 订阅、单次转换和 Core 提交失败不会抛回宿主；稳定结果写入每实例最新 100 条的冻结诊断。诊断不含错误消息、堆栈、URL、正文或敏感值。

## 边界

- 只从 Core、Browser 和 event-schema 包根导入；
- 不生成事件 ID、时间或协议版本；
- 不创建 EventEnvelope；
- 不直接访问 DOM，不覆盖宿主 handler，不控制事件传播；
- 不保留原生 Event、DOM、Error 或 Promise reason；
- 不实现采样、队列、传输、重试或持久化；
- 不实现去重、分组、指纹、Source Map 或框架错误。

正式契约见 `docs/sdk/error-capture-plugin.md`。
````

- [ ] **Step 4: Update root tasks with exact plugin paths**

Modify root `package.json`:

- add the six plugin config/manifest files, `packages/plugin-error/README.md`, `docs/sdk/error-capture-plugin.md`, `packages/plugin-error/src/**/*.ts`, `packages/plugin-error/test/**/*.ts`, and `packages/plugin-error/test-browser/**/*.ts` to `format:check`;
- add plugin source/test/browser-test/config paths to `lint`;
- append `&& pnpm --filter @aurora/plugin-error test:coverage` to `test:coverage`;
- append `&& pnpm --filter @aurora/plugin-error test:package && pnpm --filter @aurora/plugin-error test:browser` to `check` after the upstream package entries and Browser Chromium gate.

The resulting coverage and check fragments must be:

```json
{
  "test:coverage": "pnpm --filter @aurora/event-schema test:coverage && pnpm --filter @aurora/core test:coverage && pnpm --filter @aurora/browser test:coverage && pnpm --filter @aurora/plugin-error test:coverage",
  "check": "pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm test:coverage && pnpm check:boundaries && pnpm build && pnpm --filter @aurora/event-schema test:package && pnpm --filter @aurora/core test:package && pnpm --filter @aurora/browser test:package && pnpm --filter @aurora/plugin-error test:package && pnpm --filter @aurora/browser test:browser && pnpm --filter @aurora/plugin-error test:browser"
}
```

- [ ] **Step 5: Verify README, coverage, package, and provisional size**

Run:

```powershell
pnpm --filter @aurora/plugin-error exec vitest run test/documentation-contract.test.ts
pnpm --filter @aurora/plugin-error test
pnpm --filter @aurora/plugin-error test:coverage
pnpm --filter @aurora/plugin-error test:package
pnpm --filter @aurora/plugin-error test:browser
```

Expected: every command exits 0; coverage output is at least statements 85%, branches 80%, functions 85%, lines 85%; package entry and 5 Chromium tests pass.

Record provisional TypeScript output size with:

```powershell
node --input-type=module --eval "import { readdir, readFile } from 'node:fs/promises'; import { gzipSync } from 'node:zlib'; const dir='packages/plugin-error/dist'; const names=(await readdir(dir)).filter((name)=>name.endsWith('.js')).sort(); const parts=await Promise.all(names.map((name)=>readFile(dir+'/'+name))); const joined=Buffer.concat(parts); console.log(JSON.stringify({files:names,rawBytes:joined.byteLength,gzipBytes:gzipSync(joined,{level:9}).byteLength}));"
```

Expected: exit 0 and one JSON object with a sorted file list plus positive `rawBytes` and `gzipBytes`. Record both integers in the implementation evidence and label the measurement `requires-benchmark`; do not claim it is a final tree-shaken bundle or silently weaken the approved 8 KiB single-plugin budget.

- [ ] **Step 6: Synchronize implementation truth without changing ADR decisions**

Only after Step 5 passes:

- change `docs/sdk/error-capture-plugin.md` frontmatter `implementation-status` from `not-started` to `implemented` and add the fresh command list, coverage percentages, Chromium count, package-entry result, boundary result, and provisional size output;
- update root `README.md` and `docs/README.md` to list `@aurora/plugin-error` as the first implemented concrete plugin and keep request/performance/behavior/framework/queue/transport absent;
- update `docs/architecture/sdk-architecture.md` with the actual `plugin-error -> browser | core | event-schema` edge, Browser ownership rule, minimal draft flow, and exclusions;
- update `docs/architecture/formalization-readiness.md` so the error-plugin item is implemented while later plugins and the transport pipeline remain pending;
- update `docs/testing/test-strategy.md` with the plugin’s 85/80/85/85 gate, package boundary negatives, and five-scenario Chromium gate;
- update `AGENTS.md` and `AURORA_RULES.md` current-state bullets with the real package, implemented scope, fresh validation, and unchanged decision queue;
- append one dated implementation record to each ADR below. Do not edit earlier records.

Append to ADR-003:

```markdown
### 2026-07-31：Browser 错误采集插件第一增量实施证据

- 决策状态保持 `accepted`，实施状态保持 `in-progress`；本记录只覆盖 `@aurora/plugin-error` 第一增量。
- 插件通过公开 Browser 错误源、event-schema 错误正文解析器和 Core 最小草稿入口组合三层能力；插件不拥有 BrowserEnvironment，不创建系统字段、队列或传输。
- 生命周期、原子订阅失败、停止/销毁释放、同步重入阻断、单次失败恢复、多实例和真实 Chromium 宿主安全门禁均通过。
- 验证命令：`pnpm --filter @aurora/plugin-error typecheck/test/test:coverage/test:package/test:browser`、`pnpm check:boundaries`、`pnpm check:ci`，全部 exit 0。
- 实施 Commit：none（如本轮产生真实 Commit，则只把该真实哈希写入本行）
- Issue/PR：none
- 剩余工作：请求、性能、行为、框架插件、采样、队列、批量、传输、重试和持久化仍不存在。
```

Append to ADR-005:

```markdown
### 2026-07-31：错误插件真实协议消费者证据

- 决策状态保持 `accepted`，实施状态保持 `in-progress`。
- `@aurora/plugin-error` 只从 `@aurora/event-schema` 根入口导入错误常量、限制、类型、`EventType` 与 `parseErrorEventBody`；没有复制错误正文、URL 校验、Promise 有界复制、协议版本或 EventEnvelope。
- 三类 Browser 事实全部在提交 Core 草稿前通过公共错误正文解析器；schema 拒绝不提交且不泄露 issue 输入。
- 包入口、私有路径、契约单测、覆盖率和 Chromium 公共解析证据全部通过；精确命令与结果记录于错误插件正式规格的实施证据。
- 实施 Commit：none（如本轮产生真实 Commit，则只把该真实哈希写入本行）
- Issue/PR：none
```

Append to ADR-006:

```markdown
### 2026-07-31：sdk-plugin 单向依赖与环境边界实施证据

- 决策状态保持 `accepted`，实施状态保持 `in-progress`。
- Workspace Policy 增加 `sdk-plugin -> sdk-core | sdk-browser | protocol`；反向依赖、插件间依赖、framework/tooling 依赖、循环、未声明依赖和跨包私有路径负例均被拒绝。
- sdk-plugin 生产源码的 DOM/宿主全局、Node 运行时、模块级可变状态、宿主修改和事件控制负例均生效；`tsconfig.no-dom.json`、ESLint、包根入口和私有子路径拒绝均通过。
- `@aurora/plugin-error` 实际只声明三个批准的 Workspace 根依赖，三个上游包均无反向依赖。
- 验证命令：Workspace Policy 定向测试、`pnpm check:boundaries`、plugin typecheck/package/Chromium 与根 `pnpm check:ci`，全部 exit 0。
- 实施 Commit：none（如本轮产生真实 Commit，则只把该真实哈希写入本行）
- Issue/PR：none
```

ADR-007 remains `accepted / implemented` and receives no record because its package manager and task-runner decision did not change.

- [ ] **Step 7: Run the root complete quality gate**

Run in this exact order:

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
pnpm --filter @aurora/plugin-error test:package
pnpm --filter @aurora/browser test:browser
pnpm --filter @aurora/plugin-error test:browser
pnpm check:ci
git diff --check
```

Expected: every command exits 0; both Chromium suites pass; all four coverage thresholds pass for plugin-error; package-private paths remain rejected; `pnpm check:ci` repeats the complete root gate successfully; `git diff --check` prints nothing.

If a command fails, do not update implementation status or ADR evidence. Fix only the failing task’s owned file, rerun its targeted command, then rerun the complete sequence from the first command.

- [ ] **Step 8: Audit exclusions and the complete diff**

Run:

```powershell
git diff -- packages/plugin-error tooling/workspace-policy package.json pnpm-lock.yaml eslint.config.mjs README.md AGENTS.md AURORA_RULES.md docs
git status --short --branch
```

Then run these negative source searches:

```powershell
Get-ChildItem -LiteralPath packages/plugin-error/src -Filter *.ts | Select-String -Pattern 'EventEnvelope|CURRENT_PROTOCOL_VERSION|randomUUID|Date\\.now|window\\.|document\\.|preventDefault|stopPropagation|stopImmediatePropagation|console\\.|@aurora/.+/(src|internal)|fetch\\(|XMLHttpRequest|queue|retry|persist|source.?map|fingerprint|dedup'
```

Expected: the scoped diff contains only this plan’s implementation and documentation; status preserves all unrelated pre-existing work; the negative search returns no production match. Legitimate exclusions may appear in README or tests, which are intentionally outside this production-source search.

- [ ] **Step 9: Record the final suggested commit boundary**

```powershell
git add packages/plugin-error/README.md packages/plugin-error/test/documentation-contract.test.ts package.json README.md AGENTS.md AURORA_RULES.md docs/README.md docs/sdk/error-capture-plugin.md docs/architecture/sdk-architecture.md docs/architecture/formalization-readiness.md docs/testing/test-strategy.md docs/adr/ADR-003-sdk-plugin-architecture.md docs/adr/ADR-005-event-schema-source-of-truth.md docs/adr/ADR-006-one-way-dependencies.md
git commit -m "docs: record error capture plugin evidence"
```

Do not push, create a PR, start another module, or change any ADR decision/status beyond the implementation evidence explicitly listed above without separate user authorization.

## Final Executor Self-check

Before claiming implementation completion, answer each item from fresh command output:

1. Only the three upstream package roots are imported.
2. Browser listening, event-schema validation/copying, and Core system-field generation are not duplicated.
3. The plugin never creates ID, time, protocol version, or EventEnvelope.
4. Every owned subscription is logically disabled before removal and is released on stop/destroy.
5. Host handlers, event defaults, propagation, native objects, and page scripts remain unchanged.
6. No native Event, DOM, Error, or raw reason reference survives the synchronous callback.
7. Per-instance re-entry is blocked without turning into deduplication.
8. Provider/Core/schema/Browser failure in one event or instance does not block the next event or another instance.
9. Coverage meets lines 85%, branches 80%, functions 85%, statements 85%.
10. Unit, package-entry, dependency negative, no-DOM, Workspace Policy, and five real Chromium tests pass.
11. Production source contains no placeholder, broad unsafe type, private cross-package import, global mutable state, console output, queue, transport, retry, persistence, Source Map, fingerprint, or later plugin.
12. Documentation and ADRs describe only evidence produced by the completed commands, and ADR-003/005/006 remain `accepted / in-progress` while ADR-007 remains `accepted / implemented`.
