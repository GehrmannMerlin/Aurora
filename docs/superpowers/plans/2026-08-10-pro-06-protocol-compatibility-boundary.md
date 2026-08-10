---
title: PRO-06 Protocol Compatibility and Version Negotiation Implementation Plan
status: approved
owner: sdk
created: 2026-08-10
applies-to: packages/event-schema（协议兼容边界第一增量）
related:
  - ../../protocol/protocol-compatibility-boundary.md
  - ../../protocol/event-envelope-v1.md
  - ../../adr/ADR-005-event-schema-source-of-truth.md
  - ../../README.md
supersedes: none
review-cycle: protocol-or-public-api-change
---

# PRO-06 Protocol Compatibility and Version Negotiation Implementation Plan

> **For agentic workers:** This G05 plan is executed inline by the current Claude main session (user-authorized FAST INLINE MODE; no subagents, no reviewer).

**Goal:** Add a public protocol-version negotiation entry point and an explicitly-empty compatibility-conversion boundary to `@aurora/event-schema`, per the approved spec [protocol-compatibility-boundary.md](../../protocol/protocol-compatibility-boundary.md).

**Architecture:** `negotiateProtocolVersion(input)` reuses the existing `isSupportedProtocolVersion` type guard to return a stable discriminated union; the conversion surface stays empty (no `convert*`/`upgrade*`/`downgrade*` exports), proven by package-entry negatives. Doc sync updates the envelope compatibility section and the package README.

**Tech Stack:** TypeScript 6.0.3 (strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), Vitest 4.1.10, pnpm workspace, `@aurora/event-schema` (private, `aurora.layer: protocol`, zero runtime deps).

## Global Constraints

- Only protocol version `1` is supported; unknown/newer versions are explicitly rejected, never guessed or downgraded (ADR-005 + event-schema-foundation §7).
- No conversion functions may be exported (empty conversion boundary; no historical versions exist).
- Results are frozen new objects; functions never throw on ordinary invalid input; inputs are never mutated.
- `@aurora/event-schema` must keep zero runtime dependencies and only its two public entries (root + `contract-testkit`).
- Coverage thresholds stay at the package's existing values (lines 85 / branches 80 / functions 85 / statements 85); no new thresholds, no file exclusions.
- Target tests only: `pnpm --filter @aurora/event-schema test/typecheck/test:package`; no Browser/PostgreSQL/root runs.

---

### Task 1: `negotiateProtocolVersion` public entry point

**Files:**
- Create: `packages/event-schema/src/protocol-negotiation.ts`
- Modify: `packages/event-schema/src/index.ts` (export negotiation symbols)
- Create: `packages/event-schema/test/protocol-negotiation.test.ts`
- Modify: `packages/event-schema/test/version-and-event-type.test.ts` (add negotiation assertion)

**Interfaces:**
- Consumes: `isSupportedProtocolVersion(input: unknown): input is ProtocolVersion` from `./constants.js`; `ProtocolVersion` from `./constants.js`.
- Produces:
  - `export type ProtocolNegotiationCode = 'supported' | 'unsupported_version';`
  - `export interface ProtocolNegotiationSupported { readonly ok: true; readonly code: 'supported'; readonly version: ProtocolVersion; }`
  - `export interface ProtocolNegotiationUnsupported { readonly ok: false; readonly code: 'unsupported_version'; readonly requestedVersion: unknown; }`
  - `export type ProtocolNegotiationResult = ProtocolNegotiationSupported | ProtocolNegotiationUnsupported;`
  - `export function negotiateProtocolVersion(input: unknown): ProtocolNegotiationResult;`

- [ ] **Step 1: Write the failing test**

