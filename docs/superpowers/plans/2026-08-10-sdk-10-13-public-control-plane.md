---
title: SDK-10—13 Public SDK Control Plane Implementation Plan
status: approved
owner: sdk
created: 2026-08-10
applies-to: 新包 @aurora/sdk（sdk-core 层）与 @aurora/browser composition
related:
  - ../../sdk/sdk-public-configuration-context-composition.md
  - ../../sdk/request-allowlist-path-normalization-classification.md
  - ../../sdk/unified-privacy-filtering-and-beforesend.md
  - ../../sdk/sdk-sampling-policy.md
  - ../../sdk/sdk-core-foundation.md
  - ../../sdk/core-event-creation.md
  - ../../protocol/event-schema-foundation.md
  - ../../protocol/request-event-contract.md
  - ../../adr/ADR-003-sdk-plugin-architecture.md
  - ../../adr/ADR-005-event-schema-source-of-truth.md
supersedes: none
review-cycle: sdk-public-api-or-lifecycle-change
---

# SDK-10—13 Public SDK Control Plane Implementation Plan

> **For agentic workers:** Executed inline by the current Claude main session (user-authorized FAST INLINE MODE; no subagents/reviewer). Four independent acceptance stops: SDK-10, SDK-11, SDK-12, SDK-13.

**Goal:** Build the env-agnostic SDK public control plane in a new `@aurora/sdk` package (public config, unified privacy filter + `beforeSend`, deterministic sampling, request classification) plus the browser composition entry `createAuroraSdk`, per the four approved G05 specs.

**Architecture:** `@aurora/sdk` (`aurora.layer: sdk-core`, only dep `@aurora/event-schema`) holds the pipeline modules and `createSdkControlPlane`. `@aurora/browser` (sdk-browser → sdk-core|protocol) gains `createAuroraSdk`, which parses config → creates core + control plane → wraps injected plugin contexts with the control-plane submit seam → registers them → returns a handle. The control plane runs `privacy filter → beforeSend → request classification → sampling` before an event reaches core.

**Tech Stack:** TypeScript 6.0.3 strict, Vitest 4.1.10, pnpm workspace, no DOM (sdk-core environment policy), coverage 85/80/85/85 for `@aurora/sdk`.

## Global Constraints

- `@aurora/sdk` depends only on `@aurora/event-schema`; no DOM identifiers (`window`/`document`/`fetch`/`URL` global forbidden in sdk-core source), no `process`/`Buffer`/`require`; no module-level `let`/mutable containers; no new dependency layer.
- `@aurora/browser` keeps its sources untouched; only adds `@aurora/core` + `@aurora/sdk` runtime deps and one new composition module; its package-contract test is updated accordingly.
- Pipeline order is fixed (PRD §5.1.14 + SDK-10 spec §4.4): `privacy → beforeSend → request classification (request only) → sampling`.
- No queue/transport (G06), no framework adapter (G07), no wire-protocol change (ADR-005), no sampling extrapolation.
- Request body stays protocol-safe: no body/credentials/unauthorized query params; URL query+fragment already stripped by the protocol parser.
- Each leaf acceptance stop runs only its targeted tests + affected typecheck + `git diff --check`; no root/PostgreSQL/Browser-matrix/coverage runs.

---

### Task 1: `@aurora/sdk` scaffold + configuration module (SDK-10 config surface)

**Files:**
- Create: `packages/sdk/package.json`, `packages/sdk/tsconfig.json`, `packages/sdk/tsconfig.build.json`, `packages/sdk/tsconfig.no-dom.json`, `packages/sdk/vitest.config.ts`, `packages/sdk/README.md`
- Create: `packages/sdk/src/configuration.ts`
- Create: `packages/sdk/test/configuration.test.ts`
- Create: `packages/sdk/test/no-dom-consumer.ts`, `packages/sdk/test/package-entry.test.ts`

