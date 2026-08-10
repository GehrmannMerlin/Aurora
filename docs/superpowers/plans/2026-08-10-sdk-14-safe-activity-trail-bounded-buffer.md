---
title: SDK-14 Safe Activity Trail and Bounded Buffer Implementation Plan
status: approved
owner: sdk
created: 2026-08-10
applies-to: @aurora/sdk 的安全操作轨迹契约与有界缓冲；控制面轨迹集成；@aurora/browser composition page_enter 与插件上下文
related:
  - ../../sdk/safe-activity-trail-and-bounded-buffer.md
  - ../../sdk/sdk-public-configuration-context-composition.md
  - ../../sdk/sdk-sampling-policy.md
  - ../../sdk/unified-privacy-filtering-and-beforesend.md
  - ../../adr/ADR-003-sdk-plugin-architecture.md
  - ../../adr/ADR-005-event-schema-source-of-truth.md
supersedes: none
review-cycle: sdk-public-api-or-privacy-change
---

# SDK-14 Safe Activity Trail and Bounded Buffer Implementation Plan

> **For agentic workers:** Executed inline by the current Claude main session (user-authorized FAST INLINE MODE). Independent acceptance stop for SDK-14.

**Goal:** Add the safe activity-trail entry contract and bounded buffer to `@aurora/sdk`, integrate trail recording into the control plane, and record the `page_enter` entry from the browser composition — per the approved spec [safe-activity-trail-and-bounded-buffer.md](../../sdk/safe-activity-trail-and-bounded-buffer.md). Trail stays SDK-side (never enters the wire event; wire integration deferred).

**Architecture:** New `src/activity-trail.ts` (entry types + `createSdkActivityTrail` bounded buffer) → control plane (`createSdkControlPlane`) gains a per-instance trail, `recordActivity`/`getActivityTrail`, trail recording in `processEvent`, and `destroy()` clearing → browser composition passes `recordActivity` into the plugin context and records `page_enter` from the environment's safe page snapshot.

**Tech Stack:** TypeScript 6.0.3 strict, Vitest 4.1.10, pnpm workspace, `@aurora/sdk` (sdk-core, no DOM), `@aurora/browser` composition. Coverage 85/80/85/85 for `@aurora/sdk`.

## Global Constraints

- Trail entries contain only the approved safe fields; never message text, stacks, form values, DOM text, credentials, bodies, full IP, or fingerprints.
- Buffer is bounded (`maxActivityTrailEntries`, default 30, range 1..1000), drop-oldest, deterministic, per-instance, cleared on destroy.
- Trail never enters the wire event (ADR-005 boundary; wire attachment deferred).
- `interactionTrailEnabled` (default true) gates recording; `record` on a disabled/destroyed trail returns a stable result.
- No Session Replay / behavior-analysis semantics; no `route_change` producer (G07) and no new resource-error producer in this increment.
- Each acceptance run: targeted `@aurora/sdk` tests + affected typecheck + `git diff --check`; no root/Browser-matrix/coverage runs.

---

### Task 1: Safe activity-trail contract + bounded buffer

**Files:**
- Create: `packages/sdk/src/activity-trail.ts`
- Modify: `packages/sdk/src/index.ts` (export trail types + factory)
- Create: `packages/sdk/test/activity-trail.test.ts`

**Interfaces:**
- Consumes: `isSdkEventDraft` (unused here; pure buffer). No `@aurora/event-schema` import needed except types.
- Produces:
  - `SafeActivityEntryKind = 'page_enter' | 'route_change' | 'request_summary' | 'resource_error' | 'sdk_report' | 'prior_error'`
  - Entry interfaces: `SafePageEnterEntry { kind:'page_enter'; occurredAt:number; sequence:number; origin:string; pathname:string }`, `SafeRouteChangeEntry { kind:'route_change'; occurredAt; sequence; pathname:string }`, `SafeRequestSummaryEntry { kind:'request_summary'; occurredAt; sequence; method:string; normalizedUrl:string; outcome:string; statusCode?:number; durationMs:number }`, `SafeResourceErrorEntry { kind:'resource_error'; occurredAt; sequence; normalizedUrl:string }`, `SafeSdkReportEntry { kind:'sdk_report'; occurredAt; sequence; action:string }`, `SafePriorErrorEntry { kind:'prior_error'; occurredAt; sequence; errorClass:string; normalizedUrl?:string }`, `SafeActivityEntry = union`.
  - `SdkRecordActivityCode = 'recorded' | 'invalid_entry' | 'disabled' | 'destroyed'`
  - `SdkRecordActivityResult { ok:boolean; code; sequence:number; droppedOldest:number }`
  - `SdkActivityTrail { capacity:number; entries:readonly SafeActivityEntry[]; record(entry:unknown):SdkRecordActivityResult; destroy():void }`
  - `createSdkActivityTrail(options?: { capacity?:number; enabled?:boolean }): SdkActivityTrail`