`packages/event-schema/test/protocol-negotiation.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { negotiateProtocolVersion, parseEventEnvelope } from '../src/index.js';

describe('negotiateProtocolVersion', () => {
  it('accepts the supported protocol version 1', () => {
    const result = negotiateProtocolVersion(1);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.code).toBe('supported');
      expect(result.version).toBe(1);
    }
  });

  it('rejects unknown and newer versions explicitly without guessing', () => {
    const inputs: readonly unknown[] = [0, 2, 3, -1, 1.5, '1', null, undefined, {}, [], true];
    for (const input of inputs) {
      const result = negotiateProtocolVersion(input);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('unsupported_version');
        expect(result.requestedVersion).toBe(input);
      }
    }
  });

  it('is consistent with parseEventEnvelope version rejection', () => {
    expect(negotiateProtocolVersion(2).ok).toBe(false);
    const parsed = parseEventEnvelope({
      protocolVersion: 2,
      eventId: 'e1',
      eventType: 'error',
      occurredAt: 1,
      body: {},
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.issues.some((i) => i.code === 'unsupported_protocol_version')).toBe(true);
    }
  });

  it('returns frozen new results and never mutates input', () => {
    const supported = negotiateProtocolVersion(1);
    expect(Object.isFrozen(supported)).toBe(true);
    const input: { readonly value: number } = { value: 2 };
    const rejected = negotiateProtocolVersion(input);
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.requestedVersion).toBe(input);
    expect(input.value).toBe(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @aurora/event-schema exec vitest run test/protocol-negotiation.test.ts`
Expected: FAIL — `negotiateProtocolVersion` is not exported from `@aurora/event-schema` (module resolution error).

- [ ] **Step 3: Write the minimal implementation**

`packages/event-schema/src/protocol-negotiation.ts`:

```ts
import { isSupportedProtocolVersion, type ProtocolVersion } from './constants.js';

export type ProtocolNegotiationCode = 'supported' | 'unsupported_version';

export interface ProtocolNegotiationSupported {
  readonly ok: true;
  readonly code: 'supported';
  readonly version: ProtocolVersion;
}

export interface ProtocolNegotiationUnsupported {
  readonly ok: false;
  readonly code: 'unsupported_version';
  readonly requestedVersion: unknown;
}

export type ProtocolNegotiationResult = ProtocolNegotiationSupported | ProtocolNegotiationUnsupported;

export function negotiateProtocolVersion(input: unknown): ProtocolNegotiationResult {
  if (isSupportedProtocolVersion(input)) {
    return Object.freeze({ ok: true, code: 'supported', version: input });
  }
  return Object.freeze({ ok: false, code: 'unsupported_version', requestedVersion: input });
}
```

`packages/event-schema/src/index.ts` — add to the version-constant export block (after the `parseEventEnvelope` export group):

```ts
export {
  negotiateProtocolVersion,
  type ProtocolNegotiationCode,
  type ProtocolNegotiationResult,
  type ProtocolNegotiationSupported,
  type ProtocolNegotiationUnsupported,
} from './protocol-negotiation.js';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @aurora/event-schema test`
Expected: PASS — protocol-negotiation suite green and no regressions in the existing event-schema suite.

- [ ] **Step 5: Assert negotiation in the version contract test**

`packages/event-schema/test/version-and-event-type.test.ts` — extend the `protocol version contract` describe with:

```ts
  it('exposes a public version negotiation entry point', () => {
    expect(negotiateProtocolVersion(1)).toMatchObject({ ok: true, code: 'supported', version: 1 });
    expect(negotiateProtocolVersion(2)).toMatchObject({ ok: false, code: 'unsupported_version' });
  });
```

Add `negotiateProtocolVersion` to the existing import list at the top of that file.

- [ ] **Step 6: Run the version test to verify it passes**

Run: `pnpm --filter @aurora/event-schema exec vitest run test/version-and-event-type.test.ts test/protocol-negotiation.test.ts`
Expected: PASS.

---

### Task 2: Empty conversion boundary (package-entry negatives + consistency)

**Files:**
- Modify: `packages/event-schema/test/package-entry.test.ts` (add converter-negative + negotiation-positive assertions)

**Interfaces:**
- Consumes: `negotiateProtocolVersion` (Task 1); the built package root entry `@aurora/event-schema`.
- Produces: executable proof that the root entry exports no `convert*`/`upgrade*`/`downgrade*`/`migrate*` functions.

- [ ] **Step 1: Write the failing assertions**

`packages/event-schema/test/package-entry.test.ts` — add inside the `built package entries` describe (after the root-entry test):

```ts
  it('exposes version negotiation but no compatibility converters (empty conversion boundary)', () => {
    const result = importFromPackage('@aurora/event-schema');
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('negotiateProtocolVersion');
    const keys = result.stdout.split(',');
    const converterKeys = keys.filter((k) => /convert|upgrade|downgrade|migrate/i.test(k));
    expect(converterKeys).toEqual([]);
  });
```