**Interfaces:**
- Produces (from `src/configuration.ts`): `SdkConfigInput`, `SdkConfigSnapshot`, `SdkSampleRatesInput`, `SdkSampleRatesSnapshot`, `SdkRequestPathRuleInput`, `SdkConfigFix`, `SdkConfigParseResult`, `parseSdkConfig(input: unknown): SdkConfigParseResult`.
- Produces (from `src/event-draft.ts`): `SdkEventDraft { readonly eventType: EventType; readonly body: unknown }`.

**package.json** (key fields):

```json
{
  "name": "@aurora/sdk",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "description": "Aurora SDK public control plane",
  "sideEffects": false,
  "engines": { "node": ">=24.18.0 <25" },
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "files": ["dist", "README.md"],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc -p tsconfig.json --noEmit && tsc -p tsconfig.no-dom.json --noEmit",
    "test": "vitest run --exclude test/package-entry.test.ts",
    "test:coverage": "vitest run --coverage --exclude test/package-entry.test.ts",
    "test:package": "pnpm build && vitest run test/package-entry.test.ts"
  },
  "dependencies": { "@aurora/event-schema": "workspace:*" },
  "devDependencies": {
    "@types/node": "24.13.3",
    "@vitest/coverage-v8": "4.1.10",
    "typescript": "6.0.3",
    "vitest": "4.1.10"
  },
  "aurora": { "layer": "sdk-core" }
}
```

`tsconfig.no-dom.json` mirrors `packages/core/tsconfig.no-dom.json` (lib `ES2022`, no DOM).

**configuration.ts** (implementation sketch — exact defaults per SDK-10 spec §4.2):

```ts
import type { EventType } from '@aurora/event-schema';

export interface SdkSampleRatesSnapshot {
  readonly errors: number;
  readonly slowRequests: number;
  readonly performance: number;
}

export interface SdkConfigSnapshot {
  readonly clientKey: string;
  readonly environment: string | null;
  readonly release: string | null;
  readonly sampleRates: SdkSampleRatesSnapshot;
  readonly slowRequestThreshold: number;
  readonly allowedRequestOrigins: readonly string[];
  readonly requestPathRules: readonly { readonly pattern: string; readonly name: string }[];
  readonly extraErrorStatusCodes: readonly number[];
  readonly ignoredRequestUrls: readonly string[];
  readonly excludeSameOriginRequests: boolean;
  readonly interactionTrailEnabled: boolean;
  readonly maxActivityTrailEntries: number;
  readonly beforeSend: unknown;
}
```

`parseSdkConfig(input)` rules (frozen snapshot, non-mutating, never throws): `clientKey` must be a non-empty string ≤256 chars → else `{ ok:false, issues }`. Every other field normalizes with a recorded `SdkConfigFix` (invalid → safe default). Defaults: `sampleRates {errors:1, slowRequests:0.2, performance:0.1}`, `slowRequestThreshold:3000`, `allowedRequestOrigins:[]`, `requestPathRules:[]`, `extraErrorStatusCodes:[]`, `ignoredRequestUrls:[]`, `excludeSameOriginRequests:false`, `interactionTrailEnabled:true`, `maxActivityTrailEntries:30`, `beforeSend:null`. Origins validated by `isValidOriginInput` (see Task 4) — only fully-qualified `scheme://host[:port]` or one-level `scheme://*.host` wildcards accepted; invalid entries dropped with a fix.

**Tests (`test/configuration.test.ts`)** cover: defaults table, each invalid field → default + fix, `clientKey` missing/empty/non-string/too-long → overall failure, snapshot frozen, input not retained, origin-entry validation, sample-rate range (0..1) validation, threshold integer validation.

- [ ] **Step 1:** Write `package.json`, tsconfigs, vitest config, `event-draft.ts`, `configuration.ts`, `configuration.test.ts`.
- [ ] **Step 2:** Run `pnpm --filter @aurora/sdk test` → PASS.
- [ ] **Step 3:** Write `package-entry.test.ts` (root entry loads; private paths rejected) and `no-dom-consumer.ts`; run `pnpm --filter @aurora/sdk test:package` + `typecheck` → PASS.