**Implementation sketch (`src/activity-trail.ts`):**

```ts
export function createSdkActivityTrail(options: { capacity?: number; enabled?: boolean } = {}): SdkActivityTrail {
  const capacity = normalizeCapacity(options.capacity);       // 1..1000, default 30
  const enabled = options.enabled !== false;                  // default true
  let entries: SafeActivityEntry[] = [];
  let sequence = 0;
  let isDestroyed = false;
  return Object.freeze({
    capacity,
    entries: Object.freeze([]),
    record: (input: unknown): SdkRecordActivityResult => {
      if (isDestroyed) return Object.freeze({ ok:false, code:'destroyed', sequence:0, droppedOldest:0 });
      if (!enabled) return Object.freeze({ ok:false, code:'disabled', sequence:0, droppedOldest:0 });
      const entry = normalizeEntry(input, sequence + 1);      // validates kind + safe fields; else invalid_entry
      if (entry === null) return Object.freeze({ ok:false, code:'invalid_entry', sequence:0, droppedOldest:0 });
      sequence += 1;
      let droppedOldest = 0;
      entries.push(entry);
      if (entries.length > capacity) { entries.shift(); droppedOldest = 1; }
      return Object.freeze({ ok:true, code:'recorded', sequence, droppedOldest });
    },
    destroy: (): void => { isDestroyed = true; entries = []; sequence = 0; },
  });
}
```

`normalizeEntry(input, sequence)` validates: plain object; `kind` is one of the six; each entry's safe fields are present with correct primitive types (`occurredAt` safe positive integer, `sequence` assigned); `statusCode`/`normalizedUrl` optional only where the type declares them; any extra/missing field or wrong type → `null`. Returns a frozen entry with `sequence` set.

**Tests (`test/activity-trail.test.ts`):** capacity default 30; drop-oldest when full (deterministic oldest dropped); `sequence` increments from 1; each kind accepted with correct fields; invalid entries rejected (bad kind, missing field, wrong type, extra sensitive field like `message`); `enabled:false` → disabled; `destroy()` clears + subsequent record → destroyed; entries array frozen and returned as new arrays; two trails isolated.

- [ ] **Step 1:** Write `activity-trail.ts` + export from `index.ts` + `activity-trail.test.ts`.
- [ ] **Step 2:** Run `pnpm --filter @aurora/sdk exec vitest run test/activity-trail.test.ts` → PASS; then full `pnpm --filter @aurora/sdk test` → PASS.

---

### Task 2: Control-plane trail integration

**Files:**
- Modify: `packages/sdk/src/control-plane.ts` (trail instance, `recordActivity`/`getActivityTrail`, processEvent recording, destroy clears)
- Modify: `packages/sdk/src/index.ts` (export `SdkPluginContext` + `recordActivity`/`getActivityTrail` types on the control plane)
- Modify: `packages/sdk/test/control-plane.test.ts` (trail integration tests)

**Interfaces:**
- Consumes: `createSdkActivityTrail`, `SafeActivityEntry`, `SdkRecordActivityResult` (Task 1); `EventType`, `parseRequestEventBody`; `classifyRequestEvent` (SDK-11); `decideEventSample` (SDK-13).
- Produces (extensions):
  - `SdkControlPlane.recordActivity(entry: unknown): SdkRecordActivityResult`
  - `SdkControlPlane.getActivityTrail(): readonly SafeActivityEntry[]`
  - `SdkPluginContext { submitEvent(draft:SdkEventDraft): SdkSubmitResult; getConfig(): SdkConfigSnapshot; recordActivity(entry: unknown): SdkRecordActivityResult }`
- `createSdkControlPlane` builds the trail from config: `createSdkActivityTrail({ capacity: config.maxActivityTrailEntries, enabled: config.interactionTrailEnabled })`.

**Recording rules (per spec §5):**