- [ ] **Step 2: Run the test to verify the boundary holds**

Run: `pnpm --filter @aurora/event-schema test:package`
Expected: PASS — `negotiateProtocolVersion` present, no converter keys. (After Task 1, the root entry already meets this; this task freezes it as a regression gate.)

- [ ] **Step 3: Add the parseEventEnvelope consistency negative fixture**

`packages/event-schema/test/protocol-negotiation.test.ts` — the consistency test written in Task 1 already covers this; confirm it runs under the full suite.

- [ ] **Step 4: Run the full package test suite to confirm no regression**

Run: `pnpm --filter @aurora/event-schema test && pnpm --filter @aurora/event-schema test:package`
Expected: PASS (both).

---

### Task 3: Documentation sync (envelope compatibility + package README)

**Files:**
- Modify: `docs/protocol/event-envelope-v1.md` (§7 兼容性 — reference `negotiateProtocolVersion`)
- Modify: `packages/event-schema/README.md` (public exports + empty conversion boundary)

**Interfaces:**
- Consumes: the approved spec [protocol-compatibility-boundary.md](../../protocol/protocol-compatibility-boundary.md); Task 1/2 behavior.

- [ ] **Step 1: Update the envelope compatibility section**

`docs/protocol/event-envelope-v1.md` — replace §7 text with:

```markdown
## 7. 兼容性

当前仅支持版本 `1`，不存在历史协议转换。版本 `0` 与 `2` 都明确拒绝。同版本信封可以在 `body` 中增加通用边界允许的可选数据；这只证明信封级兼容，不能代替未来具体事件字段兼容。删除/重释字段、改变类型、把可选字段改为必填或改变枚举含义是不兼容变化，必须先有 accepted ADR、迁移和旧版本处理方案。

版本协商公共入口：`negotiateProtocolVersion(input)`（见[协议兼容边界](protocol-compatibility-boundary.md)）返回 `{ ok: true, code: 'supported' }` 或 `{ ok: false, code: 'unsupported_version' }`；SDK 与消费者不得把未知/更新版本降级、猜测或改写。当前兼容转换能力为空，`@aurora/event-schema` 不导出任何转换函数。
```

- [ ] **Step 2: Update the package README**

`packages/event-schema/README.md` — in the "错误与兼容性" section, append:

```markdown
协议版本协商：根入口导出 `negotiateProtocolVersion(input)`，返回稳定的 `supported` / `unsupported_version` 判别结果。SDK 始终只产生 `CURRENT_PROTOCOL_VERSION` 事件，不改变公共 wire contract。当前不存在历史协议版本，因此本包不导出任何 `convert*`/`upgrade*`/`downgrade*` 转换函数（空转换边界）；任何兼容转换需求必须先经 ADR-005 门禁。
```

And in the public exports list (the `import { ... } from '@aurora/event-schema'` block), add:

```ts
  negotiateProtocolVersion,
```

- [ ] **Step 3: Run the targeted PRO-06 gate**

Run:
```
pnpm --filter @aurora/event-schema test
pnpm --filter @aurora/event-schema typecheck
pnpm --filter @aurora/event-schema test:package
git diff --check
```
Expected: PASS, PASS, PASS, clean.

- [ ] **Step 4: Confirm scope exclusion**

Verify no changes outside `packages/event-schema`, `docs/protocol/event-envelope-v1.md`, `docs/README.md`, and `packages/event-schema/README.md`. No queue/transport/framework adapter code.

---

## Self-Review (performed by the authoring session before implementation)

- **Spec coverage:** spec §4 (public contract), §4.1 (semantics), §4.2 (empty conversion boundary), §5 (tests), §6 (docs) all mapped to Tasks 1–3.
- **Placeholder scan:** no TBD/TODO; all code blocks concrete.
- **Type consistency:** `negotiateProtocolVersion`, `ProtocolNegotiationResult`, `ProtocolNegotiationSupported`, `ProtocolNegotiationUnsupported` used identically across Tasks 1–2 and the spec.
- **ADR-005 / protocol boundaries:** no wire-contract change; unknown versions rejected; no converters.
- **No G06/G07 scope:** no queue/transport/adapter code.
- **Privacy:** no sensitive data introduced; fixtures synthetic.