---

### Task 2: Unified privacy filter + `beforeSend` (SDK-12)

**Files:**
- Create: `packages/sdk/src/privacy-filter.ts`
- Create: `packages/sdk/src/before-send.ts`
- Create: `packages/sdk/test/privacy-filter.test.ts`, `packages/sdk/test/before-send.test.ts`

**Interfaces:**
- Consumes: `SdkEventDraft` (Task 1); `EventType`, `EVENT_SCHEMA_LIMITS` from `@aurora/event-schema`.
- Produces:
  - `applySdkPrivacyFilter(draft: SdkEventDraft): { ok:boolean; code:'ok'|'forbidden_field'|'invalid_draft'; event?: SdkEventDraft }`
  - `applySdkBeforeSend(draft: SdkEventDraft, beforeSend: unknown): { code:'kept'|'dropped'|'invalid_return'|'callback_threw'; event?: SdkEventDraft }`

**privacy-filter.ts** (implementation sketch):

```ts
const FORBIDDEN_NORMALIZED = new Set([
  'authorization', 'cookie', 'password', 'requestbody', 'responsebody',
  'formdata', 'dom', 'consolelog', 'ipaddress', 'token', 'accesstoken', 'refreshtoken',
]);

function normalizeFieldName(key: string): string {
  return key.replace(/[_\-]/g, '').toLowerCase();
}
```

- Bounded recursive scan of `draft.body` (depth ≤ `EVENT_SCHEMA_LIMITS.maxObjectDepth`, keys ≤ 100, array ≤ 100, string ≤ 4096); any own-key that normalizes into `FORBIDDEN_NORMALIZED` → `{ ok:false, code:'forbidden_field' }`.
- Deep-clone the body, stripping query+fragment from any string value that matches `^https?://` (defense-in-depth; request URL already stripped by protocol).
- Cycle/overflow → `{ ok:false, code:'invalid_draft' }`. Returns a new draft; input never mutated.
- Validate `eventType ∈ EventType` and body is a plain object → else `invalid_draft`.

**before-send.ts** (implementation sketch):

```ts
export type SdkBeforeSend = unknown; // function or readonly function[]
export function applySdkBeforeSend(draft: SdkEventDraft, beforeSend: unknown): ... {
  // if beforeSend is not callable or empty array → kept with original draft
  // for each fn (in order): call fn(Object.freeze({...draft})) in try/catch
  //   catch → { code:'callback_threw' } (never propagates to host)
  //   return null/undefined → { code:'dropped' }
  //   return not an object with valid eventType/body → { code:'invalid_return' }
  //   else treat as new draft and continue
}
```

**Tests:** privacy — each forbidden field name rejected at nested depth, URL fields stripped, depth/keys/array/string bounds, cycle → invalid_draft, input unmutated, result new object; beforeSend — kept on valid return, dropped on null/undefined, invalid_return on bad shape, callback_threw on throw + rejection (never propagates), multiple callbacks order, empty/absent → kept.

- [ ] **Step 1:** Write `privacy-filter.ts` + `privacy-filter.test.ts`; run targeted → PASS.
- [ ] **Step 2:** Write `before-send.ts` + `before-send.test.ts`; run targeted → PASS.
- [ ] **SDK-12 ACCEPTANCE STOP:** `pnpm --filter @aurora/sdk test` (privacy + beforeSend suites) + `typecheck` + `git diff --check`.

---

### Task 3: Deterministic sampling (SDK-13)

**Files:**
- Create: `packages/sdk/src/sampling.ts`
- Create: `packages/sdk/test/sampling.test.ts`

