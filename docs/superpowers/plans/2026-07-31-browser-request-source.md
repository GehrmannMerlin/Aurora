# Browser Request Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan is written by Claude Code in planner mode. It is not yet approved; the user must review the plan (and the spec at `docs/sdk/browser-request-source.md`) before implementation may begin.

**Goal:** Add the first `@aurora/browser` request-observation increment: a public `subscribeRequests(listener)` capability that safely observes `window.fetch` and `window.XMLHttpRequest`, projects minimal read-only `BrowserRequestSourceEvent` facts (mechanism, method, sanitized URL, startedAt, durationMs, outcome, statusCode), and releases the host back to its original state when the last subscriber is removed. This plan implements only the Browser observation layer. It does NOT implement protocol conversion, Core submission, sampling, queuing, transport, or `packages/plugin-request`.

**Architecture:** Each `createBrowserEnvironment()` owns a per-instance request-source manager with a shared-proxy + reference-count model: the first subscriber installs a `window.fetch` wrapper and a `window.XMLHttpRequest` wrapper; each additional subscriber increments the count; the last unsubscribe/destroy decrements to zero and restores the original host references. Wrappers are thin and behavior-preserving (see Global Constraints). Request facts are produced synchronously on completion, frozen, and delivered to every active subscriber; a callback throw is isolated per subscriber and never escapes to the host. All URL sanitization uses the existing `sanitizePageUrl()` (origin + pathname); the module never reads request/response bodies, headers, cookies, or credentials.

**Tech Stack:** TypeScript 6.0.3 strict mode, pnpm 11.17.0 Workspace, Node.js 24.18.x task runtime, Vitest 4.1.10, V8 coverage, Playwright 1.62.0 with Chromium, ESLint 10.8.0, Prettier 3.9.6, existing `@aurora/workspace-policy`.

## Global Constraints