- After the privacy filter and request classification pass, before returning the kept event:
  - request kept → `record({ kind:'request_summary', method, normalizedUrl, outcome, statusCode?, durationMs })` (from the classified, URL-normalized body);
  - error kept → `record({ kind:'prior_error', errorClass: body.category, normalizedUrl? })` (error body `category`; `normalizedUrl` only when a safe URL field is present);
- Sampling outcome: kept → `record({ kind:'sdk_report', action:'event_submitted' })`; sampled-out → `record({ kind:'sdk_report', action:'sample_dropped' })`.
- Trail recording happens only for events that passed the privacy filter; dropped-by-beforeSend/disallowed/invalid events are not recorded (they were not trusted facts).
- `destroy()` now calls the trail's `destroy()`.

**Tests (`test/control-plane.test.ts` additions):** request kept records a `request_summary`; error kept records a `prior_error`; sampled-out records `sdk_report{sample_dropped}`; beforeSend-dropped records nothing; `recordActivity` rejects an invalid entry and records a valid one; `getActivityTrail` returns frozen entries with bounded capacity; `destroy()` clears the trail; two planes' trails isolated.

- [ ] **Step 1:** Modify `control-plane.ts` + `index.ts`; extend `control-plane.test.ts`.
- [ ] **Step 2:** Run `pnpm --filter @aurora/sdk test` → PASS (trail + existing suites).

---

### Task 3: Browser composition — `page_enter` + plugin-context `recordActivity`

**Files:**
- Modify: `packages/browser/src/sdk-composition.ts` (record `page_enter` on start; add `recordActivity` to the plugin context; expose `getActivityTrail` on the handle)
- Modify: `packages/browser/test/sdk-composition.test.ts` (trail assertions)
- Modify: `packages/sdk/README.md` + `packages/browser/README.md` (trail API)
- Modify: `docs/sdk/safe-activity-trail-and-bounded-buffer.md` + `docs/sdk/sdk-public-configuration-context-composition.md` (implemented status note at acceptance)

**Interfaces:**
- Consumes: `BrowserEnvironment.readPageSnapshot()`; `parseOrigin` from `@aurora/sdk`; `control.recordActivity`/`control.getActivityTrail`.
- Produces: `AuroraSdkHandle.getActivityTrail(): readonly SafeActivityEntry[]`; plugin context gains `recordActivity`.

**Implementation sketch:**

```ts
// in handle.start(), after core.start() succeeds:
const snapshot = environment.readPageSnapshot();
if (snapshot.pageUrl !== null) {
  const parsed = parseOrigin(snapshot.pageUrl);
  if (parsed !== null) {
    const path = snapshot.pageUrl.slice(parsed.origin.length) || '/';
    control.recordActivity({ kind:'page_enter', occurredAt: Date.now(), origin: parsed.origin, pathname: path });
  }
}
```

- The wrapped plugin context adds `recordActivity: (entry) => control.recordActivity(entry)`.
- `getActivityTrail` on the handle delegates to `control.getActivityTrail()`.

**Tests (`test/sdk-composition.test.ts` additions):** after `start()` with a pageUrl stub, the trail contains a `page_enter` entry; plugin-context `recordActivity` records through the control plane; `handle.getActivityTrail()` returns the bounded entries.

- [ ] **Step 1:** Modify `sdk-composition.ts` + its test; update both READMEs.
- [ ] **Step 2:** Run `pnpm --filter @aurora/browser exec vitest run test/sdk-composition.test.ts` + `pnpm --filter @aurora/browser typecheck` → PASS.
- [ ] **SDK-14 ACCEPTANCE STOP:** `pnpm --filter @aurora/sdk test` + `pnpm --filter @aurora/browser exec vitest run test/sdk-composition.test.ts` + typecheck (both) + `git diff --check`.

---

## Self-Review (authoring session, before implementation)

- **Spec coverage:** §3 entry contract, §4 bounded buffer, §5 control-plane integration, §5 page_enter, §7 privacy/wire deferral — all mapped to Tasks 1–3.
- **Privacy:** entries carry only safe fields; `normalizeEntry` rejects extra sensitive fields (e.g. `message`); recording only after the privacy filter; no wire integration.
- **Bounded memory:** capacity 30 default, drop-oldest, destroy clears; no unbounded structures.
- **Lifecycle / multi-instance:** per-plane trail; destroy clears; two planes isolated.
- **No G06 duplication:** this is the trail buffer, not the event queue; queue/transport remain absent.
- **No replay/behavior semantics:** `route_change` producer deferred to G07; no full behavior trail.