**Interfaces:**
- Consumes: `SdkEventDraft`, `SdkConfigSnapshot`, `EventType`.
- Produces:
  - `fnv1a64(input: string): bigint` (FNV-1a 64-bit)
  - `decideSdkSample(eventKey: string, rate: number, hash?: (s:string)=>bigint): boolean`
  - `canonicalDraftKey(draft: SdkEventDraft): string`
  - `decideEventSample(event: SdkEventDraft, config: SdkConfigSnapshot, context: { eventKey?: string; class: 'error'|'slow'|'performance'|'other'; rateOverride?: number }): { sampled:boolean; rate:number }`

**sampling.ts** (implementation sketch):

```ts
export function fnv1a64(input: string): bigint {
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash;
}

export function decideSdkSample(eventKey: string, rate: number, hash: (s:string)=>bigint = fnv1a64): boolean {
  if (rate <= 0) return false;
  if (rate >= 1) return true;
  if (eventKey.length === 0) return false;
  const normalized = Number(hash(eventKey) >> 11n); // high 53 bits, exact double
  return normalized / 2 ** 53 < rate;
}
```

`canonicalDraftKey(draft)` returns `eventType + ':' + stableSerialize(body)` where `stableSerialize` produces a deterministic JSON with object keys sorted ascending and bounded by `EVENT_SCHEMA_LIMITS` (depth 8, keys 100, array 100, string 4096); non-serializable/cycle → `eventType + ':{}'` fallback (never throws).

`decideEventSample` maps class → rate (`error`→`sampleRates.errors`, `slow`→`sampleRates.slowRequests`, `performance`→`sampleRates.performance`, `other`→1.0), applies `rateOverride` if a valid 0..1 number, uses `context.eventKey ?? canonicalDraftKey(event)`.

**Tests:** rate 0/1 boundaries; determinism (same key → same result repeatedly); distribution sanity; `rateOverride`; empty key → false for rate<1; class mapping; no extrapolation surface.

- [ ] **Step 1:** Write `sampling.ts` + `sampling.test.ts`; run targeted → PASS.
- [ ] **SDK-13 ACCEPTANCE STOP:** `pnpm --filter @aurora/sdk test` (sampling suite) + `typecheck` + `git diff --check`.

---

### Task 4: Request allowlist / path normalization / classification (SDK-11)

**Files:**
- Create: `packages/sdk/src/request-classification.ts`
- Create: `packages/sdk/test/request-classification.test.ts`

**Interfaces:**
- Consumes: `SdkEventDraft`, `SdkConfigSnapshot`, `parseRequestEventBody` from `@aurora/event-schema`.
- Produces:
  - `parseOrigin(url: string): { scheme:string; host:string; port:string|null; origin:string } | null` (regex-based, no `URL` global)
  - `normalizeAllowedOrigin(input: string): string | null` (scheme+host+port lowercase, default ports stripped, one-level `*.` wildcard)
  - `isRequestAllowed(url: string, config: SdkConfigSnapshot, context: { pageOrigin:string|null; sdkReportUrls?: readonly string[] }): { allowed:boolean; reason?: 'not_allowed_origin'|'ignored_url'|'sdk_report_url' }`
  - `normalizeRequestPath(url: string, config: SdkConfigSnapshot): string`
  - `classifyRequestEvent(draft: SdkEventDraft, config: SdkConfigSnapshot, context: { pageOrigin:string|null; sdkReportUrls?: readonly string[] }): { ok:true; class:'error'|'slow'|'normal'; normalizedUrl:string; isError:boolean; isSlow:boolean } | { ok:false; code:'disallowed_request'; reason:'not_allowed_origin'|'ignored_url'|'sdk_report_url' }`

**request-classification.ts** (implementation sketch):