- Implement only inside `packages/browser`; do not add `packages/plugin-request`, Core, server, database, platform, CI, release, container, IaC, or cloud code.
- Do not change the public API of `@aurora/event-schema`, `@aurora/core`, `@aurora/plugin-error`, or `tooling/workspace-policy` (except the workspace-policy/ESLint source-gate carve-outs listed below, which are required to permit the intentional host-wrapper install).
- Do not import `@aurora/event-schema` or `@aurora/core` from Browser production source. Request facts stay in Browser terms.
- Never create a second envelope, protocol version, event ID, time, queue, batch, sender, retry path, sampler, deduplicator, grouping key, fingerprint, Source Map, or general event bus.
- Never read or retain: request body, response body, request/response headers, `responseText`, `getAllResponseHeaders()`, Cookie, Authorization, Token, form data, DOM, page text, user input, Storage, full URL query/fragment, username/password, fingerprint, IP, or any native `Request`/`Response`/`XMLHttpRequest`/`Event` reference after the synchronous callback.
- `window.fetch` and `window.XMLHttpRequest` are wrapped ONLY by the shared per-instance proxy, installed on first subscriber and restored on last release. No module-level mutable state, no global singleton, no irreversible global replacement.
- Fetch wrapper: pass through all original arguments verbatim to the original fetch; return the original Promise; never consume `response.body`; never call `response.clone()`; preserve success/rejection semantics, `this`, and the returned `Response`.
- XHR wrapper: never mutate `XMLHttpRequest.prototype` or static members; `instanceof XMLHttpRequest` must hold for real instances; never overwrite caller `onload`/`onerror`/`onabort`/`ontimeout`/`onreadystatechange`; never read response body or sensitive headers; `open`/`send`/`abort` argument and return semantics preserved.
- Never call `preventDefault()`, `stopPropagation()`, `stopImmediatePropagation()`; never assign `window.onerror`/`window.onunhandledrejection`.
- Never register listeners or install wrappers at module import time; callers must explicitly `createBrowserEnvironment()` and `subscribeRequests()`.
- One observer callback throw must not affect the network request, other subscribers, or the host page; one subscriber's release must not affect another subscriber or another instance.
- Diagnostics stay per-instance, capped at the latest 100, frozen, and limited to sequence, stable code, operation, capability, and event type; never include exception text, stack, URL, method, status, body, request, response, XHR, event, or caller data. Production source does not call `console`.
- TypeScript remains `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `useUnknownInCatchVariables`; public functions have explicit parameter and return types.
- Do not use unexplained `any`, `Object`, `Function`, `Record<string, any>`, double assertions, non-null assertions, or error-suppression directives.
- Files use `kebab-case`; types/interfaces use `PascalCase`; functions/variables use `camelCase`; booleans use `is`, `has`, `can`, or `should`.
- Do not create `utils`, `helpers`, `common`, or `misc`; every source file has the single responsibility listed below.
- Coverage thresholds stay lines 85%, branches 80%, functions 85%, statements 85%; do not exclude new production decision files or lower thresholds.
- Each task uses the red-green-minimal implementation-regression sequence and ends with a suggested, narrowly scoped commit boundary. Do not stage or commit unrelated pre-existing work.
- The specification is `docs/sdk/browser-request-source.md`; if code and this plan differ, stop and resolve the specification before broadening the implementation.

## Complete File Tree and Responsibilities

```text
packages/browser/
├── src/
│   ├── browser-environment.ts   # add subscribeRequests() and request manager wiring
│   ├── capabilities.ts          # add RequestSource capability, canObserveRequests
│   ├── diagnostics.ts           # extend eventType union with request types
│   ├── index.ts                 # export request types/constants
│   ├── request-source.ts        # NEW: BrowserRequestSourceEvent projection + manager
│   ├── request-observer.ts      # NEW: shared fetch/XHR proxy install + reference count + restore
│   ├── safe-access.ts           # unchanged
│   └── ... (existing files unchanged)
├── test/
│   ├── request-source.test.ts   # NEW: capability, subscribe, projection, lifecycle, diagnostics
│   ├── request-observer.test.ts # NEW: fetch/XHR wrapper install/restore, refcount, host-safety
│   ├── host-safety.test.ts      # extend: fetch/XHR wrappers preserve host behavior
│   ├── multi-instance.test.ts   # extend: request subscriptions isolated per instance
│   ├── package-entry.test.ts    # extend: request exports + private paths
│   ├── architecture-boundary.test.ts # extend: no cross-package/private path in request source
│   └── ... (existing files unchanged)
└── test-browser/
    ├── request-source.spec.ts   # NEW: real Chromium fetch/XHR observation
    └── fixture-server.ts        # extend routes for fetch/XHR/abort/404
```

Existing files modified by this plan:

```text
packages/browser/src/browser-environment.ts
packages/browser/src/capabilities.ts
packages/browser/src/diagnostics.ts
packages/browser/src/index.ts
packages/browser/test/package-entry.test.ts
packages/browser/test/architecture-boundary.test.ts
packages/browser/test/host-safety.test.ts
packages/browser/test/multi-instance.test.ts
packages/browser/test/documentation-contract.test.ts
packages/browser/README.md
tooling/workspace-policy/src/environment.ts      # carve-out for window.fetch/window.XMLHttpRequest assignment
tooling/workspace-policy/test/environment.test.ts # positive fixture: controlled wrapper install
eslint.config.mjs                                 # carve-out for wrapper install + no on* override/no body reads
README.md
AGENTS.md
AURORA_RULES.md
docs/README.md
docs/architecture/system-overview.md
docs/architecture/sdk-architecture.md
docs/architecture/formalization-readiness.md
docs/testing/test-strategy.md
docs/adr/ADR-003-sdk-plugin-architecture.md
docs/adr/ADR-005-event-schema-source-of-truth.md
docs/adr/ADR-006-one-way-dependencies.md
```

## Frozen Public Signatures

All symbols below export from the `@aurora/browser` root. No second subpath export.

```ts
export const BrowserRequestMechanism = Object.freeze({
  Fetch: 'fetch',
  XmlHttpRequest: 'xhr',
} as const);
export type BrowserRequestMechanism =
  (typeof BrowserRequestMechanism)[keyof typeof BrowserRequestMechanism];

export const BrowserRequestOutcome = Object.freeze({
  Success: 'success',
  HttpError: 'http_error',
  NetworkError: 'network_error',
  Timeout: 'timeout',
  Canceled: 'canceled',
} as const);
export type BrowserRequestOutcome =
  (typeof BrowserRequestOutcome)[keyof typeof BrowserRequestOutcome];

export const BrowserRequestSourceEventType = Object.freeze({
  Fetch: 'fetch',
  Xhr: 'xhr',
} as const);
export type BrowserRequestSourceEventType =
  (typeof BrowserRequestSourceEventType)[keyof typeof BrowserRequestSourceEventType];

export interface BrowserFetchRequestSourceEvent {
  readonly mechanism: typeof BrowserRequestMechanism.Fetch;
  readonly method: string;
  readonly url: string;
  readonly startedAt: number;
  readonly durationMs: number;
  readonly outcome: BrowserRequestOutcome;
  readonly statusCode: number | null;
}

export interface BrowserXhrRequestSourceEvent {
  readonly mechanism: typeof BrowserRequestMechanism.XmlHttpRequest;
  readonly method: string;
  readonly url: string;
  readonly startedAt: number;
  readonly durationMs: number;
  readonly outcome: BrowserRequestOutcome;
  readonly statusCode: number | null;
}

export type BrowserRequestSourceEvent =
  | BrowserFetchRequestSourceEvent
  | BrowserXhrRequestSourceEvent;

export type BrowserRequestSourceListener = (event: BrowserRequestSourceEvent) => void;

export interface BrowserCapabilities {
  // existing fields unchanged
  readonly canObserveRequests: boolean;
}

export interface BrowserEnvironment {
  // existing methods unchanged
  subscribeRequests(listener: BrowserRequestSourceListener): BrowserSubscribeResult;
}
```

`BrowserRequestSourceEvent` is frozen. `statusCode` is `null` when no HTTP status was observed (network error, timeout, canceled) or when status read fails. `url` is the sanitized `origin + pathname`; a request whose URL sanitizes to `null` produces no fact (no invented URL). `method` is a case-preserved string (browser `Request`/`XHR` method); the module does not normalize it to the request contract's uppercase enum.

---

### Task 1: Add Request Types, Capability, and Diagnostic Union

**Files:**

- Create: `packages/browser/src/request-source.ts` (types + constants + event-type constant + listener)
- Modify: `packages/browser/src/capabilities.ts`
- Modify: `packages/browser/src/diagnostics.ts`
- Modify: `packages/browser/src/index.ts`
- Create: `packages/browser/test/request-source.test.ts` (types/capability section only)
- Modify: `packages/browser/test/package-entry.test.ts`

**Interfaces:**

- Consumes: `BrowserCapabilities`, `BrowserCapabilityName`, `BrowserDiagnostic`, `BrowserDiagnosticEventType`, `BrowserErrorSourceEventType`, `PageLifecycleEventType`.
- Produces: `BrowserRequestMechanism`, `BrowserRequestOutcome`, `BrowserRequestSourceEventType`, `BrowserRequestSourceEvent`, `BrowserRequestSourceListener`, `BrowserCapabilities.canObserveRequests`, `BrowserCapabilityName.RequestSource`, and the extended diagnostic union.

- [ ] **Step 1: Write the failing request-types test**

Create `packages/browser/test/request-source.test.ts`:

```ts
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  BrowserRequestMechanism,
  BrowserRequestOutcome,
  BrowserRequestSourceEventType,
  type BrowserRequestSourceEvent,
  type BrowserRequestSourceListener,
} from '../src/index.js';