```ts
const URL_PATTERN = /^([a-z][a-z0-9+.-]*):\/\/([^/:?#]+)(?::(\d+))?(\/[^?#]*)?$/;

export function parseOrigin(url: string): { scheme: string; host: string; port: string | null; origin: string } | null {
  const lower = url.toLowerCase();
  const match = URL_PATTERN.exec(lower);
  if (!match) return null;
  const scheme = match[1] as string;
  const host = match[2] as string;
  const rawPort = match[3] ?? null;
  const defaultPort = scheme === 'http' ? '80' : scheme === 'https' ? '443' : null;
  const port = rawPort !== null && rawPort !== defaultPort ? rawPort : null;
  return { scheme, host, port, origin: port === null ? `${scheme}://${host}` : `${scheme}://${host}:${port}` };
}
```

- `normalizeAllowedOrigin(input)`: reject if input contains `/` beyond `scheme://`; `http://`/`https://` only; wildcard only as `*.` prefix on the host; returns lowercase normalized origin string; else `null`.
- `isRequestAllowed`: (1) SDK report exclusion — url origin or substring matches `sdkReportUrls` → `sdk_report_url`; (2) `ignoredRequestUrls` substring (case-insensitive) → `ignored_url`; (3) same-origin default (origin === pageOrigin) when `!excludeSameOriginRequests` → allowed; (4) origin matches a normalized `allowedRequestOrigins` entry (wildcard `*.example.com` matches any one-label subdomain `x.example.com`) → allowed; (5) `data:`/`blob:`/`file:`/extension schemes → not allowed; else `not_allowed_origin`.
- `normalizeRequestPath(url, config)`: parse path via `URL_PATTERN`; first match `requestPathRules` in order (pattern is an exact path with `:segment` placeholders; the `pattern` path matches the URL path segment-by-segment) → return `origin + matchedPattern`; else apply dynamic-segment detection: a path segment is replaced by `:number` if `/^\d+$/`, `:uuid` if `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`, `:hash` if `/^[0-9a-f]{32,}$/i`; ordinary words/short ids are left unchanged (PRD §5.1.5). Returns the normalized absolute URL (still passes `parseRequestEventBody`).
- `classifyRequestEvent`: read the validated body (via `parseRequestEventBody`) → extract url, outcome, statusCode, durationMs; run `isRequestAllowed` → disallowed if not; `error` if outcome is network-failure, or statusCode ∈ {429, 500..599} ∪ `extraErrorStatusCodes`; `slow` if `durationMs >= slowRequestThreshold`; normalize url via `normalizeRequestPath`; returns class + `normalizedUrl` + booleans.

**Tests:** origin parsing (default ports, IPv4, subdomain wildcard match, non-http scheme rejected, path in origin rejected); allowlist decision (same-origin default on/off, allowed list, ignored list, sdk-report exclusion, data:/blob: rejection); path normalization (digits/UUID/hex → placeholders, english words unchanged, dev template priority, template miss → auto-detect, result passes `parseRequestEventBody`); classification (network failure/429/5xx/extra code → error, duration ≥ threshold → slow, else normal); privacy negatives (input draft unmutated, no body/credentials/query retention).

- [ ] **Step 1:** Write `request-classification.ts` + `request-classification.test.ts`; run targeted → PASS.
- [ ] **SDK-11 ACCEPTANCE STOP:** `pnpm --filter @aurora/sdk test` (request-classification suite) + `typecheck` + `git diff --check`.

---

### Task 5: Control plane `createSdkControlPlane` + public index (SDK-10 control plane)

**Files:**
- Create: `packages/sdk/src/control-plane.ts`
- Create: `packages/sdk/src/index.ts`
- Create: `packages/sdk/test/control-plane.test.ts`