describe('request source public contract', () => {
  it('exports the exact stable runtime constants', () => {
    expect(BrowserRequestMechanism).toEqual({ Fetch: 'fetch', XmlHttpRequest: 'xhr' });
    expect(BrowserRequestOutcome).toEqual({
      Success: 'success',
      HttpError: 'http_error',
      NetworkError: 'network_error',
      Timeout: 'timeout',
      Canceled: 'canceled',
    });
    expect(BrowserRequestSourceEventType).toEqual({ Fetch: 'fetch', Xhr: 'xhr' });
    expect(Object.isFrozen(BrowserRequestMechanism)).toBe(true);
    expect(Object.isFrozen(BrowserRequestOutcome)).toBe(true);
    expect(Object.isFrozen(BrowserRequestSourceEventType)).toBe(true);
  });

  it('narrows the request source event and listener types', () => {
    expectTypeOf<BrowserRequestSourceEvent['mechanism']>().toEqualTypeOf<'fetch' | 'xhr'>();
    expectTypeOf<BrowserRequestSourceEvent['outcome']>().toEqualTypeOf<
      'success' | 'http_error' | 'network_error' | 'timeout' | 'canceled'
    >();
    expectTypeOf<BrowserRequestSourceEvent['statusCode']>().toEqualTypeOf<number | null>();
    expectTypeOf<BrowserRequestSourceListener>().parameter(0).toEqualTypeOf<BrowserRequestSourceEvent>();
  });
});
```

- [ ] **Step 2: Run and verify the missing-module failure**

```powershell
pnpm --filter @aurora/browser exec vitest run test/request-source.test.ts
```

Expected: exit 1 because `request-source.ts` does not exist and the root does not export the request symbols.

- [ ] **Step 3: Implement the request types, capability, and diagnostic union**

Create `packages/browser/src/request-source.ts`:

```ts
export const BrowserRequestMechanism = Object.freeze({
  Fetch: 'fetch',
  XmlHttpRequest: 'xhr',
} as const);

export type BrowserRequestMechanism =
  (typeof BrowserRequestMechanism)[keyof typeof BrowserRequestMechanism];

export const BrowserRequestOutcome = Object.freeze({
  Success: 'success',
  HttpError: 'http_error',
  NetworkError: 'network_error',
  Timeout: 'timeout',
  Canceled: 'canceled',
} as const);

export type BrowserRequestOutcome =
  (typeof BrowserRequestOutcome)[keyof typeof BrowserRequestOutcome];

export const BrowserRequestSourceEventType = Object.freeze({
  Fetch: 'fetch',
  Xhr: 'xhr',
} as const);

export type BrowserRequestSourceEventType =
  (typeof BrowserRequestSourceEventType)[keyof typeof BrowserRequestSourceEventType];

export interface BrowserFetchRequestSourceEvent {
  readonly mechanism: typeof BrowserRequestMechanism.Fetch;
  readonly method: string;
  readonly url: string;
  readonly startedAt: number;
  readonly durationMs: number;
  readonly outcome: BrowserRequestOutcome;
  readonly statusCode: number | null;
}

export interface BrowserXhrRequestSourceEvent {
  readonly mechanism: typeof BrowserRequestMechanism.XmlHttpRequest;
  readonly method: string;
  readonly url: string;
  readonly startedAt: number;
  readonly durationMs: number;
  readonly outcome: BrowserRequestOutcome;
  readonly statusCode: number | null;
}

export type BrowserRequestSourceEvent =
  | BrowserFetchRequestSourceEvent
  | BrowserXhrRequestSourceEvent;

export type BrowserRequestSourceListener = (event: BrowserRequestSourceEvent) => void;
```

Modify `packages/browser/src/capabilities.ts`:

```ts
export const BrowserCapabilityName = Object.freeze({
  Window: 'window',
  Document: 'document',
  Navigator: 'navigator',
  Performance: 'performance',
  PageUrl: 'page_url',
  UserAgent: 'user_agent',
  Visibility: 'visibility',
  PageLifecycle: 'page_lifecycle',
  ErrorSource: 'error_source',
  RequestSource: 'request_source',
} as const);

export interface BrowserCapabilities {
  // existing fields unchanged
  readonly canObserveRequests: boolean;
}
```

Add `canObserveRequests` to `detectBrowserCapabilities()`: true when `readMethod(host.windowTarget, 'fetch')` is ok AND `readMethod(host.windowTarget, 'XMLHttpRequest')` is ok. If either read throws, record `property_read_failed / read_capabilities / request_source` (only for the throwing side) but still allow the other mechanism to be observed.

Modify `packages/browser/src/diagnostics.ts`: import `BrowserRequestSourceEventType` and extend the union:

```ts
import type { BrowserRequestSourceEventType } from './request-source.js';
export type BrowserDiagnosticEventType =
  | PageLifecycleEventType
  | BrowserErrorSourceEventType
  | BrowserRequestSourceEventType;
```

Modify `packages/browser/src/index.ts` — add value + type exports (do NOT repeat merged value+type names in the type-only block; TS2300 under `verbatimModuleSyntax`):

```ts
export {
  BrowserRequestMechanism,
  BrowserRequestOutcome,
  BrowserRequestSourceEventType,
} from './request-source.js';
export type {
  BrowserFetchRequestSourceEvent,
  BrowserRequestSourceEvent,
  BrowserRequestSourceListener,
  BrowserXhrRequestSourceEvent,
} from './request-source.js';
```

Extend `packages/browser/test/package-entry.test.ts` root-export assertions with `BrowserRequestMechanism`, `BrowserRequestOutcome`, `BrowserRequestSourceEventType`, and add private-path negatives `@aurora/browser/request-source`, `@aurora/browser/request-observer`.

- [ ] **Step 4: Run and verify pass**

```powershell
pnpm --filter @aurora/browser exec vitest run test/request-source.test.ts
pnpm --filter @aurora/browser typecheck
```

Expected: exit 0; both tests pass; no type diagnostics.

- [ ] **Step 5: Run the package and browser regression**

```powershell
pnpm --filter @aurora/browser test
pnpm --filter @aurora/browser test:package
```

Expected: exit 0; existing 11 files / 53 tests remain green; package entry lists the three new values; private paths reject.

- [ ] **Step 6: Record the suggested commit boundary**

```powershell
git add packages/browser/src/request-source.ts packages/browser/src/capabilities.ts packages/browser/src/diagnostics.ts packages/browser/src/index.ts packages/browser/test/request-source.test.ts packages/browser/test/package-entry.test.ts
git commit -m "feat: add browser request source contract"
```

### Task 2: Build the Shared Fetch/XHR Observer with Reference Counting

**Files:**

- Create: `packages/browser/src/request-observer.ts`
- Create: `packages/browser/test/request-observer.test.ts`

**Interfaces:**

- Consumes: `BrowserHostContext`, `BrowserDiagnosticStore`, `BrowserDiagnosticCode`/`Operation`, `BrowserRequestSourceEvent`, `BrowserRequestSourceListener`, `sanitizePageUrl`, `readProperty`/`callMethod`.
- Produces: `createRequestObserver(host, diagnostics)` exposing `subscribe(listener)`, `unsubscribe(listener)`, `hasObservers(): boolean`, and internal host-install/restore with a per-instance reference count.

**Design decisions (binding):**

- The XHR wrapper preserves `instanceof` by having the installed `window.XMLHttpRequest` constructor return a real native `new NativeXhr()` instance and wrapping only that instance's `open`/`send`/`abort`/`addEventListener`/`removeEventListener` methods. It never touches `XMLHttpRequest.prototype`. `instanceof XMLHttpRequest` holds because the returned object is a real native instance.
- The observer tracks, per installed instance, the original method and a shared `isActive` record so a destroyed instance's retained XHR methods become no-ops.
- fetch install: `const original = window.fetch`; wrapper reads method/url (safe), calls `original.apply(this, args)`, and on settle reads `response.status` without consuming the body. On synchronous throw, re-throw the same value. On rejection, rethrow the same reason after projecting `network_error`.
- Reference count is an instance-local number; the observer never uses module-level mutable state.

The full minimal implementation is intentionally thin and mirrors the error-source manager shape. The test file must cover: install on first subscriber, restore on last release, `window.fetch` identity before/after, `window.XMLHttpRequest` identity before/after, `instanceof` preserved, reference count increments/decrements, host read/install throw rollback, and no module-level mutable state.

- [ ] **Step 1: Write the failing observer test**

Create `packages/browser/test/request-observer.test.ts` with at least these cases (use a recoverable host double; assert on public identities and listener deliveries):

```ts
// fetch identity + reference count
// XHR identity + instanceof preserved
// first subscriber installs, second does not reinstall
// last release restores original references
// install throw rolls back and returns listener_registration_failed
// fetch wrapper passes through args and returns the original Promise/Response
// fetch wrapper does not consume response.body
// fetch synchronous throw is rethrown verbatim
// fetch rejection reason is preserved
// XHR open/send/abort preserved, handler not overridden
// no module-level mutable state (two observer instances independent)
```

- [ ] **Step 2: Run and verify the expected failure**

```powershell
pnpm --filter @aurora/browser exec vitest run test/request-observer.test.ts
```

Expected: exit 1 because `request-observer.ts` does not exist.

- [ ] **Step 3: Implement the observer**

Create `packages/browser/src/request-observer.ts`. The file has a single responsibility (shared fetch/XHR proxy install + reference count + restore). It must not import `event-schema`/`core`. It uses `safe-access` for all host reads/calls. The XHR wrapper is the only place that constructs native XHR instances (via `new (original as ...)`), with the returned native instance's methods wrapped. Expose only `createRequestObserver`, the `RequestObserver` interface, and the fact listener type. Keep method/url/status reads safe; a URL that sanitizes to `null` produces no fact.

- [ ] **Step 4: Run and verify pass**

```powershell
pnpm --filter @aurora/browser exec vitest run test/request-observer.test.ts
pnpm --filter @aurora/browser typecheck
```

Expected: exit 0; all observer tests pass; no type diagnostics.

- [ ] **Step 5: Run the browser regression**

```powershell
pnpm --filter @aurora/browser test
```

Expected: exit 0; existing suites remain green.

- [ ] **Step 6: Record the suggested commit boundary**

```powershell
git add packages/browser/src/request-observer.ts packages/browser/test/request-observer.test.ts
git commit -m "feat: add shared fetch and xhr request observer"
```

### Task 3: Wire subscribeRequests and Fact Projection into BrowserEnvironment

**Files:**

- Modify: `packages/browser/src/browser-environment.ts`
- Modify: `packages/browser/test/request-source.test.ts` (lifecycle/fact sections)
- Create: `packages/browser/test/host-safety.test.ts` additions

**Interfaces:**

- Consumes: `createRequestObserver`, `BrowserRequestSourceListener`, `BrowserRequestSourceEvent`, `BrowserSubscribeResult`.
- Produces: `BrowserEnvironment.subscribeRequests(listener)`, atomic subscribe with rollback, idempotent unsubscribe, destroy releases all request subscriptions, post-destroy reject.

- [ ] **Step 1: Add failing lifecycle tests**

Extend `request-source.test.ts` with subscription lifecycle, fact projection (fetch success/http_error/network/canceled; XHR load/error/abort/timeout), URL sanitization (query/fragment stripped), input immutability (Request/RequestInit unchanged), and host restoration.

- [ ] **Step 2: Run and verify expected failure**

```powershell
pnpm --filter @aurora/browser exec vitest run test/request-source.test.ts
```

Expected: exit 1 because `subscribeRequests` is not yet wired.

- [ ] **Step 3: Implement the wiring**

In `browser-environment.ts`, create the request observer alongside lifecycle/error-sources, add `subscribeRequests` to `BrowserEnvironment`, and include the request observer in `destroy()` (release all request subscriptions before marking destroyed, matching the error-source destroy order).

- [ ] **Step 4: Run and verify pass**

```powershell
pnpm --filter @aurora/browser exec vitest run test/request-source.test.ts test/host-safety.test.ts
pnpm --filter @aurora/browser typecheck
```

- [ ] **Step 5: Run full browser regression**

```powershell
pnpm --filter @aurora/browser test
pnpm --filter @aurora/browser test:package
```

- [ ] **Step 6: Record the suggested commit boundary**

```powershell
git add packages/browser/src/browser-environment.ts packages/browser/test/request-source.test.ts packages/browser/test/host-safety.test.ts
git commit -m "feat: subscribe browser request facts"
```

### Task 4: Multi-instance, Architecture Boundary, and Host-Safety Gates

**Files:**

- Modify: `packages/browser/test/multi-instance.test.ts`
- Modify: `packages/browser/test/architecture-boundary.test.ts`
- Modify: `packages/browser/test/host-safety.test.ts`

**Interfaces:** the final root API; black-box proof that instances, failures, release, exports, imports, host safety, and module state remain isolated.

Add tests proving: one instance destroy does not affect another instance's request subscription; two instances share one host but restore their own captured original references; callback throw in one subscriber does not affect another subscriber or the page; no native object reference survives the synchronous callback (revocable proxy pattern).

Extend `architecture-boundary.test.ts` forbidden-scan with `@aurora/event-schema`, `@aurora/core`, `parseRequestEventBody`, `RequestEventEnvelope`, `responseText`, `getAllResponseHeaders`, `document.cookie`, `localStorage`, `sessionStorage`, `console.`, `/src/`, `/internal/`.

- [ ] **Steps 1–5:** red → verify failure → implement only test additions → verify pass → run `pnpm --filter @aurora/browser test` and `pnpm check:boundaries`.
- [ ] **Step 6:** suggested commit boundary.

### Task 5: Workspace Policy and ESLint Carve-outs for the Intentional Wrapper Install

**Files:**

- Modify: `tooling/workspace-policy/src/environment.ts`
- Modify: `tooling/workspace-policy/test/environment.test.ts`
- Modify: `eslint.config.mjs`

**Interfaces:** the `forbidden-host-mutation`/`forbidden-host-event-control` predicates and the Browser ESLint `no-restricted-syntax` block must permit the deliberate assignment of `window.fetch` and `window.XMLHttpRequest` inside `request-observer.ts` while still forbidding every other host mutation, prototype modification, `on*` handler override, and body/header read.

Approach: keep the predicates strict for all files EXCEPT a narrowly scoped allowance. The cleanest gate is to add a comment-marker or a path-based allow-list. Because `environment.ts` inspects by AST and package directory, the least-surprise carve-out is: `isBrowserHostMutation` returns false when the assignment target is exactly `window.fetch` or `window.XMLHttpRequest` AND the file is `request-observer.ts` (detected via `file` ending with `request-observer.ts`). Mirror this in `eslint.config.mjs` by adding a `packages/browser/src/request-observer.ts` block that relaxes only the two `AssignmentExpression[left.object.name='window'][left.property.name=/^(fetch|XMLHttpRequest)$/]` selectors. Add positive workspace fixtures (`request-observer.ts` assigning `window.fetch`/`window.XMLHttpRequest` passes; other files assigning the same fail) and keep all existing negatives green.

- [ ] **Step 1:** write failing workspace fixtures + eslint expectations (positive + negative).
- [ ] **Step 2:** run `pnpm --filter @aurora/workspace-policy exec vitest run test/environment.test.ts` expecting the new positives to fail.
- [ ] **Step 3:** implement the carve-out.
- [ ] **Step 4:** run workspace tests + `pnpm --filter @aurora/browser lint` expecting pass.
- [ ] **Step 5:** run `pnpm check:boundaries` and browser typecheck regression.
- [ ] **Step 6:** suggested commit boundary.

### Task 6: Real Chromium Verification

**Files:**

- Create: `packages/browser/test-browser/request-source.spec.ts`
- Modify: `packages/browser/test-browser/fixture-server.ts` (add `/ok`, `/not-found`, `/echo-body` routes)

Verify with the existing Playwright Chromium gate:

- import does not install wrappers (identities equal to pristine before subscribe);
- real `fetch('/ok')` success fact (method GET, status 200, outcome success) — and the caller can still read `response.text()`;
- real `fetch('/not-found')` → `http_error` status 404, response body still readable;
- real `fetch('http://127.0.0.1:1/nope')` network rejection → `network_error`, caller rejection reason preserved;
- real `fetch` with `AbortController` cancel → `canceled`;
- real XHR `load` (status 200), `error`, and `abort` each produce one fact; caller `onload`/`onabort` still run;
- `window.fetch` / `window.XMLHttpRequest` identity restored after last unsubscribe and after destroy;
- `instanceof XMLHttpRequest` holds inside the page;
- multi-subscriber each receives one fact; one unsubscribe does not stop the other;
- two instances isolated; destroying one leaves the other active;
- observer callback throw does not break the page or the request.

- [ ] **Steps 1–5:** write spec → run expecting fixture failure → implement fixture routes → run `pnpm --filter @aurora/browser build` + `pnpm --filter @aurora/browser test:browser` expecting 8+ new Chromium tests pass → run full browser Chromium regression.
- [ ] **Step 6:** suggested commit boundary.

### Task 7: Documentation, Coverage, Size, ADR Evidence, and Root Quality Gates

**Files:**

- Modify: `packages/browser/README.md`
- Modify: `packages/browser/test/documentation-contract.test.ts`
- Modify: `docs/README.md`, `docs/architecture/system-overview.md`, `docs/architecture/sdk-architecture.md`, `docs/architecture/formalization-readiness.md`, `docs/testing/test-strategy.md`
- Modify: `docs/adr/ADR-003-sdk-plugin-architecture.md`, `docs/adr/ADR-005-event-schema-source-of-truth.md`, `docs/adr/ADR-006-one-way-dependencies.md`
- Modify: `AGENTS.md`, `AURORA_RULES.md`, `README.md`

- [ ] **Step 1:** write the failing README contract test additions (request section, subscribeRequests, request facts, exclusions, request-observation examples).
- [ ] **Step 2:** run expecting ENOENT/failed-section.
- [ ] **Step 3:** update the module README truthfully.
- [ ] **Step 4:** update downstream docs and ADR evidence (ADR-003/006 request-observation records, keep `accepted / in-progress`; ADR-005 unchanged; ADR-007 unchanged).
- [ ] **Step 5:** record provisional size: `dist/request-source.js` + `dist/request-observer.js` raw + gzip, marked `requires-benchmark`.
- [ ] **Step 6:** run the complete root gate exactly:

```powershell
pnpm install --frozen-lockfile
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