**Interfaces:**
- Consumes: `configuration`, `privacy-filter`, `before-send`, `sampling`, `request-classification` (Tasks 1–4), `EventType`.
- Produces:
  - `SdkDropCode = 'invalid_draft' | 'dropped_by_before_send' | 'disallowed_request' | 'sampled_out'`
  - `SdkProcessedEvent { ok:true; event:SdkEventDraft; sampledOut:boolean }`
  - `SdkDroppedEvent { ok:false; code:SdkDropCode }`
  - `SdkProcessEventResult = SdkProcessedEvent | SdkDroppedEvent`
  - `SdkSubmitDraft = (draft:SdkEventDraft) => { ok:boolean; code:string; state?:string; diagnosticsAdded?:number }`
  - `SdkControlPlane { getConfig(): SdkConfigSnapshot; processEvent(draft:SdkEventDraft): SdkProcessEventResult; submit(draft:SdkEventDraft, submitToCore:SdkSubmitDraft): SdkSubmitResult; destroy(): void }`
  - `createSdkControlPlane(config: SdkConfigSnapshot, options?: { pageOrigin?: string }): SdkControlPlane`
  - Root index exports every public type/function above plus `parseSdkConfig`, `SdkConfigSnapshot`, `applySdkPrivacyFilter`, `applySdkBeforeSend`, `decideEventSample`, `decideSdkSample`, `classifyRequestEvent`, `SdkEventDraft`. (No `recordActivity`/`getActivityTrail` — SDK-14 delivers those.)

**control-plane.ts** (implementation sketch):

```ts
export function createSdkControlPlane(config: SdkConfigSnapshot, options: { pageOrigin?: string } = {}): SdkControlPlane {
  const context = { pageOrigin: options.pageOrigin ?? null, sdkReportUrls: [] };
  function processEvent(draft: SdkEventDraft): SdkProcessEventResult {
    if (!isSdkEventDraft(draft)) return { ok:false, code:'invalid_draft' };
    const filtered = applySdkPrivacyFilter(draft);
    if (!filtered.ok) return { ok:false, code:'invalid_draft' };
    let current = filtered.event as SdkEventDraft;
    if (config.beforeSend != null) {
      const before = applySdkBeforeSend(current, config.beforeSend);
      if (before.code !== 'kept') return { ok:false, code:'dropped_by_before_send' };
      current = before.event as SdkEventDraft;
      const recheck = applySdkPrivacyFilter(current); // no re-add of filtered data
      if (!recheck.ok) return { ok:false, code:'dropped_by_before_send' };
      current = recheck.event as SdkEventDraft;
    }
    let sdkClass: SdkEventClass;
    if (current.eventType === EventType.Request) {
      const classified = classifyRequestEvent(current, config, context);
      if (!classified.ok) return { ok:false, code:'disallowed_request' };
      current = { eventType: EventType.Request, body: { ...(current.body as object), url: classified.normalizedUrl } };
      sdkClass = classified.class === 'error' ? 'error' : classified.class === 'slow' ? 'slow' : 'other';
    } else {
      sdkClass = current.eventType === EventType.Error ? 'error'
        : current.eventType === EventType.Performance ? 'performance' : 'other';
    }
    const decision = decideEventSample(current, config, { class: sdkClass });
    if (!decision.sampled) return { ok:false, code:'sampled_out' };
    return { ok:true, event: current, sampledOut:false };
  }
  return Object.freeze({
    getConfig: () => config,
    processEvent,
    submit: (draft, submitToCore) => {
      const processed = processEvent(draft);
      if (!processed.ok) return { ok:false, code: processed.code };
      if (processed.sampledOut) return { ok:false, code:'sampled_out' };
      return submitToCore(processed.event);
    },
    destroy: () => { /* SDK-14 adds trail clearing */ },
  });
}
```

**Tests:** full pipeline order; each drop code; request normalized URL reaches the kept event; sampled-out not submitted; `submit` delegates to `submitToCore` only when kept; config frozen; `destroy` no-op (SDK-14 extends); multi-instance isolation (two planes, no shared state).

- [ ] **Step 1:** Write `control-plane.ts`, `index.ts`, `control-plane.test.ts`; run targeted → PASS.
- [ ] **Step 2:** Write `README.md`; run full package gates: `pnpm --filter @aurora/sdk test` + `test:package` + `typecheck` + `test:coverage` (thresholds 85/80/85/85).

---

### Task 6: Browser composition `createAuroraSdk` (SDK-10 composition) + policy-test update + docs