- [ ] **Step 7:** audit the scoped diff and run the negative production-source search (no match expected for `@aurora/(event-schema|core)`, `responseText`, `getAllResponseHeaders`, `document.cookie`, `localStorage`, `sessionStorage`, `console.`, `preventDefault`, `stopPropagation`, `stopImmediatePropagation`, `/src/`, `/internal/`).
- [ ] **Step 8:** record the final suggested commit boundary.

## Final Executor Self-check

1. Only `@aurora/browser` root is extended; no `event-schema`/`core` import in Browser production source.
2. Fetch wrapper passes through all args verbatim, returns the original Promise, never consumes response body, preserves sync-throw/rejection semantics.
3. XHR wrapper preserves `instanceof`, `open`/`send`/`abort` semantics, caller handlers, never reads body/headers, no prototype mutation.
4. Shared proxy + per-instance reference count: first subscriber installs, last release restores original host references.
5. URL query/fragment removed via `sanitizePageUrl`; a request whose URL sanitizes to null produces no fact.
6. No module-level mutable state, no global singleton, no irreversible host replacement.
7. Callback throw is isolated per subscriber; one subscriber/instance failure never affects others.
8. Diagnostics capped, frozen, sanitized; no exception text, URL, method, status, body, request, response, XHR, or caller data.
9. Coverage meets lines 85%, branches 80%, functions 85%, statements 85%.
10. Package-entry, dependency-negative, Workspace boundary, host-safety, and real Chromium gates pass.
11. Production source contains no placeholder, broad unsafe type, private cross-package import, global mutable state, console output, queue, transport, retry, persistence, Source Map, fingerprint, dedup, or later plugin.
12. Documentation and ADRs describe only evidence produced by the completed commands; ADR-003/005/006 remain `accepted / in-progress`, ADR-007 remains `accepted / implemented`; this plan does not change any ADR decision or implementation status.