**Files:**
- Create: `packages/browser/src/sdk-composition.ts`
- Modify: `packages/browser/src/index.ts` (export `createAuroraSdk` + types)
- Modify: `packages/browser/package.json` (add `@aurora/core`, `@aurora/sdk` deps)
- Modify: `tooling/workspace-policy/test/browser-package-contract.test.ts` (allow the two deps)
- Create: `packages/browser/test/sdk-composition.test.ts`
- Modify: `docs/sdk/sdk-public-configuration-context-composition.md` (mark composition implemented status when acceptance passes), `docs/README.md` (already indexed), `packages/browser/README.md`

**Interfaces:**
- Consumes: `createCore`/`AuroraCore`/`CorePlugin`/`CorePluginContext`/`CoreEventDraftResult`/`CoreLifecycleResult` from `@aurora/core`; `createSdkControlPlane`/`parseSdkConfig`/`SdkConfigSnapshot`/`SdkControlPlane`/`SdkEventDraft`/`SdkProcessEventResult` from `@aurora/sdk`; `createBrowserEnvironment`/`BrowserEnvironment` from `./browser-environment.js`.
- Produces: `createAuroraSdk(input: { config: unknown; environment?: BrowserEnvironment; plugins?: readonly CorePlugin[]; pageOrigin?: string }): AuroraSdkHandle` where `AuroraSdkHandle { config: SdkConfigSnapshot; core: AuroraCore; control: SdkControlPlane; start(): Promise<CoreLifecycleResult>; stop(): Promise<CoreLifecycleResult>; destroy(): Promise<CoreLifecycleResult> }`.

**sdk-composition.ts** (implementation sketch):

```ts
import { createCore, type AuroraCore, type CoreEventDraftResult, type CoreLifecycleResult, type CorePlugin } from '@aurora/core';
import { createSdkControlPlane, parseSdkConfig, type SdkConfigSnapshot, type SdkControlPlane, type SdkEventDraft } from '@aurora/sdk';
import { createBrowserEnvironment, type BrowserEnvironment } from './browser-environment.js';

const SAFE_DEFAULT_SDK_CONFIG: SdkConfigSnapshot = Object.freeze({
  clientKey: '', environment: null, release: null,
  sampleRates: Object.freeze({ errors: 1, slowRequests: 0.2, performance: 0.1 }),
  slowRequestThreshold: 3000, allowedRequestOrigins: Object.freeze([]),
  requestPathRules: Object.freeze([]), extraErrorStatusCodes: Object.freeze([]),
  ignoredRequestUrls: Object.freeze([]), excludeSameOriginRequests: false,
  interactionTrailEnabled: true, maxActivityTrailEntries: 30, beforeSend: null,
});

export function createAuroraSdk(input: { config: unknown; environment?: BrowserEnvironment; plugins?: readonly CorePlugin[]; pageOrigin?: string }): AuroraSdkHandle {
  const parsed = parseSdkConfig(input.config);
  const config = parsed.ok ? parsed.config : SAFE_DEFAULT_SDK_CONFIG;
  const environment = input.environment ?? createBrowserEnvironment();
  const core = createCore();
  const control = createSdkControlPlane(config, { pageOrigin: input.pageOrigin });
  for (const plugin of input.plugins ?? []) {
    core.registerPlugin(wrapPlugin(plugin, core, control, config));
  }
  return Object.freeze({
    config,
    core,
    control,
    start: async (): Promise<CoreLifecycleResult> => {
      const initialized = await core.initialize();
      if (!initialized.ok) return initialized;
      return core.start();
    },
    stop: (): Promise<CoreLifecycleResult> => core.stop(),
    destroy: (): Promise<CoreLifecycleResult> => { control.destroy(); return core.destroy(); },
  });
}

function wrapPlugin(plugin: CorePlugin, core: AuroraCore, control: SdkControlPlane, config: SdkConfigSnapshot): CorePlugin {
  const wrappedContext = {
    submitEvent: (input: unknown): CoreEventDraftResult => {
      if (!isSdkEventDraft(input)) return rejectedDraftResult();
      const processed = control.processEvent(input);
      if (!processed.ok) return rejectedDraftResult();       // policy drop → bounded failure diagnostic
      if (processed.sampledOut) return acceptedDraftResult(); // sampling is silent
      return core.submitEventDraft(processed.event);
    },
    getConfig: (): SdkConfigSnapshot => config,
  };
  return Object.freeze({
    name: plugin.name,
    initialize: (ctx) => plugin.initialize({ ...ctx, ...wrappedContext }),
    start: () => plugin.start(),
    stop: () => plugin.stop(),
    destroy: () => plugin.destroy(),
  });
}

function rejectedDraftResult(): CoreEventDraftResult {
  return Object.freeze({ ok: false, code: 'invalid_event', state: 'started', issues: [], diagnosticsAdded: 1 });
}
function acceptedDraftResult(): CoreEventDraftResult {
  return Object.freeze({ ok: true, code: 'accepted', state: 'started', diagnosticsAdded: 0 });
}
```

Notes: `environment` is created (kept in closure for SDK-14 page-enter recording) but not otherwise referenced in Plan B; the seam above means policy drops surface to plugins as a bounded failure diagnostic and sampled-out events are silent — documented seam behavior, replaced by the queue seam in G06.

**browser-package-contract.test.ts** change:

```ts
expect(manifest.dependencies).toEqual({
  '@aurora/core': 'workspace:*',
  '@aurora/sdk': 'workspace:*',
});
```

**Tests (`sdk-composition.test.ts`):** config parsing via handle; safe-default fallback on invalid `clientKey`; plugins registered with wrapped contexts (submit routes through control: disallowed/validation drop → rejected result, sampled-out → accepted result, kept → core result); empty plugins list; handle lifecycle (`start` initializes+starts core, `stop`, `destroy` clears control); multi-instance isolation.

- [ ] **Step 1:** Update `browser/package.json` deps + browser-package-contract test; `pnpm install --frozen-lockfile`.
- [ ] **Step 2:** Write `sdk-composition.ts`, export from `browser/src/index.ts`, write `sdk-composition.test.ts`; run `pnpm --filter @aurora/browser test` (composition suite) + `typecheck` → PASS.
- [ ] **Step 3:** Update `packages/browser/README.md`; confirm workspace boundary `pnpm check:boundaries` for sdk packages.
- [ ] **SDK-10 ACCEPTANCE STOP:** `pnpm --filter @aurora/sdk test` (config+control-plane) + `pnpm --filter @aurora/browser exec vitest run test/sdk-composition.test.ts` + `typecheck` (both packages) + `git diff --check`.

---

## Self-Review (authoring session, before implementation)

- **Spec coverage:** SDK-10 config/control-plane/composition (Tasks 1/5/6); SDK-11 (Task 4); SDK-12 (Task 2); SDK-13 (Task 3). Trail surface (`recordActivity`/`getActivityTrail`) explicitly deferred to SDK-14 per the SDK-10 spec note.
- **Placeholder scan:** all signatures and algorithms concrete; no TBD.
- **Type consistency:** `SdkEventDraft`, `SdkConfigSnapshot`, `SdkProcessEventResult`, `SdkControlPlane` used identically across tasks; composition maps to `CoreEventDraftResult` at the seam only.
- **Conflict check:** no wire-protocol change (ADR-005); no `@aurora/core` API change; browser sources untouched; no new dependency layer; `@aurora/sdk` is env-agnostic (no DOM/`URL`/`process`), verified by `tsconfig.no-dom.json` + sdk-core ESLint.
- **G06/G07:** no queue/transport/adapters.
- **Privacy:** request classification never reads body/credentials/unauthorized query; canonical key is bounded; diagnostics contain no sensitive data.
